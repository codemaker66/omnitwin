import { useCallback, useEffect, useState } from "react";
import type { RoomLayoutTimelineResponse } from "@omnitwin/types";
import { getRoomLayoutTimeline } from "../api/room-layout-timeline.js";

export type RoomLayoutTimelineStatus = "idle" | "loading" | "loaded" | "error";

export interface RoomLayoutTimelineResult {
  readonly status: RoomLayoutTimelineStatus;
  readonly data: RoomLayoutTimelineResponse | null;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useRoomLayoutTimeline(
  venueId: string | null,
  spaceId: string | null,
  fromIso: string,
  toIso: string,
): RoomLayoutTimelineResult {
  const [result, setResult] = useState<RoomLayoutTimelineResult>({
    status: "idle",
    data: null,
    error: null,
    refresh: () => undefined,
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback((): void => {
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (venueId === null || spaceId === null) {
      setResult({ status: "idle", data: null, error: null, refresh });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setResult({ status: "loading", data: null, error: null, refresh });

    void getRoomLayoutTimeline({ venueId, spaceId, from: fromIso, to: toIso }, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setResult({ status: "loaded", data, error: null, refresh });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Room timeline unavailable";
        setResult({ status: "error", data: null, error: message, refresh });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fromIso, refresh, refreshVersion, spaceId, toIso, venueId]);

  return result;
}

