import { z } from "zod";
import {
  VenueHandlerSchema,
  VenueRequestSchema,
  type CreateVenueRequest,
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

export async function moveVenueRequest(
  requestId: string,
  transition: RequestTransition,
): Promise<VenueRequest> {
  return api.patch(`/requests/${encodeURIComponent(requestId)}`, transition, VenueRequestSchema);
}
