import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// POST /admin/diary/hold-reminders (T-527) — route contract tests.
// The delivery pass itself is covered in services/hold-reminders.test.ts;
// here the service is mocked and the route's auth, body validation, and
// response envelope are pinned.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const SUMMARY = {
  scanned: 3,
  due: 1,
  sent: 1,
  failed: 0,
  dryRun: false,
  reminders: [
    {
      bookingId: "00000000-0000-4000-8000-000000000001",
      daysBefore: 7,
      to: "owner@tradeshall.example",
      idempotencyKey: "hold-reminder:00000000-0000-4000-8000-000000000001:2026-07-27:t-7",
      outcome: "sent",
    },
  ],
} as const;

const runHoldReminderPass = vi.fn();
vi.mock("../services/hold-reminders.js", () => ({
  runHoldReminderPass: (...args: unknown[]) => runHoldReminderPass(...args) as unknown,
}));

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; platformRole?: "none" | "operator" | "admin"; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", platformRole: "admin", venueId: "v1" });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

describe("POST /admin/diary/hold-reminders", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url: "/admin/diary/hold-reminders" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("runs the pass and returns its summary in the data envelope", async () => {
    runHoldReminderPass.mockResolvedValueOnce(SUMMARY);
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: SUMMARY });
    const call = runHoldReminderPass.mock.calls[0]?.[0] as { dryRun?: boolean };
    expect(call.dryRun).toBe(false);
  });

  it("passes dryRun through to the service", async () => {
    runHoldReminderPass.mockResolvedValueOnce({ ...SUMMARY, dryRun: true, sent: 0 });
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "application/json" },
      payload: { dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    const call = runHoldReminderPass.mock.calls.at(-1)?.[0] as { dryRun?: boolean };
    expect(call.dryRun).toBe(true);
  });

  it("rejects a malformed body", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "application/json" },
      payload: { dryRun: "yes-please" },
    });
    expect(res.statusCode).toBe(400);
  });
});
