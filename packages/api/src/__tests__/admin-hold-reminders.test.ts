import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// POST /admin/diary/hold-reminders (T-527) — route contract tests.
// The delivery pass itself is covered in services/hold-reminders.test.ts;
// here the service is mocked and the route's auth, body validation, and
// response envelope are pinned.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
// A configured (dummy) Clerk secret, so a bearer token that is NOT the mock
// JSON shape reaches Clerk verification and is answered 401 — the production
// shape. Without it the route answers 500 "Clerk not configured", which
// would hide a real auth regression behind a configuration error (T-619).
process.env["CLERK_SECRET_KEY"] = "sk_test_not_a_real_clerk_secret_key";

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

// ---------------------------------------------------------------------------
// The scheduled identity (T-619). The reminder pass has to run unattended,
// and an unattended runner holds no Clerk session. `DIARY_CRON_TOKEN` is a
// second accepted identity for THIS ROUTE ONLY, and only when the deployment
// sets it. These cases pin both halves: that it works, and that it cannot be
// bluffed.
// ---------------------------------------------------------------------------

/** Invented for this file. The real token lives only in the deployment. */
const CRON_TOKEN = "test-diary-cron-token-000000000000000000";

describe("POST /admin/diary/hold-reminders — the cron's service token", () => {
  // Cleared BEFORE each case: the describe above it already exercised the
  // pass, and "was the service called?" must mean "in this test".
  beforeEach(() => { runHoldReminderPass.mockClear(); });
  afterEach(() => { delete process.env["DIARY_CRON_TOKEN"]; });

  it("is refused when the deployment has configured no token", async () => {
    delete process.env["DIARY_CRON_TOKEN"];
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${CRON_TOKEN}` },
    });
    // Unset means the scheduled path does not exist — never that it is open.
    expect(res.statusCode).toBe(401);
    expect(runHoldReminderPass).not.toHaveBeenCalled();
  });

  it("runs the dry-run pass for the configured token, with no Clerk session", async () => {
    process.env["DIARY_CRON_TOKEN"] = CRON_TOKEN;
    runHoldReminderPass.mockResolvedValueOnce({ ...SUMMARY, dryRun: true, sent: 0 });
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${CRON_TOKEN}`, "content-type": "application/json" },
      payload: { dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    // The receipt the cron prints: a rehearsal that reports and sends nothing.
    expect(res.json()).toMatchObject({ data: { dryRun: true, sent: 0 } });
  });

  it("refuses a token that is merely close", async () => {
    process.env["DIARY_CRON_TOKEN"] = CRON_TOKEN;
    for (const presented of [`${CRON_TOKEN}x`, CRON_TOKEN.slice(0, -1), CRON_TOKEN.toUpperCase()]) {
      const res = await server.inject({
        method: "POST",
        url: "/admin/diary/hold-reminders",
        headers: { authorization: `Bearer ${presented}` },
      });
      expect(res.statusCode).toBe(401);
    }
    expect(runHoldReminderPass).not.toHaveBeenCalled();
  });

  it("ignores a token too short to be a real secret", async () => {
    // Mirrors the EnvSchema floor, so a deployment that skipped startup
    // validation still fails closed rather than accepting "changeme".
    process.env["DIARY_CRON_TOKEN"] = "short";
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: "Bearer short" },
    });
    expect(res.statusCode).toBe(401);
    expect(runHoldReminderPass).not.toHaveBeenCalled();
  });

  it("still lets a signed-in platform administrator through while a token is configured", async () => {
    process.env["DIARY_CRON_TOKEN"] = CRON_TOKEN;
    runHoldReminderPass.mockResolvedValueOnce(SUMMARY);
    const res = await server.inject({
      method: "POST",
      url: "/admin/diary/hold-reminders",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it("keeps every other admin route on the Clerk path", async () => {
    process.env["DIARY_CRON_TOKEN"] = CRON_TOKEN;
    // The token is scoped to the reminder route; it must never become a
    // general-purpose admin key.
    for (const url of ["/admin/cleanup", "/admin/prune-snapshots"]) {
      const res = await server.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${CRON_TOKEN}` },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
