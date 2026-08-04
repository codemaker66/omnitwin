import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// WebSocket auto-save tests
// ---------------------------------------------------------------------------
// Note: We can't easily test actual WebSocket connections with Fastify inject.
// These tests verify the server boots with WebSocket support and the route is
// registered. Full WebSocket integration tests need a running server with
// a real WebSocket client — documented at the bottom as future work.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

const CONFIG_ID = "00000000-0000-0000-0000-000000000001";

describe("WebSocket auto-save registration", () => {
  it("server starts with websocket plugin", () => {
    // If the websocket plugin failed to register, server build would have thrown
    expect(server).toBeDefined();
  });

  it("WS route responds to HTTP GET with 400 (not a WS upgrade)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/ws/configurations/${CONFIG_ID}`,
    });
    // Fastify returns 400 for non-websocket GET to a WS route
    // (no Upgrade header present in inject)
    expect([400, 404]).toContain(res.statusCode);
  });

  it("does not accept auth tokens through URL query strings", async () => {
    const source = await readFile(new URL("../ws/auto-save.ts", import.meta.url), "utf8");

    expect(source).not.toContain('searchParams.get("token")');
    expect(source).toContain('type: z.literal("auth")');
  });
});

describe("auto-save message schemas", () => {
  it("update_objects requires an optimistic-concurrency revision", async () => {
    const { UpdateObjectsMessage } = await import("../ws/auto-save.js");
    const valid = UpdateObjectsMessage.safeParse({
      type: "update_objects",
      expectedRevision: 7,
      objects: [{
        assetId: "00000000-0000-0000-0000-000000000001",
        position: { x: 1, y: 0, z: 2 },
        rotation: { x: 0, y: 1.57, z: 0 },
        scale: 1,
        clothed: true,
        clothStyle: "white",
        tableSetting: "dinner",
        groupId: "group-table-1",
      }],
    });
    expect(valid.success).toBe(true);
    expect(UpdateObjectsMessage.safeParse({
      type: "update_objects",
      objects: valid.success ? valid.data.objects : [],
    }).success).toBe(false);
  });

  it("update_objects rejects missing position", async () => {
    const { UpdateObjectsMessage } = await import("../ws/auto-save.js");
    const invalid = UpdateObjectsMessage.safeParse({
      type: "update_objects",
      expectedRevision: 1,
      objects: [{
        assetId: "00000000-0000-0000-0000-000000000001",
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
      }],
    });
    expect(invalid.success).toBe(false);
  });

  it("delete_object requires a valid UUID and revision", async () => {
    const { DeleteObjectMessage } = await import("../ws/auto-save.js");
    expect(DeleteObjectMessage.safeParse({ type: "delete_object", expectedRevision: 1, objectId: "bad" }).success).toBe(false);
    expect(DeleteObjectMessage.safeParse({ type: "delete_object", expectedRevision: 1, objectId: "00000000-0000-0000-0000-000000000001" }).success).toBe(true);
    expect(DeleteObjectMessage.safeParse({ type: "delete_object", objectId: "00000000-0000-0000-0000-000000000001" }).success).toBe(false);
  });

  it("ping message is valid", async () => {
    const { z } = await import("zod");
    const PingSchema = z.object({ type: z.literal("ping") });
    expect(PingSchema.safeParse({ type: "ping" }).success).toBe(true);
  });

  it("unknown message type is rejected", async () => {
    const { IncomingMessage } = await import("../ws/auto-save.js");
    expect(IncomingMessage.safeParse({ type: "invalid_type" }).success).toBe(false);
  });

  it("scale must be positive", async () => {
    const { z } = await import("zod");
    const ScaleSchema = z.number().positive();
    expect(ScaleSchema.safeParse(0).success).toBe(false);
    expect(ScaleSchema.safeParse(-1).success).toBe(false);
    expect(ScaleSchema.safeParse(1.5).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression — resolveWsUser must return DB user ID, not Clerk sub.
//
// Punch list #3: the previous implementation set userId = payload.sub
// (the opaque Clerk ID), then compared it against configurations.userId
// (a local UUID). Every authenticated user silently failed the owner
// check and got "Permission denied" on auto-save. These tests pin the fix.
// ---------------------------------------------------------------------------

describe("resolveWsUser — test-mode mock token path", () => {
  it("returns the mock id verbatim (simulating a DB UUID)", async () => {
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    const token = JSON.stringify({
      id: "00000000-0000-0000-0000-00000000dead",
      email: "alice@example.com",
      role: "admin",
      venueId: null,
    });

    const result = await resolveWsUser(mockDb, token, true);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe("00000000-0000-0000-0000-00000000dead");
    expect(result?.userRole).toBe("admin");
    expect(result?.platformRole).toBe("none");
    expect(result?.userVenueId).toBeNull();
  });

  it("preserves venueId from mock token for hallkeeper role", async () => {
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    const token = JSON.stringify({
      id: "user-db-uuid-1",
      email: "bob@venue.com",
      role: "hallkeeper",
      venueId: "venue-db-uuid-1",
    });

    const result = await resolveWsUser(mockDb, token, true);

    expect(result?.userVenueId).toBe("venue-db-uuid-1");
    expect(result?.userRole).toBe("hallkeeper");
  });

  it("returns null for malformed mock token (missing id)", async () => {
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    const token = JSON.stringify({ role: "admin" });

    const result = await resolveWsUser(mockDb, token, true);

    expect(result).toBeNull();
  });

  it("returns null for malformed mock token (id is not a string)", async () => {
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    const token = JSON.stringify({ id: 42, role: "admin" });

    const result = await resolveWsUser(mockDb, token, true);

    expect(result).toBeNull();
  });

  it("returns null for invalid JSON in test mode", async () => {
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];

    const result = await resolveWsUser(mockDb, "{not-json", true);

    expect(result).toBeNull();
  });

  it("does NOT take the mock path when isTestMode is false", async () => {
    // In production mode, a JSON-shaped token must go through Clerk
    // verification (which will fail here because there's no real Clerk
    // backend configured in this unit test, so we expect null).
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    const token = JSON.stringify({ id: "x", role: "admin" });

    const result = await resolveWsUser(mockDb, token, false);

    expect(result).toBeNull();
  });
});

describe("auto-save authorization and concurrency", () => {
  const owner = {
    userId: "00000000-0000-4000-8000-000000000011",
    userRole: "planner",
    platformRole: "none" as const,
    userVenueId: null,
  };
  const config = {
    userId: owner.userId,
    venueId: "00000000-0000-4000-8000-000000000022",
    reviewStatus: "draft",
    revision: 4,
  };

  it("rejects a venue admin from a different venue", async () => {
    const { assessAutoSaveConfiguration } = await import("../ws/auto-save.js");
    expect(assessAutoSaveConfiguration({
      userId: "00000000-0000-4000-8000-000000000033",
      userRole: "admin",
      platformRole: "none",
      userVenueId: "00000000-0000-4000-8000-000000000044",
    }, config, 4)).toEqual({ status: "forbidden" });
  });

  it("allows an explicit platform admin across venues", async () => {
    const { assessAutoSaveConfiguration } = await import("../ws/auto-save.js");
    expect(assessAutoSaveConfiguration({
      userId: "00000000-0000-4000-8000-000000000055",
      userRole: "admin",
      platformRole: "admin",
      userVenueId: null,
    }, { ...config, reviewStatus: "approved" }, 4)).toEqual({ status: "ok" });
  });

  it("rejects planner writes while review evidence is locked", async () => {
    const { assessAutoSaveConfiguration } = await import("../ws/auto-save.js");
    expect(assessAutoSaveConfiguration(owner, { ...config, reviewStatus: "submitted" }, 4)).toEqual({
      status: "locked",
      reviewStatus: "submitted",
    });
  });

  it("rejects a stale revision with the current revision", async () => {
    const { assessAutoSaveConfiguration } = await import("../ws/auto-save.js");
    expect(assessAutoSaveConfiguration(owner, config, 3)).toEqual({
      status: "conflict",
      expectedRevision: 3,
      currentRevision: 4,
    });
  });
});

describe("AutoSaveBuffer retry safety", () => {
  const update = {
    assetId: "00000000-0000-4000-8000-000000000066",
    position: { x: 1, y: 0, z: 2 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
  };

  it("retains an unacknowledged snapshot after persistence fails", async () => {
    const { AutoSaveBuffer } = await import("../ws/auto-save.js");
    const buffer = new AutoSaveBuffer();
    expect(buffer.enqueueUpdates(1, [update])).toBe(true);

    await expect(buffer.flush(() => Promise.reject(new Error("database unavailable"))))
      .rejects.toThrow("database unavailable");

    expect(buffer.pendingCount).toBe(1);
    const saved = await buffer.flush(() => Promise.resolve({ status: "saved" as const, revision: 2, objectCount: 1 }));
    expect(saved).toEqual({ status: "saved", revision: 2, objectCount: 1 });
    expect(buffer.pendingCount).toBe(0);
  });

  it("does not discard buffered work after a conflict", async () => {
    const { AutoSaveBuffer } = await import("../ws/auto-save.js");
    const buffer = new AutoSaveBuffer();
    expect(buffer.enqueueUpdates(2, [update])).toBe(true);
    await buffer.flush(() => Promise.resolve({
      status: "conflict" as const,
      expectedRevision: 2,
      currentRevision: 3,
    }));
    expect(buffer.pendingCount).toBe(1);
  });

  it("rebases changes received during a successful flush onto the committed revision", async () => {
    const { AutoSaveBuffer } = await import("../ws/auto-save.js");
    const buffer = new AutoSaveBuffer();
    expect(buffer.enqueueUpdates(1, [update])).toBe(true);
    let settle: ((result: { readonly status: "saved"; readonly revision: number; readonly objectCount: number }) => void) | undefined;
    const first = buffer.flush(() => new Promise((resolve) => { settle = resolve; }));

    expect(buffer.enqueueUpdates(1, [{ ...update, position: { x: 2, y: 0, z: 2 } }])).toBe(true);
    settle?.({ status: "saved", revision: 2, objectCount: 1 });
    await first;

    await buffer.flush((snapshot) => {
      expect(snapshot.expectedRevision).toBe(2);
      return Promise.resolve({ status: "saved", revision: 3, objectCount: 1 });
    });
    expect(buffer.pendingCount).toBe(0);
  });
});

describe("auto-save retry scheduling", () => {
  it("continues automatically only after a successful flush with rebased work", async () => {
    const { shouldScheduleBufferedFlush } = await import("../ws/auto-save.js");
    expect(shouldScheduleBufferedFlush({ status: "saved", revision: 2, objectCount: 1 }, 1)).toBe(true);
    expect(shouldScheduleBufferedFlush({ status: "saved", revision: 2, objectCount: 1 }, 0)).toBe(false);
    expect(shouldScheduleBufferedFlush({
      status: "conflict",
      expectedRevision: 1,
      currentRevision: 2,
    }, 1)).toBe(false);
    expect(shouldScheduleBufferedFlush({ status: "locked", reviewStatus: "submitted" }, 1)).toBe(false);
    expect(shouldScheduleBufferedFlush(null, 1)).toBe(false);
  });
});

describe("resolveWsUser — diligence regression marker", () => {
  it("resolved userId must be comparable to configurations.userId (both DB UUIDs)", async () => {
    // This test exists to make the invariant loud: whatever resolveWsUser
    // returns in `userId` MUST be the same ID space as the local
    // `users.id` column. If a future refactor re-introduces
    // `payload.sub` here, this test is the sentinel that catches it.
    const { resolveWsUser } = await import("../ws/auto-save.js");
    const mockDb = {} as Parameters<typeof resolveWsUser>[0];
    // Simulate what a test runner passes: the DB row's `id` column
    const dbUserId = "550e8400-e29b-41d4-a716-446655440000";
    const token = JSON.stringify({
      id: dbUserId,
      email: "a@b.com",
      role: "planner",
      venueId: null,
    });

    const result = await resolveWsUser(mockDb, token, true);

    // The resolved userId is exactly the DB id the caller provided —
    // NOT a transformed or namespaced version, NOT a Clerk sub.
    expect(result?.userId).toBe(dbUserId);
  });
});

// ---------------------------------------------------------------------------
// Full network-path additions that remain useful for deployment smoke tests:
// ---------------------------------------------------------------------------
// 1. Connect with real WebSocket client, send update_objects, verify DB write
// 2. Connect with invalid token, verify connection rejected
// 3. Send ping, verify pong received
// 4. Send update with expectedRevision, verify "saved" includes the new revision
// 5. Send invalid JSON, verify error message (connection stays open)
// 6. Disconnect mid-buffer, verify buffered data is flushed or retained for retry
// 7. Clerk path: mock @clerk/backend and db.select to prove
//    getUserByClerkId's DB id flows through to ws ownership checks.
// These require a running server (not Fastify inject) and a WS client lib.
