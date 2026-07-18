import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  RegisterRuntimePackageInputSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackagePreviewSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { matchReceptionReviewedRuntimeProfile } from "../lib/reception-reviewed-runtime-profile.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import type { AssetVersionRow, RuntimePackageRow } from "../routes/assets.js";
import {
  previewStorageConfigured,
  runtimePackagePreviewRoutes,
  type RuntimePackagePreviewObject,
  type RuntimePackagePreviewSource,
} from "../routes/runtime-package-previews.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

process.env["NODE_ENV"] = "test";

vi.mock("@omnitwin/reconstruction-foundry", async () =>
  import("./support/reconstruction-foundry-canonical-mock.js")
);

vi.mock("../lib/reception-reviewed-runtime-profile.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../lib/reception-reviewed-runtime-profile.js")
  >();
  return {
    ...actual,
    matchReceptionReviewedRuntimeProfile: vi.fn(),
  };
});

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
] as const;
const FILES = ["0_15_0_0.sog", "0_1_0_5.sog", "0_6_0_0.sog", "0_7_0_0.sog"] as const;
const NOW = new Date("2026-07-14T12:00:00.000Z");

function testAssetBytes(index: number): Buffer {
  return Buffer.alloc(16 + index, index + 1);
}

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

describe("private runtime preview storage boundary", () => {
  it("accepts only the dedicated private runtime-profile connection", () => {
    expect(previewStorageConfigured({
      ...testEnv,
      R2_ACCOUNT_ID: "legacy-account",
      R2_ACCESS_KEY_ID: "legacy-key",
      R2_SECRET_ACCESS_KEY: "legacy-secret",
      R2_BUCKET_NAME: "legacy-public-assets",
      R2_PUBLIC_URL: "https://uploads.example.test",
    })).toBe(false);
    expect(previewStorageConfigured({
      ...testEnv,
      RUNTIME_PROFILE_R2_ACCOUNT_ID: "private-account",
      RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "private-key",
      RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "private-secret",
      RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "runtime-profiles-private",
    })).toBe(true);
  });
});

const adminToken = JSON.stringify({
  id: "30000000-0000-4000-8000-000000000001",
  email: "admin@test.com",
  role: "admin",
  platformRole: "admin",
  venueId: null,
});
const plannerToken = JSON.stringify({
  id: "30000000-0000-4000-8000-000000000002",
  email: "planner@test.com",
  role: "planner",
  platformRole: "none",
  venueId: null,
});

function runtimeAsset(index: number): AssetVersionRow {
  const id = ASSET_IDS[index];
  const fileName = FILES[index];
  if (id === undefined || fileName === undefined) throw new Error("test asset index is out of range");
  return {
    id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName,
    fileExt: ".sog",
    r2Key: `r2:venues/trades-hall/rooms/reception-room/quality/${fileName}`,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: createHash("sha256").update(testAssetBytes(index)).digest("hex"),
    sizeBytes: 16 + index,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function immutablePackage(overrides: Partial<RuntimePackageRow> = {}): RuntimePackageRow {
  const row: RuntimePackageRow = {
    id: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: 7,
    identityKind: "content_sha256",
    contentDigest: null,
    primaryVisualAssetVersionId: ASSET_IDS[0],
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_IDS[0],
        visualAssetVersionIds: [...ASSET_IDS],
        visualAssetReceipts: ASSET_IDS.map((_assetVersionId, index) => {
          const asset = runtimeAsset(index);
          if (asset.r2Key === null || asset.sha256 === null || asset.sizeBytes === null) {
            throw new Error("test preview asset must have complete protected storage identity");
          }
          return {
            assetVersionId: asset.id,
            fileName: asset.fileName,
            fileExt: ".sog" as const,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
            storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
          };
        }),
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  if (overrides.contentDigest === undefined && row.identityKind === "content_sha256") {
    const input = RegisterRuntimePackageInputSchema.parse({
      venueSlug: row.venueSlug,
      roomSlug: row.roomSlug,
      primaryVisualAssetVersionId: row.primaryVisualAssetVersionId,
      semanticMeshAssetVersionId: row.semanticMeshAssetVersionId,
      collisionAssetVersionId: row.collisionAssetVersionId,
      pointCloudAssetVersionId: row.pointCloudAssetVersionId,
      manifestJson: row.manifestJson,
      evidenceStatus: row.evidenceStatus,
      runtimeStatus: row.runtimeStatus,
    });
    row.contentDigest = computeRuntimePackageRevisionDigest(input);
  }
  return row;
}

function source(overrides: Partial<RuntimePackagePreviewSource> = {}): RuntimePackagePreviewSource {
  return {
    runtimePackage: immutablePackage(),
    // Deliberately unordered: the route must restore manifest order.
    candidateVisualAssets: [runtimeAsset(2), runtimeAsset(0), runtimeAsset(3), runtimeAsset(1)],
    ...overrides,
  };
}

describe("exact private runtime-package preview routes", () => {
  let server: FastifyInstance;
  let activeSource: RuntimePackagePreviewSource | null;
  let loadPreviewSource: Mock<(runtimePackageId: string) => Promise<RuntimePackagePreviewSource | null>>;
  let loadRuntimeAssetObject: Mock<(
    r2Key: string,
    signal: AbortSignal,
  ) => Promise<RuntimePackagePreviewObject | null>>;

  beforeEach(async () => {
    vi.mocked(matchReceptionReviewedRuntimeProfile).mockReturnValue("quality-sog-fine-v1");
    activeSource = source();
    loadPreviewSource = vi.fn(() => Promise.resolve(activeSource));
    loadRuntimeAssetObject = vi.fn((r2Key: string): Promise<RuntimePackagePreviewObject> => {
      const index = FILES.findIndex((file) => r2Key.endsWith(file));
      if (index < 0) throw new Error("unexpected test object key");
      const bytes = testAssetBytes(index);
      return Promise.resolve({
        body: Readable.from([bytes]),
        contentLength: bytes.byteLength,
        contentType: "application/octet-stream",
        etag: `"etag-${String(index)}"`,
      });
    });
    server = Fastify();
    await server.register(runtimePackagePreviewRoutes, {
      db: {} as Database,
      env: testEnv,
      prefix: "/admin/assets",
      loadPreviewSource,
      loadRuntimeAssetObject,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("requires platform-admin access before metadata lookup", async () => {
    const unauthenticated = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const nonAdmin = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${plannerToken}` },
    });
    expect(nonAdmin.statusCode).toBe(403);
    expect(loadPreviewSource).not.toHaveBeenCalled();
  });

  it("validates the exact package id before metadata lookup", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin/assets/runtime-package-previews/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(loadPreviewSource).not.toHaveBeenCalled();
  });

  it("returns exact ordered metadata without storage keys, URLs, or credentials", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["pragma"]).toBe("no-cache");
    expect(response.headers["vary"]).toBe("Origin, Authorization");
    const preview = RuntimePackagePreviewSchema.parse(response.json().data);
    expect(preview).toMatchObject({
      scope: "exact_private_runtime_package_preview",
      runtimePackageId: PACKAGE_ID,
      revision: 7,
      identityKind: "content_sha256",
      contentDigest: immutablePackage().contentDigest,
      issuedAt: "2026-07-14T12:00:00.000Z",
      runtimeStatus: "internal_ready",
      reviewedProfileId: "quality-sog-fine-v1",
    });
    expect(preview.visualAssets.map((asset) => asset.fileName)).toEqual(FILES);
    expect(preview.visualAssets.map((asset) => asset.assetVersionId)).toEqual(ASSET_IDS);
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain("r2:");
    expect(serialized).not.toContain("X-Amz");
    expect(serialized).not.toMatch(/https?:\/\//u);
    expect(loadPreviewSource).toHaveBeenCalledWith(PACKAGE_ID);
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();
  });

  it("fails closed when the Reception package has no reviewed profile identity", async () => {
    vi.mocked(matchReceptionReviewedRuntimeProfile).mockReturnValueOnce(null);

    const response = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_PROFILE_UNAPPROVED");
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();
  });

  it("refuses legacy, draft, rejected, and mismatched package records", async () => {
    for (const runtimePackage of [
      immutablePackage({ identityKind: "legacy", contentDigest: null }),
      immutablePackage({ runtimeStatus: "draft" }),
      immutablePackage({ evidenceStatus: "rejected" }),
      immutablePackage({ id: "20000000-0000-4000-8000-000000000099" }),
    ]) {
      activeSource = source({ runtimePackage });
      const response = await server.inject({
        method: "GET",
        url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect([404, 409]).toContain(response.statusCode);
    }
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();
  });

  it("allows a published immutable revision but rejects a malformed digest", async () => {
    activeSource = source({ runtimePackage: immutablePackage({ runtimeStatus: "published" }) });
    const published = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(published.statusCode).toBe(200);
    expect(RuntimePackagePreviewSchema.parse(published.json().data).runtimeStatus).toBe("published");

    activeSource = source({ runtimePackage: immutablePackage({ contentDigest: "not-a-digest" }) });
    const malformed = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(malformed.statusCode).toBe(409);
    expect(malformed.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_NOT_IMMUTABLE");
  });

  it("rejects package-content drift, missing receipts, and member-row substitution", async () => {
    const original = immutablePackage();
    const originalManifest = RuntimePackageManifestJsonSchema.parse(original.manifestJson);
    activeSource = source({
      runtimePackage: {
        ...original,
        manifestJson: { ...originalManifest, notes: "changed after package identity was issued" },
      },
    });
    const changedPackage = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(changedPackage.statusCode).toBe(409);
    expect(changedPackage.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_NOT_IMMUTABLE");

    const assetsWithoutReceipts = { ...originalManifest.assets };
    delete assetsWithoutReceipts.visualAssetReceipts;
    activeSource = source({
      runtimePackage: immutablePackage({
        manifestJson: {
          ...originalManifest,
          assets: assetsWithoutReceipts,
        },
      }),
    });
    const missingReceipts = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(missingReceipts.statusCode).toBe(409);
    expect(missingReceipts.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_RECEIPTS_REQUIRED");

    const substituted = runtimeAsset(0);
    substituted.r2Key = "r2:venues/trades-hall/rooms/reception-room/quality/replacement.sog";
    activeSource = source({
      candidateVisualAssets: [substituted, runtimeAsset(1), runtimeAsset(2), runtimeAsset(3)],
    });
    const changedMember = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(changedMember.statusCode).toBe(409);
    expect(changedMember.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_RECEIPTS_INVALID");
  });

  it("fails closed for partial composition or external storage", async () => {
    activeSource = source({ candidateVisualAssets: [runtimeAsset(0), runtimeAsset(1)] });
    const partial = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(partial.statusCode).toBe(409);
    expect(partial.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_COMPOSITION_INVALID");

    const externallyHosted = runtimeAsset(0);
    externallyHosted.externalUrl = "https://public.example/0_15_0_0.sog";
    activeSource = source({
      candidateVisualAssets: [externallyHosted, runtimeAsset(1), runtimeAsset(2), runtimeAsset(3)],
    });
    const external = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(external.statusCode).toBe(409);
    expect(external.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_STORAGE_INVALID");

    const duplicateKey = runtimeAsset(1);
    duplicateKey.r2Key = runtimeAsset(0).r2Key;
    activeSource = source({
      candidateVisualAssets: [runtimeAsset(0), duplicateKey, runtimeAsset(2), runtimeAsset(3)],
    });
    const duplicate = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_STORAGE_INVALID");
  });

  it("requires platform-admin access before streaming bytes", async () => {
    const path = `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
      `/assets/${ASSET_IDS[0]}/${FILES[0]}`;
    const unauthenticated = await server.inject({ method: "GET", url: path });
    expect(unauthenticated.statusCode).toBe(401);
    const nonAdmin = await server.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${plannerToken}` },
    });
    expect(nonAdmin.statusCode).toBe(403);
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();
  });

  it("streams only an exact declared member with protected no-store headers", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET_IDS[0]}/${FILES[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.alloc(16, 1));
    expect(response.headers["content-length"]).toBe("16");
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["vary"]).toBe("Origin, Authorization");
    expect(response.headers["x-content-sha256"]).toBe(runtimeAsset(0).sha256);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(loadRuntimeAssetObject).toHaveBeenCalledWith(
      `r2:venues/trades-hall/rooms/reception-room/quality/${FILES[0]}`,
      expect.any(AbortSignal),
    );
  });

  it("does not claim or leak a transfer slot after a client closes during lookup", async () => {
    const lookup = {
      resolve: null as ((value: RuntimePackagePreviewSource | null) => void) | null,
    };
    loadPreviewSource.mockImplementationOnce(() => new Promise((resolve) => {
      lookup.resolve = resolve;
    }));
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP test address");
    }
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.server.once("connection", (socket) => socket.once("close", resolve));
    });
    const path = `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
      `/assets/${ASSET_IDS[0]}/${FILES[0]}`;
    const client = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: "GET",
      path,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    client.on("error", () => undefined);
    client.end();
    await vi.waitFor(() => {
      expect(loadPreviewSource).toHaveBeenCalledTimes(1);
    });

    client.destroy();
    await serverSocketClosed;
    const resolveLookup = lookup.resolve;
    if (resolveLookup === null) throw new Error("lookup resolver was not installed");
    resolveLookup(source());
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();

    const pending: Array<{
      resolve: (object: RuntimePackagePreviewObject) => void;
    }> = [];
    loadRuntimeAssetObject.mockImplementation(() => new Promise((resolve) => {
      pending.push({ resolve });
    }));
    const requests = Array.from({ length: 5 }, () => server.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${adminToken}` },
    }));
    await vi.waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    for (const item of pending) {
      const bytes = testAssetBytes(0);
      item.resolve({
        body: Readable.from([bytes]),
        contentLength: bytes.byteLength,
        contentType: "application/octet-stream",
        etag: null,
      });
    }
    const responses = await Promise.all(requests);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(4);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1);
  });

  it("bounds verified transfers to four concurrent retained response buffers", async () => {
    const pending: Array<{
      resolve: (object: RuntimePackagePreviewObject) => void;
    }> = [];
    loadRuntimeAssetObject.mockImplementation(() => new Promise((resolve) => {
      pending.push({ resolve });
    }));
    const path = `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
      `/assets/${ASSET_IDS[0]}/${FILES[0]}`;
    const requests = Array.from({ length: 5 }, () => server.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${adminToken}` },
    }));

    await vi.waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    for (const item of pending) {
      const bytes = testAssetBytes(0);
      item.resolve({
        body: Readable.from([bytes]),
        contentLength: bytes.byteLength,
        contentType: "application/octet-stream",
        etag: null,
      });
    }

    const responses = await Promise.all(requests);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(4);
    const busy = responses.find((response) => response.statusCode === 429);
    expect(busy?.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_BUSY");
    expect(busy?.headers["retry-after"]).toBe("1");
  });

  it("rejects an undeclared id, filename substitution, and stored-size mismatch", async () => {
    const undeclaredId = "10000000-0000-4000-8000-000000000099";
    for (const path of [
      `/admin/assets/runtime-package-previews/${PACKAGE_ID}/assets/${undeclaredId}/other.sog`,
      `/admin/assets/runtime-package-previews/${PACKAGE_ID}/assets/${ASSET_IDS[0]}/other.sog`,
    ]) {
      const response = await server.inject({
        method: "GET",
        url: path,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(404);
    }
    expect(loadRuntimeAssetObject).not.toHaveBeenCalled();

    loadRuntimeAssetObject.mockResolvedValueOnce({
      body: Readable.from(Buffer.alloc(3)),
      contentLength: 3,
      contentType: "application/octet-stream",
      etag: null,
    });
    const mismatched = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET_IDS[0]}/${FILES[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(mismatched.statusCode).toBe(502);
    expect(mismatched.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED");
  });

  it("rejects same-size bytes that do not match the registered SHA-256", async () => {
    const wrongBytes = Buffer.alloc(16, 9);
    loadRuntimeAssetObject.mockResolvedValueOnce({
      body: Readable.from([wrongBytes]),
      contentLength: wrongBytes.byteLength,
      contentType: "application/octet-stream",
      etag: null,
    });

    const response = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET_IDS[0]}/${FILES[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED");
    expect(response.body).not.toContain(wrongBytes.toString("hex"));
  });

  it("fails closed for a non-stream body or storage exception", async () => {
    loadRuntimeAssetObject.mockResolvedValueOnce({
      body: {} as Readable,
      contentLength: 16,
      contentType: "application/octet-stream",
      etag: null,
    });
    const invalidBody = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET_IDS[0]}/${FILES[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(invalidBody.statusCode).toBe(502);
    expect(invalidBody.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED");

    loadRuntimeAssetObject.mockRejectedValueOnce(new Error("storage offline"));
    const storageFailure = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET_IDS[0]}/${FILES[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(storageFailure.statusCode).toBe(502);
    expect(storageFailure.json().code).toBe("RUNTIME_PACKAGE_PREVIEW_ASSET_STREAM_FAILED");
  });
});
