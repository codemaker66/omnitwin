import { useCallback, useEffect, useState } from "react";
import type { CalendarResponse } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { getCalendar } from "../../../api/diary.js";
import type { BoardRange } from "../lib/board-time.js";

// ---------------------------------------------------------------------------
// useCalendar (T-493) — fetches the shared read model for the visible range.
// Aborts stale requests on range change/unmount; background refetches keep
// the current board on screen while reporting the real request separately.
// ---------------------------------------------------------------------------

export type CalendarStatus = "loading" | "ready" | "error";

export interface UseCalendarResult {
  readonly data: CalendarResponse | null;
  readonly status: CalendarStatus;
  readonly error: string | null;
  readonly isRefreshing: boolean;
  readonly refetch: () => void;
}

export function useCalendar(venueId: string | null, range: BoardRange): UseCalendarResult {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [status, setStatus] = useState<CalendarStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const requestKey = `${venueId ?? "none"}:${String(range.fromMs)}:${String(range.toMs)}`;

  useEffect(() => {
    if (venueId === null) return;
    const controller = new AbortController();
    let cancelled = false;
    setFetching(true);
    // Keep showing the current board during background refreshes.
    setStatus((previous) => (previous === "ready" ? "ready" : "loading"));
    getCalendar(
      venueId,
      new Date(range.fromMs).toISOString(),
      new Date(range.toMs).toISOString(),
      controller.signal,
    )
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setResolvedKey(requestKey);
        setError(null);
        setErrorKey(null);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught.message : "Unexpected error");
        setErrorKey(requestKey);
        setStatus("error");
      })
      .finally(() => {
        // A superseded request must not retire the new request's indicator.
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [venueId, range.fromMs, range.toMs, revision, requestKey]);

  const refetch = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const currentData = resolvedKey === requestKey && venueId !== null ? data : null;
  const currentError = errorKey === requestKey ? error : null;
  return { data: currentData, status: currentData === null ? currentError === null ? "loading" : "error" : status,
    error: currentError, refetch, isRefreshing: fetching && currentData !== null };
}
