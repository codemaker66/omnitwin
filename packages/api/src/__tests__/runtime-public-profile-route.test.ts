import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";

const s3Send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(readonly input: { readonly Bucket?: string; readonly Key?: string }) {}
  },
  S3Client: class S3Client {
    send(command: unknown, options: unknown): unknown {
      return s3Send(command, options);
    }
  },
}));

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

vi.mock("../lib/reception-reviewed-runtime-profile.js", () => ({
  matchReceptionReviewedRuntimeProfile: vi.fn(() => "quality-sog-fine-v1"),
  isReceptionReviewedProfilePresentationCandidate: vi.fn(() => true),
}));

import { RUNTIME_QA_CHECK_KEYS, type RuntimeQaRecordV0 } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  assetVersions,
  runtimePackages,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";
import {
  assetRoutes,
  type AssetVersionRow,
  type RuntimePackageRow,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const TRANSFORM_ID = "reception-room-reviewed-transform-v1";
const ASSET_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
] as const;

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

interface RouteState {
  readonly pkg: RuntimePackageRow;
  readonly assets: readonly AssetVersionRow[];
  readonly transform: RuntimeTransformArtifactRow;
  readonly qa: RuntimeQaRecordRow;
  approved: boolean;
}

function memberBytes(generation: string, index: number): Buffer {
  return Buffer.from(`reviewed-${generation}-member-${String(index)}`, "utf8");
}

function buildState(generation: string): RouteState {
  const assets: readonly AssetVersionRow[] = ASSET_IDS.map((id, index) => {
    const bytes = memberBytes(generation, index);
    return {
      id,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      fileName: `member-${generation}-${String(index)}.sog`,
      fileExt: ".sog",
      r2Key: `venues/trades-hall/rooms/reception-room/${generation}/member-${String(index)}.sog`,
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      evidenceStatus: "human_reviewed",
      runtimeStatus: "usable",
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
  });
  const pkg: RuntimePackageRow = {
    id: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: 9,
    identityKind: "content_sha256",
    contentDigest: createHash("sha256").update(`package-${generation}`).digest("hex"),
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
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const transformArtifact: RuntimeTransformArtifactRow["transformArtifact"] = {
    id: TRANSFORM_ID,
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
    residualRmseM: 0.01,
    landmarks: [{
      id: "corner-01",
      label: "Control corner 01",
      source: [0, 0, 0],
      target: [0, 0, 0],
      residualM: 0.01,
      provenanceRefs: [{
        refType: "landmark_set",
        ref: "docs/operations/reception-room-landmarks-v1.json",
        role: "source_landmarks",
      }],
    }],
    provenance: {
      state: "measured",
      refs: [{
        refType: "landmark_set",
        ref: "docs/operations/reception-room-landmarks-v1.json",
        role: "source_landmarks",
      }],
    },
    creator: {
      actorType: "human",
      id: "ops/runtime-operator",
      displayName: "Runtime operator",
      role: "runtime_operator",
    },
    reviewer: {
      actorType: "human",
      id: "ops/runtime-reviewer",
      displayName: "Runtime reviewer",
      role: "runtime_reviewer",
    },
    date: "2026-07-16T11:00:00.000Z",
  };
  const transform: RuntimeTransformArtifactRow = {
    id: "30000000-0000-4000-8000-000000000001",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: TRANSFORM_ID,
    transformArtifact,
    reviewNote: "Behavioral route test transform.",
    registeredBy: null,
    createdAt: new Date("2026-07-16T11:00:00.000Z"),
    updatedAt: new Date("2026-07-16T11:00:00.000Z"),
  };
  const evidenceRef = { label: "Route test", ref: "route-test-evidence" };
  const record: RuntimeQaRecordV0 = {
    schemaVersion: "runtime-qa-record.v0",
    recordId: `reception-room-route-test-${generation}`,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: PACKAGE_ID,
    recordedAt: "2026-07-16T12:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    sourceBundle: {
      sourceLabel: "Reviewed Reception route test bundle",
      sourceBundleHash: createHash("sha256").update(`source-${generation}`).digest("hex"),
      totalSourceFiles: 4,
      totalSourceBytes: assets.reduce((total, asset) => total + (asset.sizeBytes ?? 0), 0),
      totalSplats: 100,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/living-hall",
      loadStatus: "loaded",
      visualChunkCount: 4,
      excludedChunkCount: 0,
      loadedSplats: 100,
      evidenceRefs: [evidenceRef],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      signedTransformArtifactId: TRANSFORM_ID,
      signedTransformArtifactSha256: runtimeTransformArtifactSha256(transformArtifact),
      note: "Exact route-test transform binding.",
    },
    cameraProfile: {
      position: [0, 2, 8],
      target: [0, 1, 0],
      arrivalPosition: null,
      arrivalTarget: null,
      arrivalDurationMs: 0,
      fov: 48,
      targetBounds: null,
      cameraBounds: null,
      note: "Route test camera profile.",
    },
    checks: RUNTIME_QA_CHECK_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed" as const,
      summary: `Route test passed ${checkKey}.`,
      evidenceRefs: [evidenceRef],
    })),
    limitations: ["Behavioral route test; not live room evidence."],
    publicExposure: {
      decision: "approved_public",
      reason: "Behavioral test approval with exact transform binding.",
      requiredBeforeApproval: ["No test-only blockers remain."],
    },
  };
  const qa: RuntimeQaRecordRow = {
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
  return { pkg, assets, transform, qa, approved: true };
}

function tableRows(state: RouteState, table: unknown): readonly unknown[] {
  if (table === runtimePackages) return [state.pkg];
  if (table === assetVersions) return state.assets;
  if (table === runtimeQaRecords) return state.approved ? [state.qa] : [];
  if (table === runtimeTransformArtifacts) return [state.transform];
  return [];
}

function databaseFor(state: RouteState): Database {
  const db = {} as Database;
  Reflect.set(db, "select", () => {
    let selectedTable: unknown;
    const query: Record<string, unknown> = {};
    query["from"] = (table: unknown) => {
      selectedTable = table;
      return query;
    };
    for (const method of ["where", "orderBy"]) {
      query[method] = () => query;
    }
    query["limit"] = () => Promise.resolve(tableRows(state, selectedTable));
    query["then"] = (
      resolvePromise: (rows: readonly unknown[]) => unknown,
      rejectPromise: (reason: unknown) => unknown,
    ) => Promise.resolve(tableRows(state, selectedTable)).then(resolvePromise, rejectPromise);
    return query;
  });
  return db;
}

async function routeServer(state: RouteState, withRateLimit = false): Promise<FastifyInstance> {
  const server = Fastify();
  if (withRateLimit) {
    await server.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  }
  await server.register(assetRoutes, {
    db: databaseFor(state),
    env: testEnv,
    prefix: "/assets",
  });
  return server;
}

function storageResult(generation: string, key: string): { readonly Body: Readable } {
  const match = /member-(\d+)\.sog$/u.exec(key);
  if (match?.[1] === undefined) throw new Error(`Unexpected test key: ${key}`);
  return { Body: Readable.from([memberBytes(generation, Number(match[1]))]) };
}

const openServers: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  s3Send.mockReset();
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("anonymous reviewed-profile member route", () => {
  it("loads all four ordinary members through two active slots and the bounded queue", async () => {
    const generation = "four-member";
    const state = buildState(generation);
    s3Send.mockImplementation((command: { input: { Key: string } }) =>
      Promise.resolve(storageResult(generation, command.input.Key))
    );
    const server = await routeServer(state);
    openServers.push(server);

    const responses = await Promise.all(ASSET_IDS.map((_id, index) => server.inject({
      method: "GET",
      url: `/assets/runtime-profiles/quality-sog-fine-v1/members/${String(index)}/content.sog`,
    })));
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(s3Send).toHaveBeenCalledTimes(4);
    expect(s3Send.mock.calls.every(([command]) =>
      (command as { input: { Bucket?: string } }).input.Bucket === "runtime-profiles-private"
    )).toBe(true);
  });

  it("single-flights concurrent requests for the same immutable member", async () => {
    const generation = "single-flight";
    const state = buildState(generation);
    let finish: ((value: { readonly Body: Readable }) => void) | undefined;
    s3Send.mockImplementation((command: { input: { Key: string } }) =>
      new Promise((resolve) => {
        finish = () => {
          resolve(storageResult(generation, command.input.Key));
        };
      })
    );
    const server = await routeServer(state);
    openServers.push(server);

    const first = server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
    });
    const second = server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
    });
    await vi.waitFor(() => {
      expect(s3Send).toHaveBeenCalledTimes(1);
    });
    finish?.({ Body: Readable.from([memberBytes(generation, 0)]) });
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it("returns no bytes when approval is revoked during the storage fetch", async () => {
    const generation = "revoked-mid-fetch";
    const state = buildState(generation);
    let finish: ((value: { readonly Body: Readable }) => void) | undefined;
    s3Send.mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const server = await routeServer(state);
    openServers.push(server);

    const responsePromise = server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
    });
    await vi.waitFor(() => {
      expect(s3Send).toHaveBeenCalledTimes(1);
    });
    state.approved = false;
    finish?.({ Body: Readable.from([memberBytes(generation, 0)]) });
    const response = await responsePromise;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "RUNTIME_PROFILE_AUTHORIZATION_CHANGED" });
    expect(response.body).not.toContain(memberBytes(generation, 0).toString("utf8"));
  });

  it("turns a 30-second protected-storage stall into a bounded 504", async () => {
    vi.useFakeTimers();
    const generation = "timeout";
    const state = buildState(generation);
    s3Send.mockImplementation((_command: unknown, options: { abortSignal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener("abort", () => {
          reject(options.abortSignal.reason instanceof Error
            ? options.abortSignal.reason
            : new DOMException("aborted", "AbortError"));
        }, { once: true });
      })
    );
    const server = await routeServer(state);
    openServers.push(server);

    const responsePromise = server.inject({
      method: "GET",
      url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
    });
    await vi.waitFor(() => {
      expect(s3Send).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const response = await responsePromise;
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ code: "RUNTIME_PROFILE_MEMBER_UPSTREAM_TIMEOUT" });
  });

  it("applies the tighter anonymous route limit while allowing six normal four-member loads", async () => {
    const generation = "rate-limit";
    const state = buildState(generation);
    s3Send.mockImplementation((command: { input: { Key: string } }) =>
      Promise.resolve(storageResult(generation, command.input.Key))
    );
    const server = await routeServer(state, true);
    openServers.push(server);

    const statuses: number[] = [];
    for (let requestIndex = 0; requestIndex < 25; requestIndex += 1) {
      const response = await server.inject({
        method: "GET",
        url: "/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 24).every((status) => status === 200)).toBe(true);
    expect(statuses[24]).toBe(429);
  });
});
