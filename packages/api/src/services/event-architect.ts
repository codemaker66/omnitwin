import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  CreateEventArchitectRunInputSchema,
  EventArchitectCandidateSelectionSchema,
  EventArchitectRequestSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  FloorPlanOutlineSchema,
  deterministicEventArchitectUuid,
  runEventArchitect,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type CreateEventArchitectRunInput,
  type EventArchitectCandidate,
  type EventArchitectCandidateSelection,
  type EventArchitectRequest,
  type PersistedEventArchitectRun,
  type SelectEventArchitectCandidateInput,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { REAL_METRE_COORDINATE_SPACE } from "../db/coordinate-space.js";
import {
  assetDefinitions,
  canonicalLayoutSnapshots,
  configurationLayoutRevisions,
  configurations,
  eventArchitectCandidates,
  eventArchitectRuns,
  layoutValidationRuns,
  placedObjects,
  runtimePackages,
  spaces,
  venues,
} from "../db/schema.js";

type EventArchitectRunRow = typeof eventArchitectRuns.$inferSelect;

const POLICY_DEFINITION: CanonicalJsonValue = {
  policyBundleId: "venviewer.internal-planning-policy.v0",
  policyBundleVersion: "0.1.0",
  minPrimaryFurnitureClearanceM: 1.2,
  clearanceWarningMarginM: 0.2,
  status: "internal_planning_defaults_requires_human_review",
  humanReviewRequiredFor: [
    "accessibility route",
    "door and obstruction state",
    "egress route",
    "guest-flow simulation",
    "pricing approval",
  ],
};

const POLICY_DIGEST = sha256Hex(stableCanonicalJson(POLICY_DEFINITION));

export interface EventArchitectActor {
  readonly userId: string;
}

export class EventArchitectSourceNotFoundError extends Error {}
export class EventArchitectRunNotFoundError extends Error {}
export class EventArchitectCandidateNotFoundError extends Error {}
export class EventArchitectCatalogueNotReadyError extends Error {
  readonly missingAssetIds: readonly string[];

  constructor(missingAssetIds: readonly string[]) {
    super("The canonical asset catalogue is not ready for this generated layout.");
    this.name = "EventArchitectCatalogueNotReadyError";
    this.missingAssetIds = missingAssetIds;
  }
}
export class EventArchitectSelectionConflictError extends Error {}
export class EventArchitectRequestDigestConflictError extends Error {}
export class EventArchitectIdempotencyConflictError extends Error {}

function toCanonicalJson(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite runtime manifest value cannot be canonicalised.");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => toCanonicalJson(entry));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toCanonicalJson(entry)]),
    );
  }
  throw new Error("Unsupported runtime manifest value.");
}

function serializeRun(row: EventArchitectRunRow): PersistedEventArchitectRun {
  return PersistedEventArchitectRunSchema.parse({
    run: row.runPayload,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    selectedCandidateId: row.selectedCandidateId,
    selectedConfigurationId: row.selectedConfigurationId,
    selectedSnapshotDigest: row.selectedSnapshotDigest,
    selectedProofDigest: row.selectedProofDigest,
  });
}

function createEnvelopeMatches(
  row: EventArchitectRunRow,
  input: CreateEventArchitectRunInput,
): boolean {
  return row.venueId === input.venueId &&
    row.spaceId === input.spaceId &&
    stableCanonicalJson(toCanonicalJson(row.requestPayload.brief)) ===
      stableCanonicalJson(toCanonicalJson(input.brief));
}

async function existingRunForIdempotency(
  db: Database,
  actorUserId: string,
  idempotencyKey: string,
): Promise<EventArchitectRunRow | null> {
  const [row] = await db.select().from(eventArchitectRuns).where(and(
    eq(eventArchitectRuns.createdBy, actorUserId),
    eq(eventArchitectRuns.idempotencyKey, idempotencyKey),
  )).limit(1);
  return row ?? null;
}

async function buildFrozenRequest(
  db: Database,
  input: CreateEventArchitectRunInput,
  actor: EventArchitectActor,
): Promise<EventArchitectRequest> {
  const [source] = await db.select({ venue: venues, space: spaces })
    .from(spaces)
    .innerJoin(venues, eq(spaces.venueId, venues.id))
    .where(and(
      eq(spaces.id, input.spaceId),
      eq(spaces.venueId, input.venueId),
      isNull(spaces.deletedAt),
      isNull(venues.deletedAt),
    ))
    .limit(1);
  if (source === undefined) throw new EventArchitectSourceNotFoundError();

  const [runtime] = await db.select().from(runtimePackages).where(and(
    eq(runtimePackages.venueSlug, source.venue.slug),
    eq(runtimePackages.roomSlug, source.space.slug),
    or(
      eq(runtimePackages.runtimeStatus, "internal_ready"),
      eq(runtimePackages.runtimeStatus, "published"),
    ),
  )).orderBy(desc(runtimePackages.createdAt)).limit(1);

  const outline = FloorPlanOutlineSchema.parse(source.space.floorPlanOutline);
  const now = new Date().toISOString();
  return EventArchitectRequestSchema.parse({
    configurationId: deterministicEventArchitectUuid(
      `request:${actor.userId}:${input.idempotencyKey}:${input.venueId}:${input.spaceId}`,
    ),
    createdBy: actor.userId,
    configurationUpdatedAt: now,
    snapshotCreatedAt: now,
    brief: input.brief,
    room: {
      venueId: source.venue.id,
      venueSlug: source.venue.slug,
      spaceId: source.space.id,
      spaceSlug: source.space.slug,
      spaceName: source.space.name,
      floorPlanOutline: outline,
      floorPlanOutlineDigest: sha256Hex(stableCanonicalJson(toCanonicalJson(outline))),
      spaceDimensions: {
        width: Number(source.space.widthM),
        length: Number(source.space.lengthM),
        height: Number(source.space.heightM),
      },
      roomGeometrySource: "space_floor_plan_outline",
      runtimeVenueManifestDigest: runtime === undefined
        ? null
        : sha256Hex(stableCanonicalJson(toCanonicalJson(runtime.manifestJson))),
      runtimePackageId: runtime?.id ?? null,
    },
    policyBundle: {
      policyBundleId: "venviewer.internal-planning-policy.v0",
      policyBundleDigest: POLICY_DIGEST,
      policyBundleVersion: "0.1.0",
      effectiveFrom: null,
      effectiveTo: null,
      jurisdiction: "Internal venue planning context",
      venueRuleSet: "Venviewer conservative planning defaults v0",
      humanReviewRequiredFor: [
        "accessibility route",
        "door and obstruction state",
        "egress route",
        "guest-flow simulation",
        "pricing approval",
      ],
    },
    tolerancePolicy: {
      positionPrecisionM: 0.001,
      rotationPrecisionRad: 0.00001,
      scalePrecision: 0.001,
      floorContainmentToleranceM: 0.01,
      clearanceToleranceM: 0.01,
      currencyPrecisionMinorUnit: 1,
    },
    validatorPolicy: {
      minPrimaryFurnitureClearanceM: 1.2,
      clearanceWarningMarginM: 0.2,
    },
    // Pricing is deliberately absent until an asset-complete, versioned price
    // book exists. The validator emits not_checked + a blocking review gate.
    pricingCatalogue: null,
  });
}

function allAssetIds(candidates: readonly EventArchitectCandidate[]): string[] {
  return [...new Set(candidates.flatMap((candidate) =>
    candidate.snapshot.objects.map((object) => object.assetDefinition.assetDefinitionId)
  ))].sort();
}

async function assertCatalogueReady(
  db: Database,
  candidates: readonly EventArchitectCandidate[],
): Promise<void> {
  const requiredIds = allAssetIds(candidates);
  if (requiredIds.length === 0) return;
  const rows = await db.select({ id: assetDefinitions.id })
    .from(assetDefinitions)
    .where(inArray(assetDefinitions.id, requiredIds));
  const present = new Set(rows.map((row) => row.id));
  const missing = requiredIds.filter((id) => !present.has(id));
  if (missing.length > 0) throw new EventArchitectCatalogueNotReadyError(missing);
}

function snapshotIdFor(candidate: EventArchitectCandidate): string {
  return deterministicEventArchitectUuid(`canonical-snapshot:${candidate.snapshotDigest}`);
}

function validationIdFor(candidate: EventArchitectCandidate): string {
  return deterministicEventArchitectUuid(`layout-validation:${candidate.validation.proofDigest}`);
}

export async function createEventArchitectRun(
  db: Database,
  input: CreateEventArchitectRunInput,
  actor: EventArchitectActor,
): Promise<PersistedEventArchitectRun> {
  const parsed = CreateEventArchitectRunInputSchema.parse(input);
  const existing = await existingRunForIdempotency(db, actor.userId, parsed.idempotencyKey);
  if (existing !== null) {
    if (!createEnvelopeMatches(existing, parsed)) throw new EventArchitectIdempotencyConflictError();
    return serializeRun(existing);
  }

  const request = await buildFrozenRequest(db, parsed, actor);
  const run = runEventArchitect(request);
  await assertCatalogueReady(db, run.candidates);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actor.userId}:${parsed.idempotencyKey}`}, 0))`);
    const [idempotent] = await tx.select().from(eventArchitectRuns).where(and(
      eq(eventArchitectRuns.createdBy, actor.userId),
      eq(eventArchitectRuns.idempotencyKey, parsed.idempotencyKey),
    )).limit(1);
    if (idempotent !== undefined) {
      if (!createEnvelopeMatches(idempotent, parsed)) throw new EventArchitectIdempotencyConflictError();
      return serializeRun(idempotent);
    }

    const now = new Date(request.snapshotCreatedAt);
    const [runRow] = await tx.insert(eventArchitectRuns).values({
      id: run.runId,
      venueId: request.room.venueId,
      spaceId: request.room.spaceId,
      createdBy: actor.userId,
      idempotencyKey: parsed.idempotencyKey,
      requestDigest: run.requestDigest,
      engineVersion: run.engineVersion,
      engineDigest: run.engineDigest,
      requestPayload: request,
      runPayload: run,
      createdAt: now,
    }).returning();
    if (runRow === undefined) throw new Error("Event Architect run insertion returned no row.");

    for (const candidate of run.candidates) {
      const snapshotId = snapshotIdFor(candidate);
      const validationRunId = validationIdFor(candidate);
      await tx.insert(configurations).values({
        id: candidate.snapshot.configurationId,
        spaceId: request.room.spaceId,
        venueId: request.room.venueId,
        userId: actor.userId,
        name: candidate.snapshot.layoutName,
        state: "draft",
        reviewStatus: "draft",
        layoutStyle: candidate.snapshot.layoutStyle,
        guestCount: candidate.snapshot.guestCount,
        visibility: "private",
        revision: 1,
        metadata: {
          eventArchitect: {
            schemaVersion: "venviewer.event-architect-candidate.v0",
            runId: run.runId,
            candidateId: candidate.candidateId,
            rank: candidate.rank,
            strategy: candidate.strategy,
            snapshotDigest: candidate.snapshotDigest,
            proofDigest: candidate.validation.proofDigest,
            selectionState: "candidate",
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      if (candidate.snapshot.objects.length > 0) {
        const placementRows: Array<typeof placedObjects.$inferInsert> = candidate.snapshot.objects.map((object) => ({
          id: object.objectId,
          configurationId: candidate.snapshot.configurationId,
          assetDefinitionId: object.assetDefinition.assetDefinitionId,
          positionX: String(object.position.x),
          positionY: String(object.position.y),
          positionZ: String(object.position.z),
          rotationX: String(object.rotation.x),
          rotationY: String(object.rotation.y),
          rotationZ: String(object.rotation.z),
          scale: String(object.scale),
          sortOrder: object.sortOrder,
          metadata: {
            ...(object.metadata ?? {}),
            groupId: object.groupId,
            eventArchitectCandidateId: candidate.candidateId,
          },
          coordinateSpace: REAL_METRE_COORDINATE_SPACE,
          coordinateWriteToken: randomUUID(),
        }));
        await tx.insert(placedObjects).values(placementRows);
      }

      await tx.insert(configurationLayoutRevisions).values({
        configurationId: candidate.snapshot.configurationId,
        revision: 1,
        source: "event_architect_candidate",
        actorUserId: actor.userId,
        payload: {
          schemaVersion: "venviewer.event-architect-candidate.v0",
          runId: run.runId,
          candidateId: candidate.candidateId,
          snapshotDigest: candidate.snapshotDigest,
          proofDigest: candidate.validation.proofDigest,
          snapshot: candidate.snapshot,
        },
        coordinateSpace: REAL_METRE_COORDINATE_SPACE,
        createdAt: now,
      });
      await tx.insert(canonicalLayoutSnapshots).values({
        id: snapshotId,
        configurationId: candidate.snapshot.configurationId,
        venueId: request.room.venueId,
        spaceId: request.room.spaceId,
        schemaVersion: candidate.snapshot.schemaVersion,
        snapshotDigest: candidate.snapshotDigest,
        sourceKind: "event_architect_candidate",
        payload: candidate.snapshot,
        createdBy: actor.userId,
        createdAt: now,
      });
      await tx.insert(layoutValidationRuns).values({
        id: validationRunId,
        snapshotId,
        snapshotDigest: candidate.snapshotDigest,
        validatorVersion: candidate.validation.validatorVersion,
        validatorDigest: candidate.validation.validatorDigest,
        contextDigest: candidate.validation.contextDigest,
        proofDigest: candidate.validation.proofDigest,
        payload: candidate.validation,
        createdAt: now,
      });
      await tx.insert(eventArchitectCandidates).values({
        id: candidate.candidateId,
        runId: run.runId,
        rank: candidate.rank,
        strategy: candidate.strategy,
        configurationId: candidate.snapshot.configurationId,
        snapshotId,
        validationRunId,
        snapshotDigest: candidate.snapshotDigest,
        proofDigest: candidate.validation.proofDigest,
        payload: candidate,
        createdAt: now,
      });
    }

    return serializeRun(runRow);
  });
}

export async function getEventArchitectRun(
  db: Database,
  runId: string,
): Promise<PersistedEventArchitectRun | null> {
  const [row] = await db.select().from(eventArchitectRuns)
    .where(eq(eventArchitectRuns.id, runId))
    .limit(1);
  return row === undefined ? null : serializeRun(row);
}

export async function loadEventArchitectRunScope(
  db: Database,
  runId: string,
): Promise<{ readonly venueId: string; readonly createdBy: string } | null> {
  const [row] = await db.select({
    venueId: eventArchitectRuns.venueId,
    createdBy: eventArchitectRuns.createdBy,
  }).from(eventArchitectRuns).where(eq(eventArchitectRuns.id, runId)).limit(1);
  return row ?? null;
}

export async function loadEventArchitectCandidateScope(
  db: Database,
  candidateId: string,
): Promise<{ readonly runId: string; readonly venueId: string; readonly createdBy: string } | null> {
  const [row] = await db.select({
    runId: eventArchitectRuns.id,
    venueId: eventArchitectRuns.venueId,
    createdBy: eventArchitectRuns.createdBy,
  }).from(eventArchitectCandidates)
    .innerJoin(eventArchitectRuns, eq(eventArchitectCandidates.runId, eventArchitectRuns.id))
    .where(eq(eventArchitectCandidates.id, candidateId))
    .limit(1);
  return row ?? null;
}

export async function selectEventArchitectCandidate(
  db: Database,
  candidateId: string,
  input: SelectEventArchitectCandidateInput,
  actor: EventArchitectActor,
): Promise<EventArchitectCandidateSelection> {
  const parsed = SelectEventArchitectCandidateInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [joined] = await tx.select({
      candidate: eventArchitectCandidates,
      run: eventArchitectRuns,
    }).from(eventArchitectCandidates)
      .innerJoin(eventArchitectRuns, eq(eventArchitectCandidates.runId, eventArchitectRuns.id))
      .where(eq(eventArchitectCandidates.id, candidateId))
      .limit(1);
    if (joined === undefined) throw new EventArchitectCandidateNotFoundError();
    if (joined.run.requestDigest !== parsed.expectedRequestDigest) {
      throw new EventArchitectRequestDigestConflictError();
    }
    if (joined.run.selectedCandidateId !== null && joined.run.selectedCandidateId !== joined.candidate.id) {
      throw new EventArchitectSelectionConflictError();
    }
    if (joined.run.selectedCandidateId === joined.candidate.id && joined.run.selectedAt !== null) {
      return EventArchitectCandidateSelectionSchema.parse({
        runId: joined.run.id,
        candidateId: joined.candidate.id,
        configurationId: joined.candidate.configurationId,
        snapshotDigest: joined.candidate.snapshotDigest,
        proofDigest: joined.candidate.proofDigest,
        plannerPath: `/plan/${joined.candidate.configurationId}`,
        selectedAt: joined.run.selectedAt.toISOString(),
      });
    }

    const now = new Date();
    const [selectedRun] = await tx.update(eventArchitectRuns).set({
      selectedCandidateId: joined.candidate.id,
      selectedConfigurationId: joined.candidate.configurationId,
      selectedSnapshotDigest: joined.candidate.snapshotDigest,
      selectedProofDigest: joined.candidate.proofDigest,
      selectionIdempotencyKey: parsed.idempotencyKey,
      selectedBy: actor.userId,
      selectedAt: now,
    }).where(and(
      eq(eventArchitectRuns.id, joined.run.id),
      isNull(eventArchitectRuns.selectedCandidateId),
    )).returning();
    if (selectedRun === undefined) throw new EventArchitectSelectionConflictError();

    await tx.update(eventArchitectCandidates).set({
      selectedBy: actor.userId,
      selectedAt: now,
    }).where(and(
      eq(eventArchitectCandidates.id, joined.candidate.id),
      eq(eventArchitectCandidates.runId, joined.run.id),
    ));
    return EventArchitectCandidateSelectionSchema.parse({
      runId: selectedRun.id,
      candidateId: joined.candidate.id,
      configurationId: joined.candidate.configurationId,
      snapshotDigest: joined.candidate.snapshotDigest,
      proofDigest: joined.candidate.proofDigest,
      plannerPath: `/plan/${joined.candidate.configurationId}`,
      selectedAt: now.toISOString(),
    });
  });
}
