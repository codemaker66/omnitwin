import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { actionLogRoutes } from "../routes/action-log.js";
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
// Release audit people-privacy-1 and -3: a client's own layout is dated by
// the bookings made from its enquiry, and the action log never keeps a note,
// whether it arrives through the log's write route or was stored before it.
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
  let server: FastifyInstance;

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
    server = Fastify();
    await server.register(actionLogRoutes, { db, prefix: "/configurations/:configId/actions" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  /** A layout with the note, an event sheet copying it, and optionally
   *  dated events and a legacy public PDF address (from before PR #130). */
  async function layout(options: { events?: readonly Date[]; updatedAt?: Date; pdf?: boolean; ownerId?: string } = {}) {
    const configId = randomUUID();
    const updatedAt = options.updatedAt ?? daysBefore(5);
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId, userId: options.ownerId ?? null, name: "Wedding layout", layoutStyle: "dinner-rounds",
      metadata: metadataWith(NOTE), updatedAt,
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

  async function person(role: string, personVenueId: string | null = null): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, email: `${id}@example.test`, name: `TEST ONLY ${role}`, role, venueId: personVenueId });
    return id;
  }

  interface BookingFixture {
    readonly endsAt: Date;
    readonly kind?: "hold" | "ink";
    readonly status?: "active" | "released";
    readonly deleted?: boolean;
  }

  /** A client's own layout, filed with an enquiry first asked for a date
   *  long gone, and the bookings made from that enquiry, each bound to its
   *  event as the Diary binds them. No event link: the events route refuses
   *  to link a client's layout (CONFIGURATION_OWNER_IS_CUSTOMER). */
  async function clientLayout(bookings: readonly BookingFixture[]) {
    const f = await layout({ ownerId: await person("client") });
    const [enquiry] = await db.insert(schema.enquiries).values({
      venueId, spaceId, configurationId: f.configId, name: "TEST ONLY", email: "test-only@example.test",
      preferredDate: daysBefore(200).toISOString().slice(0, 10),
    }).returning({ id: schema.enquiries.id });
    if (enquiry === undefined) throw new Error("enquiry fixture missing");
    for (const booking of bookings) {
      const eventId = randomUUID();
      const startsAt = new Date(booking.endsAt.getTime() - 5 * 3600_000);
      await db.insert(schema.events).values({ id: eventId, venueId, name: "TEST ONLY dinner", startsAt, endsAt: booking.endsAt });
      await db.insert(schema.bookings).values({
        venueId, spaceId, eventId, enquiryId: enquiry.id, kind: booking.kind ?? "hold", status: booking.status ?? "active",
        title: "TEST ONLY booking", startsAt, endsAt: booking.endsAt, deletedAt: booking.deleted === true ? daysBefore(1) : null,
      });
    }
    return f;
  }

  it(`removes a client layout's note ${String(DIETARY_NOTE_DAYS_AFTER_EVENT)} days after the booking made from its enquiry, not before`, async () => {
    const lapsed = await clientLayout([{ endsAt: daysBefore(DIETARY_NOTE_DAYS_AFTER_EVENT + 1) }]);
    const recent = await clientLayout([{ endsAt: daysBefore(DIETARY_NOTE_DAYS_AFTER_EVENT - 1) }]);
    // The latest live booking decides: a confirmed dinner long past, and a
    // later hold since released, is a dinner long past.
    const inkThenReleased = await clientLayout([
      { endsAt: daysBefore(40), kind: "ink" },
      { endsAt: daysBefore(10), status: "released" },
    ]);
    const rehearsal = await removeLapsedDietaryNotes(db, { now: NOW, dryRun: true });
    expect(rehearsal.layouts).toBeGreaterThanOrEqual(2);
    expect((await stored(lapsed)).config.metadata).toEqual(metadataWith(NOTE));

    await removeLapsedDietaryNotes(db, { now: NOW });
    for (const f of [lapsed, inkThenReleased]) {
      const { config, sheet } = await stored(f);
      expect(config.metadata).toEqual(metadataWith(""));
      expect(sheet.payload).toEqual(metadataWith(""));
    }
    const kept = await stored(recent);
    expect(kept.config.metadata).toEqual(metadataWith(NOTE));
    expect(kept.sheet.payload).toEqual(metadataWith(NOTE));
  });

  it("never dates a client layout by a released or deleted booking", async () => {
    // Neither became the event, so the layout has no dated event and keeps
    // the note for the 24 months after it last changed.
    const released = await clientLayout([{ endsAt: daysBefore(60), status: "released" }]);
    const deleted = await clientLayout([{ endsAt: daysBefore(60), deleted: true }]);
    await removeLapsedDietaryNotes(db, { now: NOW });
    for (const f of [released, deleted]) {
      expect((await stored(f)).config.metadata).toEqual(metadataWith(NOTE));
    }
  });

  it("keeps a linked layout's note while its event's live booking is still recent", async () => {
    // An event whose own dates lag a move: the booking says when it is.
    const f = await layout({ events: [daysBefore(200)] });
    const [link] = await db.select({ eventId: schema.eventConfigurationLinks.eventId }).from(schema.eventConfigurationLinks)
      .where(eq(schema.eventConfigurationLinks.configurationId, f.configId));
    if (link === undefined) throw new Error("link fixture missing");
    const endsAt = daysBefore(DIETARY_NOTE_DAYS_AFTER_EVENT - 5);
    await db.insert(schema.bookings).values({
      venueId, spaceId, eventId: link.eventId, kind: "hold", title: "TEST ONLY moved hold",
      startsAt: new Date(endsAt.getTime() - 5 * 3600_000), endsAt,
    });
    await removeLapsedDietaryNotes(db, { now: NOW });
    expect((await stored(f)).config.metadata).toEqual(metadataWith(NOTE));
  });

  function authorization(user: { id: string; role: string; venueId: string | null }): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ ...user, email: `${user.id}@example.test` })}` };
  }

  function detailsAction(note: string, before: string): Record<string, unknown> {
    return {
      id: randomUUID(), actor: { kind: "operator", ref: "test-only" }, intent: "event.details.update",
      payload: metadataWith(note), inverse: metadataWith(before), provenance: { surface: "planner" }, ts: "2031-02-27T10:00:00.000Z",
    };
  }

  it("stores no allergy note through the log's write route, and the nightly pass blanks any stored before", async () => {
    const ownerId = await person("client");
    const staffId = await person("staff", venueId);
    // Inside its retention period: the layout keeps its note, its log never does.
    const f = await layout({ ownerId });
    const owner = { id: ownerId, role: "client", venueId: null };
    const staff = { id: staffId, role: "staff", venueId };

    const saved = detailsAction("SECRET-NEW coeliac, seat 12", "SECRET-OLD shellfish");
    const placed: Record<string, unknown> = { ...detailsAction("", ""), intent: "object.place", payload: { label: "Round table" }, inverse: null };
    const post = await server.inject({
      method: "POST", url: `/configurations/${f.configId}/actions`, headers: authorization(owner),
      payload: { batchId: randomUUID(), revision: 1, actions: [saved, placed] },
    });
    expect(post.statusCode).toBe(200);
    const redacted = { instructions: { dietary: { vegetarian: 12, vegan: 0, glutenFree: 3, nutFree: 0, halal: 0, kosher: 0, otherAllergies: "", otherAllergiesRedacted: true }, accessNotes: "Side door" } };
    const [ingested] = await db.select().from(schema.actionLog).where(eq(schema.actionLog.id, String(saved["id"])));
    expect(ingested?.payload).toEqual(redacted);
    expect(ingested?.inverse).toEqual(redacted);
    const [untouched] = await db.select().from(schema.actionLog).where(eq(schema.actionLog.id, String(placed["id"])));
    expect(untouched?.payload).toEqual({ label: "Round table" });
    expect(untouched?.inverse).toBeNull();

    // Rows stored before the route redacted: the note in a payload with no
    // inverse, and in an inverse alone.
    const legacy = [randomUUID(), randomUUID()];
    const legacyRow = (id: string, payload: unknown, inverse: unknown) => ({
      id, configurationId: f.configId, batchId: randomUUID(), revision: 1, submittedBy: ownerId,
      actor: { kind: "operator", ref: "test-only" }, intent: "event.details.update", payload, inverse,
      provenance: { surface: "planner" }, recordedTs: daysBefore(3),
    });
    await db.insert(schema.actionLog).values([
      legacyRow(legacy[0] ?? "", metadataWith("SECRET-LEGACY sesame"), null),
      legacyRow(legacy[1] ?? "", metadataWith(""), metadataWith("SECRET-LEGACY nuts")),
    ]);
    const before = await db.select().from(schema.actionLog).where(inArray(schema.actionLog.id, legacy));

    const rehearsal = await removeLapsedDietaryNotes(db, { now: NOW, dryRun: true });
    expect(rehearsal.actionLog).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(schema.actionLog).where(inArray(schema.actionLog.id, legacy))).toEqual(before);

    const pass = await removeLapsedDietaryNotes(db, { now: NOW });
    expect(pass.actionLog).toBeGreaterThanOrEqual(2);
    const after = await db.select().from(schema.actionLog).where(inArray(schema.actionLog.id, legacy));
    const byId = new Map(after.map((row) => [row.id, row]));
    expect(byId.get(legacy[0] ?? "")?.payload).toEqual(redacted);
    expect(byId.get(legacy[0] ?? "")?.inverse).toBeNull();
    // A note already blank is left as it was; only the one holding text is marked.
    expect(byId.get(legacy[1] ?? "")?.payload).toEqual(metadataWith(""));
    expect(byId.get(legacy[1] ?? "")?.inverse).toEqual(redacted);
    // The row stays: same order, intent, clocks and submitter.
    for (const row of before) {
      const current = byId.get(row.id);
      expect(current && { ...current, payload: null, inverse: null }).toEqual({ ...row, payload: null, inverse: null });
    }
    // The layout's own copy is inside its period and stays.
    expect((await stored(f)).config.metadata).toEqual(metadataWith(NOTE));

    // What the change history reads, as the owner and as the venue's staff.
    for (const reader of [owner, staff]) {
      const read = await server.inject({ method: "GET", url: `/configurations/${f.configId}/actions?limit=500`, headers: authorization(reader) });
      expect(read.statusCode).toBe(200);
      expect(read.body).not.toContain("SECRET-");
      expect(read.json<{ data: { entries: unknown[] } }>().data.entries).toHaveLength(4);
    }

    // A second pass changes nothing more.
    await removeLapsedDietaryNotes(db, { now: NOW });
    expect(await db.select().from(schema.actionLog).where(inArray(schema.actionLog.id, legacy))).toEqual(after);
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
