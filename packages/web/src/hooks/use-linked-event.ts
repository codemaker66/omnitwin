import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EventPhaseGraph } from "@omnitwin/types";
import { getEventPhaseGraph } from "../api/events.js";

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

export function useLinkedEvent(): LinkedEvent {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const [graph, setGraph] = useState<EventPhaseGraph | null>(null);
  const [status, setStatus] = useState<LinkedEventStatus>("none");

  useEffect(() => {
    if (eventId === null || eventId.trim().length === 0) {
      setGraph(null);
      setStatus("none");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setGraph(null);
    void getEventPhaseGraph(eventId)
      .then((loaded) => {
        if (cancelled) return;
        setGraph(loaded);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setGraph(null);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [eventId]);

  return { status, eventName: graph?.event.name ?? null, graph };
}
