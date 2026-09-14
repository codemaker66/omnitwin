import { useCallback, useEffect, useRef, useState } from "react";
import { EventIdSchema, type ClientEventSchedule } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { getClientEventSchedule } from "../api/client-event-schedule.js";
import { useAuthStore } from "../stores/auth-store.js";

type Status = "none" | "loading" | "loaded" | "unavailable" | "error" | "sign-in-required";
interface Result {
  readonly key: string | null;
  readonly status: Status;
  readonly data: ClientEventSchedule | null;
}
interface Options {
  readonly configurationId?: string | null;
  readonly expectedVenueId?: string | null;
  readonly enabled?: boolean;
}

/** Every response belongs to the current account, event and saved layout. */
export function useClientEventSchedule(eventId: string | null, options: Options = {}) {
  const { configurationId, expectedVenueId, enabled = true } = options;
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const authorizationKey = JSON.stringify([isLoading, isAuthenticated, user?.id, user?.role, user?.venueId, user?.platformRole]);
  const key = !enabled || eventId === null ? null : JSON.stringify([authorizationKey, eventId, configurationId, expectedVenueId]);
  const [result, setResult] = useState<Result>({ key: null, status: "none", data: null });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => { setRevision((value) => value + 1); }, []);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (key === null || eventId === null) return;
    if (isLoading) {
      setResult({ key, status: "loading", data: null });
      return;
    }
    if (!isAuthenticated || user === null) {
      setResult({ key, status: "sign-in-required", data: null });
      return;
    }
    if (expectedVenueId === null || configurationId === null) {
      setResult({ key, status: "loading", data: null });
      return;
    }
    if (!EventIdSchema.safeParse(eventId).success) {
      setResult({ key, status: "unavailable", data: null });
      return;
    }
    const controller = new AbortController();
    setResult({ key, status: "loading", data: null });
    void getClientEventSchedule(eventId, configurationId ?? undefined, controller.signal).then((data) => {
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      if (data.event.id !== eventId || data.venue.id !== data.event.venueId
        || (expectedVenueId !== undefined && data.event.venueId !== expectedVenueId)
        || (configurationId !== null && configurationId !== undefined && !data.layouts.some((layout) => layout.id === configurationId))) {
        setResult({ key, status: "error", data: null });
        return;
      }
      setResult({ key, status: "loaded", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      const status = error instanceof ApiError && error.status === 401 ? "sign-in-required"
        : error instanceof ApiError && (error.status === 403 || error.status === 404) ? "unavailable" : "error";
      setResult({ key, status, data: null });
    });
    return () => { controller.abort(); };
  }, [authorizationKey, configurationId, eventId, expectedVenueId, isAuthenticated, isLoading, key, revision, user]);

  if (key === null) return { status: "none" as const, data: null, refresh };
  if (key !== result.key) return { status: "loading" as const, data: null, refresh };
  return { status: result.status, data: result.data, refresh };
}
