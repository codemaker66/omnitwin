import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ACTION_LOG_MAX_BATCH, ACTION_MAX_DEPTH } from "@omnitwin/types";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// G4 Slice 3 — the action-log write/read surface. Auth + validation boundary
// through the real server (body bounds run BEFORE any db touch, so the
// ingestion caps are provable without a live database), plus source-contract
// pins for the invariants that need one (idempotent conflict handling,
// ordinal ordering, access-check ordering, append-only code contract).
// ---------------------------------------------------------------------------

let server: FastifyInstance;

const CONFIG_ID = "00000000-0000-4000-8000-000000000021";
const USER_ID = "00000000-0000-4000-8000-000000000099";

const token = (): string =>
  JSON.stringify({ id: USER_ID, email: "planner@test.com", role: "customer", venueId: null });

function action(id: string, payload: unknown = { label: "Place" }): Record<string, unknown> {
  return {
    id,
    actor: { kind: "operator", ref: USER_ID },
    intent: "object.place",
    payload,
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    ts: "2026-07-18T10:00:00.000Z",
  };
}

function batchBody(actions: readonly unknown[]): Record<string, unknown> {
  return {
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    actions,
  };
}

function nested(depth: number): unknown {
  let value: unknown = true;
  for (let i = 0; i < depth; i += 1) value = { next: value };
  return value;
}

beforeAll(async () => {
  server = await buildServer();
});
afterAll(async () => {
  await server.close();
});

describe("action-log routes: auth boundary", () => {
  it("rejects unauthenticated writes and reads", async () => {
    const post = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/actions`,
      payload: batchBody([action("6f9619ff-8b86-4d01-b42d-00cf4fc964ff")]),
    });
    expect(post.statusCode).toBe(401);

    const get = await server.inject({
      method: "GET",
      url: `/configurations/${CONFIG_ID}/actions`,
    });
    expect(get.statusCode).toBe(401);
  });

  it("rejects a malformed configuration id", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations/not-a-uuid/actions",
      headers: { authorization: `Bearer ${token()}` },
      payload: batchBody([action("6f9619ff-8b86-4d01-b42d-00cf4fc964ff")]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("action-log routes: ingestion bounds run before any db touch", () => {
  it("rejects a schema-invalid batch body", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/actions`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { batchId: "not-a-uuid", revision: -1, actions: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized batch", async () => {
    const oversized = Array.from({ length: ACTION_LOG_MAX_BATCH + 1 }, (_, i) =>
      action(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/actions`,
      headers: { authorization: `Bearer ${token()}` },
      payload: batchBody(oversized),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects over-deep and prototype-polluting payloads at the boundary", async () => {
    const deep = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/actions`,
      headers: { authorization: `Bearer ${token()}` },
      payload: batchBody([
        action("6f9619ff-8b86-4d01-b42d-00cf4fc964ff", nested(ACTION_MAX_DEPTH + 5)),
      ]),
    });
    expect(deep.statusCode).toBe(400);

    // Raw body: JSON.parse must be the one constructing the __proto__ own-key
    // (an object literal here would set the prototype instead).
    const polluted = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/actions`,
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload:
        '{"batchId":"0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e","revision":3,"actions":[{"id":"6f9619ff-8b86-4d01-b42d-00cf4fc964ff","actor":{"kind":"operator"},"intent":"object.place","payload":{"__proto__":{"polluted":true}},"inverse":null,"provenance":{"surface":"planner"},"ts":"2026-07-18T10:00:00.000Z"}]}',
    });
    expect(polluted.statusCode).toBe(400);
  });

  it("bounds the read query (limit and cursor)", async () => {
    for (const query of ["?limit=0", "?limit=501", "?after=-1", "?after=NaN"]) {
      const res = await server.inject({
        method: "GET",
        url: `/configurations/${CONFIG_ID}/actions${query}`,
        headers: { authorization: `Bearer ${token()}` },
      });
      expect(res.statusCode, query).toBe(400);
    }
  });
});

describe("action-log routes: source contract (db-dependent invariants)", () => {
  it("pins idempotent append-only ingestion and ordinal-ordered reads", async () => {
    const source = await readFile(resolve("src/routes/action-log.ts"), "utf8");
    // Idempotent retries: client action id is the conflict target, silently skipped.
    expect(source).toContain("onConflictDoNothing({ target: actionLog.id })");
    // The audit read pages by the server-assigned ordinal, never client time.
    expect(source).toMatch(/orderBy\(\s*actionLog\.ordinal\s*\)/);
    // Append-only code contract: the route never updates or deletes.
    expect(source).not.toMatch(/\.update\(|\.delete\(/);
    // Access check runs in both handlers before touching the log.
    expect((source.match(/verifyConfigAccess\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The bounded ingestion contract is the parse gate (not bare ActionSchema).
    expect(source).toContain("ActionLogBatchSchema");
    // Claim safety: operator clock and server clock stay distinct fields.
    expect(source).toContain("recordedTs");
    expect(source).toContain("receivedAt");
  });

  it("pins the route registration prefix", async () => {
    const index = await readFile(resolve("src/index.ts"), "utf8");
    expect(index).toContain('prefix: "/configurations/:configId/actions"');
  });
});
