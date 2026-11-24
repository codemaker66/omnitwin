import { HallkeeperSheetSummarySchema, type HallkeeperSheetSummary } from "@omnitwin/types";
import { api } from "./client.js";

/** A setup sheet's ready-by time and rows checked, for the Day Board. The
 *  event scopes the time, as it does on the sheet itself. It asks for when
 *  setup starts too, which the server sends only when asked (#454): older web
 *  code reads this summary with a strict schema and must never meet the key. */
export async function getSheetSummary(configId: string, eventId: string | null, signal?: AbortSignal): Promise<HallkeeperSheetSummary> {
  const query = new URLSearchParams();
  if (eventId !== null) query.set("eventId", eventId);
  query.set("setupFrom", "true");
  return api.get(`/hallkeeper/${configId}/summary?${query.toString()}`, HallkeeperSheetSummarySchema, signal);
}
