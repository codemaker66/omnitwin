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
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.create", commandId, payload: input }),
    () => api.post("/bookings", input, undefined, BookingSchema),
  );
}

export async function updateBooking(bookingId: string, patch: EditBookingPatch): Promise<Booking> {
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.update", commandId, bookingId, payload: patch }),
    () => api.patch(`/bookings/${bookingId}`, patch, BookingSchema),
  );
}

export async function transitionBooking(
  bookingId: string,
  toState: BookingState,
  note?: string,
): Promise<Booking> {
  return sendViaChannelOrRest(
    (commandId) => ({ kind: "booking.transition", commandId, bookingId, payload: { toState, note } }),
    () => api.post(`/bookings/${bookingId}/transition`, { toState, note }, undefined, BookingSchema),
  );
}

export async function convertEnquiry(input: ConvertEnquiryInput): Promise<Booking> {
  return api.post("/bookings/from-enquiry", input, undefined, BookingSchema);
}
