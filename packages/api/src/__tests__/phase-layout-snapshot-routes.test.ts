import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const CONFIGURATION_ID = "33333333-3333-4333-8333-333333333333";
const URL = `/events/${EVENT_ID}/phases/${PHASE_ID}/layout-snapshots`;

function token(role: "planner" | "staff" | "hallkeeper" = "staff"): string {
  return JSON.stringify({
    id: "99999999-9999-4999-8999-999999999999",
    email: "staff@test.com",
    role,
    venueId: "44444444-4444-4444-8444-444444444444",
  });
}

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("phase layout snapshot route boundary", () => {
  it("is registered and requires authentication", async () => {
    const response = await server.inject({
      method: "POST",
      url: URL,
      payload: { configurationId: CONFIGURATION_ID },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects malformed path and body identities before database access", async () => {
    const cases = [
      { url: `/events/not-an-id/phases/${PHASE_ID}/layout-snapshots`, payload: { configurationId: CONFIGURATION_ID } },
      { url: URL, payload: { configurationId: "not-an-id" } },
      { url: URL, payload: { configurationId: CONFIGURATION_ID, objects: [] } },
    ];
    for (const testCase of cases) {
      const response = await server.inject({
        method: "POST",
        url: testCase.url,
        headers: { authorization: `Bearer ${token()}` },
        payload: testCase.payload,
      });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it.each(["planner", "hallkeeper"] as const)(
    "returns an exact 403 for the read-only %s role before database access",
    async (role) => {
      const response = await server.inject({
        method: "POST",
        url: URL,
        headers: { authorization: `Bearer ${token(role)}` },
        payload: { configurationId: CONFIGURATION_ID },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toEqual({
        error: "Insufficient permissions",
        code: "FORBIDDEN",
      });
    },
  );
});

describe("phase layout snapshot route source contract", () => {
  it("authorizes writes against loaded event and configuration venues", async () => {
    const source = await readFile(resolve("src/routes/phase-layout-snapshots.ts"), "utf-8");
    expect(source).toContain("db.transaction(async (tx)");
    expect(source).toContain("READ COMMITTED is intentional");
    expect(source).not.toContain("set transaction isolation level repeatable read");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("observedConfiguration");
    expect(source).toContain("configuration.revision !== observedConfiguration.revision");
    expect(source).toContain('.for("share")');
    expect(source.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(source.indexOf("observedConfiguration"));
    expect(source.indexOf("observedConfiguration"))
      .toBeLessThan(source.indexOf('.for("share")'));
    expect(source).toContain("isEventWriteRole(request.user)");
    expect(source.match(/canWriteEvents\(/gu)).toHaveLength(3);
    expect(source).not.toContain("canAccessResource(");
    expect(source).toContain("verifyFreezablePhaseLayoutSnapshot({");
    expect(source).toContain('postgresErrorCode(error) === "40001"');
  });

  it("copies the verified server payload into an append-only frozen row", async () => {
    const source = await readFile(resolve("src/routes/phase-layout-snapshots.ts"), "utf-8");
    expect(source).toContain("payload: verified.payload");
    expect(source).toContain("snapshotHash: verified.snapshotHash");
    expect(source).toContain("canonicalSnapshotId: verified.canonicalSnapshotId");
    expect(source).toContain("proofDigest: verified.proofDigest");
    expect(source).toContain("supersedesSnapshotId: current?.id ?? null");
    expect(source).toContain("row.guestCount !== guestCount");
    expect(source).toContain("frozenBy: request.user.id");
    expect(source).toContain('status: "frozen"');
    expect(source).toContain("coordinateSpace: REAL_METRE_COORDINATE_SPACE");
    expect(source).not.toContain("tx.update(phaseLayoutSnapshots)");
    expect(source).not.toContain("tx.delete(phaseLayoutSnapshots)");
  });

  it("serializes each phase and derives idempotency from the current immutable predecessor", async () => {
    const source = await readFile(resolve("src/routes/phase-layout-snapshots.ts"), "utf-8");
    expect(source).toContain("phaseLayoutSnapshotAppendId(");
    expect(source).toContain("coalesce(${phaseLayoutSnapshots.frozenAt}, ${phaseLayoutSnapshots.createdAt})");
    expect(source).toContain("current?.id ?? null");
    expect(source).toContain('outcome: "already_current"');
    expect(source).toContain("supersedesSnapshotId: current?.id ?? null");
  });
});
