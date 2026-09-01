import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EventPhaseGraph } from "@omnitwin/types";
import { getEventPhaseGraph } from "../api/events.js";
import { useAuthStore } from "../stores/auth-store.js";

// The planner is opened on a configuration; events are a separate concept with
// no config→event lookup endpoint. So the cockpit binds event context from an
// optional `?eventId` search param (the link carries it) and degrades to a SAFE
// "no event linked" state otherwise. Shared by the top bar and the phase graph.

export type LinkedEventStatus = "none" | "loading" | "loaded" | "error";

export interface LinkedEvent {
  readonly status: LinkedEventStatus;
  readonly eventName: string | null;
  readonly graph: EventPhaseGraph | null;
}

interface StoredLinkedEvent {
  readonly requestKey: string | null;
  readonly status: LinkedEventStatus;
  readonly graph: EventPhaseGraph | null;
}

function authorizationContextKey(user: ReturnType<typeof useAuthStore.getState>["user"]): string {
  if (user === null) return "anonymous";
  return JSON.stringify([user.id, user.venueId, user.role, user.platformRole]);
}

export function useLinkedEvent(expectedVenueId?: string | null): LinkedEvent {
  const [searchParams] = useSearchParams();
  const requestedEventId = searchParams.get("eventId")?.trim() ?? "";
  const user = useAuthStore((state) => state.user);
  const authorizationKey = authorizationContextKey(user);
  const venuePending = expectedVenueId === null;
  const venueKey = expectedVenueId === null
    ? "pending"
    : expectedVenueId ?? "unconstrained";
  const requestKey = requestedEventId.length === 0
    ? null
    : JSON.stringify([authorizationKey, requestedEventId, venueKey]);
  const requestGenerationRef = useRef(0);
  const [result, setResult] = useState<StoredLinkedEvent>({
    requestKey: null,
    status: "none",
    graph: null,
  });

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    if (requestKey === null) {
      setResult({ requestKey: null, status: "none", graph: null });
      return;
    }
    if (venuePending) {
      setResult({ requestKey, status: "loading", graph: null });
      return;
    }

    let cancelled = false;
    setResult({ requestKey, status: "loading", graph: null });
    void getEventPhaseGraph(requestedEventId)
      .then((loaded) => {
        if (cancelled || requestGenerationRef.current !== generation) return;
        if (
          loaded.event.id !== requestedEventId
          || (expectedVenueId !== undefined && loaded.event.venueId !== expectedVenueId)
          || loaded.phases.some((phase) => phase.eventId !== loaded.event.id)
        ) {
          setResult({ requestKey, status: "error", graph: null });
          return;
        }
        setResult({ requestKey, status: "loaded", graph: loaded });
      })
      .catch(() => {
        if (cancelled || requestGenerationRef.current !== generation) return;
        setResult({ requestKey, status: "error", graph: null });
      });
    return () => { cancelled = true; };
  }, [authorizationKey, expectedVenueId, requestKey, requestedEventId, venuePending]);

  if (requestKey === null) return { status: "none", eventName: null, graph: null };
  if (result.requestKey !== requestKey) {
    return { status: "loading", eventName: null, graph: null };
  }
  return {
    status: result.status,
    eventName: result.graph?.event.name ?? null,
    graph: result.graph,
  };
}
