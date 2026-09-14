import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { configurations, events, eventMissions, opsTasks } from "../db/schema.js";
import * as schema from "../db/schema.js";
import { eventRoutes } from "../routes/events.js";
import { eventDayEventRoutes, eventDayOpsTaskRoutes } from "../routes/event-day-ops.js";
import { eventPlanLifecycleRoutes } from "../routes/event-plan-lifecycle.js";
import { eventMissionEventRoutes, eventMissionRoutes } from "../routes/event-mission-control.js";
import { opsHandoffRoutes } from "../routes/ops-handoff.js";
import { eventRevenueRoutes } from "../routes/revenue-analytics.js";

vi.mock("../services/ops-compiler.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/ops-compiler.js")>(),
  getOpsHandoffPackBundle: vi.fn(() => Promise.resolve({ pack: { id: TASK_ID, configId: ISSUE_ID, eventId: packEventId } })),
}));

process.env["NODE_ENV"] = "test";

const VENUE_ID = "00000000-0000-4000-8000-000000008001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000008002";
const EVENT_ID = "00000000-0000-4000-8000-000000008003";
const CREATOR_ID = "00000000-0000-4000-8000-000000008004";
const TASK_ID = "00000000-0000-4000-8000-000000008005";
const ISSUE_ID = "00000000-0000-4000-8000-000000008006";
const MISSION_ID = "00000000-0000-4000-8000-000000008007";
let packEventId: string | null = EVENT_ID;
const event = {
  id: EVENT_ID, venueId: VENUE_ID, createdBy: CREATOR_ID,
  name: "Internal event", eventType: null, status: "draft", startsAt: null,
  endsAt: null, guestCount: 20, clientName: null, notes: "Internal briefing",
  createdAt: new Date("2026-09-14T00:00:00Z"), updatedAt: new Date("2026-09-14T00:00:00Z"), deletedAt: null,
};

// Supply an existing persisted scope to the real HTTP handlers. Mutations
// deliberately throw: a refused request must never reach a write boundary.
const write = vi.fn(() => { throw new Error("Unexpected write after permission check"); });
function select() {
  let table: unknown;
  const rows = (): unknown[] => {
    if (table === events) return [event];
    if (table === opsTasks) return [{ venueId: VENUE_ID, createdBy: CREATOR_ID }];
    if (table === configurations) return [{ venueId: VENUE_ID, userId: CREATOR_ID }];
    if (table === eventMissions) return [{ event, mission: { id: MISSION_ID, eventId: EVENT_ID, venueId: VENUE_ID } }];
    return [];
  };
  const query = {
    from(value: unknown) { table = value; return query; },
    where() { return query; },
    innerJoin() { return query; },
    leftJoin() { return query; },
    orderBy() { return query; },
    limit() { return Promise.resolve(rows()); },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(rows()).then(resolve, reject);
    },
  };
  return query;
}
const db: Database = Object.assign(drizzle.mock({ schema }), {
  select, insert: write, update: write, delete: write, transaction: write,
});
let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify();
  await server.register(eventRoutes, { db, prefix: "/events" });
  await server.register(eventDayEventRoutes, { db, prefix: "/events" });
  await server.register(eventDayOpsTaskRoutes, { db, prefix: "/ops-tasks" });
  await server.register(eventPlanLifecycleRoutes, { db, prefix: "/events" });
  await server.register(eventMissionEventRoutes, { db, prefix: "/events" });
  await server.register(eventMissionRoutes, { db, prefix: "/event-missions" });
  await server.register(opsHandoffRoutes, { db, prefix: "/ops" });
  await server.register(eventRevenueRoutes, { db, prefix: "/events" });
  await server.ready();
});
afterAll(async () => { await server.close(); });
beforeEach(() => { write.mockClear(); packEventId = EVENT_ID; });

const internalReads = [
  [`/events/${EVENT_ID}`, 403],
  [`/events/${EVENT_ID}/phase-graph`, 403],
  [`/events/${EVENT_ID}/ops-board`, 403],
  [`/events/${EVENT_ID}/changes-since-last-handoff`, 403],
  [`/events/${EVENT_ID}/change-feed`, 403],
  [`/events/${EVENT_ID}/revenue-summary`, 403],
  [`/ops/handoff-packs/${TASK_ID}`, 403],
  [`/events/${EVENT_ID}/mission`, 404],
  [`/event-missions/${MISSION_ID}/timeline`, 404],
  [`/event-missions/${MISSION_ID}/replay`, 404],
] as const;

function token(role: string, venueId: string | null, platformRole = "none") {
  return `Bearer ${JSON.stringify({ id: CREATOR_ID, email: "creator@test.invalid", role, venueId, platformRole })}`;
}

describe("current authority for internal event routes", () => {
  for (const actor of [
    { label: "creator changed to client", role: "client", venueId: VENUE_ID },
    { label: "creator changed to planner", role: "planner", venueId: VENUE_ID },
    { label: "creator moved to another venue", role: "staff", venueId: OTHER_VENUE_ID },
    { label: "creator venue removed", role: "admin", venueId: null },
  ]) {
    describe(actor.label, () => {
      it.each(internalReads)("refuses %s", async (url, status) => {
        const response = await server.inject({ method: "GET", url, headers: { authorization: token(actor.role, actor.venueId) } });
        expect(response.statusCode, response.body).toBe(status);
        expect(write).not.toHaveBeenCalled();
      });

      it("refuses issue creation, issue changes, and task changes before writing", async () => {
        for (const operation of [
          { method: "POST", url: `/events/${EVENT_ID}/issues`, payload: { title: "Water refill", detail: "Refill water at table one.", severity: "info" } },
          { method: "PATCH", url: `/events/${EVENT_ID}/issues/${ISSUE_ID}`, payload: { status: "resolved" } },
          { method: "PATCH", url: `/ops-tasks/${TASK_ID}/status`, payload: { status: "done", idempotencyKey: "refused-task-change" } },
          { method: "POST", url: `/ops/handoff-packs/from-configuration/${ISSUE_ID}`, payload: { eventId: EVENT_ID } },
        ] as const) {
          const response = await server.inject({ ...operation, headers: { authorization: token(actor.role, actor.venueId) } });
          expect(response.statusCode, response.body).toBe(403);
          expect(write).not.toHaveBeenCalled();
        }
      });
    });
  }

  it.each(["staff", "hallkeeper", "admin"])("retains current same-venue %s event access", async (role) => {
    const response = await server.inject({ method: "GET", url: `/events/${EVENT_ID}`, headers: { authorization: token(role, VENUE_ID) } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: EVENT_ID, notes: "Internal briefing" } });
  });

  it("retains explicit platform administration independent of assigned venue", async () => {
    const response = await server.inject({ method: "GET", url: `/events/${EVENT_ID}`, headers: { authorization: token("admin", null, "admin") } });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("preserves a customer's owned standalone configuration handoff", async () => {
    packEventId = null;
    const response = await server.inject({ method: "GET", url: `/ops/handoff-packs/${TASK_ID}`, headers: { authorization: token("client", null) } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ data: { pack: { eventId: null } } });
  });
});
