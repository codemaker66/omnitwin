import { z } from "zod";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { RoomAssetStatusSchema } from "@omnitwin/types";
import type { Env } from "../env.js";
import type { Database } from "../db/client.js";
import {
  assetVersions,
  captureControlSourceRecords,
  roomManifests,
  runtimePackages,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import {
  adminAssetRoutes,
  type AssetVersionRow,
  type CaptureControlSourceRecordRow,
  type RoomManifestRow,
  type RuntimePackageRow,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

process.env["NODE_ENV"] = "test";

const RoomsResponseSchema = z.object({
  data: z.array(RoomAssetStatusSchema),
});

const NOW = new Date("2026-06-16T00:00:00.000Z");
const OLDER = new Date("2026-06-15T00:00:00.000Z");
const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const CURRENT_RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const OLD_RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000005";
const SHA = "08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c";

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://mock:mock@localhost/mock",
  PORT: 3001,
  EMAIL_FROM: "VenViewer <notifications@venviewer.com>",
  CORS_ORIGINS: "http://localhost:5173,http://localhost:5174",
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  AI_ASSISTANT_ENABLED: "false",
} satisfies Env;

const adminToken = JSON.stringify({
  id: "10000000-0000-4000-8000-000000000010",
  email: "admin@test.com",
  role: "admin",
  platformRole: "admin",
  venueId: null,
});

interface FakeRows {
  readonly manifests: readonly RoomManifestRow[];
  readonly splats: readonly AssetVersionRow[];
  readonly packages: readonly RuntimePackageRow[];
  readonly transformArtifacts: readonly RuntimeTransformArtifactRow[];
  readonly qaRecords: readonly RuntimeQaRecordRow[];
  readonly captureControlSources: readonly CaptureControlSourceRecordRow[];
}

interface FakeOrderedQuery {
  orderBy: (...columns: readonly unknown[]) => Promise<readonly unknown[]>;
}

interface FakeWhereQuery extends FakeOrderedQuery {
  where: (...conditions: readonly unknown[]) => FakeOrderedQuery;
}

interface FakeSelectQuery {
  from: (table: unknown) => FakeWhereQuery;
}

function rowsForTable(rows: FakeRows, table: unknown): readonly unknown[] {
  if (table === roomManifests) return rows.manifests;
  if (table === assetVersions) return rows.splats;
  if (table === runtimePackages) return rows.packages;
  if (table === runtimeTransformArtifacts) return rows.transformArtifacts;
  if (table === runtimeQaRecords) return rows.qaRecords;
  if (table === captureControlSourceRecords) return rows.captureControlSources;
  return [];
}

function makeFakeDb(rows: FakeRows): Database {
  const select = (() => ({
    from(table: unknown): FakeWhereQuery {
      const tableRows = rowsForTable(rows, table);
      const query: FakeWhereQuery = {
        where: () => query,
        orderBy: () => Promise.resolve(tableRows),
      };
      return query;
    },
  }) satisfies FakeSelectQuery) as Database["select"];

  return { select } as Database;
}

function splatAsset(roomSlug: string): AssetVersionRow {
  return {
    id: ASSET_VERSION_ID,
    venueSlug: "trades-hall",
    roomSlug,
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: "0_1_0.sog",
    fileExt: ".sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_1_0.sog",
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: SHA,
    sizeBytes: 9_845_814,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runtimePackage(id: string, updatedAt: Date): RuntimePackageRow {
  return {
    id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: updatedAt === NOW ? 2 : 1,
    identityKind: "legacy",
    contentDigest: null,
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_VERSION_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    createdAt: updatedAt,
    updatedAt,
  };
}

function visualAlignmentCaptureControlSource(runtimePackageId: string): CaptureControlSourceRecordRow {
  const sourceId = "reception-room-approximate-view-transform-v0";
  return {
    id: "10000000-0000-4000-8000-000000000009",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId,
    transformArtifactId: null,
    sourceId,
    sourceClass: "artist_blender_alignment_refs",
    poseAuthorityLevel: "visual_alignment_only",
    qaStatus: "requires_human_review",
    sourceRecord: {
      sourceId,
      sourceClass: "artist_blender_alignment_refs",
      poseAuthorityLevel: "visual_alignment_only",
      alignmentMethods: ["visual_alignment"],
      qaStatus: "requires_human_review",
      sourceRefs: [
        {
          refType: "runtime_package",
          ref: runtimePackageId,
          role: "runtime_package",
        },
        {
          refType: "operator_note",
          ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md",
          role: "approximate_view_transform",
        },
      ],
      transformArtifactRefs: [],
      residualMetricRefs: [],
      staleWhen: ["runtime_package_changed", "scene_authority_map_changed"],
      reviewerRole: "runtime_reviewer",
      notes: "Visual-only approximate view transform evidence for route regression tests.",
    },
    reviewNote: "Route regression test only; not live Reception Room control evidence.",
    registeredBy: "10000000-0000-4000-8000-000000000010",
    createdAt: OLDER,
    updatedAt: OLDER,
  };
}

function fakeRows(): FakeRows {
  return {
    manifests: [],
    splats: [splatAsset("reception-room")],
    packages: [
      runtimePackage(CURRENT_RUNTIME_PACKAGE_ID, NOW),
      runtimePackage(OLD_RUNTIME_PACKAGE_ID, OLDER),
    ],
    transformArtifacts: [],
    qaRecords: [],
    captureControlSources: [visualAlignmentCaptureControlSource(OLD_RUNTIME_PACKAGE_ID)],
  };
}

describe("GET /admin/assets/rooms route freshness", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();
    await server.register(adminAssetRoutes, {
      db: makeFakeDb(fakeRows()),
      env: testEnv,
      prefix: "/admin/assets",
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns evaluated stale capture-control evidence from route rows", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin/assets/rooms?venue=trades-hall",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = RoomsResponseSchema.parse(response.json());
    const receptionRoom = body.data.find((room) => room.roomSlug === "reception-room");

    expect(receptionRoom).toBeDefined();
    expect(receptionRoom?.latestCaptureControlSourceRecordId).toBe("10000000-0000-4000-8000-000000000009");
    expect(receptionRoom?.latestCaptureControlSourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(receptionRoom?.latestCaptureControlPoseAuthorityLevel).toBe("visual_alignment_only");
    expect(receptionRoom?.latestCaptureControlStalenessTriggers).toEqual([
      "runtime_package_changed",
      "scene_authority_map_changed",
    ]);
    expect(receptionRoom?.latestCaptureControlActiveStalenessTriggers).toEqual(["runtime_package_changed"]);
    expect(receptionRoom?.captureControlFreshnessStatus).toBe("stale_for_runtime_package");
    expect(receptionRoom?.captureControlSafeCopy).toBe(
      "capture-control source registered; stale evidence review required",
    );
    expect(receptionRoom?.captureControlAuthoritySafeCopy).toBe(
      "visual-only alignment source recorded; not measurement control",
    );
    expect(receptionRoom?.runtimeControlEvidenceChainStatus).toBe("not_recorded");
    expect(receptionRoom?.runtimeControlEvidenceChainSafeCopy).toBe(
      "runtime-control evidence chain is not recorded for the latest runtime package",
    );
  });
});
