import {
  EventPhaseGraphSchema,
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
