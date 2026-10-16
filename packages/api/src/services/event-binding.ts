import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  EVENT_BOUND_BOOKING_KINDS,
  EVENT_CONFIRMED_STATUSES,
  EVENT_PIPELINE_STATUSES,
  EventStatusSchema,
  bookingKindNeedsEvent,
  defaultEventPhaseInputs,
  deriveEventStatus,
  summariseEventBookings,
  type EventStatus,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, enquiries, eventPhases, events } from "../db/schema.js";

// ---------------------------------------------------------------------------
// The bind (event-spine Phase A; migration 0090).
//
// Every writer of a hold or an ink calls bindBookingToEvent inside the SAME
// transaction as its booking write, then syncEventStatus once the booking is
// written. The writers today: createBookingCore, updateBookingCore and
// transitionBookingCore (services/booking-mutations.ts, which the REST routes
// and the /ws/diary commands share), the enquiry conversion
// (routes/bookings.ts POST /from-enquiry) and the client's proposed window
// (services/window-proposals.ts). Rows written straight into the table (the
// seed's demo week, database fixtures, and the switching-day importer when
// it lands) go through insertBoundBookings below, which binds the same way.
// The bookings_bound_to_event CHECK refuses a hold or ink that skipped both.
//
// Joining is never a guess. A booking joins:
//   - the event its writer names (checked to be at the booking's venue), or
//   - the event its enquiry's other bookings already have (the enquiry row is
//     locked first, so two holds pencilled at once from one enquiry join one
//     event rather than making two);
// otherwise a new event is made from the booking: its title, type and times,
// a draft until syncEventStatus derives its status from the bookings.
//
// Lock order: a booking path locks its bookings first, then the enquiry, then
// the event (syncEventStatus). updateEventCore locks the event and only reads
// bookings, so the two never wait on each other in a cycle.
// ---------------------------------------------------------------------------

/** The database or a transaction on it (nesting makes a savepoint). */
export type BindConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What a new event takes from the booking that brings it into being. */
export interface EventSeed {
  readonly venueId: string;
  readonly title: string;
  readonly eventType: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdBy: string | null;
  /** The client's name where the booking came from an enquiry. */
  readonly clientName?: string | null;
  /** Set only by the seed, as on its bookings (migration 0073). */
  readonly fixtureSource?: string | null;
}

export type BindTarget =
  /** Join the event the writer names. */
  | { readonly join: "event"; readonly eventId: string }
  /** Join the event the enquiry's bookings already have, else make one. */
  | { readonly join: "enquiry"; readonly enquiryId: string }
  /** Make a new event. */
  | { readonly join: "new" };

export type BindOutcome =
  | { readonly ok: true; readonly eventId: string; readonly created: boolean }
  | { readonly ok: false; readonly code: "EVENT_VENUE_MISMATCH" | "ENQUIRY_VENUE_MISMATCH" };

export interface EventStatusChange {
  readonly eventId: string;
  readonly from: EventStatus;
  readonly to: EventStatus;
}

/** The default phases a new event starts with, as POST /events gives them:
 *  no room and no time yet, and every evidence field honestly "not checked". */
export function defaultEventPhaseRows(eventId: string): (typeof eventPhases.$inferInsert)[] {
  return defaultEventPhaseInputs().map((phase, index) => ({
    eventId,
    templateKey: phase.templateKey,
    name: phase.name,
    sortOrder: index,
    startsAt: null,
    durationMinutes: phase.durationMinutes,
    guestCount: null,
    opsTasksCount: phase.opsTasksCount,
    reviewGatesCount: phase.reviewGatesCount,
    densityStatus: "not_checked",
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staff conflicts not checked",
    notes: phase.notes,
  }));
}

/** A new event for a booking. Headcounts stay unknown (0 and null) until
 *  someone enters them; nothing is copied that nobody stated. */
async function createEventFor(conn: BindConn, seed: EventSeed): Promise<string> {
  const [created] = await conn.insert(events).values({
    venueId: seed.venueId,
    createdBy: seed.createdBy,
    name: seed.title,
    eventType: seed.eventType,
    status: "draft",
    startsAt: seed.startsAt,
    endsAt: seed.endsAt,
    guestCount: 0,
    clientName: seed.clientName ?? null,
    fixtureSource: seed.fixtureSource ?? null,
  }).returning({ id: events.id });
  if (created === undefined) throw new Error("Event insert returned no row");
  await conn.insert(eventPhases).values(defaultEventPhaseRows(created.id));
  return created.id;
}

/**
 * The event a hold or ink belongs to: the one named, the one its enquiry
 * already has, or a new one. Call inside the booking write's transaction.
 */
export async function bindBookingToEvent(conn: BindConn, seed: EventSeed, target: BindTarget): Promise<BindOutcome> {
  if (target.join === "event") {
    const [row] = await conn.select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(and(eq(events.id, target.eventId), isNull(events.deletedAt)))
      .limit(1);
    if (row === undefined || row.venueId !== seed.venueId) return { ok: false, code: "EVENT_VENUE_MISMATCH" };
    return { ok: true, eventId: row.id, created: false };
  }

  if (target.join === "enquiry") {
    const [enquiry] = await conn.select({ id: enquiries.id, venueId: enquiries.venueId })
      .from(enquiries)
      .where(eq(enquiries.id, target.enquiryId))
      .limit(1)
      .for("update");
    if (enquiry === undefined || enquiry.venueId !== seed.venueId) return { ok: false, code: "ENQUIRY_VENUE_MISMATCH" };
    // The enquiry's event: a live booking's first, then the newest.
    const [joined] = await conn.select({ eventId: events.id })
      .from(bookings)
      .innerJoin(events, and(
        eq(events.id, bookings.eventId),
        eq(events.venueId, seed.venueId),
        isNull(events.deletedAt),
      ))
      .where(and(
        eq(bookings.enquiryId, enquiry.id),
        eq(bookings.venueId, seed.venueId),
        isNull(bookings.deletedAt),
      ))
      .orderBy(desc(sql`${bookings.status} = 'active'`), desc(bookings.createdAt), desc(bookings.id))
      .limit(1);
    if (joined !== undefined) return { ok: true, eventId: joined.eventId, created: false };
  }

  return { ok: true, eventId: await createEventFor(conn, seed), created: true };
}

/**
 * Re-derive one event's status from its bookings (deriveEventStatus in
 * @omnitwin/types) and store it when it changed. Locks the event row, then
 * reads its bookings in a later statement, so a concurrent writer's committed
 * booking is always seen: two holds of one event released at once leave it
 * lost, never draft. Returns the change, or null when the event is missing.
 */
export async function syncEventStatus(conn: BindConn, eventId: string): Promise<EventStatusChange | null> {
  const [event] = await conn.select({ id: events.id, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
    .for("update");
  if (event === undefined) return null;
  const from = EventStatusSchema.parse(event.status);
  const rows = await conn.select({ kind: bookings.kind, status: bookings.status, deletedAt: bookings.deletedAt })
    .from(bookings)
    .where(eq(bookings.eventId, eventId));
  const to = deriveEventStatus(from, summariseEventBookings(rows));
  if (to !== from) {
    await conn.update(events).set({ status: to, updatedAt: new Date() }).where(eq(events.id, eventId));
  }
  return { eventId, from, to };
}

/** syncEventStatus for each distinct event, in id order (a stable lock order). */
export async function syncEventStatuses(
  conn: BindConn,
  eventIds: Iterable<string | null>,
): Promise<EventStatusChange[]> {
  const ids = [...new Set([...eventIds].filter((id): id is string => id !== null))].sort();
  const changes: EventStatusChange[] = [];
  for (const id of ids) {
    const change = await syncEventStatus(conn, id);
    if (change !== null) changes.push(change);
  }
  return changes;
}

type BookingInsert = typeof bookings.$inferInsert;
type BookingSelect = typeof bookings.$inferSelect;

/** A direct writer named an event or an enquiry of another venue. Thrown, so
 *  the whole batch rolls back and nothing is half written. */
export class BookingBindError extends Error {
  constructor(title: string, code: "EVENT_VENUE_MISMATCH" | "ENQUIRY_VENUE_MISMATCH") {
    super(`${code}: "${title}" names an event or enquiry of another venue`);
    this.name = "BookingBindError";
  }
}

/**
 * Bookings written straight into the table rather than through the API's
 * cores: the seed's demo week, the switching-day importer when it lands, and
 * database test fixtures. Each hold or ink without an event joins its
 * enquiry's event or gets its own, exactly as the cores bind; a named event
 * is checked to be the booking's venue's. Everything happens in one
 * transaction with the insert, then every event touched takes the status its
 * bookings give it. A new event carries its booking's fixture marker, so the
 * seed's events stay identifiable as the seed's.
 */
export async function insertBoundBookings(
  conn: BindConn,
  rows: readonly BookingInsert[],
): Promise<BookingSelect[]> {
  if (rows.length === 0) return [];
  return conn.transaction(async (tx) => {
    const bound: BookingInsert[] = [];
    // One enquiry's rows in this batch share one event, as the migration
    // groups them: the rows are not in the table yet when the next is bound.
    const enquiryEvents = new Map<string, string>();
    for (const row of rows) {
      const named = row.eventId ?? null;
      if (named === null && !bookingKindNeedsEvent(row.kind)) {
        bound.push(row);
        continue;
      }
      const enquiryId = row.enquiryId ?? null;
      const batchEvent = enquiryId === null ? undefined : enquiryEvents.get(enquiryId);
      const target: BindTarget = named !== null
        ? { join: "event", eventId: named }
        : batchEvent !== undefined
          ? { join: "event", eventId: batchEvent }
          : enquiryId !== null
            ? { join: "enquiry", enquiryId }
            : { join: "new" };
      const outcome = await bindBookingToEvent(tx, {
        venueId: row.venueId,
        title: row.title,
        eventType: row.eventType ?? null,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        createdBy: row.createdBy ?? null,
        fixtureSource: row.fixtureSource ?? null,
      }, target);
      if (!outcome.ok) throw new BookingBindError(row.title, outcome.code);
      if (named === null && enquiryId !== null) enquiryEvents.set(enquiryId, outcome.eventId);
      bound.push({ ...row, eventId: outcome.eventId });
    }
    const inserted = await tx.insert(bookings).values(bound).returning();
    await syncEventStatuses(tx, inserted.map((row) => row.eventId));
    return inserted;
  });
}

// ---------------------------------------------------------------------------
// The read-only invariant (CI's platform database; once against production).
//
//   unboundBookings      holds and inks with no event. The
//                        bookings_bound_to_event CHECK makes this zero; the
//                        count proves the CHECK is in place and holding.
//   contradictingEvents  live events whose stored status disagrees with
//                        their Diary bookings: a live confirmed booking
//                        under an event that is not confirmed or later,
//                        live options (and no confirmed booking) under an
//                        event outside the pipeline, or nothing live and the
//                        event not closed as cancelled (a confirmed booking
//                        ended) or lost (only options ended). The same table
//                        as deriveEventStatus, stated as a check rather than
//                        as a rule, so the two can disagree and be caught.
//
// Both must read zero. Pass a venue to scope the count to one venue.
// ---------------------------------------------------------------------------

/** What the invariant needs of a connection: one read. */
export interface InvariantReader {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export interface BindInvariant {
  readonly unboundBookings: number;
  readonly contradictingEvents: number;
}

function countFrom(value: unknown, label: string): number {
  const count = typeof value === "string" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`The bind invariant returned no ${label} count`);
  }
  return count;
}

/** A list of string values as SQL parameters, for IN (...). */
function sqlList(values: readonly string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

export async function readBindInvariant(conn: InvariantReader, venueId: string | null = null): Promise<BindInvariant> {
  const bookingVenue = venueId === null ? sql`true` : sql`b.venue_id = ${venueId}`;
  const eventVenue = venueId === null ? sql`true` : sql`e.venue_id = ${venueId}`;
  // The status sets come from @omnitwin/types, the same constants
  // deriveEventStatus reads, so the check and the rule cannot drift apart.
  const result = await conn.execute(sql`
    SELECT
      (SELECT count(*) FROM bookings b
        WHERE b.kind IN (${sqlList(EVENT_BOUND_BOOKING_KINDS)}) AND b.event_id IS NULL AND ${bookingVenue})::text AS unbound_bookings,
      (SELECT count(*) FROM (
        SELECT e.status,
          bool_or(b.kind = 'ink' AND b.status = 'active') AS live_ink,
          bool_or(b.kind IN ('hold', 'prospect') AND b.status = 'active') AS live_option,
          bool_or(b.kind = 'ink' AND b.status <> 'active') AS ended_ink,
          bool_or(b.kind = 'hold' AND b.status <> 'active') AS ended_hold
        FROM events e
        JOIN bookings b ON b.event_id = e.id AND b.deleted_at IS NULL
        WHERE e.deleted_at IS NULL AND ${eventVenue}
        GROUP BY e.id, e.status
      ) f WHERE
        (f.live_ink AND f.status NOT IN (${sqlList(EVENT_CONFIRMED_STATUSES)}))
        OR (NOT f.live_ink AND f.live_option AND f.status NOT IN (${sqlList(EVENT_PIPELINE_STATUSES)}))
        OR (NOT f.live_ink AND NOT f.live_option AND f.ended_ink AND f.status <> 'cancelled')
        OR (NOT f.live_ink AND NOT f.live_option AND NOT f.ended_ink AND f.ended_hold AND f.status <> 'lost')
      )::text AS contradicting_events
  `);
  const row = result.rows[0];
  return {
    unboundBookings: countFrom(row?.["unbound_bookings"], "unbound booking"),
    contradictingEvents: countFrom(row?.["contradicting_events"], "contradicting event"),
  };
}
