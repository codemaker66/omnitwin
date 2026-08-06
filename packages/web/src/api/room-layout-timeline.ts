import {
  FreezePhaseLayoutSnapshotResponseSchema,
  RoomLayoutTimelineResponseSchema,
  type FreezePhaseLayoutSnapshotBody,
  type FreezePhaseLayoutSnapshotParams,
  type FreezePhaseLayoutSnapshotResponse,
  type RoomLayoutTimelineQuery,
  type RoomLayoutTimelineResponse,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getRoomLayoutTimeline(
  query: RoomLayoutTimelineQuery,
  signal?: AbortSignal,
): Promise<RoomLayoutTimelineResponse> {
  const params = new URLSearchParams({
    venueId: query.venueId,
    spaceId: query.spaceId,
    from: query.from,
    to: query.to,
  });
  return api.get(
    `/calendar/layout-timeline?${params.toString()}`,
    RoomLayoutTimelineResponseSchema,
    signal,
  );
}

export async function freezePhaseLayoutSnapshot(
  params: FreezePhaseLayoutSnapshotParams,
  body: FreezePhaseLayoutSnapshotBody,
): Promise<FreezePhaseLayoutSnapshotResponse> {
  return api.post(
    `/events/${params.eventId}/phases/${params.phaseId}/layout-snapshots`,
    body,
    false,
    FreezePhaseLayoutSnapshotResponseSchema,
  );
}
