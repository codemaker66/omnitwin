import { z } from "zod";
import { SlotObservationSchema, type RecordObservation, type SlotObservation } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The observation client (goal 19 S5).
//
// Facts about rooms, read for the board's day and written one tap at a time.
// Every response is validated against the shared schema, so a server that
// drifts is a loud error rather than a slab quietly reading nothing.
// ---------------------------------------------------------------------------

const ObservationListSchema = z.array(SlotObservationSchema);

/** Every fact about every booking that touches the window. */
export async function listVenueObservations(
  venueId: string,
  range: { readonly fromMs: number; readonly toMs: number },
  signal?: AbortSignal,
): Promise<readonly SlotObservation[]> {
  const params = new URLSearchParams({
    from: new Date(range.fromMs).toISOString(),
    to: new Date(range.toMs).toISOString(),
  });
  return api.get(
    `/venues/${encodeURIComponent(venueId)}/observations?${params.toString()}`,
    ObservationListSchema,
    signal,
  );
}

/** One tap. The key travels in the body AND the header, as a request's does;
 *  a replay returns the first fact under that key. */
export async function recordVenueObservation(
  venueId: string,
  input: RecordObservation,
): Promise<SlotObservation> {
  return api.post(
    `/venues/${encodeURIComponent(venueId)}/observations`,
    input,
    false,
    SlotObservationSchema,
    { idempotencyKey: input.idempotencyKey },
  );
}
