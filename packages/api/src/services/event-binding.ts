import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  EVENT_BOUND_BOOKING_KINDS,
  EVENT_CONFIRMED_STATUSES,
  EVENT_PIPELINE_STATUSES,
  EventStatusSchema,
  bookingKindNeedsEvent,
  defaultEventPhaseInputs,
  deriveEventStatus,
  EnquiryStatusSchema,
  enquiryMayBecomeEvent,
  eventNameFor,
  summariseEventBookings,
  type EventStatus,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, enquiries, eventPhases, events, venues } from "../db/schema.js";

// ---------------------------------------------------------------------------
// The bind (event-spine Phase A, migration 0090; the enquiry's link, the
// spine's links migration).
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
//   - its enquiry's own event (enquiries.event_id, when it names a live event
//     of the enquiry's venue), or
//   - the event its enquiry's other bookings already have;
// otherwise a new event is made from the booking: its title (without one,
// its occasion and day: eventNameFor in @omnitwin/types, a day that follows
// the event's start in syncEventStatus), type and times, a draft until
// syncEventStatus derives its status from the bookings. The enquiry row is
// locked first, so two holds pencilled at once from one enquiry join one
// event rather than making two.
//
// The enquiry's link is kept in step. A booking bound through its enquiry
// writes the enquiry's event_id to the event it joined when they differ
// (setEnquiryEvent), unless the enquiry is a draft or asks to book nothing
// (enquiryMayBecomeEvent in @omnitwin/types): such an enquiry never has an
// event, and its bookings bind as they always did. Nor is the link written
// when anything else of the enquiry's own (its bookings, deals, proposals or
// floor plan) reaches a different live event: the join of old records lists
// such an enquiry for a person, and the bind does not choose for them; the
// booking still joins its event as before. A booking a person moves
// to another event takes the link with it when it was the enquiry's last
// live booking in the old event (followBookingToEvent; a released or
// cancelled one left there does not count). The link is moved, never
// emptied (a database trigger holds that).
//
// Lock order: a booking path locks its bookings first, then the enquiry, then
// the event (syncEventStatus), and takes the enquiry and the event FOR NO
// KEY UPDATE, never FOR UPDATE: a row written with a key to either (a
// booking, a viewing) takes FOR KEY SHARE on it through the foreign key, and
// FOR UPDATE waits on that share, then deadlocks when its holder wants the
// same row. The enquiry is locked before any row referencing it is inserted
// in the same transaction. updateEventCore locks the event and only reads
// bookings, so the two never wait on each other in a cycle.
// ---------------------------------------------------------------------------

/** The database or a transaction on it (nesting makes a savepoint). */
export type BindConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What a new event takes from the booking (or enquiry) that brings it into being. */
export interface EventSeed {
  readonly venueId: string;
  readonly title: string;
  readonly eventType: string | null;
  /** Null for an event made for an enquiry before any booking gives it dates. */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly createdBy: string | null;
  /** The client's name where the booking came from an enquiry. */
  readonly clientName?: string | null;
  /** Set only by the seed, as on its bookings (migration 0073). */
  readonly fixtureSource?: string | null;
}

export type BindTarget =
  /** Join the event the writer names. */
  | { readonly join: "event"; readonly eventId: string }
  /** Join the enquiry's own event, else the one its bookings already have,
   *  else make one; and keep the enquiry's link in step. */
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

/** events.event_type holds this many characters; an enquiry's may hold 100. */
const EVENT_TYPE_LENGTH = 80;

/** A new event for a booking or an enquiry. Headcounts stay unknown (0 and
 *  null) until someone enters them; nothing is copied that nobody stated. It
 *  is named by the seed's title, or, when it has none it can use, by its
 *  occasion and the venue's own day of its start, or by the occasion alone
 *  when it has no start (eventNameFor): an event named "" failed every read
 *  of its name, the client's schedule and home, the Diary range and the
 *  room's timeline among them. The occasion is cut to the column's width
 *  first, and the name made from it as stored, so syncEventStatus still
 *  knows the name for a made one. */
export async function createEventFor(conn: BindConn, seed: EventSeed): Promise<string> {
  const [venue] = await conn.select({ timeZone: venues.timezone }).from(venues).where(eq(venues.id, seed.venueId)).limit(1);
  if (venue === undefined) throw new Error("A new event's venue is missing");
  const eventType = seed.eventType === null ? null : seed.eventType.slice(0, EVENT_TYPE_LENGTH);
  const [created] = await conn.insert(events).values({
    venueId: seed.venueId,
    createdBy: seed.createdBy,
    name: eventNameFor({ title: seed.title, eventType, startsAt: seed.startsAt, timeZone: venue.timeZone }),
    eventType,
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

/** bookings.title holds this many characters; a longer title is cut there. */
const BOOKING_TITLE_LENGTH = 200;

/**
 * A booking's title, or "" when it is only its enquiry's email cut short. The
 * hold made for an enquiry that gave no name is titled by the enquiry's email,
 * alone or before its occasion ("jane@example.com — Wedding": the public route
 * files such an enquiry under its email; enquiryTitleName in
 * routes/bookings.ts). That is right for the hold, which staff work from. An
 * event is never named by it: eventNameFor counts a title holding an email
 * address as no title, at creation and on every screen. The one title it
 * cannot see is an address long enough to fill the title's 200 characters,
 * cut there before its domain: only the bind, which reads the enquiry, knows
 * it is an address.
 */
export function titleWithoutEnquiryEmail(title: string, email: string): string {
  const said = title.trim().toLowerCase();
  const address = email.trim().toLowerCase();
  return address !== "" && said.length >= BOOKING_TITLE_LENGTH && address.startsWith(said) ? "" : title;
}

/**
 * The event a booking of the enquiry joins: the enquiry's own link when that
 * names a live event of its venue; otherwise the event its bookings have (a
 * live booking's first, then the newest), even when they sit in more than
 * one; otherwise null. That last choice is for the booking only: the bind
 * writes it as the enquiry's link only when nothing else of the enquiry's
 * reaches another live event (enquiryReachesAnotherEvent). Call it with the
 * enquiry row locked (FOR NO KEY UPDATE), so what it reads cannot change
 * before the caller acts.
 */
export async function enquiryEventOf(
  conn: BindConn,
  enquiry: { readonly id: string; readonly venueId: string; readonly eventId: string | null },
): Promise<string | null> {
  if (enquiry.eventId !== null) {
    const [own] = await conn.select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, enquiry.eventId), eq(events.venueId, enquiry.venueId), isNull(events.deletedAt)))
      .limit(1);
    if (own !== undefined) return own.id;
  }
  const [joined] = await conn.select({ eventId: events.id })
    .from(bookings)
    .innerJoin(events, and(
      eq(events.id, bookings.eventId),
      eq(events.venueId, enquiry.venueId),
      isNull(events.deletedAt),
    ))
    .where(and(
      eq(bookings.enquiryId, enquiry.id),
      eq(bookings.venueId, enquiry.venueId),
      isNull(bookings.deletedAt),
    ))
    .orderBy(desc(sql`${bookings.status} = 'active'`), desc(bookings.createdAt), desc(bookings.id))
    .limit(1);
  return joined?.eventId ?? null;
}

/** Point the enquiry at an event of its venue (the key (event_id, venue_id)
 *  refuses another venue's). Moving it is this same write; the link is never
 *  emptied. Call with the enquiry row locked. */
export async function setEnquiryEvent(conn: BindConn, enquiryId: string, eventId: string): Promise<void> {
  await conn.update(enquiries).set({ eventId }).where(eq(enquiries.id, enquiryId));
}

/**
 * A booking a person moved to another event takes its enquiry's link with
 * it: when the enquiry's link named the event the booking left, and no other
 * live (active, undeleted) booking of the enquiry is left there, the link
 * moves to the booking's new event. Otherwise nothing. A released or
 * cancelled booking can never be moved again and keeps its event, so it never
 * holds the link: the bind prefers live bookings the same way. Call after the
 * booking is written
 * to its new event, in the same transaction: the booking is already locked,
 * and the enquiry is locked here (FOR NO KEY UPDATE), after it, as the lock
 * order asks.
 */
export async function followBookingToEvent(
  conn: BindConn,
  move: { readonly enquiryId: string | null; readonly fromEventId: string | null; readonly toEventId: string },
): Promise<void> {
  const { enquiryId, fromEventId, toEventId } = move;
  if (enquiryId === null || fromEventId === null || fromEventId === toEventId) return;
  const [enquiry] = await conn.select({ eventId: enquiries.eventId })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
    .for("no key update");
  if (enquiry?.eventId !== fromEventId) return;
  const [left] = await conn.select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.enquiryId, enquiryId),
      eq(bookings.eventId, fromEventId),
      eq(bookings.status, "active"),
      isNull(bookings.deletedAt),
    ))
    .limit(1);
  if (left === undefined) await setEnquiryEvent(conn, enquiryId, toEventId);
}

/**
 * The event a hold or ink belongs to: the one named, its enquiry's own, the
 * one its enquiry's bookings already have, or a new one. Bound through an
 * enquiry that may have an event, the enquiry's link is written to it, unless
 * anything else of the enquiry's own (its bookings, deals, proposals or floor
 * plan) reaches a different live event of its venue: then the link is left as
 * it is, for the join's list. Call inside the booking write's transaction,
 * before the booking is inserted.
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

  if (target.join === "new") return { ok: true, eventId: await createEventFor(conn, seed), created: true };

  // FOR NO KEY UPDATE still serialises two binds of one enquiry, and does not
  // wait on another writer's key share of it (a viewing's insert).
  const [enquiry] = await conn.select({
    id: enquiries.id,
    venueId: enquiries.venueId,
    email: enquiries.email,
    eventId: enquiries.eventId,
    state: enquiries.state,
    eventType: enquiries.eventType,
    configurationId: enquiries.configurationId,
  })
    .from(enquiries)
    .where(eq(enquiries.id, target.enquiryId))
    .limit(1)
    .for("no key update");
  if (enquiry === undefined || enquiry.venueId !== seed.venueId) return { ok: false, code: "ENQUIRY_VENUE_MISMATCH" };
  const joined = await enquiryEventOf(conn, enquiry);
  // A new event is named from the booking's title, unless that is only the
  // enquiry's email cut short (eventNameFor sees any other address).
  const eventId = joined ?? await createEventFor(conn, { ...seed, title: titleWithoutEnquiryEmail(seed.title, enquiry.email) });
  const state = EnquiryStatusSchema.safeParse(enquiry.state);
  if (eventId !== enquiry.eventId && state.success
    && enquiryMayBecomeEvent({ state: state.data, eventType: enquiry.eventType })
    && !(await enquiryReachesAnotherEvent(conn, enquiry, eventId))) {
    await setEnquiryEvent(conn, enquiry.id, eventId);
  }
  return { ok: true, eventId, created: joined === null };
}

/**
 * Whether anything of the enquiry's own reaches a live event of its venue
 * other than `eventId`, read as the join of old records reads it (step 1 of
 * spine_join_old_records, the spine's links migration): (A) an undeleted
 * booking of the enquiry sits in it; (C) an undeleted deal (source_enquiry_id)
 * or undeleted proposal (enquiry_id) of the enquiry is joined to it; (B) the
 * enquiry's floor plan is linked to it (event_configuration_links). When one
 * does, the join would list the enquiry rather than choose, so the bind does
 * not choose for it either. Plain reads, under the enquiry's lock the caller
 * already holds; no lock is taken here.
 */
async function enquiryReachesAnotherEvent(
  conn: BindConn,
  enquiry: { readonly id: string; readonly venueId: string; readonly configurationId: string | null },
  eventId: string,
): Promise<boolean> {
  const result = await conn.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM bookings b JOIN events e ON e.id = b.event_id
        WHERE b.enquiry_id = ${enquiry.id} AND b.deleted_at IS NULL
          AND e.venue_id = ${enquiry.venueId} AND e.deleted_at IS NULL AND e.id <> ${eventId}
      UNION ALL
      SELECT 1 FROM opportunities o JOIN events e ON e.id = o.event_id
        WHERE o.source_enquiry_id = ${enquiry.id} AND o.deleted_at IS NULL
          AND e.venue_id = ${enquiry.venueId} AND e.deleted_at IS NULL AND e.id <> ${eventId}
      UNION ALL
      SELECT 1 FROM proposals p JOIN events e ON e.id = p.event_id
        WHERE p.enquiry_id = ${enquiry.id} AND p.deleted_at IS NULL
          AND e.venue_id = ${enquiry.venueId} AND e.deleted_at IS NULL AND e.id <> ${eventId}
      UNION ALL
      SELECT 1 FROM event_configuration_links k JOIN events e ON e.id = k.event_id
        WHERE k.configuration_id = ${enquiry.configurationId}
          AND e.venue_id = ${enquiry.venueId} AND e.deleted_at IS NULL AND e.id <> ${eventId}
    ) AS reaches
  `);
  const reaches = result.rows[0]?.["reaches"];
  if (typeof reaches !== "boolean") throw new Error("The enquiry's reach returned no answer");
  return reaches;
}

interface SpanBooking {
  readonly kind: string;
  readonly status: string;
  readonly deletedAt: Date | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * When an event happens, as its Diary bookings say (release audit
 * events-diary-1): from the first live confirmed booking's start to the last
 * one's end, or, before anything is confirmed, across its live options. Null
 * when nothing is live, and the event keeps the dates it last had. The event's
 * dates are what clients see, what supplier passes and the client schedule
 * read, and what allergy-note retention counts from, so they must move when
 * the booking moves.
 */
export function eventSpanFromBookings(rows: readonly SpanBooking[]): { readonly startsAt: Date; readonly endsAt: Date } | null {
  const live = rows.filter((row) => row.deletedAt === null && row.status === "active");
  const inks = live.filter((row) => row.kind === "ink");
  const spanning = inks.length > 0 ? inks : live.filter((row) => row.kind === "hold");
  if (spanning.length === 0) return null;
  return {
    startsAt: new Date(Math.min(...spanning.map((row) => row.startsAt.getTime()))),
    endsAt: new Date(Math.max(...spanning.map((row) => row.endsAt.getTime()))),
  };
}

/** A booking's day, as the sheet's set-up deadline reads it (resolveTiming in
 *  hallkeeper-sheet-v2-data.ts): from a day before it starts to its end. */
const BOOKING_DAY_LEAD_MS = 24 * 60 * 60_000;

export interface BookingMove {
  readonly bookingId: string;
  readonly eventId: string;
  readonly from: { readonly spaceId: string; readonly startsAt: Date; readonly endsAt: Date };
  readonly to: { readonly spaceId: string; readonly startsAt: Date };
}

/**
 * Whether movePhasesWithBooking moves this phase with the booking, read
 * without a write: a phase of the booking's event in the booking's room,
 * starting from a day before the booking until it ends, and not inside another
 * live booking of the same event in that room. Kept in step with the SQL
 * below; decisions-postgres.test.ts compares the two on a moved booking.
 */
export function phaseMovesWithBooking(
  phase: { readonly eventId: string; readonly spaceId: string | null; readonly startsAt: Date | null },
  move: {
    readonly bookingId: string;
    readonly eventId: string;
    readonly from: { readonly spaceId: string; readonly startsAt: Date; readonly endsAt: Date };
  },
  liveBookings: readonly {
    readonly id: string;
    readonly eventId: string | null;
    readonly spaceId: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }[],
): boolean {
  if (phase.eventId !== move.eventId || phase.spaceId !== move.from.spaceId || phase.startsAt === null) return false;
  const at = phase.startsAt.getTime();
  if (at < move.from.startsAt.getTime() - BOOKING_DAY_LEAD_MS || at >= move.from.endsAt.getTime()) return false;
  return !liveBookings.some((other) => other.id !== move.bookingId && other.eventId === move.eventId
    && other.spaceId === move.from.spaceId && at >= other.startsAt.getTime() && at < other.endsAt.getTime());
}

/**
 * The event's timed phases follow a booking that moves (release audit
 * events-diary-3): every phase of the event in the booking's room on the
 * booking's day shifts by the same amount and goes to its new room, so the
 * Day Board, the sheet's set-up deadline and the conflict engine read where
 * and when the work now is. A phase inside another live booking of the same
 * event in that room belongs to that booking and stays. The shift is in
 * absolute time, as the booking's is, so a phase keeps its place relative to
 * the booking across midnight and a change of the clocks.
 *
 * Locks the event first (lock order: the booking, then the event), the lock
 * the phase editor takes too, so a phase edit and a move never write over
 * each other. Call inside the booking write's transaction, after it.
 */
export async function movePhasesWithBooking(conn: BindConn, move: BookingMove): Promise<number> {
  const deltaMs = move.to.startsAt.getTime() - move.from.startsAt.getTime();
  if (deltaMs === 0 && move.to.spaceId === move.from.spaceId) return 0;
  await conn.select({ id: events.id }).from(events).where(eq(events.id, move.eventId)).limit(1).for("no key update");
  const dayBefore = new Date(move.from.startsAt.getTime() - BOOKING_DAY_LEAD_MS);
  // Qualified by hand: inside the subquery a bare starts_at would be the
  // booking's, not the phase's (PostgreSQL takes the innermost name).
  const phaseStart = sql`"event_phases"."starts_at"`;
  const moved = await conn.update(eventPhases)
    .set({
      startsAt: sql`${phaseStart} + (${deltaMs}::bigint * interval '1 millisecond')`,
      spaceId: move.to.spaceId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(eventPhases.eventId, move.eventId),
      eq(eventPhases.spaceId, move.from.spaceId),
      sql`${phaseStart} is not null`,
      sql`${phaseStart} >= ${dayBefore}`,
      sql`${phaseStart} < ${move.from.endsAt}`,
      sql`not exists (
        select 1 from "bookings" as other
        where other."event_id" = ${move.eventId}
          and other."space_id" = ${move.from.spaceId}
          and other."id" <> ${move.bookingId}
          and other."status" = 'active'
          and other."deleted_at" is null
          and ${phaseStart} >= other."starts_at"
          and ${phaseStart} < other."ends_at"
      )`,
    ))
    .returning({ id: eventPhases.id });
  return moved.length;
}

/**
 * Re-derive one event's status from its bookings (deriveEventStatus in
 * @omnitwin/types) and store it when it changed. Locks the event row, then
 * reads its bookings in a later statement, so a concurrent writer's committed
 * booking is always seen: two holds of one event released at once leave it
 * lost, never draft. Returns the change, or null when the event is missing.
 * The event's dates follow its live bookings in the same step
 * (eventSpanFromBookings), so every booking writer moves them with it.
 *
 * The lock is FOR NO KEY UPDATE, not FOR UPDATE. Every booking written or
 * moved onto an event takes FOR KEY SHARE on it through the foreign key, and
 * FOR UPDATE conflicts with that: two writers adding bookings to one event at
 * once would each hold a key share and wait for the other's, a deadlock.
 * FOR NO KEY UPDATE still serialises the syncs with each other and with
 * updateEventCore's FOR UPDATE, which is all the status needs.
 *
 * A name createEventFor made carries the day the event started on then
 * ("Wedding, 14 March 2027"), so it moves with the start, under the same
 * lock: when the stored name is exactly what eventNameFor makes for the old
 * start, it is made again for the new one. A name a person gave is left as
 * it is, unless it is word for word the name made for the old start, which
 * cannot be told from one; so is a name made before the event had a start.
 */
export async function syncEventStatus(conn: BindConn, eventId: string): Promise<EventStatusChange | null> {
  const [event] = await conn.select({
    id: events.id,
    venueId: events.venueId,
    status: events.status,
    name: events.name,
    eventType: events.eventType,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
  })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
    .for("no key update");
  if (event === undefined) return null;
  const from = EventStatusSchema.parse(event.status);
  const rows = await conn.select({
    kind: bookings.kind,
    status: bookings.status,
    deletedAt: bookings.deletedAt,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
  })
    .from(bookings)
    .where(eq(bookings.eventId, eventId));
  const to = deriveEventStatus(from, summariseEventBookings(rows));
  const span = eventSpanFromBookings(rows);
  const spanMoved = span !== null && (event.startsAt?.getTime() !== span.startsAt.getTime()
    || event.endsAt?.getTime() !== span.endsAt.getTime());
  if (to !== from || spanMoved) {
    const name = spanMoved ? await nameForMovedStart(conn, event, span.startsAt) : null;
    await conn.update(events).set({
      status: to,
      ...(spanMoved ? { startsAt: span.startsAt, endsAt: span.endsAt } : {}),
      ...(name === null ? {} : { name }),
      updatedAt: new Date(),
    }).where(eq(events.id, eventId));
  }
  return { eventId, from, to };
}

/** The name an event takes when its start moves: eventNameFor's for the new
 *  start when the stored name is eventNameFor's for the old one, else null
 *  (the name stays). The venue's zone is read as createEventFor reads it. */
async function nameForMovedStart(
  conn: BindConn,
  event: { readonly venueId: string; readonly name: string; readonly eventType: string | null; readonly startsAt: Date | null },
  startsAt: Date,
): Promise<string | null> {
  if (event.startsAt === null) return null;
  const [venue] = await conn.select({ timeZone: venues.timezone }).from(venues).where(eq(venues.id, event.venueId)).limit(1);
  if (venue === undefined) return null;
  const made = (at: Date): string => eventNameFor({ title: "", eventType: event.eventType, startsAt: at, timeZone: venue.timeZone });
  if (event.name !== made(event.startsAt)) return null;
  const renamed = made(startsAt);
  return renamed === event.name ? null : renamed;
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
export function sqlList(values: readonly string[]): SQL {
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
