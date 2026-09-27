import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarResponse } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { getCalendar } from "../../../api/diary.js";
import type { BoardRange } from "../lib/board-time.js";

// ---------------------------------------------------------------------------
// useCalendar (T-493) — the shared read model for the visible range.
//
// Only a range's own read is ever shown as that range: another week's
// bookings never stand in for this one's. What carries across a change of
// range is the venue's frame (its rooms, changeover rules and the
// venue-wide decisions list), so the board keeps its rooms while a week
// loads (roadmap N3). A range read in the last few minutes, visited or read
// ahead as a neighbour, shows at once and is read again at the same moment.
// A refresh that fails keeps what is on screen and says when. Stale requests
// are aborted on range change and unmount.
// ---------------------------------------------------------------------------

export type CalendarStatus = "loading" | "ready" | "error";

/** A range read this recently shows at once when the board comes to it,
 *  while it is read again. An older read waits for the new one. */
export const CALENDAR_REUSE_MS = 5 * 60_000;
/** Reads kept for a return: the range on screen, its neighbours and a few
 *  just left. */
const CALENDAR_KEEP = 8;

interface StoredRead {
  readonly venueId: string;
  readonly response: CalendarResponse;
  readonly readAtMs: number;
}

interface Failure {
  readonly key: string;
  readonly message: string;
  readonly atMs: number;
}

export interface UseCalendarResult {
  /** This range's read model, or null until it has been read. */
  readonly data: CalendarResponse | null;
  /** When `data` was read. */
  readonly readAtMs: number | null;
  /** The venue's latest read of any range. Its rooms, changeover rules and
   *  decisions due stay on screen while another range loads; its entries
   *  and conflicts belong to that other range and are never shown as this
   *  one's. Null before the venue's first read. */
  readonly frame: CalendarResponse | null;
  readonly status: CalendarStatus;
  /** Why this range could not be read (status "error"). */
  readonly error: string | null;
  /** A refresh of the range on screen failed at this instant; the board
   *  keeps what it last read. */
  readonly refreshFailedAtMs: number | null;
  readonly isRefreshing: boolean;
  /** Reads the range again. Anything it prompts can touch any week, so the
   *  other ranges kept for a return are forgotten. */
  readonly refetch: () => void;
}

const NO_READS: ReadonlyMap<string, StoredRead> = new Map();
const NO_NEIGHBOURS: readonly BoardRange[] = [];

export function calendarKey(venueId: string | null, range: BoardRange): string {
  return `${venueId ?? "none"}:${String(range.fromMs)}:${String(range.toMs)}`;
}

function remember(reads: ReadonlyMap<string, StoredRead>, key: string, read: StoredRead): ReadonlyMap<string, StoredRead> {
  const next = new Map(reads);
  // Re-inserted, so the map's order is oldest read first.
  next.delete(key);
  next.set(key, read);
  for (const oldest of next.keys()) {
    if (next.size <= CALENDAR_KEEP) break;
    next.delete(oldest);
  }
  return next;
}

function read(venueId: string, range: BoardRange, signal: AbortSignal): Promise<CalendarResponse> {
  return getCalendar(venueId, new Date(range.fromMs).toISOString(), new Date(range.toMs).toISOString(), signal);
}

export function useCalendar(
  venueId: string | null,
  range: BoardRange,
  /** Ranges to read ahead once this one is on screen, most likely first. */
  neighbours: readonly BoardRange[] = NO_NEIGHBOURS,
): UseCalendarResult {
  const [reads, setReads] = useState<ReadonlyMap<string, StoredRead>>(NO_READS);
  // The venue's latest read of any range. Kept apart from `reads`, which a
  // refetch empties, so a retry never takes the rooms away.
  const [latest, setLatest] = useState<StoredRead | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fetchingKey, setFetchingKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestKey = calendarKey(venueId, range);
  const keyRef = useRef(requestKey);
  keyRef.current = requestKey;
  const readsRef = useRef(reads);
  readsRef.current = reads;
  // Counts refetches. A read ahead that set out before one may have read a
  // week the change touched, so it is not kept.
  const generationRef = useRef(0);

  // When the board came to this range. A read from shortly before then can
  // be shown at once; the decision holds for the whole visit, so a board
  // left open for an hour does not blank when its own read ages.
  const [arrival, setArrival] = useState(() => ({ key: requestKey, atMs: Date.now() }));
  let arrivedAtMs = arrival.atMs;
  if (arrival.key !== requestKey) {
    arrivedAtMs = Date.now();
    setArrival({ key: requestKey, atMs: arrivedAtMs });
    // A failure belongs to the visit it happened in.
    if (failure !== null) setFailure(null);
  }

  useEffect(() => {
    if (venueId === null) return;
    const controller = new AbortController();
    const key = requestKey;
    setFetchingKey(key);
    // A retry starts clean: while it runs the board says it is reading,
    // not that the last attempt failed.
    setFailure((previous) => (previous?.key === key ? null : previous));
    read(venueId, range, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const stored: StoredRead = { venueId, response, readAtMs: Date.now() };
        setReads((previous) => remember(previous, key, stored));
        setLatest(stored);
        setFetchingKey((current) => (current === key ? null : current));
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({ key, message: caught instanceof ApiError ? caught.message : "Unexpected error", atMs: Date.now() });
        setFetchingKey((current) => (current === key ? null : current));
      });
    return () => {
      controller.abort();
    };
    // `range` is identified by `requestKey`.
  }, [venueId, requestKey, revision]);

  const stored = reads.get(requestKey);
  const data = venueId !== null && stored !== undefined && stored.readAtMs >= arrivedAtMs - CALENDAR_REUSE_MS
    ? stored.response
    : null;
  const fetching = fetchingKey === requestKey;

  // Read the neighbours ahead once this range is on screen and settled, so
  // Earlier and Later open at once. A read ahead that fails says nothing:
  // the visit reads the range itself.
  const neighbourKey = neighbours.map((neighbour) => calendarKey(venueId, neighbour)).join("|");
  const settledAtMs = data !== null && !fetching ? stored?.readAtMs ?? null : null;
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;
  useEffect(() => {
    if (venueId === null || settledAtMs === null) return;
    const controller = new AbortController();
    const generation = generationRef.current;
    for (const neighbour of neighboursRef.current) {
      const key = calendarKey(venueId, neighbour);
      const known = readsRef.current.get(key);
      if (known !== undefined && known.readAtMs >= Date.now() - CALENDAR_REUSE_MS / 2) continue;
      read(venueId, neighbour, controller.signal)
        .then((response) => {
          if (controller.signal.aborted || generationRef.current !== generation) return;
          const stored: StoredRead = { venueId, response, readAtMs: Date.now() };
          setReads((previous) => remember(previous, key, stored));
          setLatest(stored);
        })
        .catch(() => { /* read again on arrival */ });
    }
    return () => {
      controller.abort();
    };
  }, [venueId, settledAtMs, neighbourKey]);

  const frame = venueId !== null && latest !== null && latest.venueId === venueId ? latest.response : null;

  const refetch = useCallback(() => {
    generationRef.current += 1;
    const current = keyRef.current;
    setReads((previous) => {
      const kept = previous.get(current);
      return kept === undefined ? NO_READS : new Map([[current, kept]]);
    });
    setRevision((value) => value + 1);
  }, []);

  const currentFailure = failure !== null && failure.key === requestKey ? failure : null;
  return {
    data,
    readAtMs: data === null ? null : stored?.readAtMs ?? null,
    frame,
    status: data !== null ? "ready" : currentFailure !== null ? "error" : "loading",
    error: data === null && currentFailure !== null ? currentFailure.message : null,
    refreshFailedAtMs: data !== null && currentFailure !== null ? currentFailure.atMs : null,
    isRefreshing: data !== null && fetching,
    refetch,
  };
}
