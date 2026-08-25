import { createHash, createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES } from "@omnitwin/types";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import {
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_MANIFEST_SHA256,
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
  GRAND_HALL_STAGING_GIT_BRANCH,
  GRAND_HALL_STAGING_PRIVATE_BUCKET,
  GRAND_HALL_STAGING_TARGET_ID,
  grandHallRoomOnlyRuntimeMembers,
  grandHallRoomOnlyRuntimeAdmissionError,
  grandHallObjectKey,
  type GrandHallRuntimeMemberSpec,
  type GrandHallRoomOnlyRuntimeAdmission,
} from "../lib/grand-hall-frontier-contract.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import {
  GrandHallRuntimeIntakeError,
  commitGrandHallRuntimeIntake,
  createDatabaseGrandHallRegistrationStore,
  prepareGrandHallRuntimeIntake,
  probeGrandHallRuntimeConditionalCreateConflict,
  uploadGrandHallRuntimeMember,
  type GrandHallMemberUploadResult,
  type GrandHallPrivateObjectStore,
  type GrandHallPrepareResult,
  type GrandHallRegistrationStore,
  type GrandHallRemoteObject,
} from "../services/grand-hall-runtime-intake.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40,64}$/u;
const INTAKE_CONFIRMATION = "register_exact_internal_ready_grand_hall_frontier";
const MAX_CONCURRENT_UPLOADS = 2;
export const GRAND_HALL_UPLOAD_REQUEST_DEADLINE_MS = 60_000;

const TargetRequestSchema = z.object({
  targetId: z.string().min(3).max(80),
  apiOrigin: z.string().url().max(500),
  reviewedGitSha: z.string().regex(GIT_SHA),
  manifestSha256: z.string().regex(SHA256_HEX),
  frontierReceiptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

const CommitRequestSchema = TargetRequestSchema.extend({
  targetBindingSha256: z.string().regex(SHA256_HEX),
  confirmation: z.literal(INTAKE_CONFIRMATION),
}).strict();

const MemberParamsSchema = z.object({
  memberIndex: z.coerce.number().int().min(0).max(1_023),
});

const MemberHeadersSchema = z.object({
  "content-type": z.literal("application/octet-stream"),
  "content-length": z.coerce.number().int().positive()
    .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES),
  "x-venviewer-intake-target-id": z.string().min(3).max(80),
  "x-venviewer-intake-api-origin": z.string().url().max(500),
  "x-venviewer-intake-target-binding-sha256": z.string().regex(SHA256_HEX),
  "x-venviewer-intake-deployed-git-sha": z.string().regex(GIT_SHA),
  "x-venviewer-manifest-sha256": z.string().regex(SHA256_HEX),
  "x-venviewer-frontier-receipt-sha256": z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).passthrough();

const RehearsalHeadersSchema = z.object({
  "content-type": z.literal("application/octet-stream"),
  "content-length": z.coerce.number().int().positive()
    .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES),
  "x-venviewer-intake-target-id": z.string().min(3).max(80),
  "x-venviewer-intake-api-origin": z.string().url().max(500),
  "x-venviewer-intake-deployed-git-sha": z.string().regex(GIT_SHA),
  "x-venviewer-manifest-sha256": z.string().regex(SHA256_HEX),
  "x-venviewer-frontier-receipt-sha256": z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).passthrough();

interface GrandHallRuntimeIntakeRoutesOptions {
  readonly db: Database;
  readonly env: Env;
  readonly objectStore?: GrandHallPrivateObjectStore;
  readonly registrationStore?: GrandHallRegistrationStore;
  /** Test/review seam. Production has no value until real evidence is accepted. */
  readonly roomOnlyAdmission?: GrandHallRoomOnlyRuntimeAdmission;
  readonly uploadRequestDeadlineMs?: number;
}

type S3Client = import("@aws-sdk/client-s3").S3Client;

export function grandHallRuntimeIntakeConfigured(env: Env): boolean {
  let publicApiOrigin: URL | null = null;
  try {
    publicApiOrigin = env.PUBLIC_API_ORIGIN === undefined
      ? null
      : new URL(env.PUBLIC_API_ORIGIN);
  } catch {
    publicApiOrigin = null;
  }
  let databaseUrl: URL | null = null;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    databaseUrl = null;
  }
  return env.RUNTIME_PROFILE_INTAKE_ENABLED === "true" &&
    env.VENVIEWER_DEPLOYMENT_TARGET_ID === GRAND_HALL_STAGING_TARGET_ID &&
    env.RUNTIME_PROFILE_INTAKE_TARGET_ID === GRAND_HALL_STAGING_TARGET_ID &&
    env.RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA !== undefined &&
    env.RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID !== undefined &&
    env.RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY !== undefined &&
    env.RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN !== undefined &&
    env.RUNTIME_PROFILE_R2_ACCOUNT_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY !== undefined &&
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET === GRAND_HALL_STAGING_PRIVATE_BUCKET &&
    publicApiOrigin !== null &&
    publicApiOrigin.protocol === "https:" &&
    publicApiOrigin.hostname.endsWith(".up.railway.app") &&
    publicApiOrigin.hostname !== "up.railway.app" &&
    publicApiOrigin.origin === env.PUBLIC_API_ORIGIN &&
    env.RAILWAY_PROJECT_NAME === GRAND_HALL_STAGING_TARGET_ID &&
    env.RAILWAY_ENVIRONMENT_NAME === GRAND_HALL_STAGING_TARGET_ID &&
    env.RAILWAY_SERVICE_NAME === GRAND_HALL_STAGING_TARGET_ID &&
    env.RAILWAY_GIT_BRANCH === GRAND_HALL_STAGING_GIT_BRANCH &&
    env.RAILWAY_PUBLIC_DOMAIN === publicApiOrigin.hostname &&
    databaseUrl !== null &&
    databaseUrl.hostname === env.VENVIEWER_STAGING_EXPECTED_DATABASE_HOST &&
    databaseUrl.username === GRAND_HALL_STAGING_DATABASE_ROLE &&
    databaseUrl.pathname === `/${GRAND_HALL_STAGING_DATABASE_NAME}` &&
    env.FRONTEND_URL?.endsWith(".vercel.app") === true &&
    env.VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN === env.FRONTEND_URL &&
    env.CORS_ORIGINS === env.FRONTEND_URL &&
    env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true &&
    env.CLERK_WEBHOOK_SECRET?.startsWith("whsec_") === true &&
    env.GIT_SHA !== undefined &&
    GIT_SHA.test(env.GIT_SHA) &&
    env.VENVIEWER_STAGING_REVIEWED_GIT_SHA === env.GIT_SHA &&
    env.GIT_SHA === env.RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA;
}

export function grandHallRuntimeIntakeTargetBinding(
  env: Env,
  admission: GrandHallRoomOnlyRuntimeAdmission | null = null,
): string | null {
  if (
    !grandHallRuntimeIntakeConfigured(env)
    || admission === null
    || grandHallRoomOnlyRuntimeAdmissionError(admission) !== null
  ) return null;
  const members = grandHallRoomOnlyRuntimeMembers(admission);
  const storagePrefix = members[0]?.objectPrefix;
  if (storagePrefix === undefined) return null;
  return createHmac(
    "sha256",
    env.RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY ?? "",
  ).update(JSON.stringify({
    schemaVersion: "venviewer.grand-hall-intake-target.v1",
    targetId: env.RUNTIME_PROFILE_INTAKE_TARGET_ID,
    deployedGitSha: env.GIT_SHA,
    configuredDeployedGitSha: env.RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA,
    apiOrigin: env.PUBLIC_API_ORIGIN,
    databaseUrl: env.DATABASE_URL,
    storageAccountId: env.RUNTIME_PROFILE_R2_ACCOUNT_ID,
    storageBucket: env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET,
    storagePrefix,
    frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    roomOnlyEvidenceSha256: admission.evidence.evidenceSha256,
  })).digest("hex");
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "private, no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Vary", "Origin, Authorization");
}

function validationError(reply: FastifyReply, details: unknown) {
  noStore(reply);
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function safeErrorReply(reply: FastifyReply, error: unknown) {
  noStore(reply);
  if (error instanceof GrandHallRuntimeIntakeError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  return reply.status(500).send({
    error: "The Grand Hall intake operation failed safely.",
    code: "GRAND_HALL_INTAKE_FAILED",
  });
}

function targetError(
  env: Env,
  input: z.infer<typeof TargetRequestSchema>,
  roomOnlyAdmission: GrandHallRoomOnlyRuntimeAdmission | null,
): { readonly statusCode: 409 | 503; readonly code: string; readonly message: string } | null {
  if (!grandHallRuntimeIntakeConfigured(env)) {
    return {
      statusCode: 503,
      code: "GRAND_HALL_INTAKE_DISABLED",
      message: "Grand Hall intake is disabled or incompletely configured on this server.",
    };
  }
  if (
    input.targetId !== GRAND_HALL_STAGING_TARGET_ID ||
    env.RUNTIME_PROFILE_INTAKE_TARGET_ID !== GRAND_HALL_STAGING_TARGET_ID ||
    input.apiOrigin !== env.PUBLIC_API_ORIGIN ||
    input.reviewedGitSha !== env.RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA
  ) {
    return {
      statusCode: 409,
      code: "GRAND_HALL_INTAKE_TARGET_MISMATCH",
      message: "The explicitly selected intake target does not match this server.",
    };
  }
  if (
    input.manifestSha256 !== GRAND_HALL_MANIFEST_SHA256 ||
    input.frontierReceiptSha256 !== GRAND_HALL_FRONTIER_RECEIPT_SHA256
  ) {
    return {
      statusCode: 409,
      code: "GRAND_HALL_FRONTIER_MISMATCH",
      message: "The requested source identity is not the canonical Grand Hall frontier.",
    };
  }
  const roomOnlyEvidenceError = grandHallRoomOnlyRuntimeAdmissionError(roomOnlyAdmission);
  if (roomOnlyEvidenceError !== null) {
    return {
      statusCode: 409,
      code: "GRAND_HALL_ROOM_ONLY_EVIDENCE_REQUIRED",
      message: roomOnlyEvidenceError,
    };
  }
  return null;
}

function rehearsalIntegrityError(message: string): GrandHallRuntimeIntakeError {
  return new GrandHallRuntimeIntakeError(
    500,
    "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
    message,
  );
}

function rehearsalStorageConflict(message: string): GrandHallRuntimeIntakeError {
  return new GrandHallRuntimeIntakeError(
    409,
    "GRAND_HALL_STORAGE_CONFLICT",
    message,
  );
}

function preparedResultHasCanonicalShape(
  prepared: GrandHallPrepareResult,
  runtimeMembers: readonly GrandHallRuntimeMemberSpec[],
): boolean {
  if (prepared.members.length !== runtimeMembers.length) return false;
  if (prepared.existingMemberCount + prepared.uploadRequiredCount !== prepared.members.length) {
    return false;
  }
  return prepared.members.every((candidate, memberIndex) => {
    const member = runtimeMembers[memberIndex];
    return member !== undefined &&
      candidate.memberIndex === memberIndex &&
      candidate.fileName === member.fileName &&
      candidate.sizeBytes === member.sizeBytes &&
      candidate.sha256 === member.sha256;
  });
}

function assertRehearsalPreparedState(
  prepared: GrandHallPrepareResult,
  expectedExistingIndexes: ReadonlySet<number>,
  stage: "initial" | "final",
  runtimeMembers: readonly GrandHallRuntimeMemberSpec[],
): void {
  if (!preparedResultHasCanonicalShape(prepared, runtimeMembers)) {
    throw rehearsalIntegrityError("The Grand Hall rehearsal received inconsistent storage evidence.");
  }
  const expectedExistingCount = expectedExistingIndexes.size;
  const expectedUploadCount = runtimeMembers.length - expectedExistingCount;
  const statusMatches = prepared.members.every((member, memberIndex) =>
    member.status === (expectedExistingIndexes.has(memberIndex)
      ? "verified_existing"
      : "upload_required"));
  if (
    prepared.existingMemberCount !== expectedExistingCount ||
    prepared.uploadRequiredCount !== expectedUploadCount ||
    !statusMatches
  ) {
    throw rehearsalStorageConflict(stage === "initial"
      ? "The conditional-PUT rehearsal requires a fresh empty Grand Hall storage prefix."
      : "The conditional-PUT rehearsal did not leave exactly one verified Grand Hall member.");
  }
}

function assertRehearsalUploadResult(
  result: GrandHallMemberUploadResult,
  expectedCreated: boolean,
  runtimeMembers: readonly GrandHallRuntimeMemberSpec[],
): void {
  const member = runtimeMembers[0];
  if (
    member === undefined ||
    result.created !== expectedCreated ||
    result.memberIndex !== 0 ||
    result.fileName !== member.fileName ||
    result.sizeBytes !== member.sizeBytes ||
    result.sha256 !== member.sha256
  ) {
    throw rehearsalIntegrityError("The Grand Hall rehearsal returned inconsistent PUT evidence.");
  }
}

interface GrandHallConditionalPutRehearsalResult {
  readonly initial: GrandHallPrepareResult;
  readonly final: GrandHallPrepareResult;
}

async function runGrandHallConditionalPutRehearsal(
  objectStore: GrandHallPrivateObjectStore,
  exactBytes: Buffer,
  signal: AbortSignal,
  admission: GrandHallRoomOnlyRuntimeAdmission | null,
  runtimeMembers: readonly GrandHallRuntimeMemberSpec[],
): Promise<GrandHallConditionalPutRehearsalResult> {
  const initial = await prepareGrandHallRuntimeIntake(objectStore, admission, signal);
  assertRehearsalPreparedState(initial, new Set(), "initial", runtimeMembers);

  const created = await uploadGrandHallRuntimeMember(
    objectStore, 0, exactBytes, admission, signal,
  );
  assertRehearsalUploadResult(created, true, runtimeMembers);
  const retried = await uploadGrandHallRuntimeMember(
    objectStore, 0, exactBytes, admission, signal,
  );
  assertRehearsalUploadResult(retried, false, runtimeMembers);

  const corruptBytes = Buffer.from(exactBytes);
  corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 0xff;
  try {
    await probeGrandHallRuntimeConditionalCreateConflict(
      objectStore,
      corruptBytes,
      admission,
      signal,
    );
  } finally {
    corruptBytes.fill(0);
  }

  const final = await prepareGrandHallRuntimeIntake(objectStore, admission, signal);
  assertRehearsalPreparedState(final, new Set([0]), "final", runtimeMembers);
  return { initial, final };
}

function asyncByteBody(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function destroyBody(value: unknown): void {
  if (
    typeof value === "object" &&
    value !== null &&
    "destroy" in value &&
    typeof value.destroy === "function"
  ) {
    value.destroy();
    return;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "cancel" in value &&
    typeof value.cancel === "function"
  ) {
    void Promise.resolve(value.cancel()).catch(() => undefined);
  }
}

export function isGrandHallMissingObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const name = record["name"];
  if (name === "NoSuchKey" || name === "NotFound") return true;
  // A named bucket/configuration failure must never be downgraded to an
  // upload-required member merely because the provider also returned 404.
  if (typeof name === "string" && name.length > 0) return false;
  const metadata = record["$metadata"];
  return typeof metadata === "object" && metadata !== null &&
    (metadata as Record<string, unknown>)["httpStatusCode"] === 404;
}

export function isGrandHallConditionalCreateConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const metadata = record["$metadata"];
  const statusCode = typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)["httpStatusCode"]
    : null;
  return statusCode === 409 || statusCode === 412 ||
    record["name"] === "PreconditionFailed" || record["name"] === "ConditionalRequestConflict";
}

function grandHallR2Endpoint(accountId: string | undefined): string {
  if (accountId === undefined || !/^[a-f0-9]{32}$/u.test(accountId)) {
    throw new Error("Grand Hall private-storage account identity is invalid");
  }
  const expectedHostname = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = new URL(`https://${expectedHostname}`);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hostname !== expectedHostname ||
    endpoint.port !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    endpoint.origin !== `https://${expectedHostname}`
  ) {
    throw new Error("Grand Hall private-storage endpoint identity is invalid");
  }
  return endpoint.origin;
}

function grandHallR2ClientBaseOptions(env: Env) {
  return {
    region: "auto",
    endpoint: grandHallR2Endpoint(env.RUNTIME_PROFILE_R2_ACCOUNT_ID),
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
  };
}

export function grandHallR2ReadClientOptions(env: Env) {
  return {
    ...grandHallR2ClientBaseOptions(env),
    credentials: {
      accessKeyId: env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY ?? "",
    },
  };
}

export function grandHallR2WriteClientOptions(env: Env) {
  return {
    ...grandHallR2ClientBaseOptions(env),
    credentials: {
      accessKeyId: env.RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY ?? "",
      sessionToken: env.RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN ?? "",
    },
  };
}

export function grandHallR2GetObjectInput(
  env: Env,
  member: GrandHallRuntimeMemberSpec,
) {
  return {
    Bucket: env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET ?? "",
    Key: grandHallObjectKey(member),
  };
}

export function grandHallR2PutObjectInput(
  env: Env,
  member: GrandHallRuntimeMemberSpec,
  bytes: Uint8Array,
) {
  return {
    ...grandHallR2GetObjectInput(env, member),
    Body: bytes,
    ContentType: "application/octet-stream",
    ContentLength: member.sizeBytes,
    IfNoneMatch: "*",
  };
}

export function createGrandHallR2ObjectStore(env: Env): GrandHallPrivateObjectStore {
  if (!grandHallRuntimeIntakeConfigured(env)) {
    throw new Error("Grand Hall runtime intake is not configured.");
  }
  let readClient: S3Client | null = null;
  let writeClient: S3Client | null = null;

  const getReadClient = async (): Promise<S3Client> => {
    if (readClient !== null) return readClient;
    const { S3Client } = await import("@aws-sdk/client-s3");
    readClient = new S3Client(grandHallR2ReadClientOptions(env));
    return readClient;
  };
  const getWriteClient = async (): Promise<S3Client> => {
    if (writeClient !== null) return writeClient;
    const { S3Client } = await import("@aws-sdk/client-s3");
    writeClient = new S3Client(grandHallR2WriteClientOptions(env));
    return writeClient;
  };

  return {
    async open(member, signal): Promise<GrandHallRemoteObject | null> {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const response = await (await getReadClient()).send(new GetObjectCommand(
          grandHallR2GetObjectInput(env, member),
        ), { abortSignal: signal });
        if (!asyncByteBody(response.Body)) {
          destroyBody(response.Body);
          throw new Error("Private object response has no byte stream.");
        }
        const body = response.Body;
        let closed = false;
        const close = (): void => {
          if (closed) return;
          closed = true;
          signal.removeEventListener("abort", close);
          destroyBody(body);
        };
        signal.addEventListener("abort", close, { once: true });
        if (signal.aborted) {
          close();
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Grand Hall private storage read aborted", "AbortError");
        }
        return {
          body,
          contentLength: typeof response.ContentLength === "number" ? response.ContentLength : null,
          close,
        };
      } catch (error) {
        if (isGrandHallMissingObjectError(error)) return null;
        throw error;
      }
    },
    async putCreateOnly(member, bytes, signal) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const command = new PutObjectCommand(grandHallR2PutObjectInput(env, member, bytes));
      try {
        await (await getWriteClient()).send(command, { abortSignal: signal });
        return "created";
      } catch (error) {
        if (isGrandHallConditionalCreateConflict(error)) return "exists";
        throw error;
      }
    },
  };
}

export async function grandHallRuntimeIntakeRoutes(
  server: FastifyInstance,
  options: GrandHallRuntimeIntakeRoutesOptions,
): Promise<void> {
  const configured = grandHallRuntimeIntakeConfigured(options.env);
  const roomOnlyAdmission = options.roomOnlyAdmission ?? null;
  const runtimeMembers = roomOnlyAdmission !== null
    && grandHallRoomOnlyRuntimeAdmissionError(roomOnlyAdmission) === null
    ? grandHallRoomOnlyRuntimeMembers(roomOnlyAdmission)
    : [];
  const maxMemberBytes = Math.min(
    GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
    Math.max(1, ...runtimeMembers.map((member) => member.sizeBytes)),
  );
  const objectStore = options.objectStore ?? (configured
    ? createGrandHallR2ObjectStore(options.env)
    : null);
  const registrationStore = options.registrationStore ?? (configured
    ? createDatabaseGrandHallRegistrationStore(options.db)
    : null);
  let activeOperation = false;
  let activeUploads = 0;
  interface GrandHallUploadLease {
    readonly signal: AbortSignal;
    readonly startWork: () => () => void;
  }
  interface GrandHallExclusiveReservation {
    readonly startWork: () => () => void;
  }
  const uploadLeases = new WeakMap<object, GrandHallUploadLease>();
  const exclusiveReservations = new WeakMap<object, GrandHallExclusiveReservation>();

  const bindRequestAbort = (reply: FastifyReply): {
    readonly signal: AbortSignal;
    readonly dispose: () => void;
  } => {
    const controller = new AbortController();
    const abortForDisconnect = (): void => {
      if (reply.raw.writableFinished) return;
      controller.abort(new DOMException("Grand Hall intake client disconnected", "AbortError"));
    };
    reply.raw.once("close", abortForDisconnect);
    return {
      signal: controller.signal,
      dispose: () => reply.raw.off("close", abortForDisconnect),
    };
  };

  const acquireUploadLease = (
    requestRaw: { readonly destroyed: boolean; destroy: () => void },
    reply: FastifyReply,
  ): GrandHallUploadLease => {
    activeUploads += 1;
    const controller = new AbortController();
    let handlerStarted = false;
    let responseSettled = false;
    let workSettled = false;
    let released = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(
        "Grand Hall binary upload exceeded its absolute request deadline",
        "TimeoutError",
      ));
      if (handlerStarted || reply.sent) return;
      noStore(reply);
      void reply
        .header("Connection", "close")
        .status(408)
        .send({
          error: "The Grand Hall binary upload exceeded its request deadline.",
          code: "GRAND_HALL_INTAKE_TIMEOUT",
        });
    }, options.uploadRequestDeadlineMs ?? GRAND_HALL_UPLOAD_REQUEST_DEADLINE_MS);
    deadline.unref();
    const releaseWhenSettled = (): void => {
      if (released || !responseSettled || !workSettled) return;
      released = true;
      clearTimeout(deadline);
      reply.raw.off("finish", settleResponse);
      reply.raw.off("close", settleResponse);
      activeUploads = Math.max(0, activeUploads - 1);
      if (timedOut && !handlerStarted && !requestRaw.destroyed) requestRaw.destroy();
    };
    const settleResponse = (): void => {
      if (responseSettled) return;
      responseSettled = true;
      if (!reply.raw.writableFinished) {
        controller.abort(new DOMException("Grand Hall intake client disconnected", "AbortError"));
      }
      if (!handlerStarted) workSettled = true;
      releaseWhenSettled();
    };
    reply.raw.once("finish", settleResponse);
    reply.raw.once("close", settleResponse);
    return {
      signal: controller.signal,
      startWork: () => {
        handlerStarted = true;
        return () => {
          if (workSettled) return;
          workSettled = true;
          releaseWhenSettled();
        };
      },
    };
  };

  const acquireExclusiveReservation = (reply: FastifyReply): GrandHallExclusiveReservation => {
    activeOperation = true;
    let handlerStarted = false;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      reply.raw.off("finish", releaseIfHandlerDidNotStart);
      reply.raw.off("close", releaseIfHandlerDidNotStart);
      activeOperation = false;
    };
    const releaseIfHandlerDidNotStart = (): void => {
      if (!handlerStarted) release();
    };
    reply.raw.once("finish", releaseIfHandlerDidNotStart);
    reply.raw.once("close", releaseIfHandlerDidNotStart);
    return {
      startWork: () => {
        handlerStarted = true;
        reply.raw.off("finish", releaseIfHandlerDidNotStart);
        reply.raw.off("close", releaseIfHandlerDidNotStart);
        return release;
      },
    };
  };

  server.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: maxMemberBytes },
    (_request, body, done) => {
      done(null, body);
    },
  );

  const runExclusively = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (activeOperation || activeUploads > 0) {
      throw new GrandHallRuntimeIntakeError(
        429,
        "GRAND_HALL_INTAKE_BUSY",
        "Another Grand Hall intake verification is already running on this server.",
      );
    }
    activeOperation = true;
    try {
      return await operation();
    } finally {
      activeOperation = false;
    }
  };

  server.post(
    "/grand-hall-frontier-intake/preflight",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = TargetRequestSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const targetFailure = targetError(options.env, parsed.data, roomOnlyAdmission);
      if (targetFailure !== null) {
        noStore(reply);
        return reply.status(targetFailure.statusCode).send({
          error: targetFailure.message,
          code: targetFailure.code,
        });
      }
      if (objectStore === null) {
        noStore(reply);
        return reply.status(503).send({
          error: "Grand Hall intake is unavailable on this server.",
          code: "GRAND_HALL_INTAKE_DISABLED",
        });
      }
      const requestAbort = bindRequestAbort(reply);
      try {
        const prepared = await runExclusively(() => prepareGrandHallRuntimeIntake(
          objectStore,
          roomOnlyAdmission,
          requestAbort.signal,
        ));
        const targetBindingSha256 = grandHallRuntimeIntakeTargetBinding(
          options.env,
          roomOnlyAdmission,
        );
        if (targetBindingSha256 === null) {
          throw new GrandHallRuntimeIntakeError(
            500,
            "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
            "The configured Grand Hall intake target has no stable binding.",
          );
        }
        noStore(reply);
        const members = prepared.members.map((member) => member.status === "upload_required"
          ? {
              ...member,
              upload: {
                path: `/admin/assets/grand-hall-frontier-intake/members/${String(member.memberIndex)}`,
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": String(member.sizeBytes),
                  "x-venviewer-intake-target-id": parsed.data.targetId,
                  "x-venviewer-intake-api-origin": parsed.data.apiOrigin,
                  "x-venviewer-intake-target-binding-sha256": targetBindingSha256,
                  "x-venviewer-intake-deployed-git-sha": options.env.GIT_SHA,
                  "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
                  "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
                },
              },
            }
          : member);
        return reply.send({
          data: {
            operatorUserId: request.user.id,
            targetId: options.env.RUNTIME_PROFILE_INTAKE_TARGET_ID,
            deployedGitSha: options.env.GIT_SHA,
            apiOrigin: options.env.PUBLIC_API_ORIGIN,
            targetBindingSha256,
            manifestSha256: GRAND_HALL_MANIFEST_SHA256,
            frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
            memberCount: runtimeMembers.length,
            ...prepared,
            members,
          },
        });
      } catch (error) {
        request.log.warn({
          code: error instanceof GrandHallRuntimeIntakeError ? error.code : "GRAND_HALL_INTAKE_FAILED",
          userId: request.user.id,
        }, "Grand Hall intake preflight failed");
        return safeErrorReply(reply, error);
      } finally {
        requestAbort.dispose();
      }
    },
  );

  server.put(
    "/grand-hall-frontier-intake/rehearsal",
    {
      onRequest: [
        authenticate,
        authorizePlatformAdmin(),
        async (request, reply) => {
          const parsedHeaders = RehearsalHeadersSchema.safeParse(request.headers);
          if (!parsedHeaders.success) {
            return validationError(reply, parsedHeaders.error.issues);
          }
          const member = runtimeMembers[0];
          if (member === undefined || parsedHeaders.data["content-length"] !== member.sizeBytes) {
            noStore(reply);
            return reply.status(409).send({
              error: "The rehearsal body length does not match canonical Grand Hall member 0.",
              code: "GRAND_HALL_FRONTIER_MISMATCH",
            });
          }
          const targetFailure = targetError(options.env, {
            targetId: parsedHeaders.data["x-venviewer-intake-target-id"],
            apiOrigin: parsedHeaders.data["x-venviewer-intake-api-origin"],
            reviewedGitSha: parsedHeaders.data["x-venviewer-intake-deployed-git-sha"],
            manifestSha256: parsedHeaders.data["x-venviewer-manifest-sha256"],
            frontierReceiptSha256: parsedHeaders.data["x-venviewer-frontier-receipt-sha256"],
          }, roomOnlyAdmission);
          if (targetFailure !== null) {
            noStore(reply);
            return reply.status(targetFailure.statusCode).send({
              error: targetFailure.message,
              code: targetFailure.code,
            });
          }
          if (objectStore === null) {
            noStore(reply);
            return reply.status(503).send({
              error: "Grand Hall intake is unavailable on this server.",
              code: "GRAND_HALL_INTAKE_DISABLED",
            });
          }
          if (activeOperation || activeUploads > 0) {
            noStore(reply);
            return reply.header("Retry-After", "1").status(429).send({
              error: "Grand Hall intake is busy; try the rehearsal again shortly.",
              code: "GRAND_HALL_INTAKE_BUSY",
            });
          }
          exclusiveReservations.set(request.raw, acquireExclusiveReservation(reply));
          uploadLeases.set(request.raw, acquireUploadLease(request.raw, reply));
        },
      ],
      bodyLimit: maxMemberBytes,
    },
    async (request, reply) => {
      const exclusiveReservation = exclusiveReservations.get(request.raw);
      const uploadLease = uploadLeases.get(request.raw);
      const settleExclusiveWork = exclusiveReservation?.startWork() ?? (() => undefined);
      const settleUploadWork = uploadLease?.startWork() ?? (() => undefined);
      try {
        if (exclusiveReservation === undefined || uploadLease === undefined || objectStore === null) {
          throw rehearsalIntegrityError("The Grand Hall rehearsal admission lease was not preserved.");
        }
        if (uploadLease.signal.aborted) {
          if (reply.sent || reply.raw.destroyed) return reply;
          return safeErrorReply(reply, new GrandHallRuntimeIntakeError(
            502,
            "GRAND_HALL_STORAGE_FAILED",
            "The server could not access the private Grand Hall storage target.",
          ));
        }
        if (!Buffer.isBuffer(request.body)) {
          return validationError(reply, "An exact binary Grand Hall member-0 body is required.");
        }
        const member = runtimeMembers[0];
        if (
          member === undefined ||
          request.body.byteLength !== member.sizeBytes ||
          createHash("sha256").update(request.body).digest("hex") !== member.sha256
        ) {
          throw rehearsalStorageConflict(
            "The rehearsal body does not match exact canonical Grand Hall member 0.",
          );
        }

        const result = await runGrandHallConditionalPutRehearsal(
          objectStore,
          request.body,
          uploadLease.signal,
          roomOnlyAdmission,
          runtimeMembers,
        );
        noStore(reply);
        return reply.send({
          data: {
            schemaVersion: "venviewer.grand-hall-intake-rehearsal.v1",
            operatorUserId: request.user.id,
            targetId: options.env.RUNTIME_PROFILE_INTAKE_TARGET_ID,
            deployedGitSha: options.env.GIT_SHA,
            apiOrigin: options.env.PUBLIC_API_ORIGIN,
            manifestSha256: GRAND_HALL_MANIFEST_SHA256,
            frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
            member: {
              memberIndex: 0,
              fileName: member.fileName,
              sizeBytes: member.sizeBytes,
              sha256: member.sha256,
            },
            initialPreflight: {
              existingMemberCount: result.initial.existingMemberCount,
              uploadRequiredCount: result.initial.uploadRequiredCount,
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
              existingMemberCount: result.final.existingMemberCount,
              uploadRequiredCount: result.final.uploadRequiredCount,
            },
            commitAttempted: false,
            registrationAttempted: false,
          },
        });
      } catch (error) {
        request.log.warn({
          code: error instanceof GrandHallRuntimeIntakeError ? error.code : "GRAND_HALL_INTAKE_FAILED",
          userId: request.user.id,
        }, "Grand Hall conditional-PUT rehearsal failed");
        return safeErrorReply(reply, error);
      } finally {
        settleUploadWork();
        settleExclusiveWork();
        uploadLeases.delete(request.raw);
        exclusiveReservations.delete(request.raw);
      }
    },
  );

  server.put(
    "/grand-hall-frontier-intake/members/:memberIndex",
    {
      onRequest: [
        authenticate,
        authorizePlatformAdmin(),
        async (request, reply) => {
          const parsedParams = MemberParamsSchema.safeParse(request.params);
          const parsedHeaders = MemberHeadersSchema.safeParse(request.headers);
          if (!parsedParams.success || !parsedHeaders.success) {
            return validationError(reply, [
              ...(parsedParams.success ? [] : parsedParams.error.issues),
              ...(parsedHeaders.success ? [] : parsedHeaders.error.issues),
            ]);
          }
          const member = runtimeMembers[parsedParams.data.memberIndex];
          if (member === undefined || parsedHeaders.data["content-length"] !== member.sizeBytes) {
            noStore(reply);
            return reply.status(409).send({
              error: "The upload length does not match the canonical Grand Hall member.",
              code: "GRAND_HALL_FRONTIER_MISMATCH",
            });
          }
          const targetFailure = targetError(options.env, {
            targetId: parsedHeaders.data["x-venviewer-intake-target-id"],
            apiOrigin: parsedHeaders.data["x-venviewer-intake-api-origin"],
            reviewedGitSha: parsedHeaders.data["x-venviewer-intake-deployed-git-sha"],
            manifestSha256: parsedHeaders.data["x-venviewer-manifest-sha256"],
            frontierReceiptSha256: parsedHeaders.data["x-venviewer-frontier-receipt-sha256"],
          }, roomOnlyAdmission);
          if (targetFailure !== null) {
            noStore(reply);
            return reply.status(targetFailure.statusCode).send({
              error: targetFailure.message,
              code: targetFailure.code,
            });
          }
          const binding = grandHallRuntimeIntakeTargetBinding(options.env, roomOnlyAdmission);
          if (
            binding === null ||
            parsedHeaders.data["x-venviewer-intake-target-binding-sha256"] !== binding
          ) {
            noStore(reply);
            return reply.status(409).send({
              error: "The intake target changed after preflight; run preflight again.",
              code: "GRAND_HALL_INTAKE_TARGET_MISMATCH",
            });
          }
          if (activeOperation || activeUploads >= MAX_CONCURRENT_UPLOADS) {
            noStore(reply);
            return reply.header("Retry-After", "1").status(429).send({
              error: "Grand Hall intake uploads are busy; try again shortly.",
              code: "GRAND_HALL_INTAKE_BUSY",
            });
          }
          uploadLeases.set(request.raw, acquireUploadLease(request.raw, reply));
        },
      ],
      bodyLimit: maxMemberBytes,
    },
    async (request, reply) => {
      const uploadLease = uploadLeases.get(request.raw);
      const settleUploadWork = uploadLease?.startWork() ?? (() => undefined);
      try {
        if (uploadLease?.signal.aborted === true) {
          if (reply.sent || reply.raw.destroyed) return reply;
          return safeErrorReply(reply, new GrandHallRuntimeIntakeError(
            502,
            "GRAND_HALL_STORAGE_FAILED",
            "The server could not access the private Grand Hall storage target.",
          ));
        }
        const parsedParams = MemberParamsSchema.safeParse(request.params);
        if (!parsedParams.success || !Buffer.isBuffer(request.body)) {
          return validationError(reply, parsedParams.success
            ? "A binary Grand Hall member body is required."
            : parsedParams.error.issues);
        }
        if (objectStore === null) {
          noStore(reply);
          return reply.status(503).send({
            error: "Grand Hall intake is unavailable on this server.",
            code: "GRAND_HALL_INTAKE_DISABLED",
          });
        }
        const uploaded = await uploadGrandHallRuntimeMember(
          objectStore,
          parsedParams.data.memberIndex,
          request.body,
          roomOnlyAdmission,
          uploadLease?.signal,
        );
        noStore(reply);
        return reply.status(uploaded.created ? 201 : 200).send({
          data: {
            operatorUserId: request.user.id,
            ...uploaded,
          },
        });
      } catch (error) {
        const paramsForLog = MemberParamsSchema.safeParse(request.params);
        request.log.warn({
          code: error instanceof GrandHallRuntimeIntakeError ? error.code : "GRAND_HALL_INTAKE_FAILED",
          userId: request.user.id,
          memberIndex: paramsForLog.success ? paramsForLog.data.memberIndex : null,
        }, "Grand Hall intake member upload failed");
        return safeErrorReply(reply, error);
      } finally {
        settleUploadWork();
        uploadLeases.delete(request.raw);
      }
    },
  );

  server.post(
    "/grand-hall-frontier-intake/commit",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = CommitRequestSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const targetFailure = targetError(options.env, parsed.data, roomOnlyAdmission);
      if (targetFailure !== null) {
        noStore(reply);
        return reply.status(targetFailure.statusCode).send({
          error: targetFailure.message,
          code: targetFailure.code,
        });
      }
      const targetBindingSha256 = grandHallRuntimeIntakeTargetBinding(
        options.env,
        roomOnlyAdmission,
      );
      if (
        targetBindingSha256 === null ||
        parsed.data.targetBindingSha256 !== targetBindingSha256
      ) {
        noStore(reply);
        return reply.status(409).send({
          error: "The intake target changed after preflight; run preflight again.",
          code: "GRAND_HALL_INTAKE_TARGET_MISMATCH",
        });
      }
      if (objectStore === null || registrationStore === null) {
        noStore(reply);
        return reply.status(503).send({
          error: "Grand Hall intake is unavailable on this server.",
          code: "GRAND_HALL_INTAKE_DISABLED",
        });
      }
      const requestAbort = bindRequestAbort(reply);
      try {
        const committed = await runExclusively(() => commitGrandHallRuntimeIntake(
          objectStore,
          registrationStore,
          request.user.id,
          roomOnlyAdmission,
          requestAbort.signal,
        ));
        request.log.info({
          userId: request.user.id,
          runtimePackageId: committed.packageRow.id,
          revision: committed.packageRow.revision,
          created: committed.created,
        }, "exact Grand Hall runtime intake committed");
        noStore(reply);
        return reply.status(committed.created ? 201 : 200).send({
          data: {
            operatorUserId: request.user.id,
            targetId: options.env.RUNTIME_PROFILE_INTAKE_TARGET_ID,
            deployedGitSha: options.env.GIT_SHA,
            runtimePackageId: committed.packageRow.id,
            revision: committed.packageRow.revision,
            contentDigest: committed.contentDigest,
            created: committed.created,
            memberCount: committed.verifiedMemberCount,
            totalBytes: committed.verifiedTotalBytes,
            gaussianCount: committed.gaussianCount,
          },
        });
      } catch (error) {
        request.log.warn({
          code: error instanceof GrandHallRuntimeIntakeError ? error.code : "GRAND_HALL_INTAKE_FAILED",
          userId: request.user.id,
        }, "Grand Hall intake commit failed");
        return safeErrorReply(reply, error);
      } finally {
        requestAbort.dispose();
      }
    },
  );
}
