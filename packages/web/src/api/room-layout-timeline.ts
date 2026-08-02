import {
  FreezePhaseLayoutSnapshotResponseSchema,
  RoomLayoutTimelineResponseSchema,
  type FreezePhaseLayoutSnapshotBody,
  type FreezePhaseLayoutSnapshotParams,
  type FreezePhaseLayoutSnapshotResponse,
  type RoomLayoutTimelineQuery,
  type RoomLayoutTimelineResponse,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { api, ApiError, getAuthToken } from "./client.js";

export {
  ROOM_LAYOUT_TIMELINE_MAX_RANGE_MS,
  RoomLayoutTimelineScopeSchema,
  RoomLayoutTimelineLocalDateSchema,
  RoomLayoutTimelineQuerySchema,
  RoomLayoutTimelineInvalidReasonSchema,
  RoomLayoutTimelineKeyframeSchema,
  RoomLayoutTimelineGuestsFigureSchema,
  RoomLayoutTimelineSeatedCapacityFigureSchema,
  RoomLayoutTimelineStaffingFigureSchema,
  RoomLayoutTimelineRevenueFigureSchema,
  RoomLayoutTimelineFiguresSchema,
  RoomLayoutTimelineFrameSchema,
  RoomLayoutTimelineRangeSchema,
  RoomLayoutTimelineResponseSchema,
  FreezePhaseLayoutSnapshotParamsSchema,
  FreezePhaseLayoutSnapshotBodySchema,
  FreezePhaseLayoutSnapshotResponseSchema,
} from "@omnitwin/types";

export type {
  RoomLayoutTimelineScope,
  RoomLayoutTimelineQuery,
  RoomLayoutTimelineInvalidReason,
  RoomLayoutTimelineKeyframe,
  RoomLayoutTimelineFigures,
  RoomLayoutTimelineFrame,
  RoomLayoutTimelineRange,
  RoomLayoutTimelineResponse,
  FreezePhaseLayoutSnapshotParams,
  FreezePhaseLayoutSnapshotBody,
  FreezePhaseLayoutSnapshotResponse,
} from "@omnitwin/types";

export async function getRoomLayoutTimeline(
  query: RoomLayoutTimelineQuery,
  signal?: AbortSignal,
): Promise<RoomLayoutTimelineResponse> {
  const params = new URLSearchParams({
    venueId: query.venueId,
    spaceId: query.spaceId,
    ...("scope" in query
      ? { scope: query.scope, anchorDate: query.anchorDate }
      : { from: query.from, to: query.to }),
  });
  return api.get(
    `/calendar/layout-timeline?${params.toString()}`,
    RoomLayoutTimelineResponseSchema,
    signal,
  );
}

function errorEnvelope(value: unknown): {
  readonly error?: string;
  readonly code?: string;
  readonly details?: unknown;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record["error"] === "string" ? { error: record["error"] } : {}),
    ...(typeof record["code"] === "string" ? { code: record["code"] } : {}),
    ...(record["details"] === undefined ? {} : { details: record["details"] }),
  };
}

/**
 * Freezes the current saved configuration for a phase. Unlike the generic API
 * helper this transport preserves the endpoint's status contract: only an
 * exact 200/201 can advance the timeline; 202/204 cannot masquerade as success.
 */
export async function freezePhaseLayoutSnapshot(
  params: FreezePhaseLayoutSnapshotParams,
  body: FreezePhaseLayoutSnapshotBody,
): Promise<FreezePhaseLayoutSnapshotResponse> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/events/${params.eventId}/phases/${params.phaseId}/layout-snapshots`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  } catch (error) {
    throw new ApiError(0, "Network error — check your connection", "NETWORK_ERROR", error);
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // The exact status check below still reports an actionable protocol error.
  }
  const envelope = errorEnvelope(json);
  if (response.status !== 200 && response.status !== 201) {
    throw new ApiError(
      response.status,
      envelope.error ?? `The freeze endpoint returned unexpected status ${String(response.status)}.`,
      envelope.code ?? "UNEXPECTED_RESPONSE_STATUS",
      envelope.details,
    );
  }
  const payload = json !== null && typeof json === "object" && !Array.isArray(json) && "data" in json
    ? (json as { readonly data: unknown }).data
    : json;
  const parsed = FreezePhaseLayoutSnapshotResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "Server returned an unexpected freeze response shape.",
      "RESPONSE_VALIDATION_ERROR",
      parsed.error.issues,
    );
  }
  const expectedStatus = parsed.data.outcome === "created" ? 201 : 200;
  if (response.status !== expectedStatus) {
    throw new ApiError(
      response.status,
      "Freeze response status did not match its typed outcome.",
      "RESPONSE_STATUS_OUTCOME_MISMATCH",
      { outcome: parsed.data.outcome, expectedStatus },
    );
  }
  if (
    parsed.data.eventId !== params.eventId
    || parsed.data.phaseId !== params.phaseId
    || parsed.data.configurationId !== body.configurationId
  ) {
    throw new ApiError(
      response.status,
      "Freeze response did not match the requested event, phase, and saved plan.",
      "RESPONSE_TARGET_MISMATCH",
      {
        requested: { ...params, configurationId: body.configurationId },
        returned: {
          eventId: parsed.data.eventId,
          phaseId: parsed.data.phaseId,
          configurationId: parsed.data.configurationId,
        },
      },
    );
  }
  return parsed.data;
}
