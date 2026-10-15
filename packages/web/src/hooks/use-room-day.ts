import { useCallback, useEffect, useRef, useState } from "react";
import { addRotaDays, type RoomDaySpan } from "@omnitwin/types";
import { getRoomDay } from "../api/when-window.js";

// ---------------------------------------------------------------------------
// The room's day for the client's ribbon (goal 19 S6).
//
// The venue counts a day from 04:00 to 04:00, so the ribbon's midnight-to-
// midnight strip straddles two venue days: the one the bar sits on and the
// small hours of the one before. Both are asked for and their spans merged,
// deduplicated where a booking crosses 04:00 and appears in each.
// ---------------------------------------------------------------------------

export interface RoomDayData {
  readonly spans: readonly RoomDaySpan[];
  readonly turnaroundMinutes: number;
}

export interface RoomDayResult {
  readonly data: RoomDayData | null;
  readonly status: "loading" | "ready" | "error";
  readonly isRefreshing: boolean;
  readonly refetch: () => void;
}

function spanKey(span: RoomDaySpan): string {
  return span.kind === "yours" ? `yours:${span.bookingId}` : `${span.kind}:${span.startsAt}:${span.endsAt}`;
}

export function mergeRoomDaySpans(...lists: readonly (readonly RoomDaySpan[])[]): readonly RoomDaySpan[] {
  const seen = new Set<string>();
  const merged: RoomDaySpan[] = [];
  for (const list of lists) {
    for (const span of list) {
      const key = spanKey(span);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(span);
    }
  }
  return merged.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function useRoomDay(eventId: string | null, spaceId: string | null, date: string | null): RoomDayResult {
  const [data, setData] = useState<RoomDayData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refetch = useCallback(() => { setRevision((value) => value + 1); }, []);

  useEffect(() => {
    const current = ++generation.current;
    if (eventId === null || spaceId === null || date === null) {
      setData(null);
      setStatus("loading");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    void Promise.all([
      getRoomDay(eventId, { spaceId, day: date }, controller.signal),
      getRoomDay(eventId, { spaceId, day: addRotaDays(date, -1) }, controller.signal),
    ])
      .then(([shown, before]) => {
        if (controller.signal.aborted || generation.current !== current) return;
        setData({ spans: mergeRoomDaySpans(before.spans, shown.spans), turnaroundMinutes: shown.turnaroundMinutes });
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted || generation.current !== current) return;
        setStatus("error");
      });
    return () => { controller.abort(); };
  }, [eventId, spaceId, date, revision]);

  return { data, status, isRefreshing: data !== null && status === "loading", refetch };
}
