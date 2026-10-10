import { and, asc, eq, gt, lt } from "drizzle-orm";
import type { ObservationListQuery, RecordObservation, SlotObservation } from "@omnitwin/types";
import { bookingObservations, bookings } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canReadDiary, canRecordObservation } from "../utils/query.js";
import type { RequestActor } from "./requests.js";

// ---------------------------------------------------------------------------
// Observations (goal 19 S5; D1, D10, D11).
//
// A fact about the room, written once. The insert is decided by the unique
// index on (venue, idempotency key): a tap replayed from an offline phone, or
// pressed twice, reads the first fact back and writes nothing. Facts are
// never updated and never overwrite one another; the board reads the latest
// by the hallkeeper's own time (observedAt), so arrival order is irrelevant
// and a late replay lands where it was tapped.
//
// Two bounds keep a fact honest: it cannot sit ahead of the server's clock
// by more than skew allows, and it belongs within a day of its booking.
// Nothing here writes a time on a booking.
// ---------------------------------------------------------------------------

export interface ObservationDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

function deny(status: number, code: string, error: string): ObservationDeny {
  return { ok: false, status, code, error };
}

export interface RecordObservationOk {
  readonly ok: true;
  /** True when the key had already been used: the SAME fact comes back and
   *  nothing is announced twice. */
  readonly replay: boolean;
  readonly observation: SlotObservation;
}

type ObservationRow = typeof bookingObservations.$inferSelect;

/** How far ahead of the server a tap may claim to be: clock skew, never the future. */
export const OBSERVATION_FUTURE_TOLERANCE_MS = 5 * 60_000;
/** How far from the booking's own window a fact may sit: a day either side. */
export const OBSERVATION_WINDOW_MS = 24 * 60 * 60_000;

export function serializeObservation(row: ObservationRow): SlotObservation {
  return {
    id: row.id,
    venueId: row.venueId,
    bookingId: row.bookingId,
    spaceId: row.spaceId,
    kind: row.kind,
    observedAt: row.observedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    idempotencyKey: row.idempotencyKey,
  };
}

/** Record one tap against a booking of the actor's venue. */
export async function recordObservationCore(
  db: Database,
  actor: RequestActor,
  venueId: string,
  input: RecordObservation,
  now: () => number = () => Date.now(),
): Promise<RecordObservationOk | ObservationDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");

  const [booking] = await db
    .select({
      id: bookings.id,
      venueId: bookings.venueId,
      spaceId: bookings.spaceId,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      deletedAt: bookings.deletedAt,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);
  // Another venue's booking reads as absent: the Diary is tenancy-scoped.
  if (booking === undefined || booking.venueId !== venueId || booking.deletedAt !== null) {
    return deny(404, "BOOKING_NOT_FOUND", "That booking is not on this venue's Diary.");
  }

  const nowMs = now();
  const observedAtMs = Date.parse(input.observedAt);
  if (observedAtMs > nowMs + OBSERVATION_FUTURE_TOLERANCE_MS) {
    return deny(400, "OBSERVED_IN_FUTURE", "An observation cannot be ahead of the clock.");
  }
  if (
    observedAtMs < booking.startsAt.getTime() - OBSERVATION_WINDOW_MS
    || observedAtMs > booking.endsAt.getTime() + OBSERVATION_WINDOW_MS
  ) {
    return deny(400, "OBSERVED_OUTSIDE_BOOKING", "An observation belongs within a day of its booking.");
  }

  const inserted = await db
    .insert(bookingObservations)
    .values({
      venueId,
      bookingId: booking.id,
      spaceId: booking.spaceId,
      kind: input.kind,
      observedAt: new Date(observedAtMs),
      recordedAt: new Date(nowMs),
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      idempotencyKey: input.idempotencyKey,
    })
    // The index decides, not a prior read: the same tap writes nothing twice.
    .onConflictDoNothing({ target: [bookingObservations.venueId, bookingObservations.idempotencyKey] })
    .returning();

  const fresh = inserted[0];
  if (fresh !== undefined) return { ok: true, replay: false, observation: serializeObservation(fresh) };

  const existing = await readObservationByKey(db, venueId, input.idempotencyKey);
  if (existing === null) {
    return deny(409, "OBSERVATION_RACE", "That observation could not be read back — try again.");
  }
  return { ok: true, replay: true, observation: existing };
}

/** The fact a key already names, for a replayed command's ack. */
export async function readObservationByKey(
  db: Database,
  venueId: string,
  idempotencyKey: string,
): Promise<SlotObservation | null> {
  const [row] = await db
    .select()
    .from(bookingObservations)
    .where(and(eq(bookingObservations.venueId, venueId), eq(bookingObservations.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row === undefined ? null : serializeObservation(row);
}

/** Every fact about every booking that touches the window, oldest first by
 *  the hallkeeper's time: the board's input for one day. */
export async function listObservationsForVenue(
  db: Database,
  actor: RequestActor,
  venueId: string,
  query: ObservationListQuery,
): Promise<readonly SlotObservation[] | ObservationDeny> {
  if (!canReadDiary(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const from = new Date(query.from);
  const to = new Date(query.to);
  const rows = await db
    .select({ observation: bookingObservations })
    .from(bookingObservations)
    .innerJoin(bookings, eq(bookings.id, bookingObservations.bookingId))
    .where(and(
      eq(bookingObservations.venueId, venueId),
      lt(bookings.startsAt, to),
      gt(bookings.endsAt, from),
    ))
    .orderBy(asc(bookingObservations.observedAt), asc(bookingObservations.recordedAt));
  return rows.map((row) => serializeObservation(row.observation));
}
