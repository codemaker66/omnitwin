import { and, desc, eq, isNull, or } from "drizzle-orm";
import { ZodError } from "zod";
import {
  CanonicalJsonValueSchema,
  CanonicalLayoutSnapshotV0Schema,
  ConfigurationMetadataSchema,
  FloorPlanOutlineSchema,
  canonicalLayoutSnapshotDigest,
  deterministicEventArchitectUuid,
  normalizeCanonicalLayoutSnapshot,
  runLayoutValidator,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalLayoutSnapshotV0,
  type LayoutSnapshotVenueRuntimeReference,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { canonicalLayoutSnapshots, layoutValidationRuns, runtimePackages, spaces, venues } from "../db/schema.js";
import {
  PhaseLayoutSnapshotConflictError,
  comparablePersistedMetadata,
  verifyCanonicalPhaseLayoutSource,
  verifyFreezablePhaseLayoutSnapshot,
  verifyProof,
  type VerifyFreezablePhaseLayoutSnapshotInput,
  type VerifiedPhaseLayoutSnapshotSource,
} from "./phase-layout-snapshot.js";
import { planningPolicyBundle, planningTolerancePolicy, planningValidatorContext } from "./layout-planning-policy.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SavedConfiguration = VerifyFreezablePhaseLayoutSnapshotInput["configuration"] & {
  readonly userId: string | null;
  readonly reviewStatus: string;
  readonly metadata: unknown;
};

export interface SavedLayoutEvidenceInput extends VerifyFreezablePhaseLayoutSnapshotInput {
  readonly configuration: SavedConfiguration;
}

function sourceState(reviewStatus: string): CanonicalLayoutSnapshotV0["sourceState"] {
  return reviewStatus === "approved" ? "approved_configuration"
    : ["submitted", "under_review"].includes(reviewStatus) ? "submitted_configuration" : "saved_configuration";
}

/** Pure projection of stored sources; it never creates furniture or room geometry. */
export function buildSavedLayoutSnapshot(input: {
  readonly configuration: SavedConfiguration;
  readonly persistedObjects: SavedLayoutEvidenceInput["persistedObjects"];
  readonly room: LayoutSnapshotVenueRuntimeReference;
  readonly previous: CanonicalLayoutSnapshotV0 | null;
  readonly snapshotCreatedAt: string;
}): CanonicalLayoutSnapshotV0 {
  const { configuration, previous } = input;
  if (input.persistedObjects.some((object) => object.coordinateSpace !== "real_m_v1")) {
    throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_COORDINATE_SPACE_INVALID");
  }
  const metadata = ConfigurationMetadataSchema.parse(configuration.metadata ?? {});
  const objects = input.persistedObjects.map((object) => {
    const comparable = comparablePersistedMetadata(object.metadata);
    if (comparable === null) {
      throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_PLANNING_SOURCE_INVALID");
    }
    return {
      objectId: object.id,
      assetDefinition: {
        assetDefinitionId: object.assetDefinitionId,
        category: object.assetCategory,
        widthM: object.assetWidthM,
        depthM: object.assetDepthM,
        heightM: object.assetHeightM,
        seatCount: object.assetSeatCount,
        collisionType: object.assetCollisionType,
      },
      position: { x: object.positionX, y: object.positionY, z: object.positionZ },
      rotation: { x: object.rotationX, y: object.rotationY, z: object.rotationZ },
      scale: object.scale,
      sortOrder: object.sortOrder,
      groupId: comparable.groupId,
      metadata: comparable.metadata,
    };
  });
  const snapshot = normalizeCanonicalLayoutSnapshot(CanonicalLayoutSnapshotV0Schema.parse({
    schemaVersion: "layout_snapshot.v0",
    configurationId: configuration.id,
    venueId: configuration.venueId,
    spaceId: configuration.spaceId,
    layoutName: configuration.name,
    layoutStyle: configuration.layoutStyle,
    visibility: configuration.visibility,
    guestCount: configuration.guestCount,
    createdFromConfigurationUpdatedAt: configuration.updatedAt.toISOString(),
    createdBy: configuration.userId,
    snapshotCreatedAt: input.snapshotCreatedAt,
    sourceState: sourceState(configuration.reviewStatus),
    units: { lengthUnit: "metre", angleUnit: "radian", timeUnit: "iso8601_utc_timestamp", currency: "GBP" },
    tolerancePolicy: planningTolerancePolicy(),
    eventMetadata: {
      eventType: previous?.eventMetadata.eventType ?? null,
      preferredDate: previous?.eventMetadata.preferredDate ?? null,
      startTime: previous?.eventMetadata.startTime ?? null,
      endTime: previous?.eventMetadata.endTime ?? null,
      guestCount: configuration.guestCount,
      // metadata:null is the API's explicit clear-all operation. Old snapshot
      // instructions must never reappear after that persisted clear.
      specialInstructions: metadata.instructions?.specialInstructions ?? null,
    },
    // Only these two assumptions are known from a manually saved plan.
    scenarioAssumptions: [
      { category: "guest_count", value: configuration.guestCount, source: "planner_input", sourceReference: configuration.id },
      { category: "seating_style", value: configuration.layoutStyle, source: "planner_input", sourceReference: configuration.id },
    ],
    venueRuntime: input.room,
    policyBundle: planningPolicyBundle(),
    generatorProvenance: previous === null ? {
      generatorType: "human", generatorName: "Venviewer saved planner", generatorVersion: "1",
      promptDigest: null, sourceTemplateId: null, humanEditedAfterGeneration: false, generatedAt: null,
    } : previous.generatorProvenance,
    objects,
  }));
  if (previous !== null) {
    snapshot.generatorProvenance.humanEditedAfterGeneration = previous.generatorProvenance.humanEditedAfterGeneration
      || stableCanonicalJson(CanonicalJsonValueSchema.parse(snapshot.objects))
        !== stableCanonicalJson(CanonicalJsonValueSchema.parse(normalizeCanonicalLayoutSnapshot(previous).objects));
  }
  return snapshot;
}

async function loadRoomSource(tx: Transaction, configuration: SavedConfiguration): Promise<LayoutSnapshotVenueRuntimeReference> {
  const [source] = await tx.select({ space: spaces, venue: venues }).from(spaces)
    .innerJoin(venues, eq(spaces.venueId, venues.id))
    .where(and(eq(spaces.id, configuration.spaceId), eq(spaces.venueId, configuration.venueId), isNull(spaces.deletedAt), isNull(venues.deletedAt)))
    .for("share").limit(1);
  if (source === undefined) throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_PLANNING_SOURCE_INVALID");
  const outline = FloorPlanOutlineSchema.parse(source.space.floorPlanOutline);
  const [runtime] = await tx.select().from(runtimePackages).where(and(
    eq(runtimePackages.venueSlug, source.venue.slug), eq(runtimePackages.roomSlug, source.space.slug),
    or(eq(runtimePackages.runtimeStatus, "internal_ready"), eq(runtimePackages.runtimeStatus, "published")),
  )).orderBy(desc(runtimePackages.revision), desc(runtimePackages.id)).limit(1);
  return {
    venueId: source.venue.id, venueSlug: source.venue.slug,
    spaceId: source.space.id, spaceSlug: source.space.slug, spaceName: source.space.name,
    floorPlanOutline: outline,
    floorPlanOutlineDigest: sha256Hex(stableCanonicalJson(CanonicalJsonValueSchema.parse(outline))),
    spaceDimensions: { width: Number(source.space.widthM), length: Number(source.space.lengthM), height: Number(source.space.heightM) },
    roomGeometrySource: "space_floor_plan_outline",
    runtimeVenueManifestDigest: runtime === undefined ? null : sha256Hex(stableCanonicalJson(CanonicalJsonValueSchema.parse(runtime.manifestJson))),
    runtimePackageId: runtime?.id ?? null,
  };
}

/** Caller holds phase/configuration advisory locks and the saved configuration row lock. */
export async function ensureSavedLayoutEvidence(tx: Transaction, input: SavedLayoutEvidenceInput): Promise<VerifiedPhaseLayoutSnapshotSource> {
  let previous: CanonicalLayoutSnapshotV0 | null = null;
  if (input.canonicalSnapshot !== null) {
    // Corrupt or unbound prior evidence is never silently repaired, even when stale.
    previous = verifyCanonicalPhaseLayoutSource(input);
    verifyProof(input.proof, input.canonicalSnapshot.id, input.canonicalSnapshot.snapshotDigest);
    if (previous.createdFromConfigurationUpdatedAt === input.configuration.updatedAt.toISOString()) {
      const verified = verifyFreezablePhaseLayoutSnapshot(input);
      // approveSnapshot changes reviewStatus without advancing updatedAt.
      // Validate current geometry before refreshing that honest source state.
      if (previous.sourceState === sourceState(input.configuration.reviewStatus)) return verified;
    }
  } else {
    // Reuse the authoritative scope/room-flip checks before producing anything.
    try { verifyCanonicalPhaseLayoutSource(input); } catch (error) {
      if (!(error instanceof PhaseLayoutSnapshotConflictError) || error.code !== "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING") throw error;
    }
  }
  const createdAt = new Date(Math.max(Date.now(), previous === null ? 0 : Date.parse(previous.snapshotCreatedAt) + 1));
  let payload: CanonicalLayoutSnapshotV0;
  try {
    const room = await loadRoomSource(tx, input.configuration);
    payload = buildSavedLayoutSnapshot({ ...input, room, previous, snapshotCreatedAt: createdAt.toISOString() });
  } catch (error) {
    if (error instanceof ZodError) throw new PhaseLayoutSnapshotConflictError("CONFIGURATION_PLANNING_SOURCE_INVALID");
    throw error;
  }
  // A real run may include failures/not_checked/human review; persist it verbatim.
  const validation = runLayoutValidator(payload, planningValidatorContext());
  const snapshotDigest = canonicalLayoutSnapshotDigest(payload);
  const id = deterministicEventArchitectUuid(`saved-layout-evidence:${snapshotDigest}`);
  const canonical = { id, configurationId: input.configuration.id, venueId: input.configuration.venueId, spaceId: input.configuration.spaceId, snapshotDigest, payload };
  const proof = { snapshotId: id, snapshotDigest, proofDigest: validation.proofDigest, payload: validation };
  const verified = verifyFreezablePhaseLayoutSnapshot({ ...input, canonicalSnapshot: canonical, proof });
  await tx.insert(canonicalLayoutSnapshots).values({
    ...canonical, schemaVersion: payload.schemaVersion, sourceKind: "saved_configuration", createdBy: input.configuration.userId, createdAt,
  });
  await tx.insert(layoutValidationRuns).values({
    ...proof, id: deterministicEventArchitectUuid(`saved-layout-validation:${validation.proofDigest}`),
    validatorVersion: validation.validatorVersion, validatorDigest: validation.validatorDigest,
    contextDigest: validation.contextDigest, createdAt,
  });
  return verified;
}
