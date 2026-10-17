import { and, eq, inArray, isNull } from "drizzle-orm";
import { assetDisplayName, VISITOR_PLAN_PROVENANCE, type HallkeeperFloorPlan } from "@omnitwin/types";
import { assetDefinitions, configurations, placedObjects, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { buildHallkeeperFloorPlan, type FloorPlanAsset } from "./hallkeeper-floor-plan.js";
import { renderHallkeeperFloorPlan } from "./hallkeeper-floor-plan-pdf.js";

// ---------------------------------------------------------------------------
// A visitor's plan as a PDF (fix-first item 11, 16 Oct 2026 brief).
//
// An organiser who has no account draws a layout in the public planner and
// needs to show it to someone: a partner, a boss, a parent. This renders that
// layout to one A4 page they can send however they like.
//
// What it carries, and what it deliberately does not:
//   * the room, the venue, the vector plan with a measured scale bar, and a
//     count of what is placed, by the name the planner shows (a maker's
//     model reference such as "Burgess Turini 18/3" reads as the planner's
//     plain name; assetDisplayName in @omnitwin/types);
//   * the line "Drawn by a visitor; not reviewed by the venue." and when the
//     plan last changed, so nobody mistakes it for the venue's own drawing;
//   * NO prices, NO capacity verdicts and NO configuration id, short code or
//     planner URL. The planner's address is the edit capability of an
//     anonymous plan (public-configs.ts), so a page meant for someone else
//     must never carry it.
//
// The reader is shown a way forward instead of a price: the venue's events
// team confirms prices, availability and what the room can hold.
// ---------------------------------------------------------------------------

/** The provenance line every visitor plan carries, in the venue's words. The
 *  view-only page shows the same line, so it lives with that contract. */
export { VISITOR_PLAN_PROVENANCE };

/** The planner's default name for a guest plan; it says nothing to a reader. */
const DEFAULT_PLAN_NAME = "Untitled Layout";

export interface VisitorPlan {
  readonly venueName: string;
  readonly venueAddress: string;
  readonly timezone: string;
  readonly roomName: string;
  /** The plan's own name, or null when it still carries the planner default. */
  readonly planName: string | null;
  readonly lastChangedAt: Date;
  readonly floorPlan: HallkeeperFloorPlan;
}

export interface VisitorPlanItem {
  readonly name: string;
  readonly category: string;
  readonly count: number;
}

/**
 * Load an anonymous public-preview plan for its PDF.
 *
 * The read rule is exactly the anonymous GET's: a live public-preview
 * configuration. A claimed (private) plan, a deleted one, or one whose room
 * or venue has gone answers null, which the route turns into a 404 that
 * reveals nothing about which of those it was. The room must belong to the
 * configuration's own venue.
 */
export async function loadVisitorPlan(db: Database, configId: string): Promise<VisitorPlan | null> {
  const [config] = await db.select({
    name: configurations.name,
    spaceId: configurations.spaceId,
    venueId: configurations.venueId,
    updatedAt: configurations.updatedAt,
  })
    .from(configurations)
    .where(and(
      eq(configurations.id, configId),
      eq(configurations.isPublicPreview, true),
      isNull(configurations.deletedAt),
    ))
    .limit(1);
  if (config === undefined) return null;

  const [space] = await db.select({ name: spaces.name, floorPlanOutline: spaces.floorPlanOutline })
    .from(spaces)
    .where(and(
      eq(spaces.id, config.spaceId),
      eq(spaces.venueId, config.venueId),
      isNull(spaces.deletedAt),
    ))
    .limit(1);
  const [venue] = await db.select({ name: venues.name, address: venues.address, timezone: venues.timezone })
    .from(venues)
    .where(and(eq(venues.id, config.venueId), isNull(venues.deletedAt)))
    .limit(1);
  if (space === undefined || venue === undefined) return null;

  const objects = await db.select({
    id: placedObjects.id,
    assetDefinitionId: placedObjects.assetDefinitionId,
    positionX: placedObjects.positionX,
    positionZ: placedObjects.positionZ,
    rotationY: placedObjects.rotationY,
    scale: placedObjects.scale,
  })
    .from(placedObjects)
    .where(eq(placedObjects.configurationId, configId));

  const assetIds = [...new Set(objects.map((object) => object.assetDefinitionId))];
  const assets = new Map<string, FloorPlanAsset>();
  if (assetIds.length > 0) {
    const rows = await db.select({
      id: assetDefinitions.id,
      name: assetDefinitions.name,
      category: assetDefinitions.category,
      widthM: assetDefinitions.widthM,
      depthM: assetDefinitions.depthM,
      collisionType: assetDefinitions.collisionType,
    })
      .from(assetDefinitions)
      .where(inArray(assetDefinitions.id, assetIds));
    // A reader sees what the organiser saw in the planner, not the stock
    // identity the venue's inventory and hallkeeper sheet keep.
    for (const row of rows) assets.set(row.id, { ...row, name: assetDisplayName(row.id, row.name) });
  }

  const trimmedName = config.name.trim();
  return {
    venueName: venue.name,
    venueAddress: venue.address,
    timezone: venue.timezone,
    roomName: space.name,
    planName: trimmedName === "" || trimmedName === DEFAULT_PLAN_NAME || trimmedName === space.name ? null : trimmedName,
    lastChangedAt: config.updatedAt,
    floorPlan: buildHallkeeperFloorPlan(space.floorPlanOutline, objects, assets),
  };
}

const CATEGORY_ORDER = ["table", "chair", "stage", "lectern", "barrier", "decor", "av", "lighting", "other"];

/** What is on the plan, counted by catalogue name: tables first, then chairs. */
export function summariseVisitorPlanItems(plan: HallkeeperFloorPlan): readonly VisitorPlanItem[] {
  const byName = new Map<string, { category: string; count: number }>();
  for (const object of plan.objects) {
    const entry = byName.get(object.name);
    if (entry === undefined) byName.set(object.name, { category: object.category, count: 1 });
    else entry.count += 1;
  }
  const rank = (category: string): number => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...byName.entries()]
    .map(([name, entry]) => ({ name, category: entry.category, count: entry.count }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name, "en-GB"));
}

/** "17 October 2026, 14:02" in the venue's own clock. */
export function formatVisitorPlanTime(at: Date, timeZone: string): string {
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
  };
  try {
    return format(timeZone);
  } catch {
    // An unknown zone name must not hide when the plan changed; say which clock.
    return `${format("UTC")} UTC`;
  }
}

/** A plain filename a phone's share sheet shows as it is: "Grand Hall plan.pdf". */
export function visitorPlanFilename(roomName: string): string {
  const safe = roomName.replace(/[^A-Za-z0-9 -]/gu, "").replace(/\s+/gu, " ").trim();
  return `${safe === "" ? "Room" : safe} plan.pdf`;
}

// House register on white paper (packages/web/src/styles/house-tokens.css):
// forest is the ink, forest-soft the secondary text, copper-ink the small
// label colour and rule the hairline. All read on a mono laser printer.
const FOREST = "#1B3A2F";
const FOREST_SOFT = "#4C6055";
const COPPER_INK = "#7E4620";
const RULE = "#BFC4B2";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const CONTENT_W = A4_W - MARGIN * 2;
const FOOTER_TOP = A4_H - MARGIN - 44;
const ROW_H = 17;

function planBoxHeight(plan: HallkeeperFloorPlan): number {
  const xs = plan.outline.map((point) => point.x);
  const zs = plan.outline.map((point) => point.z);
  const aspect = (Math.max(...zs) - Math.min(...zs)) / (Math.max(...xs) - Math.min(...xs));
  // The drawing insets 16 pt either side and 52 pt top and bottom combined.
  return Math.min(400, Math.max(230, (CONTENT_W - 32) * aspect + 52));
}

function label(doc: PDFKit.PDFDocument, text: string, y: number): void {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COPPER_INK)
    .text(text.toUpperCase(), MARGIN, y, { width: CONTENT_W, height: 11, ellipsis: true, characterSpacing: 1.1 });
}

/** Render the visitor plan to a one-page A4 PDF (more pages only for long lists). */
export async function generateVisitorPlanPdf(plan: VisitorPlan): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: [A4_W, A4_H],
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: `${plan.roomName} plan`,
        Subject: `${plan.roomName}, ${plan.venueName}. ${VISITOR_PLAN_PROVENANCE}`,
        Creator: "Venviewer",
      },
    });
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);

    try {
      // A forest band marks the top edge, as on the venue's own papers.
      doc.rect(0, 0, A4_W, 6).fill(FOREST);

      label(doc, plan.venueName, MARGIN);
      doc.font("Times-Roman").fontSize(30).fillColor(FOREST)
        .text(plan.roomName, MARGIN, MARGIN + 14, { width: CONTENT_W, height: 72, ellipsis: true });
      let y = doc.y + 2;
      if (plan.planName !== null) {
        doc.font("Times-Italic").fontSize(14).fillColor(FOREST_SOFT)
          .text(plan.planName, MARGIN, y, { width: CONTENT_W, height: 36, ellipsis: true });
        y = doc.y + 2;
      }

      // Provenance before anything else: who drew it, and when it last changed.
      y += 10;
      const provenanceH = 44;
      doc.rect(MARGIN, y, CONTENT_W, provenanceH).lineWidth(0.6).strokeColor(RULE).stroke();
      doc.rect(MARGIN, y, 3, provenanceH).fill(FOREST);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(FOREST)
        .text(VISITOR_PLAN_PROVENANCE, MARGIN + 14, y + 9, { width: CONTENT_W - 24, lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor(FOREST_SOFT)
        .text(`Last changed ${formatVisitorPlanTime(plan.lastChangedAt, plan.timezone)}.`, MARGIN + 14, y + 26, { width: CONTENT_W - 24, lineBreak: false });
      y += provenanceH + 16;

      const boxH = planBoxHeight(plan.floorPlan);
      renderHallkeeperFloorPlan(doc, plan.floorPlan, { x: MARGIN, y, width: CONTENT_W, height: boxH }, {
        heading: "PLAN · DRAWN TO SCALE FROM CATALOGUE SIZES",
      });
      y += boxH + 22;

      const items = summariseVisitorPlanItems(plan.floorPlan);
      label(doc, "On the plan", y);
      y += 16;
      if (items.length === 0) {
        doc.font("Helvetica").fontSize(10).fillColor(FOREST_SOFT)
          .text("No furniture placed yet.", MARGIN, y, { width: CONTENT_W, lineBreak: false });
      }
      // Two columns, read down then across; a long list continues overleaf.
      const columnW = (CONTENT_W - 24) / 2;
      let column = 0;
      let columnTop = y;
      for (const item of items) {
        if (y + ROW_H > FOOTER_TOP - 8) {
          if (column === 0) {
            column = 1;
            y = columnTop;
          } else {
            doc.addPage();
            doc.rect(0, 0, A4_W, 6).fill(FOREST);
            label(doc, "On the plan, continued", MARGIN);
            column = 0;
            columnTop = MARGIN + 18;
            y = columnTop;
          }
        }
        const x = MARGIN + column * (columnW + 24);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(FOREST)
          .text(String(item.count), x, y, { width: 30, align: "right", lineBreak: false });
        doc.font("Helvetica").fontSize(10).fillColor(FOREST)
          .text(item.name, x + 40, y, { width: columnW - 40, height: 12, ellipsis: true });
        doc.moveTo(x, y + ROW_H - 4).lineTo(x + columnW, y + ROW_H - 4).lineWidth(0.4).strokeColor(RULE).stroke();
        y += ROW_H;
      }

      // Footer on every page: the way forward, and where the venue is.
      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);
        doc.moveTo(MARGIN, FOOTER_TOP).lineTo(A4_W - MARGIN, FOOTER_TOP).lineWidth(0.5).strokeColor(RULE).stroke();
        doc.font("Helvetica").fontSize(8.5).fillColor(FOREST_SOFT)
          .text(
            `Prices, availability and what the room can hold are confirmed by the ${plan.venueName} events team when an enquiry is made.`,
            MARGIN, FOOTER_TOP + 8, { width: CONTENT_W, height: 22, ellipsis: true },
          );
        const pageNote = range.count > 1 ? `   ·   Page ${String(index - range.start + 1)} of ${String(range.count)}` : "";
        doc.text(`${plan.venueName}, ${plan.venueAddress}${pageNote}`, MARGIN, FOOTER_TOP + 32, {
          width: CONTENT_W, height: 11, ellipsis: true,
        });
      }
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The visitor plan PDF could not be drawn."));
    }
  });
}
