import {
  BookingSchema,
  CalendarResponseSchema,
  type Booking,
  type BookingState,
  type CalendarResponse,
  type ConvertEnquiryInput,
  type CreateBookingInput,
} from "@omnitwin/types";
import { api } from "./client.js";
import { sendViaChannelOrRest } from "../pages/diary/lib/diary-command-channel.js";

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

export async function transitionBooking(
  bookingId: string,
  toState: BookingState,
  note?: string,
): Promise<Booking> {
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.transition", commandId, bookingId, payload: { toState, note } }),
    (commandId) =>
      api.post(`/bookings/${bookingId}/transition`, { toState, note }, undefined, BookingSchema, {
        idempotencyKey: commandId,
      }),
  );
}

export async function convertEnquiry(input: ConvertEnquiryInput): Promise<Booking> {
  return api.post("/bookings/from-enquiry", input, undefined, BookingSchema);
}
