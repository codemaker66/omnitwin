import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import {
  DIETARY_NOTE_DAYS_AFTER_EVENT,
  DIETARY_NOTE_DAYS_WITHOUT_EVENT,
  removeLapsedDietaryNotes,
} from "../services/dietary-retention.js";

// ---------------------------------------------------------------------------
// Retention for guests' allergy notes (fix-first item 18), on Goal 12's
// migrated disposable cluster: the JSON paths, the event anchor and the
// one-pass redaction of layouts and sheets are database behaviour a mock cannot
// prove. The cluster is shared by the platform suites, so these cases assert
// on their own rows, never on totals.
//
// Never loads .env or falls back to DATABASE_URL.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Dietary retention tests require the explicit disposable platform database");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2031-03-01T12:00:00.000Z");
const NOTE = "Table 4: severe sesame allergy";

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function metadataWith(note: string): Record<string, unknown> {
  return { instructions: { dietary: { vegetarian: 12, vegan: 0, glutenFree: 3, nutFree: 0, halal: 0, kosher: 0, otherAllergies: note }, accessNotes: "Side door" } };
}

describe.skipIf(target === undefined)("dietary note retention on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: string;
  let spaceId: string;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `dietary_retention_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    venueId = randomUUID();
    spaceId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY retention", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "10", lengthM: "21", heightM: "8",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 21 }, { x: 0, y: 21 }] });
  });
  afterAll(async () => { await pool?.end(); });

  /** A layout with the note, an event sheet copying it, and optionally
   *  dated events and a legacy public PDF address (from before PR #130). */
  async function layout(options: { events?: readonly Date[]; updatedAt?: Date; pdf?: boolean } = {}) {
    const configId = randomUUID();
    const updatedAt = options.updatedAt ?? daysBefore(5);
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId, name: "Wedding layout", layoutStyle: "dinner-rounds", metadata: metadataWith(NOTE), updatedAt,
    });
    for (const endsAt of options.events ?? []) {
      const eventId = randomUUID();
      await db.insert(schema.events).values({ id: eventId, venueId, name: "Wedding", startsAt: new Date(endsAt.getTime() - 6 * 3600_000), endsAt });
      await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: configId, linkType: "source_configuration" });
    }
    const sheetId = randomUUID();
    await db.insert(schema.configurationSheetSnapshots).values({
      id: sheetId, configurationId: configId, version: 1, payload: metadataWith(NOTE), sourceHash: "a".repeat(64),
      pdfUrl: options.pdf === true ? `https://files.example.test/sheets/${configId}/v1-${"a".repeat(64)}.pdf` : null,
    });
    return { configId, sheetId, updatedAt };
  }

  async function stored(f: { configId: string; sheetId: string }) {
    const [config] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, f.configId));
    const [sheet] = await db.select().from(schema.configurationSheetSnapshots).where(eq(schema.configurationSheetSnapshots.id, f.sheetId));
    if (config === undefined || sheet === undefined) throw new Error("fixture rows missing");
    return { config, sheet };
  }

  it(`removes the note from the layout and its sheets ${String(DIETARY_NOTE_DAYS_AFTER_EVENT)} days after the event, and keeps the counts`, async () => {
    const f = await layout({ events: [daysBefore(DIETARY_NOTE_DAYS_AFTER_EVENT + 1)] });
    const result = await removeLapsedDietaryNotes(db, { now: NOW });
    expect(result.layouts).toBeGreaterThanOrEqual(1);
    const { config, sheet } = await stored(f);
    expect(config.metadata).toEqual(metadataWith(""));
    expect(sheet.payload).toEqual(metadataWith(""));
    // Nobody edited the layout: its updated time stands.
    expect(config.updatedAt.getTime()).toBe(f.updatedAt.getTime());
  });

  it("keeps the note while the event is recent, or while any linked event is still ahead", async () => {
    const recent = await layout({ events: [daysBefore(DIETARY_NOTE_DAYS_AFTER_EVENT - 1)] });
    const rebooked = await layout({ events: [daysBefore(200), new Date(NOW.getTime() + 20 * DAY_MS)] });
    await removeLapsedDietaryNotes(db, { now: NOW });
    for (const f of [recent, rebooked]) {
      const { config, sheet } = await stored(f);
      expect(config.metadata).toEqual(metadataWith(NOTE));
      expect(sheet.payload).toEqual(metadataWith(NOTE));
    }
  });

  it(`removes the note from a layout with no event ${String(DIETARY_NOTE_DAYS_WITHOUT_EVENT)} days after it last changed, not before`, async () => {
    const old = await layout({ updatedAt: daysBefore(DIETARY_NOTE_DAYS_WITHOUT_EVENT + 1) });
    const current = await layout({ updatedAt: daysBefore(30) });
    await removeLapsedDietaryNotes(db, { now: NOW });
    expect((await stored(old)).config.metadata).toEqual(metadataWith(""));
    expect((await stored(current)).config.metadata).toEqual(metadataWith(NOTE));
  });

  it("clears a legacy sheet's copy and its old public PDF address in one pass", async () => {
    // Sheets issued before PR #130 named a pre-rendered public PDF. Sheets are
    // no longer stored, so the pass redacts the copy and drops the address
    // together, with no storage step to wait on.
    const f = await layout({ events: [daysBefore(60)], pdf: true });
    expect((await stored(f)).sheet.pdfUrl).not.toBeNull();
    await removeLapsedDietaryNotes(db, { now: NOW });
    const { config, sheet } = await stored(f);
    expect(config.metadata).toEqual(metadataWith(""));
    expect(sheet.payload).toEqual(metadataWith(""));
    expect(sheet.pdfUrl).toBeNull();
  });

  it("keeps the note while an enquiry filed with the layout has a preferred date ahead", async () => {
    // A layout reused for next year's dinner (its last event long past), and
    // one enquired about more than two years out and not touched since.
    const reused = await layout({ events: [daysBefore(400)] });
    const farAhead = await layout({ updatedAt: daysBefore(DIETARY_NOTE_DAYS_WITHOUT_EVENT + 10) });
    const lapsed = await layout({ updatedAt: daysBefore(DIETARY_NOTE_DAYS_WITHOUT_EVENT + 10) });
    const enquiry = (configurationId: string, preferredDate: string) => ({
      venueId, spaceId, configurationId, name: "TEST ONLY", email: "test-only@example.test", preferredDate,
    });
    await db.insert(schema.enquiries).values([
      enquiry(reused.configId, "2031-09-12"),
      enquiry(farAhead.configId, "2031-03-20"),
      // A preferred date long gone keeps nothing.
      enquiry(lapsed.configId, "2029-01-01"),
    ]);
    const rehearsal = await removeLapsedDietaryNotes(db, { now: NOW, dryRun: true });
    await removeLapsedDietaryNotes(db, { now: NOW });
    for (const f of [reused, farAhead]) {
      const { config, sheet } = await stored(f);
      expect(config.metadata).toEqual(metadataWith(NOTE));
      expect(sheet.payload).toEqual(metadataWith(NOTE));
    }
    expect((await stored(lapsed)).config.metadata).toEqual(metadataWith(""));
    expect(rehearsal.layouts).toBeGreaterThanOrEqual(1);
  });

  it("changes nothing on a dry run, and nothing more on a second pass", async () => {
    const f = await layout({ events: [daysBefore(90)] });
    const rehearsal = await removeLapsedDietaryNotes(db, { now: NOW, dryRun: true });
    expect(rehearsal.dryRun).toBe(true);
    expect(rehearsal.layouts).toBeGreaterThanOrEqual(1);
    expect((await stored(f)).config.metadata).toEqual(metadataWith(NOTE));

    await removeLapsedDietaryNotes(db, { now: NOW });
    const after = await stored(f);
    await removeLapsedDietaryNotes(db, { now: NOW });
    const again = await stored(f);
    expect(again.config.metadata).toEqual(metadataWith(""));
    expect(again.sheet).toEqual(after.sheet);
  });
});
