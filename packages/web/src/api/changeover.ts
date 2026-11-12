import { ChangeoverSchema, type Changeover } from "@omnitwin/types";
import { api } from "./client.js";

/**
 * What moves when a room goes from one booking's layout to the next one's:
 * the two layouts' configuration ids, and the events that scope their hours.
 */
export async function getChangeover(
  input: { readonly from: string; readonly to: string; readonly fromEventId: string | null; readonly toEventId: string | null },
  signal?: AbortSignal,
): Promise<Changeover> {
  const params = new URLSearchParams({ from: input.from, to: input.to });
  if (input.fromEventId !== null) params.set("fromEventId", input.fromEventId);
  if (input.toEventId !== null) params.set("toEventId", input.toEventId);
  return api.get(`/hallkeeper/changeover?${params.toString()}`, ChangeoverSchema, signal);
}
