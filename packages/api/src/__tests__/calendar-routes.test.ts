import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// GET /calendar read model (T-489) — auth + query validation boundary through
// the real server, plus source-contract pins for the data assembly rules
// (conflict engine invocation, footprint end-time SQL, venue space guard).
// ---------------------------------------------------------------------------

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000000002";

function staffToken(venueId: string = VENUE_ID): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000000099",
    email: "staff@test.com",
    role: "staff",
    venueId,
  });
}

function calendarUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/calendar?${query}`;
}

beforeAll(async () => {
  server = await buildServer();
});
afterAll(async () => {
  await server.close();
});

describe("calendar read model — auth and validation boundary", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-21T00:00:00.000Z",
      }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("requires venueId, from, and to", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/calendar",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects from at or after to", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-09-21T00:00:00.000Z",
        to: "2026-09-14T00:00:00.000Z",
      }),
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a range beyond 366 days", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-01-01T00:00:00.000Z",
        to: "2027-01-03T00:00:00.000Z",
      }),
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("parses comma-separated spaceIds and rejects malformed entries", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-21T00:00:00.000Z",
        spaceIds: "not-a-uuid,also-bad",
      }),
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses cross-venue reads", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-21T00:00:00.000Z",
      }),
      headers: { authorization: `Bearer ${staffToken(OTHER_VENUE_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a valid query shape before hitting the database", async () => {
    const res = await server.inject({
      method: "GET",
      url: calendarUrl({
        venueId: VENUE_ID,
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-21T00:00:00.000Z",
      }),
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("calendar read model — source contract", () => {
  it("computes conflicts from the same fetched data in the same request", async () => {
    const source = await readFile(resolve("src/routes/calendar.ts"), "utf-8");
    expect(source).toContain("detectCalendarConflicts({");
    // The main path computes conflicts before the FINAL response validation
    // (the earlier parse belongs to the empty-lanes early return).
    expect(source.indexOf("detectCalendarConflicts({")).toBeLessThan(
      source.lastIndexOf("CalendarResponseSchema.parse"),
    );
  });

  it("derives footprint phase end times in SQL with half-open overlap", async () => {
    const source = await readFile(resolve("src/routes/calendar.ts"), "utf-8");
    expect(source).toContain("make_interval(mins =>");
    expect(source).toContain("isNotNull(eventPhases.spaceId)");
    expect(source).toContain("isNotNull(eventPhases.startsAt)");
  });

  it("rejects space filters that name no space of the venue", async () => {
    const source = await readFile(resolve("src/routes/calendar.ts"), "utf-8");
    expect(source).toContain("No requested space belongs to this venue.");
  });

  it("returns every booking kind and status in range — view filtering is a client concern", async () => {
    const source = await readFile(resolve("src/routes/calendar.ts"), "utf-8");
    expect(source).toContain("isNull(bookings.deletedAt)");
    expect(source).not.toMatch(/eq\(bookings\.kind/);
    expect(source).not.toMatch(/eq\(bookings\.status/);
  });

  it("validates the full response against the shared schema before sending", async () => {
    const source = await readFile(resolve("src/routes/calendar.ts"), "utf-8");
    expect(source).toContain("CalendarResponseSchema.parse({");
  });
});
