import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConversationCommand, RecordObservation } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { executeConversationCommand } from "../services/conversation-commands.js";
import { listObservationsForVenue, recordObservationCore } from "../services/observations.js";
import type { RequestActor } from "../services/requests.js";

// Goal 19 S5 — observations are facts beside the schedule (D1, D10, D11):
// one tap is one row under its key however often it is sent; two devices'
// facts sit side by side and the list orders them by the hallkeeper's time,
// not the server's; the floor of another venue, another venue's booking and
// a time ahead of the clock are refused; the ws command rides the same
// ledger as a message; and nothing any of it does moves the booking.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Observation tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

const BOOKING_START = "2030-01-10T18:00:00.000Z";
const BOOKING_END = "2030-01-10T23:00:00.000Z";
/** A clock on the booking's evening, so a fact at 18:52 is not "in the future". */
const CLOCK_MS = Date.parse("2030-01-10T21:00:00.000Z");
const clock = (): number => CLOCK_MS;

describe.skipIf(target === undefined)("observations on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `s5_observations_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 300_000);

  afterAll(async () => { await pool.end(); });

  interface Fixture {
    readonly venueId: string;
    readonly otherVenueId: string;
    readonly roomId: string;
    readonly bookingId: string;
    readonly otherBookingId: string;
    readonly hallkeeper: RequestActor;
    readonly secondHallkeeper: RequestActor;
    readonly outsider: RequestActor;
    readonly salesAtVenue: RequestActor;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    const roomId = randomUUID();
    const otherRoomId = randomUUID();
    const bookingId = randomUUID();
    const otherBookingId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({ id, name: "TEST ONLY s5 observations", slug: id, address: "Disposable fixture" });
    }
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline,
    });
    await db.insert(schema.spaces).values({
      id: otherRoomId, venueId: otherVenueId, name: "Elsewhere", slug: "elsewhere", widthM: "9", lengthM: "9", heightM: "4", floorPlanOutline: outline,
    });
    const people = {
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      secondHallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Graham" },
      outsider: { id: randomUUID(), role: "hallkeeper", venueId: otherVenueId, name: "Someone from elsewhere" },
      salesAtVenue: { id: randomUUID(), role: "sales", venueId, name: "Priya" },
    } as const;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({
        id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@s5.invalid`, role: person.role,
      });
    }
    await db.insert(schema.bookings).values({
      id: bookingId, venueId, spaceId: roomId, kind: "ink", title: "Fixture dinner", createdBy: people.hallkeeper.id,
      startsAt: new Date(BOOKING_START), endsAt: new Date(BOOKING_END),
    });
    await db.insert(schema.bookings).values({
      id: otherBookingId, venueId: otherVenueId, spaceId: otherRoomId, kind: "ink", title: "Elsewhere's dinner", createdBy: people.outsider.id,
      startsAt: new Date(BOOKING_START), endsAt: new Date(BOOKING_END),
    });
    const actor = (person: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly name: string }): RequestActor => ({
      id: person.id, name: person.name, role: person.role, venueId: person.venueId, platformRole: "none",
    });
    return {
      venueId, otherVenueId, roomId, bookingId, otherBookingId,
      hallkeeper: actor(people.hallkeeper),
      secondHallkeeper: actor(people.secondHallkeeper),
      outsider: actor(people.outsider),
      salesAtVenue: actor(people.salesAtVenue),
    };
  }

  const tap = (bookingId: string, kind: RecordObservation["kind"], observedAt: string, idempotencyKey = randomUUID()): RecordObservation => ({
    bookingId, kind, observedAt, idempotencyKey,
  });

  const DAY = { from: "2030-01-10T04:00:00.000Z", to: "2030-01-11T04:00:00.000Z" };

  it("records one fact under its key however often the tap is sent", async () => {
    const f = await fixture();
    const press = tap(f.bookingId, "doors-open", "2030-01-10T18:52:00.000Z");
    const first = await recordObservationCore(db, f.hallkeeper, f.venueId, press, clock);
    if (!first.ok) throw new Error(first.error);
    expect(first.replay).toBe(false);
    expect(first.observation.kind).toBe("doors-open");
    expect(first.observation.spaceId).toBe(f.roomId);
    expect(first.observation.observedAt).toBe("2030-01-10T18:52:00.000Z");
    expect(first.observation.recordedAt).toBe(new Date(CLOCK_MS).toISOString());
    expect(first.observation.actorName).toBe("Elaine");

    const again = await recordObservationCore(db, f.hallkeeper, f.venueId, press, clock);
    if (!again.ok) throw new Error(again.error);
    expect(again.replay).toBe(true);
    expect(again.observation.id).toBe(first.observation.id);

    const rows = await db.select().from(schema.bookingObservations).where(eq(schema.bookingObservations.bookingId, f.bookingId));
    expect(rows).toHaveLength(1);
  });

  it("keeps two devices' facts side by side and lists them by the hallkeeper's time", async () => {
    const f = await fixture();
    // Graham's phone was online: live at 19:05, recorded at once.
    const live = await recordObservationCore(db, f.secondHallkeeper, f.venueId, tap(f.bookingId, "live", "2030-01-10T19:05:00.000Z"), clock);
    // Elaine's phone was offline: set at 17:40, replayed later than Graham's fact.
    const set = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.bookingId, "set", "2030-01-10T17:40:00.000Z"), () => CLOCK_MS + 60_000);
    if (!live.ok || !set.ok) throw new Error("expected both facts recorded");
    expect(set.replay).toBe(false);

    const listed = await listObservationsForVenue(db, f.hallkeeper, f.venueId, DAY);
    if ("ok" in listed) throw new Error(listed.error);
    expect(listed.map((fact) => fact.kind)).toEqual(["set", "live"]);
    expect(listed.map((fact) => fact.actorName)).toEqual(["Elaine", "Graham"]);
    // Nothing overwrote anything: both rows, both actors.
    const rows = await db.select().from(schema.bookingObservations).where(eq(schema.bookingObservations.bookingId, f.bookingId));
    expect(rows).toHaveLength(2);
  });

  it("refuses the floor of another venue, another venue's booking, a deleted booking and a bare sales login", async () => {
    const f = await fixture();
    const press = tap(f.bookingId, "set", "2030-01-10T17:40:00.000Z");
    const outsider = await recordObservationCore(db, f.outsider, f.venueId, press, clock);
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.status).toBe(403);

    const foreign = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.otherBookingId, "set", "2030-01-10T17:40:00.000Z"), clock);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign).toMatchObject({ status: 404, code: "BOOKING_NOT_FOUND" });

    const unknown = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(randomUUID(), "set", "2030-01-10T17:40:00.000Z"), clock);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);

    const sales = await recordObservationCore(db, f.salesAtVenue, f.venueId, press, clock);
    expect(sales.ok).toBe(false);
    if (!sales.ok) expect(sales.status).toBe(403);

    await db.update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, f.bookingId));
    const deleted = await recordObservationCore(db, f.hallkeeper, f.venueId, press, clock);
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.status).toBe(404);

    const rows = await db.select().from(schema.bookingObservations).where(eq(schema.bookingObservations.venueId, f.venueId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a fact ahead of the clock or a day away from its booking", async () => {
    const f = await fixture();
    const ahead = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.bookingId, "live", "2030-01-10T21:10:00.000Z"), clock);
    expect(ahead.ok).toBe(false);
    if (!ahead.ok) expect(ahead.code).toBe("OBSERVED_IN_FUTURE");
    // Four minutes ahead is skew, not the future.
    const skew = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.bookingId, "live", "2030-01-10T21:04:00.000Z"), clock);
    expect(skew.ok).toBe(true);

    const away = await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.bookingId, "set", "2030-01-07T17:40:00.000Z"), clock);
    expect(away.ok).toBe(false);
    if (!away.ok) expect(away.code).toBe("OBSERVED_OUTSIDE_BOOKING");
  });

  it("rides the diary_commands ledger as observation.record: one fact, replayed with the same ack", async () => {
    const f = await fixture();
    const command: ConversationCommand = {
      kind: "observation.record",
      commandId: randomUUID(),
      payload: tap(f.bookingId, "done", "2030-01-10T20:58:00.000Z"),
    };
    const first = await executeConversationCommand(db, f.hallkeeper, f.venueId, command, clock);
    expect(first.ack.outcome).toBe("applied");
    expect(first.ack.replay).toBe(false);
    expect(first.ack.status).toBe(201);
    expect(first.ack.observation?.kind).toBe("done");
    expect(first.changed?.kind).toBe("observation.recorded");

    const again = await executeConversationCommand(db, f.hallkeeper, f.venueId, command, clock);
    expect(again.ack.outcome).toBe("applied");
    expect(again.ack.replay).toBe(true);
    expect(again.ack.observation?.id).toBe(first.ack.observation?.id);
    expect(again.changed).toBeNull();

    const ledger = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, command.commandId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("observation.record");
    expect(ledger[0]?.bookingId).toBe(f.bookingId);
    expect(ledger[0]?.userId).toBe(f.hallkeeper.id);

    // An outsider replaying the commandId learns nothing.
    const stranger = await executeConversationCommand(db, f.outsider, f.otherVenueId, command, clock);
    expect(stranger.ack.outcome).toBe("rejected");
    expect(stranger.ack.status).toBe(403);
    expect(stranger.ack.observation).toBeUndefined();
  });

  it("lists only the window asked for, only to the floor, and never moves the booking", async () => {
    const f = await fixture();
    const before = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.bookingId));
    await recordObservationCore(db, f.hallkeeper, f.venueId, tap(f.bookingId, "cleaned", "2030-01-10T20:59:00.000Z"), clock);

    const otherDay = await listObservationsForVenue(db, f.hallkeeper, f.venueId, { from: "2030-01-12T04:00:00.000Z", to: "2030-01-13T04:00:00.000Z" });
    expect(otherDay).toEqual([]);
    const outsider = await listObservationsForVenue(db, f.outsider, f.venueId, DAY);
    expect("ok" in outsider).toBe(true);
    if ("ok" in outsider) expect(outsider.status).toBe(403);

    const after = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.bookingId));
    expect(after[0]?.startsAt.toISOString()).toBe(before[0]?.startsAt.toISOString());
    expect(after[0]?.endsAt.toISOString()).toBe(before[0]?.endsAt.toISOString());
    expect(after[0]?.updatedAt.toISOString()).toBe(before[0]?.updatedAt.toISOString());
  });
});
