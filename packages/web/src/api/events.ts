import {
  EventPhaseGraphSchema,
  type CreateEvent,
  type EventPhaseGraph,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Event API client
//
// Authenticated event planning data. The visual command shell uses this only
// when an eventId is provided; otherwise it stays on the internal demo fixture.
// ---------------------------------------------------------------------------

export async function getEventPhaseGraph(eventId: string): Promise<EventPhaseGraph> {
  return api.get(`/events/${eventId}/phase-graph`, EventPhaseGraphSchema);
}

/**
 * Create an event and its default phase scaffold. The server answers with the
 * whole phase graph, so the caller gets the new event's id without a second
 * round trip — that id is what links a Diary booking to its floor plan.
 */
export async function createEvent(input: CreateEvent): Promise<EventPhaseGraph> {
  return api.post("/events", input, undefined, EventPhaseGraphSchema);
}
