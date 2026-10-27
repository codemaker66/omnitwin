import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { configurationReviewRoutes } from "../routes/configuration-reviews.js";
import { configurationRoutes } from "../routes/configurations.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";

// ---------------------------------------------------------------------------
// The review loop on the migrated disposable platform database (release
// audit configs-1, configs-2, configs-6):
//   - a layout the venue sent back (changes requested) or declined
//     (rejected) is edited and submitted again, and approved;
//   - a withdrawn layout is edited and submitted again;
//   - a review move judged from a state another move has since left writes
//     nothing and sends nothing.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const email = vi.hoisted(() => vi.fn<(message: unknown, options: { readonly idempotencyKey?: string }) => void>());
vi.mock("../services/email.js", () => ({ sendEmailAsync: email }));

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Review loop tests require the explicit disposable platform database");
  }
}

type Who = "planner" | "staff" | "hallkeeper";

interface Fixture {
  readonly configId: string;
  readonly venueId: string;
  readonly objectId: string;
  readonly chairId: string;
  readonly users: Readonly<Record<Who, string>>;
}

interface ObjectRow {
  readonly id: string;
  readonly positionX: string;
}

describe.skipIf(target === undefined)("the layout review loop on migrated PostgreSQL", () => {
  const applicationName = `review_loop_${randomUUID()}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 6,
      options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(configurationReviewRoutes, { db, prefix: "/configurations" });
    await server.ready();
  }, 60_000);

  beforeEach(() => { email.mockClear(); });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID(), spaceId = randomUUID(), configId = randomUUID();
    const chairId = randomUUID(), objectId = randomUUID();
    const users = { planner: randomUUID(), staff: randomUUID(), hallkeeper: randomUUID() };
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY review loop venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.users).values([
      { id: users.planner, name: "Planner", email: `${users.planner}@loop.invalid`, role: "planner" },
      { id: users.staff, venueId, name: "Staff", email: `${users.staff}@loop.invalid`, role: "staff" },
      { id: users.hallkeeper, venueId, name: "Hallkeeper", email: `${users.hallkeeper}@loop.invalid`, role: "hallkeeper" },
    ]);
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY chair", category: "chair",
      widthM: "0.5", depthM: "0.5", heightM: "0.9" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId, userId: users.planner,
      name: "TEST ONLY review loop", slug: "loop", layoutStyle: "custom" });
    await db.insert(schema.placedObjects).values({ id: objectId, configurationId: configId, assetDefinitionId: chairId,
      positionX: "2", positionY: "0", positionZ: "2", coordinateWriteToken: randomUUID() });
    return { configId, venueId, objectId, chairId, users };
  }

  function headers(f: Fixture, who: Who): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: f.users[who], email: `${f.users[who]}@loop.invalid`,
      role: who, platformRole: "none", venueId: who === "planner" ? null : f.venueId })}` };
  }

  function review(f: Fixture, who: Who, action: string, payload: Record<string, unknown> = {}): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: `/configurations/${f.configId}/review/${action}`,
      headers: headers(f, who), payload });
  }

  async function expectReview(f: Fixture, who: Who, action: string, payload: Record<string, unknown> = {}): Promise<LightMyRequestResponse> {
    const response = await review(f, who, action, payload);
    expect(response.statusCode, `${action}: ${response.body}`).toBe(200);
    return response;
  }

  async function revision(f: Fixture): Promise<number> {
    const [row] = await db.select({ revision: schema.configurations.revision }).from(schema.configurations)
      .where(eq(schema.configurations.id, f.configId));
    if (row === undefined) throw new Error("The layout is gone");
    return row.revision;
  }

  /** The planner moves the layout's one chair through the editor's batch save. */
  function moveChair(f: Fixture, x: number, expectedRevision: number): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: `/configurations/${f.configId}/objects/batch`, headers: headers(f, "planner"),
      payload: { expectedRevision, objects: [{ id: f.objectId, assetDefinitionId: f.chairId,
        positionX: x, positionY: 0, positionZ: 2, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0 }] } });
  }

  async function state(f: Fixture) {
    const [config] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, f.configId));
    const snapshots = await db.select().from(schema.configurationSheetSnapshots)
      .where(eq(schema.configurationSheetSnapshots.configurationId, f.configId))
      .orderBy(asc(schema.configurationSheetSnapshots.version));
    const history = await db.select().from(schema.configurationReviewHistory)
      .where(eq(schema.configurationReviewHistory.configurationId, f.configId))
      .orderBy(asc(schema.configurationReviewHistory.createdAt));
    const objects: ObjectRow[] = await db.select({ id: schema.placedObjects.id, positionX: schema.placedObjects.positionX })
      .from(schema.placedObjects).where(eq(schema.placedObjects.configurationId, f.configId));
    return { config, snapshots, history: history.map(row => `${row.fromStatus}→${row.toStatus}`), objects };
  }

  /** The idempotency keys of the "submitted" emails sent to the venue so far. */
  function submittedEmailKeys(): string[] {
    return email.mock.calls.flatMap(([, options]) =>
      options.idempotencyKey?.startsWith("config-submitted:") === true ? [options.idempotencyKey] : []);
  }

  async function approvedSheetVersion(f: Fixture): Promise<number | null> {
    const sheet = await assembleSheetDataV2(db, f.configId, "http://127.0.0.1");
    return sheet?.payload.approval?.version ?? null;
  }

  // -------------------------------------------------------------------------
  // configs-1: a layout sent back or declined goes to the venue again
  // -------------------------------------------------------------------------

  it.each([
    ["request-changes", "changes_requested"],
    ["reject", "rejected"],
  ] as const)("a layout the venue answered with %s is edited, submitted again and approved", async (action, returned) => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "staff", "start-review");
    await expectReview(f, "staff", action, { note: "Move the top table back a metre" });
    expect((await state(f)).config?.reviewStatus).toBe(returned);

    // The planner may edit it (the review lock lets them) ...
    const moved = await moveChair(f, 6.5, await revision(f));
    expect(moved.statusCode, moved.body).toBe(200);

    // ... and send it back: a new version, waiting for the venue.
    const resubmitted = await expectReview(f, "planner", "submit");
    expect(resubmitted.json<{ data: { created: boolean; reviewStatus: string; snapshot: { version: number } } }>().data)
      .toMatchObject({ created: true, reviewStatus: "submitted", snapshot: { version: 2 } });
    await expect.poll(() => submittedEmailKeys().length).toBe(2);

    await expectReview(f, "staff", "start-review");
    await expectReview(f, "staff", "approve");

    const saved = await state(f);
    expect(saved.config?.reviewStatus).toBe("approved");
    expect(saved.snapshots.map(row => [row.version, row.approvedAt !== null])).toEqual([[1, false], [2, true]]);
    expect(saved.history).toEqual([
      "draft→submitted", "submitted→under_review", `under_review→${returned}`,
      `${returned}→submitted`, "submitted→under_review", "under_review→approved",
    ]);
    // The hallkeeper's sheet is the version the venue approved, with the move.
    expect(await approvedSheetVersion(f)).toBe(2);
    const frozen = await assembleSheetDataV2(db, f.configId, "http://127.0.0.1");
    expect(frozen?.payload.floorPlan?.objects.map(object => object.x)).toEqual([6.5]);
  });

  it("a layout sent back unchanged goes to the venue again on the version it sent back, and the venue hears of it", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "staff", "start-review");
    await expectReview(f, "staff", "request-changes", { note: "Is the top table where you want it?" });

    const resubmitted = await expectReview(f, "planner", "submit", { note: "Yes, it stays" });
    expect(resubmitted.json<{ data: { created: boolean; reviewStatus: string; snapshot: { version: number }; notificationPolicy: string } }>().data)
      .toMatchObject({ created: false, reviewStatus: "submitted", snapshot: { version: 1 }, notificationPolicy: "team_requested" });
    // A second email to the venue's staff, under its own key, not swallowed
    // as a repeat of the first submission.
    await expect.poll(() => submittedEmailKeys().length).toBe(2);
    expect(new Set(submittedEmailKeys()).size).toBe(2);

    await expectReview(f, "staff", "start-review");
    await expectReview(f, "staff", "approve");
    const saved = await state(f);
    expect(saved.snapshots.map(row => [row.version, row.approvedAt !== null])).toEqual([[1, true]]);
    expect(saved.history.at(3)).toBe("changes_requested→submitted");
    expect(saved.config?.reviewStatus).toBe("approved");
    expect(await approvedSheetVersion(f)).toBe(1);
  });

  it("a draft identical to its latest version stays a draft, as before", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    // A draft holding a snapshot (an older flow's leftover).
    await db.update(schema.configurations).set({ reviewStatus: "draft" }).where(eq(schema.configurations.id, f.configId));
    email.mockClear();
    const again = await expectReview(f, "planner", "submit");
    expect(again.json<{ data: { created: boolean; reviewStatus: string; notificationPolicy: string } }>().data)
      .toMatchObject({ created: false, reviewStatus: "draft", notificationPolicy: "not_sent_no_change" });
    expect((await state(f)).history).toEqual(["draft→submitted"]);
    expect(email).not.toHaveBeenCalled();
  });

  it("only the planner's side may send it again: the hallkeeper may not", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "staff", "start-review");
    await expectReview(f, "staff", "request-changes", { note: "Revise" });
    const refused = await review(f, "hallkeeper", "submit");
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("INVALID_TRANSITION");
    expect((await state(f)).config?.reviewStatus).toBe("changes_requested");
  });

  // -------------------------------------------------------------------------
  // configs-2: a withdrawn layout is the planner's again
  // -------------------------------------------------------------------------

  it("a withdrawn layout is edited, renamed and submitted again as a new version", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "planner", "withdraw");
    expect((await state(f)).config?.reviewStatus).toBe("withdrawn");

    const moved = await moveChair(f, 9.25, await revision(f));
    expect(moved.statusCode, moved.body).toBe(200);
    const renamed = await server.inject({ method: "PATCH", url: `/configurations/${f.configId}`,
      headers: headers(f, "planner"), payload: { name: "TEST ONLY review loop, second go" } });
    expect(renamed.statusCode, renamed.body).toBe(200);

    const available = await server.inject({ method: "GET", url: `/configurations/${f.configId}/review/available-transitions`,
      headers: headers(f, "planner") });
    expect(available.json<{ data: { availableTransitions: string[] } }>().data.availableTransitions).toEqual(["submitted"]);

    const resubmitted = await expectReview(f, "planner", "submit");
    expect(resubmitted.json<{ data: { created: boolean; reviewStatus: string; snapshot: { version: number } } }>().data)
      .toMatchObject({ created: true, reviewStatus: "submitted", snapshot: { version: 2 } });

    const saved = await state(f);
    expect(saved.config).toMatchObject({ reviewStatus: "submitted", name: "TEST ONLY review loop, second go" });
    expect(saved.objects).toEqual([{ id: f.objectId, positionX: "9.250" }]);
    expect(saved.snapshots.map(row => row.version)).toEqual([1, 2]);
    expect(saved.history).toEqual(["draft→submitted", "submitted→withdrawn", "withdrawn→submitted"]);

    // Submitted again, it is locked again until the venue answers.
    const locked = await moveChair(f, 3, await revision(f));
    expect(locked.statusCode).toBe(409);
    expect(locked.json<{ code: string }>().code).toBe("CONFIG_LOCKED");
  });

  it("a layout withdrawn by mistake goes straight back unchanged", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "planner", "withdraw");
    const resubmitted = await expectReview(f, "planner", "submit");
    expect(resubmitted.json<{ data: { created: boolean; reviewStatus: string } }>().data)
      .toMatchObject({ created: false, reviewStatus: "submitted" });
    expect((await state(f)).history).toEqual(["draft→submitted", "submitted→withdrawn", "withdrawn→submitted"]);
  });

  // -------------------------------------------------------------------------
  // configs-6: a move judged from a state another move has left
  // -------------------------------------------------------------------------

  /** A connection of this pool holding a transaction, rolled back at the end whatever happens. */
  async function holding<T>(work: (holder: PoolClient, holderPid: number) => Promise<T>): Promise<T> {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      if (pid === undefined) throw new Error("The holder has no backend");
      return await work(holder, pid);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }

  /** Waits until a session of this pool is waiting on a lock the holder holds. */
  async function blockedBy(holder: PoolClient, holderPid: number): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      await holder.query("SELECT pg_stat_clear_snapshot()");
      const { rows } = await holder.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
          WHERE application_name = $1 AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))`,
        [applicationName, holderPid],
      );
      if (rows.length === 1) return;
      if (rows.length > 1) throw new Error("More than one session waited on the holder");
      if (attempt >= 400) throw new Error("No review move ever waited on the holder");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it.each([
    { action: "reject", who: "staff", from: "under_review", winner: "approved", payload: { note: "Not this one" } },
    { action: "request-changes", who: "staff", from: "under_review", winner: "approved", payload: { note: "Revise" } },
    { action: "withdraw", who: "planner", from: "under_review", winner: "approved", payload: {} },
    { action: "start-review", who: "staff", from: "submitted", winner: "withdrawn", payload: {} },
  ] as const)("$action judged from $from loses to a move to $winner committed first, writing nothing", async ({ action, who, from, winner, payload }) => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    if (from === "under_review") await expectReview(f, "staff", "start-review");
    const before = await state(f);
    expect(before.config?.reviewStatus).toBe(from);
    email.mockClear();

    const response = await holding(async (holder, holderPid) => {
      // The winning move, as its route writes it, still uncommitted.
      await holder.query("UPDATE configurations SET review_status = $2, updated_at = now() WHERE id = $1", [f.configId, winner]);
      await holder.query(
        `INSERT INTO configuration_review_history (configuration_id, from_status, to_status, changed_by)
         VALUES ($1, $2, $3, $4)`, [f.configId, from, winner, f.users.staff]);
      // The losing move reads the review as it was, then waits at its write.
      const pending = review(f, who, action, payload);
      await blockedBy(holder, holderPid);
      await holder.query("COMMIT");
      return pending;
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<{ code: string; currentStatus: string }>()).toMatchObject({ code: "INVALID_TRANSITION", currentStatus: winner });
    const after = await state(f);
    expect(after.config?.reviewStatus).toBe(winner);
    expect(after.history).toEqual([...before.history, `${from}→${winner}`]);
    // Nothing of the losing move's own: no email went out for it.
    expect(email).not.toHaveBeenCalled();
  });

  it("a reject that meets the real approve committed first leaves the approved sheet in force", async () => {
    const f = await fixture();
    await expectReview(f, "planner", "submit");
    await expectReview(f, "staff", "start-review");
    const response = await holding(async (holder, holderPid) => {
      // The approve's own writes: the snapshot, the layout's mirror, its history.
      await holder.query("UPDATE configuration_sheet_snapshots SET approved_at = now(), approved_by = $2 WHERE configuration_id = $1 AND version = 1",
        [f.configId, f.users.staff]);
      await holder.query("UPDATE configurations SET review_status = 'approved', approved_at = now(), approved_by = $2 WHERE id = $1",
        [f.configId, f.users.staff]);
      await holder.query(
        `INSERT INTO configuration_review_history (configuration_id, from_status, to_status, changed_by)
         VALUES ($1, 'under_review', 'approved', $2)`, [f.configId, f.users.staff]);
      const pending = review(f, "staff", "reject", { note: "Too late" });
      await blockedBy(holder, holderPid);
      await holder.query("COMMIT");
      return pending;
    });
    expect(response.statusCode, response.body).toBe(409);
    expect((await state(f)).config?.reviewStatus).toBe("approved");
    expect(await approvedSheetVersion(f)).toBe(1);
  });
});
