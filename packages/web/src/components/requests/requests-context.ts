import { createContext, useContext } from "react";
import type { RequestKind, RequestTransition, RequestUrgency, VenueRequest } from "@omnitwin/types";
import type { SlotRequestsProps } from "../../pages/hallkeeper/DayBoardPage.js";

// ---------------------------------------------------------------------------
// One store for every slab on the screen (Ship Friday slice 10).
//
// The Day Board can hold a dozen slots; each asking the API for its own
// requests would be a dozen fetches and a dozen sockets. Instead the provider
// holds ONE snapshot of the venue's open requests and hands each slot the
// slice that belongs to its booking. The import above is type-only on
// purpose: this leaf carries no runtime dependency on the board's page module.
// ---------------------------------------------------------------------------

export interface AskForSomething {
  readonly kind: RequestKind;
  readonly urgency: RequestUrgency;
  readonly quantity: number | null;
  readonly detail: string | null;
}

export interface SlotRequestsApi {
  readonly status: "loading" | "ready" | "error";
  /** The clock the slabs read. Refreshed whenever a snapshot lands, so an
   *  arrival is always judged against a current instant. */
  readonly nowMs: number;
  readonly requestsFor: (bookingId: string) => readonly VenueRequest[];
  readonly ask: (slot: SlotRequestsProps, input: AskForSomething) => void;
  readonly move: (request: VenueRequest, transition: RequestTransition) => void;
  /** The request currently being moved, so one slab shows work and the rest
   *  stay still. */
  readonly busyId: string | null;
  readonly asking: boolean;
  readonly error: string | null;
}

const EMPTY: readonly VenueRequest[] = [];

/** What a slab sees when no provider is mounted: nothing, calmly. */
export const SLOT_REQUESTS_UNAVAILABLE: SlotRequestsApi = {
  status: "loading",
  nowMs: 0,
  requestsFor: () => EMPTY,
  ask: () => { /* no provider mounted — nothing to send */ },
  move: () => { /* no provider mounted — nothing to send */ },
  busyId: null,
  asking: false,
  error: null,
};

export const SlotRequestsContext = createContext<SlotRequestsApi>(SLOT_REQUESTS_UNAVAILABLE);

export function useSlotRequests(): SlotRequestsApi {
  return useContext(SlotRequestsContext);
}
