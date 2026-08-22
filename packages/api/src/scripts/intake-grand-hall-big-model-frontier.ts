/**
 * Server-bound operator intake for the exact Trades Hall Grand Hall frontier.
 *
 * Apply validates local source bytes, asks one explicitly selected API for
 * create-only upload capabilities, uploads only missing members, and asks the
 * same deployment to verify and register the complete frontier. The staging
 * rehearsal proves conditional create and corrupt-byte rejection without a
 * commit. Both modes emit one redacted structured evidence receipt. Database
 * and private-storage credentials never cross this client.
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  inspectLcc2HighestDetailFrontier,
  type Lcc2HighestDetailFrontierReceiptV0,
} from "@omnitwin/reconstruction-foundry-cli";
import { z } from "zod";
import {
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_MANIFEST_FILE_NAME,
  GRAND_HALL_MANIFEST_SHA256,
  type GrandHallFrontierMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import { validateGrandHallFrontierReceipt } from "./register-grand-hall-big-model-frontier.js";

export const GRAND_HALL_INTAKE_CONFIRMATION =
  "register_exact_internal_ready_grand_hall_frontier";
export const GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV =
  "RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN";
export const GRAND_HALL_MAX_MEMBER_BUFFER_BYTES = 10_600_000;
export const GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS = 10 * 60_000;

const PREFLIGHT_PATH =
  "/admin/assets/grand-hall-frontier-intake/preflight";
const COMMIT_PATH = "/admin/assets/grand-hall-frontier-intake/commit";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/u;
const TARGET_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const REVIEWED_GIT_SHA = /^[a-f0-9]{40,64}$/u;
const CONDITIONAL_PUT_REHEARSAL_FLAG = "--rehearse-conditional-put";
const GIT_COMMAND_DEADLINE_MS = 30_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 1_048_576;
const execFile = promisify(execFileCallback);

const UploadCapabilitySchema = z.object({
  path: z.string().startsWith("/").max(500),
  headers: z.record(z.string().min(1).max(1_024)),
}).strict();

const PreflightMemberSchema = z.object({
  memberIndex: z.number().int().nonnegative(),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  status: z.enum(["verified_existing", "upload_required"]),
  upload: UploadCapabilitySchema.optional(),
}).strict();

const PreflightResponseSchema = z.object({
  data: z.object({
    operatorUserId: z.string().uuid(),
    targetId: z.string().regex(TARGET_ID),
    deployedGitSha: z.string().regex(REVIEWED_GIT_SHA),
    apiOrigin: z.string().url().max(500),
    targetBindingSha256: z.string().regex(SHA256_HEX),
    manifestSha256: z.string().regex(SHA256_HEX),
    frontierReceiptSha256: z.string().regex(SHA256_RECEIPT),
    memberCount: z.number().int().nonnegative(),
    members: z.array(PreflightMemberSchema),
    existingMemberCount: z.number().int().nonnegative(),
    uploadRequiredCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const CommitResponseSchema = z.object({
  data: z.object({
    operatorUserId: z.string().uuid(),
    targetId: z.string().regex(TARGET_ID),
    deployedGitSha: z.string().regex(REVIEWED_GIT_SHA),
    runtimePackageId: z.string().uuid(),
    revision: z.number().int().positive(),
    contentDigest: z.string().regex(SHA256_HEX),
    created: z.boolean(),
    memberCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    gaussianCount: z.number().int().positive(),
  }).strict(),
}).strict();

const MemberUploadResponseSchema = z.object({
  data: z.object({
    created: z.boolean(),
    memberIndex: z.number().int().nonnegative(),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256_HEX),
  }).strict(),
}).strict();

const IntakeErrorResponseSchema = z.object({
  error: z.string().min(1).max(1_000),
  code: z.string().min(1).max(100),
}).strict();

type PreflightResponse = z.infer<typeof PreflightResponseSchema>["data"];
type PreflightMember = z.infer<typeof PreflightMemberSchema>;
type CommitResponse = z.infer<typeof CommitResponseSchema>["data"];

export type GrandHallFrontierIntakeMode =
  | "apply"
  | "conditional_put_rehearsal";

export interface GrandHallFrontierIntakeArgs {
  readonly manifestPath: string;
  readonly apiOrigin: string;
  readonly targetId: string;
  readonly reviewedGitSha: string;
  readonly mode: GrandHallFrontierIntakeMode;
}

export interface GrandHallLocalPathInspection {
  readonly kind: "file" | "symlink" | "other";
  readonly sizeBytes: number;
  readonly device: number;
  readonly inode: number;
  readonly modifiedTimeMs: number;
}

export interface GrandHallGitStateInspection {
  readonly headSha: string;
  readonly reviewedCommitExists: boolean;
  readonly clean: boolean;
}

export type GrandHallIntakeFetch = (
  input: string,
  init: {
    readonly method: "POST" | "PUT";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | Buffer;
    readonly redirect: "error";
    readonly signal: AbortSignal;
  },
) => Response | Promise<Response>;

export interface GrandHallFrontierIntakeDependencies {
  readonly inspectFrontier?: (
    manifestPath: string,
  ) => Promise<Lcc2HighestDetailFrontierReceiptV0>;
  readonly inspectLocalPath?: (
    path: string,
  ) => Promise<GrandHallLocalPathInspection>;
  readonly readLocalMember?: (
    path: string,
    expectedSizeBytes: number,
    maximumBufferBytes: number,
  ) => Promise<Buffer>;
  readonly verifyMemberBuffer?: (
    bytes: Buffer,
    member: GrandHallFrontierMemberSpec,
  ) => void;
  readonly fetchImpl?: GrandHallIntakeFetch;
  readonly inspectGitState?: (
    reviewedGitSha: string,
  ) => Promise<GrandHallGitStateInspection>;
  readonly httpRequestDeadlineMs?: number;
  readonly now?: () => Date;
}

export interface RunGrandHallFrontierIntakeOptions {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly dependencies?: GrandHallFrontierIntakeDependencies;
  readonly log?: (line: string) => void;
}

export interface GrandHallMemberStatusEvidence {
  readonly memberIndex: number;
  readonly fileName: string;
  readonly status: "verified_existing" | "upload_required";
}

export interface GrandHallPutEvidence {
  readonly memberIndex: number;
  readonly httpStatus: 200 | 201;
  readonly created: boolean;
}

interface GrandHallEvidenceBase {
  readonly recordedAt: string;
  readonly reviewedGitSha: string;
  readonly deployedGitSha: string;
  readonly operatorUserId: string;
  readonly targetId: string;
  readonly apiOrigin: string;
  readonly targetBindingSha256: string;
  readonly manifestSha256: string;
  readonly frontierReceiptSha256: string;
  readonly preflight: {
    readonly existingMemberCount: number;
    readonly uploadRequiredCount: number;
    readonly members: readonly GrandHallMemberStatusEvidence[];
  };
}

export interface GrandHallFrontierApplyEvidenceReceipt extends GrandHallEvidenceBase {
  readonly schemaVersion: "venviewer.grand-hall-frontier-intake-evidence.v1";
  readonly mode: "apply";
  readonly puts: readonly GrandHallPutEvidence[];
  readonly package: {
    readonly runtimePackageId: string;
    readonly revision: number;
    readonly contentDigest: string;
    readonly created: boolean;
    readonly memberCount: number;
    readonly totalBytes: number;
    readonly gaussianCount: number;
  };
}

export interface GrandHallFrontierRehearsalEvidenceReceipt extends GrandHallEvidenceBase {
  readonly schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v1";
  readonly mode: "conditional_put_rehearsal";
  readonly memberZeroPuts: readonly [GrandHallPutEvidence, GrandHallPutEvidence];
  readonly corruptBufferRejection: {
    readonly memberIndex: number;
    readonly httpStatus: 409;
    readonly errorCode: "GRAND_HALL_STORAGE_CONFLICT";
    readonly remainsUploadRequired: true;
  };
  readonly verificationPreflight: {
    readonly existingMemberCount: number;
    readonly uploadRequiredCount: number;
    readonly members: readonly GrandHallMemberStatusEvidence[];
  };
  readonly committed: false;
  readonly registered: false;
}

export type GrandHallFrontierIntakeResult =
  | GrandHallFrontierApplyEvidenceReceipt
  | GrandHallFrontierRehearsalEvidenceReceipt;

class GrandHallFrontierIntakeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrandHallFrontierIntakeCliError";
  }
}

function intakeError(message: string): GrandHallFrontierIntakeCliError {
  return new GrandHallFrontierIntakeCliError(message);
}

function optionValue(
  args: readonly string[],
  index: number,
  optionName: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw intakeError(`${optionName} requires a value.`);
  }
  return value;
}

function cleanHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw intakeError("--api-origin must be a valid absolute HTTPS origin.");
  }
  if (
    value.trim() !== value ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw intakeError(
      "--api-origin must be a clean HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  return value;
}

export function parseGrandHallFrontierIntakeArgs(
  args: readonly string[],
): GrandHallFrontierIntakeArgs {
  let manifestPath: string | undefined;
  let apiOrigin: string | undefined;
  let targetId: string | undefined;
  let reviewedGitSha: string | undefined;
  let applyCount = 0;
  let rehearsalCount = 0;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      applyCount += 1;
      continue;
    }
    if (argument === CONDITIONAL_PUT_REHEARSAL_FLAG) {
      rehearsalCount += 1;
      continue;
    }
    if (
      argument === "--manifest" ||
      argument === "--api-origin" ||
      argument === "--target-id" ||
      argument === "--reviewed-git-sha"
    ) {
      const value = optionValue(args, index, argument);
      if (argument === "--manifest") {
        if (manifestPath !== undefined) {
          throw intakeError("--manifest may only be supplied once.");
        }
        manifestPath = value;
      } else if (argument === "--api-origin") {
        if (apiOrigin !== undefined) {
          throw intakeError("--api-origin may only be supplied once.");
        }
        apiOrigin = value;
      } else if (argument === "--target-id") {
        if (targetId !== undefined) {
          throw intakeError("--target-id may only be supplied once.");
        }
        targetId = value;
      } else {
        if (reviewedGitSha !== undefined) {
          throw intakeError("--reviewed-git-sha may only be supplied once.");
        }
        reviewedGitSha = value;
      }
      index += 1;
      continue;
    }
    throw intakeError(
      `Unknown or unsupported argument. Use only --manifest, --api-origin, --target-id, --reviewed-git-sha, and exactly one of --apply or ${CONDITIONAL_PUT_REHEARSAL_FLAG}.`,
    );
  }

  if (applyCount + rehearsalCount !== 1 || applyCount > 1 || rehearsalCount > 1) {
    throw intakeError(
      `Supply exactly one operation flag: --apply or ${CONDITIONAL_PUT_REHEARSAL_FLAG}.`,
    );
  }
  if (manifestPath === undefined || !isAbsolute(manifestPath)) {
    throw intakeError("--manifest requires an absolute local path.");
  }
  const resolvedManifestPath = resolve(manifestPath);
  if (basename(resolvedManifestPath) !== GRAND_HALL_MANIFEST_FILE_NAME) {
    throw intakeError(`--manifest must point to ${GRAND_HALL_MANIFEST_FILE_NAME}.`);
  }
  if (apiOrigin === undefined) {
    throw intakeError("--api-origin is required.");
  }
  if (targetId === undefined || !TARGET_ID.test(targetId)) {
    throw intakeError(
      "--target-id must be a 3-80 character lowercase deployment identifier.",
    );
  }
  if (reviewedGitSha === undefined || !REVIEWED_GIT_SHA.test(reviewedGitSha)) {
    throw intakeError("--reviewed-git-sha must be a lowercase 40-64 character hexadecimal Git commit ID.");
  }

  return {
    manifestPath: resolvedManifestPath,
    apiOrigin: cleanHttpsOrigin(apiOrigin),
    targetId,
    reviewedGitSha,
    mode: applyCount === 1 ? "apply" : "conditional_put_rehearsal",
  };
}

async function runGitCommand(args: readonly string[]): Promise<string> {
  try {
    const result = await execFile("git", [...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: GIT_COMMAND_DEADLINE_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    });
    return String(result.stdout).trim();
  } catch {
    throw intakeError("Reviewed Git state could not be established locally.");
  }
}

export async function inspectGrandHallGitState(
  reviewedGitSha: string,
  dependencies: {
    readonly scriptFilePath?: string;
    readonly resolveRealPath?: (path: string) => Promise<string>;
    readonly executeGit?: (args: readonly string[]) => Promise<string>;
  } = {},
): Promise<GrandHallGitStateInspection> {
  const resolveRealPath = dependencies.resolveRealPath ?? realpath;
  const executeGit = dependencies.executeGit ?? runGitCommand;
  const scriptFilePath = await resolveRealPath(
    dependencies.scriptFilePath ?? fileURLToPath(import.meta.url),
  );
  const discoveredRoot = await executeGit([
    "-C",
    dirname(scriptFilePath),
    "rev-parse",
    "--show-toplevel",
  ]);
  const repositoryRoot = await resolveRealPath(discoveredRoot);
  const scriptRelativePath = relative(repositoryRoot, scriptFilePath);
  if (
    scriptRelativePath.length === 0 ||
    isAbsolute(scriptRelativePath) ||
    scriptRelativePath === ".." ||
    scriptRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw intakeError("The executing intake script is not inside its discovered Git repository.");
  }
  const headSha = await executeGit([
    "-C",
    repositoryRoot,
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  let reviewedCommitExists = false;
  try {
    reviewedCommitExists = await executeGit([
      "-C",
      repositoryRoot,
      "rev-parse",
      "--verify",
      `${reviewedGitSha}^{commit}`,
    ]) === reviewedGitSha;
  } catch (error) {
    if (!(error instanceof GrandHallFrontierIntakeCliError)) throw error;
  }
  const status = await executeGit([
    "-C",
    repositoryRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  return {
    headSha,
    reviewedCommitExists,
    clean: status.length === 0,
  };
}

export function assertGrandHallReviewedGitState(
  state: GrandHallGitStateInspection,
  reviewedGitSha: string,
): void {
  if (!state.reviewedCommitExists) {
    throw intakeError("The supplied reviewed Git commit does not exist locally.");
  }
  if (state.headSha !== reviewedGitSha) {
    throw intakeError("Repository HEAD does not equal the supplied reviewed Git commit.");
  }
  if (!state.clean) {
    throw intakeError("The reviewed Git worktree is not clean, including untracked files.");
  }
}

function requiredAdminToken(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const token = env[GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV];
  if (
    token === undefined ||
    token.length === 0 ||
    token.trim() !== token ||
    /[\r\n]/u.test(token)
  ) {
    throw intakeError(
      `${GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV} must contain the platform-admin bearer token.`,
    );
  }
  return token;
}

function authorizationHeaders(token: string): Readonly<Record<string, string>> {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function targetIdentity(args: GrandHallFrontierIntakeArgs) {
  return {
    targetId: args.targetId,
    apiOrigin: args.apiOrigin,
    reviewedGitSha: args.reviewedGitSha,
    manifestSha256: GRAND_HALL_MANIFEST_SHA256,
    frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  } as const;
}

function safeEndpoint(path: string, apiOrigin: string): string {
  return new URL(path, apiOrigin).href;
}

function uploadPath(memberIndex: number): string {
  return `${PREFLIGHT_PATH.replace(/\/preflight$/u, "")}/members/${String(memberIndex)}`;
}

type GrandHallFetchInit = Omit<Parameters<GrandHallIntakeFetch>[1], "signal">;

async function withAbsoluteHttpDeadline<T>(
  operation: string,
  deadlineMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadlineError = intakeError(`${operation} exceeded its absolute request deadline.`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(deadlineError);
      reject(deadlineError);
    }, deadlineMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchWithoutDisclosure(
  fetchImpl: GrandHallIntakeFetch,
  input: string,
  init: GrandHallFetchInit,
  operation: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch {
    if (signal.aborted && signal.reason instanceof GrandHallFrontierIntakeCliError) {
      throw signal.reason;
    }
    throw intakeError(`${operation} request could not be completed.`);
  }
}

async function parseJsonWithoutDisclosure(
  response: Response,
  operation: string,
  signal: AbortSignal,
): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    if (signal.aborted && signal.reason instanceof GrandHallFrontierIntakeCliError) {
      throw signal.reason;
    }
    throw intakeError(`${operation} returned an unreadable response.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw intakeError(`${operation} returned an invalid response.`);
  }
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function assertUploadCapability(
  responseMember: PreflightMember,
  canonicalMember: GrandHallFrontierMemberSpec,
  response: PreflightResponse,
): void {
  const upload = responseMember.upload;
  if (upload === undefined) {
    throw intakeError("Grand Hall intake preflight omitted an upload capability.");
  }
  if (upload.path !== uploadPath(responseMember.memberIndex)) {
    throw intakeError("Grand Hall intake preflight returned an unsafe upload capability.");
  }

  const expectedHeaders = {
    "content-length": String(canonicalMember.sizeBytes),
    "content-type": "application/octet-stream",
    "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    "x-venviewer-intake-api-origin": response.apiOrigin,
    "x-venviewer-intake-target-binding-sha256": response.targetBindingSha256,
    "x-venviewer-intake-deployed-git-sha": response.deployedGitSha,
    "x-venviewer-intake-target-id": response.targetId,
    "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
  } as const;
  const headerNames = Object.keys(upload.headers).sort();
  if (
    !arraysEqual(headerNames, Object.keys(expectedHeaders).sort()) ||
    headerNames.some((name) => upload.headers[name] !== expectedHeaders[
      name as keyof typeof expectedHeaders
    ])
  ) {
    throw intakeError("Grand Hall intake preflight returned unexpected upload headers.");
  }
}

function validatePreflightResponse(
  untrustedBody: unknown,
  args: GrandHallFrontierIntakeArgs,
): PreflightResponse {
  const parsed = PreflightResponseSchema.safeParse(untrustedBody);
  if (!parsed.success) {
    throw intakeError("Grand Hall intake preflight returned an invalid response.");
  }
  const response = parsed.data.data;
  if (
    response.targetId !== args.targetId ||
    response.apiOrigin !== args.apiOrigin ||
    response.deployedGitSha !== args.reviewedGitSha ||
    response.manifestSha256 !== GRAND_HALL_MANIFEST_SHA256 ||
    response.frontierReceiptSha256 !== GRAND_HALL_FRONTIER_RECEIPT_SHA256 ||
    response.memberCount !== GRAND_HALL_FRONTIER_MEMBERS.length ||
    response.members.length !== GRAND_HALL_FRONTIER_MEMBERS.length
  ) {
    throw intakeError("Grand Hall intake preflight target binding did not match the request.");
  }

  let existingMemberCount = 0;
  let uploadRequiredCount = 0;
  const uploadPaths = new Set<string>();
  response.members.forEach((responseMember, index) => {
    const canonicalMember = GRAND_HALL_FRONTIER_MEMBERS[index];
    if (
      canonicalMember === undefined ||
      responseMember.memberIndex !== index ||
      responseMember.fileName !== canonicalMember.fileName ||
      responseMember.sizeBytes !== canonicalMember.sizeBytes ||
      responseMember.sha256 !== canonicalMember.sha256
    ) {
      throw intakeError("Grand Hall intake preflight changed the canonical member frontier.");
    }
    if (responseMember.status === "verified_existing") {
      existingMemberCount += 1;
      if (responseMember.upload !== undefined) {
        throw intakeError("Grand Hall intake preflight returned an incoherent member status.");
      }
      return;
    }
    uploadRequiredCount += 1;
    assertUploadCapability(responseMember, canonicalMember, response);
    const path = responseMember.upload?.path;
    if (path === undefined || uploadPaths.has(path)) {
      throw intakeError("Grand Hall intake preflight reused an upload capability.");
    }
    uploadPaths.add(path);
  });
  if (
    response.existingMemberCount !== existingMemberCount ||
    response.uploadRequiredCount !== uploadRequiredCount ||
    existingMemberCount + uploadRequiredCount !== GRAND_HALL_FRONTIER_MEMBERS.length
  ) {
    throw intakeError("Grand Hall intake preflight returned incoherent member counts.");
  }
  return response;
}

function validateCommitResponse(
  untrustedBody: unknown,
  targetId: string,
  operatorUserId: string,
  reviewedGitSha: string,
): CommitResponse {
  const parsed = CommitResponseSchema.safeParse(untrustedBody);
  if (!parsed.success) {
    throw intakeError("Grand Hall intake commit returned an invalid response.");
  }
  const response = parsed.data.data;
  if (
    response.operatorUserId !== operatorUserId ||
    response.targetId !== targetId ||
    response.deployedGitSha !== reviewedGitSha ||
    response.memberCount !== GRAND_HALL_FRONTIER_MEMBERS.length ||
    response.totalBytes !== GRAND_HALL_FRONTIER_TOTAL_BYTES ||
    response.gaussianCount !== GRAND_HALL_FRONTIER_GAUSSIAN_COUNT
  ) {
    throw intakeError("Grand Hall intake commit returned mismatched frontier evidence.");
  }
  return response;
}

async function defaultInspectLocalPath(
  path: string,
): Promise<GrandHallLocalPathInspection> {
  const stats = await lstat(path);
  return {
    kind: stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other",
    sizeBytes: stats.size,
    device: stats.dev,
    inode: stats.ino,
    modifiedTimeMs: stats.mtimeMs,
  };
}

/** Reads exactly the expected bytes and probes one byte past EOF. */
export async function readBoundedGrandHallMember(
  path: string,
  expectedSizeBytes: number,
  maximumBufferBytes: number,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(expectedSizeBytes) ||
    expectedSizeBytes <= 0 ||
    expectedSizeBytes > maximumBufferBytes
  ) {
    throw intakeError("Canonical Grand Hall member size exceeds the local buffer limit.");
  }
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== expectedSizeBytes) {
      throw intakeError("Canonical Grand Hall member changed before it could be read.");
    }
    const bytes = Buffer.allocUnsafe(expectedSizeBytes);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (read.bytesRead === 0) {
        throw intakeError("Canonical Grand Hall member ended before its declared byte length.");
      }
      offset += read.bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const overflow = await handle.read(overflowProbe, 0, 1, expectedSizeBytes);
    if (overflow.bytesRead !== 0) {
      throw intakeError("Canonical Grand Hall member exceeds its declared byte length.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function verifyGrandHallMemberBuffer(
  bytes: Buffer,
  member: Pick<GrandHallFrontierMemberSpec, "fileName" | "sizeBytes" | "sha256">,
): void {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength > GRAND_HALL_MAX_MEMBER_BUFFER_BYTES ||
    bytes.byteLength !== member.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== member.sha256
  ) {
    throw intakeError(`Canonical member ${member.fileName} failed exact local byte verification.`);
  }
}

function sameInspection(
  before: GrandHallLocalPathInspection,
  after: GrandHallLocalPathInspection,
): boolean {
  return before.kind === "file" &&
    after.kind === "file" &&
    before.sizeBytes === after.sizeBytes &&
    before.device === after.device &&
    before.inode === after.inode &&
    before.modifiedTimeMs === after.modifiedTimeMs;
}

async function readAndVerifyUploadBuffer(
  manifestPath: string,
  member: GrandHallFrontierMemberSpec,
  dependencies: Required<Pick<
    GrandHallFrontierIntakeDependencies,
    "inspectLocalPath" | "readLocalMember" | "verifyMemberBuffer"
  >>,
): Promise<Buffer> {
  const memberPath = resolve(dirname(manifestPath), member.relativePath);
  let before: GrandHallLocalPathInspection;
  try {
    before = await dependencies.inspectLocalPath(memberPath);
  } catch {
    throw intakeError(`Canonical member ${member.fileName} could not be inspected.`);
  }
  if (
    before.kind !== "file" ||
    before.sizeBytes !== member.sizeBytes ||
    before.sizeBytes > GRAND_HALL_MAX_MEMBER_BUFFER_BYTES
  ) {
    throw intakeError(`Canonical member ${member.fileName} is not an exact regular file.`);
  }

  let bytes: Buffer;
  try {
    bytes = await dependencies.readLocalMember(
      memberPath,
      member.sizeBytes,
      GRAND_HALL_MAX_MEMBER_BUFFER_BYTES,
    );
  } catch {
    throw intakeError(`Canonical member ${member.fileName} could not be read safely.`);
  }
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== member.sizeBytes) {
    throw intakeError(`Canonical member ${member.fileName} has an unexpected byte length.`);
  }

  let after: GrandHallLocalPathInspection;
  try {
    after = await dependencies.inspectLocalPath(memberPath);
  } catch {
    throw intakeError(`Canonical member ${member.fileName} could not be re-inspected.`);
  }
  if (!sameInspection(before, after)) {
    throw intakeError(`Canonical member ${member.fileName} changed while it was read.`);
  }
  try {
    dependencies.verifyMemberBuffer(bytes, member);
  } catch {
    throw intakeError(`Canonical member ${member.fileName} failed exact local byte verification.`);
  }
  return bytes;
}

async function requestPreflight(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<PreflightResponse> {
  const operation = "Grand Hall intake preflight";
  return withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
    const response = await fetchWithoutDisclosure(
      fetchImpl,
      safeEndpoint(PREFLIGHT_PATH, args.apiOrigin),
      {
        method: "POST",
        headers: authorizationHeaders(token),
        body: JSON.stringify(targetIdentity(args)),
        redirect: "error",
      },
      operation,
      signal,
    );
    if (response.status !== 200) {
      throw intakeError(
        `Grand Hall intake preflight failed with HTTP ${String(response.status)}.`,
      );
    }
    return validatePreflightResponse(
      await parseJsonWithoutDisclosure(response, operation, signal),
      args,
    );
  });
}

async function uploadMember(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  responseMember: PreflightMember,
  bytes: Buffer,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<GrandHallPutEvidence> {
  const upload = responseMember.upload;
  if (upload === undefined) {
    throw intakeError("Grand Hall intake preflight omitted an upload capability.");
  }
  const operation = `Grand Hall member ${String(responseMember.memberIndex + 1)} upload`;
  return withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
    const response = await fetchWithoutDisclosure(fetchImpl, safeEndpoint(upload.path, args.apiOrigin), {
      method: "PUT",
      headers: {
        ...upload.headers,
        authorization: `Bearer ${token}`,
      },
      body: bytes,
      redirect: "error",
    }, operation, signal);
    if (response.status !== 200 && response.status !== 201) {
      throw intakeError(
        `Grand Hall member ${String(responseMember.memberIndex + 1)} upload failed with HTTP ${String(response.status)}.`,
      );
    }
    const parsed = MemberUploadResponseSchema.safeParse(
      await parseJsonWithoutDisclosure(response, operation, signal),
    );
    const result = parsed.success ? parsed.data.data : null;
    const expectedCreated = response.status === 201;
    if (
      result === null ||
      result.created !== expectedCreated ||
      result.memberIndex !== responseMember.memberIndex ||
      result.fileName !== responseMember.fileName ||
      result.sizeBytes !== responseMember.sizeBytes ||
      result.sha256 !== responseMember.sha256
    ) {
      throw intakeError(
        `Grand Hall member ${String(responseMember.memberIndex + 1)} upload returned invalid evidence.`,
      );
    }
    return {
      memberIndex: result.memberIndex,
      httpStatus: response.status,
      created: result.created,
    };
  });
}

async function uploadCorruptRehearsalBuffer(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  responseMember: PreflightMember,
  bytes: Buffer,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<{ readonly httpStatus: 409; readonly errorCode: "GRAND_HALL_STORAGE_CONFLICT" }> {
  const upload = responseMember.upload;
  if (upload === undefined) {
    throw intakeError("Grand Hall intake preflight omitted a rehearsal upload capability.");
  }
  const operation = `Grand Hall member ${String(responseMember.memberIndex + 1)} corrupt rehearsal`;
  return withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
    const response = await fetchWithoutDisclosure(fetchImpl, safeEndpoint(upload.path, args.apiOrigin), {
      method: "PUT",
      headers: {
        ...upload.headers,
        authorization: `Bearer ${token}`,
      },
      body: bytes,
      redirect: "error",
    }, operation, signal);
    if (response.status !== 409) {
      throw intakeError(
        `Grand Hall corrupt-buffer rehearsal returned unexpected HTTP ${String(response.status)}; stop and preserve staging evidence.`,
      );
    }
    const parsed = IntakeErrorResponseSchema.safeParse(
      await parseJsonWithoutDisclosure(response, operation, signal),
    );
    if (!parsed.success || parsed.data.code !== "GRAND_HALL_STORAGE_CONFLICT") {
      throw intakeError("Grand Hall corrupt-buffer rehearsal returned invalid rejection evidence.");
    }
    return {
      httpStatus: 409,
      errorCode: "GRAND_HALL_STORAGE_CONFLICT",
    };
  });
}

async function requestCommit(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  targetBindingSha256: string,
  operatorUserId: string,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<CommitResponse> {
  const operation = "Grand Hall intake commit";
  return withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
    const response = await fetchWithoutDisclosure(
      fetchImpl,
      safeEndpoint(COMMIT_PATH, args.apiOrigin),
      {
        method: "POST",
        headers: authorizationHeaders(token),
        body: JSON.stringify({
          ...targetIdentity(args),
          targetBindingSha256,
          confirmation: GRAND_HALL_INTAKE_CONFIRMATION,
        }),
        redirect: "error",
      },
      operation,
      signal,
    );
    if (response.status !== 200 && response.status !== 201) {
      throw intakeError(
        `Grand Hall intake commit failed with HTTP ${String(response.status)}.`,
      );
    }
    return validateCommitResponse(
      await parseJsonWithoutDisclosure(response, operation, signal),
      args.targetId,
      operatorUserId,
      args.reviewedGitSha,
    );
  });
}

function defaultFetch(
  input: string,
  init: Parameters<GrandHallIntakeFetch>[1],
): Promise<Response> {
  return fetch(input, init);
}

type GrandHallLocalUploadDependencies = Required<Pick<
  GrandHallFrontierIntakeDependencies,
  "inspectLocalPath" | "readLocalMember" | "verifyMemberBuffer"
>>;
type GrandHallVerifiedMemberBuffers = ReadonlyMap<number, Buffer>;

async function preloadVerifiedMemberBuffers(
  args: GrandHallFrontierIntakeArgs,
  local: GrandHallLocalUploadDependencies,
): Promise<GrandHallVerifiedMemberBuffers> {
  const memberIndices = args.mode === "apply"
    ? GRAND_HALL_FRONTIER_MEMBERS.map((_member, index) => index)
    : [0, 1];
  const buffers = new Map<number, Buffer>();
  for (const memberIndex of memberIndices) {
    const member = GRAND_HALL_FRONTIER_MEMBERS[memberIndex];
    if (member === undefined) {
      throw intakeError("The selected Grand Hall operation referenced an unknown canonical member.");
    }
    buffers.set(
      memberIndex,
      await readAndVerifyUploadBuffer(args.manifestPath, member, local),
    );
  }
  return buffers;
}

function requireVerifiedMemberBuffer(
  buffers: GrandHallVerifiedMemberBuffers,
  memberIndex: number,
): Buffer {
  const bytes = buffers.get(memberIndex);
  if (bytes === undefined) {
    throw intakeError("A locally verified Grand Hall member buffer is unavailable.");
  }
  return bytes;
}

function memberStatusEvidence(
  preflight: PreflightResponse,
): readonly GrandHallMemberStatusEvidence[] {
  return preflight.members.map((member) => ({
    memberIndex: member.memberIndex,
    fileName: member.fileName,
    status: member.status,
  }));
}

function evidenceBase(
  args: GrandHallFrontierIntakeArgs,
  preflight: PreflightResponse,
  now: () => Date,
): GrandHallEvidenceBase {
  let recordedAt: string;
  try {
    recordedAt = now().toISOString();
  } catch {
    throw intakeError("Grand Hall intake could not establish a valid evidence timestamp.");
  }
  return {
    recordedAt,
    reviewedGitSha: args.reviewedGitSha,
    deployedGitSha: preflight.deployedGitSha,
    operatorUserId: preflight.operatorUserId,
    targetId: args.targetId,
    apiOrigin: args.apiOrigin,
    targetBindingSha256: preflight.targetBindingSha256,
    manifestSha256: GRAND_HALL_MANIFEST_SHA256,
    frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    preflight: {
      existingMemberCount: preflight.existingMemberCount,
      uploadRequiredCount: preflight.uploadRequiredCount,
      members: memberStatusEvidence(preflight),
    },
  };
}

async function runApply(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  preflight: PreflightResponse,
  verifiedBuffers: GrandHallVerifiedMemberBuffers,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
  log: (line: string) => void,
  now: () => Date,
): Promise<GrandHallFrontierApplyEvidenceReceipt> {
  const puts: GrandHallPutEvidence[] = [];
  for (const responseMember of preflight.members) {
    if (responseMember.status !== "upload_required") continue;
    const member = GRAND_HALL_FRONTIER_MEMBERS[responseMember.memberIndex];
    if (member === undefined) {
      throw intakeError("Grand Hall intake preflight referenced an unknown member.");
    }
    const bytes = requireVerifiedMemberBuffer(verifiedBuffers, responseMember.memberIndex);
    puts.push(await uploadMember(
      args,
      token,
      responseMember,
      bytes,
      fetchImpl,
      deadlineMs,
    ));
    log(
      `Grand Hall member ${String(responseMember.memberIndex + 1)}/${String(GRAND_HALL_FRONTIER_MEMBERS.length)} submitted.`,
    );
  }
  const commit = await requestCommit(
    args,
    token,
    preflight.targetBindingSha256,
    preflight.operatorUserId,
    fetchImpl,
    deadlineMs,
  );
  log(
    `Grand Hall frontier ${commit.created ? "created" : "reused"} on target ${args.targetId}; revision ${String(commit.revision)}.`,
  );
  return {
    schemaVersion: "venviewer.grand-hall-frontier-intake-evidence.v1",
    mode: "apply",
    ...evidenceBase(args, preflight, now),
    puts,
    package: {
      runtimePackageId: commit.runtimePackageId,
      revision: commit.revision,
      contentDigest: commit.contentDigest,
      created: commit.created,
      memberCount: commit.memberCount,
      totalBytes: commit.totalBytes,
      gaussianCount: commit.gaussianCount,
    },
  };
}

function assertFreshRehearsalPreflight(preflight: PreflightResponse): void {
  if (
    preflight.existingMemberCount !== 0 ||
    preflight.uploadRequiredCount !== GRAND_HALL_FRONTIER_MEMBERS.length ||
    preflight.members.some((member) => member.status !== "upload_required")
  ) {
    throw intakeError(
      "Conditional-PUT rehearsal requires a fresh dedicated staging target with all eleven members missing.",
    );
  }
}

function requireRehearsalMember(
  preflight: PreflightResponse,
  memberIndex: number,
): PreflightMember {
  const member = preflight.members[memberIndex];
  if (member === undefined || member.status !== "upload_required" || member.upload === undefined) {
    throw intakeError("Conditional-PUT rehearsal preflight is missing a canonical upload capability.");
  }
  return member;
}

function assertRehearsalVerification(
  initial: PreflightResponse,
  verification: PreflightResponse,
  corruptMemberIndex: number,
): void {
  if (
    verification.targetBindingSha256 !== initial.targetBindingSha256 ||
    verification.operatorUserId !== initial.operatorUserId ||
    verification.existingMemberCount !== 1 ||
    verification.uploadRequiredCount !== GRAND_HALL_FRONTIER_MEMBERS.length - 1 ||
    verification.members[0]?.status !== "verified_existing" ||
    verification.members[corruptMemberIndex]?.status !== "upload_required"
  ) {
    throw intakeError(
      "Conditional-PUT rehearsal could not prove the exact create-only and corrupt-rejection state.",
    );
  }
}

async function runConditionalPutRehearsal(
  args: GrandHallFrontierIntakeArgs,
  token: string,
  preflight: PreflightResponse,
  verifiedBuffers: GrandHallVerifiedMemberBuffers,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
  now: () => Date,
): Promise<GrandHallFrontierRehearsalEvidenceReceipt> {
  assertFreshRehearsalPreflight(preflight);
  const memberZero = requireRehearsalMember(preflight, 0);
  const corruptMemberIndex = 1;
  const corruptMember = requireRehearsalMember(preflight, corruptMemberIndex);
  const exactMemberZero = requireVerifiedMemberBuffer(verifiedBuffers, 0);
  const firstPut = await uploadMember(
    args,
    token,
    memberZero,
    exactMemberZero,
    fetchImpl,
    deadlineMs,
  );
  const secondPut = await uploadMember(
    args,
    token,
    memberZero,
    exactMemberZero,
    fetchImpl,
    deadlineMs,
  );
  if (firstPut.httpStatus !== 201 || !firstPut.created || secondPut.httpStatus !== 200 || secondPut.created) {
    throw intakeError("Conditional-PUT rehearsal did not prove create-then-verified-existing semantics.");
  }

  const exactCorruptCandidate = requireVerifiedMemberBuffer(
    verifiedBuffers,
    corruptMemberIndex,
  );
  const corrupted = Buffer.from(exactCorruptCandidate);
  corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
  let rejection: Awaited<ReturnType<typeof uploadCorruptRehearsalBuffer>>;
  try {
    rejection = await uploadCorruptRehearsalBuffer(
      args,
      token,
      corruptMember,
      corrupted,
      fetchImpl,
      deadlineMs,
    );
  } finally {
    corrupted.fill(0);
  }
  const verification = await requestPreflight(args, token, fetchImpl, deadlineMs);
  assertRehearsalVerification(preflight, verification, corruptMemberIndex);
  return {
    schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v1",
    mode: "conditional_put_rehearsal",
    ...evidenceBase(args, preflight, now),
    memberZeroPuts: [firstPut, secondPut],
    corruptBufferRejection: {
      memberIndex: corruptMemberIndex,
      ...rejection,
      remainsUploadRequired: true,
    },
    verificationPreflight: {
      existingMemberCount: verification.existingMemberCount,
      uploadRequiredCount: verification.uploadRequiredCount,
      members: memberStatusEvidence(verification),
    },
    committed: false,
    registered: false,
  };
}

function validatedHttpRequestDeadline(value: number | undefined): number {
  const deadlineMs = value ?? GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw intakeError("Grand Hall intake HTTP request deadline is invalid.");
  }
  return deadlineMs;
}

export async function runGrandHallFrontierIntake(
  options: RunGrandHallFrontierIntakeOptions,
): Promise<GrandHallFrontierIntakeResult> {
  const args = parseGrandHallFrontierIntakeArgs(options.args);
  const token = requiredAdminToken(options.env ?? process.env);
  const dependencies = options.dependencies ?? {};
  const inspectFrontier = dependencies.inspectFrontier ?? ((manifestPath: string) =>
    inspectLcc2HighestDetailFrontier({
      manifestPath,
      environmentPolicy: "exclude",
    }));
  const inspectLocalPath = dependencies.inspectLocalPath ?? defaultInspectLocalPath;
  const readLocalMember = dependencies.readLocalMember ?? readBoundedGrandHallMember;
  const verifyMemberBuffer = dependencies.verifyMemberBuffer ?? verifyGrandHallMemberBuffer;
  const fetchImpl = dependencies.fetchImpl ?? defaultFetch;
  const inspectGitState = dependencies.inspectGitState ?? inspectGrandHallGitState;
  const deadlineMs = validatedHttpRequestDeadline(dependencies.httpRequestDeadlineMs);
  const now = dependencies.now ?? (() => new Date());
  const log = options.log ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });

  let gitState: GrandHallGitStateInspection;
  try {
    gitState = await inspectGitState(args.reviewedGitSha);
  } catch {
    throw intakeError("Reviewed Git state could not be established locally.");
  }
  assertGrandHallReviewedGitState(gitState, args.reviewedGitSha);

  let receipt: Lcc2HighestDetailFrontierReceiptV0;
  try {
    receipt = await inspectFrontier(args.manifestPath);
  } catch {
    throw intakeError("Canonical Grand Hall manifest inspection failed locally.");
  }
  if (validateGrandHallFrontierReceipt(receipt).status !== "passed") {
    throw intakeError("Canonical Grand Hall manifest did not match the pinned frontier receipt.");
  }

  const local = { inspectLocalPath, readLocalMember, verifyMemberBuffer };
  const verifiedBuffers = await preloadVerifiedMemberBuffers(args, local);
  const preflight = await requestPreflight(args, token, fetchImpl, deadlineMs);
  return args.mode === "apply"
    ? runApply(args, token, preflight, verifiedBuffers, fetchImpl, deadlineMs, log, now)
    : runConditionalPutRehearsal(
        args,
        token,
        preflight,
        verifiedBuffers,
        fetchImpl,
        deadlineMs,
        now,
      );
}

export function serializeGrandHallFrontierEvidenceReceipt(
  result: GrandHallFrontierIntakeResult,
): string {
  return JSON.stringify(result);
}

function safeDirectRunError(error: unknown): string {
  return error instanceof GrandHallFrontierIntakeCliError
    ? error.message
    : "Grand Hall frontier intake failed safely.";
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runGrandHallFrontierIntake({
    args: process.argv.slice(2),
    log: (line: string): void => {
      process.stderr.write(`${line}\n`);
    },
  }).then(
    (result) => {
      process.stdout.write(`${serializeGrandHallFrontierEvidenceReceipt(result)}\n`);
      process.exitCode = 0;
    },
    (error: unknown) => {
      process.stderr.write(`${safeDirectRunError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
