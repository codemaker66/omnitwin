/**
 * Server-bound operator intake for the exact Trades Hall Grand Hall frontier.
 *
 * Source admission validates the exact local frontier and uploads at most one
 * next missing member per invocation. Apply can only commit an already complete
 * frontier. The staging rehearsal proves conditional create and corrupt-byte
 * rejection without a commit, and disabled verification proves the capability
 * is closed. Every mode is pinned to one staging target and one recorded
 * Railway staging API origin, then emits one redacted structured evidence receipt.
 * Database and private-storage credentials never cross this client.
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  GRAND_HALL_STAGING_TARGET_ID,
  type GrandHallFrontierMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import { safeGitChildEnvironment } from "./safe-git-child-environment.js";
import {
  GRAND_HALL_ADMIN_TOKEN_RELAY_ENV,
  GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE,
  receiveGrandHallAdminTokenFromBrowser,
} from "./grand-hall-admin-token-loopback-relay.js";
import { validateGrandHallFrontierReceipt } from "./register-grand-hall-big-model-frontier.js";

export const GRAND_HALL_INTAKE_CONFIRMATION =
  "register_exact_internal_ready_grand_hall_frontier";
export const GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV =
  "RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN";
export const GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV =
  "RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_API_ORIGIN";
export const GRAND_HALL_MAX_MEMBER_BUFFER_BYTES = 10_600_000;
export const GRAND_HALL_MAX_API_RESPONSE_BYTES = 256 * 1_024;
export const GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS = 10 * 60_000;
export const GRAND_HALL_INTAKE_STAGING_TARGET_ID =
  GRAND_HALL_STAGING_TARGET_ID;
export const GRAND_HALL_SOURCE_ADMISSION_FLAG = "--admit-next-member";

const PREFLIGHT_PATH =
  "/admin/assets/grand-hall-frontier-intake/preflight";
const COMMIT_PATH = "/admin/assets/grand-hall-frontier-intake/commit";
const REHEARSAL_PATH =
  "/admin/assets/grand-hall-frontier-intake/rehearsal";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/u;
const TARGET_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const REVIEWED_GIT_SHA = /^[a-f0-9]{40,64}$/u;
const CONDITIONAL_PUT_REHEARSAL_FLAG = "--rehearse-conditional-put";
const VERIFY_DISABLED_FLAG = "--verify-disabled";
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
    operatorUserId: z.string().uuid(),
    created: z.boolean(),
    memberIndex: z.number().int().nonnegative(),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256_HEX),
  }).strict(),
}).strict();

const RehearsalResponseSchema = z.object({
  data: z.object({
    schemaVersion: z.literal("venviewer.grand-hall-intake-rehearsal.v1"),
    operatorUserId: z.string().uuid(),
    targetId: z.string().regex(TARGET_ID),
    deployedGitSha: z.string().regex(REVIEWED_GIT_SHA),
    apiOrigin: z.string().url().max(500),
    manifestSha256: z.string().regex(SHA256_HEX),
    frontierReceiptSha256: z.string().regex(SHA256_RECEIPT),
    member: z.object({
      memberIndex: z.literal(0),
      fileName: z.string().min(1).max(255),
      sizeBytes: z.number().int().positive(),
      sha256: z.string().regex(SHA256_HEX),
    }).strict(),
    initialPreflight: z.object({
      existingMemberCount: z.literal(0),
      uploadRequiredCount: z.literal(11),
    }).strict(),
    conditionalPut: z.object({
      created: z.object({
        statusCode: z.literal(201),
        created: z.literal(true),
      }).strict(),
      exactRetry: z.object({
        statusCode: z.literal(200),
        created: z.literal(false),
      }).strict(),
      corruptCopy: z.object({
        statusCode: z.literal(409),
        code: z.literal("GRAND_HALL_STORAGE_CONFLICT"),
        storedBytesUnchanged: z.literal(true),
      }).strict(),
    }).strict(),
    finalPreflight: z.object({
      existingMemberCount: z.literal(1),
      uploadRequiredCount: z.literal(10),
    }).strict(),
    commitAttempted: z.literal(false),
    registrationAttempted: z.literal(false),
  }).strict(),
}).strict();

const IntakeErrorResponseSchema = z.object({
  error: z.string().min(1).max(1_000),
  code: z.string().min(1).max(100),
}).strict();

type PreflightResponse = z.infer<typeof PreflightResponseSchema>["data"];
type PreflightMember = z.infer<typeof PreflightMemberSchema>;
type CommitResponse = z.infer<typeof CommitResponseSchema>["data"];
type RehearsalResponse = z.infer<typeof RehearsalResponseSchema>["data"];

interface GrandHallFrontierIntakeArgsBase {
  readonly apiOrigin: string;
  readonly targetId: string;
  readonly reviewedGitSha: string;
  readonly outPath: string;
}

export type GrandHallFrontierIntakeArgs =
  | (GrandHallFrontierIntakeArgsBase & {
      readonly manifestPath: string;
      readonly mode: "apply";
    })
  | (GrandHallFrontierIntakeArgsBase & {
      readonly manifestPath: string;
      readonly mode: "admit_next_member";
    })
  | (GrandHallFrontierIntakeArgsBase & {
      readonly manifestPath: string;
      readonly mode: "conditional_put_rehearsal";
    })
  | (GrandHallFrontierIntakeArgsBase & {
      readonly mode: "verify_disabled";
    });

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
  readonly repositoryRoot: string;
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

type GrandHallIntakeAdminTokenProvider = () => Promise<string>;

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
  readonly discoverEvidenceGitRoot?: (directory: string) => Promise<string | null>;
  readonly receiveAdminTokenFromBrowser?: typeof receiveGrandHallAdminTokenFromBrowser;
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

export interface GrandHallFrontierSourceAdmissionEvidenceReceipt extends GrandHallEvidenceBase {
  readonly schemaVersion: "venviewer.grand-hall-frontier-source-admission-evidence.v1";
  readonly mode: "admit_next_member";
  readonly admittedMember: (GrandHallPutEvidence & {
    readonly fileName: string;
  }) | null;
  readonly progress: {
    readonly existingMemberCountBefore: number;
    readonly uploadRequiredCountBefore: number;
    readonly existingMemberCountAfter: number;
    readonly uploadRequiredCountAfter: number;
    readonly allMembersVerified: boolean;
  };
  readonly committed: false;
  readonly registered: false;
}

export interface GrandHallFrontierRehearsalEvidenceReceipt {
  readonly schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v2";
  readonly mode: "conditional_put_rehearsal";
  readonly recordedAt: string;
  readonly reviewedGitSha: string;
  readonly serverEvidence: RehearsalResponse;
}

export interface GrandHallFrontierDisabledEvidenceReceipt {
  readonly schemaVersion: "venviewer.grand-hall-frontier-intake-disabled-evidence.v1";
  readonly mode: "verify_disabled";
  readonly recordedAt: string;
  readonly reviewedGitSha: string;
  readonly targetId: string;
  readonly apiOrigin: string;
  readonly httpStatus: 503;
  readonly errorCode: "GRAND_HALL_INTAKE_DISABLED";
  readonly disabled: true;
}

export type GrandHallFrontierIntakeResult =
  | GrandHallFrontierApplyEvidenceReceipt
  | GrandHallFrontierSourceAdmissionEvidenceReceipt
  | GrandHallFrontierRehearsalEvidenceReceipt
  | GrandHallFrontierDisabledEvidenceReceipt;

const GRAND_HALL_INTAKE_FAILURE_CODES = [
  "LOCAL_PRECONDITION_FAILED",
  "TOKEN_ACQUISITION_FAILED",
  "REQUEST_OUTCOME_UNKNOWN",
  "REQUEST_DEADLINE_EXCEEDED",
  "HTTP_ERROR",
  "INVALID_RESPONSE",
  "EVIDENCE_FINALIZATION_FAILED",
  "UNEXPECTED_FAILURE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVITATION_REQUIRED",
  "EMAIL_REQUIRED",
  "EMAIL_UNVERIFIED",
  "SERVER_ERROR",
  "VALIDATION_ERROR",
  "GRAND_HALL_INTAKE_BUSY",
  "GRAND_HALL_INTAKE_DISABLED",
  "GRAND_HALL_INTAKE_TARGET_MISMATCH",
  "GRAND_HALL_FRONTIER_MISMATCH",
  "GRAND_HALL_INTAKE_TIMEOUT",
  "GRAND_HALL_INTAKE_FAILED",
  "GRAND_HALL_STORAGE_CONFLICT",
  "GRAND_HALL_STORAGE_FAILED",
  "GRAND_HALL_REMOTE_VERIFICATION_FAILED",
  "GRAND_HALL_ASSET_CONFLICT",
  "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
  "GRAND_HALL_DATABASE_UNAVAILABLE",
] as const;

export type GrandHallFrontierIntakeFailureCode =
  typeof GRAND_HALL_INTAKE_FAILURE_CODES[number];

export type GrandHallFrontierIntakeFailureClass =
  | "safe_to_retry"
  | "reconcile_admission"
  | "reconcile_apply"
  | "terminal_rehearsal"
  | "stop";

const GRAND_HALL_INTAKE_FAILURE_CLASS_SET: ReadonlySet<string> = new Set([
  "safe_to_retry",
  "reconcile_admission",
  "reconcile_apply",
  "terminal_rehearsal",
  "stop",
]);

export interface GrandHallFrontierIntakeFailureReport {
  readonly class: GrandHallFrontierIntakeFailureClass;
  readonly code: GrandHallFrontierIntakeFailureCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

const GRAND_HALL_INTAKE_FAILURE_CODE_SET: ReadonlySet<string> = new Set(
  GRAND_HALL_INTAKE_FAILURE_CODES,
);
const GRAND_HALL_TERMINAL_SERVER_FAILURE_CODES: ReadonlySet<
  GrandHallFrontierIntakeFailureCode
> = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVITATION_REQUIRED",
  "EMAIL_REQUIRED",
  "EMAIL_UNVERIFIED",
  "VALIDATION_ERROR",
  "GRAND_HALL_INTAKE_DISABLED",
  "GRAND_HALL_INTAKE_TARGET_MISMATCH",
  "GRAND_HALL_FRONTIER_MISMATCH",
  "GRAND_HALL_STORAGE_CONFLICT",
  "GRAND_HALL_REMOTE_VERIFICATION_FAILED",
  "GRAND_HALL_ASSET_CONFLICT",
  "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
]);

const LOCAL_STOP_FAILURE = {
  class: "stop",
  code: "LOCAL_PRECONDITION_FAILED",
} as const satisfies GrandHallFrontierIntakeFailureReport;

class GrandHallFrontierIntakeCliError extends Error {
  constructor(
    message: string,
    readonly failure: GrandHallFrontierIntakeFailureReport,
    readonly definitiveResponseFailure: boolean,
  ) {
    super(message);
    this.name = "GrandHallFrontierIntakeCliError";
  }
}

function intakeError(
  message: string,
  failure: GrandHallFrontierIntakeFailureReport = LOCAL_STOP_FAILURE,
  definitiveResponseFailure = false,
): GrandHallFrontierIntakeCliError {
  return new GrandHallFrontierIntakeCliError(
    message,
    failure,
    definitiveResponseFailure,
  );
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
    parsed.hash !== "" ||
    parsed.port !== "" ||
    value !== parsed.origin
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
  let outPath: string | undefined;
  let applyCount = 0;
  let admissionCount = 0;
  let rehearsalCount = 0;
  let verifyDisabledCount = 0;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      applyCount += 1;
      continue;
    }
    if (argument === GRAND_HALL_SOURCE_ADMISSION_FLAG) {
      admissionCount += 1;
      continue;
    }
    if (argument === CONDITIONAL_PUT_REHEARSAL_FLAG) {
      rehearsalCount += 1;
      continue;
    }
    if (argument === VERIFY_DISABLED_FLAG) {
      verifyDisabledCount += 1;
      continue;
    }
    if (
      argument === "--manifest" ||
      argument === "--api-origin" ||
      argument === "--target-id" ||
      argument === "--reviewed-git-sha" ||
      argument === "--out"
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
      } else if (argument === "--out") {
        if (outPath !== undefined) {
          throw intakeError("--out may only be supplied once.");
        }
        if (value.length === 0 || value.trim() !== value || /[\r\n]/u.test(value)) {
          throw intakeError("--out requires a non-empty local file path.");
        }
        outPath = resolve(value);
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
      `Unknown or unsupported argument. Use only --manifest, --api-origin, --target-id, --reviewed-git-sha, --out, and exactly one of --apply, ${GRAND_HALL_SOURCE_ADMISSION_FLAG}, ${CONDITIONAL_PUT_REHEARSAL_FLAG}, or ${VERIFY_DISABLED_FLAG}.`,
    );
  }

  const operationCount = applyCount + admissionCount + rehearsalCount +
    verifyDisabledCount;
  if (
    operationCount !== 1 ||
    applyCount > 1 ||
    admissionCount > 1 ||
    rehearsalCount > 1 ||
    verifyDisabledCount > 1
  ) {
    throw intakeError(
      `Supply exactly one operation flag: --apply, ${GRAND_HALL_SOURCE_ADMISSION_FLAG}, ${CONDITIONAL_PUT_REHEARSAL_FLAG}, or ${VERIFY_DISABLED_FLAG}.`,
    );
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
  if (outPath === undefined) {
    throw intakeError(
      "--out is required so evidence is reserved before any staging request or mutation.",
    );
  }

  const mode = applyCount === 1
    ? "apply"
    : admissionCount === 1
      ? "admit_next_member"
      : rehearsalCount === 1
        ? "conditional_put_rehearsal"
        : "verify_disabled";
  if (targetId !== GRAND_HALL_INTAKE_STAGING_TARGET_ID) {
    throw intakeError(
      `Every Grand Hall intake operation is restricted to target ${GRAND_HALL_INTAKE_STAGING_TARGET_ID}.`,
    );
  }

  const base = {
    apiOrigin: cleanHttpsOrigin(apiOrigin),
    targetId,
    reviewedGitSha,
    outPath,
  } as const;
  if (mode === "verify_disabled") {
    if (manifestPath !== undefined) {
      throw intakeError(`${VERIFY_DISABLED_FLAG} does not accept --manifest or read source files.`);
    }
    return { ...base, mode };
  }
  if (manifestPath === undefined || !isAbsolute(manifestPath)) {
    throw intakeError("--manifest requires an absolute local path.");
  }
  const resolvedManifestPath = resolve(manifestPath);
  if (basename(resolvedManifestPath) !== GRAND_HALL_MANIFEST_FILE_NAME) {
    throw intakeError(`--manifest must point to ${GRAND_HALL_MANIFEST_FILE_NAME}.`);
  }

  return {
    ...base,
    manifestPath: resolvedManifestPath,
    mode,
  };
}

async function runGitCommand(args: readonly string[]): Promise<string> {
  try {
    const result = await execFile("git", [...args], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: safeGitChildEnvironment(process.env),
      windowsHide: true,
      timeout: GIT_COMMAND_DEADLINE_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    });
    return String(result.stdout).trim();
  } catch {
    throw intakeError("Reviewed Git state could not be established locally.");
  }
}

async function hasGitMarkerAtOrAbove(directory: string): Promise<boolean> {
  try {
    await lstat(join(directory, ".git"));
    return true;
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTDIR")) {
      throw intakeError(
        "Grand Hall evidence output Git boundary is indeterminate; refusing local output.",
      );
    }
  }
  const parent = dirname(directory);
  return parent === directory ? false : hasGitMarkerAtOrAbove(parent);
}

async function discoverContainingGitRoot(directory: string): Promise<string | null> {
  try {
    return await runGitCommand(["-C", directory, "rev-parse", "--show-toplevel"]);
  } catch {
    if (await hasGitMarkerAtOrAbove(resolve(directory))) {
      throw intakeError(
        "Grand Hall evidence output Git boundary is indeterminate; refusing local output.",
      );
    }
    return null;
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
    repositoryRoot,
  };
}

export function assertGrandHallReviewedGitState(
  state: GrandHallGitStateInspection,
  reviewedGitSha: string,
): void {
  if (
    !isAbsolute(state.repositoryRoot) ||
    resolve(state.repositoryRoot) !== state.repositoryRoot
  ) {
    throw intakeError("The reviewed Git repository root is not an absolute canonical path.");
  }
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

async function requestAdminToken(
  tokenProvider: GrandHallIntakeAdminTokenProvider,
): Promise<string> {
  let token: string;
  try {
    token = await tokenProvider();
  } catch (error) {
    if (error instanceof GrandHallFrontierIntakeCliError) throw error;
    throw intakeError(
      "A fresh Grand Hall platform-admin bearer token could not be acquired safely.",
      {
        class: "safe_to_retry",
        code: "TOKEN_ACQUISITION_FAILED",
      },
    );
  }
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.trim() !== token ||
    /[\r\n]/u.test(token)
  ) {
    throw intakeError("The fresh Grand Hall platform-admin bearer token is invalid.");
  }
  return token;
}

function assertExpectedStagingApiOrigin(
  apiOrigin: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  const expectedOrigin = env[
    GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV
  ];
  if (expectedOrigin === undefined || expectedOrigin.length === 0) {
    throw intakeError(
      `${GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV} must contain the separately recorded staging API origin.`,
    );
  }
  let validatedExpectedOrigin: string;
  try {
    validatedExpectedOrigin = cleanHttpsOrigin(expectedOrigin);
  } catch {
    throw intakeError(
      `${GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV} must be a clean HTTPS origin.`,
    );
  }
  if (validatedExpectedOrigin !== apiOrigin) {
    throw intakeError(
      `--api-origin must exactly equal ${GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV}.`,
    );
  }
  const parsed = new URL(validatedExpectedOrigin);
  if (
    parsed.port !== "" ||
    parsed.hostname === "up.railway.app" ||
    !parsed.hostname.endsWith(".up.railway.app")
  ) {
    throw intakeError(
      `${GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV} must be the dedicated Railway staging HTTPS origin.`,
    );
  }
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

function isGrandHallIntakeFailureCode(
  value: unknown,
): value is GrandHallFrontierIntakeFailureCode {
  return typeof value === "string" &&
    GRAND_HALL_INTAKE_FAILURE_CODE_SET.has(value);
}

function allowlistedResponseCode(
  value: unknown,
): GrandHallFrontierIntakeFailureCode | null {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return null;
  }
  return isGrandHallIntakeFailureCode(value.code) ? value.code : null;
}

function safeResponseStatus(status: number): number | undefined {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function retryAfterSeconds(response: Response): number | undefined {
  let raw: string | null;
  try {
    raw = response.headers.get("retry-after");
  } catch {
    return undefined;
  }
  if (raw === null || !/^(?:0|[1-9][0-9]{0,3})$/u.test(raw)) {
    return undefined;
  }
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds <= 3_600
    ? seconds
    : undefined;
}

function responseFailureClass(
  status: number,
  code: GrandHallFrontierIntakeFailureCode,
): GrandHallFrontierIntakeFailureClass {
  if (GRAND_HALL_TERMINAL_SERVER_FAILURE_CODES.has(code)) return "stop";
  if (status === 408 || status === 429 || status >= 500) {
    return "safe_to_retry";
  }
  return "stop";
}

function reclassifiedIntakeError(
  error: unknown,
  failureClass: GrandHallFrontierIntakeFailureClass,
  fallbackCode: GrandHallFrontierIntakeFailureCode,
): GrandHallFrontierIntakeCliError {
  if (error instanceof GrandHallFrontierIntakeCliError) {
    return intakeError(error.message, {
      ...error.failure,
      class: failureClass,
      code: error.failure.code === "LOCAL_PRECONDITION_FAILED"
        ? fallbackCode
        : error.failure.code,
    });
  }
  return intakeError("Grand Hall frontier intake failed safely.", {
    class: failureClass,
    code: fallbackCode,
  });
}

function classifiedReadOnlyRequestError(
  error: unknown,
): GrandHallFrontierIntakeCliError {
  if (
    error instanceof GrandHallFrontierIntakeCliError &&
    error.failure.code !== "LOCAL_PRECONDITION_FAILED"
  ) {
    return error;
  }
  return reclassifiedIntakeError(error, "stop", "INVALID_RESPONSE");
}

function classifiedMutationRequestError(
  error: unknown,
  failureClass: "reconcile_admission" | "reconcile_apply" | "terminal_rehearsal",
  forceClassification = false,
): GrandHallFrontierIntakeCliError {
  if (
    !forceClassification &&
    error instanceof GrandHallFrontierIntakeCliError &&
    error.definitiveResponseFailure
  ) {
    return error;
  }
  return reclassifiedIntakeError(error, failureClass, "INVALID_RESPONSE");
}

async function withAbsoluteHttpDeadline<T>(
  operation: string,
  deadlineMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadlineError = intakeError(
    `${operation} exceeded its absolute request deadline.`,
    {
      class: "safe_to_retry",
      code: "REQUEST_DEADLINE_EXCEEDED",
    },
  );
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
    throw intakeError(`${operation} request could not be completed.`, {
      class: "safe_to_retry",
      code: "REQUEST_OUTCOME_UNKNOWN",
    });
  }
}

interface GrandHallResponseBodyReadResult {
  readonly done: boolean;
  readonly value?: Uint8Array;
}

async function parseJsonWithoutDisclosure(
  response: Response,
  operation: string,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (
      !/^\d+$/u.test(contentLength) ||
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes > GRAND_HALL_MAX_API_RESPONSE_BYTES
    ) {
      if (response.body !== null && !response.body.locked) {
        void response.body.cancel().catch(() => undefined);
      }
      throw intakeError(`${operation} returned an oversized response.`, {
        class: "stop",
        code: "INVALID_RESPONSE",
      });
    }
  }

  let text: string;
  try {
    if (response.body === null) {
      text = "";
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let readerCanceled = false;
      try {
        for (;;) {
          const chunk = await new Promise<GrandHallResponseBodyReadResult>(
            (resolveRead, rejectRead) => {
              const onAbort = (): void => {
                signal.removeEventListener("abort", onAbort);
                readerCanceled = true;
                void reader.cancel().catch(() => undefined);
                rejectRead(
                  signal.reason instanceof GrandHallFrontierIntakeCliError
                    ? signal.reason
                    : intakeError(`${operation} response read was aborted.`, {
                        class: "stop",
                        code: "INVALID_RESPONSE",
                      }),
                );
              };
              if (signal.aborted) {
                onAbort();
                return;
              }
              signal.addEventListener("abort", onAbort, { once: true });
              void reader.read().then(
                (value) => {
                  signal.removeEventListener("abort", onAbort);
                  resolveRead(value);
                },
                (error: unknown) => {
                  signal.removeEventListener("abort", onAbort);
                  rejectRead(
                    error instanceof Error
                      ? error
                      : new Error("Grand Hall API response read failed"),
                  );
                },
              );
            },
          );
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) {
            readerCanceled = true;
            void reader.cancel().catch(() => undefined);
            throw intakeError(`${operation} returned an invalid response body.`, {
              class: "stop",
              code: "INVALID_RESPONSE",
            });
          }
          totalBytes += chunk.value.byteLength;
          if (totalBytes > GRAND_HALL_MAX_API_RESPONSE_BYTES) {
            readerCanceled = true;
            void reader.cancel().catch(() => undefined);
            throw intakeError(`${operation} returned an oversized response.`, {
              class: "stop",
              code: "INVALID_RESPONSE",
            });
          }
          chunks.push(chunk.value);
        }
      } finally {
        if (!readerCanceled) reader.releaseLock();
      }
      text = Buffer.concat(chunks, totalBytes).toString("utf8");
    }
  } catch (error) {
    if (error instanceof GrandHallFrontierIntakeCliError) throw error;
    if (signal.aborted && signal.reason instanceof GrandHallFrontierIntakeCliError) {
      throw signal.reason;
    }
    throw intakeError(`${operation} returned an unreadable response.`, {
      class: "stop",
      code: "INVALID_RESPONSE",
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw intakeError(`${operation} returned an invalid response.`, {
      class: "stop",
      code: "INVALID_RESPONSE",
    });
  }
}

async function httpResponseFailure(
  response: Response,
  operation: string,
  signal: AbortSignal,
  message: string,
): Promise<GrandHallFrontierIntakeCliError> {
  const status = safeResponseStatus(response.status);
  const retryAfter = retryAfterSeconds(response);
  let parsed: unknown;
  try {
    parsed = await parseJsonWithoutDisclosure(response, operation, signal);
  } catch (error) {
    if (
      error instanceof GrandHallFrontierIntakeCliError &&
      error.failure.code === "REQUEST_DEADLINE_EXCEEDED"
    ) {
      return intakeError(error.message, {
        ...error.failure,
        ...(status === undefined ? {} : { status }),
        ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
      });
    }
    const failureClass = responseFailureClass(response.status, "INVALID_RESPONSE");
    return intakeError(message, {
      class: failureClass,
      code: "INVALID_RESPONSE",
      ...(status === undefined ? {} : { status }),
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    }, failureClass === "stop");
  }

  const code = allowlistedResponseCode(parsed) ?? "HTTP_ERROR";
  const failureClass = responseFailureClass(response.status, code);
  return intakeError(message, {
    class: failureClass,
    code,
    ...(status === undefined ? {} : { status }),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  }, failureClass === "stop");
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
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<PreflightResponse> {
  const operation = "Grand Hall intake preflight";
  const token = await requestAdminToken(tokenProvider);
  try {
    return await withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
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
        throw await httpResponseFailure(
          response,
          operation,
          signal,
          `Grand Hall intake preflight failed with HTTP ${String(response.status)}.`,
        );
      }
      return validatePreflightResponse(
        await parseJsonWithoutDisclosure(response, operation, signal),
        args,
      );
    });
  } catch (error) {
    throw classifiedReadOnlyRequestError(error);
  }
}

async function requestDisabledVerification(
  args: GrandHallFrontierIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<{
  readonly httpStatus: 503;
  readonly errorCode: "GRAND_HALL_INTAKE_DISABLED";
}> {
  const operation = "Grand Hall intake disabled verification";
  const token = await requestAdminToken(tokenProvider);
  try {
    return await withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
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
      if (response.status !== 503) {
        throw await httpResponseFailure(
          response,
          operation,
          signal,
          `Grand Hall intake disabled verification required HTTP 503 but received HTTP ${String(response.status)}.`,
        );
      }
      const responseBody = await parseJsonWithoutDisclosure(
        response,
        operation,
        signal,
      );
      const parsed = IntakeErrorResponseSchema.safeParse(responseBody);
      if (!parsed.success || parsed.data.code !== "GRAND_HALL_INTAKE_DISABLED") {
        const code = allowlistedResponseCode(responseBody) ?? "INVALID_RESPONSE";
        const failureClass = responseFailureClass(response.status, code);
        const retryAfter = retryAfterSeconds(response);
        throw intakeError(
          "Grand Hall intake disabled verification did not return GRAND_HALL_INTAKE_DISABLED.",
          {
            class: failureClass,
            code,
            status: 503,
            ...(retryAfter === undefined
              ? {}
              : { retryAfterSeconds: retryAfter }),
          },
          failureClass === "stop",
        );
      }
      return {
        httpStatus: 503,
        errorCode: "GRAND_HALL_INTAKE_DISABLED",
      };
    });
  } catch (error) {
    throw classifiedReadOnlyRequestError(error);
  }
}

async function uploadMember(
  args: GrandHallFrontierIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  responseMember: PreflightMember,
  expectedOperatorUserId: string,
  bytes: Buffer,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<GrandHallPutEvidence> {
  const upload = responseMember.upload;
  if (upload === undefined) {
    throw intakeError("Grand Hall intake preflight omitted an upload capability.");
  }
  const operation = `Grand Hall member ${String(responseMember.memberIndex + 1)} upload`;
  const token = await requestAdminToken(tokenProvider);
  try {
    return await withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
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
        throw await httpResponseFailure(
          response,
          operation,
          signal,
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
        result.operatorUserId !== expectedOperatorUserId ||
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
  } catch (error) {
    throw classifiedMutationRequestError(error, "reconcile_admission");
  }
}

async function requestConditionalPutRehearsal(
  args: GrandHallRehearsalIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  bytes: Buffer,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<RehearsalResponse> {
  const member = GRAND_HALL_FRONTIER_MEMBERS[0];
  const operation = "Grand Hall single-request conditional-PUT rehearsal";
  const token = await requestAdminToken(tokenProvider);
  try {
    return await withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
      const response = await fetchWithoutDisclosure(
        fetchImpl,
        safeEndpoint(REHEARSAL_PATH, args.apiOrigin),
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-length": String(member.sizeBytes),
            "content-type": "application/octet-stream",
            "x-venviewer-frontier-receipt-sha256":
              GRAND_HALL_FRONTIER_RECEIPT_SHA256,
            "x-venviewer-intake-api-origin": args.apiOrigin,
            "x-venviewer-intake-deployed-git-sha": args.reviewedGitSha,
            "x-venviewer-intake-target-id": args.targetId,
            "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
          },
          body: bytes,
          redirect: "error",
        },
        operation,
        signal,
      );
      if (response.status !== 200) {
        throw await httpResponseFailure(
          response,
          operation,
          signal,
          `Grand Hall single-request rehearsal failed with HTTP ${String(response.status)}.`,
        );
      }
      const parsed = RehearsalResponseSchema.safeParse(
        await parseJsonWithoutDisclosure(response, operation, signal),
      );
      const result = parsed.success ? parsed.data.data : null;
      if (
        result === null ||
        result.targetId !== args.targetId ||
        result.apiOrigin !== args.apiOrigin ||
        result.deployedGitSha !== args.reviewedGitSha ||
        result.manifestSha256 !== GRAND_HALL_MANIFEST_SHA256 ||
        result.frontierReceiptSha256 !== GRAND_HALL_FRONTIER_RECEIPT_SHA256 ||
        result.member.fileName !== member.fileName ||
        result.member.sizeBytes !== member.sizeBytes ||
        result.member.sha256 !== member.sha256
      ) {
        throw intakeError(
          "Grand Hall single-request rehearsal returned invalid or mismatched evidence.",
        );
      }
      return result;
    });
  } catch (error) {
    throw classifiedMutationRequestError(error, "terminal_rehearsal", true);
  }
}

async function requestCommit(
  args: GrandHallFrontierIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  targetBindingSha256: string,
  operatorUserId: string,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
): Promise<CommitResponse> {
  const operation = "Grand Hall intake commit";
  const token = await requestAdminToken(tokenProvider);
  try {
    return await withAbsoluteHttpDeadline(operation, deadlineMs, async (signal) => {
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
        throw await httpResponseFailure(
          response,
          operation,
          signal,
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
  } catch (error) {
    throw classifiedMutationRequestError(error, "reconcile_apply");
  }
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
type GrandHallRehearsalIntakeArgs = Extract<
  GrandHallFrontierIntakeArgs,
  { readonly mode: "conditional_put_rehearsal" }
>;
type GrandHallAdmissionIntakeArgs = Extract<
  GrandHallFrontierIntakeArgs,
  { readonly mode: "admit_next_member" }
>;

async function readRehearsalMemberBuffer(
  args: GrandHallRehearsalIntakeArgs,
  local: GrandHallLocalUploadDependencies,
): Promise<Buffer> {
  const member = GRAND_HALL_FRONTIER_MEMBERS[0];
  return readAndVerifyUploadBuffer(args.manifestPath, member, local);
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

function evidenceTimestamp(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    throw intakeError("Grand Hall intake could not establish a valid evidence timestamp.");
  }
}

function evidenceBase(
  args: GrandHallFrontierIntakeArgs,
  preflight: PreflightResponse,
  now: () => Date,
): GrandHallEvidenceBase {
  return {
    recordedAt: evidenceTimestamp(now),
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
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  preflight: PreflightResponse,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
  log: (line: string) => void,
  now: () => Date,
): Promise<GrandHallFrontierApplyEvidenceReceipt> {
  if (
    preflight.existingMemberCount !== GRAND_HALL_FRONTIER_MEMBERS.length ||
    preflight.uploadRequiredCount !== 0 ||
    preflight.members.some((member) => member.status !== "verified_existing")
  ) {
    throw intakeError(
      `--apply requires all eleven Grand Hall members to be verified already; run ${GRAND_HALL_SOURCE_ADMISSION_FLAG} until no members remain.`,
    );
  }
  const commit = await requestCommit(
    args,
    tokenProvider,
    preflight.targetBindingSha256,
    preflight.operatorUserId,
    fetchImpl,
    deadlineMs,
  );
  try {
    log(
      `Grand Hall frontier ${commit.created ? "created" : "reused"} on target ${args.targetId}; revision ${String(commit.revision)}.`,
    );
    return {
      schemaVersion: "venviewer.grand-hall-frontier-intake-evidence.v1",
      mode: "apply",
      ...evidenceBase(args, preflight, now),
      puts: [],
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
  } catch (error) {
    throw reclassifiedIntakeError(
      error,
      "reconcile_apply",
      "EVIDENCE_FINALIZATION_FAILED",
    );
  }
}

async function runSourceAdmission(
  args: GrandHallAdmissionIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  preflight: PreflightResponse,
  local: GrandHallLocalUploadDependencies,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
  log: (line: string) => void,
  now: () => Date,
): Promise<GrandHallFrontierSourceAdmissionEvidenceReceipt> {
  const nextMissing = preflight.members.find(
    (member) => member.status === "upload_required",
  );
  let admittedMember: GrandHallFrontierSourceAdmissionEvidenceReceipt[
    "admittedMember"
  ] = null;
  if (nextMissing !== undefined) {
    const canonicalMember = GRAND_HALL_FRONTIER_MEMBERS[
      nextMissing.memberIndex
    ];
    if (canonicalMember === undefined) {
      throw intakeError("Grand Hall intake preflight referenced an unknown member.");
    }
    const bytes = await readAndVerifyUploadBuffer(
      args.manifestPath,
      canonicalMember,
      local,
    );
    const put = await uploadMember(
      args,
      tokenProvider,
      nextMissing,
      preflight.operatorUserId,
      bytes,
      fetchImpl,
      deadlineMs,
    );
    try {
      admittedMember = {
        ...put,
        fileName: canonicalMember.fileName,
      };
      log(
        `Grand Hall member ${String(nextMissing.memberIndex + 1)}/${String(GRAND_HALL_FRONTIER_MEMBERS.length)} admitted to staging; no commit requested.`,
      );
    } catch (error) {
      throw reclassifiedIntakeError(
        error,
        "reconcile_admission",
        "EVIDENCE_FINALIZATION_FAILED",
      );
    }
  } else {
    log("All Grand Hall members are verified in staging; no upload or commit requested.");
  }

  try {
    const admittedCount = admittedMember === null ? 0 : 1;
    const existingMemberCountAfter = preflight.existingMemberCount + admittedCount;
    const uploadRequiredCountAfter = preflight.uploadRequiredCount - admittedCount;
    return {
      schemaVersion: "venviewer.grand-hall-frontier-source-admission-evidence.v1",
      mode: "admit_next_member",
      ...evidenceBase(args, preflight, now),
      admittedMember,
      progress: {
        existingMemberCountBefore: preflight.existingMemberCount,
        uploadRequiredCountBefore: preflight.uploadRequiredCount,
        existingMemberCountAfter,
        uploadRequiredCountAfter,
        allMembersVerified: uploadRequiredCountAfter === 0,
      },
      committed: false,
      registered: false,
    };
  } catch (error) {
    if (admittedMember !== null) {
      throw reclassifiedIntakeError(
        error,
        "reconcile_admission",
        "EVIDENCE_FINALIZATION_FAILED",
      );
    }
    throw error;
  }
}

async function runConditionalPutRehearsal(
  args: GrandHallRehearsalIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  memberZeroBytes: Buffer,
  fetchImpl: GrandHallIntakeFetch,
  deadlineMs: number,
  log: (line: string) => void,
  now: () => Date,
): Promise<GrandHallFrontierRehearsalEvidenceReceipt> {
  const serverEvidence = await requestConditionalPutRehearsal(
    args,
    tokenProvider,
    memberZeroBytes,
    fetchImpl,
    deadlineMs,
  );
  try {
    log("Grand Hall conditional-PUT rehearsal completed in one authenticated staging request.");
    return {
      schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v2",
      mode: "conditional_put_rehearsal",
      recordedAt: evidenceTimestamp(now),
      reviewedGitSha: args.reviewedGitSha,
      serverEvidence,
    };
  } catch (error) {
    throw reclassifiedIntakeError(
      error,
      "terminal_rehearsal",
      "EVIDENCE_FINALIZATION_FAILED",
    );
  }
}

function validatedHttpRequestDeadline(value: number | undefined): number {
  const deadlineMs = value ?? GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw intakeError("Grand Hall intake HTTP request deadline is invalid.");
  }
  return deadlineMs;
}

function completedOperationFailure(
  error: unknown,
  result: GrandHallFrontierIntakeResult,
): GrandHallFrontierIntakeCliError {
  const failureClass: GrandHallFrontierIntakeFailureClass = result.mode === "apply"
    ? "reconcile_apply"
    : result.mode === "conditional_put_rehearsal"
      ? "terminal_rehearsal"
      : result.mode === "admit_next_member" && result.admittedMember !== null
        ? "reconcile_admission"
        : "safe_to_retry";
  return reclassifiedIntakeError(
    error,
    failureClass,
    "EVIDENCE_FINALIZATION_FAILED",
  );
}

export async function runGrandHallFrontierIntake(
  options: RunGrandHallFrontierIntakeOptions,
): Promise<GrandHallFrontierIntakeResult> {
  const args = parseGrandHallFrontierIntakeArgs(options.args);
  const env = options.env ?? process.env;
  assertExpectedStagingApiOrigin(args.apiOrigin, env);
  const dependencies = options.dependencies ?? {};
  const inspectGitState = dependencies.inspectGitState ?? inspectGrandHallGitState;

  let gitState: GrandHallGitStateInspection;
  try {
    gitState = await inspectGitState(args.reviewedGitSha);
  } catch {
    throw intakeError("Reviewed Git state could not be established locally.");
  }
  assertGrandHallReviewedGitState(gitState, args.reviewedGitSha);

  let reservation: GrandHallEvidenceOutputReservation | null = null;
  try {
    const destination = await resolveGrandHallEvidenceDestination(
      args.outPath,
      gitState.repositoryRoot,
      dependencies.discoverEvidenceGitRoot ?? discoverContainingGitRoot,
    );
    reservation = await reserveGrandHallEvidenceOutput(destination);
    const relaySelection = env[GRAND_HALL_ADMIN_TOKEN_RELAY_ENV];
    if (
      relaySelection !== undefined &&
      relaySelection !== GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE
    ) {
      throw intakeError(
        `${GRAND_HALL_ADMIN_TOKEN_RELAY_ENV} must be absent or exactly ${GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE}.`,
      );
    }
    if (
      relaySelection === GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE &&
      env[GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV] !== undefined
    ) {
      throw intakeError("Choose either browser loopback relay or a process-local admin token, never both.");
    }
    const operatorLog = options.log ?? ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
    const receiveAdminToken = dependencies.receiveAdminTokenFromBrowser ??
      receiveGrandHallAdminTokenFromBrowser;
    const tokenProvider: GrandHallIntakeAdminTokenProvider =
      relaySelection === GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE
        ? () => receiveAdminToken({
            env,
            log: operatorLog,
          })
        : () => Promise.resolve(requiredAdminToken(env));
    const result = await executeGrandHallFrontierIntake(
      args,
      tokenProvider,
      dependencies,
      operatorLog,
    );
    try {
      await finalizeGrandHallEvidenceOutput(reservation, result);
    } catch (error) {
      throw completedOperationFailure(error, result);
    }
    return result;
  } catch (error) {
    if (
      reservation !== null &&
      !(await closeGrandHallEvidenceReservation(reservation))
    ) {
      if (error instanceof GrandHallFrontierIntakeCliError) throw error;
      throw intakeError("Grand Hall evidence output reservation close failed safely.");
    }
    throw error;
  }
}

async function executeGrandHallFrontierIntake(
  args: GrandHallFrontierIntakeArgs,
  tokenProvider: GrandHallIntakeAdminTokenProvider,
  dependencies: GrandHallFrontierIntakeDependencies,
  suppliedLog: ((line: string) => void) | undefined,
): Promise<GrandHallFrontierIntakeResult> {
  const inspectFrontier = dependencies.inspectFrontier ?? ((manifestPath: string) =>
    inspectLcc2HighestDetailFrontier({
      manifestPath,
      environmentPolicy: "exclude",
    }));
  const inspectLocalPath = dependencies.inspectLocalPath ?? defaultInspectLocalPath;
  const readLocalMember = dependencies.readLocalMember ?? readBoundedGrandHallMember;
  const verifyMemberBuffer = dependencies.verifyMemberBuffer ?? verifyGrandHallMemberBuffer;
  const fetchImpl = dependencies.fetchImpl ?? defaultFetch;
  const deadlineMs = validatedHttpRequestDeadline(dependencies.httpRequestDeadlineMs);
  const now = dependencies.now ?? (() => new Date());
  const log = suppliedLog ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });

  if (args.mode === "verify_disabled") {
    const verification = await requestDisabledVerification(
      args,
      tokenProvider,
      fetchImpl,
      deadlineMs,
    );
    try {
      log(`Grand Hall intake is disabled on target ${args.targetId}.`);
      return {
        schemaVersion: "venviewer.grand-hall-frontier-intake-disabled-evidence.v1",
        mode: "verify_disabled",
        recordedAt: evidenceTimestamp(now),
        reviewedGitSha: args.reviewedGitSha,
        targetId: args.targetId,
        apiOrigin: args.apiOrigin,
        ...verification,
        disabled: true,
      };
    } catch (error) {
      throw reclassifiedIntakeError(
        error,
        "safe_to_retry",
        "EVIDENCE_FINALIZATION_FAILED",
      );
    }
  }

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
  if (args.mode === "conditional_put_rehearsal") {
    const memberZeroBytes = await readRehearsalMemberBuffer(
      args,
      local,
    );
    return runConditionalPutRehearsal(
      args,
      tokenProvider,
      memberZeroBytes,
      fetchImpl,
      deadlineMs,
      log,
      now,
    );
  }
  const preflight = await requestPreflight(
    args,
    tokenProvider,
    fetchImpl,
    deadlineMs,
  );
  return args.mode === "apply"
    ? runApply(
        args,
        tokenProvider,
        preflight,
        fetchImpl,
        deadlineMs,
        log,
        now,
      )
    : runSourceAdmission(
        args,
        tokenProvider,
        preflight,
        local,
        fetchImpl,
        deadlineMs,
        log,
        now,
      );
}

export function serializeGrandHallFrontierEvidenceReceipt(
  result: GrandHallFrontierIntakeResult,
): string {
  return JSON.stringify(result);
}

export function grandHallFrontierEvidenceOutput(
  result: GrandHallFrontierIntakeResult,
): string {
  return `${serializeGrandHallFrontierEvidenceReceipt(result)}\n`;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

interface GrandHallEvidenceOutputReservation {
  readonly handle: FileHandle;
  closed: boolean;
}

function isPathInsideOrEqual(
  repositoryRoot: string,
  candidatePath: string,
): boolean {
  const candidateRelativePath = relative(repositoryRoot, candidatePath);
  const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`;
  return candidateRelativePath === "" || (
    !isAbsolute(candidateRelativePath) &&
    candidateRelativePath !== ".." &&
    !candidateRelativePath.startsWith(parentPrefix)
  );
}

async function resolveGrandHallEvidenceDestination(
  outPath: string,
  repositoryRoot: string,
  discoverEvidenceGitRoot: (directory: string) => Promise<string | null>,
): Promise<string> {
  let canonicalParent: string;
  try {
    canonicalParent = await realpath(dirname(resolve(outPath)));
  } catch {
    throw intakeError("Grand Hall evidence output parent is unavailable or unwritable.");
  }
  const destination = resolve(canonicalParent, basename(outPath));
  if (isPathInsideOrEqual(repositoryRoot, destination)) {
    throw intakeError("Grand Hall evidence output must be outside the reviewed Git worktree.");
  }
  if (await discoverEvidenceGitRoot(canonicalParent) !== null) {
    throw intakeError("Grand Hall evidence output must be outside every Git worktree.");
  }
  return destination;
}

async function reserveGrandHallEvidenceOutput(
  destination: string,
): Promise<GrandHallEvidenceOutputReservation> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(destination, "wx", 0o600);
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== 0) {
      throw intakeError("Grand Hall evidence output reservation is not an empty regular file.");
    }
    return { handle, closed: false };
  } catch (error) {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        throw intakeError("Grand Hall evidence output reservation close failed safely.");
      }
    }
    if (error instanceof GrandHallFrontierIntakeCliError) throw error;
    if (isNodeErrorCode(error, "EEXIST")) {
      throw intakeError("Grand Hall evidence output already exists; refusing overwrite.");
    }
    throw intakeError("Grand Hall evidence output could not be reserved safely.");
  }
}

async function closeGrandHallEvidenceReservation(
  reservation: GrandHallEvidenceOutputReservation,
): Promise<boolean> {
  if (reservation.closed) return true;
  try {
    await reservation.handle.close();
    reservation.closed = true;
    return true;
  } catch {
    return false;
  }
}

export async function writeGrandHallFrontierEvidenceOutputAtomic(
  outPath: string,
  result: GrandHallFrontierIntakeResult,
): Promise<void> {
  const reservation = await reserveGrandHallEvidenceOutput(resolve(outPath));
  try {
    await finalizeGrandHallEvidenceOutput(reservation, result);
  } catch (error) {
    if (!(await closeGrandHallEvidenceReservation(reservation))) {
      throw intakeError("Grand Hall evidence output reservation close failed safely.");
    }
    throw error;
  }
}

async function finalizeGrandHallEvidenceOutput(
  reservation: GrandHallEvidenceOutputReservation,
  result: GrandHallFrontierIntakeResult,
): Promise<void> {
  const output = grandHallFrontierEvidenceOutput(result);
  try {
    await reservation.handle.writeFile(output, "utf8");
    await reservation.handle.sync();
    if (!(await closeGrandHallEvidenceReservation(reservation))) {
      throw intakeError("Grand Hall evidence output reservation close failed safely.");
    }
  } catch (error) {
    if (error instanceof GrandHallFrontierIntakeCliError) throw error;
    throw intakeError("Grand Hall evidence output could not be finalized safely.");
  }
}

export function grandHallFrontierIntakeFailureOutput(error: unknown): string {
  const source = error instanceof GrandHallFrontierIntakeCliError
    ? error.failure
    : null;
  if (
    source === null ||
    !GRAND_HALL_INTAKE_FAILURE_CLASS_SET.has(source.class) ||
    !isGrandHallIntakeFailureCode(source.code)
  ) {
    return `${JSON.stringify({
      class: "stop",
      code: "UNEXPECTED_FAILURE",
    } satisfies GrandHallFrontierIntakeFailureReport)}\n`;
  }

  const status = source.status === undefined
    ? undefined
    : safeResponseStatus(source.status);
  const safeRetryAfter = source.retryAfterSeconds;
  const mayRetry = source.class === "safe_to_retry" ||
    source.class === "reconcile_admission" ||
    source.class === "reconcile_apply";
  const retryAfter = mayRetry && safeRetryAfter !== undefined &&
      Number.isSafeInteger(safeRetryAfter) &&
      safeRetryAfter >= 0 &&
      safeRetryAfter <= 3_600
    ? safeRetryAfter
    : undefined;
  const report: GrandHallFrontierIntakeFailureReport = {
    class: source.class,
    code: source.code,
    ...(status === undefined ? {} : { status }),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
  return `${JSON.stringify(report)}\n`;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

async function runDirectGrandHallFrontierIntake(): Promise<void> {
  const directArgs = process.argv.slice(2);
  const result = await runGrandHallFrontierIntake({
    args: directArgs,
    log: (line: string): void => {
      process.stderr.write(`${line}\n`);
    },
  });
  const output = grandHallFrontierEvidenceOutput(result);
  process.stdout.write(output);
}

if (isDirectRun()) {
  runDirectGrandHallFrontierIntake().then(
    () => {
      process.exitCode = 0;
    },
    (error: unknown) => {
      process.stderr.write(grandHallFrontierIntakeFailureOutput(error));
      process.exitCode = 1;
    },
  );
}
