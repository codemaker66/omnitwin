import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

const signToken = (payload: { id: string; email: string; role: string; venueId: string | null }): string =>
  JSON.stringify(payload);
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const plannerToken = (): string => signToken({ id: "u2", email: "planner@test.com", role: "planner", venueId: "v1" });

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

const validVersionBody = {
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  assetKind: "splat",
  sourceType: "xgrids",
  r2Key: "venues/trades-hall/rooms/robert-adam-room/xgrids/2026-06-06/scene.ply",
  fileName: "scene.ply",
  fileExt: ".ply",
  sha256: SHA,
};

const validRuntimePackageBody = {
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  primaryVisualAssetVersionId: ASSET_VERSION_ID,
  manifestJson: {
    schemaVersion: "venviewer.runtime-package.v1",
    venueSlug: "trades-hall",
    roomSlug: "robert-adam-room",
    packageType: "room-runtime",
    assets: {
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
    },
  },
  runtimeStatus: "internal_ready",
};

describe("GET /assets", () => {
  it("is publicly reachable (no 404, no 401)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets",
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(401);
  });
});

describe("GET /assets/runtime-packages/latest", () => {
  it("validates venue and room query params before querying", async () => {
    const res = await server.inject({ method: "GET", url: "/assets/runtime-packages/latest" });
    expect(res.statusCode).toBe(400);
  });

  it("returns an empty safe state when no runtime registry row can be read", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=robert-adam-room",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null });
  });

  it("rejects unsupported Trades Hall room slugs before lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=made-up-room",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /assets/runtime-assets/:assetVersionId", () => {
  it("rejects malformed asset version IDs before storage lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-assets/not-a-runtime-asset-id",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unsupported range headers before runtime lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/assets/runtime-assets/${ASSET_VERSION_ID}`,
      headers: { range: "items=0-10" },
    });
    expect(res.statusCode).toBe(416);
    expect(res.json()).toMatchObject({
      code: "UNSUPPORTED_RANGE",
    });
  });
});

describe("GET /assets/runtime-packages/public-room-visual", () => {
  it("validates venue and room query params before querying", async () => {
    const res = await server.inject({ method: "GET", url: "/assets/runtime-packages/public-room-visual" });
    expect(res.statusCode).toBe(400);
  });

  it("returns a client-safe fallback when no runtime visual can be read", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/public-room-visual?venue=trades-hall&room=grand-hall",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        venueSlug: "trades-hall",
        roomSlug: "grand-hall",
        runtimeVisualAvailable: false,
        visualUrl: null,
        visualLabel: "Visual preview",
        safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
        humanReviewRequired: true,
      },
    });
  });

  it("does not expose internal asset registry fields in the public fallback payload", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/public-room-visual?venue=trades-hall&room=robert-adam-room",
    });
    const bodyText = res.body;
    const data = res.json<{ data: Record<string, unknown> }>().data;

    expect(res.statusCode).toBe(200);
    expect(data["id"]).toBeUndefined();
    expect(data["primaryVisualAssetVersionId"]).toBeUndefined();
    expect(data["primaryVisualAssetVersion"]).toBeUndefined();
    expect(data["manifestJson"]).toBeUndefined();
    expect(bodyText).not.toMatch(/r2Key|runtime_packages|primaryVisualAssetVersionId|manifestJson/u);
  });

  it("rejects unsupported Trades Hall room slugs before lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/public-room-visual?venue=trades-hall&room=made-up-room",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/assets/register-version", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      payload: validVersionBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validVersionBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a fixture/demo asset key with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, r2Key: "dev/splat-fixture/scene.ply" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an arbitrary asset URL with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, r2Key: "https://assets.example/scene.ply" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a mismatched file extension with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, fileExt: ".spz" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed sha256 with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, sha256: "not-a-hash" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unsupported Trades Hall room slugs with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-version",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, roomSlug: "made-up-room" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/assets/register-runtime-package", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-package",
      payload: validRuntimePackageBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-package",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validRuntimePackageBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a manifest whose room does not match the package room", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-package",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validRuntimePackageBody,
        roomSlug: "saloon",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a loadable package without a primary visual asset", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-package",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        venueSlug: "trades-hall",
        roomSlug: "saloon",
        primaryVisualAssetVersionId: null,
        manifestJson: {
          schemaVersion: "venviewer.runtime-package.v1",
          venueSlug: "trades-hall",
          roomSlug: "saloon",
          packageType: "room-runtime",
          assets: {
            primaryVisualAssetVersionId: null,
            semanticMeshAssetVersionId: null,
            collisionAssetVersionId: null,
            pointCloudAssetVersionId: null,
          },
        },
        runtimeStatus: "internal_ready",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /admin/assets/room-manifests", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/admin/assets/room-manifests" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/room-manifests",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /admin/assets/rooms", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/admin/assets/rooms?venue=trades-hall" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/rooms?venue=trades-hall",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
