import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { RuntimeSha256Schema } from "@omnitwin/types";
import {
  FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_LOCATOR_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
  FoundryDerivativeNormalizationArtifactIndexV0Schema,
  FoundryDerivativeNormalizationOutputBundleInvocationV0Schema,
  FoundryDerivativeNormalizationOutputReportV0Schema,
  FoundryDerivativeNormalizationQuarantineLocatorV0Schema,
  computeFoundryDerivativeNormalizationArtifactIndexSha256,
  computeFoundryDerivativeNormalizationExpectedExecutorSha256,
  computeFoundryDerivativeNormalizationOutputBundleInvocationSha256,
  computeFoundryDerivativeNormalizationOutputReportSha256,
  computeFoundryDerivativeNormalizationQuarantineLocatorSha256,
  type FoundryDerivativeNormalizationArtifactIndexPayloadV0,
  type FoundryDerivativeNormalizationArtifactIndexV0,
  type FoundryDerivativeNormalizationOutputBundleInvocationV0,
  type FoundryDerivativeNormalizationOutputReportPayloadV0,
  type FoundryDerivativeNormalizationOutputReportV0,
  type FoundryDerivativeNormalizationQuarantineLocatorV0,
} from "./derivative-normalization-output-contract.js";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FoundryNormalizeMeshGlbInvocationV0Schema,
  FoundryNormalizeMeshGlbReportV0Schema,
  computeFoundryNormalizeMeshGlbInvocationSha256,
  verifyFoundryNormalizeMeshGlbProof,
  type FoundryNormalizeMeshGlbInvocationV0,
  type FoundryNormalizeMeshGlbReportV0,
} from "./normalize-mesh-glb-worker.js";

const MAXIMUM_REPORT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_INDEX_BYTES = 16 * 1024 * 1024;

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
  readonly uid: number;
  readonly mode: number;
}

interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface ReservedFile {
  readonly path: string;
  readonly name: string;
  readonly handle: Awaited<ReturnType<typeof open>>;
  readonly identity: DirectoryIdentity;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_CANCELLED",
      "The authority-none output custody commit was cancelled.",
    );
  }
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot));
}

function fileIdentity(metadata: FileIdentity): FileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
    uid: metadata.uid,
    mode: metadata.mode,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mode === right.mode;
}

function assertPrivateMetadataWhereSupported(
  metadata: { readonly uid: number; readonly mode: number },
  label: string,
): void {
  if (
    process.platform !== "win32" &&
    (typeof process.getuid !== "function" ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_NOT_PRIVATE",
      `${label} must be process-owned and deny group/other access.`,
    );
  }
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

async function canonicalExistingDirectoryWithoutAliases(
  input: string,
  label: string,
): Promise<string> {
  const requested = resolve(input);
  const before = await lstat(requested);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_UNSAFE_DIRECTORY",
      `${label} must be a regular directory rather than a link or reparse-point alias.`,
    );
  }
  const canonical = await realpath(requested);
  const after = await lstat(requested);
  if (
    comparable(canonical) !== comparable(requested) ||
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_DIRECTORY_ALIAS",
      `${label} must not resolve through a link or reparse-point alias.`,
    );
  }
  return canonical;
}

async function assertSameDirectory(
  path: string,
  identity: DirectoryIdentity,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.dev !== identity.dev ||
    metadata.ino !== identity.ino ||
    comparable(await realpath(path)) !== comparable(path)
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_DIRECTORY_CHANGED",
      `${label} changed during authority-none custody.`,
    );
  }
  assertPrivateMetadataWhereSupported(metadata, label);
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  fail(
    "DERIVATIVE_NORMALIZATION_OUTPUT_EXISTS",
    "The authority-none output directory already exists and will not be replaced.",
  );
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (
      process.platform === "win32" &&
      ["EISDIR", "EINVAL", "EPERM"].includes(String(errorCode(error)))
    ) {
      return;
    }
    throw error;
  }
}

async function prepareOutputPath(outputInput: string): Promise<{
  readonly output: string;
  readonly parent: string;
  readonly parentIdentity: DirectoryIdentity;
}> {
  const output = resolve(outputInput);
  const parent = await canonicalExistingDirectoryWithoutAliases(
    dirname(output),
    "The test-only quarantine parent",
  );
  const canonicalOutput = resolve(parent, basename(output));
  if (canonicalOutput !== output || output === parent) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_PATH_ALIAS",
      "The authority-none output path must be canonical within its parent.",
    );
  }
  await assertPathMissing(output);
  const parentMetadata = await lstat(parent);
  assertPrivateMetadataWhereSupported(
    parentMetadata,
    "The test-only quarantine parent",
  );
  return {
    output,
    parent,
    parentIdentity: { dev: parentMetadata.dev, ino: parentMetadata.ino },
  };
}

async function openExclusiveFile(
  root: string,
  rootIdentity: DirectoryIdentity,
  name: string,
): Promise<ReservedFile> {
  await assertSameDirectory(root, rootIdentity, "The reserved quarantine root");
  const path = resolve(root, name);
  if (!pathIsWithin(root, path) || dirname(path) !== root) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_PATH_ESCAPE",
      "A reserved output file escapes the quarantine root.",
    );
  }
  const handle = await open(path, "wx+", 0o600);
  try {
    const opened = await handle.stat();
    const atPath = await lstat(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size !== 0 ||
      atPath.isSymbolicLink() ||
      !atPath.isFile() ||
      atPath.nlink !== 1 ||
      opened.dev !== atPath.dev ||
      opened.ino !== atPath.ino
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_CHANGED",
        `Reserved output file ${name} changed before use.`,
      );
    }
    assertPrivateMetadataWhereSupported(opened, `Reserved output file ${name}`);
    assertPrivateMetadataWhereSupported(
      atPath,
      `Reserved output path ${name}`,
    );
    return {
      path,
      name,
      handle,
      identity: { dev: opened.dev, ino: opened.ino },
    };
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

async function writeSyncReadback(
  root: string,
  rootIdentity: DirectoryIdentity,
  file: ReservedFile,
  bytes: Buffer,
): Promise<void> {
  await assertSameDirectory(root, rootIdentity, "The reserved quarantine root");
  const before = await file.handle.stat();
  const beforeAtPath = await lstat(file.path);
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size !== 0 ||
    beforeAtPath.isSymbolicLink() ||
    !beforeAtPath.isFile() ||
    beforeAtPath.nlink !== 1 ||
    before.dev !== file.identity.dev ||
    before.ino !== file.identity.ino ||
    beforeAtPath.dev !== file.identity.dev ||
    beforeAtPath.ino !== file.identity.ino
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_CHANGED",
      `Reserved output file ${file.name} changed before write.`,
    );
  }
  assertPrivateMetadataWhereSupported(
    before,
    `Reserved output file ${file.name}`,
  );
  assertPrivateMetadataWhereSupported(
    beforeAtPath,
    `Reserved output path ${file.name}`,
  );
  await file.handle.writeFile(bytes);
  await file.handle.sync();
  const readback = Buffer.allocUnsafe(bytes.length);
  let position = 0;
  while (position < readback.length) {
    const { bytesRead } = await file.handle.read(
      readback,
      position,
      readback.length - position,
      position,
    );
    if (bytesRead === 0) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_READBACK_MISMATCH",
        `Reserved output file ${file.name} ended during handle-bound readback.`,
      );
    }
    position += bytesRead;
  }
  const overflow = Buffer.allocUnsafe(1);
  const { bytesRead: overflowBytes } = await file.handle.read(
    overflow,
    0,
    1,
    bytes.length,
  );
  const after = await file.handle.stat();
  const afterAtPath = await lstat(file.path);
  if (
    overflowBytes !== 0 ||
    !readback.equals(bytes) ||
    !after.isFile() ||
    after.nlink !== 1 ||
    after.size !== bytes.length ||
    afterAtPath.isSymbolicLink() ||
    !afterAtPath.isFile() ||
    afterAtPath.nlink !== 1 ||
    after.dev !== file.identity.dev ||
    after.ino !== file.identity.ino ||
    afterAtPath.dev !== file.identity.dev ||
    afterAtPath.ino !== file.identity.ino
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_READBACK_MISMATCH",
      `Reserved output file ${file.name} failed identity-bound fsync/readback.`,
    );
  }
  assertPrivateMetadataWhereSupported(
    after,
    `Reserved output file ${file.name}`,
  );
  assertPrivateMetadataWhereSupported(
    afterAtPath,
    `Reserved output path ${file.name}`,
  );
  await assertSameDirectory(root, rootIdentity, "The reserved quarantine root");
}

interface ReservedBundle {
  readonly root: string;
  readonly parent: string;
  readonly rootIdentity: DirectoryIdentity;
  readonly parentIdentity: DirectoryIdentity;
  readonly glb: ReservedFile;
  readonly report: ReservedFile;
  readonly index: ReservedFile;
  readonly close: () => Promise<void>;
}

async function reserveBundle(outputInput: string): Promise<ReservedBundle> {
  const output = await prepareOutputPath(outputInput);
  try {
    await mkdir(output.output, { mode: 0o700 });
  } catch (error: unknown) {
    if (errorCode(error) === "EEXIST") {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_EXISTS",
        "The authority-none output path was claimed concurrently.",
        error,
      );
    }
    throw error;
  }
  const rootMetadata = await lstat(output.output);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_RESERVATION_INVALID",
      "The writer failed to reserve a private quarantine directory.",
    );
  }
  assertPrivateMetadataWhereSupported(
    rootMetadata,
    "The reserved quarantine root",
  );
  const rootIdentity = { dev: rootMetadata.dev, ino: rootMetadata.ino };
  await assertSameDirectory(
    output.parent,
    output.parentIdentity,
    "The test-only quarantine parent",
  );
  await assertSameDirectory(
    output.output,
    rootIdentity,
    "The reserved quarantine root",
  );
  let glb: ReservedFile | undefined;
  let report: ReservedFile | undefined;
  let index: ReservedFile | undefined;
  try {
    // All exact file capabilities are claimed before any source or output
    // payload byte is parsed, hashed, or validated.
    glb = await openExclusiveFile(
      output.output,
      rootIdentity,
      FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
    );
    report = await openExclusiveFile(
      output.output,
      rootIdentity,
      FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
    );
    index = await openExclusiveFile(
      output.output,
      rootIdentity,
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
    );
    await syncDirectory(output.output);
    await syncDirectory(output.parent);
    await assertSameDirectory(
      output.parent,
      output.parentIdentity,
      "The test-only quarantine parent",
    );
    await assertSameDirectory(
      output.output,
      rootIdentity,
      "The reserved quarantine root",
    );
  } catch (error: unknown) {
    await Promise.allSettled([
      glb?.handle.close(),
      report?.handle.close(),
      index?.handle.close(),
    ]);
    throw error;
  }
  let closed = false;
  return {
    root: output.output,
    parent: output.parent,
    rootIdentity,
    parentIdentity: output.parentIdentity,
    glb,
    report,
    index,
    close: async () => {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([
        glb.handle.close(),
        report.handle.close(),
        index.handle.close(),
      ]);
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejected !== undefined) throw rejected.reason;
    },
  };
}

async function snapshotExactRegularFiles(
  root: string,
): Promise<ReadonlyMap<string, FileIdentity>> {
  const files = new Map<string, FileIdentity>();
  const entries = await opendir(root);
  for await (const entry of entries) {
    const path = resolve(root, entry.name);
    const metadata = await lstat(path);
    if (
      entry.isSymbolicLink() ||
      metadata.isSymbolicLink() ||
      !entry.isFile() ||
      !metadata.isFile()
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_NON_REGULAR_ENTRY",
        `Quarantine output contains a non-regular entry: ${entry.name}.`,
      );
    }
    if (metadata.nlink !== 1) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_HARDLINK_REJECTED",
        `Quarantine output contains a multiply linked file: ${entry.name}.`,
      );
    }
    assertPrivateMetadataWhereSupported(
      metadata,
      `Quarantine output file ${entry.name}`,
    );
    files.set(entry.name, fileIdentity(metadata));
  }
  return files;
}

function assertSnapshotsEqual(
  before: ReadonlyMap<string, FileIdentity>,
  after: ReadonlyMap<string, FileIdentity>,
): void {
  if (before.size !== after.size) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_CHANGED",
      "Quarantine output file set changed during verification.",
    );
  }
  for (const [path, identity] of before) {
    const next = after.get(path);
    if (next === undefined || !sameFileIdentity(identity, next)) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_CHANGED",
        `Quarantine output changed during verification: ${path}.`,
      );
    }
  }
}

async function readExactRegularFile(
  path: string,
  expected: FileIdentity,
  maximumBytes: number,
): Promise<Buffer> {
  if (expected.size <= 0 || expected.size > maximumBytes) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_SIZE_INVALID",
      "Quarantine artifact size is empty or exceeds its fixed bound.",
    );
  }
  const pathBefore = await lstat(path);
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1 ||
    !sameFileIdentity(expected, fileIdentity(pathBefore))
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_CHANGED",
      "Quarantine artifact changed before its handle-bound read.",
    );
  }
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    const atPath = await lstat(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      atPath.isSymbolicLink() ||
      !atPath.isFile() ||
      atPath.nlink !== 1 ||
      !sameFileIdentity(expected, fileIdentity(opened)) ||
      !sameFileIdentity(fileIdentity(opened), fileIdentity(atPath))
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_CHANGED",
        "Quarantine artifact changed after its verification handle opened.",
      );
    }
    assertPrivateMetadataWhereSupported(opened, "The quarantine artifact");
    assertPrivateMetadataWhereSupported(atPath, "The quarantine artifact path");
    const bytes = Buffer.allocUnsafe(expected.size);
    let position = 0;
    while (position < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        position,
        bytes.length - position,
        position,
      );
      if (bytesRead === 0) {
        fail(
          "DERIVATIVE_NORMALIZATION_OUTPUT_TRUNCATED",
          "Quarantine artifact ended before its snapshotted byte count.",
        );
      }
      position += bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(
      overflow,
      0,
      1,
      bytes.length,
    );
    const closedIdentity = await handle.stat();
    const finalAtPath = await lstat(path);
    if (
      overflowBytes !== 0 ||
      !sameFileIdentity(expected, fileIdentity(closedIdentity)) ||
      finalAtPath.isSymbolicLink() ||
      !sameFileIdentity(expected, fileIdentity(finalAtPath))
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_CHANGED",
        "Quarantine artifact changed during its handle-bound read.",
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error: unknown) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_JSON_INVALID",
      `${label} is not valid JSON.`,
      error,
    );
  }
}

function createLocator(
  root: string,
  identity: DirectoryIdentity,
  profileSha256: string,
): FoundryDerivativeNormalizationQuarantineLocatorV0 {
  const payload = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_LOCATOR_V0,
    profileId: "authority-none-test-only-local-create-only" as const,
    profileSha256,
    locatorKind: "canonical_local_directory_identity" as const,
    canonicalDirectoryPath: root,
    directoryDevice: String(identity.dev),
    directoryInode: String(identity.ino),
    identityBinding: "lstat_realpath_device_inode" as const,
    authority: "none" as const,
  };
  return FoundryDerivativeNormalizationQuarantineLocatorV0Schema.parse({
    ...payload,
    locatorSha256:
      computeFoundryDerivativeNormalizationQuarantineLocatorSha256(payload),
  });
}

function capabilityDenials() {
  return {
    release: false as const,
    publication: false as const,
    redistribution: false as const,
    signing: false as const,
    runtimePromotion: false as const,
    immutableRegistration: false as const,
    measuredGeometryAuthority: false as const,
  };
}

function outputCommitNonAuthority() {
  return {
    candidateCurrentAuthorityRevalidated: false as const,
    policyGenerationRevalidated: false as const,
    approvalExpiryRevalidated: false as const,
    policyRevocationRevalidated: false as const,
    attestationRevocationRevalidated: false as const,
    executionActivationValidated: false as const,
    executionAdmissionValidated: false as const,
    fenceOwnershipValidated: false as const,
    executorAuthenticated: false as const,
    canonicalOutputCommitAuthorized: false as const,
  };
}

export interface RunFoundryDerivativeNormalizationOutputBundleOptions {
  readonly outputDirectory: string;
  readonly bundleInvocation: unknown;
  readonly normalizeInvocation: unknown;
  readonly normalizeReport: unknown;
  readonly sourceBytes: Uint8Array;
  readonly normalizedGlb: Uint8Array;
  readonly signal?: AbortSignal;
}

export interface FoundryDerivativeNormalizationOutputBundleResult {
  readonly outputDirectory: string;
  readonly report: FoundryDerivativeNormalizationOutputReportV0;
  readonly artifactIndex: FoundryDerivativeNormalizationArtifactIndexV0;
}

/**
 * Production execution is deliberately unavailable. This throws before
 * reading any option property, source byte, output byte, or filesystem path.
 */
export function runFoundryDerivativeNormalizationOutputBundle(
  _options: RunFoundryDerivativeNormalizationOutputBundleOptions,
): never {
  if (process.platform === "win32") {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_WINDOWS_SANDBOX_UNREVIEWED",
      "Native Windows production output custody is disabled until a reviewed ACL and sandbox backend exists.",
    );
  }
  fail(
    "DERIVATIVE_NORMALIZATION_OUTPUT_PRODUCTION_DISABLED",
    "Derivative normalization output custody has no production activation or execution binding.",
  );
}

/** Test-only local writer. Deliberately omitted from the package root export. */
export async function __testOnlyWriteFoundryDerivativeNormalizationOutputBundle(
  options: RunFoundryDerivativeNormalizationOutputBundleOptions,
): Promise<FoundryDerivativeNormalizationOutputBundleResult> {
  if (process.env.NODE_ENV !== "test") {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_TEST_ONLY",
      "The local derivative output writer is available only under NODE_ENV=test.",
    );
  }
  assertNotCancelled(options.signal);
  const reserved = await reserveBundle(options.outputDirectory);
  try {
    // Parsing and proof verification intentionally begin only after all three
    // create-only output capabilities have been retained.
    const bundleInvocation =
      FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.parse(
        options.bundleInvocation,
      );
    const normalizeInvocation =
      FoundryNormalizeMeshGlbInvocationV0Schema.parse(
        options.normalizeInvocation,
      );
    const normalizeReport = FoundryNormalizeMeshGlbReportV0Schema.parse(
      options.normalizeReport,
    );
    if (
      options.sourceBytes.byteLength <= 0 ||
      options.sourceBytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
      options.normalizedGlb.byteLength <= 0 ||
      options.normalizedGlb.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_BYTES_OUT_OF_BOUNDS",
        "Source and normalized output bytes must be non-empty and within the reviewed normalization bound.",
      );
    }
    const sourceBytes = Buffer.from(options.sourceBytes);
    const normalizedGlb = Buffer.from(options.normalizedGlb);
    assertNotCancelled(options.signal);
    await verifyFoundryNormalizeMeshGlbProof({
      invocation: normalizeInvocation,
      sourceBytes,
      normalizedGlb,
      report: normalizeReport,
    });
    assertNotCancelled(options.signal);
    const locator = createLocator(
      reserved.root,
      reserved.rootIdentity,
      bundleInvocation.quarantineProfileSha256,
    );
    const bundleInvocationSha256 =
      computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
        bundleInvocation,
      );
    const reportPayload: FoundryDerivativeNormalizationOutputReportPayloadV0 =
      {
        schemaVersion: FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0,
        bundleInvocation,
        bundleInvocationSha256,
        candidateSha256: bundleInvocation.candidateSha256,
        candidateReservationReceiptSha256:
          bundleInvocation.candidateReservationReceiptSha256,
        baseExecutionSubjectSha256:
          bundleInvocation.baseExecutionSubjectSha256,
        bindingSetSha256: bundleInvocation.candidate.bindingSetSha256,
        restrictionLineageSetSha256:
          bundleInvocation.candidate.restrictionLineageSetSha256,
        outputPolicySha256: bundleInvocation.candidate.outputPolicySha256,
        normalizeMeshGlbProof: {
          invocation: normalizeInvocation,
          invocationSha256:
            computeFoundryNormalizeMeshGlbInvocationSha256(normalizeInvocation),
          report: normalizeReport,
          reportSha256: normalizeReport.reportSha256,
        },
        sourceBytes: {
          assetId: normalizeInvocation.source.assetId,
          mediaType: normalizeInvocation.source.mediaType,
          sizeBytes: sourceBytes.length,
          sha256: `sha256:${sha256Bytes(sourceBytes)}`,
        },
        outputBytes: {
          path: FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
          mediaType: "model/gltf-binary",
          sizeBytes: normalizedGlb.length,
          sha256: `sha256:${sha256Bytes(normalizedGlb)}`,
        },
        quarantineLocator: locator,
        activation: bundleInvocation.activation,
        claimedRuntimeContext: bundleInvocation.claimedRuntimeContext,
        expectedExecutor: bundleInvocation.expectedExecutor,
        outputCommitAuthority: outputCommitNonAuthority(),
        commitPosture: "report_content_fsynced_after_glb_before_index",
        capabilities: capabilityDenials(),
        authority: "none",
        executionEligible: false,
      };
    const report = FoundryDerivativeNormalizationOutputReportV0Schema.parse({
      ...reportPayload,
      reportSha256:
        computeFoundryDerivativeNormalizationOutputReportSha256(reportPayload),
    });
    const reportBytes = canonicalJsonBytes(report);
    if (reportBytes.length > MAXIMUM_REPORT_BYTES) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_TOO_LARGE",
        "The canonical normalization output report exceeds its fixed custody bound.",
      );
    }
    const indexPayload: FoundryDerivativeNormalizationArtifactIndexPayloadV0 =
      {
        schemaVersion: FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_V0,
        bundleInvocationSha256,
        reportSha256: report.reportSha256,
        candidateSha256: bundleInvocation.candidateSha256,
        candidateReservationReceiptSha256:
          bundleInvocation.candidateReservationReceiptSha256,
        baseExecutionSubjectSha256:
          bundleInvocation.baseExecutionSubjectSha256,
        bindingSetSha256: bundleInvocation.candidate.bindingSetSha256,
        restrictionLineageSetSha256:
          bundleInvocation.candidate.restrictionLineageSetSha256,
        outputPolicySha256: bundleInvocation.candidate.outputPolicySha256,
        claimedRuntimeContext: bundleInvocation.claimedRuntimeContext,
        expectedExecutorSha256:
          computeFoundryDerivativeNormalizationExpectedExecutorSha256(
            bundleInvocation.expectedExecutor,
          ),
        quarantineProfileSha256:
          bundleInvocation.quarantineProfileSha256,
        quarantineLocator: locator,
        artifacts: [
          {
            path: FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
            role: "authority_none_normalized_glb",
            mediaType: "model/gltf-binary",
            sizeBytes: normalizedGlb.length,
            sha256: `sha256:${sha256Bytes(normalizedGlb)}`,
            subjectSha256: normalizeReport.reportSha256,
          },
          {
            path: FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
            role: "authority_none_normalization_report",
            mediaType: "application/json",
            sizeBytes: reportBytes.length,
            sha256: `sha256:${sha256Bytes(reportBytes)}`,
            subjectSha256: report.reportSha256,
          },
        ],
        commitMarker: "artifact_index_content_fsynced_last",
        activation: bundleInvocation.activation,
        outputCommitAuthority: outputCommitNonAuthority(),
        capabilities: capabilityDenials(),
        authority: "none",
        executionEligible: false,
      };
    const artifactIndex =
      FoundryDerivativeNormalizationArtifactIndexV0Schema.parse({
        ...indexPayload,
        artifactIndexSha256:
          computeFoundryDerivativeNormalizationArtifactIndexSha256(
            indexPayload,
          ),
      });
    const indexBytes = canonicalJsonBytes(artifactIndex);
    if (indexBytes.length > MAXIMUM_INDEX_BYTES) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_INDEX_TOO_LARGE",
        "The canonical artifact index exceeds its fixed custody bound.",
      );
    }

    // Payload first, report second, and the fsynced index commit marker last.
    // This ordering is an implementation-reviewed protocol invariant; the
    // resulting marker cannot cryptographically prove historical fsync order.
    await writeSyncReadback(
      reserved.root,
      reserved.rootIdentity,
      reserved.glb,
      normalizedGlb,
    );
    await syncDirectory(reserved.root);
    assertNotCancelled(options.signal);
    await writeSyncReadback(
      reserved.root,
      reserved.rootIdentity,
      reserved.report,
      reportBytes,
    );
    await syncDirectory(reserved.root);
    assertNotCancelled(options.signal);
    await writeSyncReadback(
      reserved.root,
      reserved.rootIdentity,
      reserved.index,
      indexBytes,
    );
    await syncDirectory(reserved.root);
    await syncDirectory(reserved.parent);
    await assertSameDirectory(
      reserved.parent,
      reserved.parentIdentity,
      "The test-only quarantine parent",
    );
    await assertSameDirectory(
      reserved.root,
      reserved.rootIdentity,
      "The committed quarantine root",
    );
    await reserved.close();
    return await verifyFoundryDerivativeNormalizationOutputBundle({
      outputDirectory: reserved.root,
      sourceBytes,
      expectedBundleInvocationSha256: bundleInvocationSha256,
      expectedCandidateSha256: bundleInvocation.candidateSha256,
      expectedCandidateReservationReceiptSha256:
        bundleInvocation.candidateReservationReceiptSha256,
      expectedBaseExecutionSubjectSha256:
        bundleInvocation.baseExecutionSubjectSha256,
    });
  } finally {
    await reserved.close();
  }
}

export interface VerifyFoundryDerivativeNormalizationOutputBundleOptions {
  readonly outputDirectory: string;
  readonly sourceBytes: Uint8Array;
  readonly expectedBundleInvocationSha256?: string;
  readonly expectedCandidateSha256?: string;
  readonly expectedCandidateReservationReceiptSha256?: string;
  readonly expectedBaseExecutionSubjectSha256?: string;
}

export async function verifyFoundryDerivativeNormalizationOutputBundle(
  options: VerifyFoundryDerivativeNormalizationOutputBundleOptions,
): Promise<FoundryDerivativeNormalizationOutputBundleResult> {
  const root = await canonicalExistingDirectoryWithoutAliases(
    options.outputDirectory,
    "The authority-none normalization quarantine",
  );
  const rootMetadata = await lstat(root);
  assertPrivateMetadataWhereSupported(
    rootMetadata,
    "The authority-none normalization quarantine",
  );
  const rootIdentity = { dev: rootMetadata.dev, ino: rootMetadata.ino };
  const snapshot = await snapshotExactRegularFiles(root);
  const expectedNames = [
    FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
    FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
    FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
  ];
  if (
    JSON.stringify([...snapshot.keys()].sort()) !==
    JSON.stringify(expectedNames)
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_SET_MISMATCH",
      "Quarantine output must contain exactly normalized.glb, normalization-report.json, and artifact-index.json.",
    );
  }
  const indexIdentity = snapshot.get(
    FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
  );
  const reportIdentity = snapshot.get(
    FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
  );
  const glbIdentity = snapshot.get(FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH);
  if (
    indexIdentity === undefined ||
    reportIdentity === undefined ||
    glbIdentity === undefined
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_FILE_SET_MISMATCH",
      "Quarantine output is missing one of its exact three artifacts.",
    );
  }

  // The index is the only commit marker. It is parsed and authenticated
  // before the verifier trusts either payload artifact.
  const indexBytes = await readExactRegularFile(
    resolve(root, FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH),
    indexIdentity,
    MAXIMUM_INDEX_BYTES,
  );
  const artifactIndex =
    FoundryDerivativeNormalizationArtifactIndexV0Schema.parse(
      parseJson(indexBytes, "The artifact index commit marker"),
    );
  if (!indexBytes.equals(canonicalJsonBytes(artifactIndex))) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_NOT_CANONICAL",
      "The artifact index commit marker is not canonical JSON.",
    );
  }
  const locator = artifactIndex.quarantineLocator;
  if (
    comparable(locator.canonicalDirectoryPath) !== comparable(root) ||
    locator.directoryDevice !== String(rootIdentity.dev) ||
    locator.directoryInode !== String(rootIdentity.ino)
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_LOCATOR_MISMATCH",
      "The quarantine locator does not bind this canonical directory identity.",
    );
  }

  const reportArtifact = artifactIndex.artifacts[1];
  const glbArtifact = artifactIndex.artifacts[0];
  if (
    reportArtifact.sizeBytes !== reportIdentity.size ||
    glbArtifact.sizeBytes !== glbIdentity.size
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_SIZE_MISMATCH",
      "Artifact sizes do not match the commit index.",
    );
  }
  const reportBytes = await readExactRegularFile(
    resolve(root, FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH),
    reportIdentity,
    MAXIMUM_REPORT_BYTES,
  );
  if (`sha256:${sha256Bytes(reportBytes)}` !== reportArtifact.sha256) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_DIGEST_MISMATCH",
      "Normalization report bytes do not match the commit index.",
    );
  }
  const report = FoundryDerivativeNormalizationOutputReportV0Schema.parse(
    parseJson(reportBytes, "The normalization report"),
  );
  if (!reportBytes.equals(canonicalJsonBytes(report))) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_NOT_CANONICAL",
      "The normalization report is not canonical JSON.",
    );
  }
  const normalizedGlb = await readExactRegularFile(
    resolve(root, FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH),
    glbIdentity,
    FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  );
  if (`sha256:${sha256Bytes(normalizedGlb)}` !== glbArtifact.sha256) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_DIGEST_MISMATCH",
      "Normalized GLB bytes do not match the commit index.",
    );
  }

  const invocationExpectedExecutorSha256 =
    computeFoundryDerivativeNormalizationExpectedExecutorSha256(
      report.bundleInvocation.expectedExecutor,
    );
  const reportExpectedExecutorSha256 =
    computeFoundryDerivativeNormalizationExpectedExecutorSha256(
      report.expectedExecutor,
    );
  const invocationRuntimeContextJson = stableCanonicalJson(
    toCanonicalJson(report.bundleInvocation.claimedRuntimeContext),
  );
  const reportRuntimeContextJson = stableCanonicalJson(
    toCanonicalJson(report.claimedRuntimeContext),
  );
  const indexRuntimeContextJson = stableCanonicalJson(
    toCanonicalJson(artifactIndex.claimedRuntimeContext),
  );

  if (
    reportArtifact.subjectSha256 !== report.reportSha256 ||
    glbArtifact.subjectSha256 !==
      report.normalizeMeshGlbProof.report.reportSha256 ||
    artifactIndex.reportSha256 !== report.reportSha256 ||
    artifactIndex.bundleInvocationSha256 !==
      report.bundleInvocationSha256 ||
    artifactIndex.candidateSha256 !== report.candidateSha256 ||
    artifactIndex.candidateReservationReceiptSha256 !==
      report.candidateReservationReceiptSha256 ||
    artifactIndex.baseExecutionSubjectSha256 !==
      report.baseExecutionSubjectSha256 ||
    artifactIndex.bindingSetSha256 !== report.bindingSetSha256 ||
    artifactIndex.restrictionLineageSetSha256 !==
      report.restrictionLineageSetSha256 ||
    artifactIndex.outputPolicySha256 !== report.outputPolicySha256 ||
    artifactIndex.expectedExecutorSha256 !==
      invocationExpectedExecutorSha256 ||
    reportExpectedExecutorSha256 !== invocationExpectedExecutorSha256 ||
    artifactIndex.quarantineProfileSha256 !==
      report.bundleInvocation.quarantineProfileSha256 ||
    artifactIndex.quarantineLocator.locatorSha256 !==
      report.quarantineLocator.locatorSha256 ||
    indexRuntimeContextJson !== reportRuntimeContextJson ||
    reportRuntimeContextJson !== invocationRuntimeContextJson
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_BINDING_MISMATCH",
      "The report and commit index do not bind the same authority-none subject.",
    );
  }
  if (
    report.outputBytes.sizeBytes !== normalizedGlb.length ||
    report.outputBytes.sha256 !== `sha256:${sha256Bytes(normalizedGlb)}`
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_BINDING_MISMATCH",
      "The normalized GLB does not match the report's exact output binding.",
    );
  }

  const expectedChecks: readonly [string | undefined, string, string][] = [
    [
      options.expectedBundleInvocationSha256,
      report.bundleInvocationSha256,
      "bundle invocation",
    ],
    [options.expectedCandidateSha256, report.candidateSha256, "candidate"],
    [
      options.expectedCandidateReservationReceiptSha256,
      report.candidateReservationReceiptSha256,
      "candidate reservation receipt",
    ],
    [
      options.expectedBaseExecutionSubjectSha256,
      report.baseExecutionSubjectSha256,
      "base execution subject",
    ],
  ];
  for (const [expected, actual, label] of expectedChecks) {
    if (
      expected !== undefined &&
      RuntimeSha256Schema.parse(expected) !== actual
    ) {
      fail(
        "DERIVATIVE_NORMALIZATION_OUTPUT_EXPECTED_SUBJECT_MISMATCH",
        `The verified bundle does not match the expected ${label}.`,
      );
    }
  }

  if (
    options.sourceBytes.byteLength <= 0 ||
    options.sourceBytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_SOURCE_OUT_OF_BOUNDS",
      "Independent source bytes are empty or exceed the reviewed normalization bound.",
    );
  }
  const sourceBytes = Buffer.from(options.sourceBytes);
  await verifyFoundryNormalizeMeshGlbProof({
    invocation: report.normalizeMeshGlbProof.invocation,
    sourceBytes,
    normalizedGlb,
    report: report.normalizeMeshGlbProof.report,
  });
  if (
    report.sourceBytes.sizeBytes !== sourceBytes.length ||
    report.sourceBytes.sha256 !== `sha256:${sha256Bytes(sourceBytes)}`
  ) {
    fail(
      "DERIVATIVE_NORMALIZATION_OUTPUT_SOURCE_MISMATCH",
      "The independent source bytes do not match the bundle report.",
    );
  }
  await assertSameDirectory(
    root,
    rootIdentity,
    "The verified quarantine root",
  );
  const finalSnapshot = await snapshotExactRegularFiles(root);
  assertSnapshotsEqual(snapshot, finalSnapshot);
  return { outputDirectory: root, report, artifactIndex };
}

export type {
  FoundryDerivativeNormalizationOutputBundleInvocationV0,
  FoundryNormalizeMeshGlbInvocationV0,
  FoundryNormalizeMeshGlbReportV0,
};
