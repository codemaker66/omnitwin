import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { GuestFlowReplayInput } from "@omnitwin/types";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const REPLAY_ID = "00000000-0000-4000-8000-000000003001";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function staffToken(): string {
  return signToken({
    id: "00000000-0000-4000-8000-000000003002",
    email: "staff@test.com",
    role: "staff",
    venueId: "00000000-0000-4000-8000-000000003003",
  });
}

function plannerToken(): string {
  return signToken({
    id: "00000000-0000-4000-8000-000000003004",
    email: "planner@test.com",
    role: "planner",
    venueId: null,
  });
}

const INPUT: GuestFlowReplayInput = {
  scenarioType: "guest_arrival",
  layout: {
    configurationId: null,
    snapshotHash: null,
    placedObjectCount: 2,
  },
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 8 },
    { x: 0, y: 8 },
  ],
  obstacles: [{
    id: "table",
    label: "Table",
    polygon: [
      { x: 5, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 5 },
      { x: 5, y: 5 },
    ],
  }],
  entrances: [{ id: "entry", label: "Entry", point: { x: 1, y: 4 }, widthM: 1.2 }],
  exits: [{ id: "exit", label: "Exit", point: { x: 11, y: 4 }, widthM: 1.2 }],
  destinations: [{ id: "bar", label: "Bar", point: { x: 10, y: 4 }, weight: 1 }],
  staffLanes: [],
  phase: { phaseId: null, label: "Arrival", durationMinutes: 20 },
  assumptions: [{ key: "arrival_window", label: "Arrival window", value: "20 minutes", source: "test fixture" }],
  agentCount: 12,
  seed: 99,
};

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("guest-flow replay API", () => {
  it("requires auth for persisted replay surfaces", async () => {
    for (const [method, url] of [
      ["POST", "/guest-flow/scenarios"],
      ["GET", "/guest-flow/replays/latest"],
      ["GET", `/guest-flow/replays/${REPLAY_ID}`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("rejects malformed create payloads before database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/guest-flow/scenarios",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        name: "",
        input: { scenarioType: "fire approved" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects planner access and staff replay requests without venue scope", async () => {
    const planner = await server.inject({
      method: "POST",
      url: "/guest-flow/scenarios",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: { name: "Arrival replay", input: INPUT },
    });
    expect(planner.statusCode).toBe(403);

    const unscopedStaff = await server.inject({
      method: "POST",
      url: "/guest-flow/scenarios",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { name: "Arrival replay", input: INPUT },
    });
    expect(unscopedStaff.statusCode).toBe(422);
    expect(unscopedStaff.json()).toMatchObject({ code: "VENUE_SCOPE_REQUIRED" });
  });

  it("keeps route source safe and registers persistence endpoints", async () => {
    const source = await readFile(resolve("src/routes/guest-flow-replay.ts"), "utf-8");

    expect(source).toContain("/scenarios");
    expect(source).toContain("/replays/latest");
    expect(source).toContain("/replays/:id");
    expect(source).toContain("guestFlowReplays");
    expect(source).toContain("navmeshVersions");
    expect(source).toContain("agentTrajectories");
    expect(source).not.toMatch(/certified safe|fire approved|legally compliant|approved for occupancy|guaranteed accessible/iu);
  });
});
