import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Whole-repository audit, api-requests-suppliers-rota-4.
//
// A supplier's reply is the one public write that had no limit of its own:
// only the app-wide hundred a minute. Each reply writes a row that cannot be
// deleted, an audit row and a notification for every staff role, so anyone
// holding a pass link could send the venue's whole team a hundred "has a
// question" notices a minute. The other public writes allow ten or twenty an
// hour.
//
// This drives the whole app, with its real rate limiter, on the migrated
// database: only that shows what the limiter does to this route. The link
// replied to does not exist, so nothing is written; the limiter counts a
// request whatever its answer.
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
    throw new Error("Supplier reply limit tests require the explicit disposable platform database");
  }
}

describe.skipIf(target === undefined)("how often one address may reply on supplier links, through the whole app", () => {
  let server: FastifyInstance;
  // No pass has this link: 43 characters of the shape a real one has.
  const link = `noSuchPass_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  function reply(): Promise<LightMyRequestResponse> {
    return server.inject({
      method: "POST", url: `/supplier-share/${link}/acknowledge`,
      payload: { status: "needs_clarification", acknowledgedByName: "Sam", note: "Which door do we load through?" },
    });
  }

  it("answers twenty replies in an hour from one address and refuses the next, saying when to try again", async () => {
    const answered: number[] = [];
    for (let sent = 0; sent < 20; sent += 1) answered.push((await reply()).statusCode);
    // Each was answered by the route itself: there is no such pass.
    expect(answered).toEqual(Array.from({ length: 20 }, () => 404));

    const refused = await reply();
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  }, 60_000);

  it("still lets that address read a brief: reading has its own count", async () => {
    const read = await server.inject({ method: "GET", url: `/supplier-share/${link}` });
    expect(read.statusCode).toBe(404);
  });
});
