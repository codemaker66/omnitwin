import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@omnitwin/reconstruction-foundry", async () =>
  import("./support/reconstruction-foundry-canonical-mock.js")
);

vi.mock("@omnitwin/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@omnitwin/types")>();
  return {
    ...actual,
    TRADES_HALL_RUNTIME_ROOMS: actual.TRADES_HALL_RUNTIME_ROOMS.map((room) =>
      room.slug === "reception-room"
        ? { ...room, publicShowcaseEnabled: true }
        : room
    ),
  };
});

import {
  RUNTIME_QA_CHECK_KEYS,
  type RegisterRuntimePackageInput,
  type RuntimeQaRecordV0,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  assetVersions,
  runtimePackages,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import type { Env } from "../env.js";
import {
  isReceptionReviewedProfilePresentationCandidate,
  matchReceptionReviewedRuntimeProfile,
  receptionReviewedProfilePresentationContract,
} from "../lib/reception-reviewed-runtime-profile.js";
import { runtimeTransformArtifactSha256 } from
  "../lib/runtime-transform-artifact-receipt.js";
import {
  RECEPTION_QUALITY_FRONTIER_ASSETS,
  buildReceptionQualityFrontierPayload,
} from "../scripts/register-reception-room-quality-frontier.js";
import { computeRuntimePackageRevisionDigest } from
  "../services/runtime-package-revisions.js";
import {
  assetRoutes,
  runtimeQaPublicPackageBinding,
  type AssetVersionRow,
  type RuntimePackageRow,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const TRANSFORM_ID = "reception-room-reviewed-transform-v1";
const EVIDENCE_REF = { label: "Real-gate route test", ref: "route-test-evidence" };

const testEnv: Env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://mock:mock@localhost/mock",
  PORT: 3001,
  EMAIL_FROM: "VenViewer <notifications@venviewer.com>",
  CORS_ORIGINS: "http://localhost:5173",
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  AI_ASSISTANT_ENABLED: "false",
  PUBLIC_API_ORIGIN: "https://api.example.test",
  RUNTIME_PROFILE_R2_ACCOUNT_ID: "private-account",
  RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "private-key",
  RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "private-secret",
  RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "runtime-profiles-private",
};

interface RealGateState {
  readonly pkg: RuntimePackageRow;
  readonly assets: readonly AssetVersionRow[];
  readonly transform: RuntimeTransformArtifactRow;
  readonly qa: RuntimeQaRecordRow;
}

function assetRows(): readonly AssetVersionRow[] {
  return RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset) => ({
    id: asset.id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: asset.fileName,
    fileExt: ".sog",
    r2Key: asset.r2Key,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    evidenceStatus: "human_reviewed",
    runtimeStatus: "usable",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function runtimePackageRow(): RuntimePackageRow {
  const source = buildReceptionQualityFrontierPayload();
  const input: RegisterRuntimePackageInput = {
    ...source,
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
  };
  return {
    id: PACKAGE_ID,
    revision: 9,
    identityKind: "content_sha256",
    contentDigest: computeRuntimePackageRevisionDigest(input),
    ...input,
    primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
    semanticMeshAssetVersionId: input.semanticMeshAssetVersionId ?? null,
    collisionAssetVersionId: input.collisionAssetVersionId ?? null,
    pointCloudAssetVersionId: input.pointCloudAssetVersionId ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function transformRow(): RuntimeTransformArtifactRow {
  const transformArtifact: RuntimeTransformArtifactRow["transformArtifact"] = {
    id: TRANSFORM_ID,
    sourceFrame: "COLMAP_RDF",
    targetFrame: "CVF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "landmark_solve",
    residualRmseM: 0.01,
    landmarks: [{
      id: "corner-01",
      source: [0, 0, 0],
      target: [0, 0, 0],
      residualM: 0.01,
      provenanceRefs: [{
        refType: "landmark_set",
        ref: "route-test-landmarks.json",
        role: "source_landmarks",
      }],
    }],
    provenance: {
      state: "measured",
      refs: [{
        refType: "landmark_set",
        ref: "route-test-landmarks.json",
        role: "source_landmarks",
      }],
    },
    creator: { actorType: "human", id: "ops/operator", role: "runtime_operator" },
    reviewer: { actorType: "human", id: "ops/reviewer", role: "runtime_reviewer" },
    date: "2026-07-16T11:00:00.000Z",
  };
  return {
    id: "30000000-0000-4000-8000-000000000001",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: TRANSFORM_ID,
    transformArtifact,
    reviewNote: "Real-gate route test transform.",
    registeredBy: null,
    createdAt: new Date("2026-07-16T11:00:00.000Z"),
    updatedAt: new Date("2026-07-16T11:00:00.000Z"),
  };
}

function qaRecord(pkg: RuntimePackageRow, assets: readonly AssetVersionRow[]): RuntimeQaRecordRow {
  const transform = transformRow().transformArtifact;
  const runtimePackageBinding = runtimeQaPublicPackageBinding(pkg, assets);
  if (runtimePackageBinding === null) throw new Error("QA package binding must resolve.");
  const record: RuntimeQaRecordV0 = {
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-real-public-gates-route-test",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: PACKAGE_ID,
    recordedAt: NOW.toISOString(),
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    runtimePackageBinding,
    sourceBundle: {
      sourceLabel: "Exact reviewed Quality profile fixture",
      sourceBundleHash: "a".repeat(64),
      totalSourceFiles: assets.length,
      totalSourceBytes: assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0),
      totalSplats: 2_002_009,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/living-hall",
      loadStatus: "loaded",
      visualChunkCount: assets.length,
      excludedChunkCount: 0,
      loadedSplats: 2_002_009,
      evidenceRefs: [EVIDENCE_REF],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 1,
      signedTransformArtifactId: TRANSFORM_ID,
      signedTransformArtifactSha256: runtimeTransformArtifactSha256(transform),
      note: "Exact reviewed browser group transform.",
    },
    cameraProfile: {
      position: [-2.372, 0.035, 1.046],
      target: [-0.996, -0.071, 7.102],
      arrivalPosition: null,
      arrivalTarget: null,
      arrivalDurationMs: 0,
      fov: 62,
      targetBounds: null,
      cameraBounds: null,
      note: "Exact reviewed Living Hall camera policy.",
    },
    checks: RUNTIME_QA_CHECK_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed",
      summary: `Real-gate route fixture passed ${checkKey}.`,
      evidenceRefs: [EVIDENCE_REF],
    })),
    limitations: ["Route test fixture; no public release authority."],
    publicExposure: {
      decision: "approved_public",
      reason: "Fixture reaches the separate immutable profile eligibility gate.",
      requiredBeforeApproval: ["Server profile eligibility must independently allow exposure."],
    },
  };
  return {
    id: "40000000-0000-4000-8000-000000000001",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    recordId: record.recordId,
    recordJson: record,
    signedTransformArtifactId: TRANSFORM_ID,
    publicExposureDecision: "approved_public",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    reviewedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildState(): RealGateState {
  const assets = assetRows();
  const pkg = runtimePackageRow();
  return { pkg, assets, transform: transformRow(), qa: qaRecord(pkg, assets) };
}

function databaseFor(state: RealGateState): Database {
  const rows = (table: unknown): readonly unknown[] => {
    if (table === runtimePackages) return [state.pkg];
    if (table === assetVersions) return state.assets;
    if (table === runtimeQaRecords) return [state.qa];
    if (table === runtimeTransformArtifacts) return [state.transform];
    return [];
  };
  const db = {} as Database;
  Reflect.set(db, "select", () => {
    let table: unknown;
    const query: Record<string, unknown> = {};
    query["from"] = (selected: unknown) => { table = selected; return query; };
    query["where"] = () => query;
    query["orderBy"] = () => query;
    query["limit"] = () => Promise.resolve(rows(table));
    query["then"] = (resolve: (value: readonly unknown[]) => unknown) =>
      Promise.resolve(rows(table)).then(resolve);
    return query;
  });
  return db;
}

const servers: FastifyInstance[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe("approved-profile route with real immutable gates", () => {
  it("uses the real matcher and presentation validator, then stays closed at eligibility", async () => {
    const state = buildState();
    const profileId = matchReceptionReviewedRuntimeProfile(state.pkg, state.assets);
    expect(profileId).toBe("quality-sog-fine-v1");
    if (profileId === null) throw new Error("Real profile matcher rejected its exact fixture.");
    const presentation = receptionReviewedProfilePresentationContract(
      profileId,
      state.qa.recordJson,
      state.transform.transformArtifact,
    );
    expect(presentation?.contractDigest).toBe(
      "97f902723a8e3e9d833dec556eec8fc02a93e4cc58e715903ddad19f5428e239",
    );
    expect(isReceptionReviewedProfilePresentationCandidate(
      profileId,
      runtimeTransformArtifactSha256(state.transform.transformArtifact),
    )).toBe(false);

    const server = Fastify();
    servers.push(server);
    await server.register(assetRoutes, { db: databaseFor(state), env: testEnv, prefix: "/assets" });
    const response = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/approved-profile" +
        "?venue=trades-hall&room=reception-room",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });
});
