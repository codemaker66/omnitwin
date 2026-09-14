import { ClientEventScheduleSchema, type ClientEventSchedule } from "@omnitwin/types";
import { api } from "./client.js";

export async function getClientEventSchedule(
  eventId: string,
  configurationId?: string,
  signal?: AbortSignal,
): Promise<ClientEventSchedule> {
  const query = configurationId === undefined ? "" : `?${new URLSearchParams({ configurationId }).toString()}`;
  return api.get(`/events/${encodeURIComponent(eventId)}/client-schedule${query}`, ClientEventScheduleSchema, signal);
}
