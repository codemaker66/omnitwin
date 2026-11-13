import {
  ForwardBookCheckSchema,
  ForwardBookResponseSchema,
  type ForwardBookCheck,
  type ForwardBookResponse,
} from "@omnitwin/types";
import { ApiError, api } from "./client.js";

// ---------------------------------------------------------------------------
// The forward book on the Diary, room by room (Blake, 17 October 2026: "hide
// date status until checked"). AI assistants and the website say whether a
// room has bookings on a date only while a record stands that the room's
// whole forward book is on the Diary. Everyone who reads the Diary may see
// where each room stands; the venue's admin or manager records or clears it.
// ---------------------------------------------------------------------------

function forwardBookPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/forward-book`;
}

export function listForwardBook(venueId: string, signal?: AbortSignal): Promise<ForwardBookResponse> {
  return api.get(forwardBookPath(venueId), ForwardBookResponseSchema, signal);
}

export function recordForwardBook(venueId: string, spaceId: string, note: string): Promise<ForwardBookCheck> {
  const trimmed = note.trim();
  return api.post(forwardBookPath(venueId), { spaceId, note: trimmed === "" ? null : trimmed }, undefined, ForwardBookCheckSchema);
}

export function clearForwardBook(venueId: string, checkId: string): Promise<ForwardBookCheck> {
  return api.post(`${forwardBookPath(venueId)}/${encodeURIComponent(checkId)}/clear`, undefined, undefined, ForwardBookCheckSchema);
}

/** The record as it stands, from a refusal that carries it: a colleague's
 *  record that already stands, or one already cleared. */
export function checkFromRefusal(error: unknown): ForwardBookCheck | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = ForwardBookCheckSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
