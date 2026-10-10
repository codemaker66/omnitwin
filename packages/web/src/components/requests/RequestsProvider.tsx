import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { RequestTransition, VenueHandler, VenueRequest } from "@omnitwin/types";
import { DayBoardSlotRequestsContext } from "../../pages/hallkeeper/lib/slot-requests-contract.js";
import { listVenueHandlers, listVenueRequests, makeVenueRequest, moveVenueRequest } from "../../api/requests.js";
import { listensForFloorRequests, subscribeRequestsLive } from "../../lib/requests-live.js";
import { SlotRequests } from "./SlotRequests.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { chimeWorthy, playArrivalChime, rememberForChime, type ChimeMemory } from "./arrival-chime.js";
import {
  SLOT_REQUESTS_UNAVAILABLE,
  SlotRequestsContext,
  type AskForSomething,
  type SlotRequestFailure,
  type SlotRequestsApi,
} from "./requests-context.js";

// ---------------------------------------------------------------------------
// The requests provider (Ship Friday slice 10).
//
// Mounted around the Day Board by its route (pages/hallkeeper/DayBoardRoute),
// so two things are true on the board:
//
//   1. The Day Board finds a <SlotRequests> in its own context and renders it
//      in the region Lane 6 reserved. The board never learns anything about
//      requests; it hands over a slot's identity and that is the whole
//      contract.
//   2. There is ONE snapshot and ONE socket for the venue, however many slots
//      are on screen.
//
// It is inert for anybody who is not house staff with a venue: no fetch, no
// socket, no chrome. A client signing in pays nothing for this.
//
// Snapshot doctrine throughout: a live frame says "something changed", never
// what changed. The provider refetches and the server's answer is the truth.
// A late answer cannot overwrite a newer one — every response carries the
// sequence it was asked with, and a stale one is dropped on arrival.
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 30_000;
const REFETCH_DEBOUNCE_MS = 120;

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "That could not be sent — try again in a moment.";
}

export function RequestsProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const userId = user?.id ?? null;
  const userRole = user?.role ?? null;
  const isStaff = listensForFloorRequests(user);
  const enabled = venueId !== null && isStaff;

  const [requests, setRequests] = useState<readonly VenueRequest[]>([]);
  const [status, setStatus] = useState<SlotRequestsApi["status"]>("loading");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [askingKeys, setAskingKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [failure, setFailure] = useState<SlotRequestFailure | null>(null);

  // Monotonic: a slow answer to an old question never lands on a newer one.
  const sequenceRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  // The chime's memory of the last snapshot (goal 19 S4): which requests
  // were already known, and which were already escalated. Null until the
  // first snapshot, which chimes for nothing.
  const chimeMemory = useRef<ChimeMemory | null>(null);
  // The floor, read once per venue when a handover first asks for it.
  const handlersRef = useRef<Promise<readonly VenueHandler[]> | null>(null);

  // Resolves once the answer, or the failure, has landed, so a slot's
  // "Try again" shows work for exactly as long as there is work.
  const refresh = useCallback((): Promise<void> => {
    if (venueId === null || !isStaff) return Promise.resolve();
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    return listVenueRequests(venueId, { status: "open" })
      .then((snapshot) => {
        if (sequence !== sequenceRef.current) return;
        setRequests(snapshot);
        setStatus("ready");
        // The clock moves with the snapshot, so a request that has just
        // arrived is judged fresh and the slot pulses exactly once.
        setNowMs(Date.now());
        // One chime per arrival that is not this person's own ask, one per
        // escalation to this administrator; the first snapshot is silent.
        if (userId !== null && userRole !== null) {
          const decision = chimeWorthy(chimeMemory.current, snapshot, { id: userId, role: userRole });
          if (decision.arrivals.length > 0 || decision.escalations.length > 0) playArrivalChime();
        }
        chimeMemory.current = rememberForChime(snapshot);
      })
      .catch(() => {
        if (sequence !== sequenceRef.current) return;
        setStatus("error");
      });
  }, [venueId, isStaff, userId, userRole]);

  useEffect(() => {
    if (!enabled) {
      setRequests([]);
      setStatus("loading");
      chimeMemory.current = null;
      handlersRef.current = null;
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const handlers = useCallback((): Promise<readonly VenueHandler[]> => {
    if (venueId === null || !isStaff) return Promise.resolve([]);
    if (handlersRef.current === null) {
      // A failed read is not kept: the next press asks again.
      handlersRef.current = listVenueHandlers(venueId).catch((cause: unknown) => {
        handlersRef.current = null;
        throw cause;
      });
    }
    return handlersRef.current;
  }, [venueId, isStaff]);

  // The live channel. Every frame is a nudge to refetch, debounced so a burst
  // of activity is one request rather than five.
  useEffect(() => {
    if (!enabled) return;
    const scheduleRefresh = (): void => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void refresh();
      }, REFETCH_DEBOUNCE_MS);
    };
    const unsubscribe = subscribeRequestsLive((event) => {
      if (event.kind === "request" && event.venueId === venueId) scheduleRefresh();
      // A reconnect replays the snapshot rather than trusting what was missed.
      if (event.kind === "reconnected") scheduleRefresh();
    });
    return () => {
      unsubscribe();
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [enabled, venueId, refresh]);

  // A slow clock for "four minutes ago". Never per frame.
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => { setNowMs(Date.now()); }, CLOCK_TICK_MS);
    return () => { window.clearInterval(timer); };
  }, [enabled]);

  const merge = useCallback((updated: VenueRequest): void => {
    setRequests((current) => {
      const withoutIt = current.filter((item) => item.id !== updated.id);
      // A finished request leaves the slab; everything else stays, newest first.
      if (updated.state === "resolved") return withoutIt;
      return [updated, ...withoutIt].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    });
    setNowMs(Date.now());
    // What this phone wrote is known to it: the next snapshot does not chime for it.
    if (chimeMemory.current !== null) {
      chimeMemory.current = new Map(chimeMemory.current).set(updated.id, updated.escalatedAt);
    }
  }, []);

  const byBooking = useMemo(() => {
    const map = new Map<string, VenueRequest[]>();
    for (const request of requests) {
      if (request.bookingId === null) continue;
      const list = map.get(request.bookingId) ?? [];
      list.push(request);
      map.set(request.bookingId, list);
    }
    return map;
  }, [requests]);

  const requestsFor = useCallback(
    (bookingId: string): readonly VenueRequest[] => byBooking.get(bookingId) ?? [],
    [byBooking],
  );

  const ask = useCallback((
    slot: { readonly bookingId: string; readonly eventId: string | null; readonly roomId: string },
    input: AskForSomething,
  ): Promise<boolean> => {
    if (venueId === null) return Promise.resolve(false);
    const key = input.idempotencyKey;
    setAskingKeys((current) => new Set(current).add(key));
    setFailure(null);
    return makeVenueRequest(venueId, {
      roomId: slot.roomId,
      bookingId: slot.bookingId,
      eventId: slot.eventId,
      kind: input.kind,
      urgency: input.urgency,
      quantity: input.quantity,
      detail: input.detail,
      idempotencyKey: key,
    })
      .then((made) => {
        merge(made);
        return true;
      })
      .catch((cause: unknown) => {
        setFailure({ on: "ask", idempotencyKey: key, message: messageFor(cause) });
        return false;
      })
      .finally(() => {
        setAskingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  }, [venueId, merge]);

  const move = useCallback((request: VenueRequest, transition: RequestTransition): void => {
    setBusyId(request.id);
    setFailure(null);
    void moveVenueRequest(request.id, transition)
      .then(merge)
      .catch((cause: unknown) => {
        setFailure({ on: "request", requestId: request.id, message: messageFor(cause) });
        // Somebody else may have moved it — take the server's word for it.
        void refresh();
      })
      .finally(() => { setBusyId(null); });
  }, [merge, refresh]);

  const value = useMemo<SlotRequestsApi>(
    () => enabled
      ? { status, nowMs, requests, requestsFor, retry: refresh, ask, move, busyId, askingKeys, failure, handlers }
      : SLOT_REQUESTS_UNAVAILABLE,
    [enabled, status, nowMs, requests, requestsFor, refresh, ask, move, busyId, askingKeys, failure, handlers],
  );

  return (
    <SlotRequestsContext.Provider value={value}>
      <DayBoardSlotRequestsContext.Provider value={enabled ? SlotRequests : null}>
        {children}
      </DayBoardSlotRequestsContext.Provider>
    </SlotRequestsContext.Provider>
  );
}

export default RequestsProvider;
