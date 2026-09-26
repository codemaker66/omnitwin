import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { STAFF_AUDIENCE_ROLES, type RequestTransition, type VenueRequest } from "@omnitwin/types";
import { DayBoardSlotRequestsContext } from "../../pages/hallkeeper/DayBoardPage.js";
import { listVenueRequests, makeVenueRequest, moveVenueRequest } from "../../api/requests.js";
import { subscribeRequestsLive } from "../../lib/requests-live.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { SlotRequests } from "./SlotRequests.js";
import {
  SLOT_REQUESTS_UNAVAILABLE,
  SlotRequestsContext,
  type AskForSomething,
  type SlotRequestsApi,
} from "./requests-context.js";

// ---------------------------------------------------------------------------
// The requests provider (Ship Friday slice 10).
//
// Mounted once, above the router, so two things are true everywhere:
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

/** The same guard the mission record uses: a phone on a page served without
 *  a secure context has no randomUUID, and a request pressed there still
 *  needs a key the server can dedupe on. */
function mintKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const tail = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff_ffff).toString(16)}`
    .padEnd(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${tail}`;
}

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "That could not be sent — try again in a moment.";
}

export function RequestsProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const isStaff = user !== null && STAFF_AUDIENCE_ROLES.some((role) => role === user.role);
  const enabled = venueId !== null && isStaff;

  const [requests, setRequests] = useState<readonly VenueRequest[]>([]);
  const [status, setStatus] = useState<SlotRequestsApi["status"]>("loading");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic: a slow answer to an old question never lands on a newer one.
  const sequenceRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const refresh = useCallback((): void => {
    if (venueId === null || !isStaff) return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    void listVenueRequests(venueId, { status: "open" })
      .then((snapshot) => {
        if (sequence !== sequenceRef.current) return;
        setRequests(snapshot);
        setStatus("ready");
        // The clock moves with the snapshot, so a request that has just
        // arrived is judged fresh and the slot pulses exactly once.
        setNowMs(Date.now());
      })
      .catch(() => {
        if (sequence !== sequenceRef.current) return;
        setStatus("error");
      });
  }, [venueId, isStaff]);

  useEffect(() => {
    if (!enabled) {
      setRequests([]);
      setStatus("loading");
      return;
    }
    refresh();
  }, [enabled, refresh]);

  // The live channel. Every frame is a nudge to refetch, debounced so a burst
  // of activity is one request rather than five.
  useEffect(() => {
    if (!enabled) return;
    const scheduleRefresh = (): void => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        refresh();
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
  ): void => {
    if (venueId === null) return;
    setAsking(true);
    setError(null);
    void makeVenueRequest(venueId, {
      roomId: slot.roomId,
      bookingId: slot.bookingId,
      eventId: slot.eventId,
      kind: input.kind,
      urgency: input.urgency,
      quantity: input.quantity,
      detail: input.detail,
      idempotencyKey: mintKey(),
    })
      .then(merge)
      .catch((cause: unknown) => { setError(messageFor(cause)); })
      .finally(() => { setAsking(false); });
  }, [venueId, merge]);

  const move = useCallback((request: VenueRequest, transition: RequestTransition): void => {
    setBusyId(request.id);
    setError(null);
    void moveVenueRequest(request.id, transition)
      .then(merge)
      .catch((cause: unknown) => {
        setError(messageFor(cause));
        // Somebody else may have moved it — take the server's word for it.
        refresh();
      })
      .finally(() => { setBusyId(null); });
  }, [merge, refresh]);

  const value = useMemo<SlotRequestsApi>(
    () => enabled
      ? { status, nowMs, requestsFor, ask, move, busyId, asking, error }
      : SLOT_REQUESTS_UNAVAILABLE,
    [enabled, status, nowMs, requestsFor, ask, move, busyId, asking, error],
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
