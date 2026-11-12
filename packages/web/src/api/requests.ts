import { z } from "zod";
import {
  HandoverShiftResultSchema,
  VenueHandlerSchema,
  VenueRequestSchema,
  type CreateVenueRequest,
  type HandoverShiftResult,
  type RequestTransition,
  type VenueHandler,
  type VenueRequest,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The request client (Ship Friday slice 10; goal 19 S4 adds the handlers).
//
// Every response is validated against the shared schema, so a server that
// drifts is a loud error rather than a slab quietly rendering nothing.
// ---------------------------------------------------------------------------

const RequestListSchema = z.array(VenueRequestSchema);
const HandlerListSchema = z.array(VenueHandlerSchema);

/** The people a request can be handed to, for the picker on the slab. */
export async function listVenueHandlers(venueId: string, signal?: AbortSignal): Promise<readonly VenueHandler[]> {
  return api.get(`/venues/${encodeURIComponent(venueId)}/handlers`, HandlerListSchema, signal);
}

/** Goal 19 S7: every open request the signed-in person holds, handed to one
 *  named relief in one go. The answer names who and lists what. */
export async function handoverShift(venueId: string, toUserId: string): Promise<HandoverShiftResult> {
  return api.post(
    `/venues/${encodeURIComponent(venueId)}/requests/handover`,
    { toUserId },
    false,
    HandoverShiftResultSchema,
  );
}

export async function listVenueRequests(
  venueId: string,
  options: {
    readonly status?: "open" | "all";
    readonly bookingId?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<readonly VenueRequest[]> {
  const params = new URLSearchParams({ status: options.status ?? "open", limit: "200" });
  if (options.bookingId !== undefined) params.set("bookingId", options.bookingId);
  return api.get(
    `/venues/${encodeURIComponent(venueId)}/requests?${params.toString()}`,
    RequestListSchema,
    options.signal,
  );
}

export async function makeVenueRequest(
  venueId: string,
  input: CreateVenueRequest,
): Promise<VenueRequest> {
  // The key travels in the body AND the header: the body is the record, the
  // header is the house convention. A replay returns the same request.
  return api.post(
    `/venues/${encodeURIComponent(venueId)}/requests`,
    input,
    false,
    VenueRequestSchema,
    { idempotencyKey: input.idempotencyKey },
  );
}

/** One step on the ladder. The commandId is minted at the press and sent as
 *  the Idempotency-Key, so sending it again (a lost answer, or the offline
 *  queue's replay) is that press again on the server's ledger, never a
 *  second step (L9). */
export async function moveVenueRequest(
  requestId: string,
  transition: RequestTransition,
  commandId: string,
): Promise<VenueRequest> {
  return api.patch(`/requests/${encodeURIComponent(requestId)}`, transition, VenueRequestSchema, {
    idempotencyKey: commandId,
  });
}
