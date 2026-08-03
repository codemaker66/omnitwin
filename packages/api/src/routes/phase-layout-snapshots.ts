import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  CanonicalLayoutSnapshotV0Schema,
  FreezePhaseLayoutSnapshotBodySchema,
  FreezePhaseLayoutSnapshotParamsSchema,
  FreezePhaseLayoutSnapshotResponseSchema,
  PhaseLayoutRuntimeBindingV1Schema,
  canonicalLayoutSnapshotDigest,
  type FreezePhaseLayoutSnapshotResponse,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { REAL_METRE_COORDINATE_SPACE } from "../db/coordinate-space.js";
import {
  canonicalLayoutSnapshots,
  configurations,
  assetDefinitions,
  eventPhases,
  events,
  layoutValidationRuns,
  phaseLayoutSnapshots,
  placedObjects,
  spaces,
  venues,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import {
  PhaseLayoutSnapshotConflictError,
  nextPhaseLayoutSnapshotFrozenAt,
  phaseLayoutSnapshotAppendId,
  verifyFreezablePhaseLayoutSnapshot,
} from "../services/phase-layout-snapshot.js";
import {
  admissionDecisionFromBinding,
  buildPhaseLayoutRuntimeBinding,
  resolvePhaseLayoutRuntimeAdmission,
  runtimeAdmissionDecisionDigest,
  type RuntimeAdmissionDecision,
} from "../services/phase-layout-runtime-admission.js";
import { canWriteEvents, isEventWriteRole } from "../utils/query.js";

type FreezeRouteResult =
  | { readonly state: "not_found"; readonly resource: "event" | "phase" | "configuration" }
  | { readonly state: "forbidden" }
  | { readonly state: "configuration_changed" }
  | { readonly state: "success"; readonly response: FreezePhaseLayoutSnapshotResponse };

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record["code"] === "string") return record["code"];
    current = record["cause"];
  }
  return null;
}

function isCurrentFrozenRow(
  row: {
    readonly configurationId: string | null;
    readonly canonicalSnapshotId: string | null;
    readonly proofDigest: string | null;
    readonly frozenBy: string | null;
    readonly snapshotHash: string | null;
    readonly payload: unknown;
    readonly coordinateSpace: string;
    readonly objectCount: number;
    readonly guestCount: number | null;
  },
  configurationId: string,
  canonicalSnapshotId: string,
  snapshotHash: string,
  proofDigest: string,
  objectCount: number,
  guestCount: number,
): boolean {
  if (
    row.configurationId !== configurationId
    || row.canonicalSnapshotId !== canonicalSnapshotId
    || row.snapshotHash !== snapshotHash
    || row.proofDigest !== proofDigest
    || row.frozenBy === null
    || row.coordinateSpace !== REAL_METRE_COORDINATE_SPACE
    || row.objectCount !== objectCount
    || row.guestCount !== guestCount
  ) return false;
  const payload = CanonicalLayoutSnapshotV0Schema.safeParse(row.payload);
  return payload.success && canonicalLayoutSnapshotDigest(payload.data) === snapshotHash;
}

function currentRuntimeDecisionMatches(
  row: {
    readonly runtimeBindingState: string;
    readonly runtimeBindingDigest: string | null;
    readonly runtimeBinding: unknown;
    readonly runtimePresentationAdmissionId: string | null;
    readonly runtimePresentationAdmissionDecision: "approved" | null;
    readonly runtimePresentationAdmissionReviewedAt: Date | null;
    readonly runtimePresentationAdmissionDigest: string | null;
  },
  decision: RuntimeAdmissionDecision,
): boolean {
  if (
    row.runtimeBindingState !== decision.availability ||
    row.runtimeBindingDigest === null
  ) return false;
  const parsed = PhaseLayoutRuntimeBindingV1Schema.safeParse(row.runtimeBinding);
  if (!parsed.success || parsed.data.bindingDigest !== row.runtimeBindingDigest) return false;
  if (parsed.data.availability === "unavailable") {
    return runtimeAdmissionDecisionDigest(admissionDecisionFromBinding(parsed.data, {
      id: "00000000-0000-4000-8000-000000000000",
      decision: "approved",
      reviewedAt: new Date(0),
      digest: "0".repeat(64),
    })) === runtimeAdmissionDecisionDigest(decision);
  }
  if (
    row.runtimePresentationAdmissionId === null ||
    row.runtimePresentationAdmissionDecision !== "approved" ||
    row.runtimePresentationAdmissionReviewedAt === null ||
    row.runtimePresentationAdmissionDigest === null
  ) return false;
  return runtimeAdmissionDecisionDigest(admissionDecisionFromBinding(parsed.data, {
    id: row.runtimePresentationAdmissionId,
    decision: row.runtimePresentationAdmissionDecision,
    reviewedAt: row.runtimePresentationAdmissionReviewedAt,
    digest: row.runtimePresentationAdmissionDigest,
  })) === runtimeAdmissionDecisionDigest(decision);
}

function runtimeBindingColumns(
  decision: RuntimeAdmissionDecision,
  binding: ReturnType<typeof buildPhaseLayoutRuntimeBinding>,
): Partial<typeof phaseLayoutSnapshots.$inferInsert> {
  const common = {
    runtimeBindingState: binding.availability,
    runtimeBindingDigest: binding.bindingDigest,
    runtimeBinding: binding,
  };
  if (decision.availability === "unavailable") return common;
  return {
    ...common,
    runtimePresentationAdmissionId: decision.presentationAdmissionId,
    runtimePresentationAdmissionDecision: decision.presentationAdmissionDecision,
    runtimePresentationAdmissionReviewedAt: new Date(decision.presentationAdmissionReviewedAt),
    runtimePresentationAdmissionDigest: decision.presentationAdmissionDigest,
    runtimePackageId: decision.runtimePackageId,
    runtimePackageContentDigest: decision.runtimePackageContentDigest,
    runtimeVenueSlug: binding.venueSlug,
    runtimeRoomSlug: binding.spaceSlug,
    runtimeManifestDigest: decision.runtimeManifestDigest,
    runtimeReviewedProfileId: decision.reviewedProfileId,
    runtimeReviewedProfileFingerprint: decision.reviewedProfileManifestFingerprint,
    runtimeRightsEvidenceDigest: decision.rightsEvidenceDigest,
    runtimeSceneAuthorityMapDigest: decision.sceneAuthorityMapDigest,
    runtimeQaRecordId: decision.runtimeQaRecordId,
    runtimeQaRecordKey: decision.runtimeQaRecordKey,
    runtimeQaRecordDigest: decision.runtimeQaRecordDigest,
    runtimeQaDecision: decision.runtimeQaDecision,
    runtimeQaReviewedBy: decision.runtimeQaReviewedBy,
    runtimeQaReviewedAt: new Date(decision.runtimeQaReviewedAt),
    runtimeTransformArtifactRowId: decision.transformArtifactRowId,
    runtimeTransformArtifactId: decision.transformArtifactId,
    runtimeTransformArtifactDigest: decision.transformArtifactDigest,
  };
}

function responseFromRow(input: {
  readonly outcome: "created" | "already_current";
  readonly eventId: string;
  readonly phaseId: string;
  readonly configurationId: string;
  readonly canonicalSnapshotId: string;
  readonly snapshotHash: string;
  readonly proofDigest: string;
  readonly frozenBy: string;
  readonly snapshotId: string;
  readonly objectCount: number;
  readonly guestCount: number;
  readonly createdAt: Date;
  readonly frozenAt: Date;
  readonly supersedesSnapshotId: string | null;
}): FreezePhaseLayoutSnapshotResponse {
  return FreezePhaseLayoutSnapshotResponseSchema.parse({
    ...input,
    status: "frozen",
    coordinateSpace: REAL_METRE_COORDINATE_SPACE,
    createdAt: input.createdAt.toISOString(),
    frozenAt: input.frozenAt.toISOString(),
  });
}

/**
 * Append-only producer for phase keyframes. The request carries identities;
 * every content-bearing field is read, checked, and copied inside one DB
 * transaction from the current proof-carrying canonical snapshot.
 */
export async function phaseLayoutSnapshotRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post(
    "/:eventId/phases/:phaseId/layout-snapshots",
    { preHandler: [authenticate] },
    async (request, reply) => {
      // Refuse read-only roles before parsing identities or loading rows.
      if (!isEventWriteRole(request.user)) {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
      const params = FreezePhaseLayoutSnapshotParamsSchema.safeParse(request.params);
      if (!params.success) return validationError(reply, params.error.issues);
      const body = FreezePhaseLayoutSnapshotBodySchema.safeParse(request.body);
      if (!body.success) return validationError(reply, body.error.issues);

      let result: FreezeRouteResult;
      try {
        result = await db.transaction(async (tx): Promise<FreezeRouteResult> => {
          // READ COMMITTED is intentional: a second freeze waiting on this
          // phase lock must see the first freeze's commit and return the same
          // immutable row. Configuration row locking below linearizes edits.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`phase-layout:${params.data.phaseId}`}, 0))`);

          const [event] = await tx.select({
            id: events.id,
            venueId: events.venueId,
            venueSlug: venues.slug,
          }).from(events)
            .innerJoin(venues, eq(events.venueId, venues.id))
            .where(and(
            eq(events.id, params.data.eventId),
            isNull(events.deletedAt),
            isNull(venues.deletedAt),
          )).limit(1);
          if (event === undefined) return { state: "not_found", resource: "event" };
          if (!canWriteEvents(request.user, event.venueId)) {
            return { state: "forbidden" };
          }

          const [phase] = await tx.select({
            id: eventPhases.id,
            eventId: eventPhases.eventId,
            spaceId: spaces.id,
            spaceSlug: spaces.slug,
            templateKey: eventPhases.templateKey,
            name: eventPhases.name,
          }).from(eventPhases)
            .innerJoin(spaces, eq(eventPhases.spaceId, spaces.id))
            .where(and(
            eq(eventPhases.id, params.data.phaseId),
            eq(eventPhases.eventId, event.id),
            eq(spaces.venueId, event.venueId),
            isNull(spaces.deletedAt),
          )).limit(1);
          if (phase === undefined) return { state: "not_found", resource: "phase" };

          // A non-locking revision observation lets a queued optimistic edit
          // complete ahead of the authoritative FOR SHARE read. If the lock
          // wait advances the revision, this request gets an explicit retry
          // response rather than freezing an already-stale proof.
          const [observedConfiguration] = await tx.select({
            revision: configurations.revision,
            venueId: configurations.venueId,
          }).from(configurations).where(and(
            eq(configurations.id, body.data.configurationId),
            eq(configurations.venueId, event.venueId),
            isNull(configurations.deletedAt),
          )).limit(1);
          if (observedConfiguration === undefined) {
            return { state: "not_found", resource: "configuration" };
          }
          if (!canWriteEvents(request.user, observedConfiguration.venueId)) {
            return { state: "forbidden" };
          }

          const [configuration] = await tx.select({
            id: configurations.id,
            venueId: configurations.venueId,
            spaceId: configurations.spaceId,
            name: configurations.name,
            layoutStyle: configurations.layoutStyle,
            visibility: configurations.visibility,
            guestCount: configurations.guestCount,
            revision: configurations.revision,
            updatedAt: configurations.updatedAt,
          }).from(configurations).where(and(
            eq(configurations.id, body.data.configurationId),
            eq(configurations.venueId, event.venueId),
            isNull(configurations.deletedAt),
          )).for("share").limit(1);
          if (configuration === undefined) {
            return { state: "not_found", resource: "configuration" };
          }
          if (!canWriteEvents(request.user, configuration.venueId)) {
            return { state: "forbidden" };
          }
          if (configuration.revision !== observedConfiguration.revision) {
            return { state: "configuration_changed" };
          }

          const [canonical] = await tx.select({
            id: canonicalLayoutSnapshots.id,
            configurationId: canonicalLayoutSnapshots.configurationId,
            venueId: canonicalLayoutSnapshots.venueId,
            spaceId: canonicalLayoutSnapshots.spaceId,
            snapshotDigest: canonicalLayoutSnapshots.snapshotDigest,
            payload: canonicalLayoutSnapshots.payload,
          }).from(canonicalLayoutSnapshots).where(
            eq(canonicalLayoutSnapshots.configurationId, configuration.id),
          ).limit(1);

          const [proof] = canonical === undefined ? [] : await tx.select({
            snapshotId: layoutValidationRuns.snapshotId,
            snapshotDigest: layoutValidationRuns.snapshotDigest,
            proofDigest: layoutValidationRuns.proofDigest,
            payload: layoutValidationRuns.payload,
          }).from(layoutValidationRuns).where(
            eq(layoutValidationRuns.snapshotId, canonical.id),
          ).limit(1);

          const persistedObjectRows = await tx.select({
            id: placedObjects.id,
            assetDefinitionId: placedObjects.assetDefinitionId,
            positionX: placedObjects.positionX,
            positionY: placedObjects.positionY,
            positionZ: placedObjects.positionZ,
            rotationX: placedObjects.rotationX,
            rotationY: placedObjects.rotationY,
            rotationZ: placedObjects.rotationZ,
            scale: placedObjects.scale,
            sortOrder: placedObjects.sortOrder,
            metadata: placedObjects.metadata,
            coordinateSpace: placedObjects.coordinateSpace,
            assetCategory: assetDefinitions.category,
            assetWidthM: assetDefinitions.widthM,
            assetDepthM: assetDefinitions.depthM,
            assetHeightM: assetDefinitions.heightM,
            assetSeatCount: assetDefinitions.seatCount,
            assetCollisionType: assetDefinitions.collisionType,
          }).from(placedObjects)
            .innerJoin(assetDefinitions, eq(placedObjects.assetDefinitionId, assetDefinitions.id))
            .where(eq(placedObjects.configurationId, configuration.id));
          const persistedObjects = persistedObjectRows.map((object) => ({
            ...object,
            positionX: Number(object.positionX),
            positionY: Number(object.positionY),
            positionZ: Number(object.positionZ),
            rotationX: Number(object.rotationX),
            rotationY: Number(object.rotationY),
            rotationZ: Number(object.rotationZ),
            scale: Number(object.scale),
            assetWidthM: Number(object.assetWidthM),
            assetDepthM: Number(object.assetDepthM),
            assetHeightM: Number(object.assetHeightM),
          }));

          const verified = verifyFreezablePhaseLayoutSnapshot({
            event,
            phase,
            configuration,
            canonicalSnapshot: canonical ?? null,
            proof: proof ?? null,
            persistedObjects,
          });

          const priorRows = await tx.select({
            id: phaseLayoutSnapshots.id,
            configurationId: phaseLayoutSnapshots.configurationId,
            canonicalSnapshotId: phaseLayoutSnapshots.canonicalSnapshotId,
            proofDigest: phaseLayoutSnapshots.proofDigest,
            supersedesSnapshotId: phaseLayoutSnapshots.supersedesSnapshotId,
            frozenBy: phaseLayoutSnapshots.frozenBy,
            snapshotHash: phaseLayoutSnapshots.snapshotHash,
            payload: phaseLayoutSnapshots.payload,
            coordinateSpace: phaseLayoutSnapshots.coordinateSpace,
            objectCount: phaseLayoutSnapshots.objectCount,
            guestCount: phaseLayoutSnapshots.guestCount,
            createdAt: phaseLayoutSnapshots.createdAt,
            frozenAt: phaseLayoutSnapshots.frozenAt,
            runtimeBindingState: phaseLayoutSnapshots.runtimeBindingState,
            runtimeBindingDigest: phaseLayoutSnapshots.runtimeBindingDigest,
            runtimeBinding: phaseLayoutSnapshots.runtimeBinding,
            runtimePresentationAdmissionId: phaseLayoutSnapshots.runtimePresentationAdmissionId,
            runtimePresentationAdmissionDecision:
              phaseLayoutSnapshots.runtimePresentationAdmissionDecision,
            runtimePresentationAdmissionReviewedAt:
              phaseLayoutSnapshots.runtimePresentationAdmissionReviewedAt,
            runtimePresentationAdmissionDigest:
              phaseLayoutSnapshots.runtimePresentationAdmissionDigest,
          }).from(phaseLayoutSnapshots).where(and(
            eq(phaseLayoutSnapshots.eventPhaseId, phase.id),
            eq(phaseLayoutSnapshots.status, "frozen"),
          )).orderBy(
            desc(sql`coalesce(${phaseLayoutSnapshots.frozenAt}, ${phaseLayoutSnapshots.createdAt})`),
            desc(phaseLayoutSnapshots.id),
          ).limit(2);
          const current = priorRows[0] ?? null;
          const frozenAt = nextPhaseLayoutSnapshotFrozenAt(new Date(), current);
          const runtimeDecision = await resolvePhaseLayoutRuntimeAdmission(tx, {
            venueId: event.venueId,
            venueSlug: event.venueSlug,
            spaceId: phase.spaceId,
            spaceSlug: phase.spaceSlug,
            expectedRuntimePackageId: verified.payload.venueRuntime.runtimePackageId,
            expectedRuntimeManifestDigest:
              verified.payload.venueRuntime.runtimeVenueManifestDigest,
            frozenAt,
          });
          if (
            current !== null
            && current.frozenAt !== null
            && current.frozenBy !== null
            && isCurrentFrozenRow(
              current,
              configuration.id,
              verified.canonicalSnapshotId,
              verified.snapshotHash,
              verified.proofDigest,
              verified.objectCount,
              verified.guestCount,
            )
            && currentRuntimeDecisionMatches(current, runtimeDecision)
          ) {
            return {
              state: "success",
              response: responseFromRow({
                outcome: "already_current",
                eventId: event.id,
                phaseId: phase.id,
                configurationId: configuration.id,
                canonicalSnapshotId: verified.canonicalSnapshotId,
                snapshotHash: verified.snapshotHash,
                proofDigest: verified.proofDigest,
                frozenBy: current.frozenBy,
                snapshotId: current.id,
                objectCount: current.objectCount,
                guestCount: current.guestCount ?? verified.guestCount,
                createdAt: current.createdAt,
                frozenAt: current.frozenAt,
                supersedesSnapshotId: current.supersedesSnapshotId,
              }),
            };
          }

          const snapshotId = phaseLayoutSnapshotAppendId(
            phase.id,
            verified.snapshotHash,
            current?.id ?? null,
          );
          const runtimeBinding = buildPhaseLayoutRuntimeBinding(runtimeDecision, {
            bindingId: snapshotId,
            canonicalSnapshotId: verified.canonicalSnapshotId,
            snapshotHash: verified.snapshotHash,
            venueId: event.venueId,
            venueSlug: event.venueSlug,
            spaceId: phase.spaceId,
            spaceSlug: phase.spaceSlug,
            boundBy: request.user.id,
            boundAt: frozenAt,
          });
          const [inserted] = await tx.insert(phaseLayoutSnapshots).values({
            id: snapshotId,
            eventPhaseId: phase.id,
            layoutVariantId: null,
            configurationId: configuration.id,
            canonicalSnapshotId: verified.canonicalSnapshotId,
            proofDigest: verified.proofDigest,
            supersedesSnapshotId: current?.id ?? null,
            frozenBy: request.user.id,
            snapshotHash: verified.snapshotHash,
            status: "frozen",
            objectCount: verified.objectCount,
            guestCount: verified.guestCount,
            payload: verified.payload,
            coordinateSpace: REAL_METRE_COORDINATE_SPACE,
            createdAt: frozenAt,
            frozenAt,
            ...runtimeBindingColumns(runtimeDecision, runtimeBinding),
          }).returning({
            id: phaseLayoutSnapshots.id,
            createdAt: phaseLayoutSnapshots.createdAt,
            frozenAt: phaseLayoutSnapshots.frozenAt,
          });
          if (inserted === undefined || inserted.frozenAt === null) {
            throw new Error("Phase layout snapshot insertion returned no frozen row.");
          }
          return {
            state: "success",
            response: responseFromRow({
              outcome: "created",
              eventId: event.id,
              phaseId: phase.id,
              configurationId: configuration.id,
              canonicalSnapshotId: verified.canonicalSnapshotId,
              snapshotHash: verified.snapshotHash,
              proofDigest: verified.proofDigest,
              frozenBy: request.user.id,
              snapshotId: inserted.id,
              objectCount: verified.objectCount,
              guestCount: verified.guestCount,
              createdAt: inserted.createdAt,
              frozenAt: inserted.frozenAt,
              supersedesSnapshotId: current?.id ?? null,
            }),
          };
        });
      } catch (error) {
        if (error instanceof PhaseLayoutSnapshotConflictError) {
          return reply.status(409).send({ error: error.message, code: error.code });
        }
        if (postgresErrorCode(error) === "40001") {
          return reply.status(409).send({
            error: "The saved plan changed while its phase snapshot was being frozen. Try again.",
            code: "CONFIGURATION_CHANGED_DURING_FREEZE",
          });
        }
        throw error;
      }

      if (result.state === "not_found") {
        const label = {
          event: "Event",
          phase: "Phase",
          configuration: "Configuration",
        }[result.resource];
        return reply.status(404).send({ error: `${label} not found`, code: "NOT_FOUND" });
      }
      if (result.state === "forbidden") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
      if (result.state === "configuration_changed") {
        return reply.status(409).send({
          error: "The saved plan changed while its phase snapshot was being frozen. Try again.",
          code: "CONFIGURATION_CHANGED_DURING_FREEZE",
        });
      }
      return reply.status(result.response.outcome === "created" ? 201 : 200).send({
        data: result.response,
      });
    },
  );
}
