import {
  CanonicalLayoutSnapshotV0Schema,
  PhaseLayoutSnapshotIdSchema,
  PhaseLayoutSnapshotStatusSchema,
  RoomLayoutTimelineRevenueFigureSchema,
  UserIdSchema,
  canonicalLayoutSnapshotDigest,
  type PhaseLayoutSnapshotStatus,
  type RoomLayoutTimelineFigures,
  type RoomLayoutTimelineInvalidReason,
  type RoomLayoutTimelineKeyframe,
} from "@omnitwin/types";
import { REAL_METRE_COORDINATE_SPACE } from "../db/coordinate-space.js";
import {
  verifiedLayoutProofDigest,
  type LayoutProofSource,
} from "./phase-layout-snapshot.js";

export interface LayoutTimelinePredecessorCandidate {
  readonly id: string;
  readonly eventPhaseId: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly frozenAt: Date | null;
}

export interface LayoutTimelineSnapshotCandidate {
  readonly id: string;
  readonly eventPhaseId: string;
  readonly configurationId: string | null;
  readonly canonicalSnapshotId: string | null;
  readonly proofDigest: string | null;
  readonly supersedesSnapshotId: string | null;
  readonly frozenBy: string | null;
  readonly canonicalRowId: string | null;
  readonly canonicalConfigurationId: string | null;
  readonly canonicalVenueId: string | null;
  readonly canonicalSpaceId: string | null;
  readonly canonicalSnapshotDigest: string | null;
  readonly canonicalPayload: unknown;
  readonly proofSnapshotId: string | null;
  readonly proofSnapshotDigest: string | null;
  readonly proofRowDigest: string | null;
  readonly proofPayload: unknown;
  readonly predecessor: LayoutTimelinePredecessorCandidate | null;
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

export function deriveRoomLayoutTimelineGuestsFigure(input: {
  readonly keyframe: RoomLayoutTimelineKeyframe;
  readonly phaseGuestCount: number | null;
  readonly eventGuestCount: number;
}): RoomLayoutTimelineFigures["guests"] {
  if (input.keyframe.state === "available") {
    return { value: input.keyframe.payload.guestCount, source: "frozen_snapshot" };
  }
  if (input.phaseGuestCount !== null) {
    return { value: input.phaseGuestCount, source: "phase" };
  }
  return { value: input.eventGuestCount, source: "event" };
}

/** Mirrors layout-validator's chair-first seating-provision derivation. */
export function deriveRoomLayoutTimelineSeatedCapacity(
  keyframe: RoomLayoutTimelineKeyframe,
): RoomLayoutTimelineFigures["seatedCapacity"] {
  if (keyframe.state !== "available") {
    return { state: "unavailable", reason: "no_valid_frozen_keyframe" };
  }
  const chairs = keyframe.payload.objects.filter(
    (object) => object.assetDefinition.category === "chair",
  );
  const tables = keyframe.payload.objects.filter(
    (object) => object.assetDefinition.category === "table",
  );
  const complete = (objects: typeof chairs): boolean => objects.length > 0
    && objects.every((object) => (
      object.assetDefinition.seatCount !== null
      && Number.isInteger(object.assetDefinition.seatCount)
      && object.assetDefinition.seatCount > 0
    ));
  const seatingBasis = complete(chairs) ? chairs : complete(tables) ? tables : null;
  if (seatingBasis === null) {
    return { state: "unavailable", reason: "capacity_evidence_incomplete" };
  }
  return {
    state: "available",
    value: seatingBasis.reduce(
      (sum, object) => sum + (object.assetDefinition.seatCount ?? 0),
      0,
    ),
    source: "frozen_snapshot",
    basis: seatingBasis === chairs ? "chair_objects" : "table_seat_counts",
  };
}

export interface LayoutTimelineRevenueScenarioCandidate {
  readonly id: string;
  readonly venueId: string;
  readonly eventId: string | null;
  readonly configurationId: string | null;
  readonly name: string;
  readonly status: string;
  readonly scenarioKind: string;
  readonly currency: string;
  readonly plannedGuestCount: number;
  readonly estimatedRevenueMinor: number;
  readonly comfortStatus: string;
  readonly reviewGateCount: number;
  readonly updatedAt: Date;
}

export function deriveRoomLayoutTimelineRevenueFigure(input: {
  readonly venueId: string;
  readonly eventId: string;
  readonly commercialAccess: boolean;
  readonly keyframe: RoomLayoutTimelineKeyframe;
  readonly candidates: readonly LayoutTimelineRevenueScenarioCandidate[];
}): RoomLayoutTimelineFigures["revenue"] {
  if (!input.commercialAccess) {
    return { state: "restricted", reason: "insufficient_commercial_access" };
  }
  if (input.keyframe.state !== "available") {
    return { state: "unavailable", reason: "no_valid_frozen_keyframe" };
  }
  const configurationId = input.keyframe.payload.configurationId;
  const selected = input.candidates
    .filter((candidate) => (
      candidate.venueId === input.venueId
      && candidate.configurationId === configurationId
      && (candidate.eventId === null || candidate.eventId === input.eventId)
      && (candidate.status === "active" || candidate.status === "draft")
    ))
    .sort((left, right) => {
      const statusDelta = (left.status === "active" ? 0 : 1)
        - (right.status === "active" ? 0 : 1);
      if (statusDelta !== 0) return statusDelta;
      const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime();
      return updatedDelta !== 0 ? updatedDelta : right.id.localeCompare(left.id);
    })[0];
  if (selected === undefined) {
    return { state: "unavailable", reason: "no_matching_planning_scenario" };
  }
  if (selected.plannedGuestCount !== input.keyframe.payload.guestCount) {
    return { state: "unavailable", reason: "planning_scenario_stale" };
  }
  const parsed = RoomLayoutTimelineRevenueFigureSchema.safeParse({
    state: "available",
    source: "planning_scenario",
    scenario: {
      id: selected.id,
      name: selected.name,
      status: selected.status,
      scenarioKind: selected.scenarioKind,
      currency: selected.currency,
      plannedGuestCount: selected.plannedGuestCount,
      estimatedRevenueMinor: selected.estimatedRevenueMinor,
      comfortStatus: selected.comfortStatus,
      reviewGateCount: selected.reviewGateCount,
      updatedAt: selected.updatedAt.toISOString(),
    },
    disclosure: "Planning scenario estimate; not a quote or approval.",
  });
  return parsed.success
    ? parsed.data
    : { state: "unavailable", reason: "no_matching_planning_scenario" };
}

interface ResolveKeyframeInput {
  readonly venueId: string;
  readonly spaceId: string;
  readonly isRoomFlip: boolean;
  readonly candidates: readonly LayoutTimelineSnapshotCandidate[];
}

const INVALID_MESSAGES: Readonly<Record<RoomLayoutTimelineInvalidReason, string>> = {
  snapshot_status_invalid: "Saved layout has an unsupported lifecycle status.",
  snapshot_not_frozen: "Saved layout is mutable and cannot drive a room preview.",
  frozen_lineage_missing: "Frozen layout is missing canonical proof or actor lineage.",
  frozen_lineage_invalid: "Frozen layout lineage is malformed and cannot be trusted.",
  canonical_lineage_mismatch: "Frozen layout does not match its referenced canonical snapshot.",
  proof_lineage_mismatch: "Frozen layout proof does not verify against its canonical snapshot.",
  predecessor_lineage_mismatch: "Frozen layout predecessor is not an earlier keyframe for this phase.",
  payload_missing: "Saved layout has no immutable snapshot payload.",
  payload_schema_invalid: "Saved layout payload does not match the canonical snapshot contract.",
  snapshot_hash_missing: "Saved layout has no immutable snapshot digest.",
  snapshot_hash_mismatch: "Saved layout payload does not match its immutable snapshot digest.",
  coordinate_space_invalid: "Saved layout is not stored in verified real-metre coordinates.",
  venue_identity_mismatch: "Saved layout venue identity does not match this event phase.",
  space_identity_mismatch: "Saved layout room identity does not match this event phase.",
  configuration_identity_mismatch: "Saved layout configuration identity does not match its payload.",
  object_count_mismatch: "Saved layout object count does not match its immutable payload.",
  guest_count_mismatch: "Saved layout guest count does not match its immutable payload.",
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
  if (status.data !== "frozen") {
    return invalidKeyframe(candidate, "snapshot_not_frozen", status.data);
  }
  if (
    candidate.canonicalSnapshotId === null
    || candidate.proofDigest === null
    || candidate.frozenBy === null
    || candidate.frozenAt === null
  ) {
    return invalidKeyframe(candidate, "frozen_lineage_missing", status.data);
  }
  if (
    !PhaseLayoutSnapshotIdSchema.safeParse(candidate.canonicalSnapshotId).success
    || !/^[a-f0-9]{64}$/u.test(candidate.proofDigest)
    || !UserIdSchema.safeParse(candidate.frozenBy).success
    || (candidate.supersedesSnapshotId !== null
      && !PhaseLayoutSnapshotIdSchema.safeParse(candidate.supersedesSnapshotId).success)
  ) {
    return invalidKeyframe(candidate, "frozen_lineage_invalid", status.data);
  }
  if (candidate.supersedesSnapshotId !== null) {
    const predecessor = candidate.predecessor;
    const predecessorAt = predecessor === null
      ? Number.NaN
      : (predecessor.frozenAt ?? predecessor.createdAt).getTime();
    if (
      predecessor === null
      || predecessor.id !== candidate.supersedesSnapshotId
      || predecessor.eventPhaseId !== candidate.eventPhaseId
      || predecessor.status !== "frozen"
      || predecessor.frozenAt === null
      || predecessorAt >= candidate.frozenAt.getTime()
    ) {
      return invalidKeyframe(candidate, "predecessor_lineage_mismatch", status.data);
    }
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
  const copiedPayloadDigest = canonicalLayoutSnapshotDigest(payload.data);
  if (copiedPayloadDigest !== candidate.snapshotHash) {
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
  if (candidate.guestCount !== payload.data.guestCount) {
    return invalidKeyframe(candidate, "guest_count_mismatch", status.data);
  }

  const canonicalPayload = CanonicalLayoutSnapshotV0Schema.safeParse(candidate.canonicalPayload);
  if (
    candidate.configurationId === null
    || candidate.canonicalRowId !== candidate.canonicalSnapshotId
    || candidate.canonicalConfigurationId !== candidate.configurationId
    || candidate.canonicalVenueId !== input.venueId
    || candidate.canonicalSpaceId !== input.spaceId
    || candidate.canonicalSnapshotDigest !== candidate.snapshotHash
    || !canonicalPayload.success
    || canonicalPayload.data.configurationId !== candidate.configurationId
    || canonicalPayload.data.venueId !== input.venueId
    || canonicalPayload.data.venueRuntime.venueId !== input.venueId
    || canonicalPayload.data.spaceId !== input.spaceId
    || canonicalPayload.data.venueRuntime.spaceId !== input.spaceId
    || canonicalLayoutSnapshotDigest(canonicalPayload.data) !== candidate.snapshotHash
    || copiedPayloadDigest !== canonicalLayoutSnapshotDigest(canonicalPayload.data)
  ) {
    return invalidKeyframe(candidate, "canonical_lineage_mismatch", status.data);
  }

  const proof: LayoutProofSource | null = candidate.proofSnapshotId === null
    || candidate.proofSnapshotDigest === null
    || candidate.proofRowDigest === null
    ? null
    : {
        snapshotId: candidate.proofSnapshotId,
        snapshotDigest: candidate.proofSnapshotDigest,
        proofDigest: candidate.proofRowDigest,
        payload: candidate.proofPayload,
      };
  if (
    verifiedLayoutProofDigest(
      proof,
      candidate.canonicalSnapshotId,
      candidate.snapshotHash,
    ) !== candidate.proofDigest
  ) {
    return invalidKeyframe(candidate, "proof_lineage_mismatch", status.data);
  }

  return {
    state: "available",
    snapshotId: candidate.id,
    snapshotStatus: "frozen",
    canonicalSnapshotId: candidate.canonicalSnapshotId,
    proofDigest: candidate.proofDigest,
    frozenBy: candidate.frozenBy,
    supersedesSnapshotId: candidate.supersedesSnapshotId,
    createdAt: candidate.createdAt.toISOString(),
    frozenAt: candidate.frozenAt.toISOString(),
    objectCount: candidate.objectCount,
    guestCount: candidate.guestCount,
    payload: payload.data,
  };
}
