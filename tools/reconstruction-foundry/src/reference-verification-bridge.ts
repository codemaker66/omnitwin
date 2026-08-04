import { createHash, randomBytes } from "node:crypto";
import { constants as filesystemConstants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  FoundryUniversalIntakeReceiptSchema,
  admitUniversalIntakeReceipt,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
} from "@omnitwin/types";
import type {
  ReferenceVerificationAdmittedFileV0,
  ReferenceVerificationAdmittedSubjectV0,
  ReferenceVerificationSourceKindV0,
} from "./reference-verification-job.js";

export const REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0 =
  "reference-integrity-verification-v0";
export const REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0 =
  "record-authentication.key";
export const REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0 = 32;
export const REFERENCE_VERIFICATION_LOCAL_TRUST_BOUNDARY_V0 =
  "local_os_user_profile";
export const REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0 =
  "omnitwin-reconstruction-foundry-private-state-v0";

const PREFIXED_SHA256_PATTERN = /^sha256:(?<digest>[a-f0-9]{64})$/u;
const KEY_SCHEMA = "omnitwin.reference-integrity-record-authentication/v0";
const KEY_CREATE_RETRY_COUNT = 100;
const KEY_CREATE_RETRY_DELAY_MS = 5;
const CUSTOM_INSPECT = Symbol.for("nodejs.util.inspect.custom");
const SOURCE_IDENTITY_SCHEMA = "omnitwin.reference-verification-source-identity/v0";
const KEY_TEMP_FILE_PATTERN = /^\.record-authentication\.key\.(?<pid>[1-9][0-9]{0,9})\.(?<nonce>[a-f0-9]{32})\.partial$/u;
const MAX_RECOGNIZED_ABANDONED_KEY_TEMPS = 64;
const ACTIVE_KEY_TEMP_PATHS = new Set<string>();

export class ReferenceVerificationBridgeErrorV0 extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReferenceVerificationBridgeErrorV0";
    this.code = code;
  }
}

export interface BuildReferenceVerificationAdmittedSubjectOptionsV0 {
  /** The exact source argument trusted by the already-running local app. */
  readonly source: string;
  /** Opaque server-closure state captured for this exact intake session. */
  readonly trustedStartupSourceIdentity: ReferenceVerificationSourceIdentityV0;
  readonly receipt: unknown;
  readonly admissionDraft: unknown;
}

export interface ReferenceVerificationSourceIdentityV0 {
  readonly schemaVersion: typeof SOURCE_IDENTITY_SCHEMA;
  readonly kind: ReferenceVerificationSourceKindV0;
  readonly dev: string;
  readonly inode: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly ctimeNs: string;
  readonly canonicalPathSha256: string;
}

export interface LoadReferenceVerificationRecordAuthenticationOptionsV0 {
  /** An existing, server-selected, user-private state root. */
  readonly privateStateRoot: string;
  /** The same exact startup source used to build the intake receipt. */
  readonly source: string;
  /** @internal Deterministic filesystem race hooks used only by focused tests. */
  readonly testHooks?: ReferenceVerificationRecordAuthenticationTestHooksV0;
}

export interface PrepareDefaultReferenceVerificationPrivateStateRootOptionsV0 {
  /** The exact startup source; it is inspected read-only before any state write. */
  readonly source: string;
  /** An already-existing profile base selected by trusted server code. */
  readonly trustedProfileBase: string;
  /** @internal Deterministic replacement-race hooks used only by focused tests. */
  readonly testHooks?: {
    readonly afterBaseInspectionBeforeRecheck?: () => Promise<void> | void;
    readonly afterChildReadyBeforeFinalRecheck?: () => Promise<void> | void;
  };
}

export interface ReferenceVerificationRecordAuthenticationTestHooksV0 {
  readonly afterPrivateNamespacePreparedBeforeRootRecheck?: () => Promise<void> | void;
  readonly afterTempFileSyncBeforePublish?: () => Promise<void> | void;
  readonly afterAtomicPublishBeforeNamespaceSync?: () => Promise<void> | void;
  readonly afterKeyPathInspectionBeforeOpen?: () => Promise<void> | void;
  readonly afterKeyBytesReadBeforePathRecheck?: () => Promise<void> | void;
  readonly onConcurrentReadRetry?: (code: string) => Promise<void> | void;
}

export interface ReferenceVerificationRecordAuthenticationJsonV0 {
  readonly schemaVersion: typeof KEY_SCHEMA;
  readonly keyId: string;
  readonly trustBoundary: typeof REFERENCE_VERIFICATION_LOCAL_TRUST_BOUNDARY_V0;
}

/**
 * Holds the local record-authentication secret without making it enumerable or
 * serializable. `keyId` is deliberately public and non-secret: it is only the
 * SHA-256 identity of a random 32-byte key.
 *
 * The key's security boundary is the local OS user/profile. In particular,
 * Node's POSIX-like mode argument on Windows does not establish or audit a
 * private DACL. The caller must supply a state root whose inherited Windows
 * ACL already limits access to the intended user/profile.
 */
export class ReferenceVerificationRecordAuthenticationV0 {
  public readonly keyId: string;
  public readonly trustBoundary = REFERENCE_VERIFICATION_LOCAL_TRUST_BOUNDARY_V0;
  readonly #keyBytes: Buffer;

  public constructor(keyBytes: Uint8Array) {
    if (keyBytes.byteLength !== REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0) {
      throw new ReferenceVerificationBridgeErrorV0(
        "REFERENCE_AUTHENTICATION_KEY_LENGTH_INVALID",
        "The local record-authentication key must be exactly 32 bytes.",
      );
    }
    this.#keyBytes = Buffer.from(keyBytes);
    this.keyId = `sha256:${createHash("sha256").update(this.#keyBytes).digest("hex")}`;
    Object.freeze(this);
  }

  /** Returns a defensive copy for the in-process verification coordinator. */
  public copyKeyBytes(): Uint8Array {
    return Uint8Array.from(this.#keyBytes);
  }

  public toJSON(): ReferenceVerificationRecordAuthenticationJsonV0 {
    return {
      schemaVersion: KEY_SCHEMA,
      keyId: this.keyId,
      trustBoundary: this.trustBoundary,
    };
  }

  public toString(): string {
    return `[ReferenceVerificationRecordAuthenticationV0 keyId=${this.keyId} trustBoundary=${this.trustBoundary}]`;
  }

  public [CUSTOM_INSPECT](): string {
    return this.toString();
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new ReferenceVerificationBridgeErrorV0(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function comparePath(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function isPathWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparablePath(root), comparablePath(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameDirectoryObject(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isDirectory() &&
    right.isDirectory()
  );
}

function foldedPath(path: string): string {
  return path.toLocaleLowerCase("en-US");
}

function barePrefixedSha256(value: string, label: string): string {
  const match = PREFIXED_SHA256_PATTERN.exec(value);
  const digest = match?.groups?.digest;
  if (digest === undefined) {
    return fail(
      "REFERENCE_ADMISSION_PREFIXED_DIGEST_INVALID",
      `${label} must use the exact sha256:<64 lowercase hex> form.`,
    );
  }
  return digest;
}

function assertNoCaseCollisions(paths: readonly string[], label: string): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const folded = foldedPath(path);
    const prior = seen.get(folded);
    if (prior !== undefined) {
      return fail(
        "REFERENCE_ADMISSION_CASE_COLLISION",
        `${label} contains paths that collide on a case-insensitive filesystem: "${prior}" and "${path}".`,
      );
    }
    seen.set(folded, path);
  }
}

function sourceIdentityFromMetadata(
  metadata: BigIntStats,
  kind: ReferenceVerificationSourceKindV0,
  canonicalPath: string,
): ReferenceVerificationSourceIdentityV0 {
  return Object.freeze({
    schemaVersion: SOURCE_IDENTITY_SCHEMA,
    kind,
    dev: metadata.dev.toString(10),
    inode: metadata.ino.toString(10),
    size: metadata.size.toString(10),
    mtimeNs: metadata.mtimeNs.toString(10),
    ctimeNs: metadata.ctimeNs.toString(10),
    canonicalPathSha256: createHash("sha256")
      .update("OMNITWIN.REFERENCE_SOURCE_PATH.V0", "ascii")
      .update(Buffer.from([0]))
      .update(comparablePath(canonicalPath), "utf8")
      .digest("hex"),
  });
}

function isDecimalBigIntString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function parseTrustedSourceIdentity(
  value: unknown,
): ReferenceVerificationSourceIdentityV0 {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("\0") !==
      [
        "canonicalPathSha256",
        "ctimeNs",
        "dev",
        "inode",
        "kind",
        "mtimeNs",
        "schemaVersion",
        "size",
      ].sort().join("\0")
  ) {
    return fail(
      "REFERENCE_SOURCE_IDENTITY_INVALID",
      "The trusted startup source identity is missing or malformed.",
    );
  }
  const identity = value as Record<string, unknown>;
  if (
    identity.schemaVersion !== SOURCE_IDENTITY_SCHEMA ||
    (identity.kind !== "file" && identity.kind !== "directory") ||
    !isDecimalBigIntString(identity.dev) ||
    !isDecimalBigIntString(identity.inode) ||
    !isDecimalBigIntString(identity.size) ||
    !isDecimalBigIntString(identity.mtimeNs) ||
    !isDecimalBigIntString(identity.ctimeNs) ||
    typeof identity.canonicalPathSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(identity.canonicalPathSha256)
  ) {
    return fail(
      "REFERENCE_SOURCE_IDENTITY_INVALID",
      "The trusted startup source identity is missing or malformed.",
    );
  }
  return Object.freeze({
    schemaVersion: SOURCE_IDENTITY_SCHEMA,
    kind: identity.kind,
    dev: identity.dev,
    inode: identity.inode,
    size: identity.size,
    mtimeNs: identity.mtimeNs,
    ctimeNs: identity.ctimeNs,
    canonicalPathSha256: identity.canonicalPathSha256,
  });
}

function sameSourceIdentity(
  left: ReferenceVerificationSourceIdentityV0,
  right: ReferenceVerificationSourceIdentityV0,
): boolean {
  return (
    left.kind === right.kind &&
    left.dev === right.dev &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.canonicalPathSha256 === right.canonicalPathSha256
  );
}

async function inspectCanonicalSource(
  source: string,
): Promise<{
  readonly canonicalPath: string;
  readonly kind: ReferenceVerificationSourceKindV0;
  readonly identity: ReferenceVerificationSourceIdentityV0;
}> {
  if (typeof source !== "string" || source.trim().length === 0 || source.includes("\0")) {
    return fail(
      "REFERENCE_SOURCE_INVALID",
      "The verification source must be the exact non-empty local startup path.",
    );
  }
  if (process.platform === "win32" && source.replaceAll("/", "\\").startsWith("\\\\")) {
    return fail(
      "REFERENCE_SOURCE_REMOTE_OR_DEVICE_PATH",
      "UNC and device paths are outside the local verification trust boundary.",
    );
  }
  const requestedPath = resolve(source);
  let requestedBefore: BigIntStats;
  let canonicalPath: string;
  let canonicalMetadata: BigIntStats;
  let requestedAfter: BigIntStats;
  try {
    requestedBefore = await lstat(requestedPath, { bigint: true });
    if (requestedBefore.isSymbolicLink()) {
      return fail(
        "REFERENCE_SOURCE_INDIRECT_PATH",
        "The verification source cannot be a symbolic link, junction, or other indirect path.",
      );
    }
    canonicalPath = await realpath(requestedPath);
    canonicalMetadata = await lstat(canonicalPath, { bigint: true });
    requestedAfter = await lstat(requestedPath, { bigint: true });
  } catch (error) {
    if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
    return fail(
      "REFERENCE_SOURCE_UNAVAILABLE",
      "The exact startup source is unavailable or cannot be inspected safely.",
      error,
    );
  }
  if (
    !samePath(requestedPath, canonicalPath) ||
    canonicalMetadata.isSymbolicLink() ||
    requestedAfter.isSymbolicLink()
  ) {
    return fail(
      "REFERENCE_SOURCE_INDIRECT_PATH",
      "The verification source or one of its ancestors resolves through a symbolic link, junction, or reparse path.",
    );
  }
  if (
    !sameFileIdentity(requestedBefore, requestedAfter) ||
    !sameFileIdentity(requestedAfter, canonicalMetadata)
  ) {
    return fail(
      "REFERENCE_SOURCE_CHANGED",
      "The startup source changed while the verification bridge inspected it.",
    );
  }
  if (canonicalMetadata.isFile()) {
    return {
      canonicalPath,
      kind: "file",
      identity: sourceIdentityFromMetadata(canonicalMetadata, "file", canonicalPath),
    };
  }
  if (canonicalMetadata.isDirectory()) {
    return {
      canonicalPath,
      kind: "directory",
      identity: sourceIdentityFromMetadata(canonicalMetadata, "directory", canonicalPath),
    };
  }
  return fail(
    "REFERENCE_SOURCE_KIND_INVALID",
    "The verification source must be one regular file or one directory.",
  );
}

/**
 * Captures opaque intake-session source identity for server closure state. It
 * deliberately contains no source path and must never be sent to the browser.
 */
export async function captureReferenceVerificationSourceIdentityV0(
  source: string,
): Promise<ReferenceVerificationSourceIdentityV0> {
  return (await inspectCanonicalSource(source)).identity;
}

/**
 * Converts an exact, validated receipt and compiled guided admission into the
 * byte-only subject accepted by the read-only verifier. This function grants no
 * rights, execution authority, staging authority, or reconstruction authority.
 */
export async function buildReferenceVerificationAdmittedSubjectV0(
  options: BuildReferenceVerificationAdmittedSubjectOptionsV0,
): Promise<ReferenceVerificationAdmittedSubjectV0> {
  const receiptResult = FoundryUniversalIntakeReceiptSchema.safeParse(options.receipt);
  if (!receiptResult.success) {
    return fail(
      "REFERENCE_RECEIPT_INVALID",
      "The intake receipt is invalid or its self-digest no longer matches.",
    );
  }
  if (
    typeof options.admissionDraft !== "object" ||
    options.admissionDraft === null ||
    !("review" in options.admissionDraft) ||
    !("result" in options.admissionDraft)
  ) {
    return fail(
      "REFERENCE_ADMISSION_DRAFT_INVALID",
      "A compiled guided admission review and result are required.",
    );
  }
  const reviewResult = FoundryIntakeAdmissionReviewV0Schema.safeParse(
    options.admissionDraft.review,
  );
  const admissionResult = FoundryIntakeAdmissionResultV0Schema.safeParse(
    options.admissionDraft.result,
  );
  if (!reviewResult.success || !admissionResult.success) {
    return fail(
      "REFERENCE_ADMISSION_DRAFT_INVALID",
      "The guided admission review or result is invalid or its self-digest no longer matches.",
    );
  }

  const receipt = receiptResult.data;
  const review = reviewResult.data;
  const result = admissionResult.data;
  if (
    review.receiptSha256 !== receipt.receiptSha256 ||
    result.receiptSha256 !== receipt.receiptSha256 ||
    result.reviewSha256 !== review.reviewSha256
  ) {
    return fail(
      "REFERENCE_ADMISSION_STALE_DIGEST",
      "The receipt, review, and admission result do not belong to the same exact admission.",
    );
  }

  let expectedResult: typeof result;
  try {
    expectedResult = admitUniversalIntakeReceipt(receipt, review);
  } catch (error) {
    return fail(
      "REFERENCE_ADMISSION_RECOMPILE_FAILED",
      "The admission can no longer be reproduced from its exact receipt and review.",
      error,
    );
  }
  if (
    stableCanonicalJson(toCanonicalJson(expectedResult)) !==
    stableCanonicalJson(toCanonicalJson(result))
  ) {
    return fail(
      "REFERENCE_ADMISSION_RESULT_MISMATCH",
      "The admission result is not the exact deterministic result of this receipt and review.",
    );
  }

  const trustedStartupSourceIdentity = parseTrustedSourceIdentity(
    options.trustedStartupSourceIdentity,
  );
  const source = await inspectCanonicalSource(options.source);
  if (!sameSourceIdentity(trustedStartupSourceIdentity, source.identity)) {
    return fail(
      "REFERENCE_SOURCE_IDENTITY_MISMATCH",
      "The current source is not the exact filesystem object captured for this intake session.",
    );
  }
  const expectedSourceLabel = basename(source.canonicalPath);
  if (source.kind !== receipt.source.kind || expectedSourceLabel !== receipt.source.label) {
    return fail(
      "REFERENCE_SOURCE_RECEIPT_MISMATCH",
      "The exact startup source kind or label does not match the validated intake receipt.",
    );
  }

  assertNoCaseCollisions(
    receipt.files.map((file) => file.path),
    "The receipt",
  );
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const admittedDecisions = review.decisions.filter((decision) => decision.action === "admit");
  if (admittedDecisions.length === 0 || result.manifest.assets.length === 0) {
    return fail(
      "REFERENCE_ADMISSION_EMPTY",
      "At least one exactly admitted manifest asset is required for verification.",
    );
  }
  const admittedDecisionPaths = admittedDecisions.map((decision) => decision.path);
  const manifestPaths = result.manifest.assets.map((asset) => asset.relativePath);
  assertNoCaseCollisions(admittedDecisionPaths, "The admitted review decisions");
  assertNoCaseCollisions(manifestPaths, "The admitted manifest assets");

  const decisionByPath = new Map(admittedDecisions.map((decision) => [decision.path, decision] as const));
  if (decisionByPath.size !== admittedDecisions.length) {
    return fail(
      "REFERENCE_ADMISSION_DUPLICATE_PATH",
      "The admission review contains the same admitted path more than once.",
    );
  }
  const manifestByPath = new Map(
    result.manifest.assets.map((asset) => [asset.relativePath, asset] as const),
  );
  if (manifestByPath.size !== result.manifest.assets.length) {
    return fail(
      "REFERENCE_ADMISSION_DUPLICATE_PATH",
      "The admission manifest contains the same admitted path more than once.",
    );
  }
  for (const path of decisionByPath.keys()) {
    if (!manifestByPath.has(path)) {
      return fail(
        "REFERENCE_ADMISSION_ASSET_MISSING",
        `The admitted review path "${path}" is missing from the manifest.`,
      );
    }
  }
  for (const path of manifestByPath.keys()) {
    if (!decisionByPath.has(path)) {
      return fail(
        "REFERENCE_ADMISSION_ASSET_EXTRA",
        `The manifest path "${path}" was not admitted by the review.`,
      );
    }
  }

  const files: ReferenceVerificationAdmittedFileV0[] = result.manifest.assets.map((asset) => {
    const receiptFile = receiptByPath.get(asset.relativePath);
    const decision = decisionByPath.get(asset.relativePath);
    if (receiptFile === undefined || decision === undefined) {
      return fail(
        "REFERENCE_ADMISSION_PATH_MISMATCH",
        `Manifest asset "${asset.relativePath}" is not an exact admitted receipt path.`,
      );
    }
    if (decision.asset.id !== asset.id || decision.asset.relativePath !== asset.relativePath) {
      return fail(
        "REFERENCE_ADMISSION_ASSET_IDENTITY_MISMATCH",
        `Manifest asset "${asset.relativePath}" does not match its admitted review identity.`,
      );
    }
    const assetSha256 = barePrefixedSha256(asset.sha256, `Asset "${asset.relativePath}" SHA-256`);
    if (
      asset.sizeBytes !== receiptFile.sizeBytes ||
      assetSha256 !== receiptFile.sha256
    ) {
      return fail(
        "REFERENCE_ADMISSION_BYTE_IDENTITY_MISMATCH",
        `Manifest asset "${asset.relativePath}" does not match the receipt size and SHA-256.`,
      );
    }
    return {
      relativePath: receiptFile.path,
      sizeBytes: receiptFile.sizeBytes,
      sha256: receiptFile.sha256,
    };
  }).sort((left, right) => comparePath(left.relativePath, right.relativePath));

  if (source.kind === "file") {
    if (files.length !== 1 || files[0]?.relativePath !== receipt.source.label) {
      return fail(
        "REFERENCE_FILE_SOURCE_ASSET_MISMATCH",
        "A single-file source must admit that exact receipt-labelled file and no other asset.",
      );
    }
  }

  return Object.freeze({
    sourceKind: source.kind,
    canonicalSourcePath: source.canonicalPath,
    receiptSha256: receipt.receiptSha256,
    reviewSha256: barePrefixedSha256(review.reviewSha256, "Admission review SHA-256"),
    admissionResultSha256: barePrefixedSha256(result.resultSha256, "Admission result SHA-256"),
    manifestSha256: barePrefixedSha256(result.manifestSha256, "Admission manifest SHA-256"),
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  });
}

async function inspectExistingPrivateDirectory(
  requestedInput: string,
  label: string,
  options: {
    readonly requirePrivatePermissions?: boolean;
    readonly requireExactMode0700?: boolean;
  } = {},
): Promise<{ readonly canonicalPath: string; readonly metadata: BigIntStats }> {
  if (
    typeof requestedInput !== "string" ||
    requestedInput.trim().length === 0 ||
    requestedInput.includes("\0")
  ) {
    return fail("REFERENCE_PRIVATE_STATE_INVALID", `${label} must be an existing local directory.`);
  }
  const requestedPath = resolve(requestedInput);
  if (
    process.platform === "win32" &&
    (
      requestedInput.replaceAll("/", "\\").startsWith("\\\\") ||
      requestedPath.replaceAll("/", "\\").startsWith("\\\\")
    )
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_REMOTE_OR_DEVICE_PATH",
      `${label} cannot use an identifiable UNC, device, or remote path.`,
    );
  }
  let before: BigIntStats;
  let canonicalPath: string;
  let canonicalMetadata: BigIntStats;
  let after: BigIntStats;
  try {
    before = await lstat(requestedPath, { bigint: true });
    if (before.isSymbolicLink()) {
      return fail(
        "REFERENCE_PRIVATE_STATE_INDIRECT_PATH",
        `${label} cannot be a symbolic link, junction, or reparse path.`,
      );
    }
    canonicalPath = await realpath(requestedPath);
    canonicalMetadata = await lstat(canonicalPath, { bigint: true });
    after = await lstat(requestedPath, { bigint: true });
  } catch (error) {
    if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
    return fail(
      "REFERENCE_PRIVATE_STATE_UNAVAILABLE",
      `${label} is unavailable or cannot be inspected safely.`,
      error,
    );
  }
  if (
    !samePath(requestedPath, canonicalPath) ||
    before.isSymbolicLink() ||
    after.isSymbolicLink() ||
    canonicalMetadata.isSymbolicLink()
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_INDIRECT_PATH",
      `${label} or one of its ancestors resolves through a symbolic link, junction, or reparse path.`,
    );
  }
  if (
    !before.isDirectory() ||
    !after.isDirectory() ||
    !canonicalMetadata.isDirectory() ||
    !sameDirectoryObject(before, after) ||
    !sameDirectoryObject(after, canonicalMetadata)
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_CHANGED",
      `${label} is not one stable existing directory.`,
    );
  }
  if (
    process.platform !== "win32" &&
    options.requirePrivatePermissions !== false &&
    (canonicalMetadata.mode & 0o077n) !== 0n
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_PERMISSIONS",
      `${label} grants group or other-user access; use a user-private directory.`,
    );
  }
  if (
    process.platform !== "win32" &&
    options.requireExactMode0700 === true &&
    (canonicalMetadata.mode & 0o777n) !== 0o700n
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_PERMISSIONS",
      `${label} must have exact owner-only directory permissions (0700).`,
    );
  }
  return { canonicalPath, metadata: canonicalMetadata };
}

function assertSourceStateDisjoint(sourcePath: string, stateRoot: string): void {
  if (isPathWithin(sourcePath, stateRoot) || isPathWithin(stateRoot, sourcePath)) {
    return fail(
      "REFERENCE_SOURCE_STATE_OVERLAP",
      "The private verification state and capture source must be in separate, non-overlapping locations.",
    );
  }
}

async function pathEntryExistsNoFollow(path: string): Promise<boolean> {
  try {
    await lstat(path, { bigint: true });
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    return fail(
      "REFERENCE_PRIVATE_STATE_UNAVAILABLE",
      "The default private state path could not be inspected safely.",
      error,
    );
  }
}

function assertSameDirectoryObject(
  expected: { readonly canonicalPath: string; readonly metadata: BigIntStats },
  observed: { readonly canonicalPath: string; readonly metadata: BigIntStats },
  code: string,
  message: string,
): void {
  if (
    !samePath(expected.canonicalPath, observed.canonicalPath) ||
    !sameDirectoryObject(expected.metadata, observed.metadata)
  ) {
    return fail(code, message);
  }
}

/**
 * Safely creates or validates one fixed app-private child beneath an existing
 * trusted profile base. It never recursively creates parents, follows links,
 * or chmods an existing path. Source/base canonicalization and source/child
 * disjointness are proven before the first possible write.
 *
 * The caller selects the platform profile base: existing LOCALAPPDATA on
 * Windows, existing ~/Library/Application Support on macOS, or an existing
 * XDG state/home base on other POSIX systems. On Windows, inherited DACLs are
 * still the explicit local-user trust boundary because Node mode bits cannot
 * establish or audit them.
 */
export async function prepareDefaultReferenceVerificationPrivateStateRootV0(
  options: PrepareDefaultReferenceVerificationPrivateStateRootOptionsV0,
): Promise<string> {
  if (!isAbsolute(options.trustedProfileBase)) {
    return fail(
      "REFERENCE_DEFAULT_PRIVATE_STATE_BASE_NOT_ABSOLUTE",
      "The trusted profile base must be an existing absolute path.",
    );
  }
  const source = await inspectCanonicalSource(options.source);
  const baseBefore = await inspectExistingPrivateDirectory(
    options.trustedProfileBase,
    "The trusted profile base",
    { requirePrivatePermissions: false },
  );
  const childPath = join(
    baseBefore.canonicalPath,
    REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
  );
  assertSourceStateDisjoint(source.canonicalPath, childPath);

  await options.testHooks?.afterBaseInspectionBeforeRecheck?.();
  const baseBeforeAction = await inspectExistingPrivateDirectory(
    baseBefore.canonicalPath,
    "The trusted profile base",
    { requirePrivatePermissions: false },
  );
  assertSameDirectoryObject(
    baseBefore,
    baseBeforeAction,
    "REFERENCE_DEFAULT_PRIVATE_STATE_BASE_CHANGED",
    "The trusted profile base changed before the private state folder could be prepared.",
  );

  if (!(await pathEntryExistsNoFollow(childPath))) {
    try {
      await mkdir(childPath, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        return fail(
          "REFERENCE_DEFAULT_PRIVATE_STATE_CREATE_FAILED",
          "The one app-private state folder could not be created safely.",
          error,
        );
      }
    }
  }
  const childBeforeFinalCheck = await inspectExistingPrivateDirectory(
    childPath,
    "The default app-private state folder",
    { requireExactMode0700: true },
  );
  if (!isPathWithin(baseBefore.canonicalPath, childBeforeFinalCheck.canonicalPath)) {
    return fail(
      "REFERENCE_DEFAULT_PRIVATE_STATE_ESCAPE",
      "The app-private state folder escapes its trusted profile base.",
    );
  }
  assertSourceStateDisjoint(source.canonicalPath, childBeforeFinalCheck.canonicalPath);

  await options.testHooks?.afterChildReadyBeforeFinalRecheck?.();
  const [baseAfter, childAfter] = await Promise.all([
    inspectExistingPrivateDirectory(
      baseBefore.canonicalPath,
      "The trusted profile base",
      { requirePrivatePermissions: false },
    ),
    inspectExistingPrivateDirectory(
      childBeforeFinalCheck.canonicalPath,
      "The default app-private state folder",
      { requireExactMode0700: true },
    ),
  ]);
  assertSameDirectoryObject(
    baseBefore,
    baseAfter,
    "REFERENCE_DEFAULT_PRIVATE_STATE_BASE_CHANGED",
    "The trusted profile base changed while the private state folder was prepared.",
  );
  assertSameDirectoryObject(
    childBeforeFinalCheck,
    childAfter,
    "REFERENCE_DEFAULT_PRIVATE_STATE_CHILD_CHANGED",
    "The app-private state folder changed while it was prepared.",
  );
  return childAfter.canonicalPath;
}

async function ensurePrivateNamespace(
  privateStateRoot: string,
): Promise<{ readonly canonicalPath: string; readonly metadata: BigIntStats }> {
  const namespacePath = join(privateStateRoot, REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0);
  try {
    await mkdir(namespacePath, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      return fail(
        "REFERENCE_PRIVATE_NAMESPACE_CREATE_FAILED",
        "The server-owned verification namespace could not be created.",
        error,
      );
    }
  }
  const inspectedNamespace = await inspectExistingPrivateDirectory(
    namespacePath,
    "The server-owned verification namespace",
  );
  const canonicalNamespace = inspectedNamespace.canonicalPath;
  if (!isPathWithin(privateStateRoot, canonicalNamespace)) {
    return fail(
      "REFERENCE_PRIVATE_NAMESPACE_ESCAPE",
      "The server-owned verification namespace escapes its private state root.",
    );
  }
  return inspectedNamespace;
}

async function readExactPrivateKey(
  keyPath: string,
  namespacePath: string,
  testHooks?: ReferenceVerificationRecordAuthenticationTestHooksV0,
): Promise<Buffer> {
  let pathMetadata: BigIntStats;
  let canonicalKeyPath: string;
  try {
    pathMetadata = await lstat(keyPath, { bigint: true });
    if (pathMetadata.isSymbolicLink()) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_INDIRECT_PATH",
        "The record-authentication key cannot be a symbolic link or reparse path.",
      );
    }
    canonicalKeyPath = await realpath(keyPath);
  } catch (error) {
    if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_UNAVAILABLE",
      "The record-authentication key cannot be opened safely.",
      error,
    );
  }
  if (
    !samePath(keyPath, canonicalKeyPath) ||
    !isPathWithin(namespacePath, canonicalKeyPath)
  ) {
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_INDIRECT_PATH",
      "The record-authentication key resolves outside its fixed server-owned path.",
    );
  }

  const noFollowReadFlags = process.platform === "win32"
    ? filesystemConstants.O_RDONLY
    : filesystemConstants.O_RDONLY | filesystemConstants.O_NOFOLLOW;
  let handle;
  let readBuffer: Buffer | undefined;
  try {
    await testHooks?.afterKeyPathInspectionBeforeOpen?.();
    handle = await open(keyPath, noFollowReadFlags);
    const openedBefore = await handle.stat({ bigint: true });
    if (
      !pathMetadata.isFile() ||
      !openedBefore.isFile() ||
      pathMetadata.isSymbolicLink() ||
      !sameFileIdentity(pathMetadata, openedBefore) ||
      openedBefore.nlink !== 1n
    ) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_IDENTITY_INVALID",
        "The record-authentication key is not one stable private regular file.",
      );
    }
    if (process.platform !== "win32" && (openedBefore.mode & 0o077n) !== 0n) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_PERMISSIONS",
        "The record-authentication key grants group or other-user access.",
      );
    }
    if (
      openedBefore.size !== BigInt(REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0)
    ) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_LENGTH_INVALID",
        "The persisted record-authentication key is not exactly 32 bytes.",
      );
    }
    readBuffer = Buffer.alloc(REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0 + 1);
    const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, 0);
    const openedAfter = await handle.stat({ bigint: true });
    if (
      bytesRead !== REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0 ||
      !sameFileIdentity(openedBefore, openedAfter)
    ) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_CHANGED",
        "The record-authentication key changed while it was read.",
      );
    }
    await testHooks?.afterKeyBytesReadBeforePathRecheck?.();
    let pathAfterRead: BigIntStats;
    let canonicalPathAfterRead: string;
    try {
      pathAfterRead = await lstat(keyPath, { bigint: true });
      canonicalPathAfterRead = await realpath(keyPath);
    } catch (error) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_CHANGED",
        "The fixed record-authentication key path changed while it was read.",
        error,
      );
    }
    if (
      pathAfterRead.isSymbolicLink() ||
      !pathAfterRead.isFile() ||
      !samePath(keyPath, canonicalPathAfterRead) ||
      !isPathWithin(namespacePath, canonicalPathAfterRead) ||
      !sameFileIdentity(openedAfter, pathAfterRead)
    ) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_CHANGED",
        "The fixed record-authentication key path changed while it was read.",
      );
    }
    return Buffer.from(readBuffer.subarray(0, bytesRead));
  } catch (error) {
    if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_READ_FAILED",
      "The record-authentication key could not be read safely.",
      error,
    );
  } finally {
    try {
      await handle?.close();
    } finally {
      readBuffer?.fill(0);
    }
  }
}

function waitForKeyCreator(): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, KEY_CREATE_RETRY_DELAY_MS));
}

function processAppearsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== "ESRCH";
  }
}

async function syncPrivateNamespace(namespacePath: string): Promise<void> {
  let handle;
  try {
    handle = await open(namespacePath, filesystemConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (
      process.platform === "win32" &&
      isNodeError(error) &&
      ["EBADF", "EINVAL", "ENOTSUP", "EPERM"].includes(error.code ?? "")
    ) {
      // Node/Windows cannot FlushFileBuffers on a directory handle. The key
      // file itself is fsynced before atomic publication; this limitation is
      // documented on the public loader below.
      return;
    }
    return fail(
      "REFERENCE_PRIVATE_NAMESPACE_SYNC_FAILED",
      "The private verification namespace could not be synchronized durably.",
      error,
    );
  } finally {
    await handle?.close();
  }
}

async function removeRecognizedAbandonedKeyTemps(
  namespacePath: string,
  keyPath: string,
): Promise<void> {
  let recognizedCount = 0;
  let removedAny = false;
  const directory = await opendir(namespacePath);
  for await (const entry of directory) {
    const match = KEY_TEMP_FILE_PATTERN.exec(entry.name);
    if (match === null) continue;
    recognizedCount += 1;
    if (recognizedCount > MAX_RECOGNIZED_ABANDONED_KEY_TEMPS) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_TEMP_COUNT_INVALID",
        "Too many abandoned authentication-key temp files require operator review.",
      );
    }
    const tempPath = join(namespacePath, entry.name);
    if (ACTIVE_KEY_TEMP_PATHS.has(tempPath)) continue;
    const pidText = match.groups?.pid;
    if (pidText === undefined) continue;
    const ownerPid = Number(pidText);
    if (ownerPid !== process.pid && processAppearsAlive(ownerPid)) continue;

    let metadata: BigIntStats;
    let canonicalTempPath: string;
    try {
      metadata = await lstat(tempPath, { bigint: true });
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_TEMP_INVALID",
          "A recognized authentication-key temp path is not a private regular file.",
        );
      }
      canonicalTempPath = await realpath(tempPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_TEMP_INVALID",
        "An abandoned authentication-key temp file could not be inspected safely.",
        error,
      );
    }
    if (!samePath(tempPath, canonicalTempPath) || !isPathWithin(namespacePath, canonicalTempPath)) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_TEMP_INVALID",
        "An authentication-key temp file resolves outside the private namespace.",
      );
    }
    if (metadata.nlink > 1n) {
      let finalMetadata: BigIntStats;
      try {
        finalMetadata = await lstat(keyPath, { bigint: true });
      } catch (error) {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_TEMP_LINK_INVALID",
          "A linked authentication-key temp has no matching fixed final key.",
          error,
        );
      }
      if (
        metadata.nlink !== 2n ||
        finalMetadata.dev !== metadata.dev ||
        finalMetadata.ino !== metadata.ino
      ) {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_TEMP_LINK_INVALID",
          "A linked authentication-key temp does not belong to the fixed final key.",
        );
      }
      // The final link is not accepted while this second link exists. Sync the
      // namespace first so the final directory entry is committed before the
      // temp/claim link is removed and readers can accept nlink === 1.
      await syncPrivateNamespace(namespacePath);
    }
    try {
      await unlink(tempPath);
      removedAny = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_TEMP_CLEANUP_FAILED",
          "An abandoned authentication-key temp file could not be removed safely.",
          error,
        );
      }
    }
  }
  if (removedAny) await syncPrivateNamespace(namespacePath);
}

async function readKeyAfterConcurrentCreate(
  keyPath: string,
  namespacePath: string,
  testHooks?: ReferenceVerificationRecordAuthenticationTestHooksV0,
): Promise<Buffer> {
  for (let attempt = 0; attempt < KEY_CREATE_RETRY_COUNT; attempt += 1) {
    try {
      return await readExactPrivateKey(keyPath, namespacePath, testHooks);
    } catch (error) {
      if (
        !(error instanceof ReferenceVerificationBridgeErrorV0) ||
        (
          error.code !== "REFERENCE_AUTHENTICATION_KEY_LENGTH_INVALID" &&
          error.code !== "REFERENCE_AUTHENTICATION_KEY_UNAVAILABLE" &&
          error.code !== "REFERENCE_AUTHENTICATION_KEY_IDENTITY_INVALID" &&
          error.code !== "REFERENCE_AUTHENTICATION_KEY_CHANGED"
        ) ||
        attempt === KEY_CREATE_RETRY_COUNT - 1
      ) {
        throw error;
      }
      await testHooks?.onConcurrentReadRetry?.(error.code);
      await waitForKeyCreator();
    }
  }
  return fail(
    "REFERENCE_AUTHENTICATION_KEY_CREATE_TIMEOUT",
    "A concurrent key creator did not finish safely.",
  );
}

function newPrivateKeyTempPath(namespacePath: string): string {
  const nonceBytes = randomBytes(16);
  try {
    return join(
      namespacePath,
      `.record-authentication.key.${String(process.pid)}.${nonceBytes.toString("hex")}.partial`,
    );
  } finally {
    nonceBytes.fill(0);
  }
}

async function createPrivateKeyAtomically(
  keyPath: string,
  namespacePath: string,
  testHooks?: ReferenceVerificationRecordAuthenticationTestHooksV0,
): Promise<Buffer> {
  const tempPath = newPrivateKeyTempPath(namespacePath);
  ACTIVE_KEY_TEMP_PATHS.add(tempPath);
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
  } catch (error) {
    ACTIVE_KEY_TEMP_PATHS.delete(tempPath);
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_CREATE_FAILED",
      "A private authentication-key temp file could not be created exclusively.",
      error,
    );
  }

  let generatedKeyBytes: Buffer | undefined;
  try {
    generatedKeyBytes = randomBytes(REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_BYTES_V0);
    let writeOffset = 0;
    while (writeOffset < generatedKeyBytes.length) {
      const { bytesWritten } = await handle.write(
        generatedKeyBytes,
        writeOffset,
        generatedKeyBytes.length - writeOffset,
        writeOffset,
      );
      if (bytesWritten <= 0) {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_WRITE_FAILED",
          "The local record-authentication key was not written completely.",
        );
      }
      writeOffset += bytesWritten;
    }
    await handle.sync();
  } catch (error) {
    ACTIVE_KEY_TEMP_PATHS.delete(tempPath);
    if (error instanceof ReferenceVerificationBridgeErrorV0) throw error;
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_WRITE_FAILED",
      "The private authentication-key temp could not be written durably.",
      error,
    );
  } finally {
    generatedKeyBytes?.fill(0);
    await handle.close();
  }

  try {
    try {
      await testHooks?.afterTempFileSyncBeforePublish?.();
    } catch (error) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_PRE_PUBLISH_FAILED",
        "Key publication stopped before the fixed final filename was created.",
        error,
      );
    }
    let published = false;
    try {
      await link(tempPath, keyPath);
      published = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_PUBLISH_FAILED",
          "The fsynced authentication key could not be published atomically.",
          error,
        );
      }
    }

    if (!published) {
      try {
        await unlink(tempPath);
      } catch (error) {
        return fail(
          "REFERENCE_AUTHENTICATION_KEY_TEMP_CLEANUP_FAILED",
          "The losing authentication-key temp could not be removed safely.",
          error,
        );
      }
      await syncPrivateNamespace(namespacePath);
      return await readKeyAfterConcurrentCreate(keyPath, namespacePath, testHooks);
    }
    try {
      await testHooks?.afterAtomicPublishBeforeNamespaceSync?.();
      // While the fsynced temp and final are both hard links (nlink === 2),
      // readers reject the final. The first directory sync is the commit point.
      await syncPrivateNamespace(namespacePath);
      await unlink(tempPath);
      // Persist claim-link removal. Even if this second sync fails, the first
      // sync already made the final entry durable and it is never deleted.
      await syncPrivateNamespace(namespacePath);
      return await readExactPrivateKey(keyPath, namespacePath, testHooks);
    } catch (error) {
      return fail(
        "REFERENCE_AUTHENTICATION_KEY_POST_PUBLISH_FAILED",
        "The atomically published key was preserved, but post-publication durability work failed.",
        error,
      );
    }
  } finally {
    ACTIVE_KEY_TEMP_PATHS.delete(tempPath);
    // Never remove the fixed final key here. Once atomically published it may
    // already authenticate records in another process. Unpublished recognized
    // temp files are recovered by the next bounded cleanup pass.
  }
}

async function finalKeyExists(keyPath: string): Promise<boolean> {
  try {
    await lstat(keyPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    return fail(
      "REFERENCE_AUTHENTICATION_KEY_UNAVAILABLE",
      "The fixed authentication-key path could not be inspected safely.",
      error,
    );
  }
}

async function createOrReadPrivateKey(
  keyPath: string,
  namespacePath: string,
  testHooks?: ReferenceVerificationRecordAuthenticationTestHooksV0,
): Promise<Buffer> {
  if (await finalKeyExists(keyPath)) {
    try {
      return await readExactPrivateKey(keyPath, namespacePath, testHooks);
    } catch (error) {
      if (
        !(error instanceof ReferenceVerificationBridgeErrorV0) ||
        error.code !== "REFERENCE_AUTHENTICATION_KEY_IDENTITY_INVALID"
      ) {
        throw error;
      }
      await removeRecognizedAbandonedKeyTemps(namespacePath, keyPath);
      return readKeyAfterConcurrentCreate(keyPath, namespacePath, testHooks);
    }
  }
  await removeRecognizedAbandonedKeyTemps(namespacePath, keyPath);
  return createPrivateKeyAtomically(keyPath, namespacePath, testHooks);
}

/**
 * Creates once (with `wx`) or read-only loads the fixed 32-byte local record
 * authentication key. The source and state roots must be disjoint.
 *
 * Windows limitation: this function rejects links/junctions and verifies
 * canonical paths, but Node mode bits cannot prove a private Windows DACL and
 * Node cannot FlushFileBuffers on a Windows directory handle. The private temp
 * file is still fsynced before atomic publication. The supplied root's
 * inherited ACL and the local OS user/profile are the explicit trust boundary.
 */
export async function loadOrCreateReferenceVerificationRecordAuthenticationV0(
  options: LoadReferenceVerificationRecordAuthenticationOptionsV0,
): Promise<ReferenceVerificationRecordAuthenticationV0> {
  const source = await inspectCanonicalSource(options.source);
  const privateStateRootBefore = await inspectExistingPrivateDirectory(
    options.privateStateRoot,
    "The private verification state root",
  );
  assertSourceStateDisjoint(source.canonicalPath, privateStateRootBefore.canonicalPath);
  const privateNamespaceBefore = await ensurePrivateNamespace(
    privateStateRootBefore.canonicalPath,
  );
  await options.testHooks?.afterPrivateNamespacePreparedBeforeRootRecheck?.();
  const privateStateRootAfter = await inspectExistingPrivateDirectory(
    privateStateRootBefore.canonicalPath,
    "The private verification state root",
  );
  if (
    !samePath(privateStateRootBefore.canonicalPath, privateStateRootAfter.canonicalPath) ||
    !sameDirectoryObject(privateStateRootBefore.metadata, privateStateRootAfter.metadata)
  ) {
    return fail(
      "REFERENCE_PRIVATE_STATE_CHANGED",
      "The private verification state root changed while its namespace was prepared.",
    );
  }
  const privateNamespaceBeforeKeyWork = await inspectExistingPrivateDirectory(
    privateNamespaceBefore.canonicalPath,
    "The server-owned verification namespace",
  );
  if (
    !samePath(privateNamespaceBefore.canonicalPath, privateNamespaceBeforeKeyWork.canonicalPath) ||
    !sameDirectoryObject(privateNamespaceBefore.metadata, privateNamespaceBeforeKeyWork.metadata)
  ) {
    return fail(
      "REFERENCE_PRIVATE_NAMESPACE_CHANGED",
      "The server-owned verification namespace was replaced during preparation.",
    );
  }
  const keyPath = join(
    privateNamespaceBefore.canonicalPath,
    REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0,
  );
  const keyBytes = await createOrReadPrivateKey(
    keyPath,
    privateNamespaceBefore.canonicalPath,
    options.testHooks,
  );
  try {
    const privateNamespaceAfterKeyWork = await inspectExistingPrivateDirectory(
      privateNamespaceBefore.canonicalPath,
      "The server-owned verification namespace",
    );
    if (
      !samePath(privateNamespaceBefore.canonicalPath, privateNamespaceAfterKeyWork.canonicalPath) ||
      !sameDirectoryObject(privateNamespaceBefore.metadata, privateNamespaceAfterKeyWork.metadata)
    ) {
      return fail(
        "REFERENCE_PRIVATE_NAMESPACE_CHANGED",
        "The server-owned verification namespace changed while the key was accessed.",
      );
    }
    return new ReferenceVerificationRecordAuthenticationV0(keyBytes);
  } finally {
    keyBytes.fill(0);
  }
}
