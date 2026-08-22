import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { RuntimePackageSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { isCanonicalGrandHallRuntimePackage } from "../lib/grand-hall-frontier-contract.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import {
  assetRoutes,
  type AssetVersionRow,
  type LatestRuntimePackageDiscovery,
  type RuntimePackageRow,
  validateExactGrandHallRuntimeStorage,
} from "../routes/assets.js";

process.env["NODE_ENV"] = "test";

vi.mock("../lib/grand-hall-frontier-contract.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../lib/grand-hall-frontier-contract.js")
  >();
  return { ...actual, isCanonicalGrandHallRuntimePackage: vi.fn() };
});

const TRADES_HALL_VENUE_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "40000000-0000-4000-8000-000000000002";
const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-21T12:00:00.000Z");
const SHA256 = "a".repeat(64);
const R2_KEY = "r2:venues/trades-hall/rooms/grand-hall/exact/0_0_0_1_0_1.sog";

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://mock:mock@localhost/mock",
  PORT: 3001,
  EMAIL_FROM: "VenViewer <notifications@venviewer.com>",
  CORS_ORIGINS: "http://localhost:5173",
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  AI_ASSISTANT_ENABLED: "false",
} satisfies Env;

function token(
  role: string,
  venueId: string | null,
  platformRole: "none" | "operator" | "admin" = "none",
): string {
  return JSON.stringify({
    id: "30000000-0000-4000-8000-000000000001",
    email: "runtime-user@example.test",
    role,
    platformRole,
    venueId,
  });
}

function asset(roomSlug = "grand-hall"): AssetVersionRow {
  return {
    id: ASSET_ID,
    venueSlug: "trades-hall",
    roomSlug,
    captureSessionId: "50000000-0000-4000-8000-000000000001",
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: "0_0_0_1_0_1.sog",
    fileExt: ".sog",
    r2Key: R2_KEY,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: SHA256,
    sizeBytes: 9_980_174,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: "Private operator storage note",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runtimePackage(
  runtimeStatus: RuntimePackageRow["runtimeStatus"] = "internal_ready",
  roomSlug = "grand-hall",
): RuntimePackageRow {
  const visual = asset(roomSlug);
  return {
    id: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug,
    revision: 3,
    identityKind: "content_sha256",
    contentDigest: "b".repeat(64),
    primaryVisualAssetVersionId: ASSET_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_ID,
        visualAssetVersionIds: [ASSET_ID],
        visualAssetReceipts: [{
          assetVersionId: ASSET_ID,
          fileName: visual.fileName,
          fileExt: ".sog",
          sha256: SHA256,
          sizeBytes: visual.sizeBytes ?? 0,
          storageKeySha256: runtimeAssetStorageKeySha256(R2_KEY),
        }],
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function discovery(
  runtimeStatus: RuntimePackageRow["runtimeStatus"] = "internal_ready",
  roomSlug = "grand-hall",
): LatestRuntimePackageDiscovery {
  const primaryVisualAssetVersion = asset(roomSlug);
  return {
    pkg: runtimePackage(runtimeStatus, roomSlug),
    primaryVisualAssetVersion,
    visualAssetVersions: [primaryVisualAssetVersion],
  };
}

describe("venue-scoped Grand Hall runtime discovery", () => {
  let server: FastifyInstance;
  let resolveRuntimeVenueId: Mock<(venueSlug: string) => Promise<string | null>>;
  let loadLatestRuntimePackage: Mock<(
    venueSlug: string,
    roomSlug: string,
    includeInternalReady: boolean,
  ) => Promise<LatestRuntimePackageDiscovery | null>>;

  beforeEach(async () => {
    vi.mocked(isCanonicalGrandHallRuntimePackage).mockReturnValue(true);
    resolveRuntimeVenueId = vi.fn(() => Promise.resolve(TRADES_HALL_VENUE_ID));
    loadLatestRuntimePackage = vi.fn(() => Promise.resolve(discovery()));
    server = Fastify();
    await server.register(assetRoutes, {
      db: {} as Database,
      env: testEnv,
      resolveRuntimeVenueId,
      loadLatestRuntimePackage,
      prefix: "/assets",
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("requires authentication before discovery", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
    });
    expect(response.statusCode).toBe(401);
    expect(loadLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("lets assigned Trades Hall staff discover internal-ready Grand Hall without storage URLs", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
      headers: { authorization: `Bearer ${token("staff", TRADES_HALL_VENUE_ID)}` },
    });

    expect(response.statusCode).toBe(200);
    const runtime = RuntimePackageSchema.parse(response.json().data);
    expect(runtime).toMatchObject({
      id: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      runtimeStatus: "internal_ready",
      primaryVisualAssetUrl: null,
      visualAssetUrls: [],
    });
    expect(runtime.primaryVisualAssetVersion).toMatchObject({
      id: ASSET_ID,
      r2Key: null,
      externalUrl: null,
      captureSessionId: null,
      notes: null,
      sha256: SHA256,
      sizeBytes: 9_980_174,
    });
    expect(resolveRuntimeVenueId).toHaveBeenCalledWith("trades-hall");
    expect(loadLatestRuntimePackage).toHaveBeenCalledWith("trades-hall", "grand-hall", true);
  });

  it.each([
    ["staff from another venue", token("staff", OTHER_VENUE_ID)],
    ["venue planner", token("planner", TRADES_HALL_VENUE_ID)],
    ["venue client", token("client", TRADES_HALL_VENUE_ID)],
  ])("rejects %s before package lookup", async (_label, authorization) => {
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
      headers: { authorization: `Bearer ${authorization}` },
    });
    expect(response.statusCode).toBe(403);
    expect(loadLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("does not let venue staff discover any other room package", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      headers: { authorization: `Bearer ${token("staff", TRADES_HALL_VENUE_ID)}` },
    });
    expect(response.statusCode).toBe(403);
    expect(resolveRuntimeVenueId).not.toHaveBeenCalled();
    expect(loadLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("fails closed when the discovery loader substitutes another package target", async () => {
    loadLatestRuntimePackage.mockResolvedValue(discovery("internal_ready", "reception-room"));
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
      headers: { authorization: `Bearer ${token("staff", TRADES_HALL_VENUE_ID)}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });

  it("fails closed when metadata is not the canonical eleven-member frontier", async () => {
    vi.mocked(isCanonicalGrandHallRuntimePackage).mockReturnValue(false);
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
      headers: { authorization: `Bearer ${token("staff", TRADES_HALL_VENUE_ID)}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });

  it.each([
    ["another room", "r2:venues/trades-hall/rooms/reception-room/exact/member.sog"],
    ["another venue", "r2:venues/other-venue/rooms/grand-hall/exact/member.sog"],
  ])("does not discover a Grand Hall package backed by %s storage", async (_label, r2Key) => {
    const wrongNamespace = discovery();
    wrongNamespace.primaryVisualAssetVersion.r2Key = r2Key;
    loadLatestRuntimePackage.mockResolvedValue(wrongNamespace);

    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=grand-hall",
      headers: { authorization: `Bearer ${token("staff", TRADES_HALL_VENUE_ID)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });

  it("preserves platform-admin published discovery without venue lookup or redaction", async () => {
    loadLatestRuntimePackage.mockResolvedValue(discovery("published", "reception-room"));
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      headers: { authorization: `Bearer ${token("admin", null, "admin")}` },
    });

    expect(response.statusCode).toBe(200);
    const runtime = RuntimePackageSchema.parse(response.json().data);
    expect(runtime.roomSlug).toBe("reception-room");
    expect(runtime.primaryVisualAssetVersion?.r2Key).toBe(R2_KEY);
    expect(runtime.primaryVisualAssetVersion?.notes).toBe("Private operator storage note");
    expect(resolveRuntimeVenueId).not.toHaveBeenCalled();
    expect(loadLatestRuntimePackage).toHaveBeenCalledWith("trades-hall", "reception-room", false);
  });
});

describe("Grand Hall immutable package storage admission", () => {
  it("admits only a complete exact private room namespace", () => {
    expect(validateExactGrandHallRuntimeStorage(
      { venueSlug: "trades-hall", roomSlug: "grand-hall", runtimeStatus: "internal_ready" },
      [asset()],
    )).toBeNull();

    for (const unauthorized of [
      {
        ...asset(),
        r2Key: "r2:venues/trades-hall/rooms/reception-room/exact/member.sog",
      },
      {
        ...asset(),
        r2Key: "r2:venues/other-venue/rooms/grand-hall/exact/member.sog",
      },
      {
        ...asset(),
        externalUrl: "https://assets.example.test/member.sog",
      },
    ]) {
      expect(validateExactGrandHallRuntimeStorage(
        { venueSlug: "trades-hall", roomSlug: "grand-hall", runtimeStatus: "internal_ready" },
        [unauthorized],
      )).toMatch(/protected Trades Hall Grand Hall storage keys/u);
    }

    expect(validateExactGrandHallRuntimeStorage(
      { venueSlug: "trades-hall", roomSlug: "grand-hall", runtimeStatus: "draft" },
      [],
    )).toBeNull();
  });
});
