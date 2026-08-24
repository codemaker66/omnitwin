import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import type { FoundryCheckpointContractV0 } from "./execution-control.js";

export const FOUNDRY_E57_GEOMETRY_INVOCATION_V0 =
  "omnitwin.foundry.e57-geometry-invocation.v0";
export const FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0 =
  "omnitwin.foundry.e57-geometry-reader-description.v0";
export const FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0 =
  "omnitwin.foundry.e57-geometry-checkpoint.v0";
export const FOUNDRY_E57_GEOMETRY_CROP_V0 =
  "omnitwin.foundry.e57-geometry-crop.v0";
export const FOUNDRY_E57_GEOMETRY_OPERATION = "normalize_point_cloud";
export const FOUNDRY_E57_GEOMETRY_OPERATION_VERSION = "e57-crop-v0";
export const FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT =
  "venviewer-e57-geometry-crop";
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS = 1_000_000;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS = 250_000;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS = 65_536;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS = 64;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_READER_BATCHES = 79;
export const FOUNDRY_E57_GEOMETRY_MAXIMUM_POINT_VISITS = 9_000_000;

export type FoundryE57GeometryCheckpointContractV0 =
  FoundryCheckpointContractV0 & {
    readonly format: typeof FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT;
    readonly formatVersion: "v0";
    readonly stageId: typeof FOUNDRY_E57_GEOMETRY_OPERATION;
  };

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/u;
const INVOCATION_DOMAIN = "VENVIEWER_FOUNDRY_E57_GEOMETRY_INVOCATION_V0";
const INPUT_COMPATIBILITY_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_GEOMETRY_INPUT_COMPATIBILITY_V0";
const READER_DESCRIPTION_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0";
const CHECKPOINT_DOMAIN = "VENVIEWER_FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0";
const ARTIFACT_DOMAIN = "VENVIEWER_FOUNDRY_E57_GEOMETRY_CROP_V0";

const LIMITATIONS = [
  "This V0 worker emits a bounded authority-none JSON point crop, not a mesh, collision surface, placement surface, measurement authority, export authority, or production runtime member.",
  "The worker accepts only Cartesian E57 data3D points with explicit scan poses; spherical-only scans and pose-free scans fail closed.",
  "This V0 contract is capped at a 256 MiB container, 1,000,000 total points, 64 scans, 79 fixed-size reader batches, and 9,000,000 scan-prefix point visits per run. The accepted pye57/libE57Format 0.4.19 binding exposes seek but returned ErrorNotImplemented on the tiny fixture. The legacy command adapter replays a scan prefix per batch; the persistent adapter avoids that replay only within one uninterrupted run, while every resumed run still replays its complete checkpoint prefix. Neither adapter proves a Grand Hall-scale path.",
  "The E57 root frame is reported in metres with right-handed Z-up axes according to the declared V0 adapter contract; no external CRS, CVF alignment, registration accuracy, or survey accuracy is established.",
  "Captured movable furniture and people are not detected or removed by this worker; all retained points remain unclassified captured content and are expressly excluded from placement, measurement, collision, and export authority.",
  "The source-facts digest is an exact invocation binding only; this worker does not authenticate or re-derive source facts or enforce the existing capture-stage guard, parent reparse checks, private output custody, JobSpec, or execution fence.",
  "When selected, pye57 and the Python launch accept filesystem paths rather than retained file handles. Full-file source hashes before and after reading plus pre-run bridge/interpreter hashes detect ordinary drift but do not close an adversarial swap-and-restore race, so production activation requires executor-held custody and sandboxing.",
  "Checkpoint and artifact digests prove deterministic local self-consistency only. Every supplied resume checkpoint is reconstructed by replaying its bounded source prefix and must equal that reconstruction before use; neither digest authenticates an operator, execution fence, worker image, rights decision, review, signing, activation, publication, or release eligibility.",
  "When selected, the included local pye57 bridge hashes every container byte, including bytes that may belong to embedded image blobs. The legacy adapter hashes before and after each command; the persistent adapter hashes before opening and after closing one uninterrupted stream session. Neither mode invokes an image decoder or extracts images, opens network sockets, or runs inference or training; caller-supplied filesystem roots must still be local and trusted.",
  "The path-based local adapter assumes trusted local source, bridge, and interpreter roots. Its caller-supplied identities, pre/post path hashes, safe-path Python flags, and sanitized environment do not close swap-and-restore races or authenticate the Python/native dependency environment, so its result cannot serve as production activation evidence.",
  "Production closure requires executor-held canonical private staging with no reparse or remote ancestors, an authenticated interpreter and dependency allowlist, an execution permit/fence, and sandboxed resource enforcement; this authority-none V0 seam supplies none of those controls.",
] as const;

const Vector3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const QuaternionSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

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
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_SOURCE_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const CropSchema = z
  .object({
    frame: z.literal("e57_root"),
    units: z.literal("metre"),
    minimum: Vector3Schema,
    maximum: Vector3Schema,
    boundary: z.literal("inclusive"),
  })
  .strict()
  .superRefine((crop, ctx) => {
    const components = [
      [0, crop.minimum[0], crop.maximum[0]],
      [1, crop.minimum[1], crop.maximum[1]],
      [2, crop.minimum[2], crop.maximum[2]],
    ] as const;
    for (const [component, minimum, maximum] of components) {
      if (minimum > maximum) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", component],
          message: "crop minimum cannot exceed crop maximum",
        });
      }
    }
  });

const CheckpointContractSchema = z
  .object({
    format: z.literal(FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT),
    formatVersion: z.literal("v0"),
    stageId: z.literal(FOUNDRY_E57_GEOMETRY_OPERATION),
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
    crop: CropSchema,
    limits: z
      .object({
        maximumInputPoints: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS),
        maximumOutputPoints: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS),
        maximumBatchPoints: z.literal(
          FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
        ),
        maximumScans: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS),
      })
      .strict(),
    coordinateContract: z
      .object({
        inputPointFrame: z.literal("e57_data3d_local_cartesian"),
        scanPoseConvention: z.literal(
          "normalized_quaternion_wxyz_then_translation_metres",
        ),
        outputFrame: z.literal("e57_root"),
        units: z.literal("metre"),
        axes: z.literal("right_handed_z_up"),
      })
      .strict(),
    contentPolicy: z
      .object({
        capturedMovableContent: z.literal("unclassified_possible_and_retained"),
        semanticMasking: z.literal("not_performed"),
        placementAuthority: z.literal("excluded"),
        measurementAuthority: z.literal("excluded"),
        collisionAuthority: z.literal("excluded"),
        exportAuthority: z.literal("excluded"),
      })
      .strict(),
  })
  .strict();

export const FoundryE57GeometryInvocationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_GEOMETRY_INVOCATION_V0),
    operation: z.literal(FOUNDRY_E57_GEOMETRY_OPERATION),
    operationVersion: z.literal(FOUNDRY_E57_GEOMETRY_OPERATION_VERSION),
    executionMode: z.literal("local_dependency_injected_authority_none"),
    source: SourceBindingSchema,
    sourceFactsArtifactSha256: z.string().regex(SHA256),
    crop: CropSchema,
    limits: InputCompatibilityMaterialSchema.shape.limits,
    coordinateContract:
      InputCompatibilityMaterialSchema.shape.coordinateContract,
    contentPolicy: InputCompatibilityMaterialSchema.shape.contentPolicy,
    checkpointContract: CheckpointContractSchema,
    networkAccess: z.literal("none"),
    imageDecoderAccess: z.literal("none"),
    imageExtraction: z.literal("none"),
    modelInference: z.literal("none"),
    modelTraining: z.literal("none"),
    authority: z.literal("none"),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    if (
      invocation.limits.maximumOutputPoints >
      invocation.limits.maximumInputPoints
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limits", "maximumOutputPoints"],
        message: "maximum output points cannot exceed maximum input points",
      });
    }
    const expected = computeInputCompatibilitySha256({
      source: invocation.source,
      sourceFactsArtifactSha256: invocation.sourceFactsArtifactSha256,
      crop: invocation.crop,
      limits: invocation.limits,
      coordinateContract: invocation.coordinateContract,
      contentPolicy: invocation.contentPolicy,
    });
    if (invocation.checkpointContract.inputCompatibilitySha256 !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpointContract", "inputCompatibilitySha256"],
        message:
          "checkpoint input compatibility digest does not bind this exact E57 source, crop, limits, frame, and content policy",
      });
    }
  });

export type FoundryE57GeometryInvocationV0 = z.infer<
  typeof FoundryE57GeometryInvocationV0Schema
>;

export const FoundryE57GeometryScanDescriptionV0Schema = z
  .object({
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    pointCount: z.number().int().safe().positive(),
    pointFields: z.array(z.string().min(1).max(256)).min(3).max(256),
    pose: z
      .object({
        rotationWxyz: QuaternionSchema,
        translationM: Vector3Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((scan, ctx) => {
    const required = ["cartesianX", "cartesianY", "cartesianZ"];
    if (required.some((field) => !scan.pointFields.includes(field))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointFields"],
        message: "scan must expose Cartesian X, Y, and Z fields",
      });
    }
    const sorted = [...scan.pointFields].sort();
    if (
      new Set(scan.pointFields).size !== scan.pointFields.length ||
      scan.pointFields.some((field, index) => field !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointFields"],
        message: "point fields must be unique and sorted",
      });
    }
    const norm = Math.hypot(...scan.pose.rotationWxyz);
    if (Math.abs(norm - 1) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pose", "rotationWxyz"],
        message: "scan pose quaternion must be normalized within 1e-6",
      });
    }
  });

const ReaderDescriptionMaterialSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0),
    source: SourceBindingSchema,
    adapter: z
      .object({
        name: z.string().regex(SAFE_ID),
        version: z.string().regex(SAFE_VERSION),
        bridgeArtifactSha256: z.string().regex(SHA256),
        pythonVersion: z.string().min(1).max(160).nullable(),
        numpyVersion: z.string().min(1).max(160).nullable(),
        pythonExecutableSha256: z.string().regex(SHA256).optional(),
        pythonExecutableSizeBytes: z.number().int().safe().positive().optional(),
        identityAuthority: z.literal("caller_supplied_unverified"),
      })
      .strict(),
    readPolicy: z
      .object({
        sourceAccess: z.enum([
          "dependency_injected_caller_asserted_identity",
          "read_only_pre_and_post_size_sha256",
        ]),
        batchAccess: z.enum([
          "dependency_injected",
          "persistent_sequential_bounded_buffer",
          "scan_start_replay_bounded_buffer",
        ]),
        pointPayload: z.literal("cartesian_fields_only"),
        fullContainerBytesHashed: z.boolean(),
        imageDecoderAccess: z.literal(false),
        imageExtraction: z.literal(false),
        network: z.literal("none"),
        modelInference: z.literal("none"),
        modelTraining: z.literal("none"),
      })
      .strict(),
    coordinateContract: z
      .object({
        pointFrame: z.literal("e57_data3d_local_cartesian"),
        poseConvention: z.literal(
          "normalized_quaternion_wxyz_then_translation_metres",
        ),
        rootFrame: z.literal("e57_root"),
        units: z.literal("metre"),
        axes: z.literal("right_handed_z_up"),
      })
      .strict(),
    scans: z
      .array(FoundryE57GeometryScanDescriptionV0Schema)
      .min(1)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS),
    totalPointCount: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryE57GeometryReaderDescriptionV0Schema =
  ReaderDescriptionMaterialSchema.extend({
    descriptionSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((description, ctx) => {
      const { descriptionSha256: _descriptionSha256, ...material } =
        description;
      if (descriptionSha256(material) !== description.descriptionSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["descriptionSha256"],
          message:
            "reader description digest does not match its canonical payload",
        });
      }
      if (description.scans.some((scan, index) => scan.scanIndex !== index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scans"],
          message: "scan indices must be contiguous and sorted from zero",
        });
      }
      if (
        new Set(description.scans.map((scan) => scan.data3dGuid)).size !==
        description.scans.length
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scans"],
          message: "data3D GUIDs must be unique",
        });
      }
      if (
        description.scans.reduce(
          (total, scan) => total + scan.pointCount,
          0,
        ) !== description.totalPointCount
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalPointCount"],
          message: "total point count must equal the scan point counts",
        });
      }
      const expectedFullContainerHashing =
        description.readPolicy.sourceAccess ===
        "read_only_pre_and_post_size_sha256";
      if (
        description.readPolicy.fullContainerBytesHashed !==
        expectedFullContainerHashing
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["readPolicy", "fullContainerBytesHashed"],
          message:
            "full-container hashing truth must match the declared source-access mode",
        });
      }
    });

export type FoundryE57GeometryReaderDescriptionV0 = z.infer<
  typeof FoundryE57GeometryReaderDescriptionV0Schema
>;

const ReaderPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    cartesianInvalidState: z.number().int().min(0).max(2),
  })
  .strict();

const ReaderBatchSchema = z
  .object({
    sourceSha256: z.string().regex(SHA256),
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    startPointIndex: z.number().int().safe().nonnegative(),
    points: z
      .array(ReaderPointSchema)
      .min(1)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS),
  })
  .strict();

export interface FoundryE57GeometryReader {
  describe(input: {
    readonly source: FoundryE57GeometryInvocationV0["source"];
    readonly maximumInputPoints: number;
    readonly maximumScans: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  readBatch(input: {
    readonly source: FoundryE57GeometryInvocationV0["source"];
    readonly scanIndex: number;
    readonly startPointIndex: number;
    readonly maximumPoints: number;
    readonly maximumInputPoints: number;
    readonly maximumScans: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  close?(): Promise<void>;
}

const CursorSchema = z
  .object({
    scanIndex: z.number().int().nonnegative(),
    pointIndex: z.number().int().safe().nonnegative(),
  })
  .strict();

const OutputPointSchema = z
  .object({
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    sourcePointIndex: z.number().int().safe().nonnegative(),
    xM: z.number().finite(),
    yM: z.number().finite(),
    zM: z.number().finite(),
  })
  .strict();

const BoundsSchema = z
  .object({ minimum: Vector3Schema, maximum: Vector3Schema })
  .strict();

const CheckpointMaterialSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0),
    invocationSha256: z.string().regex(SHA256),
    checkpointContract: CheckpointContractSchema,
    readerDescription: FoundryE57GeometryReaderDescriptionV0Schema,
    cursor: CursorSchema.nullable(),
    committedBatchCount: z.number().int().safe().nonnegative(),
    processedPointCount: z.number().int().safe().nonnegative(),
    invalidPointCount: z.number().int().safe().nonnegative(),
    croppedOutPointCount: z.number().int().safe().nonnegative(),
    acceptedPointCount: z.number().int().safe().nonnegative(),
    acceptedPoints: z
      .array(OutputPointSchema)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS),
    outputBoundsM: BoundsSchema.nullable(),
    complete: z.boolean(),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryE57GeometryCheckpointV0Schema =
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
          message: "checkpoint digest does not match its canonical payload",
        });
      }
      if (
        checkpoint.processedPointCount !==
          checkpoint.invalidPointCount +
            checkpoint.croppedOutPointCount +
            checkpoint.acceptedPointCount ||
        checkpoint.acceptedPointCount !== checkpoint.acceptedPoints.length
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["processedPointCount"],
          message: "checkpoint point counters do not balance",
        });
      }
      if (checkpoint.complete !== (checkpoint.cursor === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["complete"],
          message: "only a complete checkpoint may have a null cursor",
        });
      }
      const expectedBounds = boundsForPoints(checkpoint.acceptedPoints);
      if (!sameCanonical(expectedBounds, checkpoint.outputBoundsM)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outputBoundsM"],
          message: "checkpoint bounds do not match accepted points",
        });
      }
      const scanStartPointIndices: number[] = [];
      let nextScanStart = 0;
      for (const scan of checkpoint.readerDescription.scans) {
        scanStartPointIndices.push(nextScanStart);
        nextScanStart += scan.pointCount;
      }
      let previousSourceOrdinal = -1;
      for (const point of checkpoint.acceptedPoints) {
        const scan = checkpoint.readerDescription.scans[point.scanIndex];
        const scanStartPointIndex = scanStartPointIndices[point.scanIndex];
        const sourceOrdinal =
          scanStartPointIndex === undefined
            ? Number.MAX_SAFE_INTEGER
            : scanStartPointIndex + point.sourcePointIndex;
        if (
          scan === undefined ||
          point.data3dGuid !== scan.data3dGuid ||
          point.sourcePointIndex >= scan.pointCount ||
          sourceOrdinal >= checkpoint.processedPointCount ||
          sourceOrdinal <= previousSourceOrdinal
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["acceptedPoints"],
            message:
              "checkpoint points must be unique source-ordered members of the processed scan prefix",
          });
          break;
        }
        previousSourceOrdinal = sourceOrdinal;
      }
    });

export type FoundryE57GeometryCheckpointV0 = z.infer<
  typeof FoundryE57GeometryCheckpointV0Schema
>;

const ArtifactMaterialSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_GEOMETRY_CROP_V0),
    invocationSha256: z.string().regex(SHA256),
    finalCheckpointSha256: z.string().regex(SHA256),
    source: SourceBindingSchema,
    sourceFactsArtifactSha256: z.string().regex(SHA256),
    readerDescription: FoundryE57GeometryReaderDescriptionV0Schema,
    coordinateContract:
      InputCompatibilityMaterialSchema.shape.coordinateContract,
    crop: CropSchema,
    pointCounts: z
      .object({
        source: z.number().int().safe().positive(),
        processed: z.number().int().safe().positive(),
        invalid: z.number().int().safe().nonnegative(),
        croppedOut: z.number().int().safe().nonnegative(),
        accepted: z.number().int().safe().nonnegative(),
      })
      .strict(),
    points: z
      .array(OutputPointSchema)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS),
    outputBoundsM: BoundsSchema.nullable(),
    invalidPointDisposition: z.literal(
      "cartesianInvalidState_nonzero_excluded",
    ),
    movableContent: z
      .object({
        classification: z.literal("not_performed"),
        retainedContent: z.literal("may_include_captured_movable_objects"),
        geometryAuthority: z.literal("none"),
        placementAuthority: z.literal("excluded"),
        measurementAuthority: z.literal("excluded"),
        collisionAuthority: z.literal("excluded"),
        exportAuthority: z.literal("excluded"),
      })
      .strict(),
    capabilities: z
      .object({
        runtimeRegistration: z.literal("not_authorized"),
        immutableRegistration: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        activation: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
    limitations: z.tuple(
      LIMITATIONS.map((value) => z.literal(value)) as [
        z.ZodLiteral<(typeof LIMITATIONS)[0]>,
        z.ZodLiteral<(typeof LIMITATIONS)[1]>,
        z.ZodLiteral<(typeof LIMITATIONS)[2]>,
        z.ZodLiteral<(typeof LIMITATIONS)[3]>,
        z.ZodLiteral<(typeof LIMITATIONS)[4]>,
        z.ZodLiteral<(typeof LIMITATIONS)[5]>,
        z.ZodLiteral<(typeof LIMITATIONS)[6]>,
        z.ZodLiteral<(typeof LIMITATIONS)[7]>,
        z.ZodLiteral<(typeof LIMITATIONS)[8]>,
        z.ZodLiteral<(typeof LIMITATIONS)[9]>,
        z.ZodLiteral<(typeof LIMITATIONS)[10]>,
      ],
    ),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryE57GeometryCropArtifactV0Schema =
  ArtifactMaterialSchema.extend({
    artifactSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((artifact, ctx) => {
      const { artifactSha256: _artifactSha256, ...material } = artifact;
      if (artifactSha256(material) !== artifact.artifactSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactSha256"],
          message: "artifact digest does not match its canonical payload",
        });
      }
      if (
        artifact.pointCounts.source !== artifact.pointCounts.processed ||
        artifact.pointCounts.processed !==
          artifact.pointCounts.invalid +
            artifact.pointCounts.croppedOut +
            artifact.pointCounts.accepted ||
        artifact.pointCounts.accepted !== artifact.points.length ||
        artifact.pointCounts.source !==
          artifact.readerDescription.totalPointCount ||
        !sameCanonical(boundsForPoints(artifact.points), artifact.outputBoundsM)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pointCounts"],
          message: "artifact point counts or bounds are inconsistent",
        });
      }
      const scanStartPointIndices: number[] = [];
      let nextScanStart = 0;
      for (const scan of artifact.readerDescription.scans) {
        scanStartPointIndices.push(nextScanStart);
        nextScanStart += scan.pointCount;
      }
      let previousSourceOrdinal = -1;
      for (const point of artifact.points) {
        const scan = artifact.readerDescription.scans[point.scanIndex];
        const scanStartPointIndex = scanStartPointIndices[point.scanIndex];
        const sourceOrdinal =
          scanStartPointIndex === undefined
            ? Number.MAX_SAFE_INTEGER
            : scanStartPointIndex + point.sourcePointIndex;
        if (
          scan === undefined ||
          point.data3dGuid !== scan.data3dGuid ||
          point.sourcePointIndex >= scan.pointCount ||
          sourceOrdinal <= previousSourceOrdinal ||
          !withinCrop([point.xM, point.yM, point.zM], artifact.crop)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["points"],
            message:
              "artifact points must be unique source-ordered members of their exact scans and inclusive crop",
          });
          break;
        }
        previousSourceOrdinal = sourceOrdinal;
      }
    });

export type FoundryE57GeometryCropArtifactV0 = z.infer<
  typeof FoundryE57GeometryCropArtifactV0Schema
>;

export type FoundryE57GeometryWorkerResult =
  | {
      readonly status: "succeeded";
      readonly checkpoint: FoundryE57GeometryCheckpointV0;
      readonly artifact: FoundryE57GeometryCropArtifactV0;
    }
  | {
      readonly status: "paused" | "cancelled";
      readonly checkpoint: FoundryE57GeometryCheckpointV0;
    };

export interface RunFoundryE57GeometryWorkerOptions {
  readonly invocation: FoundryE57GeometryInvocationV0;
  readonly reader: FoundryE57GeometryReader;
  readonly checkpoint?: FoundryE57GeometryCheckpointV0;
  readonly signal?: AbortSignal;
  readonly maximumBatchesThisRun?: number;
  readonly onCheckpoint?: (
    checkpoint: FoundryE57GeometryCheckpointV0,
  ) => void | Promise<void>;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right))
  );
}

function computeInputCompatibilitySha256(
  input: z.input<typeof InputCompatibilityMaterialSchema>,
): string {
  return digest(
    INPUT_COMPATIBILITY_DOMAIN,
    InputCompatibilityMaterialSchema.parse(input),
  );
}

export function computeFoundryE57GeometryInputCompatibilitySha256(
  input: z.input<typeof InputCompatibilityMaterialSchema>,
): string {
  return computeInputCompatibilitySha256(input);
}

export function computeFoundryE57GeometryInvocationSha256(
  input: unknown,
): string {
  return digest(
    INVOCATION_DOMAIN,
    FoundryE57GeometryInvocationV0Schema.parse(input),
  );
}

function descriptionSha256(
  input: z.input<typeof ReaderDescriptionMaterialSchema>,
): string {
  return digest(
    READER_DESCRIPTION_DOMAIN,
    ReaderDescriptionMaterialSchema.parse(input),
  );
}

export function sealFoundryE57GeometryReaderDescriptionV0(
  input: z.input<typeof ReaderDescriptionMaterialSchema>,
): FoundryE57GeometryReaderDescriptionV0 {
  const material = ReaderDescriptionMaterialSchema.parse(input);
  return FoundryE57GeometryReaderDescriptionV0Schema.parse({
    ...material,
    descriptionSha256: descriptionSha256(material),
  });
}

function checkpointSha256(
  input: z.input<typeof CheckpointMaterialSchema>,
): string {
  return digest(CHECKPOINT_DOMAIN, CheckpointMaterialSchema.parse(input));
}

function sealCheckpoint(
  input: z.input<typeof CheckpointMaterialSchema>,
): FoundryE57GeometryCheckpointV0 {
  const material = CheckpointMaterialSchema.parse(input);
  return FoundryE57GeometryCheckpointV0Schema.parse({
    ...material,
    checkpointSha256: checkpointSha256(material),
  });
}

function artifactSha256(input: z.input<typeof ArtifactMaterialSchema>): string {
  return digest(ARTIFACT_DOMAIN, ArtifactMaterialSchema.parse(input));
}

function cleanNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function boundsForPoints(
  points: readonly z.infer<typeof OutputPointSchema>[],
): z.infer<typeof BoundsSchema> | null {
  if (points.length === 0) return null;
  const first = points[0];
  if (first === undefined) return null;
  const minimum = [first.xM, first.yM, first.zM];
  const maximum = [...minimum];
  for (const point of points.slice(1)) {
    const value = [point.xM, point.yM, point.zM];
    for (let component = 0; component < 3; component += 1) {
      minimum[component] = Math.min(
        minimum[component] ?? value[component] ?? 0,
        value[component] ?? 0,
      );
      maximum[component] = Math.max(
        maximum[component] ?? value[component] ?? 0,
        value[component] ?? 0,
      );
    }
  }
  return BoundsSchema.parse({ minimum, maximum });
}

function quaternionRotate(
  point: readonly [number, number, number],
  quaternion: readonly [number, number, number, number],
): [number, number, number] {
  const [w, qx, qy, qz] = quaternion;
  const [x, y, z] = point;
  const ux = qy * z - qz * y;
  const uy = qz * x - qx * z;
  const uz = qx * y - qy * x;
  const vx = qy * uz - qz * uy;
  const vy = qz * ux - qx * uz;
  const vz = qx * uy - qy * ux;
  return [
    cleanNumber(x + 2 * (w * ux + vx)),
    cleanNumber(y + 2 * (w * uy + vy)),
    cleanNumber(z + 2 * (w * uz + vz)),
  ];
}

function normalizeQuaternion(
  quaternion: readonly [number, number, number, number],
): [number, number, number, number] {
  const norm = Math.hypot(...quaternion);
  if (!Number.isFinite(norm) || norm === 0) {
    fail(
      "E57_GEOMETRY_SCAN_POSE_INVALID",
      "An E57 scan pose quaternion cannot be normalized.",
    );
  }
  return quaternion.map((component) => cleanNumber(component / norm)) as [
    number,
    number,
    number,
    number,
  ];
}

function transformPoint(
  point: z.infer<typeof ReaderPointSchema>,
  scan: z.infer<typeof FoundryE57GeometryScanDescriptionV0Schema>,
): [number, number, number] {
  const rotated = quaternionRotate(
    [point.x, point.y, point.z],
    normalizeQuaternion(scan.pose.rotationWxyz),
  );
  return [
    cleanNumber(rotated[0] + scan.pose.translationM[0]),
    cleanNumber(rotated[1] + scan.pose.translationM[1]),
    cleanNumber(rotated[2] + scan.pose.translationM[2]),
  ];
}

function withinCrop(
  point: readonly [number, number, number],
  crop: z.infer<typeof CropSchema>,
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

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function cursorProcessedPointCount(
  cursor: z.infer<typeof CursorSchema> | null,
  description: FoundryE57GeometryReaderDescriptionV0,
): number {
  if (cursor === null) return description.totalPointCount;
  const scan = description.scans[cursor.scanIndex];
  if (scan === undefined || cursor.pointIndex >= scan.pointCount) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_CURSOR_INVALID",
      "Checkpoint cursor is outside the exact reader scan inventory.",
    );
  }
  return (
    description.scans
      .slice(0, cursor.scanIndex)
      .reduce((total, item) => total + item.pointCount, 0) + cursor.pointIndex
  );
}

function nextCursor(
  scan: z.infer<typeof FoundryE57GeometryScanDescriptionV0Schema>,
  endPointIndex: number,
  description: FoundryE57GeometryReaderDescriptionV0,
): z.infer<typeof CursorSchema> | null {
  if (endPointIndex < scan.pointCount) {
    return { scanIndex: scan.scanIndex, pointIndex: endPointIndex };
  }
  if (endPointIndex !== scan.pointCount) {
    fail(
      "E57_GEOMETRY_READER_BATCH_OVERFLOW",
      "Reader batch extends beyond the declared scan point count.",
    );
  }
  const nextScan = description.scans[scan.scanIndex + 1];
  return nextScan === undefined
    ? null
    : { scanIndex: nextScan.scanIndex, pointIndex: 0 };
}

function assertDescriptionMatchesInvocation(
  description: FoundryE57GeometryReaderDescriptionV0,
  invocation: FoundryE57GeometryInvocationV0,
): void {
  const requiredBatchCount = description.scans.reduce(
    (total, scan) =>
      total + Math.ceil(scan.pointCount / invocation.limits.maximumBatchPoints),
    0,
  );
  const requiredPointVisits = description.scans.reduce((total, scan) => {
    let scanVisits = 0;
    for (
      let endPointIndex = Math.min(
        invocation.limits.maximumBatchPoints,
        scan.pointCount,
      );
      endPointIndex <= scan.pointCount;
      endPointIndex = Math.min(
        endPointIndex + invocation.limits.maximumBatchPoints,
        scan.pointCount,
      )
    ) {
      scanVisits += endPointIndex;
      if (endPointIndex === scan.pointCount) break;
    }
    return total + scanVisits;
  }, 0);
  if (
    !sameCanonical(description.source, invocation.source) ||
    description.totalPointCount > invocation.limits.maximumInputPoints ||
    description.scans.length > invocation.limits.maximumScans
  ) {
    fail(
      "E57_GEOMETRY_READER_DESCRIPTION_MISMATCH",
      "Reader description does not bind the exact invocation source and limits.",
    );
  }
  if (
    requiredBatchCount > FOUNDRY_E57_GEOMETRY_MAXIMUM_READER_BATCHES ||
    requiredPointVisits > FOUNDRY_E57_GEOMETRY_MAXIMUM_POINT_VISITS
  ) {
    fail(
      "E57_GEOMETRY_READER_WORK_LIMIT_EXCEEDED",
      "The E57 scan inventory exceeds the fixed reader-command or scan-prefix replay-work limit.",
    );
  }
}

function validateCheckpointForResume(
  checkpointInput: FoundryE57GeometryCheckpointV0,
  invocation: FoundryE57GeometryInvocationV0,
  invocationSha256: string,
  description: FoundryE57GeometryReaderDescriptionV0,
): FoundryE57GeometryCheckpointV0 {
  const checkpoint =
    FoundryE57GeometryCheckpointV0Schema.parse(checkpointInput);
  if (
    checkpoint.invocationSha256 !== invocationSha256 ||
    !sameCanonical(
      checkpoint.checkpointContract,
      invocation.checkpointContract,
    ) ||
    checkpoint.readerDescription.descriptionSha256 !==
      description.descriptionSha256 ||
    !sameCanonical(checkpoint.readerDescription, description) ||
    checkpoint.processedPointCount !==
      cursorProcessedPointCount(checkpoint.cursor, description) ||
    checkpoint.acceptedPointCount > invocation.limits.maximumOutputPoints
  ) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_INCOMPATIBLE",
      "Checkpoint does not bind the exact E57 invocation, reader description, cursor, and output limits.",
    );
  }
  const scanStartPointIndices: number[] = [];
  let nextScanStart = 0;
  for (const scan of description.scans) {
    scanStartPointIndices.push(nextScanStart);
    nextScanStart += scan.pointCount;
  }
  let previousAcceptedSourceOrdinal = -1;
  for (const point of checkpoint.acceptedPoints) {
    const scan = description.scans[point.scanIndex];
    const scanStartPointIndex = scanStartPointIndices[point.scanIndex];
    const sourceOrdinal =
      scanStartPointIndex === undefined
        ? Number.MAX_SAFE_INTEGER
        : scanStartPointIndex + point.sourcePointIndex;
    if (
      scan === undefined ||
      point.data3dGuid !== scan.data3dGuid ||
      point.sourcePointIndex >= scan.pointCount ||
      sourceOrdinal >= checkpoint.processedPointCount ||
      sourceOrdinal <= previousAcceptedSourceOrdinal ||
      !withinCrop([point.xM, point.yM, point.zM], invocation.crop)
    ) {
      fail(
        "E57_GEOMETRY_CHECKPOINT_POINT_INVALID",
        "Checkpoint contains an unordered, duplicate, future, or out-of-crop point for its exact scan identity.",
      );
    }
    previousAcceptedSourceOrdinal = sourceOrdinal;
  }
  return checkpoint;
}

function initialCheckpoint(
  invocation: FoundryE57GeometryInvocationV0,
  invocationSha256: string,
  description: FoundryE57GeometryReaderDescriptionV0,
): FoundryE57GeometryCheckpointV0 {
  return sealCheckpoint({
    schemaVersion: FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0,
    invocationSha256,
    checkpointContract: invocation.checkpointContract,
    readerDescription: description,
    cursor: { scanIndex: 0, pointIndex: 0 },
    committedBatchCount: 0,
    processedPointCount: 0,
    invalidPointCount: 0,
    croppedOutPointCount: 0,
    acceptedPointCount: 0,
    acceptedPoints: [],
    outputBoundsM: null,
    complete: false,
    authority: "none",
  });
}

interface BoundReaderBatch {
  readonly scan: z.infer<typeof FoundryE57GeometryScanDescriptionV0Schema>;
  readonly batch: z.infer<typeof ReaderBatchSchema>;
}

async function readNextBoundBatch(
  invocation: FoundryE57GeometryInvocationV0,
  description: FoundryE57GeometryReaderDescriptionV0,
  checkpoint: FoundryE57GeometryCheckpointV0,
  reader: FoundryE57GeometryReader,
  signal: AbortSignal | undefined,
): Promise<BoundReaderBatch> {
  const cursor = checkpoint.cursor;
  if (cursor === null) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_CURSOR_MISSING",
      "Incomplete checkpoint is missing its next reader cursor.",
    );
  }
  const scan = description.scans[cursor.scanIndex];
  if (scan === undefined) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_CURSOR_INVALID",
      "Checkpoint references a scan outside the reader description.",
    );
  }
  const maximumPoints = Math.min(
    invocation.limits.maximumBatchPoints,
    scan.pointCount - cursor.pointIndex,
  );
  const rawBatch = await reader.readBatch({
    source: invocation.source,
    scanIndex: cursor.scanIndex,
    startPointIndex: cursor.pointIndex,
    maximumPoints,
    maximumInputPoints: invocation.limits.maximumInputPoints,
    maximumScans: invocation.limits.maximumScans,
    signal,
  });
  const batch = parseReaderBatch(rawBatch);
  if (
    batch.sourceSha256 !== invocation.source.sha256 ||
    batch.scanIndex !== cursor.scanIndex ||
    batch.data3dGuid !== scan.data3dGuid ||
    batch.startPointIndex !== cursor.pointIndex ||
    batch.points.length !== maximumPoints
  ) {
    fail(
      "E57_GEOMETRY_READER_BATCH_BINDING_MISMATCH",
      "Reader batch does not bind the source, scan, GUID, cursor, and exact fixed-size batch request.",
    );
  }
  return { scan, batch };
}

function advanceCheckpoint(
  invocation: FoundryE57GeometryInvocationV0,
  invocationSha256: string,
  description: FoundryE57GeometryReaderDescriptionV0,
  checkpoint: FoundryE57GeometryCheckpointV0,
  boundBatch: BoundReaderBatch,
): FoundryE57GeometryCheckpointV0 {
  const cursor = checkpoint.cursor;
  if (cursor === null) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_CURSOR_MISSING",
      "A complete checkpoint cannot accept another reader batch.",
    );
  }
  const { scan, batch } = boundBatch;
  const acceptedPoints = [...checkpoint.acceptedPoints];
  let invalidPointCount = checkpoint.invalidPointCount;
  let croppedOutPointCount = checkpoint.croppedOutPointCount;
  for (const [offset, point] of batch.points.entries()) {
    if (point.cartesianInvalidState !== 0) {
      invalidPointCount += 1;
      continue;
    }
    const transformed = transformPoint(point, scan);
    if (!transformed.every(Number.isFinite)) {
      fail(
        "E57_GEOMETRY_TRANSFORM_NONFINITE",
        "A valid E57 point became non-finite after its normalized scan pose transform.",
      );
    }
    if (!withinCrop(transformed, invocation.crop)) {
      croppedOutPointCount += 1;
      continue;
    }
    if (acceptedPoints.length >= invocation.limits.maximumOutputPoints) {
      fail(
        "E57_GEOMETRY_OUTPUT_POINT_LIMIT_EXCEEDED",
        "The inclusive E57 crop exceeds its configured maximum output point count; narrow the crop or raise the explicit bounded limit.",
      );
    }
    acceptedPoints.push({
      scanIndex: scan.scanIndex,
      data3dGuid: scan.data3dGuid,
      sourcePointIndex: cursor.pointIndex + offset,
      xM: transformed[0],
      yM: transformed[1],
      zM: transformed[2],
    });
  }
  const endPointIndex = cursor.pointIndex + batch.points.length;
  const next = nextCursor(scan, endPointIndex, description);
  return sealCheckpoint({
    schemaVersion: FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0,
    invocationSha256,
    checkpointContract: invocation.checkpointContract,
    readerDescription: description,
    cursor: next,
    committedBatchCount: checkpoint.committedBatchCount + 1,
    processedPointCount: checkpoint.processedPointCount + batch.points.length,
    invalidPointCount,
    croppedOutPointCount,
    acceptedPointCount: acceptedPoints.length,
    acceptedPoints,
    outputBoundsM: boundsForPoints(acceptedPoints),
    complete: next === null,
    authority: "none",
  });
}

async function replayCheckpointForResume(
  checkpointInput: FoundryE57GeometryCheckpointV0,
  invocation: FoundryE57GeometryInvocationV0,
  invocationSha256: string,
  description: FoundryE57GeometryReaderDescriptionV0,
  reader: FoundryE57GeometryReader,
  signal: AbortSignal | undefined,
): Promise<FoundryE57GeometryCheckpointV0> {
  const claim = validateCheckpointForResume(
    checkpointInput,
    invocation,
    invocationSha256,
    description,
  );
  const targetProcessedPointCount = claim.processedPointCount;
  let replayed = initialCheckpoint(invocation, invocationSha256, description);

  while (replayed.processedPointCount < targetProcessedPointCount) {
    if (isAborted(signal)) {
      fail(
        "E57_GEOMETRY_CANCELLED_DURING_CHECKPOINT_REPLAY",
        "Checkpoint replay was cancelled before the supplied state could be reconstructed from source.",
      );
    }
    let boundBatch: BoundReaderBatch;
    try {
      boundBatch = await readNextBoundBatch(
        invocation,
        description,
        replayed,
        reader,
        signal,
      );
    } catch (error: unknown) {
      if (isAborted(signal)) {
        fail(
          "E57_GEOMETRY_CANCELLED_DURING_CHECKPOINT_REPLAY",
          "Checkpoint replay was cancelled before the supplied state could be reconstructed from source.",
          error,
        );
      }
      throw error;
    }
    if (isAborted(signal)) {
      fail(
        "E57_GEOMETRY_CANCELLED_DURING_CHECKPOINT_REPLAY",
        "Checkpoint replay was cancelled before the supplied state could be reconstructed from source.",
      );
    }
    replayed = advanceCheckpoint(
      invocation,
      invocationSha256,
      description,
      replayed,
      boundBatch,
    );
    if (replayed.processedPointCount > targetProcessedPointCount) {
      fail(
        "E57_GEOMETRY_CHECKPOINT_REPLAY_MISMATCH",
        "The supplied checkpoint cursor is not a deterministic fixed-size reader batch boundary.",
      );
    }
  }

  if (!sameCanonical(replayed, claim)) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_REPLAY_MISMATCH",
      "The supplied checkpoint does not equal the state reconstructed from its bound source prefix.",
    );
  }
  return replayed;
}

function artifactFromCheckpoint(
  invocation: FoundryE57GeometryInvocationV0,
  checkpoint: FoundryE57GeometryCheckpointV0,
): FoundryE57GeometryCropArtifactV0 {
  if (!checkpoint.complete) {
    fail(
      "E57_GEOMETRY_CHECKPOINT_INCOMPLETE",
      "A crop artifact can be emitted only from a complete checkpoint.",
    );
  }
  const material = ArtifactMaterialSchema.parse({
    schemaVersion: FOUNDRY_E57_GEOMETRY_CROP_V0,
    invocationSha256: checkpoint.invocationSha256,
    finalCheckpointSha256: checkpoint.checkpointSha256,
    source: invocation.source,
    sourceFactsArtifactSha256: invocation.sourceFactsArtifactSha256,
    readerDescription: checkpoint.readerDescription,
    coordinateContract: invocation.coordinateContract,
    crop: invocation.crop,
    pointCounts: {
      source: checkpoint.readerDescription.totalPointCount,
      processed: checkpoint.processedPointCount,
      invalid: checkpoint.invalidPointCount,
      croppedOut: checkpoint.croppedOutPointCount,
      accepted: checkpoint.acceptedPointCount,
    },
    points: checkpoint.acceptedPoints,
    outputBoundsM: checkpoint.outputBoundsM,
    invalidPointDisposition: "cartesianInvalidState_nonzero_excluded",
    movableContent: {
      classification: "not_performed",
      retainedContent: "may_include_captured_movable_objects",
      geometryAuthority: "none",
      placementAuthority: "excluded",
      measurementAuthority: "excluded",
      collisionAuthority: "excluded",
      exportAuthority: "excluded",
    },
    capabilities: {
      runtimeRegistration: "not_authorized",
      immutableRegistration: "not_authorized",
      signing: "not_authorized",
      activation: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
    limitations: LIMITATIONS,
    authority: "none",
  });
  return FoundryE57GeometryCropArtifactV0Schema.parse({
    ...material,
    artifactSha256: artifactSha256(material),
  });
}

function parseReaderDescription(
  value: unknown,
): FoundryE57GeometryReaderDescriptionV0 {
  const parsed = FoundryE57GeometryReaderDescriptionV0Schema.safeParse(value);
  if (!parsed.success) {
    fail(
      "E57_GEOMETRY_READER_DESCRIPTION_INVALID",
      "E57 geometry reader returned an invalid bounded description.",
      parsed.error,
    );
  }
  return parsed.data;
}

function parseReaderBatch(value: unknown): z.infer<typeof ReaderBatchSchema> {
  const parsed = ReaderBatchSchema.safeParse(value);
  if (!parsed.success) {
    fail(
      "E57_GEOMETRY_READER_BATCH_INVALID",
      "E57 geometry reader returned an invalid bounded point batch.",
      parsed.error,
    );
  }
  return parsed.data;
}

function cancellationResult(
  checkpoint: FoundryE57GeometryCheckpointV0,
): FoundryE57GeometryWorkerResult {
  return { status: "cancelled", checkpoint };
}

async function publishDetachedCheckpoint(
  checkpoint: FoundryE57GeometryCheckpointV0,
  onCheckpoint: RunFoundryE57GeometryWorkerOptions["onCheckpoint"] | undefined,
): Promise<FoundryE57GeometryCheckpointV0> {
  if (onCheckpoint === undefined) return checkpoint;
  const internalCheckpoint = checkpoint;
  const detachedCheckpoint = FoundryE57GeometryCheckpointV0Schema.parse(
    structuredClone(internalCheckpoint),
  );
  await onCheckpoint(detachedCheckpoint);
  return FoundryE57GeometryCheckpointV0Schema.parse(internalCheckpoint);
}

async function runFoundryE57GeometryWorkerWithoutReaderClose(
  options: RunFoundryE57GeometryWorkerOptions,
): Promise<FoundryE57GeometryWorkerResult> {
  const invocation = FoundryE57GeometryInvocationV0Schema.parse(
    options.invocation,
  );
  const invocationSha256 =
    computeFoundryE57GeometryInvocationSha256(invocation);
  const maximumBatches =
    options.maximumBatchesThisRun ??
    FOUNDRY_E57_GEOMETRY_MAXIMUM_READER_BATCHES;
  if (
    !Number.isSafeInteger(maximumBatches) ||
    maximumBatches <= 0 ||
    maximumBatches > FOUNDRY_E57_GEOMETRY_MAXIMUM_READER_BATCHES
  ) {
    fail(
      "E57_GEOMETRY_BATCH_BUDGET_INVALID",
      `maximumBatchesThisRun must be a positive integer no greater than ${String(FOUNDRY_E57_GEOMETRY_MAXIMUM_READER_BATCHES)}.`,
    );
  }

  let descriptionInput: unknown;
  try {
    descriptionInput = await options.reader.describe({
      source: invocation.source,
      maximumInputPoints: invocation.limits.maximumInputPoints,
      maximumScans: invocation.limits.maximumScans,
      signal: options.signal,
    });
  } catch (error: unknown) {
    if (isAborted(options.signal)) {
      fail(
        "E57_GEOMETRY_CANCELLED_BEFORE_DESCRIPTION",
        "E57 geometry read was cancelled before an exact reader description could be checkpointed.",
        error,
      );
    }
    throw error;
  }
  const description = parseReaderDescription(descriptionInput);
  assertDescriptionMatchesInvocation(description, invocation);
  let checkpoint =
    options.checkpoint === undefined
      ? initialCheckpoint(invocation, invocationSha256, description)
      : await replayCheckpointForResume(
          options.checkpoint,
          invocation,
          invocationSha256,
          description,
          options.reader,
          options.signal,
        );

  if (checkpoint.complete) {
    return {
      status: "succeeded",
      checkpoint,
      artifact: artifactFromCheckpoint(invocation, checkpoint),
    };
  }
  if (isAborted(options.signal)) return cancellationResult(checkpoint);

  let batchesThisRun = 0;
  while (!checkpoint.complete && batchesThisRun < maximumBatches) {
    if (isAborted(options.signal)) return cancellationResult(checkpoint);
    let boundBatch: BoundReaderBatch;
    try {
      boundBatch = await readNextBoundBatch(
        invocation,
        description,
        checkpoint,
        options.reader,
        options.signal,
      );
    } catch (error: unknown) {
      if (isAborted(options.signal)) return cancellationResult(checkpoint);
      throw error;
    }
    checkpoint = advanceCheckpoint(
      invocation,
      invocationSha256,
      description,
      checkpoint,
      boundBatch,
    );
    batchesThisRun += 1;
    checkpoint = await publishDetachedCheckpoint(
      checkpoint,
      options.onCheckpoint,
    );
    if (isAborted(options.signal)) return cancellationResult(checkpoint);
  }

  if (!checkpoint.complete) return { status: "paused", checkpoint };
  return {
    status: "succeeded",
    checkpoint,
    artifact: artifactFromCheckpoint(invocation, checkpoint),
  };
}

export async function runFoundryE57GeometryWorker(
  options: RunFoundryE57GeometryWorkerOptions,
): Promise<FoundryE57GeometryWorkerResult> {
  try {
    return await runFoundryE57GeometryWorkerWithoutReaderClose(options);
  } finally {
    await options.reader.close?.();
  }
}
