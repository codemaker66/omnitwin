import { createContext, useContext } from "react";
import {
  nextRequestState,
  type RequestKind,
  type RequestOutcome,
  type RequestState,
  type RequestTransition,
  type RequestUrgency,
  type VenueHandler,
  type VenueRequest,
} from "@omnitwin/types";
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

/** L9: a step pressed on this device that waits in the offline queue. It is
 *  not the server's yet, so it never changes what the card says the request
 *  is; it is said beside it, in the words of the button that was pressed. */
export interface WaitingStep {
  readonly commandId: string;
  readonly transition: RequestTransition;
  readonly authorUserId: string;
  readonly authorName: string;
}

/** L9: what a replay of the queue could not do, said on the slot it was
 *  about until the person reading it puts it away. */
export interface ReplayNotice {
  readonly id: string;
  readonly bookingId: string;
  readonly requestId: string;
  readonly message: string;
}

/** Where a request stands once this person's waiting steps land: the state
 *  the next press is pressed against, and whether they will own it. Only for
 *  what to offer and what a kept press expects; the card says what the
 *  server says. */
export function projectRequest(
  request: Pick<VenueRequest, "state" | "ownerUserId">,
  steps: readonly WaitingStep[],
  meId: string | null,
): { readonly state: RequestState; readonly mine: boolean } {
  let state = request.state;
  let mine = request.ownerUserId !== null && request.ownerUserId === meId;
  for (const step of steps) {
    if (step.authorUserId !== meId || !nextRequestState(state, step.transition.to).ok) continue;
    state = step.transition.to;
    if (state === "accepted") mine = true;
  }
  return { state, mine };
}

const OUTCOME_WORDS: Readonly<Record<RequestOutcome, string>> = {
  done: "Done",
  not_possible: "Could not",
  no_longer_needed: "Not needed",
  substituted: "Done another way",
};

/** A step in the words of the slab button that makes it. */
export function stepWords(transition: RequestTransition): string {
  switch (transition.to) {
    case "acknowledged":
      return "Seen";
    case "accepted":
      return "I’ll do it";
    case "underway":
      return "On it";
    case "handed-over":
      return "Hand over";
    case "resolved":
      return OUTCOME_WORDS[transition.outcome];
    case "reopened":
      return "Reopen";
    default: {
      const exhausted: never = transition;
      throw new Error(`Unhandled step ${String(exhausted)}`);
    }
  }
}

/** A v4 UUID for a press. A phone on a page served without a secure context
 *  has no randomUUID, but it has getRandomValues, so the key is as random
 *  there as anywhere: it lands in a ledger shared by the whole house. */
export function mintRequestKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface SlotRequestsApi {
  readonly status: "loading" | "ready" | "error";
  /** The clock the slabs read. Refreshed whenever a snapshot lands, so an
   *  arrival is always judged against a current instant. */
  readonly nowMs: number;
  /** Every open request in the venue (goal 19 S3): the board derives each
   *  slot's ring and the UNOWNED rail from this one list. */
  readonly requests: readonly VenueRequest[];
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
  /** The people a request can be handed to (goal 19 S4), read once per board
   *  and kept; a failed read rejects, so the picker can say so and ask again. */
  readonly handlers: () => Promise<readonly VenueHandler[]>;
  /** L9: this device's steps on one request still waiting in the offline
   *  queue, in the order they were pressed. */
  readonly waitingSteps: (requestId: string) => readonly WaitingStep[];
  /** L9: what the queue's replay could not do on this slot's requests. */
  readonly replayNotices: (bookingId: string) => readonly ReplayNotice[];
  readonly dismissNotice: (noticeId: string) => void;
}

const EMPTY: readonly VenueRequest[] = [];
const NO_HANDLERS: readonly VenueHandler[] = [];
const NONE_ASKING: ReadonlySet<string> = new Set<string>();
const NO_STEPS: readonly WaitingStep[] = [];
const NO_NOTICES: readonly ReplayNotice[] = [];

/** What a slab sees when no provider is mounted: nothing, calmly. */
export const SLOT_REQUESTS_UNAVAILABLE: SlotRequestsApi = {
  status: "loading",
  nowMs: 0,
  requests: EMPTY,
  requestsFor: () => EMPTY,
  retry: () => Promise.resolve(),
  ask: () => Promise.resolve(false),
  move: () => { /* no provider mounted — nothing to send */ },
  busyId: null,
  askingKeys: NONE_ASKING,
  failure: null,
  handlers: () => Promise.resolve(NO_HANDLERS),
  waitingSteps: () => NO_STEPS,
  replayNotices: () => NO_NOTICES,
  dismissNotice: () => { /* no provider mounted — nothing was said */ },
};

export const SlotRequestsContext = createContext<SlotRequestsApi>(SLOT_REQUESTS_UNAVAILABLE);

export function useSlotRequests(): SlotRequestsApi {
  return useContext(SlotRequestsContext);
}
