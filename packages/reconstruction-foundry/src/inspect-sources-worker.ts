import { createHash } from "node:crypto";
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
import {
  FoundryIngestManifestV0Schema,
  FoundryFileDetectionSchema,
  FoundryInputTypeSchema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryJobSpecV0Schema,
  FoundryJobStageSchema,
  FoundryRelativePathSchema,
  FoundryTrustedWorkerProfileV0Schema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  computeFoundryTrustedWorkerProfileSha256,
  validateFoundryJobRights,
  type FoundryInputAsset,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_HASH_BUFFER_BYTES,
  FOUNDRY_MAX_HASH_HEAD_BYTES,
  sha256Bytes,
} from "./hash.js";
import { classifyUniversalIntakeProbe } from "./intake-receipt.js";
import {
  FoundryIntakeStagingIndexV0Schema,
  verifyUniversalIntakeStage,
  type FoundryIntakeStagingIndexV0,
} from "./intake-staging.js";

export const FOUNDRY_INSPECT_SOURCES_INVOCATION_V0 =
  "omnitwin.foundry.inspect-sources-invocation.v0";
export const FOUNDRY_INSPECT_SOURCES_REPORT_V0 =
  "omnitwin.foundry.inspect-sources-report.v0";
export const FOUNDRY_WORKER_ARTIFACT_INDEX_V0 =
  "omnitwin.foundry.worker-artifact-index.v0";

export const FOUNDRY_INSPECT_SOURCES_REPORT_PATH = "source-inspection.json";
export const FOUNDRY_WORKER_ARTIFACT_INDEX_PATH = "artifact-index.json";
export const FOUNDRY_INSPECT_SOURCES_OUTPUT_NAME = "inspect_sources-output";

/**
 * This is an operation identity, not an argv to execute. The sealed worker
 * rejects every other profile/stage command and never starts a child process.
 */
export const FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND = [
  "omnitwin-sealed-worker",
  "inspect_sources",
  "v0",
] as const;

const MANIFEST_STAGE_PATH = "manifest/foundry-ingest-manifest-v0.json";
const ADMISSION_RESULT_STAGE_PATH = "evidence/admission-result.json";
const STAGED_SOURCE_PREFIX = "source/";
const MAXIMUM_CONTROL_JSON_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_INDEX_BYTES = 16 * 1024 * 1024;
const MAXIMUM_OUTPUT_REPORT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_SNAPSHOT_FILES = 100_007;
const MAXIMUM_SNAPSHOT_DIRECTORIES = 100_007;
const MAXIMUM_SNAPSHOT_DEPTH = 256;
const INSPECT_SOURCES_INVOCATION_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_INSPECT_SOURCES_INVOCATION_V0";
const INSPECT_SOURCES_REPORT_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_INSPECT_SOURCES_REPORT_V0";
const WORKER_ARTIFACT_INDEX_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_WORKER_ARTIFACT_INDEX_V0";
const PositiveFenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function isStrictlySortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}

const InvocationEvidenceSchema = z
  .object({
    ingestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
  })
  .strict();

export const FoundryInspectSourcesInvocationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INSPECT_SOURCES_INVOCATION_V0),
    operation: z.literal("inspect_sources"),
    claimedExecutionSubjectSha256: RuntimeSha256Schema,
    executionBindingAuthority: z.literal("caller_bound_not_authorized"),
    jobId: RuntimeManifestKeySchema,
    jobSpec: FoundryJobSpecV0Schema,
    jobSpecSha256: RuntimeSha256Schema,
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    stage: FoundryJobStageSchema,
    workerProfile: FoundryTrustedWorkerProfileV0Schema,
    workerProfileSha256: RuntimeSha256Schema,
    workerProfileBindingAuthority: z.literal("caller_bound_not_allowlisted"),
    evidence: InvocationEvidenceSchema,
    authority: z.literal("none"),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    const stage = invocation.stage;
    const profile = invocation.workerProfile;
    if (
      stage.id !== "inspect_sources" ||
      stage.kind !== "inspect" ||
      stage.dependsOn.length !== 0 ||
      !sameStrings(stage.command, FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND) ||
      !sameStrings(profile.command, FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND) ||
      !sameStrings(stage.outputNames, [FOUNDRY_INSPECT_SOURCES_OUTPUT_NAME]) ||
      !sameStrings(stage.rightsPurposes, ["commercial_internal_use"]) ||
      stage.networkAccess !== "none" ||
      profile.networkAccess !== "none" ||
      stage.checkpoint !== "none" ||
      stage.resumable ||
      stage.gpuCount !== 0 ||
      stage.minimumGpuVramGiB !== 0 ||
      profile.operationClass !== "read_only_inspection" ||
      !profile.localExecutionAllowed ||
      stage.containerImage !== profile.containerImage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stage"],
        message:
          "inspect_sources must use the sealed local, CPU-only, no-network, non-resumable inspection profile",
      });
    }
    const job = invocation.jobSpec;
    if (
      invocation.jobSpecSha256 !== computeFoundryJobSpecSha256(job) ||
      invocation.jobId !== job.id ||
      job.executionIntent !== "execute" ||
      job.providerKind !== "local_cpu" ||
      job.providerAdapterId !== "local-sandbox" ||
      job.objectStorageProfile !== null ||
      job.estimatedCostUsd !== 0 ||
      job.budgetCapUsd !== 0 ||
      job.computeApprovalId !== null ||
      job.ingestManifestSha256 !== invocation.evidence.ingestManifestSha256 ||
      job.stages.length !== 1 ||
      stableCanonicalJson(toCanonicalJson(job.stages[0])) !==
        stableCanonicalJson(toCanonicalJson(stage))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobSpec"],
        message:
          "inspect_sources must bind one exact zero-cost local executable JobSpec containing only the sealed stage",
      });
    }
    if (
      stage.inputAssetIds.length === 0 ||
      !isStrictlySortedUnique(stage.inputAssetIds)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stage", "inputAssetIds"],
        message: "inspect_sources input asset IDs must be non-empty, unique, and sorted",
      });
    }
    if (
      invocation.workerProfileSha256 !==
        computeFoundryTrustedWorkerProfileSha256(profile)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerProfileSha256"],
        message: "worker profile digest must match the exact reviewed profile",
      });
    }
  });
export type FoundryInspectSourcesInvocationV0 = z.infer<
  typeof FoundryInspectSourcesInvocationV0Schema
>;

const InspectedSourceAssetV0Schema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    relativePath: FoundryRelativePathSchema,
    inputType: FoundryInputTypeSchema,
    mediaType: z.string().trim().min(1).max(160),
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: RuntimeSha256Schema,
    captureState: z.enum(["raw_capture", "official_export", "derived", "reference"]),
    accessState: z.enum([
      "direct",
      "official_export",
      "official_api",
      "metadata_only",
      "blocked_technical",
      "blocked_legal",
      "unknown",
    ]),
    provenanceClass: z.enum([
      "captured",
      "enhanced_captured",
      "generated_cinematic",
      "concept_imagination",
    ]),
    coordinateFrameId: RuntimeManifestKeySchema.nullable(),
    byteVerification: z.literal("full_sha256_handle_bound"),
    boundedDetection: z
      .object({
        method: z.literal("bounded_header_no_payload_decode"),
        headerBytesRead: z.number().int().min(0).max(FOUNDRY_MAX_HASH_HEAD_BYTES),
        magicHex: z.string().regex(/^(?:[a-f0-9]{2})*$/u).max(256),
        detection: FoundryFileDetectionSchema,
        declaredInputTypeObserved: z.boolean(),
      })
      .strict(),
  })
  .strict();

const InspectSourcesReportPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INSPECT_SOURCES_REPORT_V0),
    invocationSha256: RuntimeSha256Schema,
    claimedExecutionSubjectSha256: RuntimeSha256Schema,
    executionBindingAuthority: z.literal("caller_bound_not_authorized"),
    jobId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    stageId: z.literal("inspect_sources"),
    workerProfileSha256: RuntimeSha256Schema,
    workerProfileBindingAuthority: z.literal("caller_bound_not_allowlisted"),
    ingestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    inspectionKind: z.literal("exact_byte_identity_and_bounded_detection"),
    assets: z.array(InspectedSourceAssetV0Schema).min(1).max(100_000),
    policy: z
      .object({
        sourceAccess: z.literal("read_only_verified_stage"),
        payloadDecoding: z.literal("none"),
        reconstruction: z.literal("none"),
        modelInference: z.literal("none"),
        modelTraining: z.literal("none"),
        networkClients: z.literal("none"),
        databaseMutation: z.literal("none"),
        objectStoreMutation: z.literal("none"),
        signing: z.literal("none"),
        publication: z.literal("none"),
        controlPlaneAuthorization: z.literal("not_established_by_worker"),
        workerProfileTrust: z.literal("not_established_by_worker"),
      })
      .strict(),
    authority: z.literal("none"),
    limitations: z.tuple([
      z.literal("Byte identity and declared metadata do not establish reconstruction fitness."),
      z.literal("This worker does not add visual detail or establish physical accuracy."),
      z.literal("No output is registered, promoted, signed, or published by this worker."),
      z.literal("Execution authority, live approval, and fence ownership must be established by the durable control plane."),
      z.literal("Worker-profile allowlisting and validity-at-dispatch are not established by this worker."),
      z.literal("Bounded format detection is not a payload decode or fitness determination."),
    ]),
  })
  .strict();

const InspectSourcesReportPayloadSchema =
  InspectSourcesReportPayloadObjectSchema.superRefine((report, ctx) => {
    const assetIds = report.assets.map((asset) => asset.assetId);
    if (!isStrictlySortedUnique(assetIds)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "inspected source assets must be unique and sorted by asset ID",
      });
    }
  });

type InspectSourcesReportPayload = z.infer<
  typeof InspectSourcesReportPayloadSchema
>;

export const FoundryInspectSourcesReportV0Schema =
  InspectSourcesReportPayloadObjectSchema.extend({
    reportSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((report, ctx) => {
      const { reportSha256: _reportSha256, ...payload } = report;
      const parsed = InspectSourcesReportPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        report.reportSha256 !==
          computeFoundryInspectSourcesReportSha256(parsed.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportSha256"],
          message: "source inspection report digest does not match its payload",
        });
      }
    });
export type FoundryInspectSourcesReportV0 = z.infer<
  typeof FoundryInspectSourcesReportV0Schema
>;

const WorkerArtifactEntryV0Schema = z
  .object({
    path: z.literal(FOUNDRY_INSPECT_SOURCES_REPORT_PATH),
    role: z.literal("source_inspection_report"),
    mediaType: z.literal("application/json"),
    sizeBytes: z.number().int().safe().positive(),
    sha256: RuntimeSha256Schema,
    subjectSha256: RuntimeSha256Schema,
  })
  .strict();

const WorkerArtifactIndexPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_WORKER_ARTIFACT_INDEX_V0),
    invocationSha256: RuntimeSha256Schema,
    claimedExecutionSubjectSha256: RuntimeSha256Schema,
    executionBindingAuthority: z.literal("caller_bound_not_authorized"),
    jobId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    stageId: z.literal("inspect_sources"),
    workerProfileSha256: RuntimeSha256Schema,
    workerProfileBindingAuthority: z.literal("caller_bound_not_allowlisted"),
    ingestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    artifacts: z.tuple([WorkerArtifactEntryV0Schema]),
    commitMarker: z.literal("index_content_fsynced_last"),
    authority: z.literal("none"),
    capabilities: z
      .object({
        immutableRegistration: z.literal("not_authorized"),
        canonicalStateMutation: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

type WorkerArtifactIndexPayload = z.infer<
  typeof WorkerArtifactIndexPayloadObjectSchema
>;

export const FoundryWorkerArtifactIndexV0Schema =
  WorkerArtifactIndexPayloadObjectSchema.extend({
    artifactIndexSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((index, ctx) => {
      const { artifactIndexSha256: _artifactIndexSha256, ...payload } = index;
      const parsed = WorkerArtifactIndexPayloadObjectSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        index.artifactIndexSha256 !==
          computeFoundryWorkerArtifactIndexSha256(parsed.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactIndexSha256"],
          message: "worker artifact index digest does not match its payload",
        });
      }
    });
export type FoundryWorkerArtifactIndexV0 = z.infer<
  typeof FoundryWorkerArtifactIndexV0Schema
>;

function prefixedDomainDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function computeFoundryInspectSourcesInvocationSha256(
  input: unknown,
): string {
  const invocation = FoundryInspectSourcesInvocationV0Schema.parse(input);
  return prefixedDomainDigest(
    INSPECT_SOURCES_INVOCATION_DIGEST_DOMAIN,
    invocation,
  );
}

export function computeFoundryInspectSourcesReportSha256(
  input: InspectSourcesReportPayload,
): string {
  const report = InspectSourcesReportPayloadSchema.parse(input);
  return prefixedDomainDigest(INSPECT_SOURCES_REPORT_DIGEST_DOMAIN, report);
}

export function computeFoundryWorkerArtifactIndexSha256(
  input: WorkerArtifactIndexPayload,
): string {
  const index = WorkerArtifactIndexPayloadObjectSchema.parse(input);
  return prefixedDomainDigest(WORKER_ARTIFACT_INDEX_DIGEST_DOMAIN, index);
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}

function fileIdentity(metadata: FileIdentity): FileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail("INSPECT_SOURCES_CANCELLED", "The sealed source inspection was cancelled.");
  }
}

async function canonicalExistingDirectoryWithoutAliases(
  input: string,
  label: string,
): Promise<string> {
  const requested = resolve(input);
  const before = await lstat(requested);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail(
      "INSPECT_SOURCES_UNSAFE_DIRECTORY",
      `${label} must be a regular directory, not a link or reparse-point alias.`,
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
      "INSPECT_SOURCES_DIRECTORY_ALIAS",
      `${label} must not resolve through a link or reparse-point alias.`,
    );
  }
  return canonical;
}

function resolveContained(root: string, relativePath: string): string {
  const safe = FoundryRelativePathSchema.parse(relativePath);
  const candidate = resolve(root, ...safe.split("/"));
  if (candidate === root || !pathIsWithin(root, candidate)) {
    fail(
      "INSPECT_SOURCES_PATH_ESCAPE",
      `A sealed worker path escapes its granted root: ${relativePath}.`,
    );
  }
  return candidate;
}

async function snapshotSingleLinkFiles(
  root: string,
): Promise<ReadonlyMap<string, FileIdentity>> {
  const files = new Map<string, FileIdentity>();
  let directoryCount = 1;
  async function walk(directory: string, parts: readonly string[]): Promise<void> {
    if (parts.length > MAXIMUM_SNAPSHOT_DEPTH) {
      fail(
        "INSPECT_SOURCES_STAGE_DEPTH_EXCEEDED",
        "The sealed worker input exceeds its fixed directory-depth limit.",
      );
    }
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const childParts = [...parts, entry.name];
      const relativePath = FoundryRelativePathSchema.parse(childParts.join("/"));
      const absolutePath = resolve(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        fail(
          "INSPECT_SOURCES_LINK_REJECTED",
          `The verified stage contains a link or reparse-point alias: ${relativePath}.`,
        );
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > MAXIMUM_SNAPSHOT_DIRECTORIES) {
          fail(
            "INSPECT_SOURCES_STAGE_DIRECTORY_LIMIT_EXCEEDED",
            "The sealed worker input exceeds its fixed directory-count limit.",
          );
        }
        const canonical = await realpath(absolutePath);
        if (comparable(canonical) !== comparable(absolutePath)) {
          fail(
            "INSPECT_SOURCES_DIRECTORY_ALIAS",
            `The verified stage contains an aliased directory: ${relativePath}.`,
          );
        }
        await walk(absolutePath, childParts);
        continue;
      }
      if (!entry.isFile() || !metadata.isFile()) {
        fail(
          "INSPECT_SOURCES_NON_REGULAR_ENTRY",
          `The verified stage contains a non-regular entry: ${relativePath}.`,
        );
      }
      if (metadata.nlink !== 1) {
        fail(
          "INSPECT_SOURCES_HARDLINK_REJECTED",
          `The verified stage contains a multiply linked file: ${relativePath}.`,
        );
      }
      if (files.size >= MAXIMUM_SNAPSHOT_FILES) {
        fail(
          "INSPECT_SOURCES_STAGE_FILE_LIMIT_EXCEEDED",
          "The sealed worker input exceeds its fixed file-count limit.",
        );
      }
      files.set(relativePath, fileIdentity(metadata));
    }
  }
  await walk(root, []);
  return files;
}

function assertSnapshotsEqual(
  before: ReadonlyMap<string, FileIdentity>,
  after: ReadonlyMap<string, FileIdentity>,
): void {
  if (before.size !== after.size) {
    fail(
      "INSPECT_SOURCES_STAGE_CHANGED",
      "The verified stage file set changed during sealed inspection.",
    );
  }
  for (const [path, identity] of before) {
    const next = after.get(path);
    if (next === undefined || !sameFileIdentity(identity, next)) {
      fail(
        "INSPECT_SOURCES_STAGE_CHANGED",
        `A verified stage file changed during sealed inspection: ${path}.`,
      );
    }
  }
}

async function readExactRegularFile(
  path: string,
  expectedSizeBytes: number,
  expectedSha256: string | null,
  maximumBytes: number,
  signal?: AbortSignal,
  expectedIdentity?: FileIdentity,
): Promise<Buffer> {
  assertNotCancelled(signal);
  if (expectedSizeBytes > maximumBytes) {
    fail(
      "INSPECT_SOURCES_CONTROL_FILE_TOO_LARGE",
      "A sealed worker control JSON file exceeds its fixed byte limit.",
    );
  }
  const pathBefore = await lstat(path);
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1 ||
    pathBefore.size !== expectedSizeBytes ||
    (expectedIdentity !== undefined &&
      !sameFileIdentity(expectedIdentity, fileIdentity(pathBefore)))
  ) {
    fail(
      "INSPECT_SOURCES_FILE_UNSAFE",
      "A sealed worker input is not one single-link regular file.",
    );
  }
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const pathAfterOpen = await lstat(path);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      pathAfterOpen.isSymbolicLink() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.nlink !== 1 ||
      !sameFileIdentity(fileIdentity(pathBefore), fileIdentity(before)) ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(pathAfterOpen))
    ) {
      fail(
        "INSPECT_SOURCES_FILE_CHANGED",
        "A sealed worker input changed before its handle-bound read.",
      );
    }
    const bytes = Buffer.allocUnsafe(expectedSizeBytes);
    let position = 0;
    while (position < expectedSizeBytes) {
      assertNotCancelled(signal);
      const { bytesRead } = await handle.read(
        bytes,
        position,
        expectedSizeBytes - position,
        position,
      );
      if (bytesRead === 0) {
        fail(
          "INSPECT_SOURCES_FILE_DIGEST_MISMATCH",
          "A sealed worker control file ended before its admitted byte count.",
        );
      }
      position += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytesRead } = await handle.read(
      overflowProbe,
      0,
      1,
      expectedSizeBytes,
    );
    assertNotCancelled(signal);
    const [after, pathAfter] = await Promise.all([handle.stat(), lstat(path)]);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.nlink !== 1 ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(after)) ||
      !sameFileIdentity(fileIdentity(after), fileIdentity(pathAfter)) ||
      overflowBytesRead !== 0 ||
      bytes.length !== expectedSizeBytes ||
      (expectedSha256 !== null &&
        `sha256:${sha256Bytes(bytes)}` !== expectedSha256)
    ) {
      fail(
        "INSPECT_SOURCES_FILE_DIGEST_MISMATCH",
        "A sealed worker control file does not match its immutable ledger.",
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function hashExactRegularFile(
  path: string,
  relativePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<{
  readonly headerBytesRead: number;
  readonly magicHex: string;
  readonly detection: z.infer<typeof FoundryFileDetectionSchema>;
}> {
  assertNotCancelled(signal);
  const pathBefore = await lstat(path);
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1 ||
    !Number.isSafeInteger(pathBefore.size)
  ) {
    fail(
      "INSPECT_SOURCES_FILE_UNSAFE",
      "A sealed worker source is not one single-link regular file.",
    );
  }
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const pathAfterOpen = await lstat(path);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      pathAfterOpen.isSymbolicLink() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.nlink !== 1 ||
      !sameFileIdentity(fileIdentity(pathBefore), fileIdentity(before)) ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(pathAfterOpen))
    ) {
      fail(
        "INSPECT_SOURCES_FILE_CHANGED",
        "A sealed worker source changed before its handle-bound hash.",
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(FOUNDRY_HASH_BUFFER_BYTES);
    const retainedHead = Buffer.allocUnsafe(
      Math.min(FOUNDRY_MAX_HASH_HEAD_BYTES, before.size),
    );
    let retainedHeadBytes = 0;
    let position = 0;
    while (position < expectedSizeBytes) {
      assertNotCancelled(signal);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, expectedSizeBytes - position),
        position,
      );
      if (bytesRead === 0) {
        fail(
          "INSPECT_SOURCES_FILE_DIGEST_MISMATCH",
          "A sealed worker source ended before its admitted byte count.",
        );
      }
      digest.update(buffer.subarray(0, bytesRead));
      const remainingHeadBytes = retainedHead.length - retainedHeadBytes;
      if (remainingHeadBytes > 0) {
        const copied = Math.min(bytesRead, remainingHeadBytes);
        buffer.copy(retainedHead, retainedHeadBytes, 0, copied);
        retainedHeadBytes += copied;
      }
      position += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytesRead } = await handle.read(
      overflowProbe,
      0,
      1,
      expectedSizeBytes,
    );
    assertNotCancelled(signal);
    const [after, pathAfter] = await Promise.all([handle.stat(), lstat(path)]);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.nlink !== 1 ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(after)) ||
      !sameFileIdentity(fileIdentity(after), fileIdentity(pathAfter)) ||
      overflowBytesRead !== 0 ||
      position !== expectedSizeBytes ||
      `sha256:${digest.digest("hex")}` !== expectedSha256
    ) {
      fail(
        "INSPECT_SOURCES_FILE_DIGEST_MISMATCH",
        "A sealed worker source does not match its admitted size and SHA-256.",
      );
    }
    const head = retainedHead.subarray(0, retainedHeadBytes);
    const magicHex = head.subarray(0, 128).toString("hex");
    return {
      headerBytesRead: head.length,
      magicHex,
      detection: classifyUniversalIntakeProbe({
        relativePath,
        magicHex,
        boundedHeaderText: head
          .toString("utf8")
          .slice(0, FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS),
      }),
    };
  } finally {
    await handle.close();
  }
}

type StagingIndexFile = FoundryIntakeStagingIndexV0["files"][number];

function indexFilesByPath(
  index: FoundryIntakeStagingIndexV0,
): ReadonlyMap<string, StagingIndexFile> {
  const byPath = new Map<string, StagingIndexFile>();
  for (const file of index.files) {
    if (byPath.has(file.path)) {
      fail(
        "INSPECT_SOURCES_INDEX_PATH_DUPLICATE",
        `The verified stage index repeats a file path: ${file.path}.`,
      );
    }
    byPath.set(file.path, file);
  }
  return byPath;
}

function indexedFile(
  filesByPath: ReadonlyMap<string, StagingIndexFile>,
  path: string,
): StagingIndexFile {
  const file = filesByPath.get(path);
  if (file === undefined) {
    fail(
      "INSPECT_SOURCES_INDEX_ENTRY_MISSING",
      `The verified stage index does not declare ${path}.`,
    );
  }
  return file;
}

async function readIndexedJson(
  stageRoot: string,
  filesByPath: ReadonlyMap<string, StagingIndexFile>,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const file = indexedFile(filesByPath, path);
  const bytes = await readExactRegularFile(
    resolveContained(stageRoot, path),
    file.sizeBytes,
    `sha256:${file.sha256}`,
    MAXIMUM_CONTROL_JSON_BYTES,
    signal,
  );
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error: unknown) {
    fail(
      "INSPECT_SOURCES_CONTROL_JSON_INVALID",
      `The verified stage contains invalid JSON at ${path}.`,
      error,
    );
  }
}

function inspectedAsset(
  asset: FoundryInputAsset,
  bounded: Awaited<ReturnType<typeof hashExactRegularFile>>,
): z.infer<
  typeof InspectedSourceAssetV0Schema
> {
  return {
    assetId: asset.id,
    relativePath: asset.relativePath,
    inputType: asset.inputType,
    mediaType: asset.mediaType,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    captureState: asset.captureState,
    accessState: asset.accessState,
    provenanceClass: asset.provenanceClass,
    coordinateFrameId: asset.coordinateFrameId,
    byteVerification: "full_sha256_handle_bound",
    boundedDetection: {
      method: "bounded_header_no_payload_decode",
      headerBytesRead: bounded.headerBytesRead,
      magicHex: bounded.magicHex,
      detection: bounded.detection,
      declaredInputTypeObserved: bounded.detection.candidates.some(
        (candidate) => candidate.inputType === asset.inputType,
      ),
    },
  };
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

interface ReservedOutputFile {
  readonly path: string;
  readonly fileName: string;
  readonly handle: Awaited<ReturnType<typeof open>>;
  readonly identity: { readonly dev: number; readonly ino: number };
}

async function openExclusiveOutputFile(
  root: string,
  rootIdentity: DirectoryIdentity,
  fileName: string,
): Promise<ReservedOutputFile> {
  await assertSameDirectory(root, rootIdentity, "The reserved worker output");
  const path = resolve(root, fileName);
  const handle = await open(path, "wx", 0o600);
  try {
    const opened = await handle.stat();
    const pathAfterOpen = await lstat(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      pathAfterOpen.isSymbolicLink() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.nlink !== 1 ||
      opened.dev !== pathAfterOpen.dev ||
      opened.ino !== pathAfterOpen.ino
    ) {
      fail(
        "INSPECT_SOURCES_OUTPUT_FILE_CHANGED",
        `The reserved output file changed before write: ${fileName}.`,
      );
    }
    await assertSameDirectory(root, rootIdentity, "The reserved worker output");
    return {
      path,
      fileName,
      handle,
      identity: { dev: opened.dev, ino: opened.ino },
    };
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

async function writeReservedOutputFile(
  root: string,
  rootIdentity: DirectoryIdentity,
  file: ReservedOutputFile,
  bytes: Buffer,
): Promise<void> {
  await assertSameDirectory(root, rootIdentity, "The reserved worker output");
  const before = await file.handle.stat();
  const pathBefore = await lstat(file.path);
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size !== 0 ||
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1 ||
    before.dev !== file.identity.dev ||
    before.ino !== file.identity.ino ||
    pathBefore.dev !== file.identity.dev ||
    pathBefore.ino !== file.identity.ino
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_FILE_CHANGED",
      `The reserved output file changed before write: ${file.fileName}.`,
    );
  }
  await file.handle.writeFile(bytes);
  await file.handle.sync();
  const written = await file.handle.stat();
  const pathAfterWrite = await lstat(file.path);
  if (
    !written.isFile() ||
    written.nlink !== 1 ||
    written.size !== bytes.length ||
    pathAfterWrite.isSymbolicLink() ||
    !pathAfterWrite.isFile() ||
    pathAfterWrite.nlink !== 1 ||
    written.dev !== file.identity.dev ||
    written.ino !== file.identity.ino ||
    pathAfterWrite.dev !== file.identity.dev ||
    pathAfterWrite.ino !== file.identity.ino
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_FILE_CHANGED",
      `The reserved output file changed during write: ${file.fileName}.`,
    );
  }
  await assertSameDirectory(root, rootIdentity, "The reserved worker output");
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

interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

function directoryIdentity(metadata: { readonly dev: number; readonly ino: number }): DirectoryIdentity {
  return { dev: metadata.dev, ino: metadata.ino };
}

async function assertSameDirectory(
  path: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.dev !== expected.dev ||
    metadata.ino !== expected.ino ||
    comparable(await realpath(path)) !== comparable(path)
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_DIRECTORY_CHANGED",
      `${label} changed during the sealed worker commit.`,
    );
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  fail(
    "INSPECT_SOURCES_OUTPUT_EXISTS",
    "The sealed worker output directory already exists and will not be replaced.",
  );
}

async function prepareOutputPath(
  stageRoot: string,
  outputInput: string,
): Promise<{
  readonly output: string;
  readonly parent: string;
  readonly parentIdentity: DirectoryIdentity;
}> {
  const output = resolve(outputInput);
  const parent = await canonicalExistingDirectoryWithoutAliases(
    dirname(output),
    "The worker-owned output parent",
  );
  const canonicalOutput = resolve(parent, basename(output));
  if (canonicalOutput !== output) {
    fail(
      "INSPECT_SOURCES_OUTPUT_ALIAS",
      "The sealed worker output path must be canonical within its owned parent.",
    );
  }
  if (pathIsWithin(stageRoot, output) || pathIsWithin(output, stageRoot)) {
    fail(
      "INSPECT_SOURCES_OUTPUT_OVERLAP",
      "The sealed worker output must be disjoint from the verified input stage.",
    );
  }
  await assertPathMissing(output);
  const parentMetadata = await lstat(parent);
  if (
    process.platform !== "win32" &&
    (typeof process.getuid !== "function" ||
      parentMetadata.uid !== process.getuid() ||
      (parentMetadata.mode & 0o077) !== 0)
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_PARENT_NOT_PRIVATE",
      "The sealed worker output parent must be owned by this process user and deny group/other access.",
    );
  }
  return { output, parent, parentIdentity: directoryIdentity(parentMetadata) };
}

interface ReservedOutputFiles {
  readonly rootIdentity: DirectoryIdentity;
  readonly report: ReservedOutputFile;
  readonly index: ReservedOutputFile;
  readonly close: () => Promise<void>;
}

async function reserveOutputFiles(
  outputPath: Awaited<ReturnType<typeof prepareOutputPath>>,
): Promise<ReservedOutputFiles> {
  // Do not recursively delete after this atomic reservation. An interrupted
  // directory contains only invalid/empty authority-none commit files and is
  // left for explicit identity-aware recovery.
  try {
    await mkdir(outputPath.output, { mode: 0o700 });
  } catch (error: unknown) {
    if (errorCode(error) === "EEXIST") {
      fail(
        "INSPECT_SOURCES_OUTPUT_EXISTS",
        "The sealed worker output directory was claimed concurrently and will not be replaced.",
        error,
      );
    }
    throw error;
  }
  const outputMetadata = await lstat(outputPath.output);
  if (outputMetadata.isSymbolicLink() || !outputMetadata.isDirectory()) {
    fail(
      "INSPECT_SOURCES_OUTPUT_RESERVATION_INVALID",
      "The sealed worker could not reserve one private output directory.",
    );
  }
  const rootIdentity = directoryIdentity(outputMetadata);
  await assertSameDirectory(
    outputPath.parent,
    outputPath.parentIdentity,
    "The worker-owned output parent",
  );
  await assertSameDirectory(
    outputPath.output,
    rootIdentity,
    "The reserved worker output",
  );
  let report: ReservedOutputFile | undefined;
  let index: ReservedOutputFile | undefined;
  try {
    report = await openExclusiveOutputFile(
      outputPath.output,
      rootIdentity,
      FOUNDRY_INSPECT_SOURCES_REPORT_PATH,
    );
    index = await openExclusiveOutputFile(
      outputPath.output,
      rootIdentity,
      FOUNDRY_WORKER_ARTIFACT_INDEX_PATH,
    );
    await syncDirectory(outputPath.output);
    await syncDirectory(outputPath.parent);
  } catch (error: unknown) {
    await Promise.allSettled([report?.handle.close(), index?.handle.close()]);
    throw error;
  }
  let closed = false;
  return {
    rootIdentity,
    report,
    index,
    close: async () => {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([
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

export interface RunFoundryInspectSourcesWorkerOptions {
  readonly stageRoot: string;
  readonly outputDirectory: string;
  readonly invocation: unknown;
  readonly signal?: AbortSignal;
}

export interface FoundryInspectSourcesWorkerResult {
  readonly outputDirectory: string;
  readonly report: FoundryInspectSourcesReportV0;
  readonly artifactIndex: FoundryWorkerArtifactIndexV0;
}

export async function runFoundryInspectSourcesWorker(
  options: RunFoundryInspectSourcesWorkerOptions,
): Promise<FoundryInspectSourcesWorkerResult> {
  if (process.platform === "win32") {
    fail(
      "INSPECT_SOURCES_WINDOWS_OUTPUT_PRIVACY_UNVERIFIED",
      "The sealed inspect_sources worker requires a reviewed Windows ACL or OS sandbox backend before production output privacy can be established.",
    );
  }
  return runFoundryInspectSourcesWorkerInternal(options);
}

/**
 * Exercises the platform-independent worker core without claiming that a
 * production Windows output sandbox exists. This symbol is deliberately not
 * re-exported from the package root.
 */
export async function __testOnlyRunFoundryInspectSourcesWorker(
  options: RunFoundryInspectSourcesWorkerOptions,
): Promise<FoundryInspectSourcesWorkerResult> {
  if (process.env.NODE_ENV !== "test") {
    fail(
      "INSPECT_SOURCES_TEST_ONLY_ENTRYPOINT_FORBIDDEN",
      "The inspect_sources test-only entrypoint is available only when NODE_ENV is test.",
    );
  }
  return runFoundryInspectSourcesWorkerInternal(options);
}

async function runFoundryInspectSourcesWorkerInternal(
  options: RunFoundryInspectSourcesWorkerOptions,
): Promise<FoundryInspectSourcesWorkerResult> {
  assertNotCancelled(options.signal);
  const invocation = FoundryInspectSourcesInvocationV0Schema.parse(
    options.invocation,
  );
  const invocationSha256 = computeFoundryInspectSourcesInvocationSha256(
    invocation,
  );
  const stageRoot = await canonicalExistingDirectoryWithoutAliases(
    options.stageRoot,
    "The verified input stage",
  );
  const outputPath = await prepareOutputPath(
    stageRoot,
    options.outputDirectory,
  );
  // Both output file capabilities are opened and identity-checked before any
  // staged control JSON or source payload bytes are read. Artifact bytes are
  // later written only through these retained handles.
  const reservedOutput = await reserveOutputFiles(outputPath);
  try {
  const before = await snapshotSingleLinkFiles(stageRoot);
  const index = FoundryIntakeStagingIndexV0Schema.parse(
    await verifyUniversalIntakeStage(stageRoot),
  );
  const filesByPath = indexFilesByPath(index);
  const afterStageVerification = await snapshotSingleLinkFiles(stageRoot);
  assertSnapshotsEqual(before, afterStageVerification);

  if (
    invocation.evidence.intakeStagingIndexSha256 !==
      `sha256:${index.stagingSha256}` ||
    invocation.evidence.intakeAdmissionResultSha256 !== index.resultSha256 ||
    invocation.evidence.ingestManifestSha256 !== index.manifestSha256
  ) {
    fail(
      "INSPECT_SOURCES_EVIDENCE_BINDING_MISMATCH",
      "The sealed invocation does not bind the exact verified staging, admission, and manifest evidence.",
    );
  }

  const [manifestInput, admissionResultInput] = await Promise.all([
    readIndexedJson(stageRoot, filesByPath, MANIFEST_STAGE_PATH, options.signal),
    readIndexedJson(
      stageRoot,
      filesByPath,
      ADMISSION_RESULT_STAGE_PATH,
      options.signal,
    ),
  ]);
  const manifest = FoundryIngestManifestV0Schema.parse(manifestInput);
  const admissionResult = FoundryIntakeAdmissionResultV0Schema.parse(
    admissionResultInput,
  );
  if (
    computeFoundryIngestManifestSha256(manifest) !==
      invocation.evidence.ingestManifestSha256 ||
    manifest.projectId !== invocation.jobSpec.projectId ||
    admissionResult.resultSha256 !==
      invocation.evidence.intakeAdmissionResultSha256 ||
    admissionResult.manifestSha256 !==
      invocation.evidence.ingestManifestSha256
  ) {
    fail(
      "INSPECT_SOURCES_EVIDENCE_DIGEST_MISMATCH",
      "The sealed worker evidence JSON does not reproduce its bound digests.",
    );
  }
  const rightsDecision = validateFoundryJobRights(invocation.jobSpec, manifest);
  if (!rightsDecision.allowed) {
    fail(
      "INSPECT_SOURCES_RIGHTS_NOT_ALLOWED",
      `The sealed inspect_sources JobSpec does not pass complete purpose-aware rights checks: ${rightsDecision.blockers.join(", ")}.`,
    );
  }

  const manifestAssetIds = manifest.assets.map((asset) => asset.id).sort();
  if (!sameStrings(invocation.stage.inputAssetIds, manifestAssetIds)) {
    fail(
      "INSPECT_SOURCES_ASSET_SET_MISMATCH",
      "The sealed inspect_sources stage must inspect the complete admitted asset set.",
    );
  }
  const assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const inspected: z.infer<typeof InspectedSourceAssetV0Schema>[] = [];
  for (const assetId of invocation.stage.inputAssetIds) {
    assertNotCancelled(options.signal);
    const asset = assetsById.get(assetId);
    if (asset === undefined) {
      fail(
        "INSPECT_SOURCES_ASSET_MISSING",
        `The sealed inspect_sources stage references an absent asset: ${assetId}.`,
      );
    }
    const stagePath = `${STAGED_SOURCE_PREFIX}${asset.relativePath}`;
    const staged = indexedFile(filesByPath, stagePath);
    if (
      staged.role !== "staged_source" ||
      staged.sizeBytes !== asset.sizeBytes ||
      `sha256:${staged.sha256}` !== asset.sha256
    ) {
      fail(
        "INSPECT_SOURCES_ASSET_LEDGER_MISMATCH",
        `The staged ledger does not match admitted asset ${assetId}.`,
      );
    }
    const boundedDetection = await hashExactRegularFile(
      resolveContained(stageRoot, stagePath),
      asset.relativePath,
      asset.sizeBytes,
      asset.sha256,
      options.signal,
    );
    inspected.push(inspectedAsset(asset, boundedDetection));
  }

  const finalStageSnapshot = await snapshotSingleLinkFiles(stageRoot);
  assertSnapshotsEqual(before, finalStageSnapshot);
  assertNotCancelled(options.signal);

  const reportPayload = InspectSourcesReportPayloadSchema.parse({
    schemaVersion: FOUNDRY_INSPECT_SOURCES_REPORT_V0,
    invocationSha256,
    claimedExecutionSubjectSha256: invocation.claimedExecutionSubjectSha256,
    executionBindingAuthority: invocation.executionBindingAuthority,
    jobId: invocation.jobId,
    jobSpecSha256: invocation.jobSpecSha256,
    executionId: invocation.executionId,
    attemptId: invocation.attemptId,
    attemptOrdinal: invocation.attemptOrdinal,
    fencingToken: invocation.fencingToken,
    stageId: "inspect_sources",
    workerProfileSha256: invocation.workerProfileSha256,
    workerProfileBindingAuthority: invocation.workerProfileBindingAuthority,
    ingestManifestSha256: invocation.evidence.ingestManifestSha256,
    intakeAdmissionResultSha256:
      invocation.evidence.intakeAdmissionResultSha256,
    intakeStagingIndexSha256:
      invocation.evidence.intakeStagingIndexSha256,
    inspectionKind: "exact_byte_identity_and_bounded_detection",
    assets: inspected,
    policy: {
      sourceAccess: "read_only_verified_stage",
      payloadDecoding: "none",
      reconstruction: "none",
      modelInference: "none",
      modelTraining: "none",
      networkClients: "none",
      databaseMutation: "none",
      objectStoreMutation: "none",
      signing: "none",
      publication: "none",
      controlPlaneAuthorization: "not_established_by_worker",
      workerProfileTrust: "not_established_by_worker",
    },
    authority: "none",
    limitations: [
      "Byte identity and declared metadata do not establish reconstruction fitness.",
      "This worker does not add visual detail or establish physical accuracy.",
      "No output is registered, promoted, signed, or published by this worker.",
      "Execution authority, live approval, and fence ownership must be established by the durable control plane.",
      "Worker-profile allowlisting and validity-at-dispatch are not established by this worker.",
      "Bounded format detection is not a payload decode or fitness determination.",
    ],
  });
  const report = FoundryInspectSourcesReportV0Schema.parse({
    ...reportPayload,
    reportSha256: computeFoundryInspectSourcesReportSha256(reportPayload),
  });
  const reportBytes = canonicalJsonBytes(report);
  const artifactIndexPayload = WorkerArtifactIndexPayloadObjectSchema.parse({
    schemaVersion: FOUNDRY_WORKER_ARTIFACT_INDEX_V0,
    invocationSha256,
    claimedExecutionSubjectSha256: invocation.claimedExecutionSubjectSha256,
    executionBindingAuthority: invocation.executionBindingAuthority,
    jobId: invocation.jobId,
    jobSpecSha256: invocation.jobSpecSha256,
    executionId: invocation.executionId,
    attemptId: invocation.attemptId,
    attemptOrdinal: invocation.attemptOrdinal,
    fencingToken: invocation.fencingToken,
    stageId: "inspect_sources",
    workerProfileSha256: invocation.workerProfileSha256,
    workerProfileBindingAuthority: invocation.workerProfileBindingAuthority,
    ingestManifestSha256: invocation.evidence.ingestManifestSha256,
    intakeAdmissionResultSha256:
      invocation.evidence.intakeAdmissionResultSha256,
    intakeStagingIndexSha256:
      invocation.evidence.intakeStagingIndexSha256,
    artifacts: [
      {
        path: FOUNDRY_INSPECT_SOURCES_REPORT_PATH,
        role: "source_inspection_report",
        mediaType: "application/json",
        sizeBytes: reportBytes.length,
        sha256: `sha256:${sha256Bytes(reportBytes)}`,
        subjectSha256: report.reportSha256,
      },
    ],
    commitMarker: "index_content_fsynced_last",
    authority: "none",
    capabilities: {
      immutableRegistration: "not_authorized",
      canonicalStateMutation: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
  });
  const artifactIndex = FoundryWorkerArtifactIndexV0Schema.parse({
    ...artifactIndexPayload,
    artifactIndexSha256: computeFoundryWorkerArtifactIndexSha256(
      artifactIndexPayload,
    ),
  });
  const indexBytes = canonicalJsonBytes(artifactIndex);
  await writeReservedOutputFile(
    outputPath.output,
    reservedOutput.rootIdentity,
    reservedOutput.report,
    reportBytes,
  );
  await syncDirectory(outputPath.output);
  assertNotCancelled(options.signal);
  // Index content is the commit marker and is written/fsynced last through
  // the file capability retained before any source bytes were inspected.
  await writeReservedOutputFile(
    outputPath.output,
    reservedOutput.rootIdentity,
    reservedOutput.index,
    indexBytes,
  );
  await syncDirectory(outputPath.output);
  await syncDirectory(outputPath.parent);
  assertNotCancelled(options.signal);
  await assertSameDirectory(
    outputPath.parent,
    outputPath.parentIdentity,
    "The worker-owned output parent",
  );
  await assertSameDirectory(
    outputPath.output,
    reservedOutput.rootIdentity,
    "The committed worker output",
  );
  await reservedOutput.close();
  return await verifyFoundryInspectSourcesOutput(
    outputPath.output,
    invocationSha256,
  );
  } finally {
    await reservedOutput.close();
  }
}

export async function verifyFoundryInspectSourcesOutput(
  outputDirectory: string,
  expectedInvocationSha256?: string,
): Promise<FoundryInspectSourcesWorkerResult> {
  const root = await canonicalExistingDirectoryWithoutAliases(
    outputDirectory,
    "The sealed worker output",
  );
  const snapshot = await snapshotSingleLinkFiles(root);
  const expectedPaths = [
    FOUNDRY_WORKER_ARTIFACT_INDEX_PATH,
    FOUNDRY_INSPECT_SOURCES_REPORT_PATH,
  ];
  if (!sameStrings([...snapshot.keys()].sort(), expectedPaths)) {
    fail(
      "INSPECT_SOURCES_OUTPUT_FILE_SET_MISMATCH",
      "The sealed worker output must contain exactly its report and commit index.",
    );
  }
  const indexIdentity = snapshot.get(FOUNDRY_WORKER_ARTIFACT_INDEX_PATH);
  const reportIdentity = snapshot.get(FOUNDRY_INSPECT_SOURCES_REPORT_PATH);
  if (indexIdentity === undefined || reportIdentity === undefined) {
    fail(
      "INSPECT_SOURCES_OUTPUT_FILE_SET_MISMATCH",
      "The sealed worker output is missing its report or commit index.",
    );
  }
  const indexBytes = await readExactRegularFile(
    resolve(root, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH),
    indexIdentity.size,
    null,
    MAXIMUM_OUTPUT_INDEX_BYTES,
    undefined,
    indexIdentity,
  );
  let indexInput: unknown;
  try {
    indexInput = JSON.parse(indexBytes.toString("utf8"));
  } catch (error: unknown) {
    fail(
      "INSPECT_SOURCES_OUTPUT_JSON_INVALID",
      "The sealed worker output contains invalid JSON.",
      error,
    );
  }
  const artifactIndex = FoundryWorkerArtifactIndexV0Schema.parse(indexInput);
  if (!indexBytes.equals(canonicalJsonBytes(artifactIndex))) {
    fail(
      "INSPECT_SOURCES_OUTPUT_NOT_CANONICAL",
      "The sealed worker artifact index bytes are not canonical JSON.",
    );
  }
  const artifact = artifactIndex.artifacts[0];
  if (
    artifact.sizeBytes !== reportIdentity.size ||
    artifact.sizeBytes > MAXIMUM_OUTPUT_REPORT_BYTES
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_SIZE_MISMATCH",
      "The sealed worker report size does not match its bounded artifact ledger.",
    );
  }
  const reportBytes = await readExactRegularFile(
    resolve(root, FOUNDRY_INSPECT_SOURCES_REPORT_PATH),
    artifact.sizeBytes,
    artifact.sha256,
    MAXIMUM_OUTPUT_REPORT_BYTES,
    undefined,
    reportIdentity,
  );
  let reportInput: unknown;
  try {
    reportInput = JSON.parse(reportBytes.toString("utf8"));
  } catch (error: unknown) {
    fail(
      "INSPECT_SOURCES_OUTPUT_JSON_INVALID",
      "The sealed worker source inspection report is invalid JSON.",
      error,
    );
  }
  const report = FoundryInspectSourcesReportV0Schema.parse(reportInput);
  if (!reportBytes.equals(canonicalJsonBytes(report))) {
    fail(
      "INSPECT_SOURCES_OUTPUT_NOT_CANONICAL",
      "The sealed worker source inspection report bytes are not canonical JSON.",
    );
  }
  if (
    artifact.sha256 !== `sha256:${sha256Bytes(reportBytes)}` ||
    artifact.subjectSha256 !== report.reportSha256 ||
    artifactIndex.invocationSha256 !== report.invocationSha256 ||
    artifactIndex.claimedExecutionSubjectSha256 !==
      report.claimedExecutionSubjectSha256 ||
    artifactIndex.jobId !== report.jobId ||
    artifactIndex.jobSpecSha256 !== report.jobSpecSha256 ||
    artifactIndex.executionId !== report.executionId ||
    artifactIndex.attemptId !== report.attemptId ||
    artifactIndex.fencingToken !== report.fencingToken ||
    artifactIndex.workerProfileSha256 !== report.workerProfileSha256 ||
    artifactIndex.ingestManifestSha256 !== report.ingestManifestSha256 ||
    artifactIndex.intakeAdmissionResultSha256 !==
      report.intakeAdmissionResultSha256 ||
    artifactIndex.intakeStagingIndexSha256 !==
      report.intakeStagingIndexSha256 ||
    (expectedInvocationSha256 !== undefined &&
      artifactIndex.invocationSha256 !==
        RuntimeSha256Schema.parse(expectedInvocationSha256))
  ) {
    fail(
      "INSPECT_SOURCES_OUTPUT_BINDING_MISMATCH",
      "The sealed worker report and artifact index do not bind the same exact output subject.",
    );
  }
  const finalSnapshot = await snapshotSingleLinkFiles(root);
  assertSnapshotsEqual(snapshot, finalSnapshot);
  return { outputDirectory: root, report, artifactIndex };
}
