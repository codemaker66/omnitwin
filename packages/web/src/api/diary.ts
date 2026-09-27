import { z } from "zod";
import {
  BookingSchema,
  CalendarResponseSchema,
  DiaryAckResequenceSchema,
  type Booking,
  type BookingState,
  type CalendarResponse,
  type ConvertEnquiryInput,
  type CreateBookingInput,
  type DiaryCommandAck,
  type TransitionHoldInput,
} from "@omnitwin/types";
import { api } from "./client.js";
import { sendCommandViaChannelOrRest, sendViaChannelOrRest } from "../pages/diary/lib/diary-command-channel.js";

// ---------------------------------------------------------------------------
// Diary API client (T-493). One read model for every calendar view, plus the
// Board's move mutation. Responses are Zod-validated against the shared
// schemas — the same objects the server parsed on its way out.
// ---------------------------------------------------------------------------

export async function getCalendar(
  venueId: string,
  fromIso: string,
  toIso: string,
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ venueId, from: fromIso, to: toIso });
  return api.get(`/calendar?${params.toString()}`, CalendarResponseSchema, signal);
}

export interface MoveBookingPatch {
  readonly spaceId?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export async function moveBooking(bookingId: string, patch: MoveBookingPatch): Promise<Booking> {
  // A move IS an update whose patch is the space/time subset — one code
  // path, one envelope shape (reviewer P2, T-537).
  return updateBooking(bookingId, patch);
}

export interface EditBookingPatch extends MoveBookingPatch {
  readonly title?: string;
  readonly eventType?: string | null;
  readonly rank?: number;
  readonly jointFlag?: boolean;
  readonly decisionAt?: string;
  readonly ownerUserId?: string;
  readonly nextAction?: string;
  readonly nextActionDueAt?: string;
  /** The booking's own note; null erases it (T-619). */
  readonly notes?: string | null;
  /** The floor plan attached to this booking, or null to detach it. The API
   *  has always accepted this (UpdateBookingSchema → updateBookingCore, which
   *  verifies the event belongs to the booking's venue); nothing in the client
   *  ever sent it, so the Diary and the planner stayed strangers. */
  readonly eventId?: string | null;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  // T-538: the REST fallback carries the SAME commandId as an
  // Idempotency-Key, so a channel attempt and its retry are ONE operation
  // to the server's ledger — a committed-but-unacked create replays
  // instead of duplicating.
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.create", commandId, payload: input }),
    (commandId) =>
      api.post("/bookings", input, undefined, BookingSchema, { idempotencyKey: commandId }),
  );
}

export async function updateBooking(bookingId: string, patch: EditBookingPatch): Promise<Booking> {
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.update", commandId, bookingId, payload: patch }),
    (commandId) =>
      api.patch(`/bookings/${bookingId}`, patch, BookingSchema, { idempotencyKey: commandId }),
  );
}

/** A hold that became 1st option because another left its date. */
export interface PromotedHold {
  readonly id: string;
  readonly title: string;
}

export interface TransitionOutcome {
  readonly booking: Booking;
  /** Every hold now 1st option on a date this booking left: the API
   *  resequences the ladder when a hold goes (`resequence.promotedToFirst`). */
  readonly promotedToFirst: readonly PromotedHold[];
}

const TransitionReplySchema = z.object({
  data: BookingSchema,
  resequence: DiaryAckResequenceSchema.optional(),
});

function promotions(resequence: z.infer<typeof DiaryAckResequenceSchema> | undefined): readonly PromotedHold[] {
  return (resequence?.promotedToFirst ?? []).map((hold) => ({ id: hold.id, title: hold.title }));
}

function outcomeFromAck(ack: DiaryCommandAck): TransitionOutcome | undefined {
  return ack.booking === undefined ? undefined : { booking: ack.booking, promotedToFirst: promotions(ack.resequence) };
}

export async function transitionBooking(
  bookingId: string,
  toState: BookingState,
  note?: string,
  /** A booking made provisional carries the hold's details (roadmap N3). */
  hold?: TransitionHoldInput,
): Promise<TransitionOutcome> {
  return sendCommandViaChannelOrRest(
    (commandId) => ({ kind: "booking.transition", commandId, bookingId, payload: { toState, note, hold } }),
    (commandId) =>
      api.post(`/bookings/${bookingId}/transition`, { toState, note, hold }, undefined, TransitionReplySchema, {
        idempotencyKey: commandId,
        keepEnvelope: true,
      }).then((reply) => ({ booking: reply.data, promotedToFirst: promotions(reply.resequence) })),
    outcomeFromAck,
  );
}

export async function convertEnquiry(input: ConvertEnquiryInput): Promise<Booking> {
  return api.post("/bookings/from-enquiry", input, undefined, BookingSchema);
}
