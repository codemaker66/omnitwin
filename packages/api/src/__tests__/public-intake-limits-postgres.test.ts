import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// How many guest plans and enquiries one address may send in an hour (Blake,
// 12 November 2026, decision (d), "Plans 60/h, enquiries 10/h").
//
// The planner makes a plan the first time a new visitor opens it, and both
// routes allowed ten an hour per address, so on one shared connection (a
// wedding fair on the venue's Wi-Fi, an office, a phone network) the eleventh
// new visitor in an hour could not plan. A plan sends no email; an enquiry
// does, so plans rise to sixty and enquiries stay at ten.
//
// This drives the whole app, with its real rate limiter, on the migrated
// database: only that shows what the limiter does. Everything it writes is in
// a venue of its own and is removed afterwards.
//
// Opt-in, disposable PostgreSQL only. The server it builds is pointed at the
// validated URL in-process; .env is never consulted.
// ---------------------------------------------------------------------------

// Nothing leaves the process: the provider's client is a stand-in, and the
// key set below is a test value no provider would take.
vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send: () => Promise.resolve({ data: { id: "test-only" }, error: null }) };
  },
}));

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Public intake limit tests require the explicit disposable platform database");
  }
}

/** The environment this suite sets, restored afterwards. */
const SET_HERE = ["DATABASE_URL", "JWT_SECRET", "TWIN_PUBLIC_VENUE_SLUGS", "RESEND_API_KEY", "ENQUIRY_FALLBACK_EMAIL"] as const;

const NOON = Date.UTC(2026, 10, 12, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(target === undefined)("how many plans and enquiries one address may send in an hour, through the whole app", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const roomId = randomUUID();
  const run = randomUUID().slice(0, 8);
  const saved = new Map(SET_HERE.map((name) => [name, process.env[name]]));

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `public_intake_limits_${randomUUID()}`, max: 2 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1::uuid, 'TEST ONLY Limits Hall', $1::text, 'Test only')", [venueId]);
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, $2, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]')`,
      [roomId, venueId],
    );

    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    // This venue publishes its walkthrough (its slug is its id), so its form takes enquiries.
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = venueId;
    process.env["RESEND_API_KEY"] = "re_test_only_not_a_key";
    delete process.env["ENQUIRY_FALLBACK_EMAIL"];
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    try {
      // Before the server and its pool close: an acknowledgement still on
      // its way would otherwise be written after the clean-up.
      if (pool !== undefined) await acknowledgementsSettled();
    } finally {
      await server?.close();
      for (const [name, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
    if (pool === undefined) return;
    try {
      // Only this suite's venue, children first. An email's record and a
      // guest lead name no venue, so they go by the enquiry that made them.
      for (const statement of [
        `DELETE FROM email_sends s WHERE EXISTS (SELECT 1 FROM enquiries e
           WHERE e.venue_id = $1 AND s.idempotency_key LIKE 'enquiry-%' || e.id::text || '%')`,
        "DELETE FROM guest_leads WHERE first_enquiry_id IN (SELECT id FROM enquiries WHERE venue_id = $1)",
        "DELETE FROM enquiries WHERE venue_id = $1",
        "UPDATE contacts SET merged_into_id = NULL, client_account_id = NULL WHERE venue_id = $1",
        "UPDATE client_accounts SET merged_into_id = NULL, primary_contact_id = NULL WHERE venue_id = $1",
        "DELETE FROM contacts WHERE venue_id = $1",
        "DELETE FROM client_accounts WHERE venue_id = $1",
        "DELETE FROM configurations WHERE venue_id = $1",
        "DELETE FROM spaces WHERE venue_id = $1",
        "DELETE FROM venues WHERE id = $1",
      ]) {
        await pool.query(statement, [venueId]);
      }
    } finally {
      await pool.end();
    }
  }, 60_000);

  /** Every enquiry this suite stored has had its acknowledgement recorded (the route queues it after answering). */
  async function acknowledgementsSettled(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM enquiries e WHERE e.venue_id = $1
           AND NOT EXISTS (SELECT 1 FROM email_sends s
             WHERE s.idempotency_key = 'enquiry-acknowledged:' || e.id::text AND s.status <> 'pending')`,
        [venueId],
      );
      if (rows[0]?.waiting === 0) return;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error("An acknowledgement this suite queued never settled");
  }

  /** A guest's plan, made as the planner makes one, from one client address. */
  function newPlan(address: string): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId: roomId }, remoteAddress: address });
  }

  /** A guest's enquiry from the venue's form, from one client address. */
  function enquire(address: string, n: number): Promise<LightMyRequestResponse> {
    return server.inject({
      method: "POST", url: "/public/enquiries", remoteAddress: address,
      payload: { venueSlug: venueId, source: "website", email: `test-only-limits-${run}-${String(n)}@example.test`, eventType: "wedding" },
    });
  }

  /** How long a refusal says to wait, in seconds, with what it said. */
  function refusal(response: LightMyRequestResponse): { statusCode: number; code: unknown; withinTheHour: boolean } {
    const wait = Number(response.headers["retry-after"]);
    return { statusCode: response.statusCode, code: response.json<{ code?: unknown }>().code, withinTheHour: wait > 3_500 && wait <= 3_600 };
  }

  async function storedAtVenue(table: "configurations" | "enquiries"): Promise<number> {
    const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE venue_id = $1`, [venueId]);
    return rows[0]?.count ?? -1;
  }

  it("lets one address make sixty guest plans in an hour, refuses the sixty-first, and takes plans again an hour later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    // Documentation addresses (RFC 5737), one per case, so each has its own count.
    const address = "198.51.100.60";
    const made: number[] = [];
    for (let n = 0; n < 60; n += 1) made.push((await newPlan(address)).statusCode);
    expect({ refused: made.filter((status) => status !== 201).length }).toEqual({ refused: 0 });
    expect(refusal(await newPlan(address))).toEqual({ statusCode: 429, code: "RATE_LIMITED", withinTheHour: true });
    expect(await storedAtVenue("configurations")).toBe(60);

    vi.setSystemTime(NOON + HOUR_MS + 1_000);
    expect((await newPlan(address)).statusCode).toBe(201);
  }, 120_000);

  it("still lets one address send ten enquiries in an hour, and refuses the eleventh", async () => {
    const address = "198.51.100.10";
    const sent: number[] = [];
    for (let n = 0; n < 10; n += 1) sent.push((await enquire(address, n)).statusCode);
    expect(sent).toEqual(Array.from({ length: 10 }, () => 201));
    expect(refusal(await enquire(address, 10))).toEqual({ statusCode: 429, code: "RATE_LIMITED", withinTheHour: true });
    expect(await storedAtVenue("enquiries")).toBe(10);
  }, 120_000);
});
