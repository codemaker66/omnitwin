import { useCallback, useEffect, useRef, useState } from "react";
import type { VenueRequest } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { listEventRequests } from "../api/conversations.js";

// ---------------------------------------------------------------------------
// The client's own requests on their event (goal 19 S4; D5).
//
// Beside useEventConversation and on the same five-second cadence while the
// page is visible: the client's asks, with the state the house has moved them
// to. Each answer replaces the list (snapshot doctrine: few rows, server
// truth wins); a request the page has just made is merged at once so the
// person sees it before the next poll confirms it. A revoked link answers
// 403 and the poll stops, saying so once.
// ---------------------------------------------------------------------------

export const EVENT_REQUESTS_POLL_MS = 5_000;

export interface EventRequests {
  readonly status: "loading" | "ready" | "error";
  readonly requests: readonly VenueRequest[];
  readonly error: string | null;
  /** True once the link has been refused: nothing more will be asked. */
  readonly closed: boolean;
  readonly refresh: () => void;
  /** A request this page just made: shown at once, confirmed by the next poll. */
  readonly merge: (request: VenueRequest) => void;
}

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function byNewest(left: VenueRequest, right: VenueRequest): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function useEventRequests(
  eventId: string | null,
  options: { readonly pollMs?: number } = {},
): EventRequests {
  const pollMs = options.pollMs ?? EVENT_REQUESTS_POLL_MS;
  const [status, setStatus] = useState<EventRequests["status"]>("loading");
  const [requests, setRequests] = useState<readonly VenueRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const closedRef = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  const ask = useCallback((): void => {
    if (eventId === null || closedRef.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    sequence.current += 1;
    const mine = sequence.current;
    void listEventRequests(eventId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted || mine !== sequence.current) return;
        setRequests([...rows].sort(byNewest));
        setStatus("ready");
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || mine !== sequence.current) return;
        if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
          closedRef.current = true;
          setClosed(true);
          setStatus("error");
          setError(caught.status === 403
            ? "This event is no longer linked to your account."
            : "This event no longer exists.");
          return;
        }
        setStatus((current) => (current === "loading" ? "error" : current));
        setError(caught instanceof Error && caught.message !== "" ? caught.message : "Your requests could not be read.");
      });
  }, [eventId]);

  useEffect(() => {
    closedRef.current = false;
    setClosed(false);
    setRequests([]);
    setStatus("loading");
    setError(null);
    if (eventId === null) return;
    ask();
    return () => { inFlight.current?.abort(); };
  }, [eventId, ask]);

  useEffect(() => {
    if (eventId === null) return;
    const timer = window.setInterval(() => { if (visible()) ask(); }, pollMs);
    const onVisible = (): void => { if (visible()) ask(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [eventId, pollMs, ask]);

  const merge = useCallback((request: VenueRequest): void => {
    setRequests((current) => [request, ...current.filter((row) => row.id !== request.id)].sort(byNewest));
    setStatus("ready");
  }, []);

  return { status, requests, error, closed, refresh: ask, merge };
}
