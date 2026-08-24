import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  FoundryDerivativeRightsApprovalV0Schema,
  FoundryDerivativeRightsTrustedPolicyStateV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
  computeFoundryJobSpecSha256,
  validateFoundryDerivativeRightsApproval,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import {
  FoundryIntakeStagingIndexV0Schema,
  verifyUniversalIntakeStage,
} from "./intake-staging.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
} from "./normalize-mesh-glb-worker.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  runFoundryOfflineNormalizeMeshGlbPreview,
  verifyFoundryOfflineNormalizeMeshGlbPreview,
  verifyFoundryOfflineNormalizeMeshGlbPreviewPermit,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "./offline-normalize-mesh-glb-preview.js";
import type { TrustedDsseKeys } from "./dsse.js";

export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_SUBJECT_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-subject.v0";
export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_STATE_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-state.v0";
export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_CHECKPOINT_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-checkpoint.v0";
export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_RECEIPT_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-receipt.v0";
export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_INDEX_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-index.v0";
export const FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_PERMIT_CONSUMPTION_V0 =
  "omnitwin.foundry.local-resumable-normalization-preview-permit-consumption.v0";

const SUBJECT_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_SUBJECT_V0";
const STATE_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_STATE_V0";
const CHECKPOINT_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_CHECKPOINT_V0";
const RECEIPT_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_RECEIPT_V0";
const INDEX_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_INDEX_V0";
const LEASE_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_LEASE_V0";
const PERMIT_CONSUMPTION_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_PERMIT_CONSUMPTION_V0";
const AUTH_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_RECORD_AUTH_V0";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMAND_ID = /^lnp0-[a-f0-9]{32}$/u;
const SAFE_INTEGER_STRING = /^(?:0|[1-9][0-9]{0,18})$/u;
const STATE_FILE = /^(?<sequence>[0-9]{12})\.json$/u;
const ABANDONED_LEASE_FILE =
  /^abandoned-(?<fencingToken>(?:0|[1-9][0-9]{0,18}))-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lease$/u;
const LEASE_MUTATION_LOCK_NAME = "writer-lease-mutation.lock";
const LEASE_MUTATION_LOCK_BYTES = Buffer.from(
  "venviewer foundry writer lease mutation lock v0\n",
  "utf8",
);
const LINUX_FLOCK_PATH = "/usr/bin/flock";
const MAXIMUM_JSON_BYTES = 64 * 1024 * 1024;
const MANIFEST_PATH = "manifest/foundry-ingest-manifest-v0.json";
const SOURCE_PREFIX = "source/";
const OUTPUT_FILES = [
  "artifact-index.json",
  "execution-receipt.json",
  "normalization-report.json",
  "normalized.glb",
  "transform-checkpoint.json",
] as const;

const SourceBindingSchema = z
  .object({
    assetId: z.string().min(1).max(160),
    relativePath: z.string().min(1).max(4_096),
    inputType: z.literal("glb_gltf"),
    mediaType: z.literal("model/gltf-binary"),
    sizeBytes: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const SubjectMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_SUBJECT_V0,
    ),
    stagingIndexSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    intakeReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    intakeAdmissionResultSha256: z.string().regex(SHA256),
    ingestManifestSha256: z.string().regex(SHA256),
    source: SourceBindingSchema,
    jobSpecSha256: z.string().regex(SHA256),
    jobSubjectSha256: z.string().regex(SHA256),
    derivativeRightsApprovalSha256: z.string().regex(SHA256),
    derivativeRightsPolicyDefinitionSha256: z.string().regex(SHA256),
    derivativeRightsPolicyVersion: z.string().min(1).max(160),
    derivativeRightsPolicyGeneration: z.number().int().positive().safe(),
    previewInvocationSha256: z.string().regex(SHA256),
    permitPayloadSha256: z.string().regex(SHA256),
    permitKeyId: z.string().min(1).max(128),
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION),
    sealedIdentity: z.tuple([
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[0]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[1]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[2]),
    ]),
    executionMode: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    ),
    outputDisposition: z.literal("private_quarantine_review_only"),
    authority: z.literal("none"),
    productionExecution: z.literal("disabled"),
  })
  .strict();

const SubjectSchema = SubjectMaterialSchema.extend({
  commandId: z.string().regex(COMMAND_ID),
  subjectSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type Subject = z.infer<typeof SubjectSchema>;

const StatePhaseSchema = z.enum([
  "ready",
  "running",
  "permit_consumed",
  "checkpointed",
  "paused",
  "verified",
  "succeeded",
  "cancelled",
  "failed",
]);

const StateMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_STATE_V0,
    ),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    sequence: z.number().int().positive().safe(),
    previousStateSha256: z.string().regex(SHA256).nullable(),
    phase: StatePhaseSchema,
    attemptOrdinal: z.number().int().positive().safe(),
    fencingToken: z.string().regex(SAFE_INTEGER_STRING),
    recordedAt: z.string().datetime({ offset: true, precision: 3 }),
    permitConsumed: z.boolean(),
    checkpointSha256: z.string().regex(SHA256).nullable(),
    artifactIndexSha256: z.string().regex(SHA256).nullable(),
    failureCode: z.string().min(1).max(160).nullable(),
    authority: z.literal("none"),
  })
  .strict();

const StateSchema = StateMaterialSchema.extend({
  stateSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type State = z.infer<typeof StateSchema>;
type StatePhase = z.infer<typeof StatePhaseSchema>;

const FileRecordSchema = z
  .object({
    name: z.enum([
      "execution-receipt.json",
      "normalization-report.json",
      "normalized.glb",
      "transform-checkpoint.json",
    ]),
    mediaType: z.enum(["application/json", "model/gltf-binary"]),
    sizeBytes: z.number().int().safe().positive(),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const CheckpointMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_CHECKPOINT_V0,
    ),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    permitPayloadSha256: z.string().regex(SHA256),
    sourceSha256: z.string().regex(SHA256),
    previewInvocationSha256: z.string().regex(SHA256),
    normalizedGlb: z
      .object({
        sizeBytes: z.number().int().safe().positive(),
        sha256: z.string().regex(SHA256),
      })
      .strict(),
    normalizationReport: z
      .object({
        sizeBytes: z.number().int().safe().positive(),
        sha256: z.string().regex(SHA256),
        reportSha256: z.string().regex(SHA256),
      })
      .strict(),
    createdAt: z.string().datetime({ offset: true, precision: 3 }),
    transformCompleted: z.literal(true),
    freshVerificationCompleted: z.literal(false),
    authority: z.literal("none"),
  })
  .strict();

const CheckpointSchema = CheckpointMaterialSchema.extend({
  checkpointSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type Checkpoint = z.infer<typeof CheckpointSchema>;

const ReceiptMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_RECEIPT_V0,
    ),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    checkpointSha256: z.string().regex(SHA256),
    stagingIndexSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    ingestManifestSha256: z.string().regex(SHA256),
    jobSpecSha256: z.string().regex(SHA256),
    derivativeRightsApprovalSha256: z.string().regex(SHA256),
    derivativeRightsPolicyDefinitionSha256: z.string().regex(SHA256),
    previewInvocationSha256: z.string().regex(SHA256),
    permitPayloadSha256: z.string().regex(SHA256),
    source: SourceBindingSchema,
    output: z
      .object({
        sizeBytes: z.number().int().safe().positive(),
        sha256: z.string().regex(SHA256),
        reportSha256: z.string().regex(SHA256),
      })
      .strict(),
    completedAt: z.string().datetime({ offset: true, precision: 3 }),
    outputDisposition: z.literal("private_quarantine_review_only"),
    sourceCustody: z.literal("verified_staged_copy_read_only"),
    outputCustody: z.literal(
      "linux_procfd_bound_atomic_noreplace_private_directory",
    ),
    capabilities: z
      .object({
        review: z.literal("local_only"),
        measurement: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        registration: z.literal("not_authorized"),
        redistribution: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        runtimePromotion: z.literal("not_authorized"),
      })
      .strict(),
    authority: z.literal("none"),
    productionExecution: z.literal("disabled"),
  })
  .strict();

const ReceiptSchema = ReceiptMaterialSchema.extend({
  receiptSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type Receipt = z.infer<typeof ReceiptSchema>;

const IndexMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_INDEX_V0,
    ),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    receiptSha256: z.string().regex(SHA256),
    checkpointSha256: z.string().regex(SHA256),
    files: z.array(FileRecordSchema).length(4),
    commitMarker: z.literal("artifact_index_content_fsynced_last"),
    outputDisposition: z.literal("private_quarantine_review_only"),
    authority: z.literal("none"),
  })
  .strict();

function refineIndexFiles(
  index: { readonly files: readonly { readonly name: string }[] },
  ctx: z.RefinementCtx,
): void {
  const names = index.files.map((file) => file.name);
  const sorted = [...names].sort();
  if (
    new Set(names).size !== names.length ||
    names.some((name, position) => name !== sorted[position])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "artifact files must be unique and sorted",
    });
  }
}

const IndexMaterialSchema =
  IndexMaterialObjectSchema.superRefine(refineIndexFiles);

const IndexSchema = IndexMaterialObjectSchema.extend({
  indexSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
})
  .strict()
  .superRefine(refineIndexFiles);

type Index = z.infer<typeof IndexSchema>;

const LeaseMaterialSchema = z
  .object({
    ownerId: z.string().uuid(),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    fencingToken: z.string().regex(SAFE_INTEGER_STRING),
    acquiredAt: z.string().datetime({ offset: true, precision: 3 }),
  })
  .strict();

const LeaseSchema = LeaseMaterialSchema.extend({
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type LeaseRecord = z.infer<typeof LeaseSchema>;

const PermitConsumptionMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_PERMIT_CONSUMPTION_V0,
    ),
    permitPayloadSha256: z.string().regex(SHA256),
    commandId: z.string().regex(COMMAND_ID),
    subjectSha256: z.string().regex(SHA256),
    consumedAt: z.string().datetime({ offset: true, precision: 3 }),
    disposition: z.literal("globally_consumed_for_one_logical_preview_command"),
    authority: z.literal("none"),
  })
  .strict();

const PermitConsumptionSchema = PermitConsumptionMaterialSchema.extend({
  consumptionSha256: z.string().regex(SHA256),
  authenticationHmacSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type PermitConsumption = z.infer<typeof PermitConsumptionSchema>;

interface HeldLease {
  readonly directory: DirectorySnapshot;
  readonly name: string;
  readonly handle: FileHandle;
  readonly record: LeaseRecord;
  readonly identity: FileIdentity;
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
}

interface ObservedLease {
  readonly handle: FileHandle;
  readonly record: LeaseRecord;
  readonly identity: FileIdentity;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}

interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly mode: number;
}

interface DirectorySnapshot {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly label: string;
  readonly modeMustBePrivate: boolean;
}

interface BoundDirectory {
  readonly handle: FileHandle;
  readonly descriptorPath: string;
}

export type FoundryLocalNormalizationPreviewDurableRecordKind =
  | "subject"
  | "lease"
  | "state"
  | "checkpoint"
  | "receipt"
  | "index"
  | "permit"
  | "normalized_glb"
  | "normalization_report";

export type FoundryLocalNormalizationPreviewDurabilityStage =
  | "after_directory_bind_before_open"
  | "after_open"
  | "after_partial_write"
  | "after_fsync"
  | "after_publish"
  | "after_abandoned_lease_rename";

export interface FoundryLocalNormalizationPreviewDurabilityEvent {
  readonly recordKind: FoundryLocalNormalizationPreviewDurableRecordKind;
  readonly stage: FoundryLocalNormalizationPreviewDurabilityStage;
  readonly finalName: string;
}

export type FoundryLocalNormalizationPreviewDurabilityFaultInjector = (
  event: FoundryLocalNormalizationPreviewDurabilityEvent,
) => void | PromiseLike<void>;

export type FoundryLocalNormalizationPreviewDurablePhase =
  | "permit_consumed"
  | "source_read"
  | "transform_started"
  | "checkpoint_committed"
  | "fresh_verification_completed"
  | "output_committed";

export interface FoundryLocalNormalizationPreviewPhaseEvent {
  readonly commandId: string;
  readonly phase: FoundryLocalNormalizationPreviewDurablePhase;
  readonly attemptOrdinal: number;
  readonly fencingToken: string;
}

export interface FoundryLocalNormalizationPreviewAbandonedLease {
  readonly commandId: string;
  readonly ownerId: string;
  readonly fencingToken: string;
  readonly acquiredAt: string;
}

export interface RunFoundryLocalResumableNormalizationPreviewOptions {
  readonly stagedIntakeDirectory: string;
  readonly jobSpec: unknown;
  readonly derivativeRightsApproval: unknown;
  readonly previewInvocation: unknown;
  readonly permitEnvelope: unknown;
  readonly signal?: AbortSignal;
  /** Safe pause point after a complete, authenticated transform checkpoint. */
  readonly pauseAfterCheckpoint?: boolean;
  /**
   * Recovery probe: stop after the receipt or index is durable, before the
   * corresponding state-chain advance, mirroring an abrupt process exit.
   */
  readonly pauseAfterCommitBoundary?: "receipt" | "index";
  /** Host-owned observer. It carries no authority and its failures fail closed. */
  readonly onPhase?: (
    event: FoundryLocalNormalizationPreviewPhaseEvent,
  ) => void | PromiseLike<void>;
}

export interface CreateFoundryLocalResumableNormalizationPreviewServiceOptions {
  /** Host-owned and pinned for the lifetime of this service instance. */
  readonly stateRoot: string;
  /**
   * Host-owned global ledger, separate from caller-selectable command state.
   * Deleting or switching this root is an administrative trust-boundary reset.
   */
  readonly permitLedgerRoot: string;
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
  readonly recordAuthenticationKey: Uint8Array;
  /** Host-owned authoritative policy/revocation lookup, never request data. */
  readonly getTrustedDerivativeRightsPolicyState: () => unknown;
  /**
   * Optional host-pinned abandonment oracle. Returning true fences the prior
   * owner by atomically renaming its authenticated lease. Request data can
   * never supply or override this decision.
   */
  readonly confirmAbandonedLease?: (
    lease: FoundryLocalNormalizationPreviewAbandonedLease,
  ) => boolean | PromiseLike<boolean>;
  /** Host-only crash-conformance hook; never accept this from request data. */
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
}

export interface FoundryLocalResumableNormalizationPreviewService {
  run(
    options: RunFoundryLocalResumableNormalizationPreviewOptions,
  ): Promise<FoundryLocalNormalizationPreviewRunResult>;
}

export interface FoundryLocalNormalizationPreviewSucceededResult {
  readonly status: "succeeded" | "already_succeeded";
  readonly commandId: string;
  readonly outputDirectory: string;
  readonly normalizedGlbPath: string;
  readonly reportPath: string;
  readonly receipt: Receipt;
  readonly index: Index;
  readonly authority: "none";
  readonly productionExecution: "disabled";
}

export interface FoundryLocalNormalizationPreviewPausedResult {
  readonly status: "paused";
  readonly commandId: string;
  readonly checkpointSha256: string;
  readonly authority: "none";
  readonly productionExecution: "disabled";
}

export interface FoundryLocalNormalizationPreviewCancelledResult {
  readonly status: "cancelled";
  readonly commandId: string;
  readonly permitConsumed: boolean;
  readonly authority: "none";
  readonly productionExecution: "disabled";
}

export type FoundryLocalNormalizationPreviewRunResult =
  | FoundryLocalNormalizationPreviewSucceededResult
  | FoundryLocalNormalizationPreviewPausedResult
  | FoundryLocalNormalizationPreviewCancelledResult;

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

function throwUnknown(error: unknown): never {
  if (error instanceof Error) throw error;
  throw new Error("A non-Error value escaped a durable filesystem operation.", {
    cause: error,
  });
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function hmac(key: Uint8Array, domain: string, value: unknown): string {
  return createHmac("sha256", key)
    .update(AUTH_DOMAIN, "utf8")
    .update("\n", "ascii")
    .update(domain, "utf8")
    .update("\n", "ascii")
    .update(stableCanonicalJson(toCanonicalJson(value)), "utf8")
    .digest("hex");
}

function authenticate(
  key: Uint8Array,
  domain: string,
  value: Record<string, unknown>,
): void {
  const actual = value.authenticationHmacSha256;
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/u.test(actual)) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECORD_AUTHENTICATION_MISSING",
      "A durable local preview record has no authentication tag.",
    );
  }
  const material = { ...value };
  delete material.authenticationHmacSha256;
  const expected = hmac(key, domain, material);
  if (
    !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECORD_AUTHENTICATION_FAILED",
      "A durable local preview record failed keyed authentication.",
    );
  }
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(toCanonicalJson(value))}\n`,
    "utf8",
  );
}

function ownRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function identity(metadata: FileIdentity): FileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
  };
}

function directoryIdentity(metadata: {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly mode: number;
}): DirectoryIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    mode: metadata.mode,
  };
}

function sameDirectoryIdentity(
  left: DirectoryIdentity,
  right: DirectoryIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

function assertSupportedDurableFilesystemPlatform(): void {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_PLATFORM_UNSUPPORTED",
      "The durable executor is disabled on this platform: its built-in confinement requires Linux /proc/self/fd directory-handle binding and atomic hard-link publication. Windows and macOS need a separately reviewed OS-private sandbox backend.",
    );
  }
}

function requiredLinuxFsConstant(
  name:
    | "O_CREAT"
    | "O_DIRECTORY"
    | "O_EXCL"
    | "O_NOFOLLOW"
    | "O_RDONLY"
    | "O_WRONLY",
): number {
  assertSupportedDurableFilesystemPlatform();
  const value: unknown = fsConstants[name];
  if (typeof value !== "number") {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_PLATFORM_UNSUPPORTED",
      `The Linux runtime does not expose the required ${name} filesystem flag.`,
    );
  }
  return value;
}

function linuxDirectoryReadFlags(): number {
  return (
    requiredLinuxFsConstant("O_RDONLY") |
    requiredLinuxFsConstant("O_DIRECTORY") |
    requiredLinuxFsConstant("O_NOFOLLOW")
  );
}

function linuxNoFollowReadFlags(): number {
  return (
    requiredLinuxFsConstant("O_RDONLY") | requiredLinuxFsConstant("O_NOFOLLOW")
  );
}

function linuxAtomicWriteFlags(): number {
  return (
    requiredLinuxFsConstant("O_WRONLY") |
    requiredLinuxFsConstant("O_CREAT") |
    requiredLinuxFsConstant("O_EXCL") |
    requiredLinuxFsConstant("O_NOFOLLOW")
  );
}

function currentUid(): number {
  const getuid = process.getuid;
  if (typeof getuid !== "function") {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_PLATFORM_UNSUPPORTED",
      "The durable executor requires a POSIX process identity.",
    );
  }
  return getuid();
}

function safeEntryName(name: string): string {
  if (
    basename(name) !== name ||
    name === "." ||
    name === ".." ||
    name.includes("\0")
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_ENTRY_NAME_UNSAFE",
      "A durable local preview entry name is unsafe.",
    );
  }
  return name;
}

class InjectedDurabilityInterruption extends Error {
  readonly code = "LOCAL_NORMALIZATION_PREVIEW_DURABILITY_FAULT_INJECTED";

  constructor(
    readonly event: FoundryLocalNormalizationPreviewDurabilityEvent,
    options: { readonly cause: unknown },
  ) {
    super(
      `Injected durability interruption at ${event.recordKind}:${event.stage}.`,
      options,
    );
    this.name = "InjectedDurabilityInterruption";
  }
}

async function injectDurabilityFault(
  injector: FoundryLocalNormalizationPreviewDurabilityFaultInjector | undefined,
  event: FoundryLocalNormalizationPreviewDurabilityEvent,
): Promise<void> {
  if (injector === undefined) return;
  try {
    await injector(event);
  } catch (error: unknown) {
    throw new InjectedDurabilityInterruption(event, { cause: error });
  }
}

function isInjectedDurabilityInterruption(
  error: unknown,
): error is InjectedDurabilityInterruption {
  return error instanceof InjectedDurabilityInterruption;
}

async function openBoundDirectory(
  snapshot: DirectorySnapshot,
): Promise<BoundDirectory> {
  assertSupportedDurableFilesystemPlatform();
  let handle: FileHandle;
  try {
    handle = await open(snapshot.path, linuxDirectoryReadFlags());
  } catch (error: unknown) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_CHANGED",
      `${snapshot.label} could not be reopened without following links.`,
      error,
    );
  }
  const descriptorPath = `/proc/self/fd/${String(handle.fd)}`;
  try {
    const [handleMetadata, pathMetadata, descriptorMetadata, canonical] =
      await Promise.all([
        handle.stat(),
        lstat(snapshot.path),
        stat(`${descriptorPath}/.`),
        realpath(snapshot.path),
      ]);
    if (
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isDirectory() ||
      !handleMetadata.isDirectory() ||
      !descriptorMetadata.isDirectory() ||
      comparable(canonical) !== comparable(snapshot.path) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(pathMetadata),
      ) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(handleMetadata),
      ) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(descriptorMetadata),
      ) ||
      pathMetadata.uid !== currentUid() ||
      (snapshot.modeMustBePrivate && (pathMetadata.mode & 0o077) !== 0)
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_CHANGED",
        `${snapshot.label} no longer resolves to its process-private pinned directory identity.`,
      );
    }
    return { handle, descriptorPath };
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

async function withBoundDirectory<T>(
  snapshot: DirectorySnapshot,
  operation: (directory: BoundDirectory) => Promise<T>,
): Promise<T> {
  const bound = await openBoundDirectory(snapshot);
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation(bound);
  } catch (error: unknown) {
    operationError = error;
  }
  let validationError: unknown;
  try {
    const [handleMetadata, pathMetadata, descriptorMetadata, canonical] =
      await Promise.all([
        bound.handle.stat(),
        lstat(snapshot.path),
        stat(`${bound.descriptorPath}/.`),
        realpath(snapshot.path),
      ]);
    if (
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isDirectory() ||
      comparable(canonical) !== comparable(snapshot.path) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(handleMetadata),
      ) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(pathMetadata),
      ) ||
      !sameDirectoryIdentity(
        snapshot.identity,
        directoryIdentity(descriptorMetadata),
      )
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_CHANGED",
        `${snapshot.label} changed during a directory-handle-bound operation.`,
      );
    }
  } catch (error: unknown) {
    validationError = error;
  }
  await bound.handle.close();
  if (operationError !== undefined) throwUnknown(operationError);
  if (validationError !== undefined) throwUnknown(validationError);
  return result as T;
}

function boundEntryPath(directory: BoundDirectory, name: string): string {
  return resolve(directory.descriptorPath, safeEntryName(name));
}

async function readBoundedRegularFileByPath(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const beforePath = await lstat(path);
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.nlink !== 1 ||
    beforePath.size <= 0 ||
    beforePath.size > maximumBytes
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_FILE_UNSAFE",
      `A local preview file is linked, non-regular, empty, or out of bounds: ${basename(path)}`,
    );
  }
  const handle = await open(path, linuxNoFollowReadFlags());
  try {
    const beforeHandle = await handle.stat();
    if (!sameFileIdentity(identity(beforePath), identity(beforeHandle))) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_FILE_CHANGED",
        `A local preview file changed before its handle-bound read: ${basename(path)}`,
      );
    }
    const bytes = Buffer.allocUnsafe(beforeHandle.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead <= 0) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_FILE_TRUNCATED",
          `A local preview file ended before its bounded size: ${basename(path)}`,
        );
      }
      offset += result.bytesRead;
    }
    const [afterHandle, afterPath] = await Promise.all([
      handle.stat(),
      lstat(path),
    ]);
    if (
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.nlink !== 1 ||
      !sameFileIdentity(identity(beforeHandle), identity(afterHandle)) ||
      !sameFileIdentity(identity(afterHandle), identity(afterPath))
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_FILE_CHANGED",
        `A local preview file changed during its handle-bound read: ${basename(path)}`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function canonicalDirectory(
  input: string,
  label: string,
  create: boolean = true,
): Promise<string> {
  assertSupportedDurableFilesystemPlatform();
  const requested = resolve(input);
  if (create) await mkdir(requested, { recursive: true, mode: 0o700 });
  const before = await lstat(requested);
  const canonical = await realpath(requested);
  const after = await lstat(requested);
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    comparable(canonical) !== comparable(requested)
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_UNSAFE",
      `${label} must be a canonical local directory without a link or reparse-point alias.`,
    );
  }
  if (after.uid !== currentUid() || (after.mode & 0o077) !== 0) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_NOT_PRIVATE",
      `${label} must be process-owned and deny group/other access.`,
    );
  }
  return canonical;
}

async function captureDirectorySnapshot(
  input: string,
  label: string,
  create: boolean = true,
): Promise<DirectorySnapshot> {
  const path = await canonicalDirectory(input, label, create);
  const metadata = await lstat(path);
  const snapshot = {
    path,
    identity: directoryIdentity(metadata),
    label,
    modeMustBePrivate: true,
  };
  await withBoundDirectory(snapshot, async () => Promise.resolve());
  return snapshot;
}

async function assertDirectorySnapshot(
  snapshot: DirectorySnapshot,
): Promise<void> {
  await withBoundDirectory(snapshot, async () => Promise.resolve());
}

async function captureChildDirectory(
  parent: DirectorySnapshot,
  name: string,
  label: string,
  create: boolean = true,
  modeMustBePrivate: boolean = true,
): Promise<DirectorySnapshot> {
  safeEntryName(name);
  return withBoundDirectory(parent, async (bound) => {
    const childPath = boundEntryPath(bound, name);
    if (create) {
      try {
        await mkdir(childPath, { mode: 0o700 });
        await bound.handle.sync();
      } catch (error: unknown) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    const metadata = await lstat(childPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.uid !== currentUid() ||
      (modeMustBePrivate && (metadata.mode & 0o077) !== 0)
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_UNSAFE",
        `${label} must be a process-private real child directory.`,
      );
    }
    const snapshot = {
      path: resolve(parent.path, name),
      identity: directoryIdentity(metadata),
      label,
      modeMustBePrivate,
    };
    const childHandle = await open(childPath, linuxDirectoryReadFlags());
    try {
      const opened = await childHandle.stat();
      if (
        !opened.isDirectory() ||
        !sameDirectoryIdentity(snapshot.identity, directoryIdentity(opened))
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_CHANGED",
          `${label} changed while its parent handle was pinned.`,
        );
      }
    } finally {
      await childHandle.close();
    }
    return snapshot;
  });
}

async function unlinkEntryInDirectory(
  directory: DirectorySnapshot,
  name: string,
): Promise<void> {
  await withBoundDirectory(directory, async (bound) => {
    await unlink(boundEntryPath(bound, name));
    await bound.handle.sync();
  });
}

function atomicTempPrefix(name: string): string {
  return `.${safeEntryName(name)}.atomic-`;
}

async function recoverAtomicTempFiles(
  directory: BoundDirectory,
  name: string,
): Promise<void> {
  const finalPath = boundEntryPath(directory, name);
  let finalMetadata: Awaited<ReturnType<typeof lstat>> | null;
  try {
    finalMetadata = await lstat(finalPath);
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") throw error;
    finalMetadata = null;
  }
  if (
    finalMetadata !== null &&
    (finalMetadata.isSymbolicLink() || !finalMetadata.isFile())
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_FILE_UNSAFE",
      `A durable final entry is not a regular no-follow file: ${name}`,
    );
  }
  const prefix = atomicTempPrefix(name);
  const entries = await opendir(directory.descriptorPath);
  let entryCount = 0;
  let removed = false;
  for await (const entry of entries) {
    entryCount += 1;
    if (entryCount > 256) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_ENTRY_LIMIT",
        "A durable directory contains too many entries for bounded recovery.",
      );
    }
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp")) {
      continue;
    }
    const tempPath = boundEntryPath(directory, entry.name);
    const tempMetadata = await lstat(tempPath);
    if (tempMetadata.isSymbolicLink() || !tempMetadata.isFile()) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_ATOMIC_TEMP_UNSAFE",
        `A durable atomic temporary entry is not a regular no-follow file: ${entry.name}`,
      );
    }
    // A matching inode is a published hard-link left between publication and
    // cleanup. A different inode (or no final entry) is an unpublished temp
    // left by an earlier crash. Neither may accumulate in a durable directory.
    await unlink(tempPath);
    removed = true;
  }
  if (removed) {
    await directory.handle.sync();
  }
  if (finalMetadata !== null) {
    const recoveredFinalMetadata = await lstat(finalPath);
    if (
      recoveredFinalMetadata.isSymbolicLink() ||
      !recoveredFinalMetadata.isFile() ||
      recoveredFinalMetadata.dev !== finalMetadata.dev ||
      recoveredFinalMetadata.ino !== finalMetadata.ino ||
      recoveredFinalMetadata.size !== finalMetadata.size ||
      recoveredFinalMetadata.mtimeMs !== finalMetadata.mtimeMs ||
      recoveredFinalMetadata.nlink !== 1
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_FILE_CHANGED",
        `A durable final entry changed during atomic temporary recovery: ${name}`,
      );
    }
  }
}

async function writeFully(
  handle: FileHandle,
  bytes: Uint8Array,
  start: number,
  end: number,
): Promise<void> {
  let offset = start;
  while (offset < end) {
    const result = await handle.write(bytes, offset, end - offset, offset);
    if (result.bytesWritten <= 0) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_ATOMIC_WRITE_STALLED",
        "A durable atomic write made no forward progress.",
      );
    }
    offset += result.bytesWritten;
  }
}

async function writeAtomicExclusiveInDirectory(
  directory: DirectorySnapshot,
  name: string,
  bytes: Uint8Array,
  recordKind: FoundryLocalNormalizationPreviewDurableRecordKind,
  injector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector,
): Promise<void> {
  safeEntryName(name);
  await withBoundDirectory(directory, async (bound) => {
    await injectDurabilityFault(injector, {
      recordKind,
      stage: "after_directory_bind_before_open",
      finalName: name,
    });
    await recoverAtomicTempFiles(bound, name);
    const tempName = `${atomicTempPrefix(name)}${randomUUID()}.tmp`;
    const tempPath = boundEntryPath(bound, tempName);
    const finalPath = boundEntryPath(bound, name);
    const handle = await open(tempPath, linuxAtomicWriteFlags(), 0o600);
    let published = false;
    try {
      await injectDurabilityFault(injector, {
        recordKind,
        stage: "after_open",
        finalName: name,
      });
      const split = Math.max(1, Math.floor(bytes.byteLength / 2));
      await writeFully(handle, bytes, 0, split);
      await injectDurabilityFault(injector, {
        recordKind,
        stage: "after_partial_write",
        finalName: name,
      });
      await writeFully(handle, bytes, split, bytes.byteLength);
      await handle.sync();
      await injectDurabilityFault(injector, {
        recordKind,
        stage: "after_fsync",
        finalName: name,
      });
      const [handleMetadata, tempMetadata] = await Promise.all([
        handle.stat(),
        lstat(tempPath),
      ]);
      if (
        tempMetadata.isSymbolicLink() ||
        !tempMetadata.isFile() ||
        !sameFileIdentity(identity(handleMetadata), identity(tempMetadata)) ||
        handleMetadata.size !== bytes.byteLength
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_ATOMIC_TEMP_CHANGED",
          `A durable temporary file changed before publication: ${name}`,
        );
      }
      await link(tempPath, finalPath);
      published = true;
      await bound.handle.sync();
      await injectDurabilityFault(injector, {
        recordKind,
        stage: "after_publish",
        finalName: name,
      });
      await unlink(tempPath);
      await bound.handle.sync();
    } catch (error: unknown) {
      if (!isInjectedDurabilityInterruption(error) && !published) {
        try {
          await unlink(tempPath);
        } catch (cleanupError: unknown) {
          if (errorCode(cleanupError) !== "ENOENT") throw cleanupError;
        }
      }
      throw error;
    } finally {
      await handle.close();
    }
  });
}

async function verifyAtomicPublicationSupport(
  directory: DirectorySnapshot,
): Promise<void> {
  const name = `.foundry-atomic-probe-${randomUUID()}`;
  try {
    await writeAtomicExclusiveInDirectory(
      directory,
      name,
      Buffer.from("foundry-atomic-publication-probe", "utf8"),
      "subject",
    );
    await unlinkEntryInDirectory(directory, name);
  } catch (error: unknown) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_FILESYSTEM_UNSUPPORTED",
      `${directory.label} does not support the required fsync plus atomic no-overwrite hard-link publication primitive.`,
      error,
    );
  }
}

async function readBoundedFileInDirectory(
  directory: DirectorySnapshot,
  name: string,
  maximumBytes: number,
): Promise<Buffer> {
  safeEntryName(name);
  return withBoundDirectory(directory, async (bound) => {
    await recoverAtomicTempFiles(bound, name);
    const path = boundEntryPath(bound, name);
    return readBoundedRegularFileByPath(path, maximumBytes);
  });
}

async function readCanonicalJsonInDirectory(
  directory: DirectorySnapshot,
  name: string,
  maximumBytes = MAXIMUM_JSON_BYTES,
): Promise<unknown> {
  const bytes = await readBoundedFileInDirectory(directory, name, maximumBytes);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECORD_JSON_INVALID",
      `A local preview output record is not valid JSON: ${name}`,
      error,
    );
  }
  if (!bytes.equals(canonicalBytes(value))) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECORD_NOT_CANONICAL",
      `A local preview output record is not canonical: ${name}`,
    );
  }
  return value;
}

async function readJsonInDirectory(
  directory: DirectorySnapshot,
  name: string,
  maximumBytes = MAXIMUM_JSON_BYTES,
): Promise<{ readonly value: unknown; readonly bytes: Buffer }> {
  const bytes = await readBoundedFileInDirectory(directory, name, maximumBytes);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECORD_JSON_INVALID",
      `A staged local preview record is not valid JSON: ${name}`,
      error,
    );
  }
  return { value, bytes };
}

async function readStagedControlEvidence(stagedRootInput: string): Promise<{
  readonly stagedRoot: DirectorySnapshot;
  readonly index: z.infer<typeof FoundryIntakeStagingIndexV0Schema>;
  readonly manifest: z.infer<typeof FoundryIngestManifestV0Schema>;
}> {
  const stagedRoot = await captureDirectorySnapshot(
    stagedRootInput,
    "staged intake root",
    false,
  );
  const evidence = await readStagedControlEvidenceFromSnapshot(stagedRoot);
  return { stagedRoot, ...evidence };
}

async function readStagedControlEvidenceFromSnapshot(
  stagedRoot: DirectorySnapshot,
): Promise<{
  readonly index: z.infer<typeof FoundryIntakeStagingIndexV0Schema>;
  readonly manifest: z.infer<typeof FoundryIngestManifestV0Schema>;
}> {
  const indexRead = await readJsonInDirectory(stagedRoot, "staging-index.json");
  const index = FoundryIntakeStagingIndexV0Schema.parse(indexRead.value);
  const manifestRecord = index.files.find(
    (file) => file.path === MANIFEST_PATH && file.role === "ingest_manifest",
  );
  if (manifestRecord === undefined) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_STAGED_MANIFEST_MISSING",
      "The verified stage index does not contain its canonical ingest manifest.",
    );
  }
  const manifestDirectory = await captureChildDirectory(
    stagedRoot,
    "manifest",
    "staged manifest directory",
    false,
    false,
  );
  const manifestRead = await readJsonInDirectory(
    manifestDirectory,
    "foundry-ingest-manifest-v0.json",
  );
  const manifestBytes = manifestRead.bytes;
  if (
    manifestBytes.length !== manifestRecord.sizeBytes ||
    sha256Bytes(manifestBytes) !== manifestRecord.sha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_STAGED_MANIFEST_MISMATCH",
      "The staged ingest manifest does not match the exact staging index.",
    );
  }
  const manifest = FoundryIngestManifestV0Schema.parse(manifestRead.value);
  if (computeFoundryIngestManifestSha256(manifest) !== index.manifestSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_STAGED_MANIFEST_DIGEST_MISMATCH",
      "The staged ingest manifest does not match its canonical manifest digest.",
    );
  }
  return { index, manifest };
}

function assertSealedRightsScope(
  job: z.infer<typeof FoundryJobSpecV0Schema>,
): void {
  const stage = job.stages[0];
  if (
    job.executionIntent !== "plan_only" ||
    job.providerKind !== "local_cpu" ||
    job.objectStorageProfile !== null ||
    job.computeApprovalId !== null ||
    job.estimatedCostUsd !== 0 ||
    job.budgetCapUsd !== 0 ||
    job.stages.length !== 1 ||
    stage === undefined ||
    stage.kind !== "geometry" ||
    stage.dependsOn.length !== 0 ||
    stage.command.length !== 3 ||
    stage.command[0] !== "omnitwin-sealed-worker" ||
    stage.command[1] !== FOUNDRY_NORMALIZE_MESH_GLB_OPERATION ||
    stage.command[2] !== FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION ||
    stage.inputAssetIds.length !== 1 ||
    stage.rightsPurposes.length !== 1 ||
    stage.rightsPurposes[0] !== "commercial_internal_use" ||
    stage.networkAccess !== "none" ||
    stage.gpuCount !== 0 ||
    stage.minimumGpuVramGiB !== 0 ||
    stage.checkpoint !== "none" ||
    stage.resumable
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_JOB_SCOPE_UNSUPPORTED",
      "The local preview accepts one plan-only, zero-cost, CPU-only normalize_mesh_glb/v0 rights scope; it is not a production dispatch path.",
    );
  }
}

function buildSubject(input: {
  readonly index: z.infer<typeof FoundryIntakeStagingIndexV0Schema>;
  readonly manifest: z.infer<typeof FoundryIngestManifestV0Schema>;
  readonly asset: z.infer<
    typeof FoundryIngestManifestV0Schema
  >["assets"][number];
  readonly job: z.infer<typeof FoundryJobSpecV0Schema>;
  readonly rightsApproval: z.infer<
    typeof FoundryDerivativeRightsApprovalV0Schema
  >;
  readonly policyState: z.infer<
    typeof FoundryDerivativeRightsTrustedPolicyStateV0Schema
  >;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly authenticationKey: Uint8Array;
}): Subject {
  const material = SubjectMaterialSchema.parse({
    schemaVersion: FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_SUBJECT_V0,
    stagingIndexSha256: input.index.stagingSha256,
    intakeReceiptSha256: input.index.receiptSha256,
    intakeAdmissionResultSha256: input.index.resultSha256,
    ingestManifestSha256: computeFoundryIngestManifestSha256(input.manifest),
    source: {
      assetId: input.asset.id,
      relativePath: input.asset.relativePath,
      inputType: input.asset.inputType,
      mediaType: input.asset.mediaType,
      sizeBytes: input.asset.sizeBytes,
      sha256: input.asset.sha256,
    },
    jobSpecSha256: computeFoundryJobSpecSha256(input.job),
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(input.job),
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(input.rightsApproval),
    derivativeRightsPolicyDefinitionSha256:
      computeFoundryDerivativeRightsPolicySha256(input.policyState.definition),
    derivativeRightsPolicyVersion: input.policyState.definition.policyVersion,
    derivativeRightsPolicyGeneration: input.policyState.definition.generation,
    previewInvocationSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
        input.invocation,
      ),
    permitPayloadSha256: input.invocation.permit.payloadSha256,
    permitKeyId: input.invocation.permit.keyId,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    outputDisposition: "private_quarantine_review_only",
    authority: "none",
    productionExecution: "disabled",
  });
  const bindingSha256 = digest(SUBJECT_DOMAIN, material);
  const commandId = `lnp0-${bindingSha256.slice(7, 39)}`;
  const selfDigested = {
    ...material,
    commandId,
    subjectSha256: digest(SUBJECT_DOMAIN, { ...material, commandId }),
  };
  return SubjectSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      input.authenticationKey,
      SUBJECT_DOMAIN,
      selfDigested,
    ),
  });
}

function parseSubject(value: unknown, authenticationKey: Uint8Array): Subject {
  const subject = SubjectSchema.parse(value);
  authenticate(authenticationKey, SUBJECT_DOMAIN, ownRecord(subject));
  const {
    authenticationHmacSha256: _authenticationHmacSha256,
    subjectSha256: _subjectSha256,
    commandId,
    ...material
  } = subject;
  if (
    digest(SUBJECT_DOMAIN, { ...material, commandId }) !==
      subject.subjectSha256 ||
    `lnp0-${digest(SUBJECT_DOMAIN, material).slice(7, 39)}` !== commandId
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_SUBJECT_DIGEST_MISMATCH",
      "The durable local preview subject does not match its canonical digest.",
    );
  }
  return subject;
}

function sealPermitConsumption(
  materialInput: z.input<typeof PermitConsumptionMaterialSchema>,
  authenticationKey: Uint8Array,
): PermitConsumption {
  const material = PermitConsumptionMaterialSchema.parse(materialInput);
  const selfDigested = {
    ...material,
    consumptionSha256: digest(PERMIT_CONSUMPTION_DOMAIN, material),
  };
  return PermitConsumptionSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      authenticationKey,
      PERMIT_CONSUMPTION_DOMAIN,
      selfDigested,
    ),
  });
}

function parsePermitConsumption(
  value: unknown,
  authenticationKey: Uint8Array,
): PermitConsumption {
  const consumption = PermitConsumptionSchema.parse(value);
  authenticate(
    authenticationKey,
    PERMIT_CONSUMPTION_DOMAIN,
    ownRecord(consumption),
  );
  const {
    consumptionSha256: _consumptionSha256,
    authenticationHmacSha256: _authenticationHmacSha256,
    ...material
  } = consumption;
  if (
    digest(PERMIT_CONSUMPTION_DOMAIN, material) !==
    consumption.consumptionSha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_PERMIT_LEDGER_DIGEST_MISMATCH",
      "The host-pinned permit consumption record digest is invalid.",
    );
  }
  return consumption;
}

async function consumeGlobalPermit(input: {
  readonly ledger: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
}): Promise<{
  readonly status: "consumed_now" | "already_consumed_same_command";
  readonly record: PermitConsumption;
}> {
  const name = `${input.subject.permitPayloadSha256.slice(7)}.json`;
  const record = sealPermitConsumption(
    {
      schemaVersion:
        FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_PERMIT_CONSUMPTION_V0,
      permitPayloadSha256: input.subject.permitPayloadSha256,
      commandId: input.subject.commandId,
      subjectSha256: input.subject.subjectSha256,
      consumedAt: new Date().toISOString(),
      disposition: "globally_consumed_for_one_logical_preview_command",
      authority: "none",
    },
    input.authenticationKey,
  );
  try {
    await writeAtomicExclusiveInDirectory(
      input.ledger,
      name,
      canonicalBytes(record),
      "permit",
      input.durabilityFaultInjector,
    );
    return { status: "consumed_now", record };
  } catch (error: unknown) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const existing = parsePermitConsumption(
    await readCanonicalJsonInDirectory(input.ledger, name),
    input.authenticationKey,
  );
  if (
    existing.permitPayloadSha256 !== input.subject.permitPayloadSha256 ||
    existing.commandId !== input.subject.commandId ||
    existing.subjectSha256 !== input.subject.subjectSha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_PERMIT_ALREADY_CONSUMED",
      "The signed preview permit was already consumed for another exact command subject.",
    );
  }
  return { status: "already_consumed_same_command", record: existing };
}

function sealState(
  materialInput: z.input<typeof StateMaterialSchema>,
  authenticationKey: Uint8Array,
): State {
  const material = StateMaterialSchema.parse(materialInput);
  const selfDigested = {
    ...material,
    stateSha256: digest(STATE_DOMAIN, material),
  };
  return StateSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      authenticationKey,
      STATE_DOMAIN,
      selfDigested,
    ),
  });
}

function parseState(value: unknown, authenticationKey: Uint8Array): State {
  const state = StateSchema.parse(value);
  authenticate(authenticationKey, STATE_DOMAIN, ownRecord(state));
  const {
    stateSha256: _stateSha256,
    authenticationHmacSha256: _authenticationHmacSha256,
    ...material
  } = state;
  if (digest(STATE_DOMAIN, material) !== state.stateSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_STATE_DIGEST_MISMATCH",
      "A durable local preview state does not match its canonical digest.",
    );
  }
  return state;
}

async function readStateChain(
  stateDirectory: DirectorySnapshot,
  subject: Subject,
  authenticationKey: Uint8Array,
): Promise<readonly State[]> {
  const names = await withBoundDirectory(stateDirectory, async (bound) => {
    const durableNames: string[] = [];
    const entries = await opendir(bound.descriptorPath);
    let count = 0;
    for await (const entry of entries) {
      count += 1;
      if (count > 512) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_STATE_ENTRY_LIMIT",
          "The durable state directory contains too many entries.",
        );
      }
      if (/^\.[0-9]{12}\.json\.atomic-[a-f0-9-]+\.tmp$/u.test(entry.name)) {
        continue;
      }
      durableNames.push(entry.name);
    }
    return durableNames.sort();
  });
  const states: State[] = [];
  let previous: State | null = null;
  for (const [index, name] of names.entries()) {
    const match = STATE_FILE.exec(name);
    if (match === null || Number(match.groups?.sequence) !== index + 1) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_STATE_CHAIN_INVALID",
        "The durable local preview state chain has a gap or unexpected file.",
      );
    }
    const state = parseState(
      await readCanonicalJsonInDirectory(stateDirectory, name),
      authenticationKey,
    );
    if (
      state.commandId !== subject.commandId ||
      state.subjectSha256 !== subject.subjectSha256 ||
      state.sequence !== index + 1 ||
      state.previousStateSha256 !== (previous?.stateSha256 ?? null) ||
      (previous !== null &&
        (state.attemptOrdinal < previous.attemptOrdinal ||
          BigInt(state.fencingToken) < BigInt(previous.fencingToken) ||
          (previous.permitConsumed && !state.permitConsumed) ||
          (previous.checkpointSha256 !== null &&
            state.checkpointSha256 !== previous.checkpointSha256) ||
          (previous.artifactIndexSha256 !== null &&
            state.artifactIndexSha256 !== previous.artifactIndexSha256)))
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_STATE_CHAIN_INVALID",
        "The durable local preview state chain breaks its subject or monotonic invariants.",
      );
    }
    if (previous?.phase === "succeeded") {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_STATE_AFTER_SUCCESS",
        "No state may follow a succeeded local preview state.",
      );
    }
    states.push(state);
    previous = state;
  }
  return states;
}

async function assertLease(lease: HeldLease): Promise<void> {
  await withBoundDirectory(lease.directory, async (bound) => {
    await recoverAtomicTempFiles(bound, lease.name);
    const [handleMetadata, pathMetadata] = await Promise.all([
      lease.handle.stat(),
      lstat(boundEntryPath(bound, lease.name)),
    ]);
    if (
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      pathMetadata.nlink !== 1 ||
      !sameFileIdentity(identity(handleMetadata), lease.identity) ||
      !sameFileIdentity(identity(pathMetadata), lease.identity)
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_FENCE_LOST",
        "The local preview writer lease was replaced; the stale writer is fenced.",
      );
    }
  });
}

async function acquireLinuxExclusiveFlock(handle: FileHandle): Promise<void> {
  await new Promise<void>((resolveLock, rejectLock) => {
    const child = spawn(LINUX_FLOCK_PATH, ["--exclusive", "3"], {
      stdio: ["ignore", "ignore", "pipe", handle.fd],
      windowsHide: true,
    });
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= 4096) return;
      const remaining = 4096 - stderrBytes;
      const bounded = chunk.subarray(0, remaining);
      stderrChunks.push(bounded);
      stderrBytes += bounded.byteLength;
    });
    child.once("error", (error: Error) => {
      rejectLock(
        new FoundryIntegrityError(
          "LOCAL_NORMALIZATION_PREVIEW_FLOCK_UNAVAILABLE",
          `The durable executor requires the reviewed Linux flock utility at ${LINUX_FLOCK_PATH}.`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolveLock();
        return;
      }
      const detail = Buffer.concat(stderrChunks).toString("utf8").trim();
      rejectLock(
        new FoundryIntegrityError(
          "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FAILED",
          `The Linux writer-lease mutation lock failed${detail.length > 0 ? `: ${detail}` : "."}`,
        ),
      );
    });
  });
}

async function withLeaseMutationLock<T>(
  directory: DirectorySnapshot,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    await writeAtomicExclusiveInDirectory(
      directory,
      LEASE_MUTATION_LOCK_NAME,
      LEASE_MUTATION_LOCK_BYTES,
      "subject",
    );
  } catch (error: unknown) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const storedLockBytes = await readBoundedFileInDirectory(
    directory,
    LEASE_MUTATION_LOCK_NAME,
    LEASE_MUTATION_LOCK_BYTES.byteLength,
  );
  if (
    storedLockBytes.byteLength !== LEASE_MUTATION_LOCK_BYTES.byteLength ||
    !timingSafeEqual(storedLockBytes, LEASE_MUTATION_LOCK_BYTES)
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FILE_INVALID",
      "The persistent writer-lease mutation lock file has unexpected content.",
    );
  }
  return withBoundDirectory(directory, async (bound) => {
    await recoverAtomicTempFiles(bound, LEASE_MUTATION_LOCK_NAME);
    const path = boundEntryPath(bound, LEASE_MUTATION_LOCK_NAME);
    const beforePath = await lstat(path);
    if (
      beforePath.isSymbolicLink() ||
      !beforePath.isFile() ||
      beforePath.nlink !== 1
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FILE_UNSAFE",
        "The writer-lease mutation lock is not a regular single-link file.",
      );
    }
    const handle = await open(path, linuxNoFollowReadFlags());
    try {
      const beforeHandle = await handle.stat();
      if (!sameFileIdentity(identity(beforePath), identity(beforeHandle))) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FILE_CHANGED",
          "The writer-lease mutation lock changed before kernel locking.",
        );
      }
      await acquireLinuxExclusiveFlock(handle);
      const [afterHandle, afterPath] = await Promise.all([
        handle.stat(),
        lstat(path),
      ]);
      if (
        afterPath.isSymbolicLink() ||
        !afterPath.isFile() ||
        !sameFileIdentity(identity(beforeHandle), identity(afterHandle)) ||
        !sameFileIdentity(identity(afterHandle), identity(afterPath))
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FILE_CHANGED",
          "The writer-lease mutation lock changed while acquiring its kernel lock.",
        );
      }
      try {
        return await operation();
      } finally {
        const [finalHandle, finalPath] = await Promise.all([
          handle.stat(),
          lstat(path),
        ]);
        if (
          finalPath.isSymbolicLink() ||
          !finalPath.isFile() ||
          !sameFileIdentity(identity(afterHandle), identity(finalHandle)) ||
          !sameFileIdentity(identity(finalHandle), identity(finalPath))
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_FLOCK_FILE_CHANGED",
            "The writer-lease mutation lock changed during the serialized operation.",
          );
        }
      }
    } finally {
      // Linux flock is attached to this open file description. Closing the
      // last descriptor releases it automatically, including on process exit.
      await handle.close();
    }
  });
}

async function readLease(
  directory: DirectorySnapshot,
  name: string,
  authenticationKey: Uint8Array,
): Promise<LeaseRecord> {
  const lease = LeaseSchema.parse(
    await readCanonicalJsonInDirectory(directory, name, 16_384),
  );
  authenticate(authenticationKey, LEASE_DOMAIN, ownRecord(lease));
  return lease;
}

async function readLeaseFromOpenHandle(
  handle: FileHandle,
  authenticationKey: Uint8Array,
): Promise<{ readonly record: LeaseRecord; readonly identity: FileIdentity }> {
  const before = await handle.stat();
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size <= 0 ||
    before.size > 16_384
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_LEASE_UNSAFE",
      "A writer lease handle is linked, non-regular, empty, or out of bounds.",
    );
  }
  const bytes = Buffer.allocUnsafe(before.size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (result.bytesRead <= 0) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_LEASE_TRUNCATED",
        "A writer lease ended before its handle-bound size.",
      );
    }
    offset += result.bytesRead;
  }
  const after = await handle.stat();
  if (!sameFileIdentity(identity(before), identity(after))) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_LEASE_CHANGED",
      "A writer lease changed during its handle-bound read.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_LEASE_JSON_INVALID",
      "A writer lease is not valid JSON.",
      error,
    );
  }
  const record = LeaseSchema.parse(decoded);
  authenticate(authenticationKey, LEASE_DOMAIN, ownRecord(record));
  return { record, identity: identity(after) };
}

async function observeCurrentLease(
  directory: DirectorySnapshot,
  name: string,
  authenticationKey: Uint8Array,
): Promise<ObservedLease> {
  return withBoundDirectory(directory, async (bound) => {
    await recoverAtomicTempFiles(bound, name);
    const path = boundEntryPath(bound, name);
    const beforePath = await lstat(path);
    if (
      beforePath.isSymbolicLink() ||
      !beforePath.isFile() ||
      beforePath.nlink !== 1
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_LEASE_UNSAFE",
        "The current writer lease is not a regular single-link file.",
      );
    }
    const handle = await open(path, linuxNoFollowReadFlags());
    try {
      const observed = await readLeaseFromOpenHandle(handle, authenticationKey);
      const afterPath = await lstat(path);
      if (
        afterPath.isSymbolicLink() ||
        !afterPath.isFile() ||
        !sameFileIdentity(identity(beforePath), observed.identity) ||
        !sameFileIdentity(observed.identity, identity(afterPath))
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_LEASE_CHANGED",
          "The current writer lease changed while its no-follow handle was acquired.",
        );
      }
      return { handle, ...observed };
    } catch (error: unknown) {
      await handle.close();
      throw error;
    }
  });
}

async function maximumAuthenticatedAbandonedFence(input: {
  readonly directory: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
}): Promise<bigint> {
  const abandonedNames = await withBoundDirectory(
    input.directory,
    async (bound) => {
      const names: string[] = [];
      const entries = await opendir(bound.descriptorPath);
      let entryCount = 0;
      for await (const entry of entries) {
        entryCount += 1;
        if (entryCount > 256) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_ENTRY_LIMIT",
            "A command directory contains too many entries for bounded lease-fence recovery.",
          );
        }
        if (ABANDONED_LEASE_FILE.test(entry.name)) names.push(entry.name);
      }
      return names.sort();
    },
  );
  let maximum = 0n;
  for (const name of abandonedNames) {
    const match = ABANDONED_LEASE_FILE.exec(name);
    if (match?.groups?.fencingToken === undefined) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_ABANDONED_LEASE_NAME_INVALID",
        "An abandoned lease filename is not canonical.",
      );
    }
    const record = await readLease(
      input.directory,
      name,
      input.authenticationKey,
    );
    if (
      record.commandId !== input.subject.commandId ||
      record.subjectSha256 !== input.subject.subjectSha256 ||
      record.fencingToken !== match.groups.fencingToken
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_ABANDONED_LEASE_INVALID",
        "An authenticated abandoned lease does not match its command, subject, or persisted fence name.",
      );
    }
    const fence = BigInt(record.fencingToken);
    if (fence > maximum) maximum = fence;
  }
  return maximum;
}

async function abandonObservedLease(input: {
  readonly directory: DirectorySnapshot;
  readonly name: string;
  readonly observed: ObservedLease;
  readonly authenticationKey: Uint8Array;
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
}): Promise<boolean> {
  return withBoundDirectory(input.directory, async (bound) => {
    await recoverAtomicTempFiles(bound, input.name);
    const currentPath = boundEntryPath(bound, input.name);
    let currentPathMetadata: Awaited<ReturnType<typeof lstat>>;
    try {
      currentPathMetadata = await lstat(currentPath);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
    const currentHandleMetadata = await input.observed.handle.stat();
    if (
      currentPathMetadata.isSymbolicLink() ||
      !currentPathMetadata.isFile() ||
      !sameFileIdentity(
        input.observed.identity,
        identity(currentPathMetadata),
      ) ||
      !sameFileIdentity(
        input.observed.identity,
        identity(currentHandleMetadata),
      )
    ) {
      return false;
    }
    const current = await readLeaseFromOpenHandle(
      input.observed.handle,
      input.authenticationKey,
    );
    if (
      !sameFileIdentity(input.observed.identity, current.identity) ||
      stableCanonicalJson(toCanonicalJson(current.record)) !==
        stableCanonicalJson(toCanonicalJson(input.observed.record))
    ) {
      return false;
    }
    const abandonedName = `abandoned-${input.observed.record.fencingToken}-${randomUUID()}.lease`;
    const abandonedPath = boundEntryPath(bound, abandonedName);
    await rename(currentPath, abandonedPath);
    await bound.handle.sync();
    const [renamedPathMetadata, renamedHandleMetadata] = await Promise.all([
      lstat(abandonedPath),
      input.observed.handle.stat(),
    ]);
    if (
      renamedPathMetadata.isSymbolicLink() ||
      !renamedPathMetadata.isFile() ||
      !sameFileIdentity(
        identity(renamedPathMetadata),
        identity(renamedHandleMetadata),
      ) ||
      renamedPathMetadata.dev !== input.observed.identity.dev ||
      renamedPathMetadata.ino !== input.observed.identity.ino
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_LEASE_RECOVERY_CAS_LOST",
        "The writer lease changed between recovery validation and its durable abandoned rename.",
      );
    }
    await injectDurabilityFault(input.durabilityFaultInjector, {
      recordKind: "lease",
      stage: "after_abandoned_lease_rename",
      finalName: input.name,
    });
    return true;
  });
}

interface AcquireLeaseInput {
  readonly jobDirectory: DirectorySnapshot;
  readonly stateDirectory: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
  readonly confirmAbandonedLease?: CreateFoundryLocalResumableNormalizationPreviewServiceOptions["confirmAbandonedLease"];
}

async function acquireLease(input: AcquireLeaseInput): Promise<HeldLease> {
  return withLeaseMutationLock(input.jobDirectory, () =>
    acquireLeaseWhileLocked(input),
  );
}

async function acquireLeaseWhileLocked(
  input: AcquireLeaseInput,
): Promise<HeldLease> {
  const name = "writer.lease";
  let recoveredFence = 0n;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const abandonedFence = await maximumAuthenticatedAbandonedFence({
      directory: input.jobDirectory,
      subject: input.subject,
      authenticationKey: input.authenticationKey,
    });
    if (abandonedFence > recoveredFence) recoveredFence = abandonedFence;
    const states = await readStateChain(
      input.stateDirectory,
      input.subject,
      input.authenticationKey,
    );
    const stateFence = BigInt(states.at(-1)?.fencingToken ?? "0");
    const fencingToken = (
      stateFence > recoveredFence ? stateFence + 1n : recoveredFence + 1n
    ).toString();
    const material = LeaseMaterialSchema.parse({
      ownerId: randomUUID(),
      commandId: input.subject.commandId,
      subjectSha256: input.subject.subjectSha256,
      fencingToken,
      acquiredAt: new Date().toISOString(),
    });
    const record = LeaseSchema.parse({
      ...material,
      authenticationHmacSha256: hmac(
        input.authenticationKey,
        LEASE_DOMAIN,
        material,
      ),
    });
    try {
      await writeAtomicExclusiveInDirectory(
        input.jobDirectory,
        name,
        canonicalBytes(record),
        "lease",
        input.durabilityFaultInjector,
      );
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      const observed = await observeCurrentLease(
        input.jobDirectory,
        name,
        input.authenticationKey,
      );
      try {
        const existing = observed.record;
        if (
          existing.commandId !== input.subject.commandId ||
          existing.subjectSha256 !== input.subject.subjectSha256
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_FOREIGN_LEASE",
            "The local preview command directory contains a foreign writer lease.",
          );
        }
        if (
          input.confirmAbandonedLease === undefined ||
          !(await input.confirmAbandonedLease({
            commandId: existing.commandId,
            ownerId: existing.ownerId,
            fencingToken: existing.fencingToken,
            acquiredAt: existing.acquiredAt,
          }))
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_LEASE_HELD",
            "Another local preview writer holds the command lease; trusted abandonment confirmation is required for recovery.",
          );
        }
        const abandoned = await abandonObservedLease({
          directory: input.jobDirectory,
          name,
          observed,
          authenticationKey: input.authenticationKey,
          durabilityFaultInjector: input.durabilityFaultInjector,
        });
        if (!abandoned) continue;
        const abandonedFence = BigInt(existing.fencingToken);
        if (abandonedFence > recoveredFence) recoveredFence = abandonedFence;
      } finally {
        await observed.handle.close();
      }
      continue;
    }
    const held = await withBoundDirectory(
      input.jobDirectory,
      async (bound): Promise<HeldLease> => {
        await recoverAtomicTempFiles(bound, name);
        const path = boundEntryPath(bound, name);
        const handle = await open(path, linuxNoFollowReadFlags());
        try {
          const [handleMetadata, pathMetadata] = await Promise.all([
            handle.stat(),
            lstat(path),
          ]);
          if (
            pathMetadata.isSymbolicLink() ||
            !pathMetadata.isFile() ||
            pathMetadata.nlink !== 1 ||
            !sameFileIdentity(identity(handleMetadata), identity(pathMetadata))
          ) {
            fail(
              "LOCAL_NORMALIZATION_PREVIEW_LEASE_CREATE_CHANGED",
              "The atomically published writer lease changed before it was held.",
            );
          }
          return {
            directory: input.jobDirectory,
            name,
            handle,
            record,
            identity: identity(handleMetadata),
            durabilityFaultInjector: input.durabilityFaultInjector,
          };
        } catch (error: unknown) {
          await handle.close();
          throw error;
        }
      },
    );
    await assertLease(held);
    return held;
  }
  fail(
    "LOCAL_NORMALIZATION_PREVIEW_LEASE_RECOVERY_RACE",
    "The local preview writer lease changed repeatedly during recovery.",
  );
}

async function releaseLease(lease: HeldLease): Promise<void> {
  try {
    await withLeaseMutationLock(lease.directory, async () => {
      await assertLease(lease);
      await unlinkEntryInDirectory(lease.directory, lease.name);
    });
  } finally {
    await lease.handle.close();
  }
}

async function appendState(input: {
  readonly stateDirectory: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
  readonly lease: HeldLease;
  readonly attemptOrdinal: number;
  readonly phase: StatePhase;
  readonly permitConsumed: boolean;
  readonly checkpointSha256: string | null;
  readonly artifactIndexSha256: string | null;
  readonly failureCode: string | null;
}): Promise<State> {
  await assertLease(input.lease);
  const states = await readStateChain(
    input.stateDirectory,
    input.subject,
    input.authenticationKey,
  );
  const previous = states.at(-1) ?? null;
  const state = sealState(
    {
      schemaVersion: FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_STATE_V0,
      commandId: input.subject.commandId,
      subjectSha256: input.subject.subjectSha256,
      sequence: (previous?.sequence ?? 0) + 1,
      previousStateSha256: previous?.stateSha256 ?? null,
      phase: input.phase,
      attemptOrdinal: input.attemptOrdinal,
      fencingToken: input.lease.record.fencingToken,
      recordedAt: new Date().toISOString(),
      permitConsumed: input.permitConsumed,
      checkpointSha256: input.checkpointSha256,
      artifactIndexSha256: input.artifactIndexSha256,
      failureCode: input.failureCode,
      authority: "none",
    },
    input.authenticationKey,
  );
  await writeAtomicExclusiveInDirectory(
    input.stateDirectory,
    `${String(state.sequence).padStart(12, "0")}.json`,
    canonicalBytes(state),
    "state",
    input.lease.durabilityFaultInjector,
  );
  await assertLease(input.lease);
  return state;
}

async function notifyPhase(
  options: RunFoundryLocalResumableNormalizationPreviewOptions,
  subject: Subject,
  lease: HeldLease,
  attemptOrdinal: number,
  phase: FoundryLocalNormalizationPreviewDurablePhase,
): Promise<void> {
  await options.onPhase?.({
    commandId: subject.commandId,
    phase,
    attemptOrdinal,
    fencingToken: lease.record.fencingToken,
  });
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_CANCELLED",
      "The local normalization preview was cancelled.",
    );
  }
}

async function readExactStagedSource(input: {
  readonly stagedRoot: DirectorySnapshot;
  readonly subject: Subject;
}): Promise<Buffer> {
  const segments = `${SOURCE_PREFIX}${input.subject.source.relativePath}`.split(
    "/",
  );
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        basename(segment) !== segment,
    )
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_SOURCE_PATH_ESCAPE",
      "The staged source path escapes the verified staging root.",
    );
  }
  let sourceDirectory = input.stagedRoot;
  for (const segment of segments.slice(0, -1)) {
    sourceDirectory = await captureChildDirectory(
      sourceDirectory,
      segment,
      `staged source directory ${segment}`,
      false,
      false,
    );
  }
  const sourceName = segments.at(-1);
  if (sourceName === undefined) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_SOURCE_PATH_ESCAPE",
      "The staged source path has no final filename.",
    );
  }
  const bytes = await readBoundedFileInDirectory(
    sourceDirectory,
    sourceName,
    FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  );
  if (
    bytes.length !== input.subject.source.sizeBytes ||
    `sha256:${sha256Bytes(bytes)}` !== input.subject.source.sha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_SOURCE_IDENTITY_MISMATCH",
      "The staged GLB source changed or did not match its exact size and SHA-256 subject.",
    );
  }
  return bytes;
}

function sealCheckpoint(
  materialInput: z.input<typeof CheckpointMaterialSchema>,
  authenticationKey: Uint8Array,
): Checkpoint {
  const material = CheckpointMaterialSchema.parse(materialInput);
  const selfDigested = {
    ...material,
    checkpointSha256: digest(CHECKPOINT_DOMAIN, material),
  };
  return CheckpointSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      authenticationKey,
      CHECKPOINT_DOMAIN,
      selfDigested,
    ),
  });
}

function parseCheckpoint(
  value: unknown,
  authenticationKey: Uint8Array,
): Checkpoint {
  const checkpoint = CheckpointSchema.parse(value);
  authenticate(authenticationKey, CHECKPOINT_DOMAIN, ownRecord(checkpoint));
  const {
    checkpointSha256: _checkpointSha256,
    authenticationHmacSha256: _authenticationHmacSha256,
    ...material
  } = checkpoint;
  if (digest(CHECKPOINT_DOMAIN, material) !== checkpoint.checkpointSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_CHECKPOINT_DIGEST_MISMATCH",
      "The local normalization preview checkpoint digest is invalid.",
    );
  }
  return checkpoint;
}

async function loadCheckpoint(input: {
  readonly outputDirectory: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
}): Promise<{
  readonly checkpoint: Checkpoint;
  readonly normalizedGlb: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}> {
  const checkpoint = parseCheckpoint(
    await readCanonicalJsonInDirectory(
      input.outputDirectory,
      "transform-checkpoint.json",
    ),
    input.authenticationKey,
  );
  if (
    checkpoint.commandId !== input.subject.commandId ||
    checkpoint.subjectSha256 !== input.subject.subjectSha256 ||
    checkpoint.permitPayloadSha256 !== input.subject.permitPayloadSha256 ||
    checkpoint.sourceSha256 !== input.subject.source.sha256 ||
    checkpoint.previewInvocationSha256 !== input.subject.previewInvocationSha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_CHECKPOINT_SUBJECT_MISMATCH",
      "The local normalization preview checkpoint belongs to another exact command subject.",
    );
  }
  const [normalizedGlb, reportBytes] = await Promise.all([
    readBoundedFileInDirectory(
      input.outputDirectory,
      "normalized.glb",
      FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
    ),
    readBoundedFileInDirectory(
      input.outputDirectory,
      "normalization-report.json",
      MAXIMUM_JSON_BYTES,
    ),
  ]);
  if (
    normalizedGlb.length !== checkpoint.normalizedGlb.sizeBytes ||
    `sha256:${sha256Bytes(normalizedGlb)}` !==
      checkpoint.normalizedGlb.sha256 ||
    reportBytes.length !== checkpoint.normalizationReport.sizeBytes ||
    `sha256:${sha256Bytes(reportBytes)}` !==
      checkpoint.normalizationReport.sha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_CHECKPOINT_FILE_MISMATCH",
      "Checkpointed local normalization output bytes do not match their authenticated checkpoint.",
    );
  }
  const report = FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse(
    JSON.parse(reportBytes.toString("utf8")) as unknown,
  );
  if (report.reportSha256 !== checkpoint.normalizationReport.reportSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_CHECKPOINT_REPORT_MISMATCH",
      "The checkpointed normalization report self-digest does not match its checkpoint.",
    );
  }
  return { checkpoint, normalizedGlb, report };
}

function sealReceipt(
  materialInput: z.input<typeof ReceiptMaterialSchema>,
  authenticationKey: Uint8Array,
): Receipt {
  const material = ReceiptMaterialSchema.parse(materialInput);
  const selfDigested = {
    ...material,
    receiptSha256: digest(RECEIPT_DOMAIN, material),
  };
  return ReceiptSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      authenticationKey,
      RECEIPT_DOMAIN,
      selfDigested,
    ),
  });
}

function parseReceipt(value: unknown, authenticationKey: Uint8Array): Receipt {
  const receipt = ReceiptSchema.parse(value);
  authenticate(authenticationKey, RECEIPT_DOMAIN, ownRecord(receipt));
  const {
    receiptSha256: _receiptSha256,
    authenticationHmacSha256: _authenticationHmacSha256,
    ...material
  } = receipt;
  if (digest(RECEIPT_DOMAIN, material) !== receipt.receiptSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_RECEIPT_DIGEST_MISMATCH",
      "The local normalization preview receipt digest is invalid.",
    );
  }
  return receipt;
}

function sealIndex(
  materialInput: z.input<typeof IndexMaterialSchema>,
  authenticationKey: Uint8Array,
): Index {
  const material = IndexMaterialSchema.parse(materialInput);
  const selfDigested = {
    ...material,
    indexSha256: digest(INDEX_DOMAIN, material),
  };
  return IndexSchema.parse({
    ...selfDigested,
    authenticationHmacSha256: hmac(
      authenticationKey,
      INDEX_DOMAIN,
      selfDigested,
    ),
  });
}

function parseIndex(value: unknown, authenticationKey: Uint8Array): Index {
  const index = IndexSchema.parse(value);
  authenticate(authenticationKey, INDEX_DOMAIN, ownRecord(index));
  const {
    indexSha256: _indexSha256,
    authenticationHmacSha256: _authenticationHmacSha256,
    ...material
  } = index;
  if (digest(INDEX_DOMAIN, material) !== index.indexSha256) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_INDEX_DIGEST_MISMATCH",
      "The local normalization preview artifact index digest is invalid.",
    );
  }
  return index;
}

async function indexedFile(
  outputDirectory: DirectorySnapshot,
  name: z.infer<typeof FileRecordSchema>["name"],
  mediaType: z.infer<typeof FileRecordSchema>["mediaType"],
): Promise<z.infer<typeof FileRecordSchema>> {
  const bytes = await readBoundedFileInDirectory(
    outputDirectory,
    name,
    name === "normalized.glb"
      ? FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
      : MAXIMUM_JSON_BYTES,
  );
  return FileRecordSchema.parse({
    name,
    mediaType,
    sizeBytes: bytes.length,
    sha256: `sha256:${sha256Bytes(bytes)}`,
  });
}

async function listOutputFiles(
  outputDirectory: DirectorySnapshot,
): Promise<string[]> {
  return withBoundDirectory(outputDirectory, async (bound) => {
    for (const name of OUTPUT_FILES) {
      await recoverAtomicTempFiles(bound, name);
    }
    const files: string[] = [];
    const entries = await opendir(bound.descriptorPath);
    let entryCount = 0;
    for await (const entry of entries) {
      entryCount += 1;
      if (entryCount > 128) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_FILE_SET_MISMATCH",
          "The local normalization preview output contains too many entries.",
        );
      }
      const isAtomicTemp = OUTPUT_FILES.some(
        (name) =>
          entry.name.startsWith(atomicTempPrefix(name)) &&
          entry.name.endsWith(".tmp"),
      );
      const metadata = await lstat(boundEntryPath(bound, entry.name));
      if (isAtomicTemp) {
        if (
          entry.isSymbolicLink() ||
          metadata.isSymbolicLink() ||
          !entry.isFile() ||
          !metadata.isFile()
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_ENTRY_UNSAFE",
            "An interrupted atomic temporary output is not a regular file.",
          );
        }
        continue;
      }
      if (
        files.length >= OUTPUT_FILES.length + 1 ||
        entry.isSymbolicLink() ||
        metadata.isSymbolicLink() ||
        !entry.isFile() ||
        !metadata.isFile() ||
        metadata.nlink !== 1
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_ENTRY_UNSAFE",
          "The local normalization preview output contains a non-regular, linked, or unexpected entry.",
        );
      }
      files.push(entry.name);
    }
    return files.sort();
  });
}

async function verifyFinalOutput(input: {
  readonly outputDirectory: DirectorySnapshot;
  readonly subject: Subject;
  readonly authenticationKey: Uint8Array;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: unknown;
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
  readonly sourceBytes: Uint8Array;
}): Promise<{ readonly receipt: Receipt; readonly index: Index }> {
  const actualFiles = await listOutputFiles(input.outputDirectory);
  if (
    actualFiles.length !== OUTPUT_FILES.length ||
    actualFiles.some((name, position) => name !== OUTPUT_FILES[position])
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_FILE_SET_MISMATCH",
      "The local normalization preview output does not contain its exact committed file set.",
    );
  }
  const index = parseIndex(
    await readCanonicalJsonInDirectory(
      input.outputDirectory,
      "artifact-index.json",
    ),
    input.authenticationKey,
  );
  const receipt = parseReceipt(
    await readCanonicalJsonInDirectory(
      input.outputDirectory,
      "execution-receipt.json",
    ),
    input.authenticationKey,
  );
  if (
    index.commandId !== input.subject.commandId ||
    index.subjectSha256 !== input.subject.subjectSha256 ||
    receipt.commandId !== input.subject.commandId ||
    receipt.subjectSha256 !== input.subject.subjectSha256 ||
    index.receiptSha256 !== receipt.receiptSha256
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_SUBJECT_MISMATCH",
      "The committed local normalization preview output belongs to another command subject.",
    );
  }
  for (const file of index.files) {
    const bytes = await readBoundedFileInDirectory(
      input.outputDirectory,
      file.name,
      file.name === "normalized.glb"
        ? FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
        : MAXIMUM_JSON_BYTES,
    );
    if (
      bytes.length !== file.sizeBytes ||
      `sha256:${sha256Bytes(bytes)}` !== file.sha256
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_DIGEST_MISMATCH",
        `Committed local normalization output changed: ${file.name}`,
      );
    }
  }
  const loaded = await loadCheckpoint({
    outputDirectory: input.outputDirectory,
    subject: input.subject,
    authenticationKey: input.authenticationKey,
  });
  if (
    loaded.checkpoint.checkpointSha256 !== index.checkpointSha256 ||
    loaded.checkpoint.checkpointSha256 !== receipt.checkpointSha256 ||
    loaded.report.reportSha256 !== receipt.output.reportSha256 ||
    loaded.checkpoint.normalizedGlb.sha256 !== receipt.output.sha256 ||
    loaded.checkpoint.normalizedGlb.sizeBytes !== receipt.output.sizeBytes
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_OUTPUT_BINDING_MISMATCH",
      "The committed local normalization output index, receipt, checkpoint, and report do not agree.",
    );
  }
  await verifyFoundryOfflineNormalizeMeshGlbPreview({
    invocation: input.invocation,
    sourceBytes: input.sourceBytes,
    permitEnvelope: input.permitEnvelope,
    pinnedTrustedPermitKeys: input.pinnedTrustedPermitKeys,
    normalizedGlb: loaded.normalizedGlb,
    report: loaded.report,
  });
  return { receipt, index };
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof FoundryIntegrityError &&
    error.code === "LOCAL_NORMALIZATION_PREVIEW_CANCELLED"
  );
}

function safeFailureCode(error: unknown): string {
  if (error instanceof FoundryIntegrityError) return error.code;
  return "LOCAL_NORMALIZATION_PREVIEW_UNEXPECTED_FAILURE";
}

interface PinnedLocalPreviewHost {
  readonly stateRoot: DirectorySnapshot;
  readonly permitLedgerRoot: DirectorySnapshot;
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
  readonly recordAuthenticationKey: Buffer;
  readonly getTrustedDerivativeRightsPolicyState: () => Promise<unknown>;
  readonly confirmAbandonedLease?: CreateFoundryLocalResumableNormalizationPreviewServiceOptions["confirmAbandonedLease"];
  readonly durabilityFaultInjector?: FoundryLocalNormalizationPreviewDurabilityFaultInjector;
}

export async function createFoundryLocalResumableNormalizationPreviewService(
  options: CreateFoundryLocalResumableNormalizationPreviewServiceOptions,
): Promise<FoundryLocalResumableNormalizationPreviewService> {
  assertSupportedDurableFilesystemPlatform();
  if (
    !(options.recordAuthenticationKey instanceof Uint8Array) ||
    options.recordAuthenticationKey.byteLength < 32
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_AUTHENTICATION_KEY_INVALID",
      "The local preview store requires at least 32 bytes of host-owned record-authentication key material.",
    );
  }
  const [stateRoot, permitLedgerRoot] = await Promise.all([
    captureDirectorySnapshot(options.stateRoot, "host-pinned state root"),
    captureDirectorySnapshot(
      options.permitLedgerRoot,
      "host-pinned global permit ledger root",
    ),
  ]);
  if (
    pathIsWithin(stateRoot.path, permitLedgerRoot.path) ||
    pathIsWithin(permitLedgerRoot.path, stateRoot.path)
  ) {
    fail(
      "LOCAL_NORMALIZATION_PREVIEW_HOST_ROOT_OVERLAP",
      "The host-pinned global permit ledger must not overlap command state.",
    );
  }
  await Promise.all([
    verifyAtomicPublicationSupport(stateRoot),
    verifyAtomicPublicationSupport(permitLedgerRoot),
  ]);
  const host: PinnedLocalPreviewHost = {
    stateRoot,
    permitLedgerRoot,
    pinnedTrustedPermitKeys: new Map(options.pinnedTrustedPermitKeys),
    recordAuthenticationKey: Buffer.from(options.recordAuthenticationKey),
    getTrustedDerivativeRightsPolicyState: async () =>
      await options.getTrustedDerivativeRightsPolicyState(),
    confirmAbandonedLease: options.confirmAbandonedLease,
    durabilityFaultInjector: options.durabilityFaultInjector,
  };
  return Object.freeze({
    run: (runOptions: RunFoundryLocalResumableNormalizationPreviewOptions) =>
      runFoundryLocalResumableNormalizationPreview(host, runOptions),
  });
}

/**
 * Runs one real, local-only, authority-none normalization preview command.
 *
 * This deliberately does not activate the production derivative candidate or
 * expose a public runtime. The staged source, exact operation-specific rights
 * decision, signed short-lived preview permit, authenticated command state,
 * single-consumption transition, fence, and create-only review output are all
 * independently bound. A complete transform checkpoint can be resumed without
 * re-consuming or re-running the permit; a consumed permit with no checkpoint
 * fails closed and requires a fresh permit.
 */
async function runFoundryLocalResumableNormalizationPreview(
  host: PinnedLocalPreviewHost,
  options: RunFoundryLocalResumableNormalizationPreviewOptions,
): Promise<FoundryLocalNormalizationPreviewRunResult> {
  await Promise.all([
    assertDirectorySnapshot(host.stateRoot),
    assertDirectorySnapshot(host.permitLedgerRoot),
  ]);
  const authenticationKey = Buffer.from(host.recordAuthenticationKey);
  try {
    const job = FoundryJobSpecV0Schema.parse(options.jobSpec);
    assertSealedRightsScope(job);
    const rightsApproval = FoundryDerivativeRightsApprovalV0Schema.parse(
      options.derivativeRightsApproval,
    );
    const policyState = FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse(
      await host.getTrustedDerivativeRightsPolicyState(),
    );
    const invocation =
      FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse(
        options.previewInvocation,
      );
    verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
      invocation,
      permitEnvelope: options.permitEnvelope,
      pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
    });

    const staged = await readStagedControlEvidence(
      options.stagedIntakeDirectory,
    );
    const rightsDecision = validateFoundryDerivativeRightsApproval(
      job,
      staged.manifest,
      rightsApproval,
      new Date(),
      policyState,
    );
    if (!rightsDecision.valid) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_RIGHTS_NOT_APPROVED",
        `The exact normalize_mesh_glb/v0 derivative rights decision is not valid: ${rightsDecision.reason}`,
      );
    }
    const stage = job.stages[0];
    const assetId = stage?.inputAssetIds[0];
    const asset = staged.manifest.assets.find(
      (candidate) => candidate.id === assetId,
    );
    if (
      asset === undefined ||
      asset.inputType !== "glb_gltf" ||
      asset.mediaType !== "model/gltf-binary" ||
      invocation.source.assetId !== asset.id ||
      invocation.source.sizeBytes !== asset.sizeBytes ||
      invocation.source.sha256 !== asset.sha256
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_SOURCE_SUBJECT_MISMATCH",
        "The signed preview invocation does not bind the exact rights-approved staged GLB asset.",
      );
    }
    const verifiedIndex = await verifyUniversalIntakeStage(
      staged.stagedRoot.path,
    );
    if (verifiedIndex.stagingSha256 !== staged.index.stagingSha256) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_STAGE_CHANGED",
        "The staged intake changed between control-evidence review and full verification.",
      );
    }

    const subject = buildSubject({
      index: verifiedIndex,
      manifest: staged.manifest,
      asset,
      job,
      rightsApproval,
      policyState,
      invocation,
      authenticationKey,
    });
    await assertDirectorySnapshot(host.stateRoot);
    const stateRoot = host.stateRoot.path;
    if (
      pathIsWithin(stateRoot, staged.stagedRoot.path) ||
      pathIsWithin(staged.stagedRoot.path, stateRoot) ||
      pathIsWithin(host.permitLedgerRoot.path, staged.stagedRoot.path) ||
      pathIsWithin(staged.stagedRoot.path, host.permitLedgerRoot.path)
    ) {
      fail(
        "LOCAL_NORMALIZATION_PREVIEW_ROOT_OVERLAP",
        "Host-pinned state and permit-ledger roots must not overlap the verified staged intake.",
      );
    }
    const jobDirectory = await captureChildDirectory(
      host.stateRoot,
      subject.commandId,
      "command directory",
    );
    const stateDirectory = await captureChildDirectory(
      jobDirectory,
      "states",
      "command state directory",
    );
    let outputDirectory: DirectorySnapshot | null = null;
    try {
      outputDirectory = await captureChildDirectory(
        jobDirectory,
        "review-output",
        "private review output directory",
        false,
      );
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    try {
      await writeAtomicExclusiveInDirectory(
        jobDirectory,
        "subject.json",
        canonicalBytes(subject),
        "subject",
        host.durabilityFaultInjector,
      );
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = parseSubject(
        await readCanonicalJsonInDirectory(jobDirectory, "subject.json"),
        authenticationKey,
      );
      if (
        existing.subjectSha256 !== subject.subjectSha256 ||
        stableCanonicalJson(toCanonicalJson(existing)) !==
          stableCanonicalJson(toCanonicalJson(subject))
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_COMMAND_ID_COLLISION",
          "An existing local preview command ID binds different exact evidence.",
        );
      }
    }

    const lease = await acquireLease({
      jobDirectory,
      stateDirectory,
      subject,
      authenticationKey,
      durabilityFaultInjector: host.durabilityFaultInjector,
      confirmAbandonedLease: host.confirmAbandonedLease,
    });
    let currentCheckpoint: Checkpoint | null = null;
    let attemptOrdinal = 1;
    try {
      const states = await readStateChain(
        stateDirectory,
        subject,
        authenticationKey,
      );
      let latest = states.at(-1) ?? null;
      attemptOrdinal = (latest?.attemptOrdinal ?? 0) + 1;
      if (latest?.phase === "failed") {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_COMMAND_FAILED_FRESH_PERMIT_REQUIRED",
          "This exact preview command failed after permit consumption; use a fresh signed permit after correcting the failure.",
        );
      }
      if (latest?.phase === "cancelled") {
        return {
          status: "cancelled",
          commandId: subject.commandId,
          permitConsumed: latest.permitConsumed,
          authority: "none",
          productionExecution: "disabled",
        };
      }

      const sourceBytes = await readExactStagedSource({
        stagedRoot: staged.stagedRoot,
        subject,
      });
      await notifyPhase(options, subject, lease, attemptOrdinal, "source_read");

      if (latest?.phase === "succeeded") {
        await consumeGlobalPermit({
          ledger: host.permitLedgerRoot,
          subject,
          authenticationKey,
          durabilityFaultInjector: host.durabilityFaultInjector,
        });
        if (outputDirectory === null) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_SUCCEEDED_OUTPUT_MISSING",
            "The succeeded command has no canonical private review output directory.",
          );
        }
        const verified = await verifyFinalOutput({
          outputDirectory,
          subject,
          authenticationKey,
          invocation,
          permitEnvelope: options.permitEnvelope,
          pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
          sourceBytes,
        });
        sourceBytes.fill(0);
        return {
          status: "already_succeeded",
          commandId: subject.commandId,
          outputDirectory: outputDirectory.path,
          normalizedGlbPath: resolve(outputDirectory.path, "normalized.glb"),
          reportPath: resolve(
            outputDirectory.path,
            "normalization-report.json",
          ),
          receipt: verified.receipt,
          index: verified.index,
          authority: "none",
          productionExecution: "disabled",
        };
      }

      if (latest === null) {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "ready",
          permitConsumed: false,
          checkpointSha256: null,
          artifactIndexSha256: null,
          failureCode: null,
        });
      } else {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "running",
          permitConsumed: latest.permitConsumed,
          checkpointSha256: latest.checkpointSha256,
          artifactIndexSha256: latest.artifactIndexSha256,
          failureCode: null,
        });
      }

      try {
        assertNotCancelled(options.signal);
      } catch (error: unknown) {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "cancelled",
          permitConsumed: latest.permitConsumed,
          checkpointSha256: latest.checkpointSha256,
          artifactIndexSha256: null,
          failureCode: safeFailureCode(error),
        });
        sourceBytes.fill(0);
        return {
          status: "cancelled",
          commandId: subject.commandId,
          permitConsumed: latest.permitConsumed,
          authority: "none",
          productionExecution: "disabled",
        };
      }

      const permitConsumption = await consumeGlobalPermit({
        ledger: host.permitLedgerRoot,
        subject,
        authenticationKey,
        durabilityFaultInjector: host.durabilityFaultInjector,
      });

      if (!latest.permitConsumed) {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "permit_consumed",
          permitConsumed: true,
          checkpointSha256: null,
          artifactIndexSha256: null,
          failureCode: null,
        });
        await notifyPhase(
          options,
          subject,
          lease,
          attemptOrdinal,
          "permit_consumed",
        );
      }

      try {
        assertNotCancelled(options.signal);
      } catch (error: unknown) {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "cancelled",
          permitConsumed: true,
          checkpointSha256: null,
          artifactIndexSha256: null,
          failureCode: safeFailureCode(error),
        });
        sourceBytes.fill(0);
        return {
          status: "cancelled",
          commandId: subject.commandId,
          permitConsumed: true,
          authority: "none",
          productionExecution: "disabled",
        };
      }

      if (outputDirectory !== null) {
        try {
          currentCheckpoint = (
            await loadCheckpoint({
              outputDirectory,
              subject,
              authenticationKey,
            })
          ).checkpoint;
        } catch (error: unknown) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
      }

      if (currentCheckpoint === null) {
        if (
          permitConsumption.status !== "consumed_now" ||
          states.some((state) => state.permitConsumed) ||
          (latest.permitConsumed && latest.phase !== "permit_consumed")
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_PERMIT_CONSUMED_WITHOUT_CHECKPOINT",
            "The signed one-run preview permit was consumed without a complete transform checkpoint; deterministic re-execution is still forbidden and a fresh permit is required.",
          );
        }
        outputDirectory = await captureChildDirectory(
          jobDirectory,
          "review-output",
          "private review output directory",
        );
        await notifyPhase(
          options,
          subject,
          lease,
          attemptOrdinal,
          "transform_started",
        );
        const transformed = await runFoundryOfflineNormalizeMeshGlbPreview({
          invocation,
          sourceBytes,
          permitEnvelope: options.permitEnvelope,
          pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
        });
        assertNotCancelled(options.signal);
        const reportBytes = canonicalBytes(transformed.report);
        await writeAtomicExclusiveInDirectory(
          outputDirectory,
          "normalized.glb",
          transformed.normalizedGlb,
          "normalized_glb",
          host.durabilityFaultInjector,
        );
        await writeAtomicExclusiveInDirectory(
          outputDirectory,
          "normalization-report.json",
          reportBytes,
          "normalization_report",
          host.durabilityFaultInjector,
        );
        currentCheckpoint = sealCheckpoint(
          {
            schemaVersion:
              FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_CHECKPOINT_V0,
            commandId: subject.commandId,
            subjectSha256: subject.subjectSha256,
            permitPayloadSha256: subject.permitPayloadSha256,
            sourceSha256: subject.source.sha256,
            previewInvocationSha256: subject.previewInvocationSha256,
            normalizedGlb: {
              sizeBytes: transformed.normalizedGlb.length,
              sha256: `sha256:${sha256Bytes(transformed.normalizedGlb)}`,
            },
            normalizationReport: {
              sizeBytes: reportBytes.length,
              sha256: `sha256:${sha256Bytes(reportBytes)}`,
              reportSha256: transformed.report.reportSha256,
            },
            createdAt: new Date().toISOString(),
            transformCompleted: true,
            freshVerificationCompleted: false,
            authority: "none",
          },
          authenticationKey,
        );
        await writeAtomicExclusiveInDirectory(
          outputDirectory,
          "transform-checkpoint.json",
          canonicalBytes(currentCheckpoint),
          "checkpoint",
          host.durabilityFaultInjector,
        );
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "checkpointed",
          permitConsumed: true,
          checkpointSha256: currentCheckpoint.checkpointSha256,
          artifactIndexSha256: null,
          failureCode: null,
        });
        await notifyPhase(
          options,
          subject,
          lease,
          attemptOrdinal,
          "checkpoint_committed",
        );
      } else if (
        latest.checkpointSha256 !== currentCheckpoint.checkpointSha256
      ) {
        latest = await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "checkpointed",
          permitConsumed: true,
          checkpointSha256: currentCheckpoint.checkpointSha256,
          artifactIndexSha256: null,
          failureCode: null,
        });
      }

      if (options.pauseAfterCheckpoint === true) {
        await appendState({
          stateDirectory,
          subject,
          authenticationKey,
          lease,
          attemptOrdinal,
          phase: "paused",
          permitConsumed: true,
          checkpointSha256: currentCheckpoint.checkpointSha256,
          artifactIndexSha256: null,
          failureCode: null,
        });
        sourceBytes.fill(0);
        return {
          status: "paused",
          commandId: subject.commandId,
          checkpointSha256: currentCheckpoint.checkpointSha256,
          authority: "none",
          productionExecution: "disabled",
        };
      }

      if (outputDirectory === null) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_CHECKPOINT_OUTPUT_MISSING",
          "A complete checkpoint has no canonical private review output directory.",
        );
      }

      const loaded = await loadCheckpoint({
        outputDirectory,
        subject,
        authenticationKey,
      });
      await verifyFoundryOfflineNormalizeMeshGlbPreview({
        invocation,
        sourceBytes,
        permitEnvelope: options.permitEnvelope,
        pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
        normalizedGlb: loaded.normalizedGlb,
        report: loaded.report,
      });
      await notifyPhase(
        options,
        subject,
        lease,
        attemptOrdinal,
        "fresh_verification_completed",
      );
      latest = await appendState({
        stateDirectory,
        subject,
        authenticationKey,
        lease,
        attemptOrdinal,
        phase: "verified",
        permitConsumed: true,
        checkpointSha256: loaded.checkpoint.checkpointSha256,
        artifactIndexSha256: latest.artifactIndexSha256,
        failureCode: null,
      });

      const finalStagedControl = await readStagedControlEvidenceFromSnapshot(
        staged.stagedRoot,
      );
      const finalSourceBytes = await readExactStagedSource({
        stagedRoot: staged.stagedRoot,
        subject,
      });
      const finalSourceMatches =
        finalSourceBytes.length === sourceBytes.length &&
        `sha256:${sha256Bytes(finalSourceBytes)}` === subject.source.sha256;
      finalSourceBytes.fill(0);
      const finalPolicyState =
        FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse(
          await host.getTrustedDerivativeRightsPolicyState(),
        );
      if (
        stableCanonicalJson(toCanonicalJson(finalPolicyState)) !==
        stableCanonicalJson(toCanonicalJson(policyState))
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_TRUSTED_POLICY_CHANGED",
          "The host-trusted derivative policy generation or revocation state changed before commit.",
        );
      }
      const finalRights = validateFoundryDerivativeRightsApproval(
        job,
        staged.manifest,
        rightsApproval,
        new Date(),
        finalPolicyState,
      );
      verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
        invocation,
        permitEnvelope: options.permitEnvelope,
        pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
      });
      if (
        finalStagedControl.index.stagingSha256 !== subject.stagingIndexSha256 ||
        computeFoundryIngestManifestSha256(finalStagedControl.manifest) !==
          subject.ingestManifestSha256 ||
        !finalSourceMatches ||
        !finalRights.valid
      ) {
        fail(
          "LOCAL_NORMALIZATION_PREVIEW_COMMIT_REVALIDATION_FAILED",
          "Staged custody or exact derivative rights changed before authority-none output commit.",
        );
      }
      assertNotCancelled(options.signal);

      const proposedReceipt = sealReceipt(
        {
          schemaVersion:
            FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_RECEIPT_V0,
          commandId: subject.commandId,
          subjectSha256: subject.subjectSha256,
          checkpointSha256: loaded.checkpoint.checkpointSha256,
          stagingIndexSha256: subject.stagingIndexSha256,
          ingestManifestSha256: subject.ingestManifestSha256,
          jobSpecSha256: subject.jobSpecSha256,
          derivativeRightsApprovalSha256:
            subject.derivativeRightsApprovalSha256,
          derivativeRightsPolicyDefinitionSha256:
            subject.derivativeRightsPolicyDefinitionSha256,
          previewInvocationSha256: subject.previewInvocationSha256,
          permitPayloadSha256: subject.permitPayloadSha256,
          source: subject.source,
          output: {
            sizeBytes: loaded.normalizedGlb.length,
            sha256: `sha256:${sha256Bytes(loaded.normalizedGlb)}`,
            reportSha256: loaded.report.reportSha256,
          },
          completedAt: new Date().toISOString(),
          outputDisposition: "private_quarantine_review_only",
          sourceCustody: "verified_staged_copy_read_only",
          outputCustody:
            "linux_procfd_bound_atomic_noreplace_private_directory",
          capabilities: {
            review: "local_only",
            measurement: "not_authorized",
            signing: "not_authorized",
            registration: "not_authorized",
            redistribution: "not_authorized",
            publication: "not_authorized",
            runtimePromotion: "not_authorized",
          },
          authority: "none",
          productionExecution: "disabled",
        },
        authenticationKey,
      );
      let committedReceipt = proposedReceipt;
      try {
        await writeAtomicExclusiveInDirectory(
          outputDirectory,
          "execution-receipt.json",
          canonicalBytes(proposedReceipt),
          "receipt",
          host.durabilityFaultInjector,
        );
      } catch (error: unknown) {
        if (errorCode(error) !== "EEXIST") throw error;
        const existingReceipt = parseReceipt(
          await readCanonicalJsonInDirectory(
            outputDirectory,
            "execution-receipt.json",
          ),
          authenticationKey,
        );
        if (
          existingReceipt.subjectSha256 !== subject.subjectSha256 ||
          existingReceipt.checkpointSha256 !==
            loaded.checkpoint.checkpointSha256 ||
          existingReceipt.output.sha256 !==
            loaded.checkpoint.normalizedGlb.sha256 ||
          existingReceipt.output.sizeBytes !==
            loaded.checkpoint.normalizedGlb.sizeBytes ||
          existingReceipt.output.reportSha256 !== loaded.report.reportSha256
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_EXISTING_RECEIPT_MISMATCH",
            "An existing local preview receipt does not bind this exact checkpoint.",
          );
        }
        committedReceipt = existingReceipt;
      }
      if (options.pauseAfterCommitBoundary === "receipt") {
        sourceBytes.fill(0);
        return {
          status: "paused",
          commandId: subject.commandId,
          checkpointSha256: loaded.checkpoint.checkpointSha256,
          authority: "none",
          productionExecution: "disabled",
        };
      }
      const files = await Promise.all([
        indexedFile(
          outputDirectory,
          "execution-receipt.json",
          "application/json",
        ),
        indexedFile(
          outputDirectory,
          "normalization-report.json",
          "application/json",
        ),
        indexedFile(outputDirectory, "normalized.glb", "model/gltf-binary"),
        indexedFile(
          outputDirectory,
          "transform-checkpoint.json",
          "application/json",
        ),
      ]);
      files.sort((left, right) => left.name.localeCompare(right.name));
      const proposedIndex = sealIndex(
        {
          schemaVersion: FOUNDRY_LOCAL_RESUMABLE_NORMALIZATION_PREVIEW_INDEX_V0,
          commandId: subject.commandId,
          subjectSha256: subject.subjectSha256,
          receiptSha256: committedReceipt.receiptSha256,
          checkpointSha256: loaded.checkpoint.checkpointSha256,
          files,
          commitMarker: "artifact_index_content_fsynced_last",
          outputDisposition: "private_quarantine_review_only",
          authority: "none",
        },
        authenticationKey,
      );
      try {
        await writeAtomicExclusiveInDirectory(
          outputDirectory,
          "artifact-index.json",
          canonicalBytes(proposedIndex),
          "index",
          host.durabilityFaultInjector,
        );
      } catch (error: unknown) {
        if (errorCode(error) !== "EEXIST") throw error;
        const existingIndex = parseIndex(
          await readCanonicalJsonInDirectory(
            outputDirectory,
            "artifact-index.json",
          ),
          authenticationKey,
        );
        if (
          existingIndex.subjectSha256 !== subject.subjectSha256 ||
          existingIndex.checkpointSha256 !==
            loaded.checkpoint.checkpointSha256 ||
          existingIndex.receiptSha256 !== committedReceipt.receiptSha256 ||
          existingIndex.indexSha256 !== proposedIndex.indexSha256
        ) {
          fail(
            "LOCAL_NORMALIZATION_PREVIEW_EXISTING_INDEX_MISMATCH",
            "An existing local preview artifact index differs from the exact commit.",
          );
        }
      }
      if (options.pauseAfterCommitBoundary === "index") {
        sourceBytes.fill(0);
        return {
          status: "paused",
          commandId: subject.commandId,
          checkpointSha256: loaded.checkpoint.checkpointSha256,
          authority: "none",
          productionExecution: "disabled",
        };
      }
      const verified = await verifyFinalOutput({
        outputDirectory,
        subject,
        authenticationKey,
        invocation,
        permitEnvelope: options.permitEnvelope,
        pinnedTrustedPermitKeys: host.pinnedTrustedPermitKeys,
        sourceBytes,
      });
      sourceBytes.fill(0);
      latest = await appendState({
        stateDirectory,
        subject,
        authenticationKey,
        lease,
        attemptOrdinal,
        phase: "succeeded",
        permitConsumed: true,
        checkpointSha256: loaded.checkpoint.checkpointSha256,
        artifactIndexSha256: verified.index.indexSha256,
        failureCode: null,
      });
      await notifyPhase(
        options,
        subject,
        lease,
        attemptOrdinal,
        "output_committed",
      );
      return {
        status: "succeeded",
        commandId: subject.commandId,
        outputDirectory: outputDirectory.path,
        normalizedGlbPath: resolve(outputDirectory.path, "normalized.glb"),
        reportPath: resolve(outputDirectory.path, "normalization-report.json"),
        receipt: verified.receipt,
        index: verified.index,
        authority: "none",
        productionExecution: "disabled",
      };
    } catch (error: unknown) {
      if (isInjectedDurabilityInterruption(error)) throw error;
      const states = await readStateChain(
        stateDirectory,
        subject,
        authenticationKey,
      );
      const latest = states.at(-1);
      if (
        latest !== undefined &&
        latest.phase !== "succeeded" &&
        latest.phase !== "cancelled" &&
        latest.phase !== "failed"
      ) {
        try {
          await appendState({
            stateDirectory,
            subject,
            authenticationKey,
            lease,
            attemptOrdinal,
            phase: isCancellation(error) ? "cancelled" : "failed",
            permitConsumed: latest.permitConsumed,
            checkpointSha256:
              currentCheckpoint?.checkpointSha256 ?? latest.checkpointSha256,
            artifactIndexSha256: latest.artifactIndexSha256,
            failureCode: safeFailureCode(error),
          });
        } catch {
          // Preserve the original failure; a missing terminal append never
          // converts uncertain durable state into success.
        }
      }
      throw error;
    } finally {
      await releaseLease(lease);
    }
  } finally {
    authenticationKey.fill(0);
  }
}
