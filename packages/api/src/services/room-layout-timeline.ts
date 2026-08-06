import {
  CanonicalLayoutSnapshotV0Schema,
  PhaseLayoutSnapshotStatusSchema,
  canonicalLayoutSnapshotDigest,
  type PhaseLayoutSnapshotStatus,
  type RoomLayoutTimelineInvalidReason,
  type RoomLayoutTimelineKeyframe,
} from "@omnitwin/types";
import { REAL_METRE_COORDINATE_SPACE } from "../db/coordinate-space.js";

export interface LayoutTimelineSnapshotCandidate {
  readonly id: string;
  readonly eventPhaseId: string;
  readonly configurationId: string | null;
  readonly snapshotHash: string | null;
  readonly status: string;
  readonly objectCount: number;
  readonly guestCount: number | null;
  readonly payload: unknown;
  readonly coordinateSpace: string;
  readonly createdAt: Date;
  readonly frozenAt: Date | null;
  readonly configurationSpaceId: string | null;
  readonly configurationVenueId: string | null;
}

const SNAPSHOT_STATUS_RANK: Readonly<Record<PhaseLayoutSnapshotStatus, number>> = {
  frozen: 0,
  draft: 1,
  stale: 2,
  superseded: 3,
};

function candidateRank(candidate: LayoutTimelineSnapshotCandidate): number {
  const status = PhaseLayoutSnapshotStatusSchema.safeParse(candidate.status);
  return status.success ? SNAPSHOT_STATUS_RANK[status.data] : Number.MAX_SAFE_INTEGER;
}

function candidateRecency(candidate: LayoutTimelineSnapshotCandidate): number {
  return (candidate.frozenAt ?? candidate.createdAt).getTime();
}

/**
 * Chooses the effective persisted snapshot without silently falling through an
 * invalid higher-precedence row. Validation happens after this deterministic
 * selection so data integrity failures remain visible to operators.
 */
export function selectEffectiveLayoutTimelineSnapshot(
  candidates: readonly LayoutTimelineSnapshotCandidate[],
): LayoutTimelineSnapshotCandidate | null {
  return [...candidates].sort((left, right) => {
    const rankDelta = candidateRank(left) - candidateRank(right);
    if (rankDelta !== 0) return rankDelta;
    const recencyDelta = candidateRecency(right) - candidateRecency(left);
    if (recencyDelta !== 0) return recencyDelta;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

interface ResolveKeyframeInput {
  readonly venueId: string;
  readonly spaceId: string;
  readonly isRoomFlip: boolean;
  readonly candidates: readonly LayoutTimelineSnapshotCandidate[];
}

const INVALID_MESSAGES: Readonly<Record<RoomLayoutTimelineInvalidReason, string>> = {
  snapshot_status_invalid: "Saved layout has an unsupported lifecycle status.",
  payload_missing: "Saved layout has no immutable snapshot payload.",
  payload_schema_invalid: "Saved layout payload does not match the canonical snapshot contract.",
  snapshot_hash_missing: "Saved layout has no immutable snapshot digest.",
  snapshot_hash_mismatch: "Saved layout payload does not match its immutable snapshot digest.",
  coordinate_space_invalid: "Saved layout is not stored in verified real-metre coordinates.",
  venue_identity_mismatch: "Saved layout venue identity does not match this event phase.",
  space_identity_mismatch: "Saved layout room identity does not match this event phase.",
  configuration_identity_mismatch: "Saved layout configuration identity does not match its payload.",
  object_count_mismatch: "Saved layout object count does not match its immutable payload.",
};

function invalidKeyframe(
  candidate: LayoutTimelineSnapshotCandidate,
  reason: RoomLayoutTimelineInvalidReason,
  status: PhaseLayoutSnapshotStatus | null,
): RoomLayoutTimelineKeyframe {
  return {
    state: "invalid",
    snapshotId: candidate.id,
    snapshotStatus: status,
    createdAt: candidate.createdAt.toISOString(),
    frozenAt: candidate.frozenAt?.toISOString() ?? null,
    reason,
    message: INVALID_MESSAGES[reason],
  };
}

/** Resolve one phase's truthful keyframe state for the room timeline. */
export function resolveRoomLayoutTimelineKeyframe(
  input: ResolveKeyframeInput,
): RoomLayoutTimelineKeyframe {
  if (input.isRoomFlip) {
    return {
      state: "missing",
      reason: "room_flip_gap",
      message: "Room flip is a transition gap, not a saved layout.",
    };
  }

  const candidate = selectEffectiveLayoutTimelineSnapshot(input.candidates);
  if (candidate === null) {
    return {
      state: "missing",
      reason: "no_snapshot",
      message: "No saved layout for this phase.",
    };
  }

  const status = PhaseLayoutSnapshotStatusSchema.safeParse(candidate.status);
  if (!status.success) {
    return invalidKeyframe(candidate, "snapshot_status_invalid", null);
  }
  if (candidate.payload === null) {
    return invalidKeyframe(candidate, "payload_missing", status.data);
  }
  if (candidate.coordinateSpace !== REAL_METRE_COORDINATE_SPACE) {
    return invalidKeyframe(candidate, "coordinate_space_invalid", status.data);
  }

  const payload = CanonicalLayoutSnapshotV0Schema.safeParse(candidate.payload);
  if (!payload.success) {
    return invalidKeyframe(candidate, "payload_schema_invalid", status.data);
  }
  if (candidate.snapshotHash === null) {
    return invalidKeyframe(candidate, "snapshot_hash_missing", status.data);
  }
  if (canonicalLayoutSnapshotDigest(payload.data) !== candidate.snapshotHash) {
    return invalidKeyframe(candidate, "snapshot_hash_mismatch", status.data);
  }
  if (
    payload.data.venueId !== input.venueId
    || payload.data.venueRuntime.venueId !== input.venueId
    || (candidate.configurationId !== null
      && candidate.configurationVenueId !== input.venueId)
  ) {
    return invalidKeyframe(candidate, "venue_identity_mismatch", status.data);
  }
  if (
    payload.data.spaceId !== input.spaceId
    || payload.data.venueRuntime.spaceId !== input.spaceId
    || (candidate.configurationId !== null
      && candidate.configurationSpaceId !== input.spaceId)
  ) {
    return invalidKeyframe(candidate, "space_identity_mismatch", status.data);
  }
  if (
    candidate.configurationId !== null
    && candidate.configurationId !== payload.data.configurationId
  ) {
    return invalidKeyframe(candidate, "configuration_identity_mismatch", status.data);
  }
  if (candidate.objectCount !== payload.data.objects.length) {
    return invalidKeyframe(candidate, "object_count_mismatch", status.data);
  }

  return {
    state: "available",
    snapshotId: candidate.id,
    snapshotStatus: status.data,
    createdAt: candidate.createdAt.toISOString(),
    frozenAt: candidate.frozenAt?.toISOString() ?? null,
    objectCount: candidate.objectCount,
    guestCount: candidate.guestCount,
    payload: payload.data,
  };
}
