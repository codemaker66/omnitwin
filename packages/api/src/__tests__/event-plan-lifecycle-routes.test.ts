import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["CLERK_SECRET_KEY"] = process.env["CLERK_SECRET_KEY"] ?? "sk_test_dummy";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const EVENT_ID = "00000000-0000-4000-8000-000000004001";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function hallkeeperToken(): string {
  return signToken({
    id: "00000000-0000-4000-8000-000000004002",
    email: "hallkeeper@test.com",
    role: "hallkeeper",
    venueId: "00000000-0000-4000-8000-000000004003",
  });
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("event plan lifecycle routes", () => {
  it("requires auth for notification and change-feed surfaces", async () => {
    for (const [method, url] of [
      ["GET", "/notifications"],
      ["PATCH", "/notifications/00000000-0000-4000-8000-000000004004/read"],
      ["GET", `/events/${EVENT_ID}/change-feed`],
      ["POST", `/events/${EVENT_ID}/change-acknowledgements`],
      ["GET", `/events/${EVENT_ID}/change-acknowledgements`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method === "POST" || method === "PATCH" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("validates notification query shape before database work", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/notifications?status=bogus",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates acknowledgement payload shape before event lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/change-acknowledgements`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: { changeId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates the acknowledgement list query before event lookup", async () => {
    for (const query of ["?limit=0", "?limit=501", "?status=unread"]) {
      const res = await server.inject({
        method: "GET",
        url: `/events/${EVENT_ID}/change-acknowledgements${query}`,
        headers: { authorization: `Bearer ${hallkeeperToken()}` },
      });
      expect(res.statusCode, query).toBe(400);
    }
  });

  it("reads acknowledgements behind the same venue gate as the write", async () => {
    // Lane 6's board reads this route, so its tenancy gate must be the POST's
    // gate and not a looser one: both go through requireEventAccess, which
    // authorizes against the loaded event row's venue.
    const source = await readFile(resolve("src/routes/event-plan-lifecycle.ts"), "utf-8");
    const read = source.slice(
      source.indexOf('server.get("/:eventId/change-acknowledgements"'),
      source.indexOf('server.post("/:eventId/change-acknowledgements"'),
    );
    expect(read.length).toBeGreaterThan(0);
    expect(read).toContain("requireEventAccess(db, request, reply, params.data.eventId)");
    expect(read).toContain("eq(eventPlanChangeAcknowledgements.eventId, eventRow.id)");
    expect(read).toContain("HallkeeperAcknowledgementSchema");
    expect(read).toContain("private, no-store");
  });

  it("registers lifecycle routes and keeps public claims honest", async () => {
    const sources = await Promise.all([
      readFile(resolve("src/routes/event-plan-lifecycle.ts"), "utf-8"),
      readFile(resolve("src/services/event-plan-lifecycle.ts"), "utf-8"),
      readFile(resolve("src/routes/proposals.ts"), "utf-8"),
      readFile(resolve("src/routes/event-day-ops.ts"), "utf-8"),
      readFile(resolve("src/db/schema.ts"), "utf-8"),
    ]);
    const source = sources.join("\n");

    expect(source).toContain("/change-feed");
    expect(source).toContain("/change-acknowledgements");
    expect(source).toContain("/:id/read");
    expect(source).toContain("event_plan_changes");
    expect(source).toContain("event_plan_notifications");
    expect(source).toContain("event_plan_change_acknowledgements");
    expect(source).toContain("recordProposalLifecycleChange");
    expect(source).toContain("recordEventPlanChange");
    expect(source).not.toContain("certified safe");
    expect(source).not.toContain("legally compliant");
  });
});
