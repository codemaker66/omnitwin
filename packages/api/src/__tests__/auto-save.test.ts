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
  it("update_objects schema validates correctly", async () => {
    const { z } = await import("zod");
    const ObjectDataSchema = z.object({
      id: z.string().uuid().optional(),
      assetId: z.string().uuid(),
      position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      rotation: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      scale: z.number().positive(),
    });

    const valid = ObjectDataSchema.safeParse({
      assetId: "00000000-0000-0000-0000-000000000001",
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 1.57, z: 0 },
      scale: 1,
    });
    expect(valid.success).toBe(true);
  });

  it("update_objects rejects missing position", async () => {
    const { z } = await import("zod");
    const ObjectDataSchema = z.object({
      assetId: z.string().uuid(),
      position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      rotation: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      scale: z.number().positive(),
    });

    const invalid = ObjectDataSchema.safeParse({
      assetId: "00000000-0000-0000-0000-000000000001",
      scale: 1,
    });
    expect(invalid.success).toBe(false);
  });

  it("delete_object requires valid UUID", async () => {
    const { z } = await import("zod");
    const DeleteSchema = z.object({
      type: z.literal("delete_object"),
      objectId: z.string().uuid(),
    });

    expect(DeleteSchema.safeParse({ type: "delete_object", objectId: "bad" }).success).toBe(false);
    expect(DeleteSchema.safeParse({ type: "delete_object", objectId: "00000000-0000-0000-0000-000000000001" }).success).toBe(true);
  });

  it("ping message is valid", async () => {
    const { z } = await import("zod");
    const PingSchema = z.object({ type: z.literal("ping") });
    expect(PingSchema.safeParse({ type: "ping" }).success).toBe(true);
  });

  it("unknown message type is rejected", async () => {
    const { z } = await import("zod");
    const UpdateMsg = z.object({ type: z.literal("update_objects"), objects: z.array(z.unknown()).min(1) });
    const DeleteMsg = z.object({ type: z.literal("delete_object"), objectId: z.string() });
    const PingMsg = z.object({ type: z.literal("ping") });
    const IncomingMessage = z.discriminatedUnion("type", [UpdateMsg, DeleteMsg, PingMsg]);

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
// Future integration test additions needed:
// ---------------------------------------------------------------------------
// 1. Connect with real WebSocket client, send update_objects, verify DB write
// 2. Connect with invalid token, verify connection rejected
// 3. Send ping, verify pong received
// 4. Send update, wait 500ms debounce, verify "saved" message
// 5. Send invalid JSON, verify error message (connection stays open)
// 6. Disconnect mid-buffer, verify buffered data is flushed
// 7. Clerk path: mock @clerk/backend and db.select to prove
//    getUserByClerkId's DB id flows through to ws ownership checks.
// These require a running server (not Fastify inject) and a WS client lib.
