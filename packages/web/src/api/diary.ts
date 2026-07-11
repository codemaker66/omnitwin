import {
  BookingSchema,
  CalendarResponseSchema,
  type Booking,
  type CalendarResponse,
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
