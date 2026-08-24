import { createHash } from "node:crypto";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  FoundryE57GeometryScanDescriptionV0Schema,
} from "./e57-geometry-worker.js";
import { FoundryIntegrityError } from "./errors.js";
import type { FoundryCheckpointContractV0 } from "./execution-control.js";

export const FOUNDRY_E57_SCAN_SHARDED_REDUCTION_INVOCATION_V0 =
  "omnitwin.foundry.e57-scan-sharded-reduction-invocation.v0";
export const FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0 =
  "omnitwin.foundry.e57-scan-sharded-reader-description.v0";
export const FOUNDRY_E57_SCAN_REDUCTION_MEMBER_V0 =
  "omnitwin.foundry.e57-scan-reduction-member.v0";
export const FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_V0 =
  "omnitwin.foundry.e57-scan-reduction-checkpoint.v0";
export const FOUNDRY_E57_SCAN_REDUCTION_OPERATION =
  "reduce_e57_point_cloud_by_scan";
export const FOUNDRY_E57_SCAN_REDUCTION_OPERATION_VERSION =
  "metric-aabb-voxel-first-v0";
export const FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_FORMAT =
  "venviewer-e57-scan-sharded-reduction";

export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SOURCE_BYTES =
  32 * 1024 * 1024 * 1024;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS = 2_000_000_000;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS = 256;
export const FOUNDRY_E57_SCAN_REDUCTION_BATCH_POINTS = 65_536;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN = 100_000;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_TOTAL_POINTS = 2_000_000;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_DESCRIPTION_BYTES =
  4 * 1024 * 1024;
export const FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_MEMBER_BYTES =
  32 * 1024 * 1024;

const MAXIMUM_ABSOLUTE_METRIC_COMPONENT = 1_000_000_000;
const MINIMUM_VOXEL_SIZE_M = 0.000_001;
const MAXIMUM_VOXEL_SIZE_M = 1_000_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/u;
const INVOCATION_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_SCAN_SHARDED_REDUCTION_INVOCATION_V0";
const INPUT_COMPATIBILITY_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_SCAN_SHARDED_INPUT_COMPATIBILITY_V0";
const DESCRIPTION_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0";
const MEMBER_DOMAIN = "VENVIEWER_FOUNDRY_E57_SCAN_REDUCTION_MEMBER_V0";
const CHECKPOINT_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_V0";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAXIMUM_HOSTILE_SNAPSHOT_COMPOSITE_NODES = 150_000;

interface HostileSnapshotContext {
  remainingCompositeNodes: number;
  readonly seen: WeakSet<object>;
}

function createSnapshotRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function defineSnapshotMember(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function assertSnapshotArrayOwnKeys(
  value: readonly unknown[],
  length: number,
  label: string,
  code: string,
): void {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (error: unknown) {
    fail(code, `${label} refused bounded own-key inspection.`, error);
  }
  if (keys.length !== length + 1) {
    fail(code, `${label} contains holes or unsupported own properties.`);
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      fail(code, `${label} contains an unsupported symbol property.`);
    }
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      fail(code, `${label} contains an unsupported own array property.`);
    }
  }
}

type FoundryE57GeometryScanDescriptionV0 = z.infer<
  typeof FoundryE57GeometryScanDescriptionV0Schema
>;

const MetricComponentSchema = z
  .number()
  .finite()
  .min(-MAXIMUM_ABSOLUTE_METRIC_COMPONENT)
  .max(MAXIMUM_ABSOLUTE_METRIC_COMPONENT);
const Vector3Schema = z.tuple([
  MetricComponentSchema,
  MetricComponentSchema,
  MetricComponentSchema,
]);
const VoxelIndexSchema = z.number().int().safe();

const SourceBindingSchema = z
  .object({
    assetId: z.string().regex(SAFE_ID),
    relativePath: z.string().min(1).max(4_096),
    inputType: z.enum(["generic_e57", "matterport_e57"]),
    sizeBytes: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SOURCE_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

export const FoundryE57ScanReductionCropV0Schema = z
  .object({
    frame: z.literal("e57_root"),
    units: z.literal("metre"),
    minimum: Vector3Schema,
    maximum: Vector3Schema,
    boundary: z.literal("inclusive"),
  })
  .strict()
  .superRefine((crop, ctx) => {
    for (let component = 0; component < 3; component += 1) {
      const minimum = crop.minimum[component];
      const maximum = crop.maximum[component];
      if (minimum === undefined || maximum === undefined || minimum > maximum) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", component],
          message: "crop minimum cannot exceed crop maximum",
        });
      }
    }
  });

export const FoundryE57ScanReductionVoxelPolicyV0Schema = z
  .object({
    kind: z.literal("fixed_metric_grid_first_source_point"),
    voxelSizeM: z
      .number()
      .finite()
      .min(MINIMUM_VOXEL_SIZE_M)
      .max(MAXIMUM_VOXEL_SIZE_M),
    originM: Vector3Schema,
    indexRule: z.literal("ieee754_binary64_floor_toward_negative_infinity"),
    representativeRule: z.literal(
      "first_valid_crop_point_in_source_order",
    ),
    outputOrder: z.literal("source_point_index_ascending"),
  })
  .strict();

const LimitsSchema = z
  .object({
    maximumInputPoints: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS),
    maximumScans: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS),
    internalBatchPoints: z.literal(
      FOUNDRY_E57_SCAN_REDUCTION_BATCH_POINTS,
    ),
    maximumRepresentativesPerScan: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN),
    maximumTotalRepresentatives: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_TOTAL_POINTS),
  })
  .strict()
  .superRefine((limits, ctx) => {
    if (
      limits.maximumRepresentativesPerScan >
      limits.maximumTotalRepresentatives
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximumRepresentativesPerScan"],
        message:
          "per-scan representative limit cannot exceed aggregate representative limit",
      });
    }
  });

const CoordinateContractSchema = z
  .object({
    inputPointFrame: z.literal("e57_data3d_local_cartesian"),
    scanPoseConvention: z.literal(
      "normalized_quaternion_wxyz_then_translation_metres",
    ),
    reductionFrame: z.literal("e57_root"),
    units: z.literal("metre"),
    axes: z.literal("right_handed_z_up"),
  })
  .strict();

const ContentPolicySchema = z
  .object({
    capturedMovableContent: z.literal("unclassified_possible_and_retained"),
    semanticMasking: z.literal("not_performed"),
    placementAuthority: z.literal("excluded"),
    measurementAuthority: z.literal("excluded"),
    collisionAuthority: z.literal("excluded"),
    exportAuthority: z.literal("excluded"),
  })
  .strict();

const PersistenceContractSchema = z
  .object({
    memberCommit: z.literal(
      "caller_supplied_create_only_then_exact_reread",
    ),
    memberRewrite: z.literal("forbidden"),
    completedPrefix: z.literal("contiguous_scan_order_only"),
    resumeRead: z.literal("restart_current_scan_from_source_point_zero"),
    sourceResumeIdentity: z.literal(
      "full_sha256_before_each_session_and_after_clean_terminal",
    ),
    storeCustody: z.literal("caller_supplied_unverified"),
    executorAuthentication: z.literal("not_established"),
    fenceOwnership: z.literal("not_established"),
    activation: z.literal(false),
  })
  .strict();

const CheckpointContractSchema = z
  .object({
    format: z.literal(FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_FORMAT),
    formatVersion: z.literal("v0"),
    stageId: z.literal(FOUNDRY_E57_SCAN_REDUCTION_OPERATION),
    workerImageSha256: z.string().regex(SHA256),
    recipeSha256: z.string().regex(SHA256),
    stageGraphSha256: z.string().regex(SHA256),
    ingestManifestSha256: z.string().regex(SHA256),
    checkpointCommandSha256: z.string().regex(SHA256),
    inputCompatibilitySha256: z.string().regex(SHA256),
  })
  .strict();

const InputCompatibilityMaterialSchema = z
  .object({
    source: SourceBindingSchema,
    sourceFactsArtifactSha256: z.string().regex(SHA256),
    crop: FoundryE57ScanReductionCropV0Schema,
    voxelPolicy: FoundryE57ScanReductionVoxelPolicyV0Schema,
    limits: LimitsSchema,
    coordinateContract: CoordinateContractSchema,
    contentPolicy: ContentPolicySchema,
    persistenceContract: PersistenceContractSchema,
  })
  .strict();

export const FoundryE57ScanShardedReductionInvocationV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_E57_SCAN_SHARDED_REDUCTION_INVOCATION_V0,
    ),
    operation: z.literal(FOUNDRY_E57_SCAN_REDUCTION_OPERATION),
    operationVersion: z.literal(
      FOUNDRY_E57_SCAN_REDUCTION_OPERATION_VERSION,
    ),
    executionMode: z.literal("local_dependency_injected_authority_none"),
    source: SourceBindingSchema,
    sourceFactsArtifactSha256: z.string().regex(SHA256),
    crop: FoundryE57ScanReductionCropV0Schema,
    voxelPolicy: FoundryE57ScanReductionVoxelPolicyV0Schema,
    limits: LimitsSchema,
    coordinateContract: CoordinateContractSchema,
    contentPolicy: ContentPolicySchema,
    persistenceContract: PersistenceContractSchema,
    checkpointContract: CheckpointContractSchema,
    networkAccess: z.literal("none"),
    imageDecoderAccess: z.literal("none"),
    imageExtraction: z.literal("none"),
    modelInference: z.literal("none"),
    modelTraining: z.literal("none"),
    authority: z.literal("none"),
    activation: z.literal(false),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    const expected = computeInputCompatibilitySha256({
      source: invocation.source,
      sourceFactsArtifactSha256: invocation.sourceFactsArtifactSha256,
      crop: invocation.crop,
      voxelPolicy: invocation.voxelPolicy,
      limits: invocation.limits,
      coordinateContract: invocation.coordinateContract,
      contentPolicy: invocation.contentPolicy,
      persistenceContract: invocation.persistenceContract,
    });
    if (invocation.checkpointContract.inputCompatibilitySha256 !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpointContract", "inputCompatibilitySha256"],
        message:
          "checkpoint input compatibility does not bind the exact source, crop, voxel, limits, frame, content, and persistence policy",
      });
    }
  });

export type FoundryE57ScanShardedReductionInvocationV0 = z.infer<
  typeof FoundryE57ScanShardedReductionInvocationV0Schema
>;

export type FoundryE57ScanShardedCheckpointContractV0 =
  FoundryCheckpointContractV0 & {
    readonly format: typeof FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_FORMAT;
    readonly formatVersion: "v0";
    readonly stageId: typeof FOUNDRY_E57_SCAN_REDUCTION_OPERATION;
  };

const ReaderDescriptionMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0,
    ),
    invocationSha256: z.string().regex(SHA256),
    inputCompatibilitySha256: z.string().regex(SHA256),
    source: SourceBindingSchema,
    adapter: z
      .object({
        name: z.literal("pye57_persistent_scan_sharded_reducer"),
        version: z.string().regex(SAFE_VERSION),
        bridgeArtifactSha256: z.string().regex(SHA256),
        pythonExecutableSha256: z.string().regex(SHA256),
        pythonExecutableSizeBytes: z.number().int().safe().positive(),
        pythonVersion: z.string().min(1).max(160),
        numpyVersion: z.string().min(1).max(160),
        identityAuthority: z.literal("caller_supplied_unverified"),
      })
      .strict(),
    readPolicy: z
      .object({
        sourceAccess: z.literal("read_only_pre_and_clean_terminal_sha256"),
        scanAccess: z.literal(
          "direct_scan_reader_sequential_from_source_point_zero",
        ),
        rawPointTransport: z.literal("kept_inside_pinned_python_bridge"),
        emittedPayload: z.literal("bounded_reduced_representatives_only"),
        imageDecoderAccess: z.literal(false),
        imageExtraction: z.literal(false),
        network: z.literal("none"),
        modelInference: z.literal("none"),
        modelTraining: z.literal("none"),
      })
      .strict(),
    crop: FoundryE57ScanReductionCropV0Schema,
    voxelPolicy: FoundryE57ScanReductionVoxelPolicyV0Schema,
    limits: LimitsSchema,
    coordinateContract: CoordinateContractSchema,
    scans: z
      .array(FoundryE57GeometryScanDescriptionV0Schema)
      .min(1)
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS),
    totalPointCount: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS),
    authority: z.literal("none"),
    activation: z.literal(false),
  })
  .strict();

export const FoundryE57ScanShardedReaderDescriptionV0Schema =
  ReaderDescriptionMaterialSchema.extend({
    readerDescriptionSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((description, ctx) => {
      const {
        readerDescriptionSha256: _readerDescriptionSha256,
        ...material
      } = description;
      if (descriptionSha256(material) !== description.readerDescriptionSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["readerDescriptionSha256"],
          message: "reader-description digest does not match its exact payload",
        });
      }
      let total = 0;
      const guids = new Set<string>();
      for (let index = 0; index < description.scans.length; index += 1) {
        const scan = description.scans[index];
        if (
          scan === undefined ||
          scan.scanIndex !== index ||
          guids.has(scan.data3dGuid)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scans", index],
            message: "scan inventory must be contiguous with unique GUIDs",
          });
          continue;
        }
        guids.add(scan.data3dGuid);
        total += scan.pointCount;
      }
      if (total !== description.totalPointCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalPointCount"],
          message: "scan point counts do not equal totalPointCount",
        });
      }
    });

export type FoundryE57ScanShardedReaderDescriptionV0 = z.infer<
  typeof FoundryE57ScanShardedReaderDescriptionV0Schema
>;

export const FoundryE57ScanReducedPointV0Schema = z.tuple([
  z.number().int().safe().nonnegative(),
  VoxelIndexSchema,
  VoxelIndexSchema,
  VoxelIndexSchema,
  MetricComponentSchema,
  MetricComponentSchema,
  MetricComponentSchema,
]);

const CountsSchema = z
  .object({
    source: z.number().int().safe().positive(),
    processed: z.number().int().safe().positive(),
    invalid: z.number().int().safe().nonnegative(),
    croppedOut: z.number().int().safe().nonnegative(),
    validInsideCrop: z.number().int().safe().nonnegative(),
    representatives: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((counts, ctx) => {
    if (
      counts.processed !== counts.source ||
      counts.processed !==
        counts.invalid + counts.croppedOut + counts.validInsideCrop ||
      counts.representatives > counts.validInsideCrop
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scan reduction counters do not form one exact partition",
      });
    }
  });

export const FoundryE57RawReducedScanV0Schema = z
  .object({
    sourceSha256: z.string().regex(SHA256),
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    counts: CountsSchema,
    points: z
      .array(FoundryE57ScanReducedPointV0Schema)
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN),
    terminalSourceAfter: z
      .object({
        sizeBytes: z.number().int().safe().positive(),
        sha256: z.string().regex(SHA256),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type FoundryE57RawReducedScanV0 = z.infer<
  typeof FoundryE57RawReducedScanV0Schema
>;

const MemberMaterialSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_SCAN_REDUCTION_MEMBER_V0),
    invocationSha256: z.string().regex(SHA256),
    inputCompatibilitySha256: z.string().regex(SHA256),
    readerDescriptionSha256: z.string().regex(SHA256),
    source: SourceBindingSchema,
    scan: FoundryE57GeometryScanDescriptionV0Schema,
    scanIdentitySha256: z.string().regex(SHA256),
    crop: FoundryE57ScanReductionCropV0Schema,
    voxelPolicy: FoundryE57ScanReductionVoxelPolicyV0Schema,
    counts: CountsSchema,
    completion: z.enum(["complete_empty", "complete_nonempty"]),
    points: z
      .array(FoundryE57ScanReducedPointV0Schema)
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN),
    capturedMovableContent: z.literal("unclassified_possible_and_retained"),
    semanticMasking: z.literal("not_performed"),
    placementAuthority: z.literal("excluded"),
    measurementAuthority: z.literal("excluded"),
    collisionAuthority: z.literal("excluded"),
    exportAuthority: z.literal("excluded"),
    storeCustody: z.literal("caller_supplied_unverified"),
    executorAuthentication: z.literal("not_established"),
    fenceOwnership: z.literal("not_established"),
    authority: z.literal("none"),
    activation: z.literal(false),
  })
  .strict();

export const FoundryE57ScanReductionMemberV0Schema =
  MemberMaterialSchema.extend({
    memberSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((member, ctx) => {
      const { memberSha256: _memberSha256, ...material } = member;
      if (memberSha256(material) !== member.memberSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["memberSha256"],
          message: "scan-member digest does not match its exact payload",
        });
      }
      if (
        member.counts.representatives !== member.points.length ||
        (member.points.length === 0) !==
          (member.completion === "complete_empty")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["points"],
          message:
            "member completion, representative count, and point payload disagree",
        });
      }
      if (
        member.counts.source !== member.scan.pointCount ||
        member.counts.processed !== member.scan.pointCount
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counts"],
          message:
            "a complete scan member must process the exact embedded scan point count",
        });
      }
      if (scanIdentitySha256(member.scan) !== member.scanIdentitySha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scanIdentitySha256"],
          message: "scan identity digest does not bind the embedded scan",
        });
      }
      validateMemberPointOrder(member, ctx);
    });

export type FoundryE57ScanReductionMemberV0 = z.infer<
  typeof FoundryE57ScanReductionMemberV0Schema
>;

const CheckpointEntrySchema = z
  .object({
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    memberSha256: z.string().regex(SHA256),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_MEMBER_BYTES),
    completion: z.enum(["complete_empty", "complete_nonempty"]),
    representativeCount: z.number().int().safe().nonnegative(),
  })
  .strict();

const CheckpointMaterialSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_V0),
    invocationSha256: z.string().regex(SHA256),
    inputCompatibilitySha256: z.string().regex(SHA256),
    readerDescriptionSha256: z.string().regex(SHA256),
    completedMembers: z
      .array(CheckpointEntrySchema)
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS),
    nextScanIndex: z.number().int().nonnegative().nullable(),
    totalRepresentativeCount: z.number().int().safe().nonnegative(),
    complete: z.boolean(),
    storeCustody: z.literal("caller_supplied_unverified"),
    executorAuthentication: z.literal("not_established"),
    fenceOwnership: z.literal("not_established"),
    authority: z.literal("none"),
    activation: z.literal(false),
  })
  .strict();

export const FoundryE57ScanReductionCheckpointV0Schema =
  CheckpointMaterialSchema.extend({
    checkpointSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((checkpoint, ctx) => {
      const { checkpointSha256: _checkpointSha256, ...material } = checkpoint;
      if (checkpointSha256(material) !== checkpoint.checkpointSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkpointSha256"],
          message: "checkpoint digest does not match its exact payload",
        });
      }
      const representativeTotal = checkpoint.completedMembers.reduce(
        (sum, member) => sum + member.representativeCount,
        0,
      );
      if (
        checkpoint.completedMembers.some(
          (member, index) => member.scanIndex !== index,
        ) ||
        representativeTotal !== checkpoint.totalRepresentativeCount ||
        checkpoint.complete !== (checkpoint.nextScanIndex === null) ||
        (!checkpoint.complete &&
          checkpoint.nextScanIndex !== checkpoint.completedMembers.length)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "checkpoint members, next scan, completion, and representative total disagree",
        });
      }
    });

export type FoundryE57ScanReductionCheckpointV0 = z.infer<
  typeof FoundryE57ScanReductionCheckpointV0Schema
>;

export interface FoundryE57ScanReductionReader {
  describe(input: {
    readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
    readonly startScanIndex: number;
    readonly completedRepresentativeCount: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  reduceNextScan(input: {
    readonly scanIndex: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  close?(): Promise<void>;
}

export interface FoundryE57ScanReductionMemberStore {
  readReaderDescription(): Promise<Uint8Array | null>;
  createReaderDescription(
    canonicalBytes: Uint8Array,
  ): Promise<"created" | "existing">;
  listCommittedScanIndices(): Promise<readonly number[]>;
  readCommittedScanMember(scanIndex: number): Promise<Uint8Array | null>;
  createCommittedScanMember(input: {
    readonly scanIndex: number;
    readonly canonicalBytes: Uint8Array;
    readonly memberSha256: string;
  }): Promise<"created" | "existing">;
}

export type FoundryE57ScanShardedReductionResult =
  | {
      readonly status: "succeeded";
      readonly checkpoint: FoundryE57ScanReductionCheckpointV0;
    }
  | {
      readonly status: "cancelled";
      readonly checkpoint: FoundryE57ScanReductionCheckpointV0;
    };

export interface RunFoundryE57ScanShardedReductionOptions {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly reader: FoundryE57ScanReductionReader;
  readonly store: FoundryE57ScanReductionMemberStore;
  readonly signal?: AbortSignal;
  readonly onMemberCommitted?: (
    member: FoundryE57ScanReductionMemberV0,
  ) => void | Promise<void>;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function computeInputCompatibilitySha256(
  input: z.input<typeof InputCompatibilityMaterialSchema>,
): string {
  return digest(
    INPUT_COMPATIBILITY_DOMAIN,
    InputCompatibilityMaterialSchema.parse(input),
  );
}

export function computeFoundryE57ScanReductionInputCompatibilitySha256(
  input: z.input<typeof InputCompatibilityMaterialSchema>,
): string {
  return computeInputCompatibilitySha256(input);
}

export function computeFoundryE57ScanShardedReductionInvocationSha256(
  input: unknown,
): string {
  return digest(
    INVOCATION_DOMAIN,
    FoundryE57ScanShardedReductionInvocationV0Schema.parse(input),
  );
}

function descriptionSha256(
  material: z.input<typeof ReaderDescriptionMaterialSchema>,
): string {
  return digest(DESCRIPTION_DOMAIN, ReaderDescriptionMaterialSchema.parse(material));
}

export function sealFoundryE57ScanShardedReaderDescriptionV0(
  material: z.input<typeof ReaderDescriptionMaterialSchema>,
): FoundryE57ScanShardedReaderDescriptionV0 {
  const parsed = ReaderDescriptionMaterialSchema.parse(material);
  return FoundryE57ScanShardedReaderDescriptionV0Schema.parse({
    ...parsed,
    readerDescriptionSha256: descriptionSha256(parsed),
  });
}

function scanIdentitySha256(scan: FoundryE57GeometryScanDescriptionV0): string {
  return digest(
    "VENVIEWER_FOUNDRY_E57_SCAN_IDENTITY_V0",
    FoundryE57GeometryScanDescriptionV0Schema.parse(scan),
  );
}

function memberSha256(material: z.input<typeof MemberMaterialSchema>): string {
  return digest(MEMBER_DOMAIN, MemberMaterialSchema.parse(material));
}

function checkpointSha256(
  material: z.input<typeof CheckpointMaterialSchema>,
): string {
  return digest(CHECKPOINT_DOMAIN, CheckpointMaterialSchema.parse(material));
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(stableCanonicalJson(toCanonicalJson(value)), "utf8");
}

function bytesSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function withinCrop(
  point: readonly [number, number, number],
  crop: z.infer<typeof FoundryE57ScanReductionCropV0Schema>,
): boolean {
  return (
    point[0] >= crop.minimum[0] &&
    point[0] <= crop.maximum[0] &&
    point[1] >= crop.minimum[1] &&
    point[1] <= crop.maximum[1] &&
    point[2] >= crop.minimum[2] &&
    point[2] <= crop.maximum[2]
  );
}

export function computeFoundryE57ScanReductionVoxelIndex(
  coordinateM: number,
  originM: number,
  voxelSizeM: number,
): number {
  if (
    !Number.isFinite(coordinateM) ||
    !Number.isFinite(originM) ||
    !Number.isFinite(voxelSizeM) ||
    Math.abs(coordinateM) > MAXIMUM_ABSOLUTE_METRIC_COMPONENT ||
    Math.abs(originM) > MAXIMUM_ABSOLUTE_METRIC_COMPONENT ||
    voxelSizeM < MINIMUM_VOXEL_SIZE_M ||
    voxelSizeM > MAXIMUM_VOXEL_SIZE_M
  ) {
    fail(
      "E57_SCAN_REDUCTION_VOXEL_POLICY_INVALID",
      "Voxel indexing requires bounded finite metric coordinates, origin, and voxel size.",
    );
  }
  const ratio = (coordinateM - originM) / voxelSizeM;
  const result = Math.floor(ratio);
  if (!Number.isSafeInteger(result)) {
    fail(
      "E57_SCAN_REDUCTION_VOXEL_INDEX_OVERFLOW",
      "A metric point produced a voxel index outside the exact safe-integer contract.",
    );
  }
  return Object.is(result, -0) ? 0 : result;
}

function validateMemberPointOrder(
  member: z.infer<typeof MemberMaterialSchema>,
  ctx: z.RefinementCtx,
): void {
  let previousSourcePointIndex = -1;
  const voxelKeys = new Set<string>();
  for (let index = 0; index < member.points.length; index += 1) {
    const point = member.points[index];
    if (point === undefined) continue;
    const [sourcePointIndex, voxelX, voxelY, voxelZ, xM, yM, zM] = point;
    const coordinates = [xM, yM, zM] as const;
    const expectedVoxel = [
      computeFoundryE57ScanReductionVoxelIndex(
        coordinates[0],
        member.voxelPolicy.originM[0],
        member.voxelPolicy.voxelSizeM,
      ),
      computeFoundryE57ScanReductionVoxelIndex(
        coordinates[1],
        member.voxelPolicy.originM[1],
        member.voxelPolicy.voxelSizeM,
      ),
      computeFoundryE57ScanReductionVoxelIndex(
        coordinates[2],
        member.voxelPolicy.originM[2],
        member.voxelPolicy.voxelSizeM,
      ),
    ] as const;
    const voxelKey = `${String(voxelX)}:${String(voxelY)}:${String(voxelZ)}`;
    if (
      sourcePointIndex <= previousSourcePointIndex ||
      sourcePointIndex >= member.scan.pointCount ||
      !withinCrop(coordinates, member.crop) ||
      voxelX !== expectedVoxel[0] ||
      voxelY !== expectedVoxel[1] ||
      voxelZ !== expectedVoxel[2] ||
      voxelKeys.has(voxelKey)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["points", index],
        message:
          "reduced points must be unique-voxel, source-ordered, in-crop representatives with exact floor indices",
      });
    }
    previousSourcePointIndex = sourcePointIndex;
    voxelKeys.add(voxelKey);
  }
}

function sealMember(input: {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly description: FoundryE57ScanShardedReaderDescriptionV0;
  readonly raw: FoundryE57RawReducedScanV0;
}): FoundryE57ScanReductionMemberV0 {
  const scan = input.description.scans[input.raw.scanIndex];
  if (
    scan === undefined ||
    input.raw.sourceSha256 !== input.invocation.source.sha256 ||
    input.raw.data3dGuid !== scan.data3dGuid ||
    input.raw.counts.source !== scan.pointCount ||
    input.raw.points.length !== input.raw.counts.representatives ||
    input.raw.points.length >
      input.invocation.limits.maximumRepresentativesPerScan
  ) {
    fail(
      "E57_SCAN_REDUCTION_SCAN_BINDING_MISMATCH",
      "Reduced scan output does not bind its exact source, scan, count, and per-scan cap.",
    );
  }
  const material = MemberMaterialSchema.parse({
    schemaVersion: FOUNDRY_E57_SCAN_REDUCTION_MEMBER_V0,
    invocationSha256:
      computeFoundryE57ScanShardedReductionInvocationSha256(input.invocation),
    inputCompatibilitySha256:
      input.invocation.checkpointContract.inputCompatibilitySha256,
    readerDescriptionSha256: input.description.readerDescriptionSha256,
    source: input.invocation.source,
    scan,
    scanIdentitySha256: scanIdentitySha256(scan),
    crop: input.invocation.crop,
    voxelPolicy: input.invocation.voxelPolicy,
    counts: input.raw.counts,
    completion:
      input.raw.points.length === 0 ? "complete_empty" : "complete_nonempty",
    points: input.raw.points,
    capturedMovableContent: "unclassified_possible_and_retained",
    semanticMasking: "not_performed",
    placementAuthority: "excluded",
    measurementAuthority: "excluded",
    collisionAuthority: "excluded",
    exportAuthority: "excluded",
    storeCustody: "caller_supplied_unverified",
    executorAuthentication: "not_established",
    fenceOwnership: "not_established",
    authority: "none",
    activation: false,
  });
  return FoundryE57ScanReductionMemberV0Schema.parse({
    ...material,
    memberSha256: memberSha256(material),
  });
}

function snapshotOwnDataObject(
  value: unknown,
  label: string,
  code: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(code, `${label} must be one own-data-property object.`);
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (error: unknown) {
    fail(code, `${label} refused bounded own-key inspection.`, error);
  }
  if (keys.length > 512 || keys.some((key) => typeof key !== "string")) {
    fail(code, `${label} has an unsupported or over-limit own-key set.`);
  }
  const result = createSnapshotRecord();
  for (const propertyKey of keys) {
    const key = String(propertyKey);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch (error: unknown) {
      fail(code, `${label}.${key} refused own-data inspection.`, error);
    }
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(code, `${label}.${key} must be an own data property.`);
    }
    defineSnapshotMember(result, key, descriptor.value);
  }
  return result;
}

function snapshotBoundedData(
  value: unknown,
  maximumArrayLength: number,
  label: string,
  code: string,
  depth = 0,
  context: HostileSnapshotContext = {
    remainingCompositeNodes: MAXIMUM_HOSTILE_SNAPSHOT_COMPOSITE_NODES,
    seen: new WeakSet(),
  },
): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (depth > 16) {
    fail(code, `${label} exceeds the bounded nesting depth.`);
  }
  if (typeof value === "object") {
    if (
      context.seen.has(value) ||
      context.remainingCompositeNodes <= 0
    ) {
      fail(
        code,
        `${label} repeats an object identity or exceeds the aggregate snapshot-node budget.`,
      );
    }
    context.seen.add(value);
    context.remainingCompositeNodes -= 1;
  }
  if (Array.isArray(value)) {
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    } catch (error: unknown) {
      fail(code, `${label} refused bounded length inspection.`, error);
    }
    const length: unknown = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumArrayLength
    ) {
      fail(code, `${label} exceeds its pre-schema array-length bound.`);
    }
    assertSnapshotArrayOwnKeys(value, length, label, code);
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      } catch (error: unknown) {
        fail(code, `${label}[${String(index)}] refused inspection.`, error);
      }
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        fail(
          code,
          `${label}[${String(index)}] must be one present own data property.`,
        );
      }
      result.push(
        snapshotBoundedData(
          descriptor.value,
          maximumArrayLength,
          `${label}[${String(index)}]`,
          code,
          depth + 1,
          context,
        ),
      );
    }
    return result;
  }
  if (typeof value === "object") {
    const object = snapshotOwnDataObject(value, label, code);
    const result = createSnapshotRecord();
    for (const [key, member] of Object.entries(object)) {
      defineSnapshotMember(
        result,
        key,
        snapshotBoundedData(
          member,
          maximumArrayLength,
          `${label}.${key}`,
          code,
          depth + 1,
          context,
        ),
      );
    }
    return result;
  }
  fail(code, `${label} contains an unsupported data value.`);
}

function snapshotWithBoundedArrayProperty(input: {
  readonly value: unknown;
  readonly arrayProperty: string;
  readonly maximumArrayLength: number;
  readonly nestedMaximumArrayLength: number;
  readonly label: string;
  readonly code: string;
}): unknown {
  const context: HostileSnapshotContext = {
    remainingCompositeNodes: MAXIMUM_HOSTILE_SNAPSHOT_COMPOSITE_NODES,
    seen: new WeakSet(),
  };
  if (typeof input.value === "object" && input.value !== null) {
    context.seen.add(input.value);
    context.remainingCompositeNodes -= 1;
  }
  const object = snapshotOwnDataObject(input.value, input.label, input.code);
  const result = createSnapshotRecord();
  for (const [key, member] of Object.entries(object)) {
    if (key === input.arrayProperty) {
      if (!Array.isArray(member)) {
        fail(
          input.code,
          `${input.label}.${key} must be one bounded data array.`,
        );
      }
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Reflect.getOwnPropertyDescriptor(member, "length");
      } catch (error: unknown) {
        fail(
          input.code,
          `${input.label}.${key} refused bounded length inspection.`,
          error,
        );
      }
      const length: unknown = lengthDescriptor?.value;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > input.maximumArrayLength
      ) {
        fail(
          input.code,
          `${input.label}.${key} exceeds its invocation-bound length cap.`,
        );
      }
      assertSnapshotArrayOwnKeys(
        member,
        length,
        `${input.label}.${key}`,
        input.code,
      );
      if (
        context.seen.has(member) ||
        context.remainingCompositeNodes <= 0
      ) {
        fail(
          input.code,
          `${input.label}.${key} repeats an object identity or exceeds the aggregate snapshot-node budget.`,
        );
      }
      context.seen.add(member);
      context.remainingCompositeNodes -= 1;
      const arrayResult: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Reflect.getOwnPropertyDescriptor(
            member,
            String(index),
          );
        } catch (error: unknown) {
          fail(
            input.code,
            `${input.label}.${key}[${String(index)}] refused inspection.`,
            error,
          );
        }
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined
        ) {
          fail(
            input.code,
            `${input.label}.${key}[${String(index)}] must be one present own data property.`,
          );
        }
        arrayResult.push(
          snapshotBoundedData(
            descriptor.value,
            input.nestedMaximumArrayLength,
            `${input.label}.${key}[${String(index)}]`,
            input.code,
            0,
            context,
          ),
        );
      }
      defineSnapshotMember(result, key, arrayResult);
      continue;
    }
    defineSnapshotMember(
      result,
      key,
      snapshotBoundedData(
        member,
        input.nestedMaximumArrayLength,
        `${input.label}.${key}`,
        input.code,
        0,
        context,
      ),
    );
  }
  return result;
}

function parseGuardedReaderValue<T>(input: {
  readonly value: unknown;
  readonly schema: z.ZodType<T>;
  readonly code: string;
  readonly label: string;
}): T {
  const parsed = input.schema.safeParse(input.value);
  if (!parsed.success) {
    fail(
      input.code,
      `${input.label} failed its exact strict schema.`,
      parsed.error,
    );
  }
  return parsed.data;
}

function parseCanonicalBytes<T>(input: {
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly schema: z.ZodType<T>;
  readonly code: string;
  readonly label: string;
  readonly preSchemaArray?: {
    readonly property: string;
    readonly maximumLength: number;
    readonly overLimitCode?: string;
  };
}): T {
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > input.maximumBytes) {
    fail(input.code, `${input.label} is empty or exceeds its fixed byte bound.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(UTF8_DECODER.decode(input.bytes)) as unknown;
  } catch (error: unknown) {
    fail(input.code, `${input.label} is not strict UTF-8 JSON.`, error);
  }
  if (input.preSchemaArray !== undefined) {
    const object = snapshotOwnDataObject(
      value,
      input.label,
      input.code,
    );
    const member = object[input.preSchemaArray.property];
    if (!Array.isArray(member)) {
      fail(
        input.code,
        `${input.label}.${input.preSchemaArray.property} must be one bounded data array.`,
      );
    }
    const length = Reflect.getOwnPropertyDescriptor(member, "length")?.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      fail(
        input.code,
        `${input.label}.${input.preSchemaArray.property} has an invalid array length.`,
      );
    }
    if (length > input.preSchemaArray.maximumLength) {
      fail(
        input.preSchemaArray.overLimitCode ?? input.code,
        `${input.label}.${input.preSchemaArray.property} exceeds its pre-schema invocation cap.`,
      );
    }
  }
  let parsed: T;
  try {
    parsed = input.schema.parse(value);
  } catch (error: unknown) {
    fail(input.code, `${input.label} failed its exact schema and digest.`, error);
  }
  if (!Buffer.from(input.bytes).equals(canonicalBytes(parsed))) {
    fail(input.code, `${input.label} is not canonical JSON.`);
  }
  return parsed;
}

async function loadStoredDescription(
  store: FoundryE57ScanReductionMemberStore,
  maximumScans: number,
): Promise<FoundryE57ScanShardedReaderDescriptionV0 | null> {
  const bytes = await store.readReaderDescription();
  if (bytes === null) return null;
  return parseCanonicalBytes({
    bytes,
    maximumBytes: FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_DESCRIPTION_BYTES,
    schema: FoundryE57ScanShardedReaderDescriptionV0Schema,
    code: "E57_SCAN_REDUCTION_DESCRIPTION_TAMPERED",
    label: "Stored scan-reduction reader description",
    preSchemaArray: {
      property: "scans",
      maximumLength: maximumScans,
    },
  });
}

async function loadCommittedScanIndices(input: {
  readonly store: FoundryE57ScanReductionMemberStore;
  readonly maximumScans: number;
}): Promise<readonly number[]> {
  const rawIndices: unknown =
    await input.store.listCommittedScanIndices();
  const guarded = snapshotBoundedData(
    rawIndices,
    input.maximumScans,
    "Caller-supplied committed scan indices",
    "E57_SCAN_REDUCTION_STORE_INDEX_PRECHECK_FAILED",
  );
  const parsed = z
    .array(z.number().int().nonnegative())
    .max(input.maximumScans)
    .safeParse(guarded);
  if (!parsed.success) {
    fail(
      "E57_SCAN_REDUCTION_STORE_INDEX_PRECHECK_FAILED",
      "Caller-supplied committed scan indices must be one bounded present integer array.",
      parsed.error,
    );
  }
  return parsed.data;
}

function assertDescriptionBinding(input: {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly description: FoundryE57ScanShardedReaderDescriptionV0;
}): void {
  const invocationSha256 =
    computeFoundryE57ScanShardedReductionInvocationSha256(input.invocation);
  if (
    input.description.invocationSha256 !== invocationSha256 ||
    input.description.inputCompatibilitySha256 !==
      input.invocation.checkpointContract.inputCompatibilitySha256 ||
    !sameCanonical(input.description.source, input.invocation.source) ||
    !sameCanonical(input.description.crop, input.invocation.crop) ||
    !sameCanonical(
      input.description.voxelPolicy,
      input.invocation.voxelPolicy,
    ) ||
    !sameCanonical(input.description.limits, input.invocation.limits) ||
    !sameCanonical(
      input.description.coordinateContract,
      input.invocation.coordinateContract,
    ) ||
    input.description.scans.length > input.invocation.limits.maximumScans ||
    input.description.totalPointCount >
      input.invocation.limits.maximumInputPoints
  ) {
    fail(
      "E57_SCAN_REDUCTION_DESCRIPTION_BINDING_MISMATCH",
      "Reader description does not bind the exact invocation, source, policy, limits, and scan inventory.",
    );
  }
}

async function commitDescription(input: {
  readonly store: FoundryE57ScanReductionMemberStore;
  readonly description: FoundryE57ScanShardedReaderDescriptionV0;
}): Promise<void> {
  const bytes = canonicalBytes(input.description);
  if (bytes.length > FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_DESCRIPTION_BYTES) {
    fail(
      "E57_SCAN_REDUCTION_DESCRIPTION_LIMIT_EXCEEDED",
      "Reader description exceeds its fixed persisted byte bound.",
    );
  }
  const result = await input.store.createReaderDescription(bytes);
  if (result !== "created") {
    fail(
      "E57_SCAN_REDUCTION_STORE_OVERWRITE_RACE",
      "A reader description appeared after the coordinator proved its slot absent.",
    );
  }
  const reread = await input.store.readReaderDescription();
  if (reread === null || !Buffer.from(reread).equals(bytes)) {
    fail(
      "E57_SCAN_REDUCTION_STORE_REREAD_MISMATCH",
      "The create-only reader description did not survive exact re-read.",
    );
  }
}

async function loadStoredMembers(input: {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly description: FoundryE57ScanShardedReaderDescriptionV0;
  readonly store: FoundryE57ScanReductionMemberStore;
}): Promise<{
  readonly entries: z.infer<typeof CheckpointEntrySchema>[];
}> {
  const indices = await loadCommittedScanIndices({
    store: input.store,
    maximumScans: input.description.scans.length,
  });
  if (
    indices.length > input.description.scans.length ||
    indices.some((scanIndex, index) => scanIndex !== index)
  ) {
    fail(
      "E57_SCAN_REDUCTION_PREFIX_NONCONTIGUOUS",
      "Committed scan members must be listed once in exact contiguous scan order.",
    );
  }
  const entries: z.infer<typeof CheckpointEntrySchema>[] = [];
  let totalRepresentatives = 0;
  for (const scanIndex of indices) {
    const bytes = await input.store.readCommittedScanMember(scanIndex);
    if (bytes === null) {
      fail(
        "E57_SCAN_REDUCTION_MEMBER_MISSING",
        "A listed committed scan member is missing.",
      );
    }
    const member = parseCanonicalBytes({
      bytes,
      maximumBytes: FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_MEMBER_BYTES,
      schema: FoundryE57ScanReductionMemberV0Schema,
      code: "E57_SCAN_REDUCTION_MEMBER_TAMPERED",
      label: `Stored scan-reduction member ${String(scanIndex)}`,
      preSchemaArray: {
        property: "points",
        maximumLength:
          input.invocation.limits.maximumRepresentativesPerScan,
        overLimitCode: "E57_SCAN_REDUCTION_MEMBER_BINDING_MISMATCH",
      },
    });
    const expectedScan = input.description.scans[scanIndex];
    if (
      expectedScan === undefined ||
      member.scan.scanIndex !== scanIndex ||
      member.invocationSha256 !==
        computeFoundryE57ScanShardedReductionInvocationSha256(
          input.invocation,
        ) ||
      member.inputCompatibilitySha256 !==
        input.invocation.checkpointContract.inputCompatibilitySha256 ||
      member.readerDescriptionSha256 !==
        input.description.readerDescriptionSha256 ||
      !sameCanonical(member.source, input.invocation.source) ||
      !sameCanonical(member.scan, expectedScan) ||
      !sameCanonical(member.crop, input.invocation.crop) ||
      !sameCanonical(member.voxelPolicy, input.invocation.voxelPolicy) ||
      member.counts.source !== expectedScan.pointCount ||
      member.counts.processed !== expectedScan.pointCount ||
      member.counts.representatives >
        input.invocation.limits.maximumRepresentativesPerScan
    ) {
      fail(
        "E57_SCAN_REDUCTION_MEMBER_BINDING_MISMATCH",
        "A committed scan member does not bind its exact invocation, reader, source, scan, crop, voxel policy, scan point count, and per-scan cap.",
      );
    }
    totalRepresentatives += member.counts.representatives;
    if (
      totalRepresentatives >
      input.invocation.limits.maximumTotalRepresentatives
    ) {
      fail(
        "E57_SCAN_REDUCTION_AGGREGATE_LIMIT_EXCEEDED",
        "Committed members exceed the exact aggregate representative cap.",
      );
    }
    entries.push({
      scanIndex,
      data3dGuid: member.scan.data3dGuid,
      memberSha256: member.memberSha256,
      sizeBytes: bytes.byteLength,
      completion: member.completion,
      representativeCount: member.counts.representatives,
    });
  }
  return { entries };
}

async function commitMember(input: {
  readonly store: FoundryE57ScanReductionMemberStore;
  readonly member: FoundryE57ScanReductionMemberV0;
}): Promise<z.infer<typeof CheckpointEntrySchema>> {
  const bytes = canonicalBytes(input.member);
  if (bytes.length > FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_MEMBER_BYTES) {
    fail(
      "E57_SCAN_REDUCTION_MEMBER_LIMIT_EXCEEDED",
      "A scan-reduction member exceeds its fixed persisted byte bound.",
    );
  }
  const before = await input.store.readCommittedScanMember(
    input.member.scan.scanIndex,
  );
  if (before !== null) {
    fail(
      "E57_SCAN_REDUCTION_STORE_OVERWRITE_FORBIDDEN",
      "The coordinator refuses to rewrite an existing scan-member slot.",
    );
  }
  const result = await input.store.createCommittedScanMember({
    scanIndex: input.member.scan.scanIndex,
    canonicalBytes: bytes,
    memberSha256: input.member.memberSha256,
  });
  if (result !== "created") {
    fail(
      "E57_SCAN_REDUCTION_STORE_OVERWRITE_RACE",
      "A scan-member slot appeared after the coordinator proved it absent.",
    );
  }
  const reread = await input.store.readCommittedScanMember(
    input.member.scan.scanIndex,
  );
  if (
    reread === null ||
    !Buffer.from(reread).equals(bytes) ||
    bytesSha256(reread) !== bytesSha256(bytes)
  ) {
    fail(
      "E57_SCAN_REDUCTION_STORE_REREAD_MISMATCH",
      "A create-only scan member did not survive exact digest and byte re-read.",
    );
  }
  return CheckpointEntrySchema.parse({
    scanIndex: input.member.scan.scanIndex,
    data3dGuid: input.member.scan.data3dGuid,
    memberSha256: input.member.memberSha256,
    sizeBytes: bytes.length,
    completion: input.member.completion,
    representativeCount: input.member.counts.representatives,
  });
}

function sealCheckpoint(input: {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly description: FoundryE57ScanShardedReaderDescriptionV0;
  readonly entries: readonly z.infer<typeof CheckpointEntrySchema>[];
}): FoundryE57ScanReductionCheckpointV0 {
  const complete = input.entries.length === input.description.scans.length;
  const material = CheckpointMaterialSchema.parse({
    schemaVersion: FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_V0,
    invocationSha256:
      computeFoundryE57ScanShardedReductionInvocationSha256(input.invocation),
    inputCompatibilitySha256:
      input.invocation.checkpointContract.inputCompatibilitySha256,
    readerDescriptionSha256: input.description.readerDescriptionSha256,
    completedMembers: input.entries,
    nextScanIndex: complete ? null : input.entries.length,
    totalRepresentativeCount: input.entries.reduce(
      (sum, entry) => sum + entry.representativeCount,
      0,
    ),
    complete,
    storeCustody: "caller_supplied_unverified",
    executorAuthentication: "not_established",
    fenceOwnership: "not_established",
    authority: "none",
    activation: false,
  });
  return FoundryE57ScanReductionCheckpointV0Schema.parse({
    ...material,
    checkpointSha256: checkpointSha256(material),
  });
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true &&
    error instanceof FoundryIntegrityError &&
    [
      "E57_GEOMETRY_CANCELLED",
      "E57_SCAN_REDUCTION_CANCELLED",
      "E57_PYE57_STREAM_SESSION_CLOSED",
    ].includes(error.code)
  );
}

/**
 * Runs a local authority-none scan reduction against an injected create-only
 * store. The store contract is verified by exact re-read but is not an
 * authenticated executor, fence, or custody boundary.
 */
export async function runFoundryE57ScanShardedReduction(
  options: RunFoundryE57ScanShardedReductionOptions,
): Promise<FoundryE57ScanShardedReductionResult> {
  const invocation = FoundryE57ScanShardedReductionInvocationV0Schema.parse(
    options.invocation,
  );
  let description = await loadStoredDescription(
    options.store,
    invocation.limits.maximumScans,
  );
  const indicesBeforeDescription = await loadCommittedScanIndices({
    store: options.store,
    maximumScans:
      description?.scans.length ?? invocation.limits.maximumScans,
  });
  if (description === null && indicesBeforeDescription.length > 0) {
    fail(
      "E57_SCAN_REDUCTION_DESCRIPTION_MISSING",
      "Committed scan members cannot exist without their exact reader description.",
    );
  }
  if (description !== null) {
    assertDescriptionBinding({ invocation, description });
  }
  let entries: z.infer<typeof CheckpointEntrySchema>[] = [];
  if (description !== null) {
    entries = [
      ...(await loadStoredMembers({
        invocation,
        description,
        store: options.store,
      })).entries,
    ];
    if (entries.length === description.scans.length) {
      const checkpoint = sealCheckpoint({ invocation, description, entries });
      if (checkpoint.totalRepresentativeCount === 0) {
        fail(
          "E57_SCAN_REDUCTION_ALL_SCANS_EMPTY",
          "Every completed scan member is explicitly empty; no reduction candidate can be assembled.",
        );
      }
      return { status: "succeeded", checkpoint };
    }
  }
  const startScanIndex = entries.length;
  try {
    const rawDescription = await options.reader.describe({
      invocation,
      startScanIndex,
      completedRepresentativeCount: entries.reduce(
        (sum, entry) => sum + entry.representativeCount,
        0,
      ),
      signal: options.signal,
    });
    const guardedDescription = snapshotWithBoundedArrayProperty({
      value: rawDescription,
      arrayProperty: "scans",
      maximumArrayLength: invocation.limits.maximumScans,
      nestedMaximumArrayLength: 256,
      label: "Reader-supplied scan-reduction description",
      code: "E57_SCAN_REDUCTION_DESCRIPTION_PRECHECK_FAILED",
    });
    const observedDescription = parseGuardedReaderValue({
      value: guardedDescription,
      schema: FoundryE57ScanShardedReaderDescriptionV0Schema,
      code: "E57_SCAN_REDUCTION_DESCRIPTION_INVALID",
      label: "Reader-supplied scan-reduction description",
    });
    assertDescriptionBinding({
      invocation,
      description: observedDescription,
    });
    if (
      description !== null &&
      !sameCanonical(description, observedDescription)
    ) {
      fail(
        "E57_SCAN_REDUCTION_DESCRIPTION_DRIFT",
        "A resumed bridge description differs from the exact persisted reader description.",
      );
    }
    if (description === null) {
      await commitDescription({
        store: options.store,
        description: observedDescription,
      });
      description = observedDescription;
    }
    for (
      let scanIndex = startScanIndex;
      scanIndex < description.scans.length;
      scanIndex += 1
    ) {
      if (options.signal?.aborted === true) {
        const checkpoint = sealCheckpoint({ invocation, description, entries });
        return { status: "cancelled", checkpoint };
      }
      const rawCandidate = await options.reader.reduceNextScan({
        scanIndex,
        signal: options.signal,
      });
      const guardedRawScan = snapshotWithBoundedArrayProperty({
        value: rawCandidate,
        arrayProperty: "points",
        maximumArrayLength:
          invocation.limits.maximumRepresentativesPerScan,
        nestedMaximumArrayLength: 7,
        label: `Reader-supplied reduced scan ${String(scanIndex)}`,
        code: "E57_SCAN_REDUCTION_SCAN_PRECHECK_FAILED",
      });
      if (
        typeof guardedRawScan !== "object" ||
        guardedRawScan === null ||
        !("scanIndex" in guardedRawScan) ||
        guardedRawScan.scanIndex !== scanIndex
      ) {
        fail(
          "E57_SCAN_REDUCTION_REQUESTED_SCAN_MISMATCH",
          "The reader returned a scan other than the exact requested next scan; no member was committed.",
        );
      }
      const raw = parseGuardedReaderValue({
        value: guardedRawScan,
        schema: FoundryE57RawReducedScanV0Schema,
        code: "E57_SCAN_REDUCTION_SCAN_INVALID",
        label: `Reader-supplied reduced scan ${String(scanIndex)}`,
      });
      const terminalExpected = scanIndex === description.scans.length - 1;
      if (
        terminalExpected !== (raw.terminalSourceAfter !== null) ||
        (raw.terminalSourceAfter !== null &&
          (raw.terminalSourceAfter.sizeBytes !== invocation.source.sizeBytes ||
            raw.terminalSourceAfter.sha256 !== invocation.source.sha256))
      ) {
        fail(
          "E57_SCAN_REDUCTION_TERMINAL_IDENTITY_MISMATCH",
          "The final reduced scan does not bind the exact clean-terminal source identity.",
        );
      }
      const member = sealMember({ invocation, description, raw });
      const aggregate =
        entries.reduce(
          (sum, entry) => sum + entry.representativeCount,
          0,
        ) + member.counts.representatives;
      if (aggregate > invocation.limits.maximumTotalRepresentatives) {
        fail(
          "E57_SCAN_REDUCTION_AGGREGATE_LIMIT_EXCEEDED",
          "Reduced scan output exceeds the exact aggregate representative cap.",
        );
      }
      entries.push(await commitMember({ store: options.store, member }));
      await options.onMemberCommitted?.(member);
    }
    const checkpoint = sealCheckpoint({ invocation, description, entries });
    if (checkpoint.totalRepresentativeCount === 0) {
      fail(
        "E57_SCAN_REDUCTION_ALL_SCANS_EMPTY",
        "Every completed scan member is explicitly empty; no reduction candidate can be assembled.",
      );
    }
    return { status: "succeeded", checkpoint };
  } catch (error: unknown) {
    if (description !== null && isCancellation(error, options.signal)) {
      return {
        status: "cancelled",
        checkpoint: sealCheckpoint({ invocation, description, entries }),
      };
    }
    throw error;
  } finally {
    await options.reader.close?.();
  }
}
