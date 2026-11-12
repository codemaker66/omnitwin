import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { eventDisplayName, resolveRotaTimeZone, type EventPhaseGraph } from "@omnitwin/types";
import { getEventPhaseGraph } from "../api/events.js";
import { getVenue } from "../api/spaces.js";
import { VENUE_TIME_ZONE } from "../pages/diary/lib/board-time.js";
import { useAuthStore } from "../stores/auth-store.js";
import { canReadInternalEventData } from "../lib/event-access.js";

// The planner is opened on a configuration; events are a separate concept with
// no config→event lookup endpoint. So the cockpit binds event context from an
// optional `?eventId` search param (the link carries it) and degrades to a SAFE
// "no event linked" state otherwise. Shared by the top bar and the phase graph.

export type LinkedEventStatus = "none" | "loading" | "loaded" | "error";

export interface LinkedEvent {
  readonly status: LinkedEventStatus;
  /** The event's name as shown (eventDisplayName); `graph` keeps it as stored. */
  readonly eventName: string | null;
  readonly graph: EventPhaseGraph | null;
  /** The venue's zone, when it was read for a name made from the event's day
   *  (the day that name carries); null when it was not read or not usable, and
   *  the name then reads the house's clock. */
  readonly timeZone: string | null;
}

interface StoredLinkedEvent {
  readonly requestKey: string | null;
  readonly status: LinkedEventStatus;
  readonly graph: EventPhaseGraph | null;
  /** The venue's zone the event's shown name reads its day on, when read. */
  readonly timeZone: string | null;
}

/**
 * The zone an event's shown name reads its day on: its venue's, as the Diary,
 * the room's timeline and the handoff pack read it (and event-linked-layouts).
 * The venue is read only when the name is made from the event's day; a name
 * of its own reads the same on any clock. A venue that cannot be read, or
 * whose zone no clock knows, leaves the house's clock (null), as the venue
 * clock does (use-venue-timezone).
 */
async function nameTimeZone(event: EventPhaseGraph["event"]): Promise<string | null> {
  if (eventDisplayName(event, VENUE_TIME_ZONE) === event.name) return null;
  try {
    const zone = (await getVenue(event.venueId)).timezone;
    return zone !== undefined && resolveRotaTimeZone(zone) === zone ? zone : null;
  } catch {
    return null;
  }
}

function authorizationContextKey(user: ReturnType<typeof useAuthStore.getState>["user"]): string {
  if (user === null) return "anonymous";
  return JSON.stringify([user.id, user.venueId, user.role, user.platformRole]);
}

export function useLinkedEvent(expectedVenueId?: string | null): LinkedEvent {
  const [searchParams] = useSearchParams();
  const requestedEventId = searchParams.get("eventId")?.trim() ?? "";
  const auth = useAuthStore();
  const authorizationKey = JSON.stringify([auth.isLoading, auth.isAuthenticated, authorizationContextKey(auth.user)]);
  const venuePending = expectedVenueId === null;
  const venueKey = expectedVenueId === null
    ? "pending"
    : expectedVenueId ?? "unconstrained";
  const requestKey = requestedEventId.length === 0 || !canReadInternalEventData(auth)
    ? null
    : JSON.stringify([authorizationKey, requestedEventId, venueKey]);
  const requestGenerationRef = useRef(0);
  const [result, setResult] = useState<StoredLinkedEvent>({
    requestKey: null,
    status: "none",
    graph: null,
    timeZone: null,
  });

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    if (requestKey === null) {
      setResult({ requestKey: null, status: "none", graph: null, timeZone: null });
      return;
    }
    if (venuePending) {
      setResult({ requestKey, status: "loading", graph: null, timeZone: null });
      return;
    }

    let cancelled = false;
    // Read afresh at each step: an answer can arrive after the request it
    // answers was replaced or left.
    const stale = (): boolean => cancelled || requestGenerationRef.current !== generation;
    setResult({ requestKey, status: "loading", graph: null, timeZone: null });
    void getEventPhaseGraph(requestedEventId)
      .then(async (loaded) => {
        if (stale()) return;
        if (
          loaded.event.id !== requestedEventId
          || (expectedVenueId !== undefined && loaded.event.venueId !== expectedVenueId)
          || loaded.phases.some((phase) => phase.eventId !== loaded.event.id)
        ) {
          setResult({ requestKey, status: "error", graph: null, timeZone: null });
          return;
        }
        // Loaded once its name can be read on the venue's own clock, so the
        // name never shows one day and then another.
        const timeZone = await nameTimeZone(loaded.event);
        if (stale()) return;
        setResult({ requestKey, status: "loaded", graph: loaded, timeZone });
      })
      .catch(() => {
        if (stale()) return;
        setResult({ requestKey, status: "error", graph: null, timeZone: null });
      });
    return () => { cancelled = true; };
  }, [authorizationKey, expectedVenueId, requestKey, requestedEventId, venuePending]);

  if (requestKey === null) return { status: "none", eventName: null, graph: null, timeZone: null };
  if (result.requestKey !== requestKey) {
    return { status: "loading", eventName: null, graph: null, timeZone: null };
  }
  return {
    status: result.status,
    // The name people read: an event stored without one (made before
    // eventNameFor named every new event) is called by its occasion and the
    // venue's own day. The graph keeps the name as stored.
    eventName: result.graph === null ? null : eventDisplayName(result.graph.event, result.timeZone ?? VENUE_TIME_ZONE),
    graph: result.graph,
    timeZone: result.graph === null ? null : result.timeZone,
  };
}
