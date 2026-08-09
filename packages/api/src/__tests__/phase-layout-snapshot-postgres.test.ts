import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  CANONICAL_ASSETS,
  CanonicalLayoutSnapshotV0Schema,
  EventArchitectCandidateSelectionSchema,
  EventPhaseGraphSchema,
  EventPhaseSchema,
  FreezePhaseLayoutSnapshotResponseSchema,
  PersistedEventArchitectRunSchema,
  RUNTIME_QA_CHECK_KEYS,
  RegisterRuntimePackageInputSchema,
  RoomLayoutTimelineResponseSchema,
  RuntimePackageManifestJsonSchema,
  RuntimeQaRecordV0Schema,
  TransformArtifactV0Schema,
  canonicalLayoutSnapshotDigest,
  runLayoutValidator,
  type CanonicalLayoutSnapshotV0,
} from "@omnitwin/types";
import { createDb, type Database } from "../db/client.js";
import {
  assetDefinitions,
  assetVersions,
  canonicalLayoutSnapshots,
  configurations,
  eventPhases,
  events,
  layoutValidationRuns,
  phaseLayoutSnapshots,
  placedObjects,
  reconstructionReviewEvidenceArtifacts,
  revenueScenarios,
  runtimePackages,
  runtimePresentationAdmissionMembers,
  runtimePresentationAdmissions,
  runtimePresentationRightsEvidence,
  runtimeQaRecords,
  runtimeTransformArtifacts,
  spaces,
  users,
  venues,
} from "../db/schema.js";
import { validateEnv } from "../env.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { runtimePackageProfileManifestFingerprint } from "../lib/reception-reviewed-runtime-profile.js";
import { runtimeQaRecordSha256 } from "../lib/runtime-qa-record-receipt.js";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";
import {
  RuntimePresentationAdmissionBodySchema,
  RuntimePresentationRightsEvidenceBodySchema,
  resolvePhaseLayoutRuntimeAdmission,
  runtimePackageManifestDigest,
  runtimePresentationAdmissionDigest,
  runtimePresentationRightsEvidenceDigest,
  runtimePresentationRightsSetDigest,
} from "../services/phase-layout-runtime-admission.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

const RUN_ENABLED = process.env["RUN_PHASE_LAYOUT_POSTGRES"] === "1";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const SAFE_DATABASE_PREFIX = "omnitwin_timeline_0060_";

function isSafeDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.slice(1);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && (parsed.port === "54329" || parsed.port === "54339")
      && databaseName.startsWith(SAFE_DATABASE_PREFIX)
      && /^[a-z0-9_]+$/u.test(databaseName);
  } catch {
    return false;
  }
}

if (RUN_ENABLED && !isSafeDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error(
    "RUN_PHASE_LAYOUT_POSTGRES requires a disposable local PostgreSQL database URL.",
  );
}

const SNAPSHOT = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
const SNAPSHOT_DIGEST = canonicalLayoutSnapshotDigest(SNAPSHOT);
const PROOF = runLayoutValidator(SNAPSHOT, {
  policyBundleId: SNAPSHOT.policyBundle.policyBundleId,
  policyBundleDigest: SNAPSHOT.policyBundle.policyBundleDigest,
  policyBundleVersion: SNAPSHOT.policyBundle.policyBundleVersion,
  minPrimaryFurnitureClearanceM: 1,
  clearanceWarningMarginM: 0.2,
  pricing: null,
});

const EVENT_ID = "99999999-9999-4999-8999-999999999999";
const PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OVERNIGHT_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const CANONICAL_SNAPSHOT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VALIDATION_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT_ARCHITECT_CANDIDATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_START = new Date("2026-06-07T19:30:00.000Z");
const MALFORMED_FROZEN_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MUTABLE_SNAPSHOT_ID = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const MISSING_LINEAGE_SNAPSHOT_ID = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const PROOF_MISMATCH_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const CANONICAL_MISMATCH_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad";
const OTHER_CONFIGURATION_ID = "44444444-4444-4444-8444-444444444445";
const MATCHING_REVENUE_SCENARIO_ID = "12121212-1212-4212-8212-121212121212";
const OTHER_VENUE_ID = "11111111-1111-4111-8111-111111111112";
const CROSS_VENUE_SPACE_ID = "33333333-3333-4333-8333-333333333334";
const CROSS_TENANT_EVENT_ID = "99999999-9999-4999-8999-999999999998";
const CROSS_TENANT_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const CROSS_TENANT_CONFIGURATION_ID = "44444444-4444-4444-8444-444444444446";
const SIBLING_SPACE_ID = "33333333-3333-4333-8333-333333333337";
const SIBLING_SPACE_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const SIBLING_SPACE_SNAPSHOT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea";
const FOREIGN_VENUE_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const FOREIGN_VENUE_SNAPSHOT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeeb";
const SIBLING_SPACE_PHASE_NAME = "Sibling room confidential phase";
const FOREIGN_VENUE_PHASE_NAME = "Foreign venue confidential phase";
const SIBLING_SPACE_GUEST_COUNT = 9_123;
const FOREIGN_VENUE_GUEST_COUNT = 9_876;
const MISSING_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const MISSING_CONFIGURATION_ID = "44444444-4444-4444-8444-444444444449";
const DELETED_SPACE_ID = "33333333-3333-4333-8333-333333333335";
const MISSING_SPACE_ID = "33333333-3333-4333-8333-333333333336";
const INCOMPLETE_CAPACITY_CONFIGURATION_ID = "44444444-4444-4444-8444-444444444447";
const INCOMPLETE_CAPACITY_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae";
const INCOMPLETE_CAPACITY_CANONICAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const INCOMPLETE_CAPACITY_SNAPSHOT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeec";
const PRECEDENCE_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf";
const PRECEDENCE_T1_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeed1";
const PRECEDENCE_T2_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeed2";
const PRECEDENCE_T3_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeed3";
const PRECEDENCE_MUTABLE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeed4";
const RESTRICT_ACTOR_ID = "44444444-4444-4444-8444-444444444448";
const RESTRICT_SNAPSHOT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeed5";
const SYNTHETIC_RUNTIME_PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const SYNTHETIC_RUNTIME_CONFIGURATION_ID = "44444444-4444-4444-8444-444444444443";
const SYNTHETIC_RUNTIME_CANONICAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const SYNTHETIC_RUNTIME_VALIDATION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const SYNTHETIC_RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_ASSET_ID = "20000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_TRANSFORM_ROW_ID = "30000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_QA_ROW_ID = "40000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_SCENE_ROW_ID = "50000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_RIGHTS_ROW_ID = "60000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_ADMISSION_ID = "70000000-0000-4000-8000-000000000004";
const SYNTHETIC_RUNTIME_BYTES = Buffer.from("synthetic-reviewed-runtime-member-v1", "utf8");

const FreezeEnvelopeSchema = z.object({
  data: FreezePhaseLayoutSnapshotResponseSchema,
}).strict();
const TimelineEnvelopeSchema = z.object({
  data: RoomLayoutTimelineResponseSchema,
}).strict();
const ArchitectRunEnvelopeSchema = z.object({
  data: PersistedEventArchitectRunSchema,
}).strict();
const ArchitectSelectionEnvelopeSchema = z.object({
  data: EventArchitectCandidateSelectionSchema,
}).strict();
const EventGraphEnvelopeSchema = z.object({ data: EventPhaseGraphSchema }).strict();
const EventPhaseEnvelopeSchema = z.object({ data: EventPhaseSchema }).strict();

let server: FastifyInstance | null = null;
let database: Database | null = null;
let buildServerForReload: (() => Promise<FastifyInstance>) | null = null;
let applicationArtifact: {
  readonly eventId: string;
  readonly phaseId: string;
  readonly configurationId: string;
  readonly canonicalSnapshotId: string;
  readonly proofDigest: string;
  readonly snapshotHash: string;
  readonly payload: CanonicalLayoutSnapshotV0;
} | null = null;

function requiredServer(): FastifyInstance {
  if (server === null) throw new Error("Integration server is not available.");
  return server;
}

function requiredDatabase(): Database {
  if (database === null) throw new Error("Integration database is not available.");
  return database;
}

function requiredServerBuilder(): () => Promise<FastifyInstance> {
  if (buildServerForReload === null) throw new Error("Integration server builder is unavailable.");
  return buildServerForReload;
}

function fixed(value: number, precision: number): string {
  const factor = 10 ** precision;
  return (Math.round(value * factor) / factor).toFixed(precision);
}

function authHeaders(input: {
  readonly id?: string;
  readonly role?: string;
  readonly venueId?: string | null;
  readonly platformRole?: "none" | "admin";
} = {}): { readonly authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: input.id ?? ACTOR_ID,
      email: "timeline-rehearsal@integration.test",
      name: "Timeline Rehearsal",
      role: input.role ?? "staff",
      platformRole: input.platformRole ?? "none",
      venueId: input.venueId === undefined ? SNAPSHOT.venueId : input.venueId,
    })}`,
  };
}

function errorProperty(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  return (error as Readonly<Record<string, unknown>>)[key];
}

async function expectForeignKeyViolation(
  operation: () => Promise<unknown>,
  constraint: string,
): Promise<void> {
  try {
    await operation();
    throw new Error(`Expected PostgreSQL constraint ${constraint} to reject the operation.`);
  } catch (error: unknown) {
    const cause = errorProperty(error, "cause");
    expect(errorProperty(cause, "code")).toBe("23503");
    expect(errorProperty(cause, "constraint")).toBe(constraint);
  }
}

async function expectDatabaseViolation(
  operation: () => Promise<unknown>,
  code: string,
  constraint: string,
): Promise<void> {
  try {
    await operation();
    throw new Error(`Expected PostgreSQL constraint ${constraint} to reject the operation.`);
  } catch (error: unknown) {
    const cause = errorProperty(error, "cause");
    expect(errorProperty(cause, "code") ?? errorProperty(error, "code")).toBe(code);
    expect(errorProperty(cause, "constraint") ?? errorProperty(error, "constraint"))
      .toBe(constraint);
  }
}

async function waitForConfigurationLockWaiters(
  observer: Client,
  lockerPid: number,
  stage: "edit" | "edit_and_freeze",
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastActivity: readonly Readonly<Record<string, unknown>>[] = [];
  while (Date.now() < deadline) {
    const result = await observer.query<{
      readonly pid: number;
      readonly state: string;
      readonly waitEventType: string | null;
      readonly waitEvent: string | null;
      readonly query: string;
      readonly blockers: number[];
    }>(`
      SELECT
        pid,
        state,
        wait_event_type AS "waitEventType",
        wait_event AS "waitEvent",
        query,
        pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
      ORDER BY pid
    `);
    lastActivity = result.rows;
    const editWaiter = result.rows.find((row) => (
      row.waitEventType === "Lock"
      && row.blockers.includes(lockerPid)
      && /update\s+"?configurations"?/iu.test(row.query)
      && row.query.toLowerCase().includes("revision")
    ));
    const freezeWaiting = result.rows.some((row) => (
      row.waitEventType === "Lock"
      && editWaiter !== undefined
      && row.blockers.includes(editWaiter.pid)
      && /from\s+"?configurations"?/iu.test(row.query)
      && row.query.toLowerCase().includes("for share")
    ));
    if (editWaiter !== undefined && (stage === "edit" || freezeWaiting)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for ${stage} configuration lock queries: ${JSON.stringify(lastActivity)}`,
  );
}

async function seedFixture(db: Database): Promise<void> {
  await db.insert(venues).values({
    id: SNAPSHOT.venueId,
    name: "Trades Hall Glasgow",
    slug: SNAPSHOT.venueRuntime.venueSlug,
    address: "85 Glassford Street, Glasgow",
    timezone: "Europe/London",
  });
  await db.insert(venues).values({
    id: OTHER_VENUE_ID,
    name: "Decoy Venue",
    slug: "timeline-decoy-venue",
    address: "Outside the event tenant",
    timezone: "Europe/London",
  });
  await db.insert(spaces).values({
    id: SNAPSHOT.spaceId,
    venueId: SNAPSHOT.venueId,
    name: SNAPSHOT.venueRuntime.spaceName,
    slug: SNAPSHOT.venueRuntime.spaceSlug,
    widthM: fixed(SNAPSHOT.venueRuntime.spaceDimensions.width, 2),
    lengthM: fixed(SNAPSHOT.venueRuntime.spaceDimensions.length, 2),
    heightM: fixed(SNAPSHOT.venueRuntime.spaceDimensions.height, 2),
    floorPlanOutline: SNAPSHOT.venueRuntime.floorPlanOutline,
  });
  await db.insert(spaces).values([
    {
      id: CROSS_VENUE_SPACE_ID,
      venueId: OTHER_VENUE_ID,
      name: "Cross-venue room",
      slug: "cross-venue-room",
      widthM: "10.00",
      lengthM: "10.00",
      heightM: "3.00",
      floorPlanOutline: SNAPSHOT.venueRuntime.floorPlanOutline,
    },
    {
      id: DELETED_SPACE_ID,
      venueId: SNAPSHOT.venueId,
      name: "Deleted room",
      slug: "deleted-room",
      widthM: "10.00",
      lengthM: "10.00",
      heightM: "3.00",
      floorPlanOutline: SNAPSHOT.venueRuntime.floorPlanOutline,
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ]);
  await db.insert(users).values({
    id: ACTOR_ID,
    email: "timeline-rehearsal@integration.test",
    name: "Timeline Rehearsal",
    role: "staff",
    platformRole: "none",
    venueId: SNAPSHOT.venueId,
  });
  await db.insert(configurations).values({
    id: SNAPSHOT.configurationId,
    spaceId: SNAPSHOT.spaceId,
    venueId: SNAPSHOT.venueId,
    userId: ACTOR_ID,
    name: SNAPSHOT.layoutName,
    layoutStyle: SNAPSHOT.layoutStyle,
    guestCount: SNAPSHOT.guestCount,
    visibility: SNAPSHOT.visibility,
    slug: "timeline-rehearsal",
    createdAt: new Date(SNAPSHOT.createdFromConfigurationUpdatedAt),
    updatedAt: new Date(SNAPSHOT.createdFromConfigurationUpdatedAt),
  });
  await db.insert(configurations).values({
    id: CROSS_TENANT_CONFIGURATION_ID,
    spaceId: CROSS_VENUE_SPACE_ID,
    venueId: OTHER_VENUE_ID,
    userId: ACTOR_ID,
    name: "Foreign tenant secret layout",
    layoutStyle: SNAPSHOT.layoutStyle,
    guestCount: SNAPSHOT.guestCount,
    visibility: "private",
    slug: "foreign-tenant-secret-layout",
  });
  await db.insert(assetDefinitions).values(SNAPSHOT.objects.map((object, index) => ({
    id: object.assetDefinition.assetDefinitionId,
    name: index === 0 ? "Timeline round table" : "Timeline dining chair",
    category: object.assetDefinition.category,
    widthM: fixed(object.assetDefinition.widthM, 3),
    depthM: fixed(object.assetDefinition.depthM, 3),
    heightM: fixed(object.assetDefinition.heightM, 3),
    seatCount: object.assetDefinition.seatCount,
    collisionType: object.assetDefinition.collisionType,
  })));
  await db.insert(assetDefinitions).values(CANONICAL_ASSETS.map((asset) => ({
    id: asset.id,
    name: asset.name,
    category: asset.category,
    widthM: fixed(asset.widthM, 3),
    depthM: fixed(asset.depthM, 3),
    heightM: fixed(asset.heightM, 3),
    seatCount: asset.seatCount,
    collisionType: asset.collisionType,
  })));
  await db.insert(placedObjects).values(SNAPSHOT.objects.map((object) => ({
    id: object.objectId,
    configurationId: SNAPSHOT.configurationId,
    assetDefinitionId: object.assetDefinition.assetDefinitionId,
    positionX: fixed(object.position.x, 3),
    positionY: fixed(object.position.y, 3),
    positionZ: fixed(object.position.z, 3),
    rotationX: fixed(object.rotation.x, 5),
    rotationY: fixed(object.rotation.y, 5),
    rotationZ: fixed(object.rotation.z, 5),
    scale: fixed(object.scale, 3),
    sortOrder: object.sortOrder,
    metadata: {
      ...(object.metadata ?? {}),
      groupId: object.groupId,
      eventArchitectCandidateId: EVENT_ARCHITECT_CANDIDATE_ID,
    },
    coordinateSpace: "real_m_v1" as const,
    coordinateWriteToken: randomUUID(),
  })));
  await db.insert(events).values({
    id: EVENT_ID,
    venueId: SNAPSHOT.venueId,
    createdBy: ACTOR_ID,
    name: "Elaine & James",
    eventType: "dinner",
    status: "confirmed",
    startsAt: new Date("2026-06-07T17:00:00.000Z"),
    endsAt: new Date("2026-06-08T00:30:00.000Z"),
    guestCount: SNAPSHOT.guestCount,
    clientName: "Elaine & James",
  });
  await db.insert(events).values({
    id: CROSS_TENANT_EVENT_ID,
    venueId: OTHER_VENUE_ID,
    createdBy: ACTOR_ID,
    name: "Foreign tenant secret event",
    eventType: "dinner",
    status: "confirmed",
    startsAt: new Date("2026-06-07T17:00:00.000Z"),
    endsAt: new Date("2026-06-08T00:30:00.000Z"),
    guestCount: SNAPSHOT.guestCount,
    clientName: "Foreign tenant secret client",
  });
  await db.insert(eventPhases).values({
    id: PHASE_ID,
    eventId: EVENT_ID,
    spaceId: SNAPSHOT.spaceId,
    templateKey: "dinner",
    name: "Dinner service",
    sortOrder: 2,
    startsAt: PHASE_START,
    durationMinutes: 105,
    guestCount: SNAPSHOT.guestCount,
  });
  await db.insert(eventPhases).values({
    id: OVERNIGHT_PHASE_ID,
    eventId: EVENT_ID,
    spaceId: SNAPSHOT.spaceId,
    templateKey: "dancing",
    name: "Late evening party",
    sortOrder: 3,
    startsAt: new Date("2026-06-08T22:30:00.000Z"),
    durationMinutes: 180,
    guestCount: SNAPSHOT.guestCount,
  });
  await db.insert(eventPhases).values({
    id: CROSS_TENANT_PHASE_ID,
    eventId: CROSS_TENANT_EVENT_ID,
    spaceId: CROSS_VENUE_SPACE_ID,
    templateKey: "dinner",
    name: "Foreign tenant secret phase",
    sortOrder: 1,
    startsAt: PHASE_START,
    durationMinutes: 105,
    guestCount: SNAPSHOT.guestCount,
  });
  await db.insert(canonicalLayoutSnapshots).values({
    id: CANONICAL_SNAPSHOT_ID,
    configurationId: SNAPSHOT.configurationId,
    venueId: SNAPSHOT.venueId,
    spaceId: SNAPSHOT.spaceId,
    schemaVersion: SNAPSHOT.schemaVersion,
    snapshotDigest: SNAPSHOT_DIGEST,
    payload: SNAPSHOT,
    createdBy: ACTOR_ID,
    createdAt: new Date(SNAPSHOT.snapshotCreatedAt),
  });
  await db.insert(layoutValidationRuns).values({
    id: VALIDATION_RUN_ID,
    snapshotId: CANONICAL_SNAPSHOT_ID,
    snapshotDigest: SNAPSHOT_DIGEST,
    validatorVersion: PROOF.validatorVersion,
    validatorDigest: PROOF.validatorDigest,
    contextDigest: PROOF.contextDigest,
    proofDigest: PROOF.proofDigest,
    payload: PROOF,
    createdAt: new Date(SNAPSHOT.snapshotCreatedAt),
  });
}

/**
 * Synthetic contract evidence only. These rows exercise the exact normalized
 * admission graph; they are not evidence that Trades Hall has granted real
 * presentation rights or issued a real Scene Authority decision.
 */
async function seedSyntheticHistoricalRuntimeContract(db: Database): Promise<{
  readonly payload: CanonicalLayoutSnapshotV0;
  readonly packageContentDigest: string;
  readonly manifestDigest: string;
  readonly assetSha256: string;
  readonly r2Key: string;
  readonly rightsEvidenceDigest: string;
  readonly rightsBody: z.infer<typeof RuntimePresentationRightsEvidenceBodySchema>;
  readonly admissionDigest: string;
  readonly admissionBody: z.infer<typeof RuntimePresentationAdmissionBodySchema>;
}> {
  const evidenceCreatedAt = new Date("2026-07-01T08:00:00.000Z");
  const rightsReviewedAt = new Date("2026-07-01T08:15:00.000Z");
  const qaReviewedAt = new Date("2026-07-01T08:20:00.000Z");
  const admissionReviewedAt = new Date("2026-07-01T08:30:00.000Z");
  const configurationUpdatedAt = new Date("2026-07-01T09:00:00.000Z");
  const snapshotCreatedAt = new Date("2026-07-01T09:05:00.000Z");
  const fileName = "synthetic-grand-hall.sog";
  const r2Key = "r2:/historical-runtime/synthetic-grand-hall.sog";
  const assetSha256 = createHash("sha256").update(SYNTHETIC_RUNTIME_BYTES).digest("hex");
  const storageKeySha256 = runtimeAssetStorageKeySha256(r2Key);

  await db.insert(assetVersions).values({
    id: SYNTHETIC_RUNTIME_ASSET_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    assetKind: "splat",
    sourceType: "xgrids",
    fileName,
    fileExt: ".sog",
    r2Key,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: assetSha256,
    sizeBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
    evidenceStatus: "human_reviewed",
    runtimeStatus: "usable",
    notes: "Synthetic historical-runtime contract bytes; not production evidence.",
    createdAt: evidenceCreatedAt,
    updatedAt: evidenceCreatedAt,
  });

  const manifest = RuntimePackageManifestJsonSchema.parse({
    schemaVersion: "venviewer.runtime-package.v1",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    packageType: "room-runtime",
    assets: {
      primaryVisualAssetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
      visualAssetVersionIds: [SYNTHETIC_RUNTIME_ASSET_ID],
      visualAssetReceipts: [{
        assetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
        fileName,
        fileExt: ".sog",
        sha256: assetSha256,
        sizeBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
        storageKeySha256,
      }],
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
    },
    notes: "Synthetic normalized-admission contract fixture.",
  });
  const packageInput = RegisterRuntimePackageInputSchema.parse({
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    primaryVisualAssetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: manifest,
    evidenceStatus: "human_reviewed",
    runtimeStatus: "internal_ready",
  });
  const packageContentDigest = computeRuntimePackageRevisionDigest(packageInput);
  const manifestDigest = runtimePackageManifestDigest(manifest);
  const profileFingerprint = runtimePackageProfileManifestFingerprint(manifest);
  if (profileFingerprint === null) throw new Error("Synthetic profile fingerprint was not derivable.");
  await db.insert(runtimePackages).values({
    id: SYNTHETIC_RUNTIME_PACKAGE_ID,
    ...packageInput,
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: packageContentDigest,
    createdAt: evidenceCreatedAt,
    updatedAt: evidenceCreatedAt,
  });

  const transform = TransformArtifactV0Schema.parse({
    id: "synthetic-grand-hall-rrf-arf-v1",
    sourceFrame: "RRF",
    targetFrame: "ARF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "manual_alignment",
    residualRmseM: null,
    landmarks: [],
    provenance: {
      state: "measured",
      refs: [{
        refType: "control_network",
        ref: "synthetic-contract-control-network-v1",
        role: "alignment",
      }],
    },
    creator: { actorType: "pipeline", id: "synthetic-contract", role: "registration" },
    reviewer: { actorType: "human", id: "synthetic-reviewer", role: "spatial-reviewer" },
    date: "2026-07-01T08:10:00.000Z",
  });
  const transformDigest = runtimeTransformArtifactSha256(transform);
  await db.insert(runtimeTransformArtifacts).values({
    id: SYNTHETIC_RUNTIME_TRANSFORM_ROW_ID,
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    transformArtifactId: transform.id,
    transformArtifact: transform,
    artifactDigest: transformDigest,
    reviewNote: "Synthetic direct RRF↔ARF transform contract.",
    registeredBy: ACTOR_ID,
    createdAt: evidenceCreatedAt,
    updatedAt: evidenceCreatedAt,
  });

  const evidenceRef = {
    label: "Synthetic historical runtime contract",
    ref: "packages/api/src/__tests__/phase-layout-snapshot-postgres.test.ts",
  };
  const qaRecord = RuntimeQaRecordV0Schema.parse({
    schemaVersion: "runtime-qa-record.v0",
    recordId: "synthetic-grand-hall-runtime-qa-v1",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    recordedAt: qaReviewedAt.toISOString(),
    recordedBy: "synthetic-contract-reviewer",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "internal_ready",
    sourceBundle: {
      sourceLabel: "Synthetic contract bundle",
      sourceBundleHash: "1".repeat(64),
      totalSourceFiles: 1,
      totalSourceBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
      totalSplats: 1,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/command-centre",
      loadStatus: "loaded",
      visualChunkCount: 1,
      excludedChunkCount: 0,
      loadedSplats: 1,
      evidenceRefs: [evidenceRef],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      signedTransformArtifactId: transform.id,
      signedTransformArtifactSha256: transformDigest,
      note: "Synthetic exact transform binding.",
    },
    cameraProfile: {
      position: [0, 2, 8],
      target: [0, 1, 0],
      arrivalPosition: null,
      arrivalTarget: null,
      arrivalDurationMs: 0,
      fov: 48,
      targetBounds: null,
      cameraBounds: null,
      note: "Synthetic viewer profile.",
    },
    checks: RUNTIME_QA_CHECK_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed",
      summary: `Synthetic contract passed ${checkKey}.`,
      evidenceRefs: [evidenceRef],
    })),
    limitations: ["Synthetic contract fixture; no real presentation authority."],
    publicExposure: {
      decision: "approved_internal_preview",
      reason: "Synthetic authenticated test only.",
      requiredBeforeApproval: ["Obtain real Trades Hall rights and Scene Authority evidence."],
    },
  });
  const qaDigest = runtimeQaRecordSha256(qaRecord);
  await db.insert(runtimeQaRecords).values({
    id: SYNTHETIC_RUNTIME_QA_ROW_ID,
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    recordId: qaRecord.recordId,
    recordJson: qaRecord,
    recordDigest: qaDigest,
    signedTransformArtifactId: transform.id,
    publicExposureDecision: "approved_internal_preview",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "internal_ready",
    reviewedBy: ACTOR_ID,
    reviewedAt: qaReviewedAt,
    createdAt: evidenceCreatedAt,
    updatedAt: evidenceCreatedAt,
  });

  const sceneAuthorityMapDigest = "2".repeat(64);
  await db.insert(reconstructionReviewEvidenceArtifacts).values({
    id: SYNTHETIC_RUNTIME_SCENE_ROW_ID,
    venueSlug: "trades-hall",
    artifactKind: "scene_authority_map_v0",
    artifactId: "synthetic-grand-hall-scene-authority-v1",
    artifactDigest: sceneAuthorityMapDigest,
    objectKey: "private/synthetic-grand-hall-scene-authority-v1.json",
    objectSha256: sceneAuthorityMapDigest,
    sizeBytes: 128,
    schemaVersion: "scene-authority-map.v0",
    idempotencyKey: "synthetic-grand-hall-scene-authority-v1",
    requestDigest: "4".repeat(64),
    registeredBy: ACTOR_ID,
    registeredAt: new Date("2026-07-01T08:12:00.000Z"),
  });

  const rightsBody = {
    schemaVersion: "runtime-presentation-rights-evidence.v1" as const,
    evidenceId: SYNTHETIC_RUNTIME_RIGHTS_ROW_ID,
    assetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall",
    assetSha256,
    assetSizeBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
    decision: "approved" as const,
    rightsBasis: "synthetic_contract_only",
    termsReference: "integration-test://synthetic-not-production-authority",
    reviewedBy: ACTOR_ID,
    reviewedAt: rightsReviewedAt.toISOString(),
  };
  const rightsEvidenceDigest = runtimePresentationRightsEvidenceDigest(rightsBody);
  await db.insert(runtimePresentationRightsEvidence).values({
    id: SYNTHETIC_RUNTIME_RIGHTS_ROW_ID,
    assetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    assetSha256,
    assetSizeBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
    evidenceDigest: rightsEvidenceDigest,
    evidenceBody: rightsBody,
    decision: "approved",
    reviewedBy: ACTOR_ID,
    reviewedAt: rightsReviewedAt,
    createdAt: evidenceCreatedAt,
  });
  const rightsSetDigest = runtimePresentationRightsSetDigest([{
    memberIndex: 0,
    assetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
    rightsEvidenceDigest,
    rightsDecision: "approved",
    rightsReviewedBy: ACTOR_ID,
    rightsReviewedAt,
  }]);
  const admissionBody = {
    schemaVersion: "runtime-presentation-admission.v1" as const,
    admissionId: SYNTHETIC_RUNTIME_ADMISSION_ID,
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    runtimePackageContentDigest: packageContentDigest,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall",
    runtimeManifestDigest: manifestDigest,
    reviewedProfileId: "synthetic-grand-hall-v1",
    reviewedProfileManifestFingerprint: profileFingerprint,
    runtimeQaRecordId: SYNTHETIC_RUNTIME_QA_ROW_ID,
    runtimeQaRecordKey: qaRecord.recordId,
    runtimeQaRecordDigest: qaDigest,
    runtimeQaDecision: "approved_internal_preview" as const,
    runtimeQaReviewedBy: ACTOR_ID,
    runtimeQaReviewedAt: qaReviewedAt.toISOString(),
    runtimeTransformArtifactRowId: SYNTHETIC_RUNTIME_TRANSFORM_ROW_ID,
    runtimeTransformArtifactId: transform.id,
    runtimeTransformArtifactDigest: transformDigest,
    sceneAuthorityArtifactRowId: SYNTHETIC_RUNTIME_SCENE_ROW_ID,
    sceneAuthorityArtifactKind: "scene_authority_map_v0" as const,
    sceneAuthorityArtifactId: "synthetic-grand-hall-scene-authority-v1",
    sceneAuthorityMapDigest,
    rightsEvidenceDigest: rightsSetDigest,
    memberCount: 1,
    decision: "approved" as const,
    reviewedBy: ACTOR_ID,
    reviewedAt: admissionReviewedAt.toISOString(),
  };
  const admissionDigest = runtimePresentationAdmissionDigest(admissionBody);
  await db.insert(runtimePresentationAdmissions).values({
    id: SYNTHETIC_RUNTIME_ADMISSION_ID,
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    runtimePackageContentDigest: packageContentDigest,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    runtimeManifestDigest: manifestDigest,
    reviewedProfileId: admissionBody.reviewedProfileId,
    reviewedProfileManifestFingerprint: profileFingerprint,
    runtimeQaRecordId: SYNTHETIC_RUNTIME_QA_ROW_ID,
    runtimeQaRecordKey: qaRecord.recordId,
    runtimeQaRecordDigest: qaDigest,
    runtimeQaDecision: "approved_internal_preview",
    runtimeQaReviewedBy: ACTOR_ID,
    runtimeQaReviewedAt: qaReviewedAt,
    runtimeTransformArtifactRowId: SYNTHETIC_RUNTIME_TRANSFORM_ROW_ID,
    runtimeTransformArtifactId: transform.id,
    runtimeTransformArtifactDigest: transformDigest,
    sceneAuthorityArtifactRowId: SYNTHETIC_RUNTIME_SCENE_ROW_ID,
    sceneAuthorityArtifactKind: "scene_authority_map_v0",
    sceneAuthorityArtifactId: admissionBody.sceneAuthorityArtifactId,
    sceneAuthorityMapDigest,
    rightsEvidenceDigest: rightsSetDigest,
    memberCount: 1,
    decision: "approved",
    admissionDigest,
    admissionBody,
    reviewedBy: ACTOR_ID,
    reviewedAt: admissionReviewedAt,
    createdAt: evidenceCreatedAt,
  });
  await db.insert(runtimePresentationAdmissionMembers).values({
    admissionId: SYNTHETIC_RUNTIME_ADMISSION_ID,
    runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    runtimePackageContentDigest: packageContentDigest,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    memberIndex: 0,
    assetVersionId: SYNTHETIC_RUNTIME_ASSET_ID,
    fileName,
    fileExt: ".sog",
    mimeType: "application/octet-stream",
    sha256: assetSha256,
    sizeBytes: SYNTHETIC_RUNTIME_BYTES.byteLength,
    storageKeySha256,
    rightsEvidenceRowId: SYNTHETIC_RUNTIME_RIGHTS_ROW_ID,
    rightsEvidenceDigest,
    rightsDecision: "approved",
    rightsReviewedBy: ACTOR_ID,
    rightsReviewedAt,
  });

  const objectIds = [
    "55555555-5555-4555-8555-555555555554",
    "77777777-7777-4777-8777-777777777774",
  ] as const;
  const payload = CanonicalLayoutSnapshotV0Schema.parse({
    ...SNAPSHOT,
    configurationId: SYNTHETIC_RUNTIME_CONFIGURATION_ID,
    layoutName: "Synthetic historical runtime contract layout",
    createdFromConfigurationUpdatedAt: configurationUpdatedAt.toISOString(),
    snapshotCreatedAt: snapshotCreatedAt.toISOString(),
    venueRuntime: {
      ...SNAPSHOT.venueRuntime,
      runtimeVenueManifestDigest: manifestDigest,
      runtimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
    },
    objects: SNAPSHOT.objects.map((object, index) => ({
      ...object,
      objectId: objectIds[index],
    })),
  });
  await db.insert(configurations).values({
    id: SYNTHETIC_RUNTIME_CONFIGURATION_ID,
    spaceId: SNAPSHOT.spaceId,
    venueId: SNAPSHOT.venueId,
    userId: ACTOR_ID,
    name: payload.layoutName,
    layoutStyle: payload.layoutStyle,
    guestCount: payload.guestCount,
    visibility: payload.visibility,
    slug: "synthetic-historical-runtime-contract",
    createdAt: configurationUpdatedAt,
    updatedAt: configurationUpdatedAt,
  });
  await db.insert(placedObjects).values(payload.objects.map((object) => ({
    id: object.objectId,
    configurationId: SYNTHETIC_RUNTIME_CONFIGURATION_ID,
    assetDefinitionId: object.assetDefinition.assetDefinitionId,
    positionX: fixed(object.position.x, 3),
    positionY: fixed(object.position.y, 3),
    positionZ: fixed(object.position.z, 3),
    rotationX: fixed(object.rotation.x, 5),
    rotationY: fixed(object.rotation.y, 5),
    rotationZ: fixed(object.rotation.z, 5),
    scale: fixed(object.scale, 3),
    sortOrder: object.sortOrder,
    metadata: { ...(object.metadata ?? {}), groupId: object.groupId },
    coordinateSpace: "real_m_v1" as const,
    coordinateWriteToken: randomUUID(),
  })));
  await db.insert(eventPhases).values({
    id: SYNTHETIC_RUNTIME_PHASE_ID,
    eventId: EVENT_ID,
    spaceId: SNAPSHOT.spaceId,
    templateKey: "speeches",
    name: "Synthetic reviewed runtime phase",
    sortOrder: 4,
    startsAt: new Date("2026-06-10T21:30:00.000Z"),
    durationMinutes: 45,
    guestCount: payload.guestCount,
  });
  const snapshotDigest = canonicalLayoutSnapshotDigest(payload);
  const proof = runLayoutValidator(payload, {
    policyBundleId: payload.policyBundle.policyBundleId,
    policyBundleDigest: payload.policyBundle.policyBundleDigest,
    policyBundleVersion: payload.policyBundle.policyBundleVersion,
    minPrimaryFurnitureClearanceM: 1,
    clearanceWarningMarginM: 0.2,
    pricing: null,
  });
  await db.insert(canonicalLayoutSnapshots).values({
    id: SYNTHETIC_RUNTIME_CANONICAL_ID,
    configurationId: SYNTHETIC_RUNTIME_CONFIGURATION_ID,
    venueId: SNAPSHOT.venueId,
    spaceId: SNAPSHOT.spaceId,
    schemaVersion: payload.schemaVersion,
    snapshotDigest,
    payload,
    createdBy: ACTOR_ID,
    createdAt: snapshotCreatedAt,
  });
  await db.insert(layoutValidationRuns).values({
    id: SYNTHETIC_RUNTIME_VALIDATION_ID,
    snapshotId: SYNTHETIC_RUNTIME_CANONICAL_ID,
    snapshotDigest,
    validatorVersion: proof.validatorVersion,
    validatorDigest: proof.validatorDigest,
    contextDigest: proof.contextDigest,
    proofDigest: proof.proofDigest,
    payload: proof,
    createdAt: snapshotCreatedAt,
  });
  return {
    payload,
    packageContentDigest,
    manifestDigest,
    assetSha256,
    r2Key,
    rightsEvidenceDigest,
    rightsBody,
    admissionDigest,
    admissionBody,
  };
}

describe.runIf(RUN_ENABLED)("phase layout PostgreSQL rehearsal", () => {
  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    database = createDb(DATABASE_URL);
    await seedFixture(database);
    const { buildServer } = await import("../index.js");
    buildServerForReload = buildServer;
    server = await buildServer();
  }, 60_000);

  afterAll(async () => {
    if (server !== null) await server.close();
  });

  it("applies the exact 0059 → 0060 lineage step and the 0062 immutability trigger", async () => {
    const db = requiredDatabase();
    const ledger = await db.execute(sql<{ readonly hash: string; readonly createdAt: string }>`
      SELECT hash, created_at::text AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id
    `);
    const migration0060Entries = ledger.rows.filter(
      (entry) => entry.createdAt === "1784383200000",
    );
    expect(migration0060Entries).toHaveLength(1);
    expect(ledger.rows.map((entry) => entry.createdAt).slice(-4)).toEqual([
      "1784383200000",
      "1784469600000",
      "1785672000000",
      "1785758400000",
    ]);

    const migrationBytes = await readFile(new URL(
      "../../drizzle/0060_phase_layout_snapshot_lineage.sql",
      import.meta.url,
    ));
    const migrationHash = createHash("sha256").update(migrationBytes).digest("hex");
    expect(migration0060Entries[0]?.hash).toBe(migrationHash);

    const catalog = await db.execute(sql<{
      readonly lineageColumns: number;
      readonly restrictiveForeignKeys: number;
      readonly checks: number;
      readonly indexes: number;
      readonly immutableTriggers: number;
      readonly eventArchitectRevisionSource: boolean;
    }>`
      SELECT
        (
          SELECT count(*)::int
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'phase_layout_snapshots'
            AND column_name IN (
              'canonical_snapshot_id', 'proof_digest', 'supersedes_snapshot_id', 'frozen_by'
            )
        ) AS "lineageColumns",
        (
          SELECT count(*)::int
          FROM pg_constraint
          WHERE conname IN (
            'phase_layout_snapshots_canonical_snapshot_fk',
            'phase_layout_snapshots_proof_digest_fk',
            'phase_layout_snapshots_supersedes_fk',
            'phase_layout_snapshots_frozen_by_fk'
          )
            AND contype = 'f'
            AND confdeltype = 'r'
        ) AS "restrictiveForeignKeys",
        (
          SELECT count(*)::int
          FROM pg_constraint
          WHERE conname IN (
            'phase_layout_snapshots_proof_digest_shape',
            'phase_layout_snapshots_no_self_supersession'
          )
            AND contype = 'c'
        ) AS checks,
        (
          SELECT count(*)::int
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'phase_layout_snapshots'
            AND indexname IN (
              'phase_layout_snapshots_canonical_idx',
              'phase_layout_snapshots_supersedes_idx'
            )
        ) AS indexes,
        (
          SELECT count(*)::int
          FROM pg_trigger
          WHERE tgname = 'phase_layout_snapshots_frozen_immutable'
            AND tgrelid = 'phase_layout_snapshots'::regclass
            AND NOT tgisinternal
        ) AS "immutableTriggers"
        , EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'configuration_layout_revisions_source_check'
            AND pg_get_constraintdef(oid) LIKE '%event_architect_candidate%'
            AND pg_get_constraintdef(oid) LIKE '%public_batch%'
            AND pg_get_constraintdef(oid) LIKE '%authenticated_batch%'
        ) AS "eventArchitectRevisionSource"
    `);
    expect(catalog.rows[0]).toEqual({
      lineageColumns: 4,
      restrictiveForeignKeys: 4,
      checks: 2,
      indexes: 2,
      immutableTriggers: 1,
      eventArchitectRevisionSource: true,
    });
  });

  it("enforces the staff/admin write boundary and loaded-row tenant scope", async () => {
    const app = requiredServer();
    const url = `/events/${EVENT_ID}/phases/${PHASE_ID}/layout-snapshots`;
    for (const role of ["planner", "hallkeeper"] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: authHeaders({ role }),
        payload: { configurationId: SNAPSHOT.configurationId },
      });
      expect(response.statusCode, response.body).toBe(403);
    }
    const crossTenant = await app.inject({
      method: "POST",
      url,
      headers: authHeaders({ venueId: "11111111-1111-4111-8111-111111111112" }),
      payload: { configurationId: SNAPSHOT.configurationId },
    });
    expect(crossTenant.statusCode, crossTenant.body).toBe(404);
    expect(crossTenant.json()).toEqual({ error: "Event not found", code: "NOT_FOUND" });
  });

  it("makes missing and cross-tenant phase or configuration ids indistinguishable", async () => {
    const app = requiredServer();
    const freeze = (phaseId: string, configurationId: string) => app.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/phases/${phaseId}/layout-snapshots`,
      headers: authHeaders(),
      payload: { configurationId },
    });

    const [missingPhase, crossTenantPhase] = await Promise.all([
      freeze(MISSING_PHASE_ID, SNAPSHOT.configurationId),
      freeze(CROSS_TENANT_PHASE_ID, SNAPSHOT.configurationId),
    ]);
    expect(missingPhase.statusCode, missingPhase.body).toBe(404);
    expect(crossTenantPhase.statusCode, crossTenantPhase.body).toBe(404);
    expect(missingPhase.json()).toEqual({ error: "Phase not found", code: "NOT_FOUND" });
    expect(crossTenantPhase.body).toBe(missingPhase.body);
    expect(crossTenantPhase.json()).toEqual(missingPhase.json());

    const [missingConfiguration, crossTenantConfiguration] = await Promise.all([
      freeze(PHASE_ID, MISSING_CONFIGURATION_ID),
      freeze(PHASE_ID, CROSS_TENANT_CONFIGURATION_ID),
    ]);
    expect(missingConfiguration.statusCode, missingConfiguration.body).toBe(404);
    expect(crossTenantConfiguration.statusCode, crossTenantConfiguration.body).toBe(404);
    expect(missingConfiguration.json()).toEqual({
      error: "Configuration not found",
      code: "NOT_FOUND",
    });
    expect(crossTenantConfiguration.body).toBe(missingConfiguration.body);
    expect(crossTenantConfiguration.json()).toEqual(missingConfiguration.json());

    for (const response of [crossTenantPhase, crossTenantConfiguration]) {
      expect(response.body).not.toContain(CROSS_TENANT_EVENT_ID);
      expect(response.body).not.toContain(CROSS_TENANT_PHASE_ID);
      expect(response.body).not.toContain(CROSS_TENANT_CONFIGURATION_ID);
      expect(response.body).not.toContain(OTHER_VENUE_ID);
      expect(response.body).not.toContain("Foreign tenant secret");
    }
  });

  it("serializes concurrent freezes and serves the resulting canonical keyframe", async () => {
    const app = requiredServer();
    const freezeUrl = `/events/${EVENT_ID}/phases/${PHASE_ID}/layout-snapshots`;
    const freezeRequest = () => app.inject({
      method: "POST",
      url: freezeUrl,
      headers: authHeaders(),
      payload: { configurationId: SNAPSHOT.configurationId },
    });

    const freezeResponses = await Promise.all([freezeRequest(), freezeRequest()]);
    expect(freezeResponses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const freezeBodies = freezeResponses.map((response) => (
      FreezeEnvelopeSchema.parse(response.json()).data
    ));
    expect(freezeBodies.map((body) => body.outcome).sort()).toEqual([
      "already_current",
      "created",
    ]);
    expect(freezeBodies[0]?.snapshotId).toBe(freezeBodies[1]?.snapshotId);

    const platformAdminResponse = await app.inject({
      method: "POST",
      url: freezeUrl,
      headers: authHeaders({ role: "admin", venueId: null, platformRole: "admin" }),
      payload: { configurationId: SNAPSHOT.configurationId },
    });
    expect(platformAdminResponse.statusCode, platformAdminResponse.body).toBe(200);
    expect(FreezeEnvelopeSchema.parse(platformAdminResponse.json()).data.outcome)
      .toBe("already_current");

    const rows = await requiredDatabase().select({
      id: phaseLayoutSnapshots.id,
      canonicalSnapshotId: phaseLayoutSnapshots.canonicalSnapshotId,
      proofDigest: phaseLayoutSnapshots.proofDigest,
      supersedesSnapshotId: phaseLayoutSnapshots.supersedesSnapshotId,
      frozenBy: phaseLayoutSnapshots.frozenBy,
      snapshotHash: phaseLayoutSnapshots.snapshotHash,
      status: phaseLayoutSnapshots.status,
      objectCount: phaseLayoutSnapshots.objectCount,
      guestCount: phaseLayoutSnapshots.guestCount,
      coordinateSpace: phaseLayoutSnapshots.coordinateSpace,
      runtimeBindingState: phaseLayoutSnapshots.runtimeBindingState,
      runtimeBinding: phaseLayoutSnapshots.runtimeBinding,
    }).from(phaseLayoutSnapshots).where(eq(phaseLayoutSnapshots.eventPhaseId, PHASE_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: freezeBodies[0]?.snapshotId,
      canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
      proofDigest: PROOF.proofDigest,
      supersedesSnapshotId: null,
      frozenBy: ACTOR_ID,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      coordinateSpace: "real_m_v1",
      runtimeBindingState: "unavailable",
      runtimeBinding: expect.objectContaining({
        availability: "unavailable",
        unavailableReason: "runtime_not_declared",
        expectedRuntimePackageId: null,
        expectedRuntimeManifestDigest: null,
      }),
    });

    const timelineQuery = new URLSearchParams({
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      from: "2026-06-07T18:00:00.000Z",
      to: "2026-06-07T23:00:00.000Z",
    });
    const timelineResponse = await app.inject({
      method: "GET",
      url: `/calendar/layout-timeline?${timelineQuery.toString()}`,
      headers: authHeaders(),
    });
    expect(timelineResponse.statusCode).toBe(200);
    const timeline = TimelineEnvelopeSchema.parse(timelineResponse.json()).data;
    expect(timeline.timeZone).toBe("Europe/London");
    expect(timeline.range).toEqual({
      scope: "custom",
      anchorDate: null,
      from: "2026-06-07T18:00:00.000Z",
      to: "2026-06-07T23:00:00.000Z",
    });
    expect(timeline.frames).toHaveLength(1);
    const frame = timeline.frames[0];
    expect(frame?.kind).toBe("phase");
    expect(frame?.phaseId).toBe(PHASE_ID);
    expect(frame?.keyframe.state).toBe("available");
    if (frame?.keyframe.state !== "available") {
      throw new Error("Expected the frozen layout to resolve as an available keyframe.");
    }
    expect(frame.keyframe.snapshotId).toBe(freezeBodies[0]?.snapshotId);
    expect(frame.keyframe.snapshotStatus).toBe("frozen");
    expect(frame.keyframe.objectCount).toBe(SNAPSHOT.objects.length);
    expect(frame.keyframe.guestCount).toBe(SNAPSHOT.guestCount);
    expect(frame.keyframe.payload).toEqual(SNAPSHOT);
    expect(frame.keyframe.historicalRuntime).toMatchObject({
      state: "unavailable",
      reason: "runtime_not_declared",
      binding: {
        availability: "unavailable",
        unavailableReason: "runtime_not_declared",
      },
    });
  });

  it("freezes and timelines while hard-closing a synthetic legacy runtime admission", async () => {
    const db = requiredDatabase();
    const fixture = await seedSyntheticHistoricalRuntimeContract(db);

    // A persisted package without an admission valid at the decision instant
    // must stay unavailable; later evidence cannot rewrite that instant.
    await expect(resolvePhaseLayoutRuntimeAdmission(db, {
      venueId: SNAPSHOT.venueId,
      venueSlug: "trades-hall",
      spaceId: SNAPSHOT.spaceId,
      spaceSlug: "grand-hall",
      expectedRuntimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
      expectedRuntimeManifestDigest: fixture.manifestDigest,
      frozenAt: new Date("2026-07-01T08:25:00.000Z"),
    })).resolves.toEqual({
      availability: "unavailable",
      unavailableReason: "provenance_incomplete",
      expectedRuntimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
      expectedRuntimeManifestDigest: fixture.manifestDigest,
    });

    const [rightsRow] = await db.select().from(runtimePresentationRightsEvidence)
      .where(eq(runtimePresentationRightsEvidence.id, SYNTHETIC_RUNTIME_RIGHTS_ROW_ID))
      .limit(1);
    if (rightsRow === undefined) throw new Error("Synthetic rights row was not persisted.");
    const badRightsId = "60000000-0000-4000-8000-000000000005";
    const badRightsSha256 = "9".repeat(64);
    const badRightsBody = {
      ...fixture.rightsBody,
      evidenceId: badRightsId,
      assetSha256: badRightsSha256,
    };
    await expectForeignKeyViolation(
      () => db.insert(runtimePresentationRightsEvidence).values({
        ...rightsRow,
        id: badRightsId,
        assetSha256: badRightsSha256,
        evidenceBody: badRightsBody,
        evidenceDigest: runtimePresentationRightsEvidenceDigest(badRightsBody),
      }),
      "runtime_presentation_rights_evidence_asset_fk",
    );

    const [admissionRow] = await db.select().from(runtimePresentationAdmissions)
      .where(eq(runtimePresentationAdmissions.id, SYNTHETIC_RUNTIME_ADMISSION_ID))
      .limit(1);
    if (admissionRow === undefined) throw new Error("Synthetic admission row was not persisted.");
    const badAdmissionId = "70000000-0000-4000-8000-000000000005";
    const {
      sceneAuthorityArtifactId: _omittedSceneAuthorityIdentity,
      ...invalidAdmissionBody
    } = {
      ...fixture.admissionBody,
      admissionId: badAdmissionId,
    };
    await expectDatabaseViolation(
      () => db.insert(runtimePresentationAdmissions).values({
        ...admissionRow,
        id: badAdmissionId,
        admissionBody: invalidAdmissionBody,
        admissionDigest: "8".repeat(64),
      }),
      "23514",
      "runtime_presentation_admissions_shape",
    );

    const [unsealedMemberRow] = await db.select().from(runtimePresentationAdmissionMembers)
      .where(eq(runtimePresentationAdmissionMembers.admissionId, SYNTHETIC_RUNTIME_ADMISSION_ID))
      .limit(1);
    if (unsealedMemberRow === undefined) {
      throw new Error("Synthetic admission member was not persisted before freeze.");
    }
    await expectDatabaseViolation(
      () => db.insert(runtimePresentationAdmissionMembers).values({
        ...unsealedMemberRow,
        memberIndex: 1,
        sizeBytes: 16 * 1024 * 1024 + 1,
      }),
      "23514",
      "runtime_presentation_admission_members_shape",
    );

    const app = requiredServer();
    const freezeResponse = await app.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/phases/${SYNTHETIC_RUNTIME_PHASE_ID}/layout-snapshots`,
      headers: authHeaders(),
      payload: { configurationId: SYNTHETIC_RUNTIME_CONFIGURATION_ID },
    });
    expect(freezeResponse.statusCode, freezeResponse.body).toBe(201);
    const frozen = FreezeEnvelopeSchema.parse(freezeResponse.json()).data;

    const timelineResponse = await app.inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        from: "2026-06-10T21:00:00.000Z",
        to: "2026-06-10T23:00:00.000Z",
      }).toString()}`,
      headers: authHeaders(),
    });
    expect(timelineResponse.statusCode, timelineResponse.body).toBe(200);
    const timeline = TimelineEnvelopeSchema.parse(timelineResponse.json()).data;
    const frame = timeline.frames.find((candidate) => candidate.phaseId === SYNTHETIC_RUNTIME_PHASE_ID);
    expect(frame?.keyframe.state).toBe("available");
    if (frame?.keyframe.state !== "available") {
      throw new Error("Synthetic historical runtime keyframe was not available.");
    }
    expect(frame.keyframe.snapshotId).toBe(frozen.snapshotId);
    expect(frame.keyframe.payload).toEqual(fixture.payload);
    expect(frame.keyframe.historicalRuntime).toMatchObject({
      state: "unavailable",
      reason: "runtime_activation_missing",
    });

    const [frozenRuntimeRow] = await db.select({
      runtimeBindingState: phaseLayoutSnapshots.runtimeBindingState,
      runtimeBinding: phaseLayoutSnapshots.runtimeBinding,
    }).from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.id, frozen.snapshotId))
      .limit(1);
    expect(frozenRuntimeRow).toEqual({
      runtimeBindingState: "unavailable",
      runtimeBinding: expect.objectContaining({
        admissionPolicy: "trades-hall-reviewed-presentation.v1",
        availability: "unavailable",
        unavailableReason: "runtime_activation_missing",
        expectedRuntimePackageId: SYNTHETIC_RUNTIME_PACKAGE_ID,
        expectedRuntimeManifestDigest: fixture.manifestDigest,
      }),
    });
    expect(fixture.admissionBody).toMatchObject({
      schemaVersion: "runtime-presentation-admission.v1",
      admissionId: SYNTHETIC_RUNTIME_ADMISSION_ID,
    });

    const { buildServer } = await import("../index.js");
    let byteLoaderCalls = 0;
    const memberApp = await buildServer(validateEnv(), {
      historicalRuntimeMemberByteLoader: () => {
        byteLoaderCalls += 1;
        return Promise.resolve(SYNTHETIC_RUNTIME_BYTES);
      },
    });
    const memberUrl = `/calendar/venues/${SNAPSHOT.venueId}/spaces/${SNAPSHOT.spaceId}` +
      `/runtime-bindings/${frozen.snapshotId}/members/0/synthetic-grand-hall.sog`;
    try {
      const memberResponse = await memberApp.inject({
        method: "GET",
        url: memberUrl,
        headers: authHeaders(),
      });
      expect(memberResponse.statusCode, memberResponse.body).toBe(404);
      expect(memberResponse.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(byteLoaderCalls).toBe(0);

      for (const denied of [
        {
          url: `/calendar/venues/${OTHER_VENUE_ID}/spaces/${CROSS_VENUE_SPACE_ID}` +
            `/runtime-bindings/${frozen.snapshotId}/members/0/synthetic-grand-hall.sog`,
          headers: authHeaders({ venueId: OTHER_VENUE_ID }),
        },
        {
          url: `/calendar/venues/${SNAPSHOT.venueId}/spaces/${MISSING_SPACE_ID}` +
            `/runtime-bindings/${frozen.snapshotId}/members/0/synthetic-grand-hall.sog`,
          headers: authHeaders(),
        },
        {
          url: memberUrl.replace("synthetic-grand-hall.sog", "substituted.sog"),
          headers: authHeaders(),
        },
      ]) {
        const deniedResponse = await memberApp.inject({
          method: "GET",
          url: denied.url,
          headers: denied.headers,
        });
        expect(deniedResponse.statusCode, deniedResponse.body).toBe(404);
      }
    } finally {
      await memberApp.close();
    }

    // An unavailable snapshot deliberately does not claim or seal the legacy
    // admission graph. Delivery stays closed above; a future authenticated
    // activation migration must introduce its own immutable execution seal.
    await expectDatabaseViolation(
      () => db.update(runtimePresentationAdmissions)
        .set({ admissionDigest: "7".repeat(64) })
        .where(eq(runtimePresentationAdmissions.id, SYNTHETIC_RUNTIME_ADMISSION_ID)),
      "55000",
      "runtime_presentation_admissions_append_only",
    );
  }, 60_000);

  it("does not leak same-range phases, figures, or keyframes from other rooms or venues", async () => {
    const db = requiredDatabase();
    await db.insert(spaces).values({
      id: SIBLING_SPACE_ID,
      venueId: SNAPSHOT.venueId,
      name: "Sibling room",
      slug: "timeline-sibling-room",
      widthM: "10.00",
      lengthM: "10.00",
      heightM: "3.00",
      floorPlanOutline: SNAPSHOT.venueRuntime.floorPlanOutline,
    });
    await db.insert(eventPhases).values([
      {
        id: SIBLING_SPACE_PHASE_ID,
        eventId: EVENT_ID,
        spaceId: SIBLING_SPACE_ID,
        templateKey: null,
        name: SIBLING_SPACE_PHASE_NAME,
        sortOrder: 90,
        startsAt: PHASE_START,
        durationMinutes: 105,
        guestCount: SIBLING_SPACE_GUEST_COUNT,
      },
      {
        id: FOREIGN_VENUE_PHASE_ID,
        eventId: CROSS_TENANT_EVENT_ID,
        spaceId: CROSS_VENUE_SPACE_ID,
        templateKey: null,
        name: FOREIGN_VENUE_PHASE_NAME,
        sortOrder: 91,
        startsAt: PHASE_START,
        durationMinutes: 105,
        guestCount: FOREIGN_VENUE_GUEST_COUNT,
      },
    ]);
    await db.insert(phaseLayoutSnapshots).values([
      {
        id: SIBLING_SPACE_SNAPSHOT_ID,
        eventPhaseId: SIBLING_SPACE_PHASE_ID,
        status: "draft",
        objectCount: 91,
        guestCount: SIBLING_SPACE_GUEST_COUNT,
      },
      {
        id: FOREIGN_VENUE_SNAPSHOT_ID,
        eventPhaseId: FOREIGN_VENUE_PHASE_ID,
        status: "draft",
        objectCount: 92,
        guestCount: FOREIGN_VENUE_GUEST_COUNT,
      },
    ]);

    const response = await requiredServer().inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        from: "2026-06-07T18:00:00.000Z",
        to: "2026-06-07T23:00:00.000Z",
      }).toString()}`,
      headers: authHeaders(),
    });
    expect(response.statusCode, response.body).toBe(200);
    const timeline = TimelineEnvelopeSchema.parse(response.json()).data;
    expect(timeline.frames.map((frame) => frame.phaseId)).toEqual([PHASE_ID]);

    const keyframeSnapshotIds = timeline.frames.flatMap((frame) => (
      "snapshotId" in frame.keyframe ? [frame.keyframe.snapshotId] : []
    ));
    for (const foreignPhase of [
      {
        phaseId: SIBLING_SPACE_PHASE_ID,
        phaseName: SIBLING_SPACE_PHASE_NAME,
        guestCount: SIBLING_SPACE_GUEST_COUNT,
        snapshotId: SIBLING_SPACE_SNAPSHOT_ID,
      },
      {
        phaseId: FOREIGN_VENUE_PHASE_ID,
        phaseName: FOREIGN_VENUE_PHASE_NAME,
        guestCount: FOREIGN_VENUE_GUEST_COUNT,
        snapshotId: FOREIGN_VENUE_SNAPSHOT_ID,
      },
    ] as const) {
      expect(timeline.frames.map((frame) => frame.phaseId)).not.toContain(foreignPhase.phaseId);
      expect(timeline.frames.map((frame) => frame.phaseName)).not.toContain(foreignPhase.phaseName);
      expect(timeline.frames.map((frame) => frame.figures.guests.value))
        .not.toContain(foreignPhase.guestCount);
      expect(keyframeSnapshotIds).not.toContain(foreignPhase.snapshotId);
      expect(response.body).not.toContain(foreignPhase.phaseId);
      expect(response.body).not.toContain(foreignPhase.phaseName);
      expect(response.body).not.toContain(foreignPhase.snapshotId);
    }
  });

  it("applies the room-planning read matrix without widening write authority", async () => {
    const url = `/calendar/layout-timeline?${new URLSearchParams({
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      scope: "day",
      anchorDate: "2026-06-07",
    }).toString()}`;
    const unauthenticated = await requiredServer().inject({ method: "GET", url });
    expect(unauthenticated.statusCode, unauthenticated.body).toBe(401);

    for (const role of ["planner", "staff", "hallkeeper", "admin"] as const) {
      const allowed = await requiredServer().inject({
        method: "GET",
        url,
        headers: authHeaders({ role }),
      });
      expect(allowed.statusCode, `${role}: ${allowed.body}`).toBe(200);
    }
    for (const venueId of [null, "11111111-1111-4111-8111-111111111112"] as const) {
      const platformAdmin = await requiredServer().inject({
        method: "GET",
        url,
        headers: authHeaders({ role: "admin", platformRole: "admin", venueId }),
      });
      expect(platformAdmin.statusCode, platformAdmin.body).toBe(200);
    }
    for (const denied of [
      { role: "client", venueId: SNAPSHOT.venueId },
      { role: "future_role", venueId: SNAPSHOT.venueId },
      { role: "planner", venueId: null },
      { role: "planner", venueId: "11111111-1111-4111-8111-111111111112" },
    ] as const) {
      const response = await requiredServer().inject({
        method: "GET",
        url,
        headers: authHeaders(denied),
      });
      expect(response.statusCode, response.body).toBe(404);
    }
  });

  it("serves truthful synchronized figures from frozen and matching planning evidence", async () => {
    const db = requiredDatabase();
    await db.insert(configurations).values({
      id: OTHER_CONFIGURATION_ID,
      spaceId: SNAPSHOT.spaceId,
      venueId: SNAPSHOT.venueId,
      userId: ACTOR_ID,
      name: "Revenue decoy layout",
      layoutStyle: SNAPSHOT.layoutStyle,
      guestCount: SNAPSHOT.guestCount,
      visibility: "private",
      slug: "timeline-revenue-decoy",
    });
    await db.insert(revenueScenarios).values([
      {
        id: MATCHING_REVENUE_SCENARIO_ID,
        venueId: SNAPSHOT.venueId,
        eventId: EVENT_ID,
        configurationId: SNAPSHOT.configurationId,
        name: "Dinner layout planning estimate",
        scenarioKind: "layout_based",
        status: "active",
        currency: "GBP",
        plannedGuestCount: SNAPSHOT.guestCount,
        estimatedRevenueMinor: 2_875_000,
        estimatedCostMinor: 0,
        estimatedMarginMinor: 2_875_000,
        comfortStatus: "not_checked",
        reviewGateCount: 1,
        createdBy: ACTOR_ID,
        updatedAt: new Date("2026-06-01T12:00:00.000Z"),
      },
      {
        id: "12121212-1212-4212-8212-121212121213",
        venueId: SNAPSHOT.venueId,
        eventId: EVENT_ID,
        configurationId: OTHER_CONFIGURATION_ID,
        name: "Wrong configuration estimate",
        scenarioKind: "layout_based",
        status: "active",
        currency: "GBP",
        plannedGuestCount: SNAPSHOT.guestCount,
        estimatedRevenueMinor: 88_000_000,
        estimatedCostMinor: 0,
        estimatedMarginMinor: 88_000_000,
        comfortStatus: "not_checked",
        createdBy: ACTOR_ID,
      },
      {
        id: "12121212-1212-4212-8212-121212121214",
        venueId: SNAPSHOT.venueId,
        eventId: EVENT_ID,
        configurationId: null,
        name: "Event-only high-value decoy",
        scenarioKind: "manual",
        status: "active",
        currency: "GBP",
        plannedGuestCount: SNAPSHOT.guestCount,
        estimatedRevenueMinor: 99_000_000,
        estimatedCostMinor: 0,
        estimatedMarginMinor: 99_000_000,
        comfortStatus: "not_checked",
        createdBy: ACTOR_ID,
      },
    ]);

    const response = await requiredServer().inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        scope: "day",
        anchorDate: "2026-06-07",
      }).toString()}`,
      headers: authHeaders({ role: "planner" }),
    });
    expect(response.statusCode, response.body).toBe(200);
    const frame = TimelineEnvelopeSchema.parse(response.json()).data.frames
      .find((candidate) => candidate.phaseId === PHASE_ID);
    expect(frame?.figures).toEqual({
      guests: { value: SNAPSHOT.guestCount, source: "frozen_snapshot" },
      seatedCapacity: {
        state: "available",
        value: 1,
        source: "frozen_snapshot",
        basis: "chair_objects",
      },
      staffing: {
        state: "not_checked",
        value: null,
        source: "phase_staff_conflicts",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
      },
      revenue: {
        state: "available",
        source: "planning_scenario",
        scenario: {
          id: MATCHING_REVENUE_SCENARIO_ID,
          name: "Dinner layout planning estimate",
          status: "active",
          scenarioKind: "layout_based",
          currency: "GBP",
          plannedGuestCount: SNAPSHOT.guestCount,
          estimatedRevenueMinor: 2_875_000,
          comfortStatus: "not_checked",
          reviewGateCount: 1,
          updatedAt: "2026-06-01T12:00:00.000Z",
        },
        disclosure: "Planning scenario estimate; not a quote or approval.",
      },
    });

    for (const actor of [
      { role: "staff" },
      { role: "admin" },
      { role: "hallkeeper" },
      { role: "admin", platformRole: "admin" as const, venueId: null },
    ]) {
      const authorized = await requiredServer().inject({
        method: "GET",
        url: `/calendar/layout-timeline?${new URLSearchParams({
          venueId: SNAPSHOT.venueId,
          spaceId: SNAPSHOT.spaceId,
          scope: "day",
          anchorDate: "2026-06-07",
        }).toString()}`,
        headers: authHeaders(actor),
      });
      expect(authorized.statusCode, authorized.body).toBe(200);
      const revenue = TimelineEnvelopeSchema.parse(authorized.json()).data.frames
        .find((candidate) => candidate.phaseId === PHASE_ID)?.figures.revenue;
      expect(revenue).toMatchObject({
        state: "available",
        scenario: { id: MATCHING_REVENUE_SCENARIO_ID },
      });
    }

    const nonOwnerPlanner = await requiredServer().inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        scope: "day",
        anchorDate: "2026-06-07",
      }).toString()}`,
      headers: authHeaders({
        id: "44444444-4444-4444-8444-444444444446",
        role: "planner",
      }),
    });
    expect(nonOwnerPlanner.statusCode, nonOwnerPlanner.body).toBe(200);
    const restricted = TimelineEnvelopeSchema.parse(nonOwnerPlanner.json()).data.frames
      .find((candidate) => candidate.phaseId === PHASE_ID)?.figures.revenue;
    expect(restricted).toEqual({
      state: "restricted",
      reason: "insufficient_commercial_access",
    });
    expect(nonOwnerPlanner.body).not.toContain(MATCHING_REVENUE_SCENARIO_ID);
    expect(nonOwnerPlanner.body).not.toContain("Dinner layout planning estimate");
    expect(nonOwnerPlanner.body).not.toContain("2875000");
    expect(nonOwnerPlanner.body).not.toContain('"estimatedRevenueMinor"');
    expect(nonOwnerPlanner.body).not.toContain('"source":"planning_scenario"');
  });

  it("marks seated capacity unavailable when frozen seat metadata is incomplete", async () => {
    const payload: CanonicalLayoutSnapshotV0 = {
      ...SNAPSHOT,
      configurationId: INCOMPLETE_CAPACITY_CONFIGURATION_ID,
      layoutName: "Incomplete seating evidence",
      objects: SNAPSHOT.objects.map((object) => ({
        ...object,
        assetDefinition: { ...object.assetDefinition, seatCount: null },
      })),
    };
    const digest = canonicalLayoutSnapshotDigest(payload);
    const proof = runLayoutValidator(payload, {
      policyBundleId: payload.policyBundle.policyBundleId,
      policyBundleDigest: payload.policyBundle.policyBundleDigest,
      policyBundleVersion: payload.policyBundle.policyBundleVersion,
      minPrimaryFurnitureClearanceM: 1,
      clearanceWarningMarginM: 0.2,
      pricing: null,
    });
    const frozenAt = new Date("2026-06-07T21:00:00.000Z");
    await requiredDatabase().insert(configurations).values({
      id: INCOMPLETE_CAPACITY_CONFIGURATION_ID,
      spaceId: SNAPSHOT.spaceId,
      venueId: SNAPSHOT.venueId,
      userId: ACTOR_ID,
      name: payload.layoutName,
      layoutStyle: payload.layoutStyle,
      guestCount: payload.guestCount,
      visibility: payload.visibility,
      slug: "timeline-incomplete-seating",
    });
    await requiredDatabase().insert(eventPhases).values({
      id: INCOMPLETE_CAPACITY_PHASE_ID,
      eventId: EVENT_ID,
      spaceId: SNAPSHOT.spaceId,
      templateKey: null,
      name: "Incomplete seating evidence",
      sortOrder: 4,
      startsAt: new Date("2026-06-07T21:00:00.000Z"),
      durationMinutes: 30,
      guestCount: payload.guestCount,
    });
    await requiredDatabase().insert(canonicalLayoutSnapshots).values({
      id: INCOMPLETE_CAPACITY_CANONICAL_ID,
      configurationId: payload.configurationId,
      venueId: payload.venueId,
      spaceId: payload.spaceId,
      schemaVersion: payload.schemaVersion,
      snapshotDigest: digest,
      payload,
      createdBy: ACTOR_ID,
      createdAt: frozenAt,
    });
    await requiredDatabase().insert(layoutValidationRuns).values({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
      snapshotId: INCOMPLETE_CAPACITY_CANONICAL_ID,
      snapshotDigest: digest,
      validatorVersion: proof.validatorVersion,
      validatorDigest: proof.validatorDigest,
      contextDigest: proof.contextDigest,
      proofDigest: proof.proofDigest,
      payload: proof,
      createdAt: frozenAt,
    });
    await requiredDatabase().insert(phaseLayoutSnapshots).values({
      id: INCOMPLETE_CAPACITY_SNAPSHOT_ID,
      eventPhaseId: INCOMPLETE_CAPACITY_PHASE_ID,
      configurationId: payload.configurationId,
      canonicalSnapshotId: INCOMPLETE_CAPACITY_CANONICAL_ID,
      proofDigest: proof.proofDigest,
      frozenBy: ACTOR_ID,
      snapshotHash: digest,
      status: "frozen",
      objectCount: payload.objects.length,
      guestCount: payload.guestCount,
      payload,
      coordinateSpace: "real_m_v1",
      createdAt: frozenAt,
      frozenAt,
    });

    const response = await requiredServer().inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        scope: "day",
        anchorDate: "2026-06-07",
      }).toString()}`,
      headers: authHeaders(),
    });
    expect(response.statusCode, response.body).toBe(200);
    const frame = TimelineEnvelopeSchema.parse(response.json()).data.frames
      .find((candidate) => candidate.phaseId === INCOMPLETE_CAPACITY_PHASE_ID);
    expect(frame?.keyframe.state).toBe("available");
    expect(frame?.figures.seatedCapacity).toEqual({
      state: "unavailable",
      reason: "capacity_evidence_incomplete",
    });
  });

  it("creates an Event Architect layout and event through real APIs, freezes it, and reloads the same Day keyframe", async () => {
    const app = requiredServer();
    const architectResponse = await app.inject({
      method: "POST",
      url: "/event-architect/runs",
      headers: authHeaders(),
      payload: {
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        idempotencyKey: "timeline-application-happy-path-v1",
        brief: {
          eventName: "Application timeline dinner",
          eventType: "dinner",
          guestCount: 20,
          layoutStyle: "dinner-rounds",
          budgetLimitMinor: null,
          preferredDate: "2026-07-14",
          startTime: "19:00",
          endTime: "22:00",
          serviceModel: "plated",
          accessibilityRequirements: [],
          planningPrompt: "Create a proof-carrying dinner layout for the timeline rehearsal.",
        },
      },
    });
    expect(architectResponse.statusCode, architectResponse.body).toBe(201);
    const architectRun = ArchitectRunEnvelopeSchema.parse(architectResponse.json()).data;
    const candidate = architectRun.run.candidates[0];
    if (candidate === undefined) throw new Error("Event Architect returned no candidate.");

    const selectionResponse = await app.inject({
      method: "POST",
      url: `/event-architect/candidates/${candidate.candidateId}/select`,
      headers: authHeaders(),
      payload: {
        idempotencyKey: "timeline-candidate-selection-v1",
        expectedRequestDigest: architectRun.run.requestDigest,
      },
    });
    expect(selectionResponse.statusCode, selectionResponse.body).toBe(200);
    const selection = ArchitectSelectionEnvelopeSchema.parse(selectionResponse.json()).data;

    const eventResponse = await app.inject({
      method: "POST",
      url: "/events",
      headers: authHeaders(),
      payload: {
        venueId: SNAPSHOT.venueId,
        name: "Application timeline dinner",
        eventType: "dinner",
        status: "confirmed",
        startsAt: "2026-07-14T18:00:00.000Z",
        endsAt: "2026-07-14T22:00:00.000Z",
        guestCount: candidate.snapshot.guestCount,
      },
    });
    expect(eventResponse.statusCode, eventResponse.body).toBe(201);
    const eventGraph = EventGraphEnvelopeSchema.parse(eventResponse.json()).data;
    const dinnerPhase = eventGraph.phases.find((phase) => phase.templateKey === "dinner");
    if (dinnerPhase === undefined) throw new Error("Created event has no dinner phase.");

    const createdPhaseResponse = await app.inject({
      method: "POST",
      url: `/events/${eventGraph.event.id}/phases`,
      headers: authHeaders(),
      payload: {
        name: "Layout check",
        spaceId: SNAPSHOT.spaceId,
        startsAt: "2026-07-14T17:30:00.000Z",
        durationMinutes: 30,
      },
    });
    expect(createdPhaseResponse.statusCode, createdPhaseResponse.body).toBe(201);
    const createdPhase = EventPhaseEnvelopeSchema.parse(createdPhaseResponse.json()).data;
    expect(createdPhase.spaceId).toBe(SNAPSHOT.spaceId);

    const unassignedPhaseResponse = await app.inject({
      method: "PATCH",
      url: `/event-phases/${createdPhase.id}`,
      headers: authHeaders(),
      payload: { spaceId: null },
    });
    expect(unassignedPhaseResponse.statusCode, unassignedPhaseResponse.body).toBe(200);
    expect(EventPhaseEnvelopeSchema.parse(unassignedPhaseResponse.json()).data.spaceId).toBeNull();
    const unassignedFreeze = await app.inject({
      method: "POST",
      url: `/events/${eventGraph.event.id}/phases/${createdPhase.id}/layout-snapshots`,
      headers: authHeaders(),
      payload: { configurationId: selection.configurationId },
    });
    expect(unassignedFreeze.statusCode, unassignedFreeze.body).toBe(404);
    expect(unassignedFreeze.json()).toMatchObject({ code: "NOT_FOUND" });

    const spaceMismatch = {
      error: "Event phase room must be an active room at the event venue",
      code: "EVENT_PHASE_SPACE_MISMATCH",
    };
    const phaseCountBefore = await requiredDatabase().select({ id: eventPhases.id })
      .from(eventPhases).where(eq(eventPhases.eventId, eventGraph.event.id));
    for (const badSpaceId of [CROSS_VENUE_SPACE_ID, DELETED_SPACE_ID, MISSING_SPACE_ID]) {
      const badSpaceResponse = await app.inject({
        method: "PATCH",
        url: `/event-phases/${dinnerPhase.id}`,
        headers: authHeaders(),
        payload: { spaceId: badSpaceId },
      });
      expect(badSpaceResponse.statusCode, badSpaceResponse.body).toBe(422);
      expect(badSpaceResponse.json()).toEqual(spaceMismatch);

      const badCreateResponse = await app.inject({
        method: "POST",
        url: `/events/${eventGraph.event.id}/phases`,
        headers: authHeaders(),
        payload: { name: `Bad room ${badSpaceId}`, spaceId: badSpaceId },
      });
      expect(badCreateResponse.statusCode, badCreateResponse.body).toBe(422);
      expect(badCreateResponse.json()).toEqual(spaceMismatch);
    }
    const phaseCountAfter = await requiredDatabase().select({ id: eventPhases.id })
      .from(eventPhases).where(eq(eventPhases.eventId, eventGraph.event.id));
    expect(phaseCountAfter).toHaveLength(phaseCountBefore.length);
    const unchangedDinner = await requiredDatabase().select({ spaceId: eventPhases.spaceId })
      .from(eventPhases).where(eq(eventPhases.id, dinnerPhase.id));
    expect(unchangedDinner[0]?.spaceId).toBeNull();

    const phaseResponse = await app.inject({
      method: "PATCH",
      url: `/event-phases/${dinnerPhase.id}`,
      headers: authHeaders(),
      payload: {
        spaceId: SNAPSHOT.spaceId,
        startsAt: "2026-07-14T18:30:00.000Z",
        durationMinutes: 150,
        guestCount: candidate.snapshot.guestCount,
      },
    });
    expect(phaseResponse.statusCode, phaseResponse.body).toBe(200);
    expect(EventPhaseEnvelopeSchema.parse(phaseResponse.json()).data.spaceId)
      .toBe(SNAPSHOT.spaceId);

    const freezeResponse = await app.inject({
      method: "POST",
      url: `/events/${eventGraph.event.id}/phases/${dinnerPhase.id}/layout-snapshots`,
      headers: authHeaders(),
      payload: { configurationId: selection.configurationId },
    });
    expect(freezeResponse.statusCode, freezeResponse.body).toBe(201);
    const frozen = FreezeEnvelopeSchema.parse(freezeResponse.json()).data;

    const timelineQuery = new URLSearchParams({
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      scope: "day",
      anchorDate: "2026-07-14",
    });
    const timelineUrl = `/calendar/layout-timeline?${timelineQuery.toString()}`;
    const firstTimelineResponse = await app.inject({
      method: "GET",
      url: timelineUrl,
      headers: authHeaders(),
    });
    expect(firstTimelineResponse.statusCode, firstTimelineResponse.body).toBe(200);
    const firstTimeline = TimelineEnvelopeSchema.parse(firstTimelineResponse.json()).data;
    const firstFrame = firstTimeline.frames.find((frame) => frame.phaseId === dinnerPhase.id);
    expect(firstFrame?.keyframe.state).toBe("available");
    if (firstFrame?.keyframe.state !== "available") {
      throw new Error("Expected the application-created frozen keyframe.");
    }
    expect(firstFrame.keyframe.snapshotId).toBe(frozen.snapshotId);
    expect(firstFrame.keyframe.canonicalSnapshotId).toBe(frozen.canonicalSnapshotId);
    expect(firstFrame.keyframe.proofDigest).toBe(frozen.proofDigest);
    expect(firstFrame.keyframe.payload).toEqual(candidate.snapshot);

    const reloaded = await requiredServerBuilder()();
    try {
      const reloadResponse = await reloaded.inject({
        method: "GET",
        url: timelineUrl,
        headers: authHeaders(),
      });
      expect(reloadResponse.statusCode, reloadResponse.body).toBe(200);
      const reloadTimeline = TimelineEnvelopeSchema.parse(reloadResponse.json()).data;
      const reloadFrame = reloadTimeline.frames.find((frame) => frame.phaseId === dinnerPhase.id);
      expect(reloadFrame?.keyframe.state).toBe("available");
      if (reloadFrame?.keyframe.state !== "available") {
        throw new Error("Expected the frozen keyframe after server reload.");
      }
      expect(reloadFrame.keyframe.snapshotId).toBe(frozen.snapshotId);
      expect(reloadFrame.keyframe.payload).toEqual(firstFrame.keyframe.payload);
    } finally {
      await reloaded.close();
    }

    applicationArtifact = {
      eventId: eventGraph.event.id,
      phaseId: dinnerPhase.id,
      configurationId: selection.configurationId,
      canonicalSnapshotId: frozen.canonicalSnapshotId,
      proofDigest: frozen.proofDigest,
      snapshotHash: frozen.snapshotHash,
      payload: candidate.snapshot,
    };
  });

  it("rejects independently valid canonical/proof rows and copied payloads that do not form one lineage", async () => {
    const artifact = applicationArtifact;
    if (artifact === null) throw new Error("Application-created lineage is unavailable.");
    const db = requiredDatabase();
    await db.insert(eventPhases).values([
      {
        id: PROOF_MISMATCH_PHASE_ID,
        eventId: EVENT_ID,
        spaceId: SNAPSHOT.spaceId,
        templateKey: null,
        name: "Proof mismatch",
        sortOrder: 4,
        startsAt: new Date("2026-06-10T18:00:00.000Z"),
        durationMinutes: 60,
        guestCount: SNAPSHOT.guestCount,
      },
      {
        id: CANONICAL_MISMATCH_PHASE_ID,
        eventId: EVENT_ID,
        spaceId: SNAPSHOT.spaceId,
        templateKey: null,
        name: "Canonical mismatch",
        sortOrder: 5,
        startsAt: new Date("2026-06-10T20:00:00.000Z"),
        durationMinutes: 60,
        guestCount: artifact.payload.guestCount,
      },
    ]);
    const firstAt = new Date("2026-06-10T12:00:00.000Z");
    const secondAt = new Date("2026-06-10T12:01:00.000Z");
    await db.insert(phaseLayoutSnapshots).values([
      {
        id: randomUUID(),
        eventPhaseId: PROOF_MISMATCH_PHASE_ID,
        configurationId: SNAPSHOT.configurationId,
        canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
        // Valid proof B, but canonical A: both independent 0060 FKs pass.
        proofDigest: artifact.proofDigest,
        frozenBy: ACTOR_ID,
        snapshotHash: SNAPSHOT_DIGEST,
        status: "frozen",
        objectCount: SNAPSHOT.objects.length,
        guestCount: SNAPSHOT.guestCount,
        payload: SNAPSHOT,
        coordinateSpace: "real_m_v1",
        createdAt: firstAt,
        frozenAt: firstAt,
      },
      {
        id: randomUUID(),
        eventPhaseId: CANONICAL_MISMATCH_PHASE_ID,
        configurationId: artifact.configurationId,
        // Copied payload/hash B, but referenced canonical/proof A.
        canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
        proofDigest: PROOF.proofDigest,
        frozenBy: ACTOR_ID,
        snapshotHash: artifact.snapshotHash,
        status: "frozen",
        objectCount: artifact.payload.objects.length,
        guestCount: artifact.payload.guestCount,
        payload: artifact.payload,
        coordinateSpace: "real_m_v1",
        createdAt: secondAt,
        frozenAt: secondAt,
      },
    ]);

    const query = new URLSearchParams({
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      scope: "day",
      anchorDate: "2026-06-10",
    });
    const response = await requiredServer().inject({
      method: "GET",
      url: `/calendar/layout-timeline?${query.toString()}`,
      headers: authHeaders(),
    });
    expect(response.statusCode, response.body).toBe(200);
    const timeline = TimelineEnvelopeSchema.parse(response.json()).data;
    expect(timeline.frames.find((frame) => frame.phaseId === PROOF_MISMATCH_PHASE_ID)?.keyframe)
      .toMatchObject({ state: "invalid", reason: "proof_lineage_mismatch" });
    expect(timeline.frames.find((frame) => frame.phaseId === CANONICAL_MISMATCH_PHASE_ID)?.keyframe)
      .toMatchObject({ state: "invalid", reason: "canonical_lineage_mismatch" });
  });

  it("pins effective frozen precedence and never falls back from invalid newest frozen lineage", async () => {
    const artifact = applicationArtifact;
    if (artifact === null) throw new Error("Application-created proof is unavailable.");
    const db = requiredDatabase();
    await db.insert(eventPhases).values({
      id: PRECEDENCE_PHASE_ID,
      eventId: EVENT_ID,
      spaceId: SNAPSHOT.spaceId,
      templateKey: null,
      name: "Frozen precedence",
      sortOrder: 7,
      startsAt: new Date("2026-06-11T18:00:00.000Z"),
      durationMinutes: 60,
      guestCount: SNAPSHOT.guestCount,
    });
    const keyframe = async () => {
      const response = await requiredServer().inject({
        method: "GET",
        url: `/calendar/layout-timeline?${new URLSearchParams({
          venueId: SNAPSHOT.venueId,
          spaceId: SNAPSHOT.spaceId,
          scope: "day",
          anchorDate: "2026-06-11",
        }).toString()}`,
        headers: authHeaders(),
      });
      expect(response.statusCode, response.body).toBe(200);
      const frame = TimelineEnvelopeSchema.parse(response.json()).data.frames
        .find((candidate) => candidate.phaseId === PRECEDENCE_PHASE_ID);
      if (frame === undefined) throw new Error("Precedence frame is unavailable.");
      return frame.keyframe;
    };
    const t1At = new Date("2026-06-11T12:00:00.000Z");
    await db.insert(phaseLayoutSnapshots).values({
      id: PRECEDENCE_T1_ID,
      eventPhaseId: PRECEDENCE_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
      proofDigest: PROOF.proofDigest,
      frozenBy: ACTOR_ID,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: t1At,
      frozenAt: t1At,
    });
    await db.insert(phaseLayoutSnapshots).values({
      id: PRECEDENCE_MUTABLE_ID,
      eventPhaseId: PRECEDENCE_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "draft",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: new Date("2026-06-11T13:00:00.000Z"),
    });
    for (const status of ["draft", "stale", "superseded"] as const) {
      if (status !== "draft") {
        await db.update(phaseLayoutSnapshots).set({ status }).where(
          eq(phaseLayoutSnapshots.id, PRECEDENCE_MUTABLE_ID),
        );
      }
      expect(await keyframe()).toMatchObject({
        state: "available",
        snapshotId: PRECEDENCE_T1_ID,
      });
    }

    const t2At = new Date("2026-06-11T14:00:00.000Z");
    await db.insert(phaseLayoutSnapshots).values({
      id: PRECEDENCE_T2_ID,
      eventPhaseId: PRECEDENCE_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
      proofDigest: PROOF.proofDigest,
      supersedesSnapshotId: PRECEDENCE_T1_ID,
      frozenBy: ACTOR_ID,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: t2At,
      frozenAt: t2At,
    });
    expect(await keyframe()).toMatchObject({
      state: "available",
      snapshotId: PRECEDENCE_T2_ID,
    });

    const t3At = new Date("2026-06-11T15:00:00.000Z");
    await db.insert(phaseLayoutSnapshots).values({
      id: PRECEDENCE_T3_ID,
      eventPhaseId: PRECEDENCE_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
      proofDigest: artifact.proofDigest,
      supersedesSnapshotId: PRECEDENCE_T2_ID,
      frozenBy: ACTOR_ID,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: t3At,
      frozenAt: t3At,
    });
    const invalid = await keyframe();
    expect(invalid).toMatchObject({
      state: "invalid",
      snapshotId: PRECEDENCE_T3_ID,
      reason: "proof_lineage_mismatch",
    });
    expect(invalid).not.toHaveProperty("payload");
  });

  it("resolves 04:00 operational day/week bounds across overnight phases and both DST edges", async () => {
    const app = requiredServer();
    const load = async (
      scope: "day" | "week",
      anchorDate: string,
      headers = authHeaders(),
    ) => {
      const query = new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        scope,
        anchorDate,
      });
      const response = await app.inject({
        method: "GET",
        url: `/calendar/layout-timeline?${query.toString()}`,
        headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      return TimelineEnvelopeSchema.parse(response.json()).data;
    };

    const overnightOwner = await load("day", "2026-06-08", authHeaders({ role: "hallkeeper" }));
    expect(overnightOwner.range).toEqual({
      scope: "day",
      anchorDate: "2026-06-08",
      from: "2026-06-08T03:00:00.000Z",
      to: "2026-06-09T03:00:00.000Z",
    });
    expect(overnightOwner.frames.map((frame) => frame.phaseId)).toContain(OVERNIGHT_PHASE_ID);
    const followingDay = await load("day", "2026-06-09");
    expect(followingDay.frames.map((frame) => frame.phaseId)).not.toContain(OVERNIGHT_PHASE_ID);

    const spring = await load("day", "2026-03-28");
    expect(spring.range.from).toBe("2026-03-28T04:00:00.000Z");
    expect(spring.range.to).toBe("2026-03-29T03:00:00.000Z");
    expect(Date.parse(spring.range.to) - Date.parse(spring.range.from))
      .toBe(23 * 60 * 60 * 1_000);

    const autumn = await load("day", "2026-10-24");
    expect(autumn.range.from).toBe("2026-10-24T03:00:00.000Z");
    expect(autumn.range.to).toBe("2026-10-25T04:00:00.000Z");
    expect(Date.parse(autumn.range.to) - Date.parse(autumn.range.from))
      .toBe(25 * 60 * 60 * 1_000);

    const week = await load("week", "2026-10-22");
    expect(week.range).toEqual({
      scope: "week",
      anchorDate: "2026-10-22",
      from: "2026-10-18T23:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
    });
    expect(Date.parse(week.range.to) - Date.parse(week.range.from))
      .toBe(169 * 60 * 60 * 1_000);

    const springWeek = await load("week", "2026-03-26");
    expect(springWeek.range).toEqual({
      scope: "week",
      anchorDate: "2026-03-26",
      from: "2026-03-23T00:00:00.000Z",
      to: "2026-03-29T23:00:00.000Z",
    });
    expect(Date.parse(springWeek.range.to) - Date.parse(springWeek.range.from))
      .toBe(167 * 60 * 60 * 1_000);
  });

  it("never exposes mutable or lineage-free snapshots to the room viewer", async () => {
    const db = requiredDatabase();
    const app = requiredServer();
    const loadOvernightKeyframe = async () => {
      const query = new URLSearchParams({
        venueId: SNAPSHOT.venueId,
        spaceId: SNAPSHOT.spaceId,
        scope: "day",
        anchorDate: "2026-06-08",
      });
      const response = await app.inject({
        method: "GET",
        url: `/calendar/layout-timeline?${query.toString()}`,
        headers: authHeaders(),
      });
      expect(response.statusCode, response.body).toBe(200);
      const timeline = TimelineEnvelopeSchema.parse(response.json()).data;
      const frame = timeline.frames.find((candidate) => candidate.phaseId === OVERNIGHT_PHASE_ID);
      if (frame === undefined) throw new Error("Expected the overnight phase frame.");
      return frame.keyframe;
    };

    await db.insert(phaseLayoutSnapshots).values({
      id: MUTABLE_SNAPSHOT_ID,
      eventPhaseId: OVERNIGHT_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "draft",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
    });
    for (const status of ["draft", "stale", "superseded"] as const) {
      if (status !== "draft") {
        await db.update(phaseLayoutSnapshots).set({ status }).where(
          eq(phaseLayoutSnapshots.id, MUTABLE_SNAPSHOT_ID),
        );
      }
      expect(await loadOvernightKeyframe()).toMatchObject({
        state: "invalid",
        snapshotStatus: status,
        reason: "snapshot_not_frozen",
      });
    }
    await db.delete(phaseLayoutSnapshots).where(eq(
      phaseLayoutSnapshots.id,
      MUTABLE_SNAPSHOT_ID,
    ));

    const frozenAt = new Date("2026-06-08T18:00:00.000Z");
    await db.insert(phaseLayoutSnapshots).values({
      id: MISSING_LINEAGE_SNAPSHOT_ID,
      eventPhaseId: OVERNIGHT_PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: frozenAt,
      frozenAt,
    });
    expect(await loadOvernightKeyframe()).toMatchObject({
      state: "invalid",
      snapshotStatus: "frozen",
      reason: "frozen_lineage_missing",
    });
  });

  it("does not treat a persisted guest-count mismatch as already current", async () => {
    const db = requiredDatabase();
    const [current] = await db.select({
      id: phaseLayoutSnapshots.id,
      frozenAt: phaseLayoutSnapshots.frozenAt,
    }).from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.eventPhaseId, PHASE_ID))
      .orderBy(sql`${phaseLayoutSnapshots.frozenAt} desc`)
      .limit(1);
    if (current === undefined || current.frozenAt === null) {
      throw new Error("Expected the initial frozen phase snapshot.");
    }
    const malformedAt = new Date(current.frozenAt.getTime() + 1_000);
    await db.insert(phaseLayoutSnapshots).values({
      id: MALFORMED_FROZEN_ID,
      eventPhaseId: PHASE_ID,
      configurationId: SNAPSHOT.configurationId,
      canonicalSnapshotId: CANONICAL_SNAPSHOT_ID,
      proofDigest: PROOF.proofDigest,
      supersedesSnapshotId: current.id,
      frozenBy: ACTOR_ID,
      snapshotHash: SNAPSHOT_DIGEST,
      status: "frozen",
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount + 1,
      payload: SNAPSHOT,
      coordinateSpace: "real_m_v1",
      createdAt: malformedAt,
      frozenAt: malformedAt,
    });

    const response = await requiredServer().inject({
      method: "POST",
      url: `/events/${EVENT_ID}/phases/${PHASE_ID}/layout-snapshots`,
      headers: authHeaders(),
      payload: { configurationId: SNAPSHOT.configurationId },
    });
    expect(response.statusCode, response.body).toBe(201);
    const corrected = FreezeEnvelopeSchema.parse(response.json()).data;
    expect(corrected.outcome).toBe("created");
    expect(corrected.guestCount).toBe(SNAPSHOT.guestCount);
    expect(corrected.supersedesSnapshotId).toBe(MALFORMED_FROZEN_ID);
  });

  it("makes frozen rows immutable while allowing append/supersession and draft cleanup", async () => {
    const db = requiredDatabase();
    await expectDatabaseViolation(
      () => db.update(phaseLayoutSnapshots).set({ guestCount: 1 }).where(
        eq(phaseLayoutSnapshots.id, MALFORMED_FROZEN_ID),
      ),
      "55000",
      "phase_layout_snapshots_frozen_immutable",
    );
    await expectDatabaseViolation(
      () => db.delete(phaseLayoutSnapshots).where(
        eq(phaseLayoutSnapshots.id, MALFORMED_FROZEN_ID),
      ),
      "55000",
      "phase_layout_snapshots_frozen_immutable",
    );
    await expectDatabaseViolation(
      () => db.delete(eventPhases).where(eq(eventPhases.id, PHASE_ID)),
      "55000",
      "phase_layout_snapshots_frozen_immutable",
    );

    const draftId = randomUUID();
    await db.insert(phaseLayoutSnapshots).values({
      id: draftId,
      eventPhaseId: OVERNIGHT_PHASE_ID,
      status: "draft",
      objectCount: 0,
      coordinateSpace: "real_m_v1",
    });
    await expectDatabaseViolation(
      () => db.update(phaseLayoutSnapshots).set({ status: "frozen" }).where(
        eq(phaseLayoutSnapshots.id, draftId),
      ),
      "55000",
      "phase_layout_snapshots_frozen_immutable",
    );
    await expect(db.update(phaseLayoutSnapshots).set({ objectCount: 1 }).where(
      eq(phaseLayoutSnapshots.id, draftId),
    )).resolves.toBeDefined();
    await expect(db.delete(phaseLayoutSnapshots).where(
      eq(phaseLayoutSnapshots.id, draftId),
    )).resolves.toBeDefined();
    const [remainingDraft] = await db.select({ id: phaseLayoutSnapshots.id })
      .from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.id, draftId));
    expect(remainingDraft).toBeUndefined();

    const [predecessor] = await db.select({
      id: phaseLayoutSnapshots.id,
      frozenAt: phaseLayoutSnapshots.frozenAt,
    }).from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.eventPhaseId, PHASE_ID))
      .orderBy(sql`${phaseLayoutSnapshots.frozenAt} desc`)
      .limit(1);
    if (predecessor === undefined || predecessor.frozenAt === null) {
      throw new Error("Expected a frozen predecessor for lineage testing.");
    }
    const crossPhaseAt = new Date(predecessor.frozenAt.getTime() + 10_000);
    await expectDatabaseViolation(
      () => db.insert(phaseLayoutSnapshots).values({
        id: randomUUID(),
        eventPhaseId: OVERNIGHT_PHASE_ID,
        supersedesSnapshotId: predecessor.id,
        status: "frozen",
        objectCount: 0,
        coordinateSpace: "real_m_v1",
        createdAt: crossPhaseAt,
        frozenAt: crossPhaseAt,
      }),
      "23514",
      "phase_layout_snapshots_supersedes_lineage",
    );
  });

  it("enforces restrictive lineage references at runtime", async () => {
    const db = requiredDatabase();
    await db.insert(users).values({
      id: RESTRICT_ACTOR_ID,
      email: "timeline-restrict-actor@integration.test",
      name: "Timeline Restrict Actor",
      role: "staff",
      platformRole: "none",
      venueId: SNAPSHOT.venueId,
    });
    const restrictAt = new Date("2026-06-12T12:00:00.000Z");
    await db.insert(phaseLayoutSnapshots).values({
      id: RESTRICT_SNAPSHOT_ID,
      eventPhaseId: OVERNIGHT_PHASE_ID,
      frozenBy: RESTRICT_ACTOR_ID,
      status: "frozen",
      objectCount: 0,
      coordinateSpace: "real_m_v1",
      createdAt: restrictAt,
      frozenAt: restrictAt,
    });
    await expectForeignKeyViolation(
      () => db.delete(users).where(eq(users.id, RESTRICT_ACTOR_ID)),
      "phase_layout_snapshots_frozen_by_fk",
    );
    await expectForeignKeyViolation(
      () => db.delete(canonicalLayoutSnapshots).where(eq(
        canonicalLayoutSnapshots.id,
        CANONICAL_SNAPSHOT_ID,
      )),
      "phase_layout_snapshots_canonical_snapshot_fk",
    );
    await expectForeignKeyViolation(
      () => db.delete(layoutValidationRuns).where(eq(
        layoutValidationRuns.id,
        VALIDATION_RUN_ID,
      )),
      "phase_layout_snapshots_proof_digest_fk",
    );
  });

  it("linearizes the real batch-edit path ahead of freeze and returns a retryable 409", async () => {
    const app = requiredServer();
    // A second server instance gives the freeze request an independent Neon
    // pool, matching horizontally scaled production and preventing a blocked
    // batch writer from monopolising one test server's driver connection.
    const freezeApp = await requiredServerBuilder()();
    const db = requiredDatabase();
    const [configuration] = await db.select({ revision: configurations.revision })
      .from(configurations)
      .where(eq(configurations.id, SNAPSHOT.configurationId));
    if (configuration === undefined) throw new Error("Expected the seeded configuration.");
    const beforeRows = await db.select({ id: phaseLayoutSnapshots.id })
      .from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.eventPhaseId, PHASE_ID));

    const batchPayload = {
      expectedRevision: configuration.revision,
      objects: SNAPSHOT.objects.map((object, index) => ({
        id: object.objectId,
        assetDefinitionId: object.assetDefinition.assetDefinitionId,
        positionX: object.position.x + (index === 0 ? 0.001 : 0),
        positionY: object.position.y,
        positionZ: object.position.z,
        rotationX: object.rotation.x,
        rotationY: object.rotation.y,
        rotationZ: object.rotation.z,
        scale: object.scale,
        sortOrder: object.sortOrder,
        metadata: {
          ...(object.metadata ?? {}),
          groupId: object.groupId,
          eventArchitectCandidateId: EVENT_ARCHITECT_CANDIDATE_ID,
        },
      })),
    };

    const locker = new Client({ connectionString: DATABASE_URL });
    const observer = new Client({ connectionString: DATABASE_URL });
    await Promise.all([locker.connect(), observer.connect()]);
    const lockerPidResult = await locker.query<{ readonly pid: number }>(
      "SELECT pg_backend_pid()::int AS pid",
    );
    const lockerPid = lockerPidResult.rows[0]?.pid;
    if (lockerPid === undefined) throw new Error("Native locker returned no backend PID.");
    let released = false;
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT id FROM configurations WHERE id = $1 FOR UPDATE",
        [SNAPSHOT.configurationId],
      );

      // Queue the actual optimistic batch writer first, then freeze. Resolve
      // the Fastify thenables immediately so both requests are dispatched
      // before lock polling rather than remaining lazy until awaited.
      let editSettled = false;
      const editPromise = app.inject({
        method: "POST",
        url: `/configurations/${SNAPSHOT.configurationId}/objects/batch`,
        headers: authHeaders(),
        payload: batchPayload,
      }).then((response) => response).finally(() => { editSettled = true; });
      await waitForConfigurationLockWaiters(observer, lockerPid, "edit");
      expect(editSettled).toBe(false);
      let freezeSettled = false;
      const freezePromise = freezeApp.inject({
        method: "POST",
        url: `/events/${EVENT_ID}/phases/${PHASE_ID}/layout-snapshots`,
        headers: authHeaders(),
        payload: { configurationId: SNAPSHOT.configurationId },
      }).then((response) => response).finally(() => { freezeSettled = true; });
      const freezeBeforeLock = await Promise.race([
        waitForConfigurationLockWaiters(observer, lockerPid, "edit_and_freeze")
          .then(() => null),
        freezePromise.then((response) => response),
      ]);
      if (freezeBeforeLock !== null) {
        throw new Error(
          `Freeze settled before waiting on the configuration lock: ${String(freezeBeforeLock.statusCode)} ${freezeBeforeLock.body}`,
        );
      }
      expect(freezeSettled).toBe(false);
      await locker.query("COMMIT");
      released = true;

      const [editResponse, freezeResponse] = await Promise.all([editPromise, freezePromise]);
      expect(editResponse.statusCode, editResponse.body).toBe(200);
      expect(freezeResponse.statusCode, freezeResponse.body).toBe(409);
      expect(freezeResponse.json()).toEqual({
        error: "The saved plan changed while its phase snapshot was being frozen. Try again.",
        code: "CONFIGURATION_CHANGED_DURING_FREEZE",
      });
    } finally {
      if (!released) await locker.query("ROLLBACK");
      await Promise.all([locker.end(), observer.end()]);
      await freezeApp.close();
    }

    const afterRows = await db.select({ id: phaseLayoutSnapshots.id })
      .from(phaseLayoutSnapshots)
      .where(eq(phaseLayoutSnapshots.eventPhaseId, PHASE_ID));
    expect(afterRows).toHaveLength(beforeRows.length);
  });
});
