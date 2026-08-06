import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000000002";
const SPACE_ID = "00000000-0000-4000-8000-000000000003";

function staffToken(venueId: string = VENUE_ID): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000000099",
    email: "staff@test.com",
    role: "staff",
    venueId,
  });
}

function timelineUrl(params: Record<string, string>): string {
  return `/calendar/layout-timeline?${new URLSearchParams(params).toString()}`;
}

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("room layout timeline — auth and validation boundary", () => {
  const validQuery = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    from: "2026-10-25T00:00:00.000Z",
    to: "2026-11-01T01:00:00.000Z",
  };

  it("returns 401 without authentication", async () => {
    const response = await server.inject({
      method: "GET",
      url: timelineUrl(validQuery),
    });
    expect(response.statusCode).toBe(401);
  });

  it("requires venue, room, and range query fields", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/calendar/layout-timeline",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(response.statusCode, response.body).toBe(400);
  });

  it("rejects malformed room identity, inverted ranges, and ranges over eight days", async () => {
    const cases = [
      { ...validQuery, spaceId: "not-a-uuid" },
      { ...validQuery, from: validQuery.to, to: validQuery.from },
      {
        ...validQuery,
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-09T00:00:00.001Z",
      },
    ];
    for (const query of cases) {
      const response = await server.inject({
        method: "GET",
        url: timelineUrl(query),
        headers: { authorization: `Bearer ${staffToken()}` },
      });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("refuses a cross-venue read before touching room data", async () => {
    const response = await server.inject({
      method: "GET",
      url: timelineUrl(validQuery),
      headers: { authorization: `Bearer ${staffToken(OTHER_VENUE_ID)}` },
    });
    expect(response.statusCode, response.body).toBe(403);
  });

  it("accepts the DST-safe week query before reaching the database", async () => {
    const response = await server.inject({
      method: "GET",
      url: timelineUrl(validQuery),
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });
});

describe("room layout timeline — source contract", () => {
  it("uses half-open room-scoped phase overlap semantics", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("eq(eventPhases.spaceId, query.spaceId)");
    expect(source).toContain("lt(eventPhases.startsAt, to)");
    expect(source).toContain("make_interval(mins =>");
  });

  it("bounds phase density and fetches only the effective snapshot payload per phase", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("inArray(phaseLayoutSnapshots.eventPhaseId, phaseIds)");
    expect(source).toContain("snapshotHash: phaseLayoutSnapshots.snapshotHash");
    expect(source).toContain(".limit(MAX_ROOM_LAYOUT_TIMELINE_FRAMES + 1)");
    expect(source).toContain('as("ranked_timeline_snapshot_ids")');
    expect(source).toContain("eq(rankedSnapshotIds.candidateRank, 1)");
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await\s+db/su);
  });

  it("validates the full response and routes room flips through gap semantics", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("RoomLayoutTimelineResponseSchema.parse({");
    expect(source).toContain('row.templateKey === "room-flip"');
  });
});
