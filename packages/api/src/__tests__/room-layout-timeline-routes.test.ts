import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  RoomLayoutTimelineResponseSchema,
  historicalRuntimeFromBinding,
} from "@omnitwin/types";
import { assessRoomLayoutTimelineResponse } from "../routes/room-layout-timeline.js";

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

  it("rejects partial or mixed venue-local scope requests", async () => {
    const cases = [
      { venueId: VENUE_ID, spaceId: SPACE_ID, scope: "day" },
      { ...validQuery, scope: "week", anchorDate: "2026-10-25" },
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
    expect(response.statusCode, response.body).toBe(404);
  });

  it("keeps the historical member route quarantined before database or byte access", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/calendar/venues/${VENUE_ID}/spaces/${SPACE_ID}/runtime-bindings/00000000-0000-4000-8000-000000000004/members/0/room.sog`,
      headers: {
        authorization: `Bearer ${staffToken()}`,
        origin: "http://localhost:5173",
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-expose-headers"]?.toLowerCase())
      .toContain("x-runtime-binding-digest");
    expect(response.headers["access-control-expose-headers"]?.toLowerCase())
      .toContain("x-runtime-package-content-digest");
    expect(response.headers["access-control-expose-headers"]?.toLowerCase())
      .toContain("x-asset-version-id");
  });

});

describe("room layout timeline — source contract", () => {
  it("uses half-open room-scoped phase overlap semantics", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("eq(eventPhases.spaceId, query.spaceId)");
    expect(source).toContain("gt(eventPhases.durationMinutes, 0)");
    expect(source).toContain("lt(eventPhases.startsAt, to)");
    expect(source).toContain("make_interval(mins =>");
  });

  it("bounds phase density and fetches only the effective snapshot payload per phase", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("inArray(phaseLayoutSnapshots.eventPhaseId, phaseIds)");
    expect(source).toContain("snapshotHash: phaseLayoutSnapshots.snapshotHash");
    expect(source).toContain("canonicalSnapshotId: phaseLayoutSnapshots.canonicalSnapshotId");
    expect(source).toContain("proofDigest: phaseLayoutSnapshots.proofDigest");
    expect(source).toContain("frozenBy: phaseLayoutSnapshots.frozenBy");
    expect(source).toContain("canonicalPayload: canonicalLayoutSnapshots.payload");
    expect(source).toContain("proofPayload: layoutValidationRuns.payload");
    expect(source).toContain("predecessorIds");
    expect(source).toContain(".limit(MAX_ROOM_LAYOUT_TIMELINE_FRAMES + 1)");
    expect(source).toContain('as("ranked_timeline_snapshot_ids")');
    expect(source).toContain("eq(rankedSnapshotIds.candidateRank, 1)");
    expect(source).toContain("MAX_ROOM_LAYOUT_TIMELINE_OBJECTS");
    expect(source).toContain("MAX_ROOM_LAYOUT_TIMELINE_RESPONSE_BYTES");
    expect(source).toContain("frame.keyframe.payload.objects.length");
    expect(source).toContain("assessRoomLayoutTimelineResponse(response)");
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await\s+db/su);
  });

  it("validates the full response and routes room flips through gap semantics", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("RoomLayoutTimelineResponseSchema.parse({");
    expect(source).toContain('row.templateKey === "room-flip"');
    expect(source).toContain('templateKey: isRoomFlip ? "room-flip" as const : row.templateKey');
  });

  it("resolves day/week bounds from the persisted venue timezone in PostgreSQL", async () => {
    const source = await readFile(resolve("src/routes/room-layout-timeline.ts"), "utf-8");
    expect(source).toContain("timeZone: venues.timezone");
    expect(source).toContain("at time zone ${timeZone}");
    expect(source).toContain("date_trunc('week'");
    expect(source).toContain("range: range.response");
  });
});

describe("room layout timeline — aggregate response limits", () => {
  const payload = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
  const response = RoomLayoutTimelineResponseSchema.parse({
    venueId: payload.venueId,
    spaceId: payload.spaceId,
    timeZone: "Europe/London",
    from: "2026-06-07T18:00:00.000Z",
    to: "2026-06-07T23:00:00.000Z",
    range: {
      scope: "custom",
      anchorDate: null,
      from: "2026-06-07T18:00:00.000Z",
      to: "2026-06-07T23:00:00.000Z",
    },
    frames: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "phase",
      eventId: "99999999-9999-4999-8999-999999999999",
      eventName: "Dinner",
      eventType: "dinner",
      eventStatus: "confirmed",
      eventGuestCount: payload.guestCount,
      phaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      phaseName: "Dinner service",
      templateKey: "dinner",
      sortOrder: 1,
      startsAt: "2026-06-07T19:30:00.000Z",
      endsAt: "2026-06-07T21:15:00.000Z",
      guestCount: payload.guestCount,
      opsTasksCount: 0,
      reviewGatesCount: 0,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      figures: {
        guests: { value: payload.guestCount, source: "frozen_snapshot" },
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
          state: "unavailable",
          reason: "no_matching_planning_scenario",
        },
      },
      keyframe: {
        state: "available",
        snapshotId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        snapshotStatus: "frozen",
        canonicalSnapshotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        proofDigest: "b".repeat(64),
        frozenBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        supersedesSnapshotId: null,
        createdAt: "2026-06-07T17:00:00.000Z",
        frozenAt: "2026-06-07T17:00:00.000Z",
        objectCount: payload.objects.length,
        guestCount: payload.guestCount,
        payload,
        historicalRuntime: historicalRuntimeFromBinding(null),
      },
    }],
  });

  it("counts canonical objects and rejects the object ceiling first", () => {
    expect(assessRoomLayoutTimelineResponse(response, {
      maxObjects: payload.objects.length - 1,
      maxBytes: Number.MAX_SAFE_INTEGER,
    })).toMatchObject({
      totalCanonicalObjects: payload.objects.length,
      exceeded: "objects",
    });
  });

  it("measures the full serialized envelope and enforces its byte ceiling", () => {
    const assessment = assessRoomLayoutTimelineResponse(response, {
      maxObjects: Number.MAX_SAFE_INTEGER,
      maxBytes: 1,
    });
    expect(assessment.serializedBytes).toBeGreaterThan(1);
    expect(assessment.exceeded).toBe("bytes");
  });
});
