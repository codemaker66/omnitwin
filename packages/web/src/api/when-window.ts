import {
  RoomDaySchema,
  ScheduleSlotSchema,
  type ClientEventScheduleSlot,
  type ProposeWindow,
  type RoomDay,
  type RoomDayQuery,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The When ribbon's two doors (goal 19 S6).
//
// getRoomDay: where the room is already spoken for on a venue day, as the
// client's side may see it (their own slot by name, everyone else as an
// anonymous span) with the venue's turnaround. The strict RoomDaySchema is
// the client-side half of the privacy pin: a server that leaked a name on an
// anonymous span would fail validation here, loudly, rather than render.
//
// proposeWindow: the client's side says when; the house holds it. One PUT
// for the first proposal and for moving it, keyed by the gesture so a retry
// is the same proposal. The body carries the key and so does the header, as
// the conversation doors do.
// ---------------------------------------------------------------------------

export async function getRoomDay(eventId: string, query: RoomDayQuery, signal?: AbortSignal): Promise<RoomDay> {
  const params = new URLSearchParams({ spaceId: query.spaceId, day: query.day });
  return api.get(`/events/${encodeURIComponent(eventId)}/room-day?${params.toString()}`, RoomDaySchema, signal);
}

export async function proposeWindow(
  eventId: string,
  input: ProposeWindow,
  signal?: AbortSignal,
): Promise<ClientEventScheduleSlot> {
  return api.put(
    `/events/${encodeURIComponent(eventId)}/proposed-window`,
    input,
    ScheduleSlotSchema,
    { idempotencyKey: input.idempotencyKey, signal },
  );
}
