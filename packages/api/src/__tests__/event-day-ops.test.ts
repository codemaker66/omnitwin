import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { isCapturedSupplierArrival, resolveTaskStatusTransition } from "../services/event-day-ops.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const EVENT_ID = "00000000-0000-4000-8000-000000002001";
const TASK_ID = "00000000-0000-4000-8000-000000002002";
const ISSUE_ID = "00000000-0000-4000-8000-000000002003";
const VENUE_ID = "00000000-0000-4000-8000-000000002004";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function hallkeeperToken(): string {
  return signToken({
    id: "00000000-0000-4000-8000-000000002005",
    email: "hallkeeper@test.com",
    role: "hallkeeper",
    venueId: VENUE_ID,
  });
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("event-day ops API", () => {
  it("requires auth for the mobile board", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/events/${EVENT_ID}/ops-board`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates task status vocabulary before database work", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/ops-tasks/${TASK_ID}/status`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: { status: "fire approved" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts idempotent task status shape before hitting the database", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/ops-tasks/${TASK_ID}/status`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: { status: "done", idempotencyKey: "tablet-op-1", note: "Completed in setup." },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("rejects unsafe issue wording before database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/issues`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: {
        title: "Unsafe copy",
        detail: "This is certified safe.",
        severity: "urgent",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates issue update bodies before database work", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/events/${EVENT_ID}/issues/${ISSUE_ID}`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("keeps task status transitions idempotent", () => {
    expect(resolveTaskStatusTransition("done", "done")).toEqual({
      changed: false,
      fromStatus: "done",
      toStatus: "done",
    });
    expect(resolveTaskStatusTransition("todo", "done")).toEqual({
      changed: true,
      fromStatus: "todo",
      toStatus: "done",
    });
  });

  it("registers the requested event-day routes with safe language", async () => {
    const sources = await Promise.all([
      readFile(resolve("src/routes/event-day-ops.ts"), "utf-8"),
      readFile(resolve("src/services/event-day-ops.ts"), "utf-8"),
    ]);
    const source = sources.join("\n");

    expect(source).toContain("/:id/ops-board");
    expect(source).toContain("/:id/changes-since-last-handoff");
    expect(source).toContain("/:id/issues");
    expect(source).toContain("/:id/status");
    expect(source).not.toContain("legally compliant");
    expect(source).not.toContain("approved for occupancy");
  });
});


// ---------------------------------------------------------------------------
// Supplier arrivals vs handoff notes (Ship Friday, Lane 6)
//
// compileSupplierInstructions derives prompts from the approved snapshot
// ("Decor supplier handoff", "Supplier coordination check") that carry no
// supplier and no arrival window. Listing those under "Supplier arrivals"
// told a hallkeeper that vans were booked when nobody had booked one. An
// arrival is something somebody captured; everything else is a note.
// ---------------------------------------------------------------------------

describe("isCapturedSupplierArrival", () => {
  it("counts an arrival window as captured", () => {
    expect(isCapturedSupplierArrival({ supplierId: null, arrivalWindow: "16:00-16:30" })).toBe(true);
  });

  it("counts a named supplier as captured even without a window", () => {
    expect(isCapturedSupplierArrival({
      supplierId: "00000000-0000-4000-8000-000000002099",
      arrivalWindow: null,
    })).toBe(true);
  });

  it("does not count a compiler prompt with neither as an arrival", () => {
    expect(isCapturedSupplierArrival({ supplierId: null, arrivalWindow: null })).toBe(false);
  });
});
