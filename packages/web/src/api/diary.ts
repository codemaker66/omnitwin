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
  return api.patch(`/bookings/${bookingId}`, patch, BookingSchema);
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
  return api.post("/bookings", input, undefined, BookingSchema);
}

export async function updateBooking(bookingId: string, patch: EditBookingPatch): Promise<Booking> {
  return api.patch(`/bookings/${bookingId}`, patch, BookingSchema);
}

export async function transitionBooking(
  bookingId: string,
  toState: BookingState,
  note?: string,
): Promise<Booking> {
  return api.post(`/bookings/${bookingId}/transition`, { toState, note }, undefined, BookingSchema);
}

export async function convertEnquiry(input: ConvertEnquiryInput): Promise<Booking> {
  return api.post("/bookings/from-enquiry", input, undefined, BookingSchema);
}
