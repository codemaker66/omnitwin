import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import {
  assetRoutes,
  runtimeProfileR2IsConfigured,
  type AssetVersionRow,
  type RuntimePackageRow,
} from "../routes/assets.js";

vi.mock("@omnitwin/reconstruction-foundry", async () =>
  import("./support/reconstruction-foundry-canonical-mock.js")
);

const INTERNAL_PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const INTERNAL_ASSET_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-14T12:00:00.000Z");
const PLANNER_TOKEN = JSON.stringify({
  id: "runtime-boundary-planner",
  email: "planner@example.test",
  role: "planner",
  platformRole: "none",
  venueId: "trades-hall",
});
const ADMIN_TOKEN = JSON.stringify({
  id: "runtime-boundary-admin",
  email: "admin@example.test",
  role: "admin",
  platformRole: "admin",
  venueId: null,
});

const internalAsset: AssetVersionRow = {
  id: INTERNAL_ASSET_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  captureSessionId: null,
  assetKind: "splat",
  sourceType: "xgrids",
  r2Key: "venues/trades-hall/rooms/reception-room/private-candidate.sog",
  fileName: "private-candidate.sog",
  fileExt: ".sog",
  externalUrl: null,
  mimeType: "application/octet-stream",
  sha256: "a".repeat(64),
  sizeBytes: 4,
  evidenceStatus: "machine_checked",
  runtimeStatus: "usable",
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const internalPackage: RuntimePackageRow = {
  id: INTERNAL_PACKAGE_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  revision: 1,
  identityKind: "content_sha256",
  contentDigest: "b".repeat(64),
  primaryVisualAssetVersionId: INTERNAL_ASSET_ID,
  semanticMeshAssetVersionId: null,
  collisionAssetVersionId: null,
  pointCloudAssetVersionId: null,
  manifestJson: {
    schemaVersion: "venviewer.runtime-package.v1",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    packageType: "room-runtime",
    assets: {
      primaryVisualAssetVersionId: INTERNAL_ASSET_ID,
      visualAssetVersionIds: [INTERNAL_ASSET_ID],
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
    },
  },
  evidenceStatus: "machine_checked",
  runtimeStatus: "internal_ready",
  createdAt: NOW,
  updatedAt: NOW,
};

const testEnv: Env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://mock:mock@localhost/mock",
  PORT: 3001,
  EMAIL_FROM: "VenViewer <notifications@venviewer.com>",
  CORS_ORIGINS: "http://localhost:5173",
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  AI_ASSISTANT_ENABLED: "false",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET_NAME: "test-bucket",
  R2_PUBLIC_URL: "https://assets.example.test",
  PUBLIC_API_ORIGIN: "https://api.example.test",
};

function queryReturning(rows: readonly unknown[]): object {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where", "orderBy"]) {
    query[method] = () => query;
  }
  query["limit"] = () => Promise.resolve(rows);
  query["then"] = (
    resolvePromise: (value: readonly unknown[]) => unknown,
    rejectPromise: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolvePromise, rejectPromise);
  return query;
}

function databaseReturning(...resultSets: readonly (readonly unknown[])[]): Database {
  let index = 0;
  const database = {} as Database;
  Reflect.set(database, "select", () => queryReturning(resultSets[index++] ?? []));
  return database;
}

describe("legacy public runtime boundary", () => {
  it("does not treat the legacy public upload bucket as reviewed-profile storage", () => {
    expect(runtimeProfileR2IsConfigured(testEnv)).toBe(false);
    expect(runtimeProfileR2IsConfigured({
      ...testEnv,
      RUNTIME_PROFILE_R2_ACCOUNT_ID: "private-account",
      RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "private-key",
      RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "private-secret",
      RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "runtime-profiles-private",
    })).toBe(true);
  });

  it("keeps detailed package metadata and direct asset identifiers behind authentication", async () => {
    const server = Fastify();
    await server.register(assetRoutes, {
      db: databaseReturning(),
      env: testEnv,
      prefix: "/assets",
    });
    try {
      const [metadataResponse, assetResponse] = await Promise.all([
        server.inject({
          method: "GET",
          url: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
        }),
        server.inject({
          method: "GET",
          url: `/assets/runtime-assets/${INTERNAL_ASSET_ID}/${internalAsset.fileName}`,
        }),
      ]);
      expect(metadataResponse.statusCode).toBe(401);
      expect(assetResponse.statusCode).toBe(401);

      const [plannerMetadataResponse, plannerAssetResponse] = await Promise.all([
        server.inject({
          method: "GET",
          url: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
          headers: { authorization: `Bearer ${PLANNER_TOKEN}` },
        }),
        server.inject({
          method: "GET",
          url: `/assets/runtime-assets/${INTERNAL_ASSET_ID}/${internalAsset.fileName}`,
          headers: { authorization: `Bearer ${PLANNER_TOKEN}` },
        }),
      ]);
      expect(plannerMetadataResponse.statusCode).toBe(403);
      expect(plannerAssetResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns neither public profile metadata nor member bytes while room opt-in is disabled", async () => {
    const server = Fastify();
    await server.register(assetRoutes, {
      db: databaseReturning(),
      env: testEnv,
      prefix: "/assets",
    });
    try {
      const profileResponse = await server.inject({
        method: "GET",
        url: "/assets/runtime-packages/approved-profile?venue=trades-hall&room=reception-room",
      });
      const memberResponse = await server.inject({
        method: "GET",
        url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
      });

      expect(profileResponse.statusCode).toBe(200);
      expect(profileResponse.json()).toEqual({ data: null });
      expect(memberResponse.statusCode).toBe(404);
      expect(memberResponse.json()).toMatchObject({
        code: "RUNTIME_PROFILE_MEMBER_NOT_AVAILABLE",
      });
      const combinedBody = `${profileResponse.body}\n${memberResponse.body}`;
      expect(combinedBody).not.toMatch(/manifestJson|r2Key|sha256|decisionRef|hierarchy|assetVersionId/u);
      expect(combinedBody).not.toContain(INTERNAL_ASSET_ID);
    } finally {
      await server.close();
    }
  });

  it("never exposes internal-ready packages and authorizes streamed bytes by exact manifest membership", async () => {
    const source = await readFile(resolve("src/routes/assets.ts"), "utf8");
    const publicRoutes = source.slice(
      source.indexOf("export async function assetRoutes"),
      source.indexOf("export async function adminAssetRoutes"),
    );

    expect(publicRoutes).not.toContain('inArray(runtimePackages.runtimeStatus, ["internal_ready", "published"])');
    expect(publicRoutes.match(/eq\(runtimePackages\.runtimeStatus, "published"\)/gu)).toHaveLength(1);
    expect(publicRoutes).toContain("findLatestPublishedRuntimePackage(db, asset.venueSlug, asset.roomSlug)");
    expect(publicRoutes).toContain("findRuntimeVisualAssetComposition(db, pkg)");
    expect(publicRoutes).toContain("visualAssetVersions.some((version) => version.id === asset.id)");
    expect(publicRoutes).not.toContain(
      ".innerJoin(runtimePackages, eq(runtimePackages.primaryVisualAssetVersionId, assetVersions.id))",
    );
    expect(publicRoutes).not.toContain("eq(runtimePackages.roomSlug, assetVersions.roomSlug)");
    expect(publicRoutes).not.toContain("eq(runtimePackages.venueSlug, assetVersions.venueSlug)");
  });

  it("keeps a seeded internal-ready candidate out of every public runtime route", async () => {
    const cases = [
      {
        path: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
        db: databaseReturning([{ pkg: internalPackage, primaryVisualAssetVersion: internalAsset }]),
        expected: { data: null },
        authenticated: true,
      },
      {
        path: "/assets/runtime-packages/public-room-visual?venue=trades-hall&room=reception-room",
        db: databaseReturning([{ pkg: internalPackage, primaryVisualAssetVersion: internalAsset }]),
        expected: { data: { runtimeVisualAvailable: false, visualUrl: null } },
        authenticated: false,
      },
      {
        path: `/assets/runtime-assets/${INTERNAL_ASSET_ID}/${internalAsset.fileName}`,
        db: databaseReturning([internalAsset], [internalPackage]),
        expected: { code: "RUNTIME_ASSET_NOT_AVAILABLE" },
        authenticated: true,
      },
    ] as const;

    for (const testCase of cases) {
      const server = Fastify();
      await server.register(assetRoutes, { db: testCase.db, env: testEnv, prefix: "/assets" });
      try {
        const response = await server.inject({
          method: "GET",
          url: testCase.path,
          headers: testCase.authenticated
            ? { authorization: `Bearer ${ADMIN_TOKEN}` }
            : undefined,
        });
        expect(response.statusCode).toBe(testCase.path.includes("runtime-assets") ? 404 : 200);
        expect(response.json()).toMatchObject(testCase.expected);
        expect(response.body).not.toContain(INTERNAL_PACKAGE_ID);
        expect(response.body).not.toContain(INTERNAL_ASSET_ID);
      } finally {
        await server.close();
      }
    }
  });
});
