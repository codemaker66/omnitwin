import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  FreezePhaseLayoutSnapshotResponseSchema,
  RoomLayoutTimelineResponseSchema,
  canonicalLayoutSnapshotDigest,
  runLayoutValidator,
} from "@omnitwin/types";
import { createDb, type Database } from "../db/client.js";
import {
  assetDefinitions,
  canonicalLayoutSnapshots,
  configurations,
  eventPhases,
  events,
  layoutValidationRuns,
  phaseLayoutSnapshots,
  placedObjects,
  spaces,
  users,
  venues,
} from "../db/schema.js";

const RUN_ENABLED = process.env["RUN_PHASE_LAYOUT_POSTGRES"] === "1";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const SAFE_DATABASE_PREFIX = "omnitwin_timeline_0060_";

function isSafeDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.slice(1);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && parsed.port === "54329"
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
const CANONICAL_SNAPSHOT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VALIDATION_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT_ARCHITECT_CANDIDATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_START = new Date("2026-06-07T19:30:00.000Z");

const FreezeEnvelopeSchema = z.object({
  data: FreezePhaseLayoutSnapshotResponseSchema,
}).strict();
const TimelineEnvelopeSchema = z.object({
  data: RoomLayoutTimelineResponseSchema,
}).strict();

let server: FastifyInstance | null = null;
let database: Database | null = null;

function requiredServer(): FastifyInstance {
  if (server === null) throw new Error("Integration server is not available.");
  return server;
}

function requiredDatabase(): Database {
  if (database === null) throw new Error("Integration database is not available.");
  return database;
}

function fixed(value: number, precision: number): string {
  const factor = 10 ** precision;
  return (Math.round(value * factor) / factor).toFixed(precision);
}

function authHeaders(): { readonly authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: ACTOR_ID,
      email: "timeline-rehearsal@integration.test",
      name: "Timeline Rehearsal",
      role: "staff",
      platformRole: "none",
      venueId: SNAPSHOT.venueId,
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

async function seedFixture(db: Database): Promise<void> {
  await db.insert(venues).values({
    id: SNAPSHOT.venueId,
    name: "Trades Hall Glasgow",
    slug: SNAPSHOT.venueRuntime.venueSlug,
    address: "85 Glassford Street, Glasgow",
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

describe.runIf(RUN_ENABLED)("phase layout PostgreSQL rehearsal", () => {
  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    database = createDb(DATABASE_URL);
    await seedFixture(database);
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 60_000);

  afterAll(async () => {
    if (server !== null) await server.close();
  });

  it("has the exact 0060 migration catalog entry", async () => {
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
        ) AS indexes
    `);
    expect(catalog.rows[0]).toEqual({
      lineageColumns: 4,
      restrictiveForeignKeys: 4,
      checks: 2,
      indexes: 2,
    });
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
  });

  it("enforces restrictive lineage references at runtime", async () => {
    const db = requiredDatabase();
    await expectForeignKeyViolation(
      () => db.transaction(async (tx) => {
        await tx.update(configurations).set({ userId: null }).where(
          eq(configurations.id, SNAPSHOT.configurationId),
        );
        await tx.update(events).set({ createdBy: null }).where(eq(events.id, EVENT_ID));
        await tx.update(canonicalLayoutSnapshots).set({ createdBy: null }).where(eq(
          canonicalLayoutSnapshots.id,
          CANONICAL_SNAPSHOT_ID,
        ));
        await tx.delete(users).where(eq(users.id, ACTOR_ID));
      }),
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
});
