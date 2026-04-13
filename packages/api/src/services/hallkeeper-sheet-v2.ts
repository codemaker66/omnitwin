// ---------------------------------------------------------------------------
// Hallkeeper Events Sheet v2 — configuration-based PDF generation
//
// Generates an A4 landscape PDF with 4 zones:
// 1. Header strip (event info, guest count, room name)
// 2. Floor plan diagram placeholder (PNG inserted from client render)
// 3. Manifest table (setup-sequenced, chair-aggregated)
// 4. Footer strip (QR code, fire safety, generation timestamp)
//
// The diagram PNG is expected to be uploaded separately by the client
// (orthographic Three.js render → S3). This service assembles the PDF
// from the manifest data + diagram URL.
// ---------------------------------------------------------------------------

import { eq, and, isNull } from "drizzle-orm";
import {
  configurations, placedObjects, assetDefinitions, spaces, venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { generateManifest, type ManifestObject, type Manifest } from "./manifest-generator.js";
import type { RoomLayout, RoomFeaturePoint } from "./spatial-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All data needed to render the hallkeeper sheet PDF. */
export interface SheetData {
  /**
   * `venue.id` and `config.userId` are surfaced specifically so the route
   * can call `canAccessResource(user, config.userId, venue.id)` before
   * returning PDF or JSON. They are not used by the PDF renderer.
   */
  readonly venue: { readonly id: string; readonly name: string; readonly address: string; readonly logoUrl: string | null };
  readonly space: { readonly name: string; readonly widthM: number; readonly lengthM: number; readonly heightM: number };
  readonly config: { readonly id: string; readonly userId: string | null; readonly name: string; readonly layoutStyle: string; readonly guestCount: number };
  readonly manifest: Manifest;
  readonly diagramUrl: string | null;
  readonly webViewUrl: string;
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Data assembly — loads everything from the database
// ---------------------------------------------------------------------------

/**
 * Assembles all data needed for the hallkeeper sheet from a configuration ID.
 * Returns null if the configuration doesn't exist.
 */
export async function assembleSheetData(
  db: Database,
  configId: string,
  baseUrl: string,
): Promise<SheetData | null> {
  // Load configuration
  const [config] = await db.select().from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;

  // Load space
  const [space] = await db.select().from(spaces)
    .where(eq(spaces.id, config.spaceId))
    .limit(1);
  if (space === undefined) return null;

  // Load venue
  const [venue] = await db.select().from(venues)
    .where(eq(venues.id, config.venueId))
    .limit(1);
  if (venue === undefined) return null;

  // Load placed objects with asset definitions
  const objects = await db.select({
    id: placedObjects.id,
    assetDefinitionId: placedObjects.assetDefinitionId,
    positionX: placedObjects.positionX,
    positionY: placedObjects.positionY,
    positionZ: placedObjects.positionZ,
    rotationY: placedObjects.rotationY,
    sortOrder: placedObjects.sortOrder,
    metadata: placedObjects.metadata,
  }).from(placedObjects)
    .where(eq(placedObjects.configurationId, configId));

  // Fetch asset definitions for each object
  const assetCache = new Map<string, { name: string; category: string }>();
  for (const obj of objects) {
    if (!assetCache.has(obj.assetDefinitionId)) {
      const [asset] = await db.select({ name: assetDefinitions.name, category: assetDefinitions.category })
        .from(assetDefinitions).where(eq(assetDefinitions.id, obj.assetDefinitionId)).limit(1);
      if (asset !== undefined) {
        assetCache.set(obj.assetDefinitionId, asset);
      }
    }
  }

  // Build manifest objects — detect groups from metadata or position proximity
  const manifestObjects: ManifestObject[] = objects.map((obj) => {
    const asset = assetCache.get(obj.assetDefinitionId);
    const meta = obj.metadata as Record<string, unknown> | null;
    // groupId is unknown jsonb — only accept it if it's actually a string,
    // otherwise fall back to null. A previous `as string` cast lied to TS
    // and could let through numbers/objects/etc. unchanged.
    const rawGroupId = meta?.["groupId"];
    const groupId = typeof rawGroupId === "string" ? rawGroupId : null;
    return {
      id: obj.id,
      assetName: asset?.name ?? "Unknown",
      assetCategory: asset?.category ?? "other",
      positionX: Number(obj.positionX),
      positionY: Number(obj.positionY),
      positionZ: Number(obj.positionZ),
      rotationY: Number(obj.rotationY),
      chairCount: 0,
      groupId,
    };
  });

  // Build room layout for spatial classifier
  const roomLayout: RoomLayout = {
    widthM: Number(space.widthM),
    lengthM: Number(space.lengthM),
    features: buildRoomFeatures(Number(space.widthM), Number(space.lengthM)),
  };

  const manifest = generateManifest(manifestObjects, roomLayout);

  return {
    venue: { id: venue.id, name: venue.name, address: venue.address, logoUrl: venue.logoUrl },
    space: {
      name: space.name,
      widthM: Number(space.widthM),
      lengthM: Number(space.lengthM),
      heightM: Number(space.heightM),
    },
    config: {
      id: config.id,
      userId: config.userId,
      name: config.name,
      layoutStyle: config.layoutStyle,
      guestCount: config.guestCount,
    },
    manifest,
    diagramUrl: config.thumbnailUrl,
    webViewUrl: `${baseUrl}/hallkeeper/${configId}`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Default room features for the spatial classifier.
 * Places entrance at front (negative Z) and stage at back (positive Z).
 */
function buildRoomFeatures(_widthM: number, lengthM: number): readonly RoomFeaturePoint[] {
  return [
    { name: "entrance", x: 0, z: -lengthM / 2 + 0.5 },
    { name: "back wall", x: 0, z: lengthM / 2 - 0.5 },
  ];
}

// ---------------------------------------------------------------------------
// PDF generation — pdfkit, A4 landscape
// ---------------------------------------------------------------------------

/** A4 landscape dimensions in points (1pt = 1/72 inch). */
const A4_LANDSCAPE_W = 841.89;
const A4_LANDSCAPE_H = 595.28;
const MARGIN = 36; // 0.5 inch
const CONTENT_W = A4_LANDSCAPE_W - MARGIN * 2;

/**
 * Decodes an image from a data URL and returns it as a Buffer.
 * Only accepts data:image/* URLs to prevent SSRF — the thumbnail upload
 * endpoint already constrains to data:image/png;base64 with a 200KB cap.
 * Returns null if the URL is invalid or not a data URL.
 */
function decodeImageDataUrl(url: string): Buffer | null {
  if (!url.startsWith("data:image/")) return null;
  const commaIdx = url.indexOf(",");
  if (commaIdx < 0) return null;
  const base64 = url.slice(commaIdx + 1);
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Generates a QR code as a PNG Buffer.
 */
async function generateQrBuffer(url: string, size: number): Promise<Buffer | null> {
  try {
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(url, { width: size, margin: 1, color: { dark: "#333333", light: "#ffffff" } });
    const base64 = dataUrl.split(",")[1];
    if (base64 === undefined) return null;
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Generates a PDF buffer from assembled sheet data.
 * Uses pdfkit for server-side rendering — no browser needed.
 */
export async function generateSheetPdf(data: SheetData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  // Pre-render QR code and fetch diagram image BEFORE starting the PDF stream
  const [qrBuffer, diagramBuffer] = await Promise.all([
    generateQrBuffer(data.webViewUrl, 200),
    data.diagramUrl !== null ? Promise.resolve(decodeImageDataUrl(data.diagramUrl)) : Promise.resolve(null),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: [A4_LANDSCAPE_W, A4_LANDSCAPE_H],
      margin: MARGIN,
      info: {
        Title: `Hallkeeper Sheet — ${data.config.name}`,
        Author: "OMNITWIN",
        Subject: `${data.space.name} — ${data.venue.name}`,
      },
    });

    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);

    // =====================================================================
    // ZONE 1 — HEADER STRIP (top ~15%)
    // =====================================================================
    const headerH = 80;

    // Background tint
    doc.save();
    doc.rect(0, 0, A4_LANDSCAPE_W, headerH).fill("#f8f6f0");
    doc.restore();

    // Venue name (left)
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#666666");
    doc.text(data.venue.name.toUpperCase(), MARGIN, 16, { width: 180 });
    doc.font("Helvetica").fontSize(7).fillColor("#999999");
    doc.text(data.venue.address, MARGIN, 30, { width: 180 });

    // Event name (centre, largest text)
    const centerX = A4_LANDSCAPE_W / 2;
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#1a1a1a");
    doc.text(data.config.name, MARGIN + 190, 10, {
      width: CONTENT_W - 380,
      align: "center",
    });

    // Room + layout style
    doc.font("Helvetica").fontSize(9).fillColor("#555555");
    doc.text(`${data.space.name} — ${formatLayoutStyle(data.config.layoutStyle)}`, MARGIN + 190, 38, {
      width: CONTENT_W - 380,
      align: "center",
    });

    // Guest count (right, large)
    const rightX = A4_LANDSCAPE_W - MARGIN - 120;
    doc.font("Helvetica-Bold").fontSize(28).fillColor("#1a1a1a");
    doc.text(String(data.config.guestCount), rightX, 10, { width: 120, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor("#888888");
    doc.text("GUESTS", rightX, 42, { width: 120, align: "right" });

    // Divider line
    doc.moveTo(MARGIN, headerH).lineTo(A4_LANDSCAPE_W - MARGIN, headerH)
      .strokeColor("#e0ddd5").lineWidth(0.5).stroke();

    // =====================================================================
    // ZONE 2 — DIAGRAM PLACEHOLDER (centre ~45%)
    // =====================================================================
    const diagramY = headerH + 8;
    const diagramH = 230;

    if (diagramBuffer !== null) {
      // Insert the actual floor plan diagram image
      doc.image(diagramBuffer, MARGIN, diagramY, {
        width: CONTENT_W,
        height: diagramH,
        fit: [CONTENT_W, diagramH],
        align: "center",
        valign: "center",
      });
      // Light border around diagram
      doc.save();
      doc.rect(MARGIN, diagramY, CONTENT_W, diagramH)
        .strokeColor("#d0d0d0").lineWidth(0.5).stroke();
      doc.restore();
    } else {
      // Placeholder when no diagram available
      doc.save();
      doc.rect(MARGIN, diagramY, CONTENT_W, diagramH)
        .strokeColor("#d0d0d0").lineWidth(0.5).dash(4, { space: 4 }).stroke();
      doc.restore();

      doc.font("Helvetica").fontSize(11).fillColor("#bbbbbb");
      doc.text("Floor plan diagram", MARGIN, diagramY + diagramH / 2 - 10, {
        width: CONTENT_W, align: "center",
      });
      doc.fontSize(8).fillColor("#cccccc");
      doc.text("Generate from the 3D editor to include the floor plan", MARGIN, diagramY + diagramH / 2 + 6, {
        width: CONTENT_W, align: "center",
      });
    }

    // Scale bar
    doc.font("Helvetica").fontSize(7).fillColor("#999999");
    doc.text("1m", MARGIN + 4, diagramY + diagramH - 18);
    doc.save();
    doc.moveTo(MARGIN + 16, diagramY + diagramH - 12)
      .lineTo(MARGIN + 16 + 28.35, diagramY + diagramH - 12)
      .strokeColor("#999999").lineWidth(1).undash().stroke();
    doc.restore();

    // =====================================================================
    // ZONE 3 — MANIFEST TABLE (bottom ~30%)
    // =====================================================================
    const tableY = diagramY + diagramH + 12;
    // Single source of truth: header label, column width, and row-value
    // extractor live together. Eliminates parallel-array indexing and
    // its non-null assertions on every access.
    const columns: readonly {
      readonly header: string;
      readonly width: number;
      readonly value: (row: typeof data.manifest.rows[number]) => string;
    }[] = [
      { header: "CODE",     width:  40, value: (r) => r.code },
      { header: "ITEM",     width: 220, value: (r) => r.item },
      { header: "QTY",      width:  40, value: (r) => String(r.qty) },
      { header: "POSITION", width: 240, value: (r) => r.position },
      { header: "NOTES",    width: 200, value: (r) => r.notes },
    ];
    const rowH = 14;
    const headerRowH = 16;

    // Table header
    let curY = tableY;
    doc.save();
    doc.rect(MARGIN, curY, CONTENT_W, headerRowH).fill("#2a2a2a");
    doc.restore();

    let curX = MARGIN;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
    for (const col of columns) {
      doc.text(col.header, curX + 4, curY + 4, { width: col.width - 8 });
      curX += col.width;
    }
    curY += headerRowH;

    // Table rows
    doc.font("Helvetica").fontSize(7).fillColor("#1a1a1a");
    let rowIdx = 0;
    for (const row of data.manifest.rows) {
      // Alternating row shading
      if (rowIdx % 2 === 0) {
        doc.save();
        doc.rect(MARGIN, curY, CONTENT_W, rowH).fill("#f9f9f7");
        doc.restore();
      }

      curX = MARGIN;
      doc.fillColor("#1a1a1a");
      // First (CODE) column rendered bold; remainder regular weight.
      columns.forEach((col, i) => {
        doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica");
        doc.text(col.value(row), curX + 4, curY + 3, { width: col.width - 8 });
        curX += col.width;
      });
      curY += rowH;
      rowIdx++;

      // Page overflow guard
      if (curY > A4_LANDSCAPE_H - 60) break;
    }

    // Totals row
    curY += 2;
    doc.save();
    doc.rect(MARGIN, curY, CONTENT_W, rowH + 2).fill("#2a2a2a");
    doc.restore();

    const totalParts: string[] = [];
    for (const entry of data.manifest.totals.entries) {
      totalParts.push(`${String(entry.qty)}× ${entry.item}`);
    }
    if (data.manifest.totals.totalChairs > 0) {
      totalParts.push(`${String(data.manifest.totals.totalChairs)}× chairs`);
    }

    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
    doc.text("TOTALS", MARGIN + 4, curY + 4, { width: 40 });
    doc.text(totalParts.join(", "), MARGIN + 44, curY + 4, { width: CONTENT_W - 48 });

    // =====================================================================
    // ZONE 4 — FOOTER STRIP
    // =====================================================================
    const footerY = A4_LANDSCAPE_H - 32;

    doc.moveTo(MARGIN, footerY - 4).lineTo(A4_LANDSCAPE_W - MARGIN, footerY - 4)
      .strokeColor("#e0ddd5").lineWidth(0.5).stroke();

    // Left — fire safety placeholder
    doc.font("Helvetica").fontSize(6.5).fillColor("#888888");
    doc.text(
      `Room: ${data.space.name} (${String(data.space.widthM)}m × ${String(data.space.lengthM)}m × ${String(data.space.heightM)}m)`,
      MARGIN, footerY,
    );

    // Centre — QR code (pre-rendered as PNG buffer)
    const qrSize = 56; // ~2cm at 72dpi
    const qrX = centerX - qrSize / 2;
    const qrY = footerY - 12;
    if (qrBuffer !== null) {
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      doc.font("Helvetica").fontSize(5.5).fillColor("#bbbbbb");
      doc.text("Scan for web view", qrX - 20, qrY + qrSize + 2, { width: qrSize + 40, align: "center" });
    } else {
      doc.font("Helvetica").fontSize(6.5).fillColor("#aaaaaa");
      doc.text(`Web view: ${data.webViewUrl}`, centerX - 120, footerY, { width: 240, align: "center" });
    }

    // Right — generation info
    doc.font("Helvetica").fontSize(6).fillColor("#bbbbbb");
    const timestamp = new Date(data.generatedAt).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.text(`Generated by OMNITWIN | ${timestamp}`, rightX - 40, footerY, {
      width: 200, align: "right",
    });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert layout style slug to human-readable label. */
function formatLayoutStyle(style: string): string {
  return style
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
