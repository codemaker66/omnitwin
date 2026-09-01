import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRoomLayoutTimeline,
  type RoomLayoutTimelineQuery,
  type RoomLayoutTimelineResponse,
  type RoomLayoutTimelineScope,
} from "../api/room-layout-timeline.js";
import { useAuthStore } from "../stores/auth-store.js";
import { timelineScopedRequestRange } from "../lib/room-layout-timeline-ui.js";

export type RoomLayoutTimelineStatus = "idle" | "loading" | "loaded" | "error";

export interface RoomLayoutTimelineResult {
  readonly status: RoomLayoutTimelineStatus;
  readonly data: RoomLayoutTimelineResponse | null;
  readonly error: string | null;
  readonly refresh: () => void;
}

export type RoomLayoutTimelineRangeInput =
  | { readonly scope: RoomLayoutTimelineScope; readonly anchorDate: string }
  | { readonly from: string; readonly to: string };

interface StoredRoomLayoutTimelineResult {
  readonly requestKey: string | null;
  readonly status: RoomLayoutTimelineStatus;
  readonly data: RoomLayoutTimelineResponse | null;
  readonly error: string | null;
}

function authorizationContextKey(user: ReturnType<typeof useAuthStore.getState>["user"]): string {
  if (user === null) return "anonymous";
  return JSON.stringify([user.id, user.venueId, user.role, user.platformRole]);
}

function responseMatchesRange(
  data: RoomLayoutTimelineResponse,
  range: RoomLayoutTimelineRangeInput,
): boolean {
  if ("scope" in range) {
    const expected = timelineScopedRequestRange(range.scope, range.anchorDate, data.timeZone);
    return data.range.scope === range.scope
      && data.range.anchorDate === range.anchorDate
      && expected !== null
      && data.range.from === expected.from
      && data.range.to === expected.to
      && data.from === expected.from
      && data.to === expected.to;
  }
  return data.range.scope === "custom"
    && data.range.from === range.from
    && data.range.to === range.to
    && data.from === range.from
    && data.to === range.to;
}

export function useRoomLayoutTimeline(
  venueId: string | null,
  spaceId: string | null,
  range: RoomLayoutTimelineRangeInput,
): RoomLayoutTimelineResult {
  const user = useAuthStore((state) => state.user);
  const authorizationKey = authorizationContextKey(user);
  const rangeKey = "scope" in range
    ? JSON.stringify(["scope", range.scope, range.anchorDate])
    : JSON.stringify(["custom", range.from, range.to]);
  const requestKey = venueId === null || spaceId === null
    ? null
    : JSON.stringify([authorizationKey, venueId, spaceId, rangeKey]);
  const [result, setResult] = useState<StoredRoomLayoutTimelineResult>({
    requestKey: null,
    status: "idle",
    data: null,
    error: null,
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestGenerationRef = useRef(0);
  const refresh = useCallback((): void => {
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    if (venueId === null || spaceId === null) {
      setResult({ requestKey: null, status: "idle", data: null, error: null });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setResult({ requestKey, status: "loading", data: null, error: null });

    const query: RoomLayoutTimelineQuery = "scope" in range
      ? { venueId, spaceId, scope: range.scope, anchorDate: range.anchorDate }
      : { venueId, spaceId, from: range.from, to: range.to };

    void getRoomLayoutTimeline(query, controller.signal)
      .then((data) => {
        if (cancelled || requestGenerationRef.current !== generation) return;
        if (data.venueId !== venueId || data.spaceId !== spaceId) {
          setResult({
            requestKey,
            status: "error",
            data: null,
            error: "Room timeline response did not match the selected room.",
          });
          return;
        }
        if (!responseMatchesRange(data, range)) {
          setResult({
            requestKey,
            status: "error",
            data: null,
            error: "Room timeline response did not match the requested range.",
          });
          return;
        }
        setResult({ requestKey, status: "loaded", data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled || requestGenerationRef.current !== generation) return;
        const message = error instanceof Error ? error.message : "Room timeline unavailable";
        setResult({ requestKey, status: "error", data: null, error: message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    authorizationKey,
    "scope" in range ? range.anchorDate : range.from,
    "scope" in range ? range.scope : range.to,
    refreshVersion,
    requestKey,
    spaceId,
    venueId,
  ]);

  if (requestKey === null) {
    return { status: "idle", data: null, error: null, refresh };
  }
  if (result.requestKey !== requestKey) {
    return { status: "loading", data: null, error: null, refresh };
  }
  return { status: result.status, data: result.data, error: result.error, refresh };
}
