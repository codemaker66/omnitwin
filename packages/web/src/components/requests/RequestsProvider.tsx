import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { summariseRequest, type RequestTransition, type VenueHandler, type VenueRequest } from "@omnitwin/types";
import { DayBoardSlotRequestsContext } from "../../pages/hallkeeper/lib/slot-requests-contract.js";
import { ApiError } from "../../api/client.js";
import { listVenueHandlers, listVenueRequests, makeVenueRequest, moveVenueRequest } from "../../api/requests.js";
import {
  drainEventDayOps,
  enqueueEventDayRequestStep,
  listPendingEventDayOps,
  type QueuedRequestStep,
} from "../../lib/event-day-offline-queue.js";
import { listensForFloorRequests, subscribeRequestsLive } from "../../lib/requests-live.js";
import { SlotRequests } from "./SlotRequests.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { chimeWorthy, playArrivalChime, rememberForChime, type ChimeMemory } from "../../lib/sound-registry.js";
import {
  SLOT_REQUESTS_UNAVAILABLE,
  SlotRequestsContext,
  mintRequestKey,
  stepWords,
  type AskForSomething,
  type ReplayNotice,
  type SlotRequestFailure,
  type SlotRequestsApi,
  type WaitingStep,
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
//
// Offline (L9). Every step pressed on a slab carries a key minted at the
// press. A step that cannot reach the server for want of a connection waits
// in the event-day offline queue under that key, with who pressed it, and is
// said beside its card ("Waiting to send: I'll do it"); it is never shown as
// done, because it is not. A press on a request whose earlier steps still
// wait joins the queue behind them, so the server meets them in the order
// they were pressed. The queue is replayed when the board opens, when the
// socket or the browser comes back, and every 30 s while anything waits:
// a step the server already had is a replay of that step, never a second
// one; a step someone else's move overtook, or one the server refuses this
// person, leaves the queue and is said on its slot ("Graham has this"); a
// step that still cannot be sent stops the replay, so the order holds. A
// step pressed by someone else waits for them: it is never sent in the name
// of whoever is signed in now.
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 30_000;
const REFETCH_DEBOUNCE_MS = 120;
/** How often the queue is tried again while a step waits and no reconnect comes. */
const STEP_RETRY_MS = 30_000;

const NO_STEPS: readonly WaitingStep[] = [];
const NO_NOTICES: readonly ReplayNotice[] = [];

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "That could not be sent — try again in a moment.";
}

type StepFailure = "connection" | "session" | "recorded" | "refused";

/** What a failed step means for the press. */
function classifyStepFailure(cause: unknown): StepFailure {
  // The client wraps a failed fetch and every non-2xx in an ApiError; what
  // reaches here unwrapped is a 2xx whose body could not be read, so the
  // server has the step.
  if (!(cause instanceof ApiError)) return "recorded";
  if (cause.code === "NETWORK_ERROR") return "connection";
  if (cause.code === "RESPONSE_VALIDATION_ERROR") return "recorded";
  // A session to renew: the step waits for the person to be signed in again.
  if (cause.status === 401) return "session";
  if (cause.status === 408 || cause.status === 429 || cause.status >= 500) return "connection";
  // 403, 404, 409 and the rest: the server has answered this press for good.
  return "refused";
}

/** Why a replayed step was not done, in the words of the person reading it. */
function refusalWords(op: QueuedRequestStep, cause: unknown): string {
  const step = `Your “${stepWords(op.transition)}” on ${op.summary} was not sent.`;
  if (cause instanceof ApiError && cause.status === 403) {
    return `${step} This account can no longer act on this venue’s requests.`;
  }
  if (cause instanceof ApiError && cause.status === 404) {
    return `${step} This request is no longer on the board.`;
  }
  return `${step} ${messageFor(cause)}`;
}

export function RequestsProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const userId = user?.id ?? null;
  const userName = user?.name ?? null;
  const userRole = user?.role ?? null;
  const isStaff = listensForFloorRequests(user);
  const enabled = venueId !== null && isStaff;

  const [requests, setRequests] = useState<readonly VenueRequest[]>([]);
  const [status, setStatus] = useState<SlotRequestsApi["status"]>("loading");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [askingKeys, setAskingKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [failure, setFailure] = useState<SlotRequestFailure | null>(null);
  // L9: this venue's steps waiting in the offline queue, by request, and
  // what the queue's replay could not do.
  const [waiting, setWaiting] = useState<ReadonlyMap<string, readonly WaitingStep[]>>(() => new Map());
  const [notices, setNotices] = useState<readonly ReplayNotice[]>(NO_NOTICES);

  // Monotonic: a slow answer to an old question never lands on a newer one.
  const sequenceRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  // The chime's memory of the last snapshot (goal 19 S4): which requests
  // were already known, and which were already escalated. Null until the
  // first snapshot, which chimes for nothing.
  const chimeMemory = useRef<ChimeMemory | null>(null);
  // The floor, read once per venue when a handover first asks for it.
  const handlersRef = useRef<Promise<readonly VenueHandler[]> | null>(null);
  // One replay of the queue at a time; a second caller waits for the first.
  const drainRef = useRef<Promise<void> | null>(null);

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

  // The queue is the truth about what waits: this venue's steps, by request,
  // in the order they were pressed.
  const readWaiting = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    return listPendingEventDayOps()
      .then((ops) => {
        const byRequest = new Map<string, WaitingStep[]>();
        for (const op of ops) {
          if (op.kind !== "request_step" || op.venueId !== venueId) continue;
          const list = byRequest.get(op.requestId) ?? [];
          list.push({
            commandId: op.commandId,
            transition: op.transition,
            authorUserId: op.authorUserId,
            authorName: op.authorName,
          });
          byRequest.set(op.requestId, list);
        }
        setWaiting(byRequest);
      })
      .catch(() => undefined);
  }, [enabled, venueId]);

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

  // Replay this venue's waiting steps, as the person who pressed them, in the
  // order they were pressed; everything else in the queue is left for the
  // screen or the person it belongs to.
  const drain = useCallback((): Promise<void> => {
    if (!enabled || userId === null) return Promise.resolve();
    if (drainRef.current !== null) return drainRef.current;
    const refused: ReplayNotice[] = [];
    let answered = false;
    const run = drainEventDayOps((op) => {
      if (op.kind !== "request_step" || op.venueId !== venueId || op.authorUserId !== userId) {
        return Promise.resolve("left" as const);
      }
      return moveVenueRequest(op.requestId, op.transition, op.commandId)
        .then((moved) => {
          answered = true;
          merge(moved);
          return "applied" as const;
        })
        .catch((cause: unknown) => {
          const failure = classifyStepFailure(cause);
          // Still no way through: the replay stops here, so the order holds.
          if (failure === "connection" || failure === "session") throw cause;
          answered = true;
          if (failure === "recorded") return "applied" as const;
          if (op.bookingId !== null) {
            refused.push({ id: op.commandId, bookingId: op.bookingId, requestId: op.requestId, message: refusalWords(op, cause) });
          }
          return "refused" as const;
        });
    })
      .catch(() => undefined)
      .then(() => {
        if (refused.length > 0) setNotices((current) => [...current, ...refused]);
        // The server's answer is the truth: what it took and what it refused
        // are read again together.
        return readWaiting().then(() => (answered ? refresh() : undefined));
      })
      .finally(() => { drainRef.current = null; });
    drainRef.current = run;
    return run;
  }, [enabled, venueId, userId, merge, readWaiting, refresh]);

  // The queue's steps stand from the moment the board opens, and are tried
  // at once; and again whenever the browser says it is back online.
  useEffect(() => {
    if (!enabled) {
      setWaiting(new Map());
      setNotices(NO_NOTICES);
      return;
    }
    void readWaiting().then(() => drain());
    const onOnline = (): void => { void drain(); };
    window.addEventListener("online", onOnline);
    // The socket coming back is the surest sign the floor can be reached.
    const unsubscribe = subscribeRequestsLive((event) => {
      if (event.kind === "reconnected") void drain();
    });
    return () => {
      window.removeEventListener("online", onOnline);
      unsubscribe();
    };
  }, [enabled, readWaiting, drain]);

  // A step queued on a server blip has no reconnect to wait for: while any
  // of this person's steps wait, the queue is tried again every so often.
  const mineWaiting = useMemo(() => {
    let count = 0;
    for (const steps of waiting.values()) count += steps.filter((step) => step.authorUserId === userId).length;
    return count;
  }, [waiting, userId]);
  useEffect(() => {
    if (!enabled || mineWaiting === 0) return;
    const timer = window.setInterval(() => { void drain(); }, STEP_RETRY_MS);
    return () => { window.clearInterval(timer); };
  }, [enabled, mineWaiting, drain]);

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

  // Keep a press for later, under the key it was pressed with (L9).
  const keep = useCallback((request: VenueRequest, transition: RequestTransition, commandId: string): Promise<void> => {
    if (venueId === null || userId === null) return Promise.reject(new Error("No venue to keep this for."));
    return enqueueEventDayRequestStep({
      venueId,
      requestId: request.id,
      bookingId: request.bookingId,
      summary: summariseRequest({ kind: request.kind, quantity: request.quantity }),
      transition,
      commandId,
      authorUserId: userId,
      authorName: userName ?? "A colleague",
    }).then(() => readWaiting());
  }, [venueId, userId, userName, readWaiting]);

  const move = useCallback((request: VenueRequest, transition: RequestTransition): void => {
    // One key per press: sending it again is this press again, never a second step.
    const commandId = mintRequestKey();
    setBusyId(request.id);
    setFailure(null);
    const cannotKeep = (): void => {
      setFailure({
        on: "request",
        requestId: request.id,
        message: "This could not be sent or kept to send later — try again when the connection is back.",
      });
    };
    // This person's earlier steps on this request still wait: this one waits
    // behind them, so the server meets them in the order they were pressed.
    // A colleague's waiting step is theirs to send and holds nothing back.
    if (waiting.get(request.id)?.some((step) => step.authorUserId === userId) === true) {
      void keep(request, transition, commandId)
        // A replay already under way listed the queue before this press:
        // the second asks again once it has finished.
        .then(() => drain())
        .then(() => drain())
        .catch(cannotKeep)
        .finally(() => { setBusyId(null); });
      return;
    }
    void moveVenueRequest(request.id, transition, commandId)
      .then(merge)
      .catch((cause: unknown) => {
        const failure = classifyStepFailure(cause);
        // The server has it; its next snapshot says so.
        if (failure === "recorded") return refresh();
        // No connection: the press waits, said beside its card, and goes
        // when the floor can be reached.
        if (failure === "connection") return keep(request, transition, commandId).catch(cannotKeep);
        setFailure({ on: "request", requestId: request.id, message: messageFor(cause) });
        // Somebody else may have moved it — take the server's word for it.
        return refresh();
      })
      .finally(() => { setBusyId(null); });
  }, [merge, refresh, keep, drain, waiting, userId]);

  const waitingSteps = useCallback(
    (requestId: string): readonly WaitingStep[] => waiting.get(requestId) ?? NO_STEPS,
    [waiting],
  );
  const replayNotices = useCallback(
    (bookingId: string): readonly ReplayNotice[] => {
      const here = notices.filter((notice) => notice.bookingId === bookingId);
      return here.length === 0 ? NO_NOTICES : here;
    },
    [notices],
  );
  const dismissNotice = useCallback((noticeId: string): void => {
    setNotices((current) => current.filter((notice) => notice.id !== noticeId));
  }, []);

  const value = useMemo<SlotRequestsApi>(
    () => enabled
      ? {
        status, nowMs, requests, requestsFor, retry: refresh, ask, move, busyId, askingKeys, failure, handlers,
        waitingSteps, replayNotices, dismissNotice,
      }
      : SLOT_REQUESTS_UNAVAILABLE,
    [
      enabled, status, nowMs, requests, requestsFor, refresh, ask, move, busyId, askingKeys, failure, handlers,
      waitingSteps, replayNotices, dismissNotice,
    ],
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
