import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYOUT_STYLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { loadRoomDay, type RoomDayDeny } from "../services/room-day.js";

// Goal 19 S6 — what a client may see of a room's day before proposing a
// time (D6, the public-discovery doctrine: never who booked). Their own
// slot by name; everything else in the room as an anonymous span, held or
// busy; the venue's turnaround for the room; nothing from other rooms, other
// days or other venues; and nothing at all without the live link.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_S6_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/venviewer_s6_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Room-day tests require the explicit disposable database venviewer_s6_test on 127.0.0.1");
  }
}
function isDeny(result: unknown): result is RoomDayDeny {
  return typeof result === "object" && result !== null && "ok" in result && (result as { readonly ok: unknown }).ok === false;
}
function granted<T>(result: T | RoomDayDeny): Exclude<T, RoomDayDeny> {
  if (isDeny(result)) throw new Error(`expected success, got ${result.code}`);
  return result as Exclude<T, RoomDayDeny>;
}
const DAY = "2030-05-10";
const at = (hhmm: string, day = DAY): Date => new Date(`${day}T${hhmm}:00.000Z`);

describe.skipIf(target === undefined)("the client's room day on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `s6_roomday_${randomUUID()}`, max: 8, options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 180_000);
  afterAll(async () => { await pool.end(); });

  async function fixture() {
    const venueId = randomUUID(), roomId = randomUUID(), otherRoomId = randomUUID(), eventId = randomUUID(), configurationId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY s6 room day", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" });
    await db.insert(schema.spaces).values([
      { id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline },
      { id: otherRoomId, venueId, name: "Saloon", slug: "saloon", widthM: "9", lengthM: "9", heightM: "3", floorPlanOutline: outline },
    ]);
    const person = (role: string, name: string, venue: string | null = venueId) => ({ id: randomUUID(), role, venueId: venue, name, platformRole: "none" as const });
    const admin = person("admin", "Isla Office"), client = person("client", "Morag Client", null), stranger = person("client", "Somebody", null), hallkeeper = person("hallkeeper", "Callum", venueId);
    for (const p of [admin, client, stranger, hallkeeper]) await db.insert(schema.users).values({ id: p.id, venueId: p.venueId, name: p.name, email: `${p.id}@s6.invalid`, role: p.role });
    await db.insert(schema.events).values({ id: eventId, venueId, name: "Fixture dinner", createdBy: admin.id, guestCount: 80 });
    await db.insert(schema.configurations).values({ id: configurationId, spaceId: roomId, venueId, userId: client.id, name: "The client plan", layoutStyle: LAYOUT_STYLES[0] });
    await db.insert(schema.eventConfigurationLinks).values({ id: randomUUID(), eventId, configurationId, linkType: "source_configuration" });
    await db.insert(schema.turnaroundRules).values({ id: randomUUID(), venueId, spaceId: roomId, eventType: null, name: "House", minutes: 90, isActive: true });
    const hygiene = { rank: 1, ownerUserId: admin.id, nextAction: "Decide", decisionAt: at("09:00", "2030-05-01"), nextActionDueAt: at("09:00", "2030-05-01") };
    const booking = (spaceId: string, kind: "ink" | "hold" | "internal_block", title: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
      ({ id: randomUUID(), venueId, spaceId, kind, status: "active" as const, title, createdBy: admin.id, startsAt: at(from), endsAt: at(to), ...extra });
    const ownHold = booking(roomId, "hold", "Fixture dinner", "18:00", "23:00", { eventId, createdBy: client.id, ...hygiene });
    // Each other hold and confirmed booking is written with its own event (the bind).
    await insertBoundBookings(db, [
      ownHold,
      booking(roomId, "ink", "Private: the MacLeod wedding", "09:00", "14:00"),
      booking(roomId, "hold", "Another family", "15:00", "17:00", hygiene),
      booking(roomId, "internal_block", "Floor polish", "07:00", "08:30"),
      booking(roomId, "ink", "Tomorrow's lunch", "12:00", "14:00", { startsAt: at("12:00", "2030-05-11"), endsAt: at("14:00", "2030-05-11") }),
      booking(otherRoomId, "ink", "Saloon drinks", "19:00", "22:00"),
    ]);
    return { venueId, roomId, otherRoomId, eventId, configurationId, admin, client, stranger, hallkeeper, ownHoldId: ownHold.id };
  }

  it("shows the client their own slot by name and every other booking in the room as an anonymous span, with the room's turnaround", async () => {
    const f = await fixture();
    const day = granted(await loadRoomDay(db, f.client, f.eventId, { spaceId: f.roomId, day: DAY }));
    expect(day.turnaroundMinutes).toBe(90);
    expect(day.timezone).toBe("Europe/London");
    const spans = [...day.spans].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(spans.map((span) => [span.kind, span.startsAt.slice(11, 16), span.endsAt.slice(11, 16)])).toEqual([
      ["busy", "07:00", "08:30"], ["busy", "09:00", "14:00"], ["held", "15:00", "17:00"], ["yours", "18:00", "23:00"],
    ]);
    const yours = spans.find((span) => span.kind === "yours");
    expect(yours).toMatchObject({ bookingId: f.ownHoldId, title: "Fixture dinner" });
    for (const span of spans.filter((item) => item.kind !== "yours")) {
      expect(Object.keys(span).sort()).toEqual(["endsAt", "kind", "startsAt"]);
    }
    expect(JSON.stringify(day)).not.toContain("MacLeod");
  });

  it("refuses the room's day to a client with no link, a hallkeeper of another venue and a room the venue does not have, and shows the office the same spans", async () => {
    const f = await fixture();
    expect(isDeny(await loadRoomDay(db, f.stranger, f.eventId, { spaceId: f.roomId, day: DAY }))).toBe(true);
    expect(isDeny(await loadRoomDay(db, { ...f.hallkeeper, venueId: randomUUID() }, f.eventId, { spaceId: f.roomId, day: DAY }))).toBe(true);
    expect(isDeny(await loadRoomDay(db, f.client, f.eventId, { spaceId: randomUUID(), day: DAY }))).toBe(true);
    const office = granted(await loadRoomDay(db, f.admin, f.eventId, { spaceId: f.roomId, day: DAY }));
    expect(office.spans).toHaveLength(4);
  });
});
