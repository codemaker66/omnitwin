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
// refuses for good (a booking that is gone, a time outside it) leaves the
// queue rather than block the taps behind it; a tap the server could not be
// asked to keep (no connection, a session to renew) stays. Nothing here
// writes a time on a booking.
//
// What this screen shows is the server's list with its own taps standing in
// it until the server lists them: a tap just recorded, and every tap still
// in the queue (id "queued:<key>"). A refetch never drops them.
// ---------------------------------------------------------------------------

const REFETCH_DEBOUNCE_MS = 120;
const QUEUED_ID_PREFIX = "queued:";
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

export type RecordOutcome = "sent" | "queued";

export interface SlotObservationsApi {
  /** The day's facts, with this device's queued taps standing among them. */
  readonly observations: readonly SlotObservation[];
  /** The state of the day's read: a tap neither needs nor changes it. */
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** Taps of this venue still waiting in the offline queue. */
  readonly pendingCount: number;
  /** The same taps, by the booking they are about. */
  readonly pendingByBooking: ReadonlyMap<string, number>;
  /** Record a fact now. Resolves "sent" when the server has it, "queued"
   *  when the connection failed and the queue holds it; rejects when the
   *  server refused it or the session must be renewed. */
  readonly record: (bookingId: string, kind: ObservationKind) => Promise<RecordOutcome>;
  readonly refresh: () => Promise<void>;
}

/** A fact that is this device's queued tap, not yet the server's. */
export function isQueuedObservation(fact: SlotObservation): boolean {
  return fact.id.startsWith(QUEUED_ID_PREFIX);
}

type Failure = "connection" | "unauthorized" | "recorded" | "refused";

/** What a failed send means for the tap. */
function classifyFailure(err: unknown): Failure {
  if (!(err instanceof ApiError)) return "refused";
  if (err.code === "NETWORK_ERROR") return "connection";
  // The server answered 2xx and has the fact; only its reply was unreadable.
  if (err.code === "RESPONSE_VALIDATION_ERROR") return "recorded";
  if (err.status === 401 || err.status === 403) return "unauthorized";
  if (err.status === 408 || err.status === 429 || err.status >= 500) return "connection";
  return "refused";
}

/** A v4 UUID: the only key shape the server accepts. */
function mintKey(): string {
  if (typeof crypto === "undefined") throw new Error("This browser cannot mint a key for the tap.");
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The fact as this screen knows it while the queue holds it. The server
 *  will attribute the replay to whoever is signed in when it drains. */
function provisional(venueId: string, actorName: string, input: RecordObservation): SlotObservation {
  return {
    id: `${QUEUED_ID_PREFIX}${input.idempotencyKey}`,
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

/** The server's rows, then this screen's own facts the server has not listed. */
function merge(server: readonly SlotObservation[], local: readonly SlotObservation[]): readonly SlotObservation[] {
  if (local.length === 0) return server;
  const known = new Set(server.map((row) => row.idempotencyKey));
  const standing = local.filter((row) => !known.has(row.idempotencyKey));
  return standing.length === 0 ? server : [...server, ...standing];
}

export function useSlotObservations(
  venueId: string | null,
  range: { readonly fromMs: number; readonly toMs: number },
  enabled: boolean,
  actorName: string,
): SlotObservationsApi {
  const active = enabled && venueId !== null;
  // The range by its values: the page rebuilds its object on every clock tick.
  const { fromMs, toMs } = range;
  const stableRange = useMemo(() => ({ fromMs, toMs }), [fromMs, toMs]);
  const [serverRows, setServerRows] = useState<readonly SlotObservation[]>([]);
  // Taps recorded from this screen that the server has not listed yet.
  const [sentRows, setSentRows] = useState<readonly SlotObservation[]>([]);
  // The queue's taps for this venue, as the queue holds them.
  const [queuedRows, setQueuedRows] = useState<readonly SlotObservation[]>([]);
  const [pendingByBooking, setPendingByBooking] = useState<ReadonlyMap<string, number>>(NO_COUNTS);
  const [status, setStatus] = useState<SlotObservationsApi["status"]>("idle");
  // Monotonic: a slow answer to an old question never lands on a newer one.
  const sequenceRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  // One drain at a time; a second caller waits for the first.
  const drainRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!active) return Promise.resolve();
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    return listVenueObservations(venueId, stableRange)
      .then((rows) => {
        if (sequence !== sequenceRef.current) return;
        setServerRows(rows);
        const listed = new Set(rows.map((row) => row.idempotencyKey));
        setSentRows((current) => (current.some((row) => listed.has(row.idempotencyKey))
          ? current.filter((row) => !listed.has(row.idempotencyKey))
          : current));
        setStatus("ready");
      })
      .catch(() => {
        if (sequence !== sequenceRef.current) return;
        setStatus((current) => (current === "ready" ? "ready" : "failed"));
      });
  }, [active, venueId, stableRange]);

  // The queue is the truth about what is waiting: its taps for this venue
  // stand on the board and are counted by booking.
  const readPending = useCallback((): Promise<void> => {
    if (!active) return Promise.resolve();
    return listPendingEventDayOps()
      .then((ops) => {
        const counts = new Map<string, number>();
        const rows: SlotObservation[] = [];
        for (const op of ops) {
          if (op.kind !== "observation_record" || op.venueId !== venueId) continue;
          counts.set(op.input.bookingId, (counts.get(op.input.bookingId) ?? 0) + 1);
          rows.push(provisional(venueId, actorName, op.input));
        }
        setPendingByBooking(counts.size === 0 ? NO_COUNTS : counts);
        setQueuedRows(rows);
      })
      .catch(() => undefined);
  }, [active, venueId, actorName]);

  // Replay this venue's taps in the order they were made; everything else in
  // the queue is left for the screen that owns it. A tap the server refused
  // for good leaves the queue; one it could not be asked to keep stops the
  // drain and waits. The day's facts are read again once a replay landed.
  const drain = useCallback((): Promise<void> => {
    if (!active) return Promise.resolve();
    if (drainRef.current !== null) return drainRef.current;
    const run = drainEventDayOps((op) => {
      if (op.kind !== "observation_record" || op.venueId !== venueId) return Promise.resolve("left" as const);
      return recordVenueObservation(venueId, op.input)
        .then(() => "applied" as const)
        .catch((err: unknown) => {
          const failure = classifyFailure(err);
          if (failure === "connection" || failure === "unauthorized") throw err;
          return failure === "recorded" ? ("applied" as const) : ("refused" as const);
        });
    })
      .then((acked) => acked.some((op) => op.kind === "observation_record" && op.venueId === venueId))
      .catch(() => false)
      .then((landed) => readPending().then(() => (landed ? refresh() : undefined)))
      .finally(() => { drainRef.current = null; });
    drainRef.current = run;
    return run;
  }, [active, venueId, readPending, refresh]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    void drain();
    const unsubscribe = subscribeRequestsLive((event) => {
      if (event.kind === "observation" && event.venueId === venueId) {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => { void refresh(); }, REFETCH_DEBOUNCE_MS);
      } else if (event.kind === "reconnected") {
        // Facts landed while the socket was down; this device's taps may have too.
        void refresh();
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
  }, [active, venueId, refresh, drain]);

  const record = useCallback((bookingId: string, kind: ObservationKind): Promise<RecordOutcome> => {
    if (!active) {
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
        setSentRows((current) => [...current, fact]);
        return "sent" as const;
      })
      .catch((err: unknown) => {
        const failure = classifyFailure(err);
        if (failure === "recorded") {
          // The server has it; its list says so.
          void refresh();
          return "sent" as const;
        }
        if (failure !== "connection") throw err;
        // Local feedback now, the true state when the connection returns: the
        // fact stands here with its own time and the queue replays it.
        return enqueueEventDayObservation(venueId, input)
          .then(() => readPending())
          .then(() => "queued" as const);
      });
  }, [active, venueId, readPending, refresh]);

  const observations = useMemo(
    () => merge(serverRows, sentRows.length === 0 ? queuedRows : [...sentRows, ...queuedRows]),
    [serverRows, sentRows, queuedRows],
  );
  const pendingCount = useMemo(() => {
    let count = 0;
    for (const n of pendingByBooking.values()) count += n;
    return count;
  }, [pendingByBooking]);

  return useMemo(
    () => ({ observations, status, pendingCount, pendingByBooking, record, refresh }),
    [observations, status, pendingCount, pendingByBooking, record, refresh],
  );
}
