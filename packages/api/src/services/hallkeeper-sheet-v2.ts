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
  readonly venue: { readonly name: string; readonly address: string; readonly logoUrl: string | null };
  readonly space: { readonly name: string; readonly widthM: number; readonly lengthM: number; readonly heightM: number };
  readonly config: { readonly id: string; readonly name: string; readonly layoutStyle: string; readonly guestCount: number };
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
    return {
      id: obj.id,
      assetName: asset?.name ?? "Unknown",
      assetCategory: asset?.category ?? "other",
      positionX: Number(obj.positionX),
      positionY: Number(obj.positionY),
      positionZ: Number(obj.positionZ),
      rotationY: Number(obj.rotationY),
      chairCount: 0,
      groupId: (meta?.["groupId"] as string) ?? null,
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
    venue: { name: venue.name, address: venue.address, logoUrl: venue.logoUrl },
    space: {
      name: space.name,
      widthM: Number(space.widthM),
      lengthM: Number(space.lengthM),
      heightM: Number(space.heightM),
    },
    config: {
      id: config.id,
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
 * Generates a PDF buffer from assembled sheet data.
 * Uses pdfkit for server-side rendering — no browser needed.
 */
export async function generateSheetPdf(data: SheetData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  // QR code library available for future iteration (pre-render to Buffer)

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

    doc.save();
    doc.rect(MARGIN, diagramY, CONTENT_W, diagramH)
      .strokeColor("#d0d0d0").lineWidth(0.5).dash(4, { space: 4 }).stroke();
    doc.restore();

    doc.font("Helvetica").fontSize(11).fillColor("#bbbbbb");
    doc.text("Floor plan diagram", MARGIN, diagramY + diagramH / 2 - 10, {
      width: CONTENT_W,
      align: "center",
    });
    doc.fontSize(8).fillColor("#cccccc");
    doc.text("(Generated from 3D editor — attach via web view)", MARGIN, diagramY + diagramH / 2 + 6, {
      width: CONTENT_W,
      align: "center",
    });

    // Scale bar placeholder
    doc.font("Helvetica").fontSize(7).fillColor("#999999");
    doc.text("1m", MARGIN + 4, diagramY + diagramH - 18);
    doc.moveTo(MARGIN + 16, diagramY + diagramH - 12)
      .lineTo(MARGIN + 16 + 28.35, diagramY + diagramH - 12) // 1cm = 28.35pt ≈ 1m at scale
      .strokeColor("#999999").lineWidth(1).undash().stroke();

    // =====================================================================
    // ZONE 3 — MANIFEST TABLE (bottom ~30%)
    // =====================================================================
    const tableY = diagramY + diagramH + 12;
    const colWidths = [40, 220, 40, 240, 200]; // CODE, ITEM, QTY, POSITION, NOTES
    const headers = ["CODE", "ITEM", "QTY", "POSITION", "NOTES"];
    const rowH = 14;
    const headerRowH = 16;

    // Table header
    let curY = tableY;
    doc.save();
    doc.rect(MARGIN, curY, CONTENT_W, headerRowH).fill("#2a2a2a");
    doc.restore();

    let curX = MARGIN;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i]!, curX + 4, curY + 4, { width: colWidths[i]! - 8 });
      curX += colWidths[i]!;
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
      const fields = [row.code, row.item, String(row.qty), row.position, row.notes];
      doc.fillColor("#1a1a1a");
      // Code column bold
      doc.font("Helvetica-Bold");
      doc.text(fields[0]!, curX + 4, curY + 3, { width: colWidths[0]! - 8 });
      curX += colWidths[0]!;

      doc.font("Helvetica");
      for (let i = 1; i < fields.length; i++) {
        doc.text(fields[i]!, curX + 4, curY + 3, { width: colWidths[i]! - 8 });
        curX += colWidths[i]!;
      }
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

    // Centre — QR code
    // QR code is rendered in the web view — PDF shows the URL text instead.
    // pdfkit image insertion requires a file path or Buffer, not a data URL,
    // so we'd need to pre-generate the QR to a Buffer before doc creation.
    // This is handled in a future iteration with pre-generated QR buffers.

    doc.font("Helvetica").fontSize(6.5).fillColor("#aaaaaa");
    doc.text(`Web view: ${data.webViewUrl}`, centerX - 120, footerY, { width: 240, align: "center" });

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
