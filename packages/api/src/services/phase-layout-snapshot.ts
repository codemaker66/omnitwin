import {
  CanonicalJsonValueSchema,
  CanonicalLayoutSnapshotV0Schema,
  LayoutValidatorRunSchema,
  canonicalLayoutSnapshotDigest,
  deterministicEventArchitectUuid,
  normalizeCanonicalLayoutSnapshot,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type CanonicalLayoutSnapshotV0,
} from "@omnitwin/types";
import { REAL_METRE_COORDINATE_SPACE } from "../db/coordinate-space.js";

const LAYOUT_PROOF_DOMAIN_PREFIX = "venviewer.layout-proof.v0\n";

export type PhaseLayoutSnapshotConflictCode =
  | "PHASE_EVENT_MISMATCH"
  | "ROOM_FLIP_NOT_LAYOUT_PHASE"
  | "PHASE_ROOM_UNSCOPED"
  | "CONFIGURATION_VENUE_MISMATCH"
  | "CONFIGURATION_SPACE_MISMATCH"
  | "CONFIGURATION_IDENTITY_MISMATCH"
  | "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING"
  | "CONFIGURATION_CANONICAL_SNAPSHOT_INVALID"
  | "CONFIGURATION_CANONICAL_SNAPSHOT_DIGEST_MISMATCH"
  | "CONFIGURATION_CANONICAL_SNAPSHOT_STALE"
  | "CONFIGURATION_LAYOUT_MISMATCH"
  | "CONFIGURATION_COORDINATE_SPACE_INVALID"
  | "CONFIGURATION_OBJECT_COUNT_MISMATCH"
  | "CONFIGURATION_OBJECT_ID_MISMATCH"
  | "CONFIGURATION_OBJECT_CONTENT_MISMATCH"
  | "CONFIGURATION_PROOF_MISSING"
  | "CONFIGURATION_PROOF_INVALID";

const CONFLICT_MESSAGES: Readonly<Record<PhaseLayoutSnapshotConflictCode, string>> = {
  PHASE_EVENT_MISMATCH: "The selected phase does not belong to this event.",
  ROOM_FLIP_NOT_LAYOUT_PHASE: "Room flips are transition gaps and cannot carry a saved layout.",
  PHASE_ROOM_UNSCOPED: "This phase must be assigned to a room before a layout can be linked.",
  CONFIGURATION_VENUE_MISMATCH: "The saved plan belongs to a different venue.",
  CONFIGURATION_SPACE_MISMATCH: "The saved plan belongs to a different room.",
  CONFIGURATION_IDENTITY_MISMATCH:
    "The canonical snapshot belongs to a different saved plan.",
  CONFIGURATION_CANONICAL_SNAPSHOT_MISSING:
    "This saved plan has no canonical planning snapshot. Generate or select a proof-carrying plan first.",
  CONFIGURATION_CANONICAL_SNAPSHOT_INVALID:
    "The saved plan's canonical snapshot is invalid and cannot be used.",
  CONFIGURATION_CANONICAL_SNAPSHOT_DIGEST_MISMATCH:
    "The saved plan no longer matches its canonical snapshot digest.",
  CONFIGURATION_CANONICAL_SNAPSHOT_STALE:
    "The saved plan changed after its canonical snapshot was created. Regenerate planning evidence first.",
  CONFIGURATION_LAYOUT_MISMATCH:
    "The saved plan metadata no longer matches its canonical snapshot.",
  CONFIGURATION_COORDINATE_SPACE_INVALID:
    "The saved plan is not entirely stored in verified real-metre coordinates.",
  CONFIGURATION_OBJECT_COUNT_MISMATCH:
    "The saved plan object count no longer matches its canonical snapshot.",
  CONFIGURATION_OBJECT_ID_MISMATCH:
    "The saved plan objects no longer match its canonical snapshot.",
  CONFIGURATION_OBJECT_CONTENT_MISMATCH:
    "The saved plan geometry or furniture data no longer matches its canonical snapshot.",
  CONFIGURATION_PROOF_MISSING:
    "This saved plan has no planning-evidence run attached to its canonical snapshot.",
  CONFIGURATION_PROOF_INVALID:
    "The planning-evidence run attached to this saved plan is invalid.",
};

export class PhaseLayoutSnapshotConflictError extends Error {
  readonly code: PhaseLayoutSnapshotConflictCode;

  constructor(code: PhaseLayoutSnapshotConflictCode) {
    super(CONFLICT_MESSAGES[code]);
    this.name = "PhaseLayoutSnapshotConflictError";
    this.code = code;
  }
}

interface PhaseIdentitySource {
  readonly id: string;
  readonly eventId: string;
  readonly spaceId: string | null;
  readonly templateKey: string | null;
  readonly name: string;
}

interface EventIdentitySource {
  readonly id: string;
  readonly venueId: string;
}

interface ConfigurationIdentitySource {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly name: string;
  readonly layoutStyle: string;
  readonly visibility: string;
  readonly guestCount: number;
  readonly updatedAt: Date;
}

interface CanonicalSnapshotSource {
  readonly id: string;
  readonly configurationId: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly snapshotDigest: string;
  readonly payload: unknown;
}

export interface LayoutProofSource {
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly proofDigest: string;
  readonly payload: unknown;
}

interface PersistedLayoutObjectIdentity {
  readonly id: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  readonly metadata: unknown;
  readonly coordinateSpace: string;
  readonly assetCategory: string;
  readonly assetWidthM: number;
  readonly assetDepthM: number;
  readonly assetHeightM: number;
  readonly assetSeatCount: number | null;
  readonly assetCollisionType: string;
}

export interface VerifyFreezablePhaseLayoutSnapshotInput {
  readonly event: EventIdentitySource;
  readonly phase: PhaseIdentitySource;
  readonly configuration: ConfigurationIdentitySource;
  readonly canonicalSnapshot: CanonicalSnapshotSource | null;
  readonly proof: LayoutProofSource | null;
  readonly persistedObjects: readonly PersistedLayoutObjectIdentity[];
}

export interface VerifiedPhaseLayoutSnapshotSource {
  readonly canonicalSnapshotId: string;
  readonly payload: CanonicalLayoutSnapshotV0;
  readonly snapshotHash: string;
  readonly proofDigest: string;
  readonly objectCount: number;
  readonly guestCount: number;
}

function isRoomFlip(phase: PhaseIdentitySource): boolean {
  return phase.templateKey === "room-flip"
    || (phase.templateKey === null && phase.name.trim().toLowerCase() === "room flip");
}

export function verifiedLayoutProofDigest(
  proof: LayoutProofSource | null,
  canonicalSnapshotId: string,
  snapshotDigest: string,
): string | null {
  if (proof === null) return null;
  const parsed = LayoutValidatorRunSchema.safeParse(proof.payload);
  if (!parsed.success) return null;
  const { proofDigest: storedPayloadDigest, ...proofBody } = parsed.data;
  const recomputedProofDigest = sha256Hex(
    `${LAYOUT_PROOF_DOMAIN_PREFIX}${stableCanonicalJson(CanonicalJsonValueSchema.parse(proofBody))}`,
  );
  if (
    proof.snapshotId !== canonicalSnapshotId
    || proof.snapshotDigest !== snapshotDigest
    || parsed.data.snapshotDigest !== snapshotDigest
    || proof.proofDigest !== storedPayloadDigest
    || recomputedProofDigest !== storedPayloadDigest
  ) {
    return null;
  }
  return storedPayloadDigest;
}

function verifyProof(
  proof: LayoutProofSource | null,
  canonicalSnapshotId: string,
  snapshotDigest: string,
): string {
  if (proof === null) throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_PROOF_MISSING");
  const digest = verifiedLayoutProofDigest(proof, canonicalSnapshotId, snapshotDigest);
  if (digest === null) throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_PROOF_INVALID");
  return digest;
}

interface ComparablePersistedMetadata {
  readonly groupId: string | null;
  readonly metadata: CanonicalJsonValue;
}

function comparablePersistedMetadata(value: unknown): ComparablePersistedMetadata | null {
  const parsed = CanonicalJsonValueSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data === null) return { groupId: null, metadata: null };
  if (typeof parsed.data !== "object" || Array.isArray(parsed.data)) return null;
  const retained: Record<string, CanonicalJsonValue> = {};
  let groupId: string | null = null;
  for (const [key, entry] of Object.entries(parsed.data)) {
    if (key === "groupId") {
      if (entry !== null && typeof entry !== "string") return null;
      groupId = entry;
    } else if (key !== "eventArchitectCandidateId") {
      retained[key] = entry;
    }
  }
  return {
    groupId,
    metadata: Object.keys(retained).length === 0 ? null : retained,
  };
}

function objectContentMatches(
  persisted: PersistedLayoutObjectIdentity,
  canonical: CanonicalLayoutSnapshotV0["objects"][number],
): boolean {
  const metadata = comparablePersistedMetadata(persisted.metadata);
  if (metadata === null) return false;
  return persisted.assetDefinitionId === canonical.assetDefinition.assetDefinitionId
    && persisted.positionX === canonical.position.x
    && persisted.positionY === canonical.position.y
    && persisted.positionZ === canonical.position.z
    && persisted.rotationX === canonical.rotation.x
    && persisted.rotationY === canonical.rotation.y
    && persisted.rotationZ === canonical.rotation.z
    && persisted.scale === canonical.scale
    && persisted.sortOrder === canonical.sortOrder
    && metadata.groupId === canonical.groupId
    && stableCanonicalJson(metadata.metadata) === stableCanonicalJson(canonical.metadata)
    && persisted.assetCategory === canonical.assetDefinition.category
    && persisted.assetWidthM === canonical.assetDefinition.widthM
    && persisted.assetDepthM === canonical.assetDefinition.depthM
    && persisted.assetHeightM === canonical.assetDefinition.heightM
    && persisted.assetSeatCount === canonical.assetDefinition.seatCount
    && persisted.assetCollisionType === canonical.assetDefinition.collisionType;
}

function verifyPersistedObjects(
  objects: readonly PersistedLayoutObjectIdentity[],
  payload: CanonicalLayoutSnapshotV0,
): void {
  if (objects.some((object) => object.coordinateSpace !== REAL_METRE_COORDINATE_SPACE)) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_COORDINATE_SPACE_INVALID");
  }
  if (objects.length !== payload.objects.length) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_OBJECT_COUNT_MISMATCH");
  }
  const canonical = normalizeCanonicalLayoutSnapshot(payload);
  const persistedIds = objects.map((object) => object.id).sort();
  const canonicalIds = canonical.objects.map((object) => object.objectId).sort();
  if (persistedIds.some((id, index) => id !== canonicalIds[index])) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_OBJECT_ID_MISMATCH");
  }
  const canonicalById = new Map(canonical.objects.map((object) => [object.objectId, object]));
  if (objects.some((object) => {
    const canonicalObject = canonicalById.get(object.id);
    return canonicalObject === undefined || !objectContentMatches(object, canonicalObject);
  })) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_OBJECT_CONTENT_MISMATCH");
  }
}

/**
 * Verifies the complete server-owned source before a phase snapshot row is
 * appended. This never accepts browser geometry or browser-computed counts.
 */
export function verifyFreezablePhaseLayoutSnapshot(
  input: VerifyFreezablePhaseLayoutSnapshotInput,
): VerifiedPhaseLayoutSnapshotSource {
  if (input.phase.eventId !== input.event.id) {
    throw new PhaseLayoutSnapshotConflictError("PHASE_EVENT_MISMATCH");
  }
  if (isRoomFlip(input.phase)) {
    throw new PhaseLayoutSnapshotConflictError("ROOM_FLIP_NOT_LAYOUT_PHASE");
  }
  if (input.phase.spaceId === null) {
    throw new PhaseLayoutSnapshotConflictError("PHASE_ROOM_UNSCOPED");
  }
  if (input.configuration.venueId !== input.event.venueId) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_VENUE_MISMATCH");
  }
  if (input.configuration.spaceId !== input.phase.spaceId) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_SPACE_MISMATCH");
  }
  if (input.canonicalSnapshot === null) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_CANONICAL_SNAPSHOT_MISSING");
  }

  const parsed = CanonicalLayoutSnapshotV0Schema.safeParse(input.canonicalSnapshot.payload);
  if (!parsed.success) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_CANONICAL_SNAPSHOT_INVALID");
  }
  const payload = parsed.data;
  const digest = canonicalLayoutSnapshotDigest(payload);
  if (digest !== input.canonicalSnapshot.snapshotDigest) {
    throw new PhaseLayoutSnapshotConflictError(
      "CONFIGURATION_CANONICAL_SNAPSHOT_DIGEST_MISMATCH",
    );
  }
  if (
    input.canonicalSnapshot.configurationId !== input.configuration.id
    || payload.configurationId !== input.configuration.id
  ) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_IDENTITY_MISMATCH");
  }
  if (
    input.canonicalSnapshot.venueId !== input.event.venueId
    || payload.venueId !== input.event.venueId
    || payload.venueRuntime.venueId !== input.event.venueId
  ) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_VENUE_MISMATCH");
  }
  if (
    input.canonicalSnapshot.spaceId !== input.phase.spaceId
    || payload.spaceId !== input.phase.spaceId
    || payload.venueRuntime.spaceId !== input.phase.spaceId
  ) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_SPACE_MISMATCH");
  }
  if (payload.createdFromConfigurationUpdatedAt !== input.configuration.updatedAt.toISOString()) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_CANONICAL_SNAPSHOT_STALE");
  }
  if (
    payload.layoutName !== input.configuration.name
    || payload.layoutStyle !== input.configuration.layoutStyle
    || payload.visibility !== input.configuration.visibility
    || payload.guestCount !== input.configuration.guestCount
    || payload.eventMetadata.guestCount !== input.configuration.guestCount
  ) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_LAYOUT_MISMATCH");
  }

  verifyPersistedObjects(input.persistedObjects, payload);
  const proofDigest = verifyProof(
    input.proof,
    input.canonicalSnapshot.id,
    input.canonicalSnapshot.snapshotDigest,
  );
  return {
    canonicalSnapshotId: input.canonicalSnapshot.id,
    payload,
    snapshotHash: digest,
    proofDigest,
    objectCount: payload.objects.length,
    guestCount: payload.guestCount,
  };
}

/** Append identity is deterministic relative to the immutable predecessor. */
export function phaseLayoutSnapshotAppendId(
  phaseId: string,
  snapshotHash: string,
  predecessorSnapshotId: string | null,
): string {
  return deterministicEventArchitectUuid(
    `phase-layout-snapshot:${phaseId}:${snapshotHash}:${predecessorSnapshotId ?? "root"}`,
  );
}

/** Guarantees the appended frozen row wins the timeline's recency ordering. */
export function nextPhaseLayoutSnapshotFrozenAt(
  now: Date,
  predecessor: { readonly createdAt: Date; readonly frozenAt: Date | null } | null,
): Date {
  if (predecessor === null) return now;
  const predecessorMs = (predecessor.frozenAt ?? predecessor.createdAt).getTime();
  return new Date(Math.max(now.getTime(), predecessorMs + 1));
}
