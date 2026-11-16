import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingSchema, VENUE_ACCESS_ENQUIRY_TYPE, type Booking } from "@omnitwin/types";
import { bookingRoutes } from "../routes/bookings.js";
import { transitionBookingCore, updateBookingCore } from "../services/booking-mutations.js";
import { createEventFor } from "../services/event-binding.js";
import {
  enquiry as enquiryIn,
  event as eventIn,
  openSpineDatabase,
  platformTarget,
  venue as venueIn,
  type SpineActor,
  type SpineDatabase,
  type SpineVenue,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The bind and the enquiry's own link (the spine, stage 1).
//
// A hold made from an enquiry joins the enquiry's own event first (its
// event_id, when that names a live event of its venue), then the event its
// other bookings have, then a new one; and the enquiry's link is written to
// the event the hold joined, unless the enquiry is a draft or asks to book
// nothing. A booking a person moves to another event takes its enquiry's link
// with it when it was the last of the enquiry's live bookings in the old
// event (a released or cancelled one left there does not hold the link).
// The enquiry row is locked FOR NO KEY UPDATE, so two holds pencilled at once
// still share one event, and a writer holding a key share on the enquiry (a
// viewing's insert, through its foreign key) never makes the bind wait.
//
// The suite runs on a throwaway database of its own (openSpineDatabase); the
// shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Saturday 14 June 2031, midnight UTC: far from any other fixture's dates. */
const SATURDAY = Date.parse("2031-06-14T00:00:00.000Z");
/** The suite's label, and the application name its pool connects as (openSpineDatabase prefixes "spine_"). */
const LABEL = "bind";
const APPLICATION_NAME = `spine_${LABEL}`;

/** An instant on the test Saturday (UTC). */
function at(hhmm: string, dayOffset = 0): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(SATURDAY + dayOffset * DAY + (hours ?? 0) * HOUR + (minutes ?? 0) * 60_000).toISOString();
}

function bearer(actor: SpineActor): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ ...actor, email: `${actor.id}@event-spine.invalid` })}` };
}

/** The hold quartet every option carries (roadmap N3). */
function hygiene(ownerUserId: string) {
  return {
    decisionAt: at("10:00", -45),
    ownerUserId,
    nextAction: "Call the couple about the date.",
    nextActionDueAt: at("10:00", -52),
  };
}

/** The body POST /bookings/from-enquiry takes for a hold in the Grand Hall. */
function holdBody(v: SpineVenue, enquiryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { enquiryId, spaceId: v.rooms.hall, startsAt: at("18:00"), endsAt: at("23:00"), ...hygiene(v.admin.id), ...overrides };
}

interface EventRowRead {
  readonly id: string;
  readonly name: string;
  readonly event_type: string | null;
  readonly starts_at: Date | null;
  readonly ends_at: Date | null;
}

describe.skipIf(target === undefined)("the spine: the bind joins the enquiry's own event and keeps its link", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let server: FastifyInstance;

  beforeAll(async () => {
    spine = await openSpineDatabase(LABEL);
    pool = spine.pool;
    server = Fastify();
    await server.register(bookingRoutes, { db: spine.db, prefix: "/bookings" });
    await server.ready();
  }, 180_000);
  afterAll(async () => { await server?.close(); await spine?.close(); });

  const venue = (label: string): Promise<SpineVenue> => venueIn(pool, label);
  const datelessEvent = (venueId: string, name: string): Promise<string> => eventIn(pool, venueId, name);

  async function post(actor: SpineActor, url: string, body: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url, headers: bearer(actor), payload: body });
  }

  async function holdFromEnquiry(actor: SpineActor, body: Record<string, unknown>): Promise<Booking> {
    const response = await post(actor, "/bookings/from-enquiry", body);
    expect(response.statusCode, response.body).toBe(201);
    return BookingSchema.parse(response.json<{ data: unknown }>().data);
  }

  async function enquiryEvent(enquiryId: string): Promise<string | null> {
    const [row] = (await pool.query<{ event_id: string | null }>("SELECT event_id FROM enquiries WHERE id = $1", [enquiryId])).rows;
    if (row === undefined) throw new Error("Missing enquiry");
    return row.event_id;
  }

  async function eventRow(id: string | null): Promise<EventRowRead> {
    if (id === null) throw new Error("No event");
    const [row] = (await pool.query<EventRowRead>("SELECT id, name, event_type, starts_at, ends_at FROM events WHERE id = $1", [id])).rows;
    if (row === undefined) throw new Error("Missing event");
    return row;
  }

  async function eventCount(venueId: string): Promise<number> {
    const [row] = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM events WHERE venue_id = $1", [venueId])).rows;
    return row?.count ?? 0;
  }

  async function blocked(count: number): Promise<void> {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [APPLICATION_NAME],
    )).rows[0]?.count), { timeout: 10_000 }).toBe(count);
  }

  /** Hold the enquiry row in another transaction, as `mode` locks it, while `run` works. */
  async function withLockedEnquiry(
    enquiryId: string,
    mode: "NO KEY UPDATE" | "KEY SHARE",
    run: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      await client.query(`SELECT id FROM enquiries WHERE id = $1 FOR ${mode}`, [enquiryId]);
      await run(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("a hold made from an enquiry writes the enquiry's link", async () => {
    const v = await venue("writes the link");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    expect(hold.eventId).not.toBeNull();
    expect(await enquiryEvent(enquiryId)).toBe(hold.eventId);
  });

  it("the first hold on an enquiry that already has an event joins it, and the event takes the hold's dates", async () => {
    const v = await venue("joins its own event");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const eventId = await datelessEvent(v.venueId, "Opened from the enquiry");
    await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [eventId, enquiryId]);
    const before = await eventCount(v.venueId);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { startsAt: at("18:00"), endsAt: at("23:00") }));
    expect(hold.eventId).toBe(eventId);
    expect(await eventCount(v.venueId)).toBe(before);
    expect(await eventRow(eventId)).toMatchObject({
      name: "Opened from the enquiry", starts_at: new Date(at("18:00")), ends_at: new Date(at("23:00")),
    });
    expect(await enquiryEvent(enquiryId)).toBe(eventId);
  });

  it("the enquiry's own link wins over an older booking's event", async () => {
    const v = await venue("link wins");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const older = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { spaceId: v.rooms.saloon }));
    const own = await datelessEvent(v.venueId, "The enquiry's own");
    await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [own, enquiryId]);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    expect(hold.eventId).toBe(own);
    expect(hold.eventId).not.toBe(older.eventId);
    expect(await enquiryEvent(enquiryId)).toBe(own);
  });

  it("a link to a deleted event is not joined: a new event is made and the link moves", async () => {
    const v = await venue("deleted link");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const gone = await datelessEvent(v.venueId, "Removed");
    await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [gone, enquiryId]);
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [gone]);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    expect(hold.eventId).not.toBeNull();
    expect(hold.eventId).not.toBe(gone);
    expect(await enquiryEvent(enquiryId)).toBe(hold.eventId);
  });

  it.each([
    { label: "a request that books nothing", state: "submitted", eventType: VENUE_ACCESS_ENQUIRY_TYPE },
    { label: "a draft", state: "draft", eventType: "wedding" },
  ] as const)("a hold on $label binds as before and writes no link", async ({ state, eventType }) => {
    const v = await venue(`no link ${state}`);
    const enquiryId = await enquiryIn(pool, v.venueId, state, eventType);
    const first = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { spaceId: v.rooms.saloon }));
    expect(first.eventId).not.toBeNull();
    expect(await enquiryEvent(enquiryId)).toBeNull();
    // Its next hold still joins the event its first has, as the bind always did.
    const second = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    expect(second.eventId).toBe(first.eventId);
    expect(await enquiryEvent(enquiryId)).toBeNull();
  });

  it("an occasion of 100 characters makes an event whose type is cut to 80, not a refusal", async () => {
    const v = await venue("long occasion");
    const eventId = await createEventFor(spine.db, {
      venueId: v.venueId, title: "", eventType: "x".repeat(100), startsAt: null, endsAt: null, createdBy: v.admin.id,
    });
    const row = await eventRow(eventId);
    expect(row.event_type).toBe("x".repeat(80));
    expect(row.starts_at).toBeNull();
    expect(row.ends_at).toBeNull();
    expect(row.name.trim()).not.toBe("");
  });

  it("a booking a person moves to another event takes its enquiry's link with it when it was the last one there", async () => {
    const v = await venue("follows a move");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    const first = hold.eventId;
    expect(await enquiryEvent(enquiryId)).toBe(first);
    const second = await datelessEvent(v.venueId, "Where it moves");
    expect(await updateBookingCore(spine.db, v.admin, hold.id, { eventId: second })).toMatchObject({ ok: true });
    expect(await enquiryEvent(enquiryId)).toBe(second);

    // With another of its bookings still in the old event, the link stays.
    const other = await enquiryIn(pool, v.venueId);
    const saloon = await holdFromEnquiry(v.admin, holdBody(v, other, { spaceId: v.rooms.saloon }));
    const hall = await holdFromEnquiry(v.admin, holdBody(v, other));
    expect(hall.eventId).toBe(saloon.eventId);
    const elsewhere = await datelessEvent(v.venueId, "Somewhere else");
    expect(await updateBookingCore(spine.db, v.admin, hall.id, { eventId: elsewhere })).toMatchObject({ ok: true });
    expect(await enquiryEvent(other)).toBe(saloon.eventId);

    // A link that already named another event is not moved by the booking.
    const third = await enquiryIn(pool, v.venueId);
    const kept = await holdFromEnquiry(v.admin, holdBody(v, third));
    const named = await datelessEvent(v.venueId, "Named by hand");
    await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [named, third]);
    const away = await datelessEvent(v.venueId, "Away");
    expect(await updateBookingCore(spine.db, v.admin, kept.id, { eventId: away })).toMatchObject({ ok: true });
    expect(await enquiryEvent(third)).toBe(named);
  });

  it("a released hold left in the old event does not keep the link there: it follows the live hold, and the next hold joins it", async () => {
    const v = await venue("released sibling");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const live = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    const second = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { spaceId: v.rooms.saloon }));
    expect(second.eventId).toBe(live.eventId);
    expect(await transitionBookingCore(spine.db, v.admin, second.id, { toState: "released" })).toMatchObject({ ok: true });
    const moved = await datelessEvent(v.venueId, "Where the live hold goes");
    expect(await updateBookingCore(spine.db, v.admin, live.id, { eventId: moved })).toMatchObject({ ok: true });
    expect(await enquiryEvent(enquiryId)).toBe(moved);
    const next = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { spaceId: v.rooms.reception }));
    expect(next.eventId).toBe(moved);
  });

  it("an enquiry's interest-only booking that is its last live one in the linked event takes the link when moved", async () => {
    const v = await venue("prospect moves");
    const enquiryId = await enquiryIn(pool, v.venueId);
    const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId));
    const first = hold.eventId;
    const [prospect] = (await pool.query<{ id: string }>(`INSERT INTO bookings
      (venue_id, space_id, kind, title, starts_at, ends_at, event_id, enquiry_id, created_by)
      VALUES ($1, $2, 'prospect', 'Interest only', $3, $4, $5, $6, $7) RETURNING id`,
    [v.venueId, v.rooms.saloon, at("12:00"), at("14:00"), first, enquiryId, v.admin.id])).rows;
    if (prospect === undefined) throw new Error("Prospect fixture missing");
    expect(await transitionBookingCore(spine.db, v.admin, hold.id, { toState: "released" })).toMatchObject({ ok: true });
    const moved = await datelessEvent(v.venueId, "Where the interest goes");
    expect(await updateBookingCore(spine.db, v.admin, prospect.id, { eventId: moved })).toMatchObject({ ok: true });
    expect(await enquiryEvent(enquiryId)).toBe(moved);
  });

  it("two holds pencilled at once from one enquiry still share one event, and the link names it", async () => {
    const v = await venue("same moment");
    const enquiryId = await enquiryIn(pool, v.venueId);
    await withLockedEnquiry(enquiryId, "NO KEY UPDATE", async (client) => {
      const both = Promise.all([
        holdFromEnquiry(v.admin, holdBody(v, enquiryId, { spaceId: v.rooms.saloon, startsAt: at("12:00"), endsAt: at("15:00") })),
        holdFromEnquiry(v.admin, holdBody(v, enquiryId, { startsAt: at("17:00"), endsAt: at("23:00") })),
      ]);
      // Both conversions wait on the enquiry, inside their own transactions.
      await blocked(2);
      await client.query("COMMIT");
      const [first, second] = await both;
      expect(first.eventId).not.toBeNull();
      expect(second.eventId).toBe(first.eventId);
      expect(await enquiryEvent(enquiryId)).toBe(first.eventId);
    });
    expect(await eventCount(v.venueId)).toBe(1);
  });

  it("a viewing and a hold made at the same moment for one enquiry both finish", async () => {
    const v = await venue("viewing and hold");
    const enquiryId = await enquiryIn(pool, v.venueId);
    // A writer that has inserted a row referencing the enquiry holds a key
    // share on it until it commits (a viewing does, through its foreign key).
    // The bind's FOR NO KEY UPDATE does not wait for it.
    await withLockedEnquiry(enquiryId, "KEY SHARE", async () => {
      const hold = await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { startsAt: at("09:00", 1), endsAt: at("10:00", 1) }));
      expect(await enquiryEvent(enquiryId)).toBe(hold.eventId);
    });
    // And through the routes, ten rounds of a viewing and a hold at once.
    for (let round = 0; round < 10; round += 1) {
      const [viewing, hold] = await Promise.all([
        post(v.admin, "/bookings/viewings", {
          enquiryId, spaceId: v.rooms.saloon, startsAt: at("11:00", round + 2), endsAt: at("11:30", round + 2),
        }),
        post(v.admin, "/bookings/from-enquiry", holdBody(v, enquiryId, { startsAt: at("18:00", round + 2), endsAt: at("23:00", round + 2) })),
      ]);
      expect(viewing.statusCode, viewing.body).toBe(201);
      expect(hold.statusCode, hold.body).toBe(201);
    }
    expect(await eventCount(v.venueId)).toBe(1);
  });
});
