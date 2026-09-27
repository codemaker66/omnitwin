import { HallkeeperSheetSummarySchema, type HallkeeperSheetSummary } from "@omnitwin/types";
import { api } from "./client.js";

/** A setup sheet's ready-by time and rows checked, for the Day Board. The
 *  event scopes the time, as it does on the sheet itself. */
export async function getSheetSummary(configId: string, eventId: string | null, signal?: AbortSignal): Promise<HallkeeperSheetSummary> {
  const query = eventId === null ? "" : `?eventId=${encodeURIComponent(eventId)}`;
  return api.get(`/hallkeeper/${configId}/summary${query}`, HallkeeperSheetSummarySchema, signal);
}
