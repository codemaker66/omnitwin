import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { getTableColumns, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "../db/client.js";
import {
  eventMissionAcknowledgements,
  eventMissionEvents,
  eventMissionIncidents,
  eventMissionPhases,
  eventMissionSessions,
  eventMissionTasks,
  eventMissions,
} from "../db/schema.js";
import { eventMissionEventRoutes, eventMissionRoutes } from "../routes/event-mission-control.js";
import {
  canTransitionEventMission,
  canTransitionEventMissionIncident,
  canTransitionEventMissionPhase,
  canTransitionEventMissionTask,
} from "../state-machines/event-mission.js";

process.env["NODE_ENV"] = "test";

const EVENT_ID = "00000000-0000-4000-8000-000000020001";
const MISSION_ID = "00000000-0000-4000-8000-000000020002";
const PHASE_ID = "00000000-0000-4000-8000-000000020003";

function staffToken(): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000020004",
    email: "staff@test.invalid",
    name: "Test staff",
    role: "staff",
    platformRole: "none",
    venueId: "00000000-0000-4000-8000-000000020005",
  });
}

function plannerToken(): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000020099",
    email: "planner@test.invalid",
    name: "Outside planner",
    role: "planner",
    platformRole: "none",
    venueId: "00000000-0000-4000-8000-000000020098",
  });
}

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify();
  const unreachableDb = {} as Database;
  await server.register(eventMissionEventRoutes, { db: unreachableDb, prefix: "/events" });
  await server.register(eventMissionRoutes, { db: unreachableDb, prefix: "/event-missions" });
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe("event mission state machines", () => {
  it("pins terminal mission and phase transitions", () => {
    expect(canTransitionEventMission("live", "completed")).toBe(true);
    expect(canTransitionEventMission("completed", "live")).toBe(false);
    expect(canTransitionEventMissionPhase("pending", "active")).toBe(true);
    expect(canTransitionEventMissionPhase("active", "completed")).toBe(true);
    expect(canTransitionEventMissionPhase("completed", "active")).toBe(false);
    expect(canTransitionEventMissionPhase("skipped", "active")).toBe(false);
  });

  it("allows operational recovery without silently reopening terminal work", () => {
    expect(canTransitionEventMissionTask("todo", "blocked")).toBe(true);
    expect(canTransitionEventMissionTask("blocked", "in_progress")).toBe(true);
    expect(canTransitionEventMissionTask("done", "in_progress")).toBe(false);
    expect(canTransitionEventMissionIncident("resolved", "open")).toBe(true);
    expect(canTransitionEventMissionIncident("closed", "open")).toBe(false);
  });

  it("makes mission completion and cancellation terminal", () => {
    expect(canTransitionEventMission("live", "completed")).toBe(true);
    expect(canTransitionEventMission("live", "cancelled")).toBe(true);
    expect(canTransitionEventMission("completed", "cancelled")).toBe(false);
    expect(canTransitionEventMission("cancelled", "completed")).toBe(false);
  });
});

describe("event mission persistence contract", () => {
  it("exports every mission projection, event, acknowledgement, and presence table", () => {
    expect([
      eventMissions,
      eventMissionPhases,
      eventMissionTasks,
      eventMissionIncidents,
      eventMissionEvents,
      eventMissionAcknowledgements,
      eventMissionSessions,
    ].map(getTableName)).toEqual([
      "event_missions",
      "event_mission_phases",
      "event_mission_tasks",
      "event_mission_incidents",
      "event_mission_events",
      "event_mission_acknowledgements",
      "event_mission_sessions",
    ]);
    expect(getTableColumns(eventMissions).baseline).toBeDefined();
    expect(getTableColumns(eventMissionTasks).revision).toBeDefined();
    expect(getTableColumns(eventMissionTasks).spatialAnchors).toBeDefined();
    expect(getTableColumns(eventMissionEvents).sequence).toBeDefined();
    expect(getTableColumns(eventMissionEvents).idempotencyKey).toBeDefined();
  });

  it("pins event scope, CAS, idempotency, append-only sequence, and active-state constraints in migration 0046", async () => {
    const [migration, journal, service] = await Promise.all([
      readFile(resolve("drizzle/0046_event_mission_control.sql"), "utf-8"),
      readFile(resolve("drizzle/meta/_journal.json"), "utf-8"),
      readFile(resolve("src/services/event-mission-control.ts"), "utf-8"),
    ]);
    expect(journal).toContain('"tag": "0046_event_mission_control"');
    expect(migration).toContain('CONSTRAINT "event_missions_event_handoff_fk"');
    expect(migration).toContain('CONSTRAINT "event_mission_phases_event_phase_fk"');
    expect(migration).toContain('CONSTRAINT "event_mission_tasks_handoff_task_fk"');
    expect(migration).toContain('"event_mission_events_idempotency_unique"');
    expect(migration).toContain('"event_mission_events_mission_sequence_unique"');
    expect(migration).toContain('"payload" ->> \'kind\' = "kind"');
    expect(migration).toContain('"event_mission_phases_one_active"');
    expect(migration).toContain('"event_missions_one_live_per_event"');
    expect(service).toContain("eq(eventMissionPhases.revision, parsed.expectedRevision)");
    expect(service).toContain("eq(eventMissionTasks.revision, parsed.expectedRevision)");
    expect(service).toContain("eq(eventMissionIncidents.revision, parsed.expectedRevision)");
    expect(service).toContain("existingIdempotentEvent");
    expect(service).toContain("isNotNull(configurationSheetSnapshots.approvedAt)");
    expect(service).toContain("eq(configurationSheetSnapshots.configurationId, handoffPacks.configId)");
    expect(service).toContain("eq(eventConfigurationLinks.configurationId, handoffPacks.configId)");
    expect(service).toContain("eq(configurations.venueId, events.venueId)");
    expect(service).not.toContain("tx.update(opsTasks)");
  });
});

describe("event mission route boundaries", () => {
  it("requires authentication on board, timeline, and mutation routes", async () => {
    for (const [method, url] of [
      ["GET", `/events/${EVENT_ID}/mission`],
      ["POST", `/events/${EVENT_ID}/mission`],
      ["GET", `/event-missions/${MISSION_ID}/timeline`],
      ["PATCH", `/event-missions/${MISSION_ID}/phases/${PHASE_ID}`],
    ] as const) {
      const response = await server.inject({ method, url, payload: method === "GET" ? undefined : {} });
      expect(response.statusCode).toBe(401);
    }
  });

  it("rejects malformed commands and polling queries before database work", async () => {
    const authorization = `Bearer ${staffToken()}`;
    const cases = [
      server.inject({
        method: "PATCH",
        url: `/event-missions/${MISSION_ID}`,
        headers: { authorization },
        payload: { status: "live", idempotencyKey: "mission-operation-0001" },
      }),
      server.inject({
        method: "POST",
        url: `/events/${EVENT_ID}/mission`,
        headers: { authorization },
        payload: { handoffPackId: MISSION_ID, idempotencyKey: "short" },
      }),
      server.inject({
        method: "PATCH",
        url: `/event-missions/${MISSION_ID}/phases/${PHASE_ID}`,
        headers: { authorization },
        payload: { status: "active", expectedRevision: 0, idempotencyKey: "phase-operation-0001" },
      }),
      server.inject({
        method: "GET",
        url: `/event-missions/${MISSION_ID}/timeline?afterSequence=-1&limit=251`,
        headers: { authorization },
      }),
      server.inject({
        method: "POST",
        url: `/event-missions/${MISSION_ID}/presence`,
        headers: { authorization },
        payload: { sessionId: "not-a-uuid", view: "board" },
      }),
    ];
    for (const response of await Promise.all(cases)) expect(response.statusCode).toBe(400);
  });

  it("keeps the requested HTTP surface explicit for root registration", async () => {
    const [source, service] = await Promise.all([
      readFile(resolve("src/routes/event-mission-control.ts"), "utf-8"),
      readFile(resolve("src/services/event-mission-control.ts"), "utf-8"),
    ]);
    expect(source).toContain('server.patch("/:missionId"');
    for (const path of [
      '/:eventId/mission',
      '/:missionId/timeline',
      '/:missionId/replay',
      '/:missionId/presence',
      '/:missionId/phases/:missionPhaseId',
      '/:missionId/tasks/:missionTaskId',
      '/:missionId/incidents',
      '/:missionId/incidents/:incidentId',
      '/:missionId/acknowledgements',
    ]) expect(source).toContain(path);
    expect(service).toContain("assertEventMissionTransition(current.status, parsed.status)");
    expect(service).toContain('kind: "mission_status_changed"');
    expect(service).toContain("lastSequence: sql`${eventMissions.lastSequence} + 1`");
  });

  it("returns an indistinguishable 404 for an authenticated cross-tenant event read/write", async () => {
    const eventRow = {
      id: EVENT_ID,
      venueId: "00000000-0000-4000-8000-000000020005",
      createdBy: "00000000-0000-4000-8000-000000020004",
      deletedAt: null,
    };
    const scopedDb = createDb("postgresql://mock:mock@localhost/mock");
    Object.defineProperty(scopedDb, "select", { value: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([eventRow]) }),
        }),
      }) });
    const isolated = Fastify();
    await isolated.register(eventMissionEventRoutes, { db: scopedDb, prefix: "/events" });
    await isolated.ready();
    try {
      const authorization = `Bearer ${plannerToken()}`;
      const read = await isolated.inject({ method: "GET", url: `/events/${EVENT_ID}/mission`, headers: { authorization } });
      const write = await isolated.inject({
        method: "POST",
        url: `/events/${EVENT_ID}/mission`,
        headers: { authorization },
        payload: { handoffPackId: MISSION_ID, idempotencyKey: "mission-operation-404" },
      });
      expect(read.statusCode).toBe(404);
      expect(write.statusCode).toBe(404);
      expect(read.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(write.json()).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await isolated.close();
    }
  });

  it("returns an indistinguishable 404 for an authenticated cross-tenant mission read/write", async () => {
    const eventRow = {
      id: EVENT_ID,
      venueId: "00000000-0000-4000-8000-000000020005",
      createdBy: "00000000-0000-4000-8000-000000020004",
      deletedAt: null,
    };
    const missionRow = {
      id: MISSION_ID,
      eventId: EVENT_ID,
      venueId: eventRow.venueId,
    };
    const scopedDb = createDb("postgresql://mock:mock@localhost/mock");
    Object.defineProperty(scopedDb, "select", { value: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve([{ mission: missionRow, event: eventRow }]) }),
          }),
        }),
      }) });
    const isolated = Fastify();
    await isolated.register(eventMissionRoutes, { db: scopedDb, prefix: "/event-missions" });
    await isolated.ready();
    try {
      const authorization = `Bearer ${plannerToken()}`;
      const read = await isolated.inject({
        method: "GET",
        url: `/event-missions/${MISSION_ID}/timeline`,
        headers: { authorization },
      });
      const write = await isolated.inject({
        method: "PATCH",
        url: `/event-missions/${MISSION_ID}`,
        headers: { authorization },
        payload: { status: "completed", idempotencyKey: "mission-operation-404" },
      });
      expect(read.statusCode).toBe(404);
      expect(write.statusCode).toBe(404);
      expect(read.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(write.json()).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await isolated.close();
    }
  });
});
