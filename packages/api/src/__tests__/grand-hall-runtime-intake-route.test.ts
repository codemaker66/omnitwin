import { createHash } from "node:crypto";
import { request as httpRequest, type ClientRequest } from "node:http";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { validateEnv, type Env } from "../env.js";
import { GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES } from "@omnitwin/types";
import {
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_MANIFEST_SHA256,
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
  GRAND_HALL_STAGING_GIT_BRANCH,
  GRAND_HALL_STAGING_PRIVATE_BUCKET,
  GRAND_HALL_STAGING_TARGET_ID,
  grandHallRoomOnlyRuntimeMembers,
  type GrandHallFrontierMemberSpec,
  type GrandHallRoomOnlyRuntimeAdmission,
} from "../lib/grand-hall-frontier-contract.js";
import {
  type GrandHallCommitResult,
  type GrandHallMemberUploadResult,
  type GrandHallPrepareResult,
  type GrandHallPrivateObjectStore,
  type GrandHallRegistrationStore,
} from "../services/grand-hall-runtime-intake.js";
import type { RuntimePackageRevisionRow } from "../services/runtime-package-revisions.js";
import { syntheticGrandHallRoomOnlyAdmission } from "./fixtures/grand-hall-room-only-evidence.js";

process.env["NODE_ENV"] = "test";

vi.mock("../lib/grand-hall-frontier-contract.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grand-hall-frontier-contract.js")>();
  const members = Array.from({ length: 11 }, (_, memberIndex) => {
    const fileIndex = memberIndex + 100;
    const bytes = Buffer.from(`exact-grand-hall-route-member-${String(fileIndex)}`, "utf8");
    return {
      fileIndex,
      relativePath: `data/3dgs/route-test-${String(memberIndex)}.sog`,
      fileName: `route-test-${String(memberIndex)}.sog`,
      fileExt: ".sog",
      depth: 5,
      nodeCount: 1,
      gaussianCount: memberIndex + 1,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    } satisfies GrandHallFrontierMemberSpec;
  });
  return {
    ...actual,
    GRAND_HALL_FRONTIER_MEMBERS: members,
    GRAND_HALL_FRONTIER_TOTAL_BYTES: members.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    ),
    GRAND_HALL_FRONTIER_GAUSSIAN_COUNT: members.reduce(
      (total, member) => total + member.gaussianCount,
      0,
    ),
    grandHallRoomOnlyRuntimeAdmissionError: (admission: unknown) =>
      admission === null ? "Synthetic room-only evidence is required." : null,
  };
});

const serviceMocks = vi.hoisted(() => ({
  prepare: vi.fn<
    (
      objectStore: GrandHallPrivateObjectStore,
      admission: GrandHallRoomOnlyRuntimeAdmission | null,
      signal?: AbortSignal,
    ) => Promise<GrandHallPrepareResult>
  >(),
  commit: vi.fn<
    (
      objectStore: GrandHallPrivateObjectStore,
      registrationStore: GrandHallRegistrationStore,
      actorUserId: string,
      admission: GrandHallRoomOnlyRuntimeAdmission | null,
      signal?: AbortSignal,
    ) => Promise<GrandHallCommitResult>
  >(),
  upload: vi.fn<
    (
      objectStore: GrandHallPrivateObjectStore,
      memberIndex: number,
      bytes: Uint8Array,
      admission: GrandHallRoomOnlyRuntimeAdmission | null,
      signal?: AbortSignal,
    ) => Promise<GrandHallMemberUploadResult>
  >(),
  probe: vi.fn<
    (
      objectStore: GrandHallPrivateObjectStore,
      corruptBytes: Uint8Array,
      admission: GrandHallRoomOnlyRuntimeAdmission | null,
      signal?: AbortSignal,
    ) => Promise<void>
  >(),
  createRegistrationStore: vi.fn<
    (db: Database) => GrandHallRegistrationStore
  >(),
}));

vi.mock("../services/grand-hall-runtime-intake.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../services/grand-hall-runtime-intake.js")
  >();
  return {
    ...actual,
    prepareGrandHallRuntimeIntake: serviceMocks.prepare,
    commitGrandHallRuntimeIntake: serviceMocks.commit,
    uploadGrandHallRuntimeMember: serviceMocks.upload,
    probeGrandHallRuntimeConditionalCreateConflict: serviceMocks.probe,
    createDatabaseGrandHallRegistrationStore: serviceMocks.createRegistrationStore,
  };
});

const {
  grandHallRuntimeIntakeRoutes,
  grandHallRuntimeIntakeTargetBinding,
} = await import("../routes/grand-hall-runtime-intake.js");

const ADMIN_USER_ID = "10000000-0000-4000-8000-000000000001";
const PACKAGE_ID = "10000000-0000-4000-8000-000000000002";
const PRIMARY_ASSET_ID = "10000000-0000-4000-8000-000000000003";
const TEST_ROOM_ONLY_ADMISSION = syntheticGrandHallRoomOnlyAdmission();
const TEST_RUNTIME_MEMBERS = grandHallRoomOnlyRuntimeMembers(TEST_ROOM_ONLY_ADMISSION);
const TARGET_ID = GRAND_HALL_STAGING_TARGET_ID;
const API_ORIGIN = "https://trades-hall-grand-hall-staging.up.railway.app";
const DEPLOYED_GIT_SHA = "a".repeat(40);
const CONTENT_DIGEST = "d".repeat(64);
const READ_SECRET = "route-test-read-secret-never-return";
const WRITE_SECRET = "route-test-write-secret-never-return";
const WRITE_SESSION_TOKEN = "route-test-write-session-token-never-return";
const DATABASE_PASSWORD = "route-test-database-password-never-return";
const PRIVATE_BUCKET = GRAND_HALL_STAGING_PRIVATE_BUCKET;
const STORAGE_ACCOUNT = "c".repeat(32);
const CONFIRMATION = "register_exact_internal_ready_grand_hall_frontier";

const validTargetRequest = {
  targetId: TARGET_ID,
  apiOrigin: API_ORIGIN,
  reviewedGitSha: DEPLOYED_GIT_SHA,
  manifestSha256: GRAND_HALL_MANIFEST_SHA256,
  frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
} as const;

function authToken(platformRole: "operator" | "admin"): string {
  return JSON.stringify({
    id: ADMIN_USER_ID,
    email: "route-test-admin@venviewer.example",
    name: "Route Test Admin",
    role: "admin",
    platformRole,
    venueId: null,
  });
}

function intakeEnv(enabled: boolean): Env {
  return validateEnv({
    NODE_ENV: "test",
    DATABASE_URL:
      `postgresql://${GRAND_HALL_STAGING_DATABASE_ROLE}:${DATABASE_PASSWORD}@ep-grand-hall-pooler.eu-west-2.aws.neon.tech/${GRAND_HALL_STAGING_DATABASE_NAME}?sslmode=require`,
    CLERK_SECRET_KEY: "sk_test_route-test",
    CLERK_WEBHOOK_SECRET: "whsec_route-test",
    FRONTEND_URL: "https://codex-grand-hall-venviewer.vercel.app",
    VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN:
      "https://codex-grand-hall-venviewer.vercel.app",
    CORS_ORIGINS: "https://codex-grand-hall-venviewer.vercel.app",
    PUBLIC_API_ORIGIN: API_ORIGIN,
    RUNTIME_PROFILE_R2_ACCOUNT_ID: STORAGE_ACCOUNT,
    RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "route-test-read-key-id-never-return",
    RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: READ_SECRET,
    RUNTIME_PROFILE_R2_PRIVATE_BUCKET: PRIVATE_BUCKET,
    RUNTIME_PROFILE_INTAKE_ENABLED: enabled ? "true" : "false",
    VENVIEWER_DEPLOYMENT_TARGET_ID: TARGET_ID,
    VENVIEWER_STAGING_REVIEWED_GIT_SHA: DEPLOYED_GIT_SHA,
    GIT_SHA: DEPLOYED_GIT_SHA,
    ...(enabled
      ? {
          RUNTIME_PROFILE_INTAKE_TARGET_ID: TARGET_ID,
          RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA: DEPLOYED_GIT_SHA,
          RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID:
            "route-test-write-key-id-never-return",
          RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: WRITE_SECRET,
          RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: WRITE_SESSION_TOKEN,
        }
      : {}),
    RAILWAY_PROJECT_NAME: TARGET_ID,
    RAILWAY_ENVIRONMENT_NAME: TARGET_ID,
    RAILWAY_SERVICE_NAME: TARGET_ID,
    RAILWAY_PUBLIC_DOMAIN: "trades-hall-grand-hall-staging.up.railway.app",
    RAILWAY_GIT_BRANCH: GRAND_HALL_STAGING_GIT_BRANCH,
    VENVIEWER_STAGING_EXPECTED_DATABASE_HOST:
      "ep-grand-hall-pooler.eu-west-2.aws.neon.tech",
  });
}

interface FakeDependencies {
  readonly objectStore: GrandHallPrivateObjectStore;
  readonly registrationStore: GrandHallRegistrationStore;
  readonly open: ReturnType<typeof vi.fn<GrandHallPrivateObjectStore["open"]>>;
  readonly putCreateOnly: ReturnType<
    typeof vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>
  >;
  readonly registerExactFrontier: ReturnType<
    typeof vi.fn<GrandHallRegistrationStore["registerExactFrontier"]>
  >;
}

function fakeDependencies(): FakeDependencies {
  const open = vi.fn<GrandHallPrivateObjectStore["open"]>();
  const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();
  const registerExactFrontier = vi.fn<
    GrandHallRegistrationStore["registerExactFrontier"]
  >();
  return {
    objectStore: { open, putCreateOnly },
    registrationStore: { registerExactFrontier },
    open,
    putCreateOnly,
    registerExactFrontier,
  };
}

async function routeServer(
  env: Env,
  dependencies: FakeDependencies,
  uploadRequestDeadlineMs?: number,
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(grandHallRuntimeIntakeRoutes, {
    db: {} as Database,
    env,
    objectStore: dependencies.objectStore,
    registrationStore: dependencies.registrationStore,
    roomOnlyAdmission: syntheticGrandHallRoomOnlyAdmission(),
    uploadRequestDeadlineMs,
    prefix: "/admin/assets",
  });
  await server.ready();
  return server;
}

function parsedData(response: LightMyRequestResponse): Record<string, unknown> {
  const parsed: unknown = JSON.parse(response.body);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("data" in parsed) ||
    parsed.data === null ||
    typeof parsed.data !== "object" ||
    Array.isArray(parsed.data)
  ) {
    throw new Error("Expected a response object containing a data object.");
  }
  return parsed.data as Record<string, unknown>;
}

function expectNoStore(response: LightMyRequestResponse): void {
  expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
  expect(response.headers["pragma"]).toBe("no-cache");
  expect(response.headers["vary"]).toBe("Origin, Authorization");
}

function expectSecretsRedacted(response: LightMyRequestResponse): void {
  for (const secret of [
    READ_SECRET,
    WRITE_SECRET,
    WRITE_SESSION_TOKEN,
    DATABASE_PASSWORD,
    STORAGE_ACCOUNT,
    "route-test-read-key-id-never-return",
    "route-test-write-key-id-never-return",
    "ep-grand-hall-pooler.eu-west-2.aws.neon.tech",
  ]) {
    expect(response.body).not.toContain(secret);
  }
}

function packageRow(): RuntimePackageRevisionRow {
  const timestamp = new Date("2026-08-22T12:00:00.000Z");
  return {
    id: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: CONTENT_DIGEST,
    primaryVisualAssetVersionId: PRIMARY_ASSET_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: PRIMARY_ASSET_ID,
        visualAssetVersionIds: [PRIMARY_ASSET_ID],
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function commitResult(created: boolean): GrandHallCommitResult {
  return {
    packageRow: packageRow(),
    contentDigest: CONTENT_DIGEST,
    created,
    assetVersionIds: TEST_RUNTIME_MEMBERS.map((_, index) =>
      `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    ),
    verifiedMemberCount: TEST_RUNTIME_MEMBERS.length,
    verifiedTotalBytes: TEST_ROOM_ONLY_ADMISSION.evidence.croppedVisual.totalBytes,
    gaussianCount: TEST_ROOM_ONLY_ADMISSION.evidence.croppedVisual.totalGaussianCount,
  };
}

function validCommitRequest(env: Env): Record<string, string> {
  const targetBindingSha256 = grandHallRuntimeIntakeTargetBinding(
    env,
    TEST_ROOM_ONLY_ADMISSION,
  );
  if (targetBindingSha256 === null) {
    throw new Error("Configured test intake environment did not produce a target binding.");
  }
  return {
    ...validTargetRequest,
    targetBindingSha256,
    confirmation: CONFIRMATION,
  };
}

function exactMemberBytes(memberIndex: number): Buffer {
  const member = TEST_RUNTIME_MEMBERS[memberIndex];
  if (member === undefined) throw new Error("Test upload member is missing.");
  return Buffer.from(
    `synthetic-grand-hall-cropped-output-${String(memberIndex).padStart(3, "0")}`,
    "utf8",
  );
}

function prepareResult(existingIndexes: ReadonlySet<number>): GrandHallPrepareResult {
  const members = TEST_RUNTIME_MEMBERS.map((member, memberIndex) => ({
    memberIndex,
    fileName: member.fileName,
    sizeBytes: member.sizeBytes,
    sha256: member.sha256,
    status: existingIndexes.has(memberIndex)
      ? "verified_existing" as const
      : "upload_required" as const,
  }));
  return {
    members,
    existingMemberCount: existingIndexes.size,
    uploadRequiredCount: members.length - existingIndexes.size,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error("Deferred promise was not initialized.");
  return { promise, resolve: resolvePromise };
}

function rehearsalHeaders(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const member = TEST_RUNTIME_MEMBERS[0];
  if (member === undefined) throw new Error("Test rehearsal member is missing.");
  return {
    authorization: `Bearer ${authToken("admin")}`,
    "content-type": "application/octet-stream",
    "content-length": String(member.sizeBytes),
    "x-venviewer-intake-target-id": TARGET_ID,
    "x-venviewer-intake-api-origin": API_ORIGIN,
    "x-venviewer-intake-deployed-git-sha": DEPLOYED_GIT_SHA,
    "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
    "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    ...overrides,
  };
}

function uploadHeaders(env: Env, memberIndex: number): Record<string, string> {
  const member = TEST_RUNTIME_MEMBERS[memberIndex];
  if (member === undefined) throw new Error("Test upload member is missing.");
  const binding = grandHallRuntimeIntakeTargetBinding(env, TEST_ROOM_ONLY_ADMISSION);
  if (binding === null) throw new Error("Test intake binding is missing.");
  return {
    authorization: `Bearer ${authToken("admin")}`,
    "content-type": "application/octet-stream",
    "content-length": String(member.sizeBytes),
    "x-venviewer-intake-target-id": TARGET_ID,
    "x-venviewer-intake-api-origin": API_ORIGIN,
    "x-venviewer-intake-target-binding-sha256": binding,
    "x-venviewer-intake-deployed-git-sha": DEPLOYED_GIT_SHA,
    "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
    "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  };
}

function startStalledBinaryUpload(
  port: number,
  headers: Record<string, string>,
  path = "/admin/assets/grand-hall-frontier-intake/members/0",
): {
  readonly request: ClientRequest;
  readonly response: Promise<{ readonly statusCode: number; readonly body: string }>;
} {
  let clientRequest: ClientRequest;
  const response = new Promise<{ readonly statusCode: number; readonly body: string }>(
    (resolve, reject) => {
      clientRequest = httpRequest({
        hostname: "127.0.0.1",
        port,
        method: "PUT",
        path,
        headers,
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        incoming.once("end", () => {
          resolve({
            statusCode: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });
      clientRequest.once("error", reject);
      clientRequest.write(Buffer.from([0]));
    },
  );
  return { request: clientRequest!, response };
}

beforeEach(() => {
  serviceMocks.prepare.mockReset();
  serviceMocks.commit.mockReset();
  serviceMocks.upload.mockReset();
  serviceMocks.probe.mockReset();
  serviceMocks.probe.mockResolvedValue(undefined);
  serviceMocks.createRegistrationStore.mockReset();
});

describe("Grand Hall frontier intake route boundary", () => {
  it("binds database username and query identity without exposing the database URL", () => {
    const base = intakeEnv(true);
    const differentUser = {
      ...base,
      DATABASE_URL: `postgresql://other-branch:${DATABASE_PASSWORD}@database.internal:5432/venviewer`,
    } satisfies Env;
    const differentQuery = {
      ...base,
      DATABASE_URL: `${base.DATABASE_URL}?options=project%3Dother`,
    } satisfies Env;
    const differentDeployment = {
      ...base,
      RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA: "b".repeat(40),
      GIT_SHA: "b".repeat(40),
    } satisfies Env;
    const binding = grandHallRuntimeIntakeTargetBinding(base, TEST_ROOM_ONLY_ADMISSION);
    expect(binding).toMatch(/^[a-f0-9]{64}$/u);
    expect(grandHallRuntimeIntakeTargetBinding(
      differentUser,
      TEST_ROOM_ONLY_ADMISSION,
    )).not.toBe(binding);
    expect(grandHallRuntimeIntakeTargetBinding(
      differentQuery,
      TEST_ROOM_ONLY_ADMISSION,
    )).not.toBe(binding);
    expect(grandHallRuntimeIntakeTargetBinding(
      differentDeployment,
      TEST_ROOM_ONLY_ADMISSION,
    )).not.toBe(binding);
    expect(binding).not.toContain(DATABASE_PASSWORD);
  });

  it("rejects an unconfigured room-only trust root before reading storage or registering", async () => {
    const dependencies = fakeDependencies();
    const server = Fastify({ logger: false });
    await server.register(grandHallRuntimeIntakeRoutes, {
      db: {} as Database,
      env: intakeEnv(true),
      objectStore: dependencies.objectStore,
      registrationStore: dependencies.registrationStore,
      prefix: "/admin/assets",
    });
    await server.ready();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "GRAND_HALL_ROOM_ONLY_EVIDENCE_REQUIRED",
      });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["missing", undefined],
    ["development placeholder", "dev"],
    ["configured mismatch", "b".repeat(40)],
  ] as const)("rejects an intake-enabled %s running build SHA before storage or DB work", async (_name, gitSha) => {
    const dependencies = fakeDependencies();
    const env = { ...intakeEnv(true), GIT_SHA: gitSha } satisfies Env;
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_DISABLED" });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("does not construct the database registration store for an invalid running build SHA", async () => {
    const server = Fastify({ logger: false });
    await server.register(grandHallRuntimeIntakeRoutes, {
      db: {} as Database,
      env: { ...intakeEnv(true), GIT_SHA: "dev" },
      prefix: "/admin/assets",
    });
    await server.ready();
    try {
      expect(serviceMocks.createRegistrationStore).not.toHaveBeenCalled();
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });
      expect(response.statusCode).toBe(503);
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(serviceMocks.createRegistrationStore).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["preflight", "/admin/assets/grand-hall-frontier-intake/preflight"],
    ["commit", "/admin/assets/grand-hall-frontier-intake/commit"],
  ])("returns 401 for anonymous %s requests before invoking dependencies", async (_, url) => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url,
        payload: url.endsWith("/commit") ? validCommitRequest(env) : validTargetRequest,
      });
      expect(response.statusCode).toBe(401);
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["preflight", "/admin/assets/grand-hall-frontier-intake/preflight"],
    ["commit", "/admin/assets/grand-hall-frontier-intake/commit"],
  ])("returns 403 for non-platform-admin %s requests before invoking dependencies", async (_, url) => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${authToken("operator")}` },
        payload: url.endsWith("/commit") ? validCommitRequest(env) : validTargetRequest,
      });
      expect(response.statusCode).toBe(403);
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["preflight", "/admin/assets/grand-hall-frontier-intake/preflight"],
    ["commit", "/admin/assets/grand-hall-frontier-intake/commit"],
  ])("returns 503 for disabled %s requests before invoking dependencies", async (_, url) => {
    const env = intakeEnv(false);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: url.endsWith("/commit")
          ? { ...validTargetRequest, targetBindingSha256: "a".repeat(64), confirmation: CONFIRMATION }
          : validTargetRequest,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_DISABLED" });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["target id", { ...validTargetRequest, targetId: "different-production-target" }, "GRAND_HALL_INTAKE_TARGET_MISMATCH"],
    ["API origin", { ...validTargetRequest, apiOrigin: "https://different.venviewer.example" }, "GRAND_HALL_INTAKE_TARGET_MISMATCH"],
    ["deployed Git SHA", { ...validTargetRequest, reviewedGitSha: "b".repeat(40) }, "GRAND_HALL_INTAKE_TARGET_MISMATCH"],
    ["manifest", { ...validTargetRequest, manifestSha256: "a".repeat(64) }, "GRAND_HALL_FRONTIER_MISMATCH"],
    ["frontier receipt", { ...validTargetRequest, frontierReceiptSha256: `sha256:${"b".repeat(64)}` }, "GRAND_HALL_FRONTIER_MISMATCH"],
  ])("rejects a mismatched %s before invoking dependencies", async (_, payload, code) => {
    const dependencies = fakeDependencies();
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["preflight", "/admin/assets/grand-hall-frontier-intake/preflight"],
    ["commit", "/admin/assets/grand-hall-frontier-intake/commit"],
  ])("rejects unknown %s fields before invoking dependencies", async (_, url) => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    const basePayload = url.endsWith("/commit") ? validCommitRequest(env) : validTargetRequest;
    try {
      const response = await server.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: { ...basePayload, privateBucket: "attacker-selected-bucket" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("returns a no-store, redacted preflight response from the injected object store", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const prepared: GrandHallPrepareResult = {
      members: GRAND_HALL_FRONTIER_MEMBERS.map((member, memberIndex) => ({
        memberIndex,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
        status: "upload_required",
      })),
      existingMemberCount: 0,
      uploadRequiredCount: TEST_RUNTIME_MEMBERS.length,
    };
    serviceMocks.prepare.mockResolvedValue(prepared);
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });
      expect(response.statusCode).toBe(200);
      expectNoStore(response);
      expectSecretsRedacted(response);
      expect(serviceMocks.prepare).toHaveBeenCalledOnce();
      expect(serviceMocks.prepare).toHaveBeenCalledWith(
        dependencies.objectStore,
        expect.objectContaining({
          acceptedEvidenceSha256: TEST_ROOM_ONLY_ADMISSION.acceptedEvidenceSha256,
        }),
        expect.any(AbortSignal),
      );
      expect(serviceMocks.createRegistrationStore).not.toHaveBeenCalled();
      expect(parsedData(response)).toMatchObject({
        operatorUserId: ADMIN_USER_ID,
        targetId: TARGET_ID,
        deployedGitSha: DEPLOYED_GIT_SHA,
        apiOrigin: API_ORIGIN,
        manifestSha256: GRAND_HALL_MANIFEST_SHA256,
        frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
        memberCount: TEST_RUNTIME_MEMBERS.length,
        existingMemberCount: 0,
        uploadRequiredCount: TEST_RUNTIME_MEMBERS.length,
      });
      expect(response.body).not.toContain("r2Key");
      expect(response.body).not.toContain("databaseTarget");
      expect(response.body).not.toContain("assetVersionIds");
      const data = parsedData(response);
      const members = data["members"];
      expect(Array.isArray(members)).toBe(true);
      expect(members).toEqual(expect.arrayContaining([
        expect.objectContaining({
          memberIndex: 0,
          upload: expect.objectContaining({
            path: "/admin/assets/grand-hall-frontier-intake/members/0",
          }),
        }),
      ]));
    } finally {
      await server.close();
    }
  });

  it("requires one platform-admin authentication for the binary rehearsal", async () => {
    const dependencies = fakeDependencies();
    const exactBytes = exactMemberBytes(0);
    const anonymousHeaders = rehearsalHeaders();
    delete anonymousHeaders["authorization"];
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const anonymous = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: anonymousHeaders,
        payload: exactBytes,
      });
      const operator = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: {
          ...rehearsalHeaders(),
          authorization: `Bearer ${authToken("operator")}`,
        },
        payload: exactBytes,
      });

      expect(anonymous.statusCode).toBe(401);
      expect(operator.statusCode).toBe(403);
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    [
      "target identity",
      { "x-venviewer-intake-target-id": "different-staging-target" },
      exactMemberBytes(0),
      "GRAND_HALL_INTAKE_TARGET_MISMATCH",
    ],
    [
      "deployed build identity",
      { "x-venviewer-intake-deployed-git-sha": "b".repeat(40) },
      exactMemberBytes(0),
      "GRAND_HALL_INTAKE_TARGET_MISMATCH",
    ],
    [
      "source identity",
      { "x-venviewer-manifest-sha256": "b".repeat(64) },
      exactMemberBytes(0),
      "GRAND_HALL_FRONTIER_MISMATCH",
    ],
    [
      "same-length changed body",
      {},
      (() => {
        const bytes = exactMemberBytes(0);
        bytes[0] = (bytes[0] ?? 0) ^ 0xff;
        return bytes;
      })(),
      "GRAND_HALL_STORAGE_CONFLICT",
    ],
  ] as const)("rejects changed rehearsal %s before storage work", async (
    _name,
    headerOverrides,
    payload,
    code,
  ) => {
    const dependencies = fakeDependencies();
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: rehearsalHeaders(headerOverrides),
        payload,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("requires a fresh all-missing cropped-output rehearsal target before any PUT", async () => {
    const dependencies = fakeDependencies();
    serviceMocks.prepare.mockResolvedValue(prepareResult(new Set([0])));
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: rehearsalHeaders(),
        payload: exactMemberBytes(0),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_STORAGE_CONFLICT" });
      expect(serviceMocks.prepare).toHaveBeenCalledOnce();
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("runs create, retry, corrupt-copy, and read-back evidence in one request without registration", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test rehearsal member is missing.");
    const exactBytes = exactMemberBytes(0);
    let corruptBytesReference: Uint8Array | undefined;
    serviceMocks.prepare
      .mockResolvedValueOnce(prepareResult(new Set()))
      .mockResolvedValueOnce(prepareResult(new Set([0])));
    serviceMocks.upload
      .mockResolvedValueOnce({
        created: true,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      })
      .mockResolvedValueOnce({
        created: false,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      });
    serviceMocks.probe.mockImplementationOnce((_store, bytes) => {
      corruptBytesReference = bytes;
      expect(bytes.byteLength).toBe(exactBytes.byteLength);
      expect(Buffer.from(bytes)).not.toEqual(exactBytes);
      return Promise.resolve();
    });
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: rehearsalHeaders(),
        payload: exactBytes,
      });

      expect(response.statusCode).toBe(200);
      expectNoStore(response);
      expectSecretsRedacted(response);
      expect(serviceMocks.prepare).toHaveBeenCalledTimes(2);
      expect(serviceMocks.upload).toHaveBeenCalledTimes(2);
      expect(serviceMocks.probe).toHaveBeenCalledOnce();
      expect(serviceMocks.upload.mock.calls[0]?.[1]).toBe(0);
      expect(serviceMocks.upload.mock.calls[0]?.[2]).toEqual(exactBytes);
      expect(serviceMocks.upload.mock.calls[1]?.[2]).toEqual(exactBytes);
      expect(corruptBytesReference?.every((byte) => byte === 0)).toBe(true);
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
      expect(parsedData(response)).toEqual({
        schemaVersion: "venviewer.grand-hall-intake-rehearsal.v1",
        operatorUserId: ADMIN_USER_ID,
        targetId: TARGET_ID,
        deployedGitSha: DEPLOYED_GIT_SHA,
        apiOrigin: API_ORIGIN,
        manifestSha256: GRAND_HALL_MANIFEST_SHA256,
        frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
        member: {
          memberIndex: 0,
          fileName: member.fileName,
          sizeBytes: member.sizeBytes,
          sha256: member.sha256,
        },
        initialPreflight: {
          existingMemberCount: 0,
          uploadRequiredCount: 2,
        },
        conditionalPut: {
          created: { statusCode: 201, created: true },
          exactRetry: { statusCode: 200, created: false },
          corruptCopy: {
            statusCode: 409,
            code: "GRAND_HALL_STORAGE_CONFLICT",
            storedBytesUnchanged: true,
          },
        },
        finalPreflight: {
          existingMemberCount: 1,
          uploadRequiredCount: 1,
        },
        commitAttempted: false,
        registrationAttempted: false,
      });
    } finally {
      await server.close();
    }
  });

  it("holds the exclusive intake gate for the complete one-request rehearsal", async () => {
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test rehearsal member is missing.");
    const initial = deferred<GrandHallPrepareResult>();
    serviceMocks.prepare
      .mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce(prepareResult(new Set([0])));
    serviceMocks.upload
      .mockResolvedValueOnce({
        created: true,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      })
      .mockResolvedValueOnce({
        created: false,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      });
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const rehearsal = server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: rehearsalHeaders(),
        payload: exactMemberBytes(0),
      });
      await vi.waitFor(() => {
        expect(serviceMocks.prepare).toHaveBeenCalledOnce();
      });

      const concurrentPreflight = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });
      const concurrentUpload = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: uploadHeaders(intakeEnv(true), 0),
        payload: exactMemberBytes(0),
      });

      expect(concurrentPreflight.statusCode).toBe(429);
      expect(concurrentPreflight.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_BUSY" });
      expect(concurrentUpload.statusCode).toBe(429);
      expect(concurrentUpload.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_BUSY" });
      initial.resolve(prepareResult(new Set()));
      expect((await rehearsal).statusCode).toBe(200);
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      initial.resolve(prepareResult(new Set()));
      await server.close();
    }
  });

  it("times out a stalled rehearsal body and releases both admission gates", async () => {
    const dependencies = fakeDependencies();
    const server = await routeServer(intakeEnv(true), dependencies, 150);
    let client: ClientRequest | undefined;
    try {
      await server.listen({ host: "127.0.0.1", port: 0 });
      const address = server.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not bind to a TCP port.");
      }
      const stalled = startStalledBinaryUpload(
        address.port,
        rehearsalHeaders(),
        "/admin/assets/grand-hall-frontier-intake/rehearsal",
      );
      client = stalled.request;
      const timedOut = await stalled.response;

      expect(timedOut.statusCode).toBe(408);
      expect(JSON.parse(timedOut.body)).toMatchObject({ code: "GRAND_HALL_INTAKE_TIMEOUT" });
      expect(serviceMocks.prepare).not.toHaveBeenCalled();
      expect(serviceMocks.upload).not.toHaveBeenCalled();

      serviceMocks.prepare.mockResolvedValue(prepareResult(new Set()));
      const recovered = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/preflight",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validTargetRequest,
      });
      expect(recovered.statusCode).toBe(200);
      expect(serviceMocks.prepare).toHaveBeenCalledOnce();
    } finally {
      client?.destroy();
      await server.close();
    }
  });

  it("fails closed when post-rehearsal storage is not one-existing/rest-missing", async () => {
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test rehearsal member is missing.");
    serviceMocks.prepare
      .mockResolvedValueOnce(prepareResult(new Set()))
      .mockResolvedValueOnce(prepareResult(new Set([0, 1])));
    serviceMocks.upload
      .mockResolvedValueOnce({
        created: true,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      })
      .mockResolvedValueOnce({
        created: false,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      });
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/rehearsal",
        headers: rehearsalHeaders(),
        payload: exactMemberBytes(0),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_STORAGE_CONFLICT" });
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects an unauthenticated binary upload before parsing or storage work", async () => {
    const dependencies = fakeDependencies();
    const server = await routeServer(intakeEnv(true), dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from([0]),
      });
      expect(response.statusCode).toBe(401);
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects a non-platform-admin binary upload before parsing or storage work", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: {
          ...uploadHeaders(env, 0),
          authorization: `Bearer ${authToken("operator")}`,
        },
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(response.statusCode).toBe(403);
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects a disabled binary upload before parsing or storage work", async () => {
    const enabledEnv = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    const server = await routeServer(intakeEnv(false), dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: uploadHeaders(enabledEnv, 0),
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_DISABLED" });
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects a changed binary upload target binding before storage work", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: {
          ...uploadHeaders(env, 0),
          "x-venviewer-intake-target-binding-sha256": "f".repeat(64),
        },
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_TARGET_MISMATCH" });
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects a wrong member length before buffering reaches storage", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: {
          ...uploadHeaders(env, 0),
          "content-length": "1",
        },
        payload: Buffer.from([0]),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_FRONTIER_MISMATCH" });
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects a member larger than the shared authenticated-preview ceiling", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: {
          ...uploadHeaders(env, 0),
          "content-length": String(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES + 1),
        },
        payload: Buffer.alloc(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES + 1),
      });
      expect(response.statusCode).toBe(400);
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("accepts one exact API-proxied member without exposing private storage identity", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    serviceMocks.upload.mockResolvedValue({
      created: true,
      memberIndex: 0,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
    });
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: uploadHeaders(env, 0),
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(response.statusCode).toBe(201);
      expectNoStore(response);
      expectSecretsRedacted(response);
      expect(serviceMocks.upload).toHaveBeenCalledWith(
        dependencies.objectStore,
        0,
        expect.any(Buffer),
        expect.objectContaining({
          acceptedEvidenceSha256: TEST_ROOM_ONLY_ADMISSION.acceptedEvidenceSha256,
        }),
        expect.any(AbortSignal),
      );
      expect(parsedData(response)).toEqual({
        operatorUserId: ADMIN_USER_ID,
        created: true,
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      });
      expect(response.body).not.toMatch(/r2Key|privateBucket|storageAccount|databaseTarget/u);
    } finally {
      await server.close();
    }
  });

  it("returns 200 for an exact idempotent member retry", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    serviceMocks.upload.mockResolvedValue({
      created: false,
      memberIndex: 0,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
    });
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: uploadHeaders(env, 0),
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(response.statusCode).toBe(200);
      expect(serviceMocks.upload).toHaveBeenCalledOnce();
      expectNoStore(response);
      expectSecretsRedacted(response);
      expect(parsedData(response)).toMatchObject({
        operatorUserId: ADMIN_USER_ID,
        created: false,
      });
    } finally {
      await server.close();
    }
  });

  it("times out stalled request bodies and releases both binary upload slots", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const member = TEST_RUNTIME_MEMBERS[0];
    if (member === undefined) throw new Error("Test upload member is missing.");
    serviceMocks.upload.mockResolvedValue({
      created: true,
      memberIndex: 0,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
    });
    const server = await routeServer(env, dependencies, 150);
    const clients: ClientRequest[] = [];
    try {
      await server.listen({ host: "127.0.0.1", port: 0 });
      const address = server.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not bind to a TCP port.");
      }
      const first = startStalledBinaryUpload(address.port, uploadHeaders(env, 0));
      const second = startStalledBinaryUpload(address.port, uploadHeaders(env, 0));
      clients.push(first.request, second.request);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const busy = startStalledBinaryUpload(address.port, uploadHeaders(env, 0));
      clients.push(busy.request);
      const busyResponse = await busy.response;
      expect(busyResponse.statusCode).toBe(429);
      expect(JSON.parse(busyResponse.body)).toMatchObject({ code: "GRAND_HALL_INTAKE_BUSY" });

      const [firstResponse, secondResponse] = await Promise.all([
        first.response,
        second.response,
      ]);
      expect(firstResponse.statusCode).toBe(408);
      expect(secondResponse.statusCode).toBe(408);
      expect(JSON.parse(firstResponse.body)).toMatchObject({ code: "GRAND_HALL_INTAKE_TIMEOUT" });
      expect(JSON.parse(secondResponse.body)).toMatchObject({ code: "GRAND_HALL_INTAKE_TIMEOUT" });
      expect(serviceMocks.upload).not.toHaveBeenCalled();
      expect(dependencies.putCreateOnly).not.toHaveBeenCalled();

      const recovered = await server.inject({
        method: "PUT",
        url: "/admin/assets/grand-hall-frontier-intake/members/0",
        headers: uploadHeaders(env, 0),
        payload: Buffer.alloc(member.sizeBytes),
      });
      expect(recovered.statusCode).toBe(201);
      expect(serviceMocks.upload).toHaveBeenCalledOnce();
    } finally {
      for (const client of clients) client.destroy();
      await server.close();
    }
  });

  it("rejects a changed commit target binding before invoking dependencies", async () => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/commit",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: {
          ...validCommitRequest(env),
          targetBindingSha256: "f".repeat(64),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "GRAND_HALL_INTAKE_TARGET_MISMATCH" });
      expect(serviceMocks.commit).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.registerExactFrontier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    { created: true, expectedStatus: 201 },
    { created: false, expectedStatus: 200 },
  ])("returns a redacted $expectedStatus response for created=$created", async ({
    created,
    expectedStatus,
  }) => {
    const env = intakeEnv(true);
    const dependencies = fakeDependencies();
    serviceMocks.commit.mockResolvedValue(commitResult(created));
    const server = await routeServer(env, dependencies);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/assets/grand-hall-frontier-intake/commit",
        headers: { authorization: `Bearer ${authToken("admin")}` },
        payload: validCommitRequest(env),
      });
      expect(response.statusCode).toBe(expectedStatus);
      expectNoStore(response);
      expectSecretsRedacted(response);
      expect(serviceMocks.commit).toHaveBeenCalledOnce();
      expect(serviceMocks.commit).toHaveBeenCalledWith(
        dependencies.objectStore,
        dependencies.registrationStore,
        ADMIN_USER_ID,
        expect.objectContaining({
          acceptedEvidenceSha256: syntheticGrandHallRoomOnlyAdmission().acceptedEvidenceSha256,
        }),
        expect.any(AbortSignal),
      );
      expect(serviceMocks.createRegistrationStore).not.toHaveBeenCalled();
      expect(parsedData(response)).toEqual({
        operatorUserId: ADMIN_USER_ID,
        targetId: TARGET_ID,
        deployedGitSha: DEPLOYED_GIT_SHA,
        runtimePackageId: PACKAGE_ID,
        revision: 1,
        contentDigest: CONTENT_DIGEST,
        created,
        memberCount: TEST_RUNTIME_MEMBERS.length,
        totalBytes: TEST_ROOM_ONLY_ADMISSION.evidence.croppedVisual.totalBytes,
        gaussianCount: TEST_ROOM_ONLY_ADMISSION.evidence.croppedVisual.totalGaussianCount,
      });
      expect(response.body).not.toContain(PRIMARY_ASSET_ID);
      expect(response.body).not.toContain("assetVersionIds");
      expect(response.body).not.toContain("packageRow");
      expect(response.body).not.toContain("r2Key");
    } finally {
      await server.close();
    }
  });
});
