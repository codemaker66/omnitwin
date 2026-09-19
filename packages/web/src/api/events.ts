import {
  CreateEventConfigurationLinkSchema,
  EventConfigurationLinkSchema,
  EventPhaseGraphSchema,
  type CreateEvent,
  type CreateEventConfigurationLink,
  type EventConfigurationLink,
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

/**
 * Bind a saved layout to an event. The planner corridor calls this when it
 * opens a configuration carrying ?eventId, because Ops handoff compilation
 * refuses an event it has no recorded link to. The server is idempotent, so a
 * repeat open is a no-op rather than a duplicate row.
 */
export async function linkEventConfiguration(
  eventId: string,
  input: CreateEventConfigurationLink,
): Promise<EventConfigurationLink> {
  const payload = CreateEventConfigurationLinkSchema.parse(input);
  return api.post(
    `/events/${encodeURIComponent(eventId)}/configuration-links`,
    payload,
    false,
    EventConfigurationLinkSchema,
  );
}
