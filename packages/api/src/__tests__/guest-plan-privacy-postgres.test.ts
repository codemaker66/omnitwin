import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Who can find and read a guest's plan (final review, TENANCY-3).
//
// A guest's plan is public: anyone holding its id can open it. The id is one
// lookup away from the plan's six-character code, so how fast codes can be
// tried decides how findable every plan is.
//
// This drives the whole app, with its real rate limiter, on the migrated
// database.
//
// Opt-in, disposable PostgreSQL only. The server it builds is pointed at the
// validated URL in-process; .env is never consulted.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Guest plan privacy tests require the explicit disposable platform database");
  }
}

interface Plan { readonly id: string; revision: number; readonly shortCode: string; readonly claimSecret: string }

const NOON = Date.UTC(2026, 10, 11, 12, 0, 0);
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** A well-formed six-character code nobody was given. */
function madeUpCode(n: number): string {
  const digits = [n % 31, Math.floor(n / 31) % 31].map((digit) => CODE_ALPHABET.charAt(digit));
  return `zzzz${digits.join("")}`;
}

describe.skipIf(target === undefined)("who can find and read a guest's plan, through the whole app", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();

  async function newPlan(): Promise<Plan> {
    const response = await server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(201);
    return response.json<{ data: Plan }>().data;
  }

  async function lookUp(code: string): Promise<{ statusCode: number; status: string | undefined; configId: string | undefined }> {
    const response = await server.inject({ method: "GET", url: `/layouts/resolve?path=${encodeURIComponent(`/plan/${code}`)}` });
    const body = response.json<{ status?: string; configId?: string }>();
    return { statusCode: response.statusCode, status: body.status, configId: body.configId };
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `guest_plan_privacy_${randomUUID()}`, max: 2 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    const db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY guest privacy venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY guest privacy chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });

    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("answers thirty code lookups a minute from one address, then refuses guesses until the minute is out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    const plan = await newPlan();

    // The plan's own code still finds it.
    expect(await lookUp(plan.shortCode)).toEqual({ statusCode: 200, status: "canonical", configId: plan.id });

    const guesses: number[] = [];
    for (let n = 0; n < 29; n += 1) guesses.push((await lookUp(madeUpCode(n))).statusCode);
    expect(guesses.filter((status) => status !== 200)).toEqual([]);

    // The thirty-first lookup in the minute, whatever it asks for, is refused.
    expect((await lookUp(madeUpCode(29))).statusCode).toBe(429);
    expect((await lookUp(plan.shortCode)).statusCode).toBe(429);

    vi.setSystemTime(NOON + 61_000);
    expect(await lookUp(plan.shortCode)).toEqual({ statusCode: 200, status: "canonical", configId: plan.id });
  }, 60_000);
});
