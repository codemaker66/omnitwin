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

const signToken = (payload: { id: string; email: string; role: string; platformRole?: "none" | "operator" | "admin"; venueId: string | null }): string =>
  JSON.stringify(payload);
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", platformRole: "admin", venueId: "v1" });
const plannerToken = (): string => signToken({ id: "u2", email: "planner@test.com", role: "planner", venueId: "v1" });

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const SHA = "a".repeat(64);
const TRANSFORM_ARTIFACT_ID = "reception-room-landmark-solve-v0";
const transformEvidenceRef = {
  refType: "landmark_set",
  ref: "docs/operations/reception-room-landmarks-v0.json",
  role: "source_landmarks",
} as const;

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

const validTransformArtifactBody = {
  runtimePackageId: RUNTIME_PACKAGE_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  transformArtifact: {
    id: TRANSFORM_ARTIFACT_ID,
    sourceFrame: "COLMAP_RDF",
    targetFrame: "CVF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "landmark_solve",
    residualRmseM: 0.012,
    landmarks: [
      {
        id: "corner-01",
        label: "Control corner 01",
        source: [0, 0, 0],
        target: [0, 0, 0],
        residualM: 0.01,
        provenanceRefs: [transformEvidenceRef],
      },
    ],
    provenance: {
      state: "measured",
      refs: [transformEvidenceRef],
    },
    creator: {
      actorType: "human",
      id: "ops/blake",
      displayName: "Runtime operator",
      role: "runtime_operator",
    },
    reviewer: {
      actorType: "human",
      id: "ops/runtime-reviewer",
      displayName: "Runtime reviewer",
      role: "runtime_reviewer",
    },
    date: "2026-06-15T10:00:00.000Z",
  },
  reviewNote: "Route contract test only; not a live Reception Room signed transform.",
};

const qaEvidenceRef = {
  label: "Playwright evidence",
  ref: "output/playwright/reception-room-camera-arrival-settled.png",
};

const validRuntimeQaRecord = {
  schemaVersion: "runtime-qa-record.v0",
  recordId: "reception-room-runtime-qa-2026-06-16",
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  runtimePackageId: RUNTIME_PACKAGE_ID,
  recordedAt: "2026-06-16T00:00:00.000Z",
  recordedBy: "runtime-qa-operator",
  assetEvidenceStatus: "unverified",
  runtimeStatus: "internal_ready",
  sourceBundle: {
    sourceLabel: "Reception Room XGRIDS LCC2 source bundle",
    sourceBundleHash: SHA,
    totalSourceFiles: 48,
    totalSourceBytes: 64_323_846,
    totalSplats: 3_491_322,
  },
  sparkLoad: {
    renderer: "@sparkjsdev/spark",
    route: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
    loadStatus: "loaded",
    visualChunkCount: 7,
    excludedChunkCount: 1,
    loadedSplats: 3_491_322,
    evidenceRefs: [qaEvidenceRef],
  },
  viewTransform: {
    posture: "approximate_view_transform",
    position: [1.11, 2.57, 2.77],
    rotation: [-Math.PI / 2, 0, 0],
    scale: 0.63,
    signedTransformArtifactId: null,
    note: "Approximate XGRIDS SOG view transform; not signed for operational alignment.",
  },
  cameraProfile: {
    position: [0.2, 6.2, 13.4],
    target: [0, 0.9, -4.15],
    arrivalPosition: [0.25, 7.15, 14.1],
    arrivalTarget: [0, 1.2, -4],
    arrivalDurationMs: 1400,
    fov: 48,
    targetBounds: {
      min: [-5.8, 0.7, -9.2],
      max: [5.8, 2.35, 4.8],
    },
    cameraBounds: {
      min: [-6.8, 1.4, -11.8],
      max: [6.8, 7.4, 14.2],
    },
    note: "Bounded interior inspection camera for runtime QA only.",
  },
  checks: [
    {
      checkKey: "runtime_package_resolves",
      status: "passed",
      summary: "Runtime package resolves through the internal route.",
      evidenceRefs: [qaEvidenceRef],
    },
    {
      checkKey: "served_chunk_count",
      status: "passed",
      summary: "Seven room SOG chunks are served; one environment chunk is excluded.",
      evidenceRefs: [{ label: "Intake note", ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md" }],
    },
    {
      checkKey: "spark_payload_loads",
      status: "passed",
      summary: "Spark loads the served SOG payloads for internal runtime QA.",
      evidenceRefs: [qaEvidenceRef],
    },
    {
      checkKey: "camera_framing",
      status: "passed",
      summary: "The start view frames the Reception Room for internal inspection.",
      evidenceRefs: [qaEvidenceRef],
    },
    {
      checkKey: "user_orbit_bounds",
      status: "passed",
      summary: "A small user orbit remains inside the bounded QA camera region.",
      evidenceRefs: [{ label: "After-drag evidence", ref: "output/playwright/reception-room-camera-arrival-after-drag.png" }],
    },
    {
      checkKey: "approximate_view_transform_documented",
      status: "passed",
      summary: "The approximate transform is explicitly documented as not signed.",
      evidenceRefs: [{ label: "Runtime intake note", ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md" }],
    },
    {
      checkKey: "signed_transform_artifact",
      status: "requires_human_review",
      summary: "No signed room-local transform artifact is recorded.",
      evidenceRefs: [],
    },
    {
      checkKey: "metric_scale_alignment",
      status: "not_checked",
      summary: "Metric scale alignment has not been checked against measured room anchors.",
      evidenceRefs: [],
    },
    {
      checkKey: "floor_wall_alignment",
      status: "not_checked",
      summary: "Floor and wall alignment have not been checked against reviewed room geometry.",
      evidenceRefs: [],
    },
    {
      checkKey: "lcc2_lod_graph",
      status: "requires_human_review",
      summary: "The LCC2 bundle graph is not yet the authoritative runtime package loader.",
      evidenceRefs: [],
    },
    {
      checkKey: "public_exposure_review",
      status: "blocked",
      summary: "Public exposure remains blocked until review and signed transform evidence exist.",
      evidenceRefs: [],
    },
  ],
  limitations: [
    "The transform is visual framing only, not operational alignment.",
    "The package remains internal and unverified.",
    "Public room showcase copy must stay in fallback mode.",
  ],
  publicExposure: {
    decision: "blocked_internal_only",
    reason: "Public exposure is blocked until human review and signed transform evidence exist.",
    requiredBeforeApproval: [
      "Signed room-local transform artifact.",
      "Human visual QA review.",
      "Exposure approval record.",
    ],
  },
};

const validRuntimeQaRecordBody = {
  runtimePackageId: RUNTIME_PACKAGE_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  record: validRuntimeQaRecord,
};

const validCaptureControlSource = {
  sourceId: "reception-room-manual-landmarks-v0",
  sourceClass: "manual_landmarks",
  poseAuthorityLevel: "manual_landmark_control",
  alignmentMethods: ["landmark_solve"],
  qaStatus: "requires_human_review",
  sourceRefs: [
    {
      refType: "landmark_set",
      ref: "docs/operations/reception-room-landmarks-v0.json",
      role: "source_landmarks",
    },
  ],
  transformArtifactRefs: [],
  residualMetricRefs: [],
  staleWhen: ["landmark_set_changed", "runtime_package_changed"],
  reviewerRole: "runtime_reviewer",
  notes: "Candidate Reception Room landmark set; not yet a signed transform.",
};

const validCaptureControlSourceBody = {
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  runtimePackageId: null,
  transformArtifactId: null,
  source: validCaptureControlSource,
  reviewNote: "Route contract test only; not live Reception Room control evidence.",
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

  it("exposes the verified preview fingerprint to an allowed browser origin", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-expose-headers"]).toContain("x-content-sha256");
  });
});

describe("GET /assets/runtime-packages/latest", () => {
  it("requires authentication before exposing internal package metadata", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=robert-adam-room",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an authenticated non-platform-admin before registry lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates venue and room query params before querying", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns an empty safe state when no runtime registry row can be read", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=robert-adam-room",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null });
  });

  it("rejects unsupported Trades Hall room slugs before lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/latest?venue=trades-hall&room=made-up-room",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /assets/runtime-assets/:assetVersionId", () => {
  it("requires authentication before resolving an internal asset identifier", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/assets/runtime-assets/${ASSET_VERSION_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an authenticated non-platform-admin before asset lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/assets/runtime-assets/${ASSET_VERSION_ID}`,
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects malformed asset version IDs before storage lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-assets/not-a-runtime-asset-id",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unsupported range headers before runtime lookup", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/assets/runtime-assets/${ASSET_VERSION_ID}`,
      headers: {
        authorization: `Bearer ${adminToken()}`,
        range: "items=0-10",
      },
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

  it("always returns the safe fallback because the raw external-URL route is retired", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/public-room-visual?venue=trades-hall&room=grand-hall",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
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

  it("returns 410 for an admin and points to the immutable replacement", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-package",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validRuntimePackageBody,
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({
      code: "RUNTIME_PACKAGE_MUTABLE_REGISTRATION_RETIRED",
      replacement: "/admin/assets/runtime-package-revisions",
    });
  });
});

describe("public reviewed runtime profile boundary", () => {
  it("validates the profile lookup query without exposing registry metadata", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/approved-profile",
    });
    expect(res.statusCode).toBe(400);
  });

  it("fails closed while Reception public showcase permission is disabled", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-packages/approved-profile?venue=trades-hall&room=reception-room",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.json()).toEqual({ data: null });
    expect(res.body).not.toMatch(/manifestJson|r2Key|sha256|hierarchy|decisionRef|assetVersionId/u);
  });

  it("rejects malformed opaque member identifiers before any storage access", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/not-a-profile/members/0/content.sog",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns no member bytes while Reception public showcase permission is disabled", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.json()).toMatchObject({ code: "RUNTIME_PROFILE_MEMBER_NOT_AVAILABLE" });
    expect(res.body).not.toContain(ASSET_VERSION_ID);
  });
});

describe("POST /admin/assets/runtime-package-revisions", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/runtime-package-revisions",
      payload: { package: validRuntimePackageBody },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/runtime-package-revisions",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: { package: validRuntimePackageBody },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a manifest whose room does not match the package room", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/runtime-package-revisions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        package: {
          ...validRuntimePackageBody,
          roomSlug: "saloon",
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a loadable package without a primary visual asset", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/runtime-package-revisions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        package: {
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
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/assets/register-runtime-transform-artifact", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-transform-artifact",
      payload: validTransformArtifactBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-transform-artifact",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validTransformArtifactBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects visual-only transforms before runtime package lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-transform-artifact",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validTransformArtifactBody,
        transformArtifact: {
          ...validTransformArtifactBody.transformArtifact,
          alignmentMethod: "visual_alignment",
          residualRmseM: null,
          landmarks: [],
          provenance: {
            state: "inferred",
            refs: [
              {
                refType: "artifact",
                ref: "docs/operations/reception-room-visual-review.md",
                role: "visual_review",
              },
            ],
          },
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes a reviewed transform contract through validation before DB lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-transform-artifact",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validTransformArtifactBody,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("GET /admin/assets/runtime-transform-artifacts", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-transform-artifacts?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-transform-artifacts?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates runtimePackageId before querying", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/runtime-transform-artifacts?runtimePackageId=not-a-runtime-package-id",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/assets/register-capture-control-source", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-capture-control-source",
      payload: validCaptureControlSourceBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-capture-control-source",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validCaptureControlSourceBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a transform link without a matching source reference", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-capture-control-source",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validCaptureControlSourceBody,
        runtimePackageId: RUNTIME_PACKAGE_ID,
        transformArtifactId: TRANSFORM_ARTIFACT_ID,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unsupported Trades Hall rooms before DB lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-capture-control-source",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validCaptureControlSourceBody,
        roomSlug: "unsupported-room",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes a pre-transform control source through validation before DB lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-capture-control-source",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validCaptureControlSourceBody,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("GET /admin/assets/capture-control-sources", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/capture-control-sources?venue=trades-hall&room=reception-room",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/capture-control-sources?venue=trades-hall&room=reception-room",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates transform filters before querying", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/admin/assets/capture-control-sources?venue=trades-hall&room=reception-room&transformArtifactId=${TRANSFORM_ARTIFACT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/assets/register-runtime-qa-record", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-qa-record",
      payload: validRuntimeQaRecordBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-qa-record",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validRuntimeQaRecordBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects public approval without human-reviewed evidence and a signed transform", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-qa-record",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validRuntimeQaRecordBody,
        record: {
          ...validRuntimeQaRecord,
          publicExposure: {
            decision: "approved_public",
            reason: "Human review has approved public exposure.",
            requiredBeforeApproval: ["No remaining approval blockers."],
          },
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects QA records whose embedded package id does not match the request", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-qa-record",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validRuntimeQaRecordBody,
        runtimePackageId: "10000000-0000-4000-8000-000000000099",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes a blocked internal QA record through validation before DB lookup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/assets/register-runtime-qa-record",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validRuntimeQaRecordBody,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("GET /admin/assets/runtime-qa-records", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-qa-records?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/admin/assets/runtime-qa-records?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates runtimePackageId before querying", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/assets/runtime-qa-records?runtimePackageId=not-a-runtime-package-id",
      headers: { authorization: `Bearer ${adminToken()}` },
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
