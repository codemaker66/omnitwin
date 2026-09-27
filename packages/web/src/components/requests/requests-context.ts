import { createContext, useContext } from "react";
import type { RequestKind, RequestTransition, RequestUrgency, VenueRequest } from "@omnitwin/types";
import type { SlotRequestsProps } from "../../pages/hallkeeper/lib/slot-requests-contract.js";

// ---------------------------------------------------------------------------
// One store for every slab on the screen (Ship Friday slice 10).
//
// The Day Board can hold a dozen slots; each asking the API for its own
// requests would be a dozen fetches and a dozen sockets. Instead the provider
// holds ONE snapshot of the venue's open requests and hands each slot the
// slice that belongs to its booking. The slot's props come from the Day
// Board's contract leaf, type-only, so nothing here loads the board's page.
// ---------------------------------------------------------------------------

export interface AskForSomething {
  readonly kind: RequestKind;
  readonly urgency: RequestUrgency;
  readonly quantity: number | null;
  readonly detail: string | null;
  /** Minted once per composer, so pressing "Send it" again after a failure
   *  replays the same request instead of making a second one. */
  readonly idempotencyKey: string;
}

/** The last thing that could not be done, and where to say so: on the card of
 *  the request that would not move, or in the composer whose ask would not
 *  send (named by its idempotency key, so no other composer repeats it). */
export type SlotRequestFailure =
  | { readonly on: "request"; readonly requestId: string; readonly message: string }
  | { readonly on: "ask"; readonly idempotencyKey: string; readonly message: string };

/** The same guard the mission record uses: a phone on a page served without
 *  a secure context has no randomUUID, and a request pressed there still
 *  needs a key the server can dedupe on. */
export function mintRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const tail = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff_ffff).toString(16)}`
    .padEnd(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${tail}`;
}

export interface SlotRequestsApi {
  readonly status: "loading" | "ready" | "error";
  /** The clock the slabs read. Refreshed whenever a snapshot lands, so an
   *  arrival is always judged against a current instant. */
  readonly nowMs: number;
  readonly requestsFor: (bookingId: string) => readonly VenueRequest[];
  /** Ask for the venue's open requests again after a failed load. Resolves
   *  once the answer, or the failure, has landed. */
  readonly retry: () => Promise<void>;
  /** Resolves true once the request is made; false when it could not be
   *  sent, with the reason in `failure`, keyed to this ask. */
  readonly ask: (slot: SlotRequestsProps, input: AskForSomething) => Promise<boolean>;
  readonly move: (request: VenueRequest, transition: RequestTransition) => void;
  /** The request currently being moved, so one slab shows work and the rest
   *  stay still. */
  readonly busyId: string | null;
  /** The asks still travelling, by idempotency key, so only the composer
   *  that pressed "Send it" says "Sending…". */
  readonly askingKeys: ReadonlySet<string>;
  readonly failure: SlotRequestFailure | null;
}

const EMPTY: readonly VenueRequest[] = [];
const NONE_ASKING: ReadonlySet<string> = new Set<string>();

/** What a slab sees when no provider is mounted: nothing, calmly. */
export const SLOT_REQUESTS_UNAVAILABLE: SlotRequestsApi = {
  status: "loading",
  nowMs: 0,
  requestsFor: () => EMPTY,
  retry: () => Promise.resolve(),
  ask: () => Promise.resolve(false),
  move: () => { /* no provider mounted — nothing to send */ },
  busyId: null,
  askingKeys: NONE_ASKING,
  failure: null,
};

export const SlotRequestsContext = createContext<SlotRequestsApi>(SLOT_REQUESTS_UNAVAILABLE);

export function useSlotRequests(): SlotRequestsApi {
  return useContext(SlotRequestsContext);
}
