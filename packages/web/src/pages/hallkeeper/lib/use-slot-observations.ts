import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObservationKind, RecordObservation, SlotObservation } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { listVenueObservations, recordVenueObservation } from "../../../api/observations.js";
import { correctedNowMs } from "../../../lib/clock-offset.js";
import {
  drainEventDayOps,
  enqueueEventDayObservation,
  listPendingEventDayOps,
} from "../../../lib/event-day-offline-queue.js";
import { subscribeRequestsLive } from "../../../lib/requests-live.js";

// ---------------------------------------------------------------------------
// The board's facts about its rooms (goal 19 S5; D1, D10, D12).
//
// One snapshot for the day, refetched when a fact lands anywhere in the
// venue (the live frame says something changed, never what) and after a
// reconnect. A tap is sent at once with its own key and the corrected
// clock's time; if the send fails for want of a connection the fact stands
// on this screen with that time and waits in the offline queue, which drains
// in tap order when the socket or the browser comes back. A fact the server
// refuses for good (a booking that is gone) leaves the queue rather than
// block the taps behind it. Nothing here writes a time on a booking.
// ---------------------------------------------------------------------------

const REFETCH_DEBOUNCE_MS = 120;

export type RecordOutcome = "sent" | "queued";

export interface SlotObservationsApi {
  readonly observations: readonly SlotObservation[];
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** Taps of this venue still waiting in the offline queue. */
  readonly pendingCount: number;
  /** Record a fact now. Resolves "sent" when the server has it, "queued"
   *  when the connection failed and the queue holds it; rejects when the
   *  server refused it. */
  readonly record: (bookingId: string, kind: ObservationKind) => Promise<RecordOutcome>;
  readonly refresh: () => Promise<void>;
}

/** The inert api for a screen that cannot record: the wall, or a visitor. */
export const NO_SLOT_OBSERVATIONS: SlotObservationsApi = {
  observations: [],
  status: "idle",
  pendingCount: 0,
  record: () => Promise.reject(new Error("This screen cannot record what the room is doing.")),
  refresh: () => Promise.resolve(),
};

/** Failed for want of a connection, or a server blip: the queue's business. */
function isConnectionFailure(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
}

function mintKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The fact as this screen knows it while the queue holds it. */
function provisional(venueId: string, actorName: string, input: RecordObservation): SlotObservation {
  return {
    id: `queued:${input.idempotencyKey}`,
    venueId,
    bookingId: input.bookingId,
    spaceId: null,
    kind: input.kind,
    observedAt: input.observedAt,
    recordedAt: input.observedAt,
    actorUserId: null,
    actorName,
    actorRole: "hallkeeper",
    idempotencyKey: input.idempotencyKey,
  };
}

export function useSlotObservations(
  venueId: string | null,
  range: { readonly fromMs: number; readonly toMs: number },
  enabled: boolean,
  actorName: string,
): SlotObservationsApi {
  const active = enabled && venueId !== null;
  const [observations, setObservations] = useState<readonly SlotObservation[]>([]);
  const [status, setStatus] = useState<SlotObservationsApi["status"]>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  // Monotonic: a slow answer to an old question never lands on a newer one.
  const sequenceRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!active || venueId === null) return Promise.resolve();
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    return listVenueObservations(venueId, range)
      .then((rows) => {
        if (sequence !== sequenceRef.current) return;
        setObservations(rows);
        setStatus("ready");
      })
      .catch(() => {
        if (sequence !== sequenceRef.current) return;
        setStatus((current) => (current === "ready" ? "ready" : "failed"));
      });
  }, [active, venueId, range]);

  const countPending = useCallback((): Promise<void> => {
    if (venueId === null) return Promise.resolve();
    return listPendingEventDayOps()
      .then((ops) => {
        setPendingCount(ops.filter((op) => op.kind === "observation_record" && op.venueId === venueId).length);
      })
      .catch(() => undefined);
  }, [venueId]);

  // Replay this venue's taps in the order they were made; everything else in
  // the queue is left for the screen that owns it.
  const drain = useCallback((): Promise<void> => {
    if (!active || venueId === null) return Promise.resolve();
    return drainEventDayOps((op) => {
      if (op.kind !== "observation_record" || op.venueId !== venueId) return Promise.resolve("left" as const);
      return recordVenueObservation(venueId, op.input)
        .then(() => "applied" as const)
        .catch((err: unknown) => {
          if (isConnectionFailure(err)) throw err;
          return "refused" as const;
        });
    })
      .then(() => countPending())
      .then(() => refresh());
  }, [active, venueId, countPending, refresh]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    void countPending();
    void drain();
    const unsubscribe = subscribeRequestsLive((event) => {
      if (event.kind === "observation" && event.venueId === venueId) {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => { void refresh(); }, REFETCH_DEBOUNCE_MS);
      } else if (event.kind === "reconnected") {
        void drain();
      }
    });
    const onOnline = (): void => { void drain(); };
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [active, venueId, refresh, countPending, drain]);

  const record = useCallback((bookingId: string, kind: ObservationKind): Promise<RecordOutcome> => {
    if (!active || venueId === null) {
      return Promise.reject(new Error("This screen cannot record what the room is doing."));
    }
    const input: RecordObservation = {
      bookingId,
      kind,
      observedAt: new Date(correctedNowMs()).toISOString(),
      idempotencyKey: mintKey(),
    };
    return recordVenueObservation(venueId, input)
      .then((fact) => {
        setObservations((current) => (current.some((row) => row.id === fact.id) ? current : [...current, fact]));
        setStatus("ready");
        return "sent" as const;
      })
      .catch((err: unknown) => {
        if (!isConnectionFailure(err)) throw err;
        // Local feedback now, the true state when the connection returns: the
        // fact stands here with its own time and the queue replays it.
        return enqueueEventDayObservation(venueId, input)
          .then(() => {
            setObservations((current) => [...current, provisional(venueId, actorName, input)]);
            return countPending();
          })
          .then(() => "queued" as const);
      });
  }, [active, venueId, actorName, countPending]);

  return useMemo(
    () => ({ observations, status, pendingCount, record, refresh }),
    [observations, status, pendingCount, record, refresh],
  );
}
