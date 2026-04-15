import { eq, and, isNull, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  enquiries, venues, spaces, configurations, placedObjects,
  assetDefinitions, enquiryStatusHistory, users, referenceLoadouts,
} from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet v1 — enquiry-centric operational document
//
// NOTE: This is the LEGACY sheet shape (tied to an enquiry, not a config).
// The live runtime uses hallkeeper-sheet-v2.ts with the config-centric
// EnquirySheetData type exported from @omnitwin/types. This interface
// is named EnquirySheetData to avoid collision with the shared type.
// ---------------------------------------------------------------------------

export interface EnquirySheetData {
  readonly venue: { readonly name: string; readonly address: string };
  readonly space: { readonly name: string; readonly widthM: string; readonly lengthM: string; readonly heightM: string };
  readonly event: {
    readonly name: string;
    readonly type: string | null;
    readonly date: string | null;
    readonly guestCount: number | null;
    readonly contactName: string;
    readonly contactEmail: string;
    readonly message: string | null;
  };
  readonly configuration: { readonly name: string } | null;
  readonly equipment: readonly { readonly category: string; readonly name: string; readonly quantity: number }[];
  readonly referenceLoadouts: readonly { readonly name: string; readonly photoCount: number }[];
  readonly statusHistory: readonly { readonly from: string; readonly to: string; readonly at: string; readonly by: string }[];
  readonly generatedAt: string;
}

/**
 * Gathers all data needed for a hallkeeper sheet from the database.
 */
export async function generateHallkeeperSheet(
  db: Database,
  enquiryId: string,
): Promise<EnquirySheetData | null> {
  // Fetch enquiry
  const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
  if (enquiry === undefined) return null;

  // Fetch venue
  const [venue] = await db.select().from(venues).where(eq(venues.id, enquiry.venueId)).limit(1);
  if (venue === undefined) return null;

  // Fetch space
  const [space] = await db.select().from(spaces).where(eq(spaces.id, enquiry.spaceId)).limit(1);
  if (space === undefined) return null;

  // Fetch configuration + placed objects
  let configData: { name: string } | null = null;
  const equipmentMap = new Map<string, { category: string; name: string; count: number }>();

  if (enquiry.configurationId !== null) {
    const [config] = await db.select().from(configurations)
      .where(eq(configurations.id, enquiry.configurationId)).limit(1);

    if (config !== undefined) {
      configData = { name: config.name };

      // Single JOIN query replaces N+1 per-object asset fetches
      const objects = await db.select({
        assetName: assetDefinitions.name,
        assetCategory: assetDefinitions.category,
      }).from(placedObjects)
        .innerJoin(assetDefinitions, eq(placedObjects.assetDefinitionId, assetDefinitions.id))
        .where(eq(placedObjects.configurationId, config.id));

      for (const obj of objects) {
        const key = obj.assetName;
        const existing = equipmentMap.get(key);
        if (existing !== undefined) {
          existing.count++;
        } else {
          equipmentMap.set(key, { category: obj.assetCategory, name: obj.assetName, count: 1 });
        }
      }
    }
  }

  // Fetch status history
  const history = await db.select({
    fromStatus: enquiryStatusHistory.fromStatus,
    toStatus: enquiryStatusHistory.toStatus,
    createdAt: enquiryStatusHistory.createdAt,
    changedBy: enquiryStatusHistory.changedBy,
  }).from(enquiryStatusHistory)
    .where(eq(enquiryStatusHistory.enquiryId, enquiryId))
    .orderBy(enquiryStatusHistory.createdAt);

  // Batch-fetch all user names for history entries (replaces N+1 per-entry fetch)
  const changedByIds = [...new Set(history.map((h) => h.changedBy).filter((id): id is string => id !== null))];
  const userNameMap = new Map<string, string>();
  if (changedByIds.length > 0) {
    const userRows = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, changedByIds));
    for (const u of userRows) {
      userNameMap.set(u.id, u.name);
    }
  }

  const historyWithNames = history.map((h) => ({
    from: h.fromStatus,
    to: h.toStatus,
    at: h.createdAt.toISOString(),
    by: h.changedBy !== null ? (userNameMap.get(h.changedBy) ?? "Unknown") : "Guest",
  }));

  const equipment = Array.from(equipmentMap.values()).map((e) => ({
    category: e.category,
    name: e.name,
    quantity: e.count,
  }));

  // Fetch reference loadouts for this space
  const loadouts = await db.select({
    name: referenceLoadouts.name,
    photoCount: sql<number>`(SELECT count(*)::int FROM reference_photos WHERE loadout_id = ${referenceLoadouts.id})`,
  })
    .from(referenceLoadouts)
    .where(and(
      eq(referenceLoadouts.spaceId, enquiry.spaceId),
      isNull(referenceLoadouts.deletedAt),
    ));

  return {
    venue: { name: venue.name, address: venue.address },
    space: { name: space.name, widthM: space.widthM, lengthM: space.lengthM, heightM: space.heightM },
    event: {
      name: enquiry.name,
      type: enquiry.eventType,
      date: enquiry.preferredDate,
      guestCount: enquiry.estimatedGuests,
      contactName: enquiry.name,
      contactEmail: enquiry.email,
      message: enquiry.message,
    },
    configuration: configData,
    equipment,
    referenceLoadouts: loadouts,
    statusHistory: historyWithNames,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a PDF buffer from hallkeeper sheet data.
 * Uses pdfkit — imported dynamically to avoid loading in tests.
 */
export async function generateHallkeeperPdf(data: EnquirySheetData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);

    // --- Header ---
    doc.fontSize(20).text(data.venue.name, { align: "center" });
    doc.fontSize(10).text(data.venue.address, { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text("Hallkeeper Sheet", { align: "center" });
    doc.moveDown(2);

    // --- Event Details ---
    doc.fontSize(12).text("Event Details", { underline: true });
    doc.fontSize(10);
    doc.text(`Event: ${data.event.name}`);
    if (data.event.type !== null) doc.text(`Type: ${data.event.type}`);
    if (data.event.date !== null) doc.text(`Date: ${data.event.date}`);
    if (data.event.guestCount !== null) doc.text(`Guests: ${String(data.event.guestCount)}`);
    doc.text(`Contact: ${data.event.contactName} (${data.event.contactEmail})`);
    if (data.event.message !== null) doc.text(`Notes: ${data.event.message}`);
    doc.moveDown();

    // --- Room Setup ---
    doc.fontSize(12).text("Room Setup", { underline: true });
    doc.fontSize(10);
    doc.text(`Space: ${data.space.name} (${data.space.widthM}m × ${data.space.lengthM}m × ${data.space.heightM}m)`);
    if (data.configuration !== null) doc.text(`Configuration: ${data.configuration.name}`);
    doc.moveDown(0.5);

    if (data.equipment.length > 0) {
      // Group by category
      const grouped = new Map<string, { name: string; quantity: number }[]>();
      for (const item of data.equipment) {
        const list = grouped.get(item.category) ?? [];
        list.push({ name: item.name, quantity: item.quantity });
        grouped.set(item.category, list);
      }
      for (const [category, items] of grouped) {
        doc.fontSize(10).text(`  ${category}:`, { continued: false });
        for (const item of items) {
          doc.text(`    ${String(item.quantity)}× ${item.name}`);
        }
      }
    } else {
      doc.text("  No equipment specified");
    }
    doc.moveDown();

    // --- Reference Loadouts ---
    if (data.referenceLoadouts.length > 0) {
      doc.fontSize(12).text("Reference Loadouts", { underline: true });
      doc.fontSize(10);
      for (const loadout of data.referenceLoadouts) {
        doc.text(`  ${loadout.name} (${String(loadout.photoCount)} photo${loadout.photoCount === 1 ? "" : "s"})`);
      }
      doc.moveDown();
    }

    // --- Status History ---
    if (data.statusHistory.length > 0) {
      doc.fontSize(12).text("Status History", { underline: true });
      doc.fontSize(10);
      for (const entry of data.statusHistory) {
        doc.text(`  ${entry.from} → ${entry.to} — ${entry.by} (${entry.at})`);
      }
      doc.moveDown();
    }

    // --- Footer ---
    doc.moveDown(2);
    doc.fontSize(8).text(`Generated: ${data.generatedAt}`, { align: "right" });

    doc.end();
  });
}
