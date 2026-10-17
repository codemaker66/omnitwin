import type { BookingKind, BookingLiveness } from "./booking.js";
import type { EventStatus } from "./event-phase-graph.js";

// ---------------------------------------------------------------------------
// The bind (event-spine Phase A, migration 0090).
//
// Every provisional option (hold) and every confirmed booking (ink) belongs to
// an event from the moment it is written: the writer creates or joins the
// event in the same database transaction, and the bookings_bound_to_event
// CHECK refuses a hold or ink without one. Interest only (prospect) and the
// venue's own blocks (internal_block) stay free of events.
//
// An event's status is then DERIVED from its bookings, so two state machines
// (booking kind/status, event status) cannot drift apart:
//
//   its bookings                                   its status
//   ---------------------------------------------  ------------------------
//   a confirmed booking is live                    confirmed, or the later
//                                                  step people recorded
//                                                  (in planning, ready for
//                                                  ops, executed, closed)
//   only options or interest are live              draft, or proposed when
//                                                  a proposal was recorded
//   nothing live; a confirmed booking was          cancelled
//   cancelled
//   nothing live; options were released, lapsed   lost
//   or lost, none confirmed
//   no booking on the Diary at all                 unchanged (the Diary does
//                                                  not speak for it)
//
// Soft-deleted bookings and the venue's own blocks are not evidence either
// way. Ops views (Day Board phases, the room timeline) and revenue read
// confirmed and later; draft and lost events live in the pipeline only.
// ---------------------------------------------------------------------------

/** The kinds that must belong to an event (bookings_bound_to_event). */
export const EVENT_BOUND_BOOKING_KINDS = ["hold", "ink"] as const satisfies readonly BookingKind[];

const EVENT_BOUND_KIND_SET: ReadonlySet<BookingKind> = new Set(EVENT_BOUND_BOOKING_KINDS);

/** True when a booking of this kind cannot exist without its event. */
export function bookingKindNeedsEvent(kind: BookingKind): boolean {
  return EVENT_BOUND_KIND_SET.has(kind);
}

/** Before anything is confirmed: the sales pipeline's statuses. */
export const EVENT_PIPELINE_STATUSES = ["draft", "proposed"] as const satisfies readonly EventStatus[];

/** Confirmed and the steps people take an event through after it. Ops views
 *  and revenue read only these. */
export const EVENT_CONFIRMED_STATUSES = [
  "confirmed",
  "in_planning",
  "ready_for_ops",
  "executed",
  "closed",
] as const satisfies readonly EventStatus[];

/** The event will not happen: kept as a record, never shown to ops. */
export const EVENT_ENDED_STATUSES = ["cancelled", "lost"] as const satisfies readonly EventStatus[];

const PIPELINE_SET: ReadonlySet<EventStatus> = new Set(EVENT_PIPELINE_STATUSES);
const CONFIRMED_SET: ReadonlySet<EventStatus> = new Set(EVENT_CONFIRMED_STATUSES);
const ENDED_SET: ReadonlySet<EventStatus> = new Set(EVENT_ENDED_STATUSES);

export function isPipelineEventStatus(status: EventStatus): boolean {
  return PIPELINE_SET.has(status);
}

export function isConfirmedEventStatus(status: EventStatus): boolean {
  return CONFIRMED_SET.has(status);
}

export function isEndedEventStatus(status: EventStatus): boolean {
  return ENDED_SET.has(status);
}

/** One booking as the status rule reads it. */
export interface EventBookingFacts {
  readonly kind: BookingKind;
  readonly status: BookingLiveness;
  readonly deletedAt: Date | string | null;
}

/** An event's bookings, reduced to the facts the status rule reads. */
export interface EventBookingSummary {
  /** A confirmed booking that is live. */
  readonly liveInk: boolean;
  /** A provisional option that is live. */
  readonly liveHold: boolean;
  /** Interest only, live. */
  readonly liveProspect: boolean;
  /** A confirmed booking that ended (cancelled). */
  readonly endedInk: boolean;
  /** A provisional option that ended: released, expired (lapsed) or lost. */
  readonly endedHold: boolean;
}

export const EMPTY_EVENT_BOOKING_SUMMARY: EventBookingSummary = {
  liveInk: false,
  liveHold: false,
  liveProspect: false,
  endedInk: false,
  endedHold: false,
};

export function summariseEventBookings(bookings: Iterable<EventBookingFacts>): EventBookingSummary {
  let liveInk = false;
  let liveHold = false;
  let liveProspect = false;
  let endedInk = false;
  let endedHold = false;
  for (const booking of bookings) {
    if (booking.deletedAt !== null) continue;
    const live = booking.status === "active";
    if (booking.kind === "ink") {
      if (live) liveInk = true;
      else endedInk = true;
    } else if (booking.kind === "hold") {
      if (live) liveHold = true;
      else endedHold = true;
    } else if (booking.kind === "prospect" && live) {
      liveProspect = true;
    }
  }
  return { liveInk, liveHold, liveProspect, endedInk, endedHold };
}

/** True when the Diary holds anything for the event, live or ended. */
export function diarySpeaksForEvent(summary: EventBookingSummary): boolean {
  return summary.liveInk || summary.liveHold || summary.liveProspect || summary.endedInk || summary.endedHold;
}

/**
 * The event's status as its bookings make it (the table at the top of this
 * file). People's later steps are kept: a confirmed event someone moved to
 * "in planning" stays there while its booking is live, and a draft someone
 * marked "proposed" stays proposed while its options are.
 */
export function deriveEventStatus(current: EventStatus, summary: EventBookingSummary): EventStatus {
  if (summary.liveInk) return CONFIRMED_SET.has(current) ? current : "confirmed";
  if (summary.liveHold || summary.liveProspect) return PIPELINE_SET.has(current) ? current : "draft";
  if (summary.endedInk) return "cancelled";
  if (summary.endedHold) return "lost";
  return current;
}

/** Whether a status someone asks for agrees with the event's bookings. A
 *  status the Diary would change straight back is refused, not stored. */
export function eventStatusAgreesWithDiary(requested: EventStatus, summary: EventBookingSummary): boolean {
  return deriveEventStatus(requested, summary) === requested;
}
