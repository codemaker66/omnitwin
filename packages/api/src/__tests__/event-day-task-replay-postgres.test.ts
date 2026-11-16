import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eventDayOpsTaskRoutes } from "../routes/event-day-ops.js";

// ---------------------------------------------------------------------------
// A task status queued on the event-day board and replayed later (#418, the
// review round of 16 November).
//
// A status pressed while the tablet is offline is kept on the device and sent
// again when the connection returns. By then a later press (on this tablet
// after a reload, on another tab, on another device) may have landed, and the
// stale replay must not undo it. The page cannot know that after a reload, so
// the replay now carries the status the task held when it was pressed, and
// the service writes it only while the task still holds that status;
// otherwise it answers 409 with the task as it stands, and writes nothing.
//
// The comparison and the write must be one decision: these cases run the real
// route and service against real rows, and two replays meet at the row's lock
// on two connections, which a check made before the write would let both pass.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Event-day replay tests require the explicit disposable platform database");
  }
}

type Status = "todo" | "in_progress" | "done" | "blocked" | "waived";

interface StatusBody {
  readonly status: Status;
  readonly idempotencyKey?: string;
  readonly expectedStatus?: string;
}

interface Answer {
  readonly statusCode: number;
  readonly body: {
    readonly data?: { readonly status: Status; readonly updatedAt: string };
    readonly error?: string;
    readonly code?: string;
    readonly details?: unknown;
  };
}

/** Everything a status write leaves behind for one task and its event. */
interface Recorded {
  readonly status: string;
  readonly updatedAt: string;
  readonly completions: readonly { readonly fromStatus: string; readonly toStatus: string; readonly idempotencyKey: string | null }[];
  readonly statusUpdates: number;
  readonly planChanges: number;
  readonly notifications: number;
}

describe.skipIf(target === undefined)("a queued task status replayed on the migrated disposable database", () => {
  let pool: Pool;
  let lockPool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const applicationName = `event_day_replay_${randomUUID()}`;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const configId = randomUUID();
  const hallkeeperId = randomUUID();
  let sheetVersion = 0;

  const auth = {
    authorization: `Bearer ${JSON.stringify({ id: hallkeeperId, email: `${hallkeeperId}@replay.invalid`, role: "hallkeeper", platformRole: "none", venueId })}`,
  };

  /** A task of its own, To do, on an event of its own, so every count below is this task's. */
  async function newTask(): Promise<{ readonly taskId: string; readonly eventId: string }> {
    const eventId = randomUUID();
    const sheetId = randomUUID();
    const packId = randomUUID();
    const taskId = randomUUID();
    sheetVersion += 1;
    await db.insert(schema.events).values({
      id: eventId, venueId, createdBy: hallkeeperId, name: "TEST ONLY replay dinner", guestCount: 80,
      startsAt: new Date("2026-11-16T18:00:00Z"), endsAt: new Date("2026-11-16T23:00:00Z"),
    });
    await db.insert(schema.configurationSheetSnapshots).values({
      id: sheetId, configurationId: configId, version: sheetVersion, payload: {}, sourceHash: "c".repeat(64),
    });
    await db.insert(schema.handoffPacks).values({
      id: packId, eventId, configId, snapshotId: sheetId, snapshotHash: "c".repeat(64),
      sourceLabel: "TEST ONLY approved plan", summary: "TEST ONLY pack",
    });
    await db.insert(schema.opsTasks).values({
      id: taskId, handoffPackId: packId, kind: "setup", title: "TEST ONLY set 12 rounds", detail: "TEST ONLY place in the centre.",
    });
    return { taskId, eventId };
  }

  async function send(taskId: string, body: StatusBody): Promise<Answer> {
    const response = await server.inject({ method: "PATCH", url: `/ops-tasks/${taskId}/status`, headers: auth, payload: body });
    return { statusCode: response.statusCode, body: response.json<Answer["body"]>() };
  }

  async function recorded(taskId: string, eventId: string): Promise<Recorded> {
    const [task] = await db.select().from(schema.opsTasks).where(eq(schema.opsTasks.id, taskId));
    if (task === undefined) throw new Error("task fixture missing");
    const completions = await db.select({
      fromStatus: schema.taskCompletionEvents.fromStatus,
      toStatus: schema.taskCompletionEvents.toStatus,
      idempotencyKey: schema.taskCompletionEvents.idempotencyKey,
    }).from(schema.taskCompletionEvents)
      .where(eq(schema.taskCompletionEvents.opsTaskId, taskId))
      .orderBy(asc(schema.taskCompletionEvents.createdAt));
    const [updates] = await db.select({ n: count() }).from(schema.opsStatusUpdates).where(eq(schema.opsStatusUpdates.eventId, eventId));
    const [changes] = await db.select({ n: count() }).from(schema.eventPlanChanges).where(eq(schema.eventPlanChanges.eventId, eventId));
    const [notices] = await db.select({ n: count() }).from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.eventId, eventId));
    return {
      status: task.status,
      updatedAt: task.updatedAt.toISOString(),
      completions,
      statusUpdates: updates?.n ?? -1,
      planChanges: changes?.n ?? -1,
      notifications: notices?.n ?? -1,
    };
  }

  /** The task as the API serves it (OpsTaskSchema), read from its row. */
  async function taskAsServed(taskId: string): Promise<Record<string, unknown>> {
    const [row] = await db.select().from(schema.opsTasks).where(eq(schema.opsTasks.id, taskId));
    if (row === undefined) throw new Error("task fixture missing");
    return {
      id: row.id, handoffPackId: row.handoffPackId, taskGroupId: row.taskGroupId, phaseId: row.phaseId,
      kind: row.kind, title: row.title, detail: row.detail, status: row.status, sortOrder: row.sortOrder,
      dueLabel: row.dueLabel, sourceRef: row.sourceRef,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Waits until this many of the route's connections are queued on a lock. */
  async function lockWaiters(expected: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const result = await lockPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      );
      if ((result.rows[0]?.n ?? 0) >= expected) return;
      if (Date.now() > deadline) throw new Error(`Fewer than ${String(expected)} replays reached the row lock`);
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    lockPool = new Pool({ connectionString: target, application_name: `${applicationName}_lock`, max: 2,
      options: "-c statement_timeout=15000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY replay venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.users).values({ id: hallkeeperId, name: "TEST ONLY hallkeeper", email: `${hallkeeperId}@replay.invalid`, role: "hallkeeper", venueId });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "TEST ONLY hall", slug: spaceId, widthM: "10", lengthM: "21", heightM: "8",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 21 }, { x: 0, y: 21 }] });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId, name: "TEST ONLY replay layout", layoutStyle: "dinner-rounds" });
    server = Fastify();
    await server.register(eventDayOpsTaskRoutes, { db, prefix: "/ops-tasks" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await lockPool?.end();
    await pool?.end();
  });

  it("refuses a replay pressed against a status the task has since left, answers with the task as it stands, and writes nothing", async () => {
    const { taskId, eventId } = await newTask();
    // Done is pressed and lands.
    expect((await send(taskId, { status: "done", idempotencyKey: `done-${taskId}` })).statusCode).toBe(200);
    const before = await recorded(taskId, eventId);
    expect(before.status).toBe("done");

    // Start was pressed earlier, while the task showed To do; it was queued and replays now.
    const replay = await send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}`, expectedStatus: "todo" });

    expect(replay.statusCode).toBe(409);
    expect(replay.body).toEqual({
      error: "This task moved on before this status arrived.",
      code: "TASK_STATUS_CONFLICT",
      details: { task: await taskAsServed(taskId) },
    });
    // No status, time, completion event, recorded key, board line, plan change or notice.
    expect(await recorded(taskId, eventId)).toEqual(before);
  });

  it("applies a replay while the task still holds the status it was pressed against", async () => {
    const { taskId, eventId } = await newTask();

    const replay = await send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}`, expectedStatus: "todo" });

    expect(replay.statusCode).toBe(200);
    expect(replay.body.data?.status).toBe("in_progress");
    const after = await recorded(taskId, eventId);
    expect(after.status).toBe("in_progress");
    expect(after.completions).toEqual([{ fromStatus: "todo", toStatus: "in_progress", idempotencyKey: `start-${taskId}` }]);
    expect(after.statusUpdates).toBe(1);
    expect(after.planChanges).toBe(1);
    expect(after.notifications).toBe(2);
  });

  it("answers a key it has already recorded with its recorded answer, although the task has moved since", async () => {
    const { taskId, eventId } = await newTask();
    expect((await send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}`, expectedStatus: "todo" })).statusCode).toBe(200);
    expect((await send(taskId, { status: "done", idempotencyKey: `done-${taskId}` })).statusCode).toBe(200);
    const before = await recorded(taskId, eventId);

    // Start's answer was lost on the way back, so the device sends it again.
    const again = await send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}`, expectedStatus: "todo" });

    expect(again.statusCode).toBe(200);
    expect(again.body.data?.status).toBe("done");
    expect(await recorded(taskId, eventId)).toEqual(before);
  });

  it("applies a status sent without one as it always has: a live press, or a row queued before replays carried it", async () => {
    const { taskId, eventId } = await newTask();
    expect((await send(taskId, { status: "done", idempotencyKey: `done-${taskId}` })).statusCode).toBe(200);

    const live = await send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}` });
    expect(live.statusCode).toBe(200);
    expect(live.body.data?.status).toBe("in_progress");
    // And a status the task already holds changes nothing, as before.
    const before = await recorded(taskId, eventId);
    expect((await send(taskId, { status: "in_progress", idempotencyKey: `again-${taskId}` })).statusCode).toBe(200);
    expect(await recorded(taskId, eventId)).toEqual(before);
    expect(before.completions.map((row) => row.toStatus)).toEqual(["done", "in_progress"]);
  });

  it("refuses a status it does not know as the one a replay was pressed against", async () => {
    const { taskId, eventId } = await newTask();
    const before = await recorded(taskId, eventId);
    const answer = await send(taskId, { status: "done", idempotencyKey: `done-${taskId}`, expectedStatus: "fire approved" });
    expect(answer.statusCode).toBe(400);
    expect(await recorded(taskId, eventId)).toEqual(before);
  });

  it("lets exactly one of two replays that expect the same status write, when they reach the row at the same moment", async () => {
    const { taskId, eventId } = await newTask();
    const holder = await lockPool.connect();
    let committed = false;
    try {
      // Hold the task's row so both replays get past every read and meet at
      // the write, each on a connection of its own.
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM ops_tasks WHERE id = $1 FOR UPDATE", [taskId]);
      const start = send(taskId, { status: "in_progress", idempotencyKey: `start-${taskId}`, expectedStatus: "todo" });
      const done = send(taskId, { status: "done", idempotencyKey: `done-${taskId}`, expectedStatus: "todo" });
      await lockWaiters(2);
      await holder.query("COMMIT");
      committed = true;
      const answers = await Promise.all([start, done]);

      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);
      const applied = answers.find((answer) => answer.statusCode === 200);
      const refused = answers.find((answer) => answer.statusCode === 409);
      const winner = applied?.body.data?.status;
      expect(winner === "in_progress" || winner === "done").toBe(true);
      expect(refused?.body.code).toBe("TASK_STATUS_CONFLICT");
      expect(refused?.body.details).toEqual({ task: await taskAsServed(taskId) });
      const after = await recorded(taskId, eventId);
      expect(after.status).toBe(winner);
      expect(after.completions).toEqual([{
        fromStatus: "todo",
        toStatus: winner,
        idempotencyKey: winner === "done" ? `done-${taskId}` : `start-${taskId}`,
      }]);
      expect(after.statusUpdates).toBe(1);
      expect(after.planChanges).toBe(1);
    } finally {
      if (!committed) await holder.query("ROLLBACK");
      holder.release();
    }
  }, 30000);
});
