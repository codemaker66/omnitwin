import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMissionBaselineSchema, eventMissionBaselineHash } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { pruneSnapshotsForConfig } from "../services/sheet-snapshot.js";

// Explicitly owned, fully migrated local database only; never load .env.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Snapshot retention tests require the disposable platform database");
  }
}

describe.skipIf(target === undefined)("snapshot retention with durable PostgreSQL references", () => {
  let pool: Pool;
  let observer: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const applicationName = `snapshot-retention-${randomUUID()}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 3 });
    observer = new Pool({ connectionString: target, application_name: `${applicationName}-observer`, max: 2 });
    expect((await observer.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
  });
  afterAll(async () => { await pool?.end(); await observer?.end(); });

  async function fixture() {
    const venueId = randomUUID(), actorId = randomUUID(), roomId = randomUUID();
    const configId = randomUUID(), eventId = randomUUID();
    const at = new Date("2031-09-06T08:00:00Z");
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic retention venue", slug: venueId, address: "Test only" });
    await db.insert(schema.users).values({ id: actorId, venueId, name: "Retention admin", email: `${actorId}@retention.test`, role: "admin" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Retention room", slug: roomId,
      widthM: "30", lengthM: "30", heightM: "7",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId,
      userId: actorId, name: "Synthetic retained plan", slug: configId, layoutStyle: "custom",
      visibility: "private", reviewStatus: "archived" });
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: actorId, name: "Synthetic completed event" });
    const snapshots = await db.insert(schema.configurationSheetSnapshots).values(
      Array.from({ length: 9 }, (_, index) => ({ id: randomUUID(), configurationId: configId, version: index + 1,
        // This test exercises retention/FKs, not sheet hydration. The payload
        // is deliberately minimal and its exact bytes must survive pruning.
        payload: { retentionFixtureVersion: index + 1 }, sourceHash: (index + 1).toString(16).padStart(64, "0"),
        createdBy: actorId, approvedAt: [1, 2, 3, 4, 6].includes(index + 1) ? at : null,
        approvedBy: [1, 2, 3, 4, 6].includes(index + 1) ? actorId : null,
      })),
    ).returning();
    const snapshot = (version: number) => {
      const row = snapshots.find(value => value.version === version);
      if (row === undefined) throw new Error("Fixture snapshot missing");
      return row;
    };
    return { venueId, actorId, roomId, configId, eventId, at, snapshot };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function handoff(f: Fixture, version: number) {
    const source = f.snapshot(version);
    const [pack] = await db.insert(schema.handoffPacks).values({ id: randomUUID(), eventId: f.eventId,
      configId: f.configId, snapshotId: source.id, snapshotHash: source.sourceHash, version: 1,
      status: "compiled", sourceLabel: "Synthetic archived handoff", summary: "Retain historical evidence", createdBy: f.actorId }).returning();
    if (pack === undefined) throw new Error("Fixture handoff missing");
    return pack;
  }
  async function versions(f: Fixture) {
    const rows = await db.select().from(schema.configurationSheetSnapshots)
      .where(eq(schema.configurationSheetSnapshots.configurationId, f.configId));
    return rows.map(row => row.version).sort((left, right) => left - right);
  }

  it("retains every old operational handoff and its BEO while pruning unreferenced history", async () => {
    const f = await fixture();
    const pack = await handoff(f, 1);
    const [beo] = await db.insert(schema.beoDocuments).values({ handoffPackId: pack.id, title: "Frozen BEO",
      body: "Exact historic staff instructions", sourceSnapshotHash: f.snapshot(1).sourceHash }).returning();
    const source = f.snapshot(1);
    expect(await pruneSnapshotsForConfig(db, f.configId)).toEqual({ deleted: 4, kept: 5 });
    expect(await versions(f)).toEqual([1, 6, 7, 8, 9]);
    expect(await db.select().from(schema.handoffPacks).where(eq(schema.handoffPacks.id, pack.id))).toEqual([pack]);
    expect(await db.select().from(schema.beoDocuments).where(eq(schema.beoDocuments.handoffPackId, pack.id))).toEqual([beo]);
    expect(await db.select().from(schema.configurationSheetSnapshots).where(eq(schema.configurationSheetSnapshots.id, source.id))).toEqual([source]);
    expect(await pruneSnapshotsForConfig(db, f.configId)).toEqual({ deleted: 0, kept: 5 });
  });

  it("retains old evidence packs even when marked stale", async () => {
    const f = await fixture();
    const source = f.snapshot(2);
    const [pack] = await db.insert(schema.evidencePacks).values({ configId: f.configId, snapshotId: source.id,
      snapshotHash: source.sourceHash, payloadHash: "e".repeat(64), status: "stale", payload: { oldEvidence: "preserved" },
      generatedBy: f.actorId, staleAt: f.at }).returning();
    expect(await pruneSnapshotsForConfig(db, f.configId)).toEqual({ deleted: 4, kept: 5 });
    expect(await versions(f)).toEqual([2, 6, 7, 8, 9]);
    expect(await db.select().from(schema.evidencePacks).where(eq(schema.evidencePacks.snapshotId, source.id))).toEqual([pack]);
  });

  it("preserves the source of a historical handoff diff without retaining matching hashes in another config", async () => {
    const f = await fixture();
    const other = await fixture();
    const pack = await handoff(f, 6);
    await db.insert(schema.snapshotDiffs).values({ handoffPackId: pack.id, previousSnapshotHash: f.snapshot(3).sourceHash,
      currentSnapshotHash: f.snapshot(6).sourceHash, changedCount: 1, summary: "Historic change",
      payload: { added: [], removed: [], changed: ["Chair: 150 -> 180"] } });
    expect(await pruneSnapshotsForConfig(db, f.configId)).toEqual({ deleted: 4, kept: 5 });
    expect(await versions(f)).toEqual([3, 6, 7, 8, 9]);
    expect(await pruneSnapshotsForConfig(db, other.configId)).toEqual({ deleted: 5, kept: 4 });
    expect(await versions(other)).toEqual([6, 7, 8, 9]);
  });

  it("keeps a completed mission's baseline snapshot and still removes unrelated drafts", async () => {
    const f = await fixture();
    const pack = await handoff(f, 1);
    const missionId = randomUUID();
    const baseline = EventMissionBaselineSchema.parse({ schemaVersion: "venviewer.event-mission.v0", missionId,
      eventId: f.eventId, venueId: f.venueId, handoffPackId: pack.id, sourceSnapshotHash: pack.snapshotHash,
      missionStatus: "live", startedAt: f.at.toISOString(), phases: [], tasks: [] });
    const [mission] = await db.insert(schema.eventMissions).values({ id: missionId, eventId: f.eventId,
      venueId: f.venueId, handoffPackId: pack.id, sourceSnapshotHash: pack.snapshotHash,
      status: "completed", baseline, baselineHash: eventMissionBaselineHash(baseline), createdBy: f.actorId,
      startedAt: f.at, completedAt: new Date(f.at.getTime() + 3600_000) }).returning();
    expect(await pruneSnapshotsForConfig(db, f.configId)).toEqual({ deleted: 4, kept: 5 });
    expect(await versions(f)).toEqual([1, 6, 7, 8, 9]);
    expect(await db.select().from(schema.eventMissions).where(eq(schema.eventMissions.id, missionId))).toEqual([mission]);
  });

  it("observes a concurrently committing handoff before deciding its source can be deleted", async () => {
    const f = await fixture();
    const source = f.snapshot(1);
    const packId = randomUUID();
    const writer = await observer.connect();
    let pruning: ReturnType<typeof pruneSnapshotsForConfig> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(`INSERT INTO handoff_packs
        (id,event_id,config_id,snapshot_id,snapshot_hash,source_label,summary,created_by)
        VALUES ($1,$2,$3,$4,$5,'Concurrent fixture','Uncommitted frozen handoff',$6)`,
      [packId, f.eventId, f.configId, source.id, source.sourceHash, f.actorId]);
      pruning = pruneSnapshotsForConfig(db, f.configId);
      await expect.poll(async () => {
        await writer.query("SELECT pg_stat_clear_snapshot()");
        const result = await writer.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [applicationName]);
        return result.rows[0]?.count;
      }, { timeout: 5000 }).toBe(1);
      await writer.query("COMMIT");
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
    expect(await pruning).toEqual({ deleted: 4, kept: 5 });
    expect(await versions(f)).toEqual([1, 6, 7, 8, 9]);
    expect(await db.select({ id: schema.handoffPacks.id }).from(schema.handoffPacks)
      .where(eq(schema.handoffPacks.id, packId))).toEqual([{ id: packId }]);
  });
});
