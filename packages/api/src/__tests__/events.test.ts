import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-000000000002";
const PHASE_ID = "00000000-0000-4000-8000-000000000003";
const CONFIG_ID = "00000000-0000-4000-8000-000000000004";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000099",
  email: "admin@test.com",
  role: "admin",
  venueId: VENUE_ID,
});

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("event routes", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      payload: { venueId: VENUE_ID, name: "Wedding" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates event creation status vocabulary", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { venueId: VENUE_ID, name: "Wedding", status: "production ready" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid event creation payload before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        venueId: VENUE_ID,
        name: "Wedding",
        eventType: "wedding",
        status: "draft",
        guestCount: 120,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("validates phase update placeholders without unsafe claims", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/event-phases/${PHASE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { densityStatus: "certified_safe" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid phase update shape before hitting the database", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/event-phases/${PHASE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        durationMinutes: 45,
        guestCount: 120,
        opsTasksCount: 8,
        reviewGatesCount: 2,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("validates layout variant links", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/layout-variants`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        configurationId: CONFIG_ID,
        name: "Dinner option A",
        guestCount: 120,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("uses the shared default phase generator in event creation", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    expect(source).toContain("defaultEventPhaseInputs()");
    expect(source).toContain("Density not checked");
    expect(source).toContain("Staff conflicts not checked");
    expect(source).not.toContain("certified safe");
    expect(source).not.toContain("fire approved");
  });
});
