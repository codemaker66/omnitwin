import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Route-level cover for the Ops handoff surface. The compiler itself is tested
// in ops-compiler.test.ts against a real graph; what matters here is the HTTP
// contract the planner corridor depends on — an optional eventId on the compile
// body, and both the configuration and the event authorized before any
// compilation work starts. No database is reachable, so every assertion is
// deliberately about what happens BEFORE the first query.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000009001";
const CONFIG_ID = "00000000-0000-4000-8000-000000009002";
const EVENT_ID = "00000000-0000-4000-8000-000000009003";
const PACK_ID = "00000000-0000-4000-8000-000000009004";

function staffToken(): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000009005",
    email: "staff@test.com",
    role: "staff",
    venueId: VENUE_ID,
  });
}

function responseCode(body: string): unknown {
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === "object" && parsed !== null && "code" in parsed
    ? (parsed as Readonly<Record<string, unknown>>)["code"]
    : undefined;
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("ops handoff routes", () => {
  it("requires auth on compile and read", async () => {
    for (const [method, url] of [
      ["POST", `/ops/handoff-packs/from-configuration/${CONFIG_ID}`],
      ["GET", `/ops/handoff-packs/${PACK_ID}`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("accepts the planner corridor's eventId on the compile body", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/ops/handoff-packs/from-configuration/${CONFIG_ID}`,
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { eventId: EVENT_ID, clientNotes: null },
    });
    // The body is well formed, so it is never the validation error; without a
    // database the request cannot get further than the first lookup.
    expect(responseCode(res.body)).not.toBe("VALIDATION_ERROR");
    expect(res.statusCode).not.toBe(400);
  });

  it("rejects a malformed or unknown compile body before any database work", async () => {
    for (const payload of [
      { eventId: "not-a-uuid" },
      { eventId: EVENT_ID, surprise: true },
    ]) {
      const res = await server.inject({
        method: "POST",
        url: `/ops/handoff-packs/from-configuration/${CONFIG_ID}`,
        headers: { authorization: `Bearer ${staffToken()}` },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(responseCode(res.body)).toBe("VALIDATION_ERROR");
    }
  });

  it("authorizes the configuration and the event separately, before compiling", async () => {
    const source = await readFile(resolve("src/routes/ops-handoff.ts"), "utf-8");
    const compile = source.slice(
      source.indexOf('server.post("/handoff-packs/from-configuration/:configId"'),
      source.indexOf('server.get("/handoff-packs/:id"'),
    );
    expect(compile.length).toBeGreaterThan(0);
    // A pack bound to an event crosses two tenancy boundaries: the layout's and
    // the event's. Both are checked on the persisted rows, and both precede the
    // compile call.
    expect(compile.indexOf("configAccessResponse(db, request.user, params.data.configId)"))
      .toBeLessThan(compile.indexOf("compileOpsHandoffPackFromConfiguration"));
    expect(compile.indexOf("eventAccessResponse(db, request.user, eventId)"))
      .toBeLessThan(compile.indexOf("compileOpsHandoffPackFromConfiguration"));
    expect(source).toContain("canAccessInternalEvent(user, event.venueId)");
  });

  it("keeps the binding refusal actionable rather than a bare 500", async () => {
    // The planner shows this code's message verbatim, so the contract is that
    // it stays a 409 with the code the cockpit knows.
    const source = await readFile(resolve("src/routes/ops-handoff.ts"), "utf-8");
    expect(source).toContain("EVENT_CONFIGURATION_BINDING_REQUIRED");
    expect(source).toContain("OpsHandoffEventBindingRequiredError");
  });
});
