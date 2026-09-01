import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { endianness } from "node:os";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  inspectOrderedSogMemberCoordinateStream,
  LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
  Lcc2ContainerValidationError,
  type OrderedSogCoordinateBoundsV1,
  type OrderedSogCoordinateChunkV1,
  type OrderedSogMemberInventoryV1,
} from "./lcc2-container-validation.js";
import {
  inspectLcc2HighestDetailFrontier,
  inspectLcc2HighestDetailFrontierPlan,
  type Lcc2HashedMemberV0,
  type Lcc2HighestDetailFrontierPlanV0,
} from "./lcc2-frontier.js";
import {
  inspectLcc2OrderedGaussianInventory,
  type Lcc2OrderedGaussianInventoryReceiptV1,
} from "./lcc2-ordered-gaussian-inventory.js";

export const LCC2_SOG_COORDINATE_STREAM_RECEIPT_V1 =
  "omnitwin.reconstruction-foundry/lcc2-sog-coordinate-stream-receipt/v1";
export const LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1 =
  "positions-u16le-xyz.bin";
export const LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1 =
  "positions-f64le-xyz.bin";
export const LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1 =
  "coordinate-stream-receipt.json";

const RECEIPT_DIGEST_DOMAIN = "OMNITWIN_LCC2_SOG_COORDINATE_STREAM_RECEIPT_V1";
const HASH_CHUNK_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
export const LCC2_SOG_COORDINATE_STREAM_LIMITS_V1 = Object.freeze({
  maximumGaussianCount: 8_000_000,
  maximumMemberCount: 64,
} as const);

export interface Lcc2SogCoordinateStreamExpectedSourceProfileV1 {
  readonly profileId: string;
  readonly gaussianCount: number;
  readonly memberCount: number;
  readonly ordinalInventorySha256: string;
  readonly orderedInventoryReceiptSha256: string;
}

export const GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE = Object.freeze({
  profileId: "grand-hall-big-sog-v1",
  gaussianCount: 6_019_684,
  memberCount: 11,
  ordinalInventorySha256: "sha256:e8d7c8d94b246bfb1e047088af31e4fcb74c34c65ed67c16435995a4f46ab46d",
  orderedInventoryReceiptSha256: "sha256:247cdad37b50821a9b06c59a139e3e6897c8b8c318c9c78de15b3c26187b30e3",
} as const satisfies Lcc2SogCoordinateStreamExpectedSourceProfileV1);

export const LCC2_SOG_COORDINATE_DECODER_V1 = Object.freeze({
  format: "public_playcanvas_sog_v2" as const,
  specificationUrl: "https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/" as const,
  referenceImplementation: "@playcanvas/splat-transform@3.3.3" as const,
  referenceCommit: "d092ae94e6e1d5161990ce5ca960f659ea9faf5f" as const,
  referenceSourcePath: "src/lib/readers/read-sog.ts" as const,
  referenceSourceSha256: "sha256:a5f721d5337add7eeec0f947c66c12ae36c257504863076bfc72cc191630570c" as const,
  referenceReadBehavior: "javascript_number_then_float32array" as const,
  emittedReadBehavior: "javascript_number_then_float64_le_without_fround" as const,
  lowHighRule: "q=(upper<<8)|lower" as const,
  normalizedRule: "u=q/65535" as const,
  logDomainRule: "scale=(max-min)||1;n=min+scale*u" as const,
  symmetricLogInverseRule: "p=n<0?-(exp(abs(n))-1):exp(abs(n))-1" as const,
  arithmetic: "javascript_number_math_exp_float64_write" as const,
});
const OUTPUT_INVENTORY = Object.freeze([
  LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
  LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
  LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
] as const);

export type Lcc2SogCoordinateStreamErrorCode =
  | "LCC2_COORDINATE_ARGUMENT_INVALID"
  | "LCC2_COORDINATE_DECODE_INVALID"
  | "LCC2_COORDINATE_LIMIT_EXCEEDED"
  | "LCC2_COORDINATE_OUTPUT_EXISTS"
  | "LCC2_COORDINATE_OUTPUT_MISMATCH"
  | "LCC2_COORDINATE_OUTPUT_UNSAFE"
  | "LCC2_COORDINATE_OUTPUT_WRITE_FAILED"
  | "LCC2_COORDINATE_SOURCE_CHANGED"
  | "LCC2_COORDINATE_SOURCE_PROFILE_MISMATCH"
  | "LCC2_COORDINATE_TRAVERSAL_INVALID";

export class Lcc2SogCoordinateStreamError extends Error {
  public readonly code: Lcc2SogCoordinateStreamErrorCode;

  public constructor(
    code: Lcc2SogCoordinateStreamErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Lcc2SogCoordinateStreamError";
    this.code = code;
  }
}

export interface Lcc2SogCoordinateStreamMemberReceiptV1 {
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly gaussianCount: number;
  readonly globalStart: number;
  readonly globalEndExclusive: number;
  readonly source: {
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly metaJsonSha256: string;
    readonly quantizedPositionSha256: string;
  };
  readonly logDomainBounds: {
    readonly mins: readonly [number, number, number];
    readonly maxs: readonly [number, number, number];
  };
  readonly quantizedBody: {
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly dequantizedBody: {
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly statistics: Lcc2SogCoordinateStatisticsV1;
}

export interface Lcc2SogCoordinateStatisticsV1 {
  readonly quantizedUint16: {
    readonly mins: readonly [number, number, number];
    readonly maxs: readonly [number, number, number];
  };
  readonly decodedFloat64PreFround: {
    readonly mins: readonly [number, number, number];
    readonly maxs: readonly [number, number, number];
    readonly finiteCounts: readonly [number, number, number];
    readonly nonFiniteCounts: readonly [number, number, number];
  };
  readonly referenceFloat32Projection: {
    readonly projection: "Math.fround";
    readonly mins: readonly [number, number, number];
    readonly maxs: readonly [number, number, number];
    readonly finiteCounts: readonly [number, number, number];
    readonly nonFiniteCounts: readonly [number, number, number];
  };
}

export interface Lcc2SogCoordinateStreamReceiptV1 {
  readonly schemaVersion: typeof LCC2_SOG_COORDINATE_STREAM_RECEIPT_V1;
  readonly sourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1;
  readonly limits: typeof LCC2_SOG_COORDINATE_STREAM_LIMITS_V1;
  readonly sourceOrderedInventory: {
    readonly receiptSha256: string;
    readonly ordinalInventorySha256: string;
    readonly sourceFrontierReceiptSha256: string;
    readonly manifestFileName: string;
    readonly manifestSizeBytes: number;
    readonly manifestSha256: string;
    readonly lcc2Guid: string;
  };
  readonly stream: {
    readonly coordinateValueKind: "sog_v2_source_coordinates_unregistered";
    readonly memberTraversalPolicy: "lcc2_frontier_file_index_ascending_v1";
    readonly localOrdinalPolicy: "sog_row_major_top_left_meta_count_v1";
    readonly gaussianCount: number;
    readonly memberCount: number;
    readonly quantized: {
      readonly fileName: typeof LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1;
      readonly recordEncoding: "uint16_le_xyz";
      readonly recordBytes: 6;
      readonly byteLength: number;
      readonly sha256: string;
    };
    readonly dequantized: {
      readonly fileName: typeof LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1;
      readonly recordEncoding: "ieee754_float64_le_xyz";
      readonly recordBytes: 24;
      readonly byteLength: number;
      readonly sha256: string;
    };
    readonly decoder: typeof LCC2_SOG_COORDINATE_DECODER_V1;
    readonly emitterRuntime: {
      readonly nodeVersion: string;
      readonly v8Version: string;
      readonly platform: NodeJS.Platform;
      readonly architecture: string;
      readonly hostByteOrder: "BE" | "LE";
      readonly outputByteOrder: "explicit_little_endian_buffer_writes";
    };
    readonly statistics: Lcc2SogCoordinateStatisticsV1;
    readonly members: readonly Lcc2SogCoordinateStreamMemberReceiptV1[];
  };
  readonly proof: {
    readonly sourceFrontierStableAcrossCoordinateDecodeAndInventoryInspection: true;
    readonly exactOrderedInventoryReverifiedAfterCoordinateDecode: true;
    readonly everyMemberImmutableSha256BoundSnapshotUsed: true;
    readonly everyQuantizedMemberDigestMatchedOrderedInventory: true;
    readonly everyLocalOrdinalContiguous: true;
    readonly everyGlobalOrdinalContiguous: true;
    readonly outputBodiesCreateOnlyAndReceiptLast: true;
    readonly coordinatesDequantizedFromExactSogV2Bytes: true;
    readonly everyDecodedFloat64AndReferenceFloat32Finite: true;
    readonly expectedSourceProfileMatched: true;
    readonly sourceLimitsCheckedBeforeCoordinateDecode: true;
    readonly sourceLimitsCheckedBeforeOutputBodyCreation: true;
    readonly independentReferenceComparisonPerformed: false;
    readonly coordinateFrameEstablished: false;
    readonly metricScaleEstablished: false;
    readonly roomMembershipEstablished: false;
    readonly maskProduced: false;
    readonly transformProduced: false;
    readonly transformAccepted: false;
    readonly trainingPerformed: false;
    readonly reconstructionPerformed: false;
    readonly generatedContentAdded: false;
    readonly runtimeAdmissionGranted: false;
    readonly stagingAuthorized: false;
    readonly deploymentAuthorized: false;
    readonly publicationAuthorized: false;
    readonly productionTrustActivated: false;
    readonly productionTrust: null;
    readonly authority: "none";
    readonly applicationNetworkRequests: "none";
    readonly sourceWrites: "none";
  };
  readonly outputInventory: typeof OUTPUT_INVENTORY;
  readonly receiptSha256: string;
}

export interface Lcc2SogCoordinateStreamOptionsV1 {
  readonly manifestPath: string;
  readonly outputDirectory: string;
  readonly expectedSourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1;
  readonly signal?: AbortSignal;
  /** @internal Deterministic race hooks for focused regression tests. */
  readonly testHooks?: {
    readonly afterStagingClaimed?: (input: {
      readonly stagingDirectory: string;
      readonly targetDirectory: string;
    }) => void | PromiseLike<void>;
    readonly beforeFinalInventoryInspection?: () => void | PromiseLike<void>;
    readonly beforePublish?: (input: {
      readonly stagingDirectory: string;
      readonly targetDirectory: string;
    }) => void | PromiseLike<void>;
    readonly afterPublishedIdentityRead?: (input: {
      readonly targetDirectory: string;
    }) => void | PromiseLike<void>;
    readonly afterOutputIdentityRead?: (input: {
      readonly targetDirectory: string;
    }) => void | PromiseLike<void>;
    readonly beforeFirstBodyWrite?: (input: {
      readonly closeBodyHandles: () => Promise<void>;
    }) => void | PromiseLike<void>;
  };
}

interface ObjectIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface DirectoryWitness {
  readonly root: string;
  readonly identity: ObjectIdentity;
}

interface OutputLocation {
  readonly target: string;
  readonly parent: string;
  readonly parentIdentity: ObjectIdentity;
}

interface StagingClaim extends OutputLocation {
  readonly staging: string;
  readonly stagingIdentity: ObjectIdentity;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}

interface OpenedBody {
  readonly path: string;
  readonly handle: FileHandle;
  readonly identity: FileIdentity;
}

interface DerivedStream {
  readonly sourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1;
  readonly orderedInventory: Lcc2OrderedGaussianInventoryReceiptV1;
  readonly gaussianCount: number;
  readonly quantizedByteLength: number;
  readonly quantizedSha256: string;
  readonly dequantizedByteLength: number;
  readonly dequantizedSha256: string;
  readonly statistics: Lcc2SogCoordinateStatisticsV1;
  readonly members: readonly Lcc2SogCoordinateStreamMemberReceiptV1[];
}

interface CoordinateSourcePreflight {
  readonly plan: Lcc2HighestDetailFrontierPlanV0;
  readonly sourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1;
  readonly frontier: Awaited<ReturnType<typeof inspectLcc2HighestDetailFrontier>>;
}

interface MutableCoordinateStatistics {
  readonly quantizedMins: [number, number, number];
  readonly quantizedMaxs: [number, number, number];
  readonly float64Mins: [number, number, number];
  readonly float64Maxs: [number, number, number];
  readonly float64FiniteCounts: [number, number, number];
  readonly float64NonFiniteCounts: [number, number, number];
  readonly float32Mins: [number, number, number];
  readonly float32Maxs: [number, number, number];
  readonly float32FiniteCounts: [number, number, number];
  readonly float32NonFiniteCounts: [number, number, number];
}

interface CoordinateChunkSink {
  readonly consume: (input: {
    readonly member: Lcc2HashedMemberV0;
    readonly globalStart: number;
    readonly chunk: OrderedSogCoordinateChunkV1;
  }) => Promise<void>;
}

function fail(
  code: Lcc2SogCoordinateStreamErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new Lcc2SogCoordinateStreamError(code, message, cause);
}

function normalizeExpectedSourceProfile(
  value: unknown,
): Lcc2SogCoordinateStreamExpectedSourceProfileV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "An explicit bounded source profile is required.");
  }
  const profile = value as Record<string, unknown>;
  const exactKeys = [
    "gaussianCount",
    "memberCount",
    "orderedInventoryReceiptSha256",
    "ordinalInventorySha256",
    "profileId",
  ];
  if (canonicalString(Object.keys(profile).sort()) !== canonicalString(exactKeys)) {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "The source profile must contain exactly the five v1 identity fields.");
  }
  const profileId = profile.profileId;
  const gaussianCount = profile.gaussianCount;
  const memberCount = profile.memberCount;
  const ordinalInventorySha256 = profile.ordinalInventorySha256;
  const orderedInventoryReceiptSha256 = profile.orderedInventoryReceiptSha256;
  if (
    typeof profileId !== "string" ||
    profileId !== profileId.normalize("NFC") ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(profileId)
  ) {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "Source profile id must be a bounded lowercase identifier.");
  }
  if (
    typeof gaussianCount !== "number" ||
    !Number.isSafeInteger(gaussianCount) ||
    gaussianCount < 1 ||
    gaussianCount > LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumGaussianCount ||
    typeof memberCount !== "number" ||
    !Number.isSafeInteger(memberCount) ||
    memberCount < 1 ||
    memberCount > LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumMemberCount
  ) {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "Source profile counts must be positive integers within the coordinate-stream ceilings.");
  }
  if (
    typeof ordinalInventorySha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(ordinalInventorySha256) ||
    typeof orderedInventoryReceiptSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(orderedInventoryReceiptSha256)
  ) {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "Source profile inventory identities must be lowercase sha256 digests.");
  }
  return Object.freeze({
    profileId,
    gaussianCount,
    memberCount,
    ordinalInventorySha256,
    orderedInventoryReceiptSha256,
  });
}

function assertCountsWithinLimits(gaussianCount: number, memberCount: number): void {
  if (
    gaussianCount > LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumGaussianCount ||
    memberCount > LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumMemberCount
  ) {
    return fail(
      "LCC2_COORDINATE_LIMIT_EXCEEDED",
      `Coordinate source exceeds the v1 ceilings of ${String(LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumGaussianCount)} Gaussians and ${String(LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumMemberCount)} members.`,
    );
  }
}

async function preflightCoordinateSource(
  options: Lcc2SogCoordinateStreamOptionsV1,
): Promise<CoordinateSourcePreflight> {
  const sourceProfile = normalizeExpectedSourceProfile(options.expectedSourceProfile);
  const plan = await inspectLcc2HighestDetailFrontierPlan({
    manifestPath: options.manifestPath,
    environmentPolicy: "exclude",
    signal: options.signal,
  });
  assertCountsWithinLimits(plan.selection.gaussianCount, plan.selection.members.length);
  if (plan.source.splatType !== ".sog") {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "Coordinate stream v1 supports only exact SOG v2 LCC2 sources.");
  }
  if (
    plan.selection.gaussianCount !== sourceProfile.gaussianCount ||
    plan.selection.members.length !== sourceProfile.memberCount
  ) {
    return fail(
      "LCC2_COORDINATE_SOURCE_PROFILE_MISMATCH",
      `Manifest plan does not match expected source profile ${sourceProfile.profileId}.`,
    );
  }
  const frontier = await inspectLcc2HighestDetailFrontier({
    manifestPath: options.manifestPath,
    environmentPolicy: "exclude",
    maximumSogImagePixels: LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
    signal: options.signal,
  });
  assertFrontierMatchesPreflight(plan, sourceProfile, frontier);
  return { plan, sourceProfile, frontier };
}

function assertFrontierMatchesPreflight(
  plan: Lcc2HighestDetailFrontierPlanV0,
  sourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1,
  actual: Awaited<ReturnType<typeof inspectLcc2HighestDetailFrontier>>,
): void {
  assertCountsWithinLimits(
    plan.selection.gaussianCount,
    plan.selection.members.length,
  );
  assertCountsWithinLimits(actual.selection.gaussianCount, actual.selection.members.length);
  const plannedMembers = plan.selection.members.map((member) => ({
    fileIndex: member.fileIndex,
    relativePath: member.relativePath,
    gaussianCount: member.gaussianCount,
  }));
  const actualMembers = actual.selection.members.map((member) => ({
    fileIndex: member.fileIndex,
    relativePath: member.relativePath,
    gaussianCount: member.gaussianCount,
  }));
  if (
    actual.source.splatType !== ".sog" ||
    actual.selection.gaussianCount !== sourceProfile.gaussianCount ||
    actual.selection.members.length !== sourceProfile.memberCount ||
    canonicalString(actualMembers) !== canonicalString(plannedMembers)
  ) {
    return fail("LCC2_COORDINATE_SOURCE_CHANGED", "LCC2 frontier changed after its bounded manifest preflight.");
  }
}

function assertOrderedInventoryMatchesSourceProfile(
  inventory: Lcc2OrderedGaussianInventoryReceiptV1,
  profile: Lcc2SogCoordinateStreamExpectedSourceProfileV1,
): void {
  if (
    inventory.inventory.gaussianCount !== profile.gaussianCount ||
    inventory.inventory.members.length !== profile.memberCount ||
    inventory.inventory.ordinalInventorySha256 !== profile.ordinalInventorySha256 ||
    inventory.receiptSha256 !== profile.orderedInventoryReceiptSha256
  ) {
    return fail(
      "LCC2_COORDINATE_SOURCE_PROFILE_MISMATCH",
      `Exact ordered inventory does not match expected source profile ${profile.profileId}.`,
    );
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function emptyCoordinateStatistics(): MutableCoordinateStatistics {
  return {
    quantizedMins: [65_535, 65_535, 65_535],
    quantizedMaxs: [0, 0, 0],
    float64Mins: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    float64Maxs: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    float64FiniteCounts: [0, 0, 0],
    float64NonFiniteCounts: [0, 0, 0],
    float32Mins: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    float32Maxs: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    float32FiniteCounts: [0, 0, 0],
    float32NonFiniteCounts: [0, 0, 0],
  };
}

function observeCoordinateChunk(
  targets: readonly MutableCoordinateStatistics[],
  chunk: OrderedSogCoordinateChunkV1,
): void {
  for (let localIndex = 0; localIndex < chunk.gaussianCount; localIndex += 1) {
    for (const axis of [0, 1, 2] as const) {
      const quantized = chunk.quantizedUint16LeXyz.readUInt16LE(localIndex * 6 + axis * 2);
      const float64 = chunk.dequantizedFloat64LeXyz.readDoubleLE(localIndex * 24 + axis * 8);
      const float32 = Math.fround(float64);
      for (const target of targets) {
        if (!Number.isFinite(float64)) {
          target.float64NonFiniteCounts[axis] += 1;
        } else {
          target.float64FiniteCounts[axis] += 1;
          target.float64Mins[axis] = Math.min(target.float64Mins[axis], float64);
          target.float64Maxs[axis] = Math.max(target.float64Maxs[axis], float64);
        }
        if (!Number.isFinite(float32)) {
          target.float32NonFiniteCounts[axis] += 1;
        } else {
          target.float32FiniteCounts[axis] += 1;
          target.float32Mins[axis] = Math.min(target.float32Mins[axis], float32);
          target.float32Maxs[axis] = Math.max(target.float32Maxs[axis], float32);
        }
        target.quantizedMins[axis] = Math.min(target.quantizedMins[axis], quantized);
        target.quantizedMaxs[axis] = Math.max(target.quantizedMaxs[axis], quantized);
      }
      if (!Number.isFinite(float64) || !Number.isFinite(float32)) {
        return fail(
          "LCC2_COORDINATE_DECODE_INVALID",
          "SOG coordinate decoding produced a non-finite float64 value or Float32Array reference projection.",
        );
      }
    }
  }
}

function tuple3(values: readonly number[], label: string): [number, number, number] {
  const x = values[0];
  const y = values[1];
  const z = values[2];
  if (x === undefined || y === undefined || z === undefined) {
    return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", `${label} is incomplete.`);
  }
  return [x, y, z];
}

function finalizeCoordinateStatistics(
  statistics: MutableCoordinateStatistics,
  gaussianCount: number,
): Lcc2SogCoordinateStatisticsV1 {
  const expectedCounts = [gaussianCount, gaussianCount, gaussianCount];
  if (
    statistics.float64NonFiniteCounts.some((count) => count !== 0) ||
    statistics.float32NonFiniteCounts.some((count) => count !== 0) ||
    statistics.float64FiniteCounts.some((count, axis) => count !== expectedCounts[axis]) ||
    statistics.float32FiniteCounts.some((count, axis) => count !== expectedCounts[axis])
  ) {
    return fail("LCC2_COORDINATE_DECODE_INVALID", "Coordinate statistics contain non-finite or incomplete axes.");
  }
  return {
    quantizedUint16: {
      mins: tuple3(statistics.quantizedMins, "Quantized coordinate minima"),
      maxs: tuple3(statistics.quantizedMaxs, "Quantized coordinate maxima"),
    },
    decodedFloat64PreFround: {
      mins: tuple3(statistics.float64Mins, "Float64 coordinate minima"),
      maxs: tuple3(statistics.float64Maxs, "Float64 coordinate maxima"),
      finiteCounts: tuple3(statistics.float64FiniteCounts, "Float64 finite counts"),
      nonFiniteCounts: tuple3(statistics.float64NonFiniteCounts, "Float64 non-finite counts"),
    },
    referenceFloat32Projection: {
      projection: "Math.fround",
      mins: tuple3(statistics.float32Mins, "Float32 coordinate minima"),
      maxs: tuple3(statistics.float32Maxs, "Float32 coordinate maxima"),
      finiteCounts: tuple3(statistics.float32FiniteCounts, "Float32 finite counts"),
      nonFiniteCounts: tuple3(statistics.float32NonFiniteCounts, "Float32 non-finite counts"),
    },
  };
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    return fail("LCC2_COORDINATE_SOURCE_CHANGED", "Coordinate-stream operation was cancelled.");
  }
}

function windowsPathWithoutFileNamespace(path: string): string {
  const normalized = path.replaceAll("/", "\\");
  const namespacedUncPrefix = "\\\\?\\UNC\\";
  if (normalized.slice(0, namespacedUncPrefix.length).toLocaleLowerCase("en-US") ===
    namespacedUncPrefix.toLocaleLowerCase("en-US")) {
    return `\\\\${normalized.slice(namespacedUncPrefix.length)}`;
  }
  const namespacedFilePrefix = "\\\\?\\";
  if (normalized.startsWith(namespacedFilePrefix)) {
    return normalized.slice(namespacedFilePrefix.length);
  }
  return normalized;
}

function hasWindowsDeviceNamespace(path: string): boolean {
  if (process.platform !== "win32") return false;
  const normalized = path.replaceAll("/", "\\");
  return normalized.startsWith("\\\\?\\") || normalized.startsWith("\\\\.\\");
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  if (process.platform !== "win32") return normalized;
  return windowsPathWithoutFileNamespace(normalized).toLocaleLowerCase("en-US");
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function pathWithin(root: string, candidate: string): boolean {
  const displacement = relative(comparablePath(root), comparablePath(candidate));
  return displacement === "" || (
    !isAbsolute(displacement) &&
    displacement !== ".." &&
    !displacement.startsWith(`..${sep}`)
  );
}

function objectIdentity(stat: Stats): ObjectIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameObject(left: ObjectIdentity, right: ObjectIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileIdentity(stat: Stats): FileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    nlink: stat.nlink,
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function strictDirectory(path: string, label: string): Promise<DirectoryWitness> {
  const normalized = resolve(path);
  if (!samePath(path, normalized)) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} must be absolute and normalized.`);
  }
  const canonical = await realpath(normalized).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} cannot be resolved.`, error));
  const stat = await lstat(normalized).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} cannot be inspected.`, error));
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(canonical, normalized)) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} must be one direct canonical directory.`);
  }
  return { root: normalized, identity: objectIdentity(stat) };
}

async function requireDirectory(
  path: string,
  identity: ObjectIdentity,
  label: string,
): Promise<void> {
  const stat = await lstat(path).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} disappeared.`, error));
  const canonical = await realpath(path).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} cannot be resolved.`, error));
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !sameObject(objectIdentity(stat), identity) ||
    !samePath(canonical, path)
  ) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} identity changed.`);
  }
}

async function outputLocation(
  manifestPath: string,
  outputDirectory: string,
): Promise<OutputLocation> {
  if (
    typeof manifestPath !== "string" ||
    typeof outputDirectory !== "string" ||
    !isAbsolute(manifestPath) ||
    !isAbsolute(outputDirectory) ||
    hasWindowsDeviceNamespace(manifestPath) ||
    hasWindowsDeviceNamespace(outputDirectory)
  ) {
    return fail(
      "LCC2_COORDINATE_ARGUMENT_INVALID",
      "Coordinate-stream manifest and output paths must be absolute and omit Windows file/device namespaces.",
    );
  }
  const normalizedManifestPath = resolve(manifestPath);
  const normalizedOutputDirectory = resolve(outputDirectory);
  if (
    !samePath(normalizedManifestPath, manifestPath) ||
    !samePath(normalizedOutputDirectory, outputDirectory) ||
    basename(normalizedOutputDirectory).length === 0
  ) {
    return fail(
      "LCC2_COORDINATE_ARGUMENT_INVALID",
      "Coordinate-stream manifest and output paths must be absolute.",
    );
  }
  const parent = await strictDirectory(dirname(normalizedOutputDirectory), "Coordinate-stream output parent");
  if (!samePath(joinDirect(parent.root, basename(normalizedOutputDirectory)), normalizedOutputDirectory)) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Output must be a direct child of its canonical parent.");
  }
  const sourceRoot = await realpath(dirname(normalizedManifestPath)).catch((error: unknown) =>
    fail("LCC2_COORDINATE_SOURCE_CHANGED", "LCC2 source root cannot be resolved.", error));
  if (
    pathWithin(sourceRoot, normalizedOutputDirectory) ||
    pathWithin(normalizedOutputDirectory, sourceRoot)
  ) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Output and LCC2 source roots must be disjoint.");
  }
  return {
    target: normalizedOutputDirectory,
    parent: parent.root,
    parentIdentity: parent.identity,
  };
}

function joinDirect(parent: string, name: string): string {
  return resolve(parent, name);
}

function absoluteMemberPath(manifestPath: string, memberPath: string): string {
  const root = dirname(resolve(manifestPath));
  const candidate = resolve(root, ...memberPath.split("/"));
  if (!pathWithin(root, candidate) || samePath(root, candidate)) {
    return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", `Selected member escapes its LCC2 root: ${memberPath}.`);
  }
  return candidate;
}

function assertAscendingMembers(
  members: readonly Lcc2HashedMemberV0[],
  expectedCount: number,
): void {
  let priorFileIndex = -1;
  let total = 0;
  const paths = new Set<string>();
  for (const member of members) {
    if (
      member.fileIndex <= priorFileIndex ||
      paths.has(member.relativePath) ||
      !Number.isSafeInteger(member.gaussianCount) ||
      member.gaussianCount < 1
    ) {
      return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", "Selected members are not one unique ascending file-index traversal.");
    }
    priorFileIndex = member.fileIndex;
    paths.add(member.relativePath);
    total += member.gaussianCount;
    if (!Number.isSafeInteger(total)) {
      return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", "Global coordinate ordinal exceeds the exact integer range.");
    }
  }
  if (members.length === 0 || total !== expectedCount) {
    return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", "Selected member counts do not match the frontier total.");
  }
}

function sourceMemberMaterial(member: OrderedSogMemberInventoryV1): Record<string, unknown> {
  return {
    relativePath: member.relativePath,
    sizeBytes: member.sizeBytes,
    sha256: member.sha256,
    metaJsonSha256: member.metaJsonSha256,
    gaussianCount: member.gaussianCount,
    imageWidth: member.imageWidth,
    imageHeight: member.imageHeight,
    pixelCapacity: member.pixelCapacity,
    ignoredTrailingPixelCount: member.ignoredTrailingPixelCount,
    packedRecordBytes: member.packedRecordBytes,
    quantizedPositionRecordLayout: member.quantizedPositionRecordLayout,
    packedRecordLayout: member.packedRecordLayout,
    quantizedPositionSha256: member.quantizedPositionSha256,
    packedRecordSha256: member.packedRecordSha256,
    planes: member.planes,
    proof: member.proof,
  };
}

function canonicalString(value: unknown): string {
  return stableCanonicalJson(toCanonicalJson(value));
}

function findCoordinateError(error: unknown): Lcc2SogCoordinateStreamError | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof Lcc2SogCoordinateStreamError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

async function inspectMemberCoordinates(
  options: Parameters<typeof inspectOrderedSogMemberCoordinateStream>[0],
) {
  try {
    return await inspectOrderedSogMemberCoordinateStream(options);
  } catch (error: unknown) {
    const coordinateError = findCoordinateError(error);
    if (coordinateError !== undefined) throw coordinateError;
    if (
      error instanceof Lcc2ContainerValidationError &&
      error.code === "invalid" &&
      error.message.startsWith("SOG v2 coordinate decoding")
    ) {
      return fail("LCC2_COORDINATE_DECODE_INVALID", error.message, error);
    }
    throw error;
  }
}

async function deriveCoordinateStream(
  options: Lcc2SogCoordinateStreamOptionsV1,
  sink: CoordinateChunkSink,
  preflight: CoordinateSourcePreflight,
): Promise<DerivedStream> {
  assertNotCancelled(options.signal);
  const initial = preflight.frontier;
  if (initial.source.splatType !== ".sog") {
    return fail("LCC2_COORDINATE_ARGUMENT_INVALID", "Coordinate stream v1 supports only exact SOG v2 LCC2 sources.");
  }
  assertFrontierMatchesPreflight(preflight.plan, preflight.sourceProfile, initial);
  assertAscendingMembers(initial.selection.members, initial.selection.gaussianCount);

  const globalQuantizedHash = createHash("sha256");
  const globalFloat64Hash = createHash("sha256");
  const globalStatistics = emptyCoordinateStatistics();
  const decodedMembers: Array<{
    readonly inventory: OrderedSogMemberInventoryV1;
    readonly receipt: Lcc2SogCoordinateStreamMemberReceiptV1;
  }> = [];
  let globalStart = 0;
  let quantizedOffset = 0;
  let float64Offset = 0;

  for (const member of initial.selection.members) {
    assertNotCancelled(options.signal);
    const memberQuantizedHash = createHash("sha256");
    const memberFloat64Hash = createHash("sha256");
    const memberStatistics = emptyCoordinateStatistics();
    let expectedLocalStart = 0;
    const memberQuantizedOffset = quantizedOffset;
    const memberFloat64Offset = float64Offset;
    const decoded = await inspectMemberCoordinates({
      absolutePath: absoluteMemberPath(options.manifestPath, member.relativePath),
      relativePath: member.relativePath,
      expectedSizeBytes: member.sizeBytes,
      expectedSha256: member.sha256,
      expectedGaussianCount: member.gaussianCount,
      signal: options.signal,
      consumeCoordinateChunk: async (chunk) => {
        if (
          chunk.localStart !== expectedLocalStart ||
          chunk.gaussianCount < 1 ||
          chunk.quantizedUint16LeXyz.length !== chunk.gaussianCount * 6 ||
          chunk.dequantizedFloat64LeXyz.length !== chunk.gaussianCount * 24
        ) {
          return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", `Coordinate chunks are not contiguous for ${member.relativePath}.`);
        }
        observeCoordinateChunk([memberStatistics, globalStatistics], chunk);
        memberQuantizedHash.update(chunk.quantizedUint16LeXyz);
        memberFloat64Hash.update(chunk.dequantizedFloat64LeXyz);
        globalQuantizedHash.update(chunk.quantizedUint16LeXyz);
        globalFloat64Hash.update(chunk.dequantizedFloat64LeXyz);
        await sink.consume({ member, globalStart, chunk });
        expectedLocalStart += chunk.gaussianCount;
        quantizedOffset += chunk.quantizedUint16LeXyz.length;
        float64Offset += chunk.dequantizedFloat64LeXyz.length;
      },
    });
    const memberBounds: OrderedSogCoordinateBoundsV1 = decoded.bounds;
    const decodedFormula = {
      lowHighRule: decoded.decoding.lowHighRule,
      normalizedRule: decoded.decoding.normalizedRule,
      linearRule: decoded.decoding.linearRule,
      symmetricLogInverseRule: decoded.decoding.symmetricLogInverseRule,
    };
    const expectedFormula = {
      lowHighRule: LCC2_SOG_COORDINATE_DECODER_V1.lowHighRule,
      normalizedRule: LCC2_SOG_COORDINATE_DECODER_V1.normalizedRule,
      linearRule: "scale=(max-min)||1;n=min+scale*(q/65535)",
      symmetricLogInverseRule: LCC2_SOG_COORDINATE_DECODER_V1.symmetricLogInverseRule,
    };
    if (canonicalString(decodedFormula) !== canonicalString(expectedFormula)) {
      return fail("LCC2_COORDINATE_DECODE_INVALID", "SOG coordinate adapter formula drifted from its pinned public decoder contract.");
    }
    if (expectedLocalStart !== member.gaussianCount) {
      return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", `Coordinate count mismatch for ${member.relativePath}.`);
    }
    const memberQuantizedSha256 = `sha256:${memberQuantizedHash.digest("hex")}`;
    const memberFloat64Sha256 = `sha256:${memberFloat64Hash.digest("hex")}`;
    if (memberQuantizedSha256 !== decoded.inventory.quantizedPositionSha256) {
      return fail("LCC2_COORDINATE_DECODE_INVALID", `Quantized coordinate bytes disagree with the ordered inventory for ${member.relativePath}.`);
    }
    const globalEndExclusive = globalStart + member.gaussianCount;
    if (!Number.isSafeInteger(globalEndExclusive)) {
      return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", "Global coordinate interval exceeds the exact integer range.");
    }
    decodedMembers.push({
      inventory: decoded.inventory,
      receipt: {
        fileIndex: member.fileIndex,
        relativePath: member.relativePath,
        gaussianCount: member.gaussianCount,
        globalStart,
        globalEndExclusive,
        source: {
          sizeBytes: member.sizeBytes,
          sha256: member.sha256,
          metaJsonSha256: decoded.inventory.metaJsonSha256,
          quantizedPositionSha256: decoded.inventory.quantizedPositionSha256,
        },
        logDomainBounds: {
          mins: memberBounds.logDomainMins,
          maxs: memberBounds.logDomainMaxs,
        },
        quantizedBody: {
          byteOffset: memberQuantizedOffset,
          byteLength: quantizedOffset - memberQuantizedOffset,
          sha256: memberQuantizedSha256,
        },
        dequantizedBody: {
          byteOffset: memberFloat64Offset,
          byteLength: float64Offset - memberFloat64Offset,
          sha256: memberFloat64Sha256,
        },
        statistics: finalizeCoordinateStatistics(memberStatistics, member.gaussianCount),
      },
    });
    globalStart = globalEndExclusive;
  }
  if (
    globalStart !== initial.selection.gaussianCount ||
    quantizedOffset !== globalStart * 6 ||
    float64Offset !== globalStart * 24
  ) {
    return fail("LCC2_COORDINATE_TRAVERSAL_INVALID", "Global coordinate bodies are not exact contiguous record streams.");
  }

  await options.testHooks?.beforeFinalInventoryInspection?.();
  assertNotCancelled(options.signal);
  const orderedInventory = await inspectLcc2OrderedGaussianInventory({
    manifestPath: options.manifestPath,
    signal: options.signal,
  });
  if (
    orderedInventory.sourceFrontier.receiptSha256 !== initial.receiptSha256 ||
    orderedInventory.inventory.gaussianCount !== globalStart ||
    orderedInventory.inventory.members.length !== decodedMembers.length
  ) {
    return fail("LCC2_COORDINATE_SOURCE_CHANGED", "LCC2 ordered inventory changed across coordinate decoding.");
  }
  for (let index = 0; index < decodedMembers.length; index += 1) {
    const decoded = decodedMembers[index];
    const finalMember = orderedInventory.inventory.members[index];
    const decodedMaterial = decoded === undefined
      ? undefined
      : sourceMemberMaterial(decoded.inventory);
    const finalMaterial = finalMember === undefined
      ? undefined
      : sourceMemberMaterial(finalMember);
    const changedFields = decodedMaterial === undefined || finalMaterial === undefined
      ? ["missing_member"]
      : Object.keys(decodedMaterial).filter((key) =>
        canonicalString(decodedMaterial[key]) !== canonicalString(finalMaterial[key]));
    if (
      decoded === undefined ||
      finalMember === undefined ||
      decoded.receipt.fileIndex !== finalMember.fileIndex ||
      decoded.receipt.globalStart !== finalMember.globalStart ||
      decoded.receipt.globalEndExclusive !== finalMember.globalEndExclusive ||
      changedFields.length > 0
    ) {
      return fail(
        "LCC2_COORDINATE_SOURCE_CHANGED",
        `LCC2 member identity changed across coordinate decoding (${changedFields.join(",") || "interval"}).` +
          (changedFields[0] === undefined || decodedMaterial === undefined || finalMaterial === undefined
            ? ""
            : ` decoded=${canonicalString(decodedMaterial[changedFields[0]])} final=${canonicalString(finalMaterial[changedFields[0]])}`),
      );
    }
  }
  assertOrderedInventoryMatchesSourceProfile(orderedInventory, preflight.sourceProfile);

  return {
    sourceProfile: preflight.sourceProfile,
    orderedInventory,
    gaussianCount: globalStart,
    quantizedByteLength: quantizedOffset,
    quantizedSha256: `sha256:${globalQuantizedHash.digest("hex")}`,
    dequantizedByteLength: float64Offset,
    dequantizedSha256: `sha256:${globalFloat64Hash.digest("hex")}`,
    statistics: finalizeCoordinateStatistics(globalStatistics, globalStart),
    members: Object.freeze(decodedMembers.map(({ receipt }) => Object.freeze(receipt))),
  };
}

function buildReceipt(derived: DerivedStream): Lcc2SogCoordinateStreamReceiptV1 {
  const material: Omit<Lcc2SogCoordinateStreamReceiptV1, "receiptSha256"> = {
    schemaVersion: LCC2_SOG_COORDINATE_STREAM_RECEIPT_V1,
    sourceProfile: derived.sourceProfile,
    limits: LCC2_SOG_COORDINATE_STREAM_LIMITS_V1,
    sourceOrderedInventory: {
      receiptSha256: derived.orderedInventory.receiptSha256,
      ordinalInventorySha256: derived.orderedInventory.inventory.ordinalInventorySha256,
      sourceFrontierReceiptSha256: derived.orderedInventory.sourceFrontier.receiptSha256,
      manifestFileName: derived.orderedInventory.sourceFrontier.manifestFileName,
      manifestSizeBytes: derived.orderedInventory.sourceFrontier.manifestSizeBytes,
      manifestSha256: derived.orderedInventory.sourceFrontier.manifestSha256,
      lcc2Guid: derived.orderedInventory.sourceFrontier.lcc2Guid,
    },
    stream: {
      coordinateValueKind: "sog_v2_source_coordinates_unregistered",
      memberTraversalPolicy: "lcc2_frontier_file_index_ascending_v1",
      localOrdinalPolicy: "sog_row_major_top_left_meta_count_v1",
      gaussianCount: derived.gaussianCount,
      memberCount: derived.members.length,
      quantized: {
        fileName: LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
        recordEncoding: "uint16_le_xyz",
        recordBytes: 6,
        byteLength: derived.quantizedByteLength,
        sha256: derived.quantizedSha256,
      },
      dequantized: {
        fileName: LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
        recordEncoding: "ieee754_float64_le_xyz",
        recordBytes: 24,
        byteLength: derived.dequantizedByteLength,
        sha256: derived.dequantizedSha256,
      },
      decoder: LCC2_SOG_COORDINATE_DECODER_V1,
      emitterRuntime: {
        nodeVersion: process.version,
        v8Version: process.versions.v8,
        platform: process.platform,
        architecture: process.arch,
        hostByteOrder: endianness(),
        outputByteOrder: "explicit_little_endian_buffer_writes",
      },
      statistics: derived.statistics,
      members: derived.members,
    },
    proof: {
      sourceFrontierStableAcrossCoordinateDecodeAndInventoryInspection: true,
      exactOrderedInventoryReverifiedAfterCoordinateDecode: true,
      everyMemberImmutableSha256BoundSnapshotUsed: true,
      everyQuantizedMemberDigestMatchedOrderedInventory: true,
      everyLocalOrdinalContiguous: true,
      everyGlobalOrdinalContiguous: true,
      outputBodiesCreateOnlyAndReceiptLast: true,
      coordinatesDequantizedFromExactSogV2Bytes: true,
      everyDecodedFloat64AndReferenceFloat32Finite: true,
      expectedSourceProfileMatched: true,
      sourceLimitsCheckedBeforeCoordinateDecode: true,
      sourceLimitsCheckedBeforeOutputBodyCreation: true,
      independentReferenceComparisonPerformed: false,
      coordinateFrameEstablished: false,
      metricScaleEstablished: false,
      roomMembershipEstablished: false,
      maskProduced: false,
      transformProduced: false,
      transformAccepted: false,
      trainingPerformed: false,
      reconstructionPerformed: false,
      generatedContentAdded: false,
      runtimeAdmissionGranted: false,
      stagingAuthorized: false,
      deploymentAuthorized: false,
      publicationAuthorized: false,
      productionTrustActivated: false,
      productionTrust: null,
      authority: "none",
      applicationNetworkRequests: "none",
      sourceWrites: "none",
    },
    outputInventory: OUTPUT_INVENTORY,
  };
  return deepFreeze({
    ...material,
    receiptSha256: `sha256:${domainSeparatedSha256(
      RECEIPT_DIGEST_DOMAIN,
      toCanonicalJson(material),
    )}`,
  });
}

function receiptBytes(receipt: Lcc2SogCoordinateStreamReceiptV1): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(receipt))}\n`, "utf8");
}

async function claimStaging(location: OutputLocation): Promise<StagingClaim> {
  if (process.platform !== "win32") {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Create-only coordinate publication requires Windows no-replace directory rename semantics.");
  }
  if (await pathExists(location.target)) {
    return fail("LCC2_COORDINATE_OUTPUT_EXISTS", `Refusing to replace existing output: ${location.target}`);
  }
  await requireDirectory(location.parent, location.parentIdentity, "Coordinate-stream output parent");
  const staging = await mkdtemp(joinDirect(location.parent, `.${basename(location.target)}.staging-`));
  const witness = await strictDirectory(staging, "Coordinate-stream staging directory");
  return { ...location, staging: witness.root, stagingIdentity: witness.identity };
}

async function requireStaging(claim: StagingClaim): Promise<void> {
  await requireDirectory(claim.parent, claim.parentIdentity, "Coordinate-stream output parent");
  await requireDirectory(claim.staging, claim.stagingIdentity, "Coordinate-stream staging directory");
}

async function cleanupStaging(claim: StagingClaim): Promise<void> {
  try {
    await requireStaging(claim);
    await rm(claim.staging, { recursive: true, force: false });
  } catch {
    // Never recursively remove a path after its identity stops matching the
    // private staging directory this process created.
  }
}

async function openCreateOnlyBody(claim: StagingClaim, name: string): Promise<FileHandle> {
  await requireStaging(claim);
  const path = joinDirect(claim.staging, name);
  if (basename(name) !== name || !samePath(dirname(path), claim.staging)) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Unsafe output member name: ${name}`);
  }
  return open(path, "wx", 0o600).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", `Cannot create staged output ${name}.`, error));
}

async function writeExact(
  handle: FileHandle,
  bytes: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    let bytesWritten: number;
    try {
      ({ bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        position + offset,
      ));
    } catch (error: unknown) {
      return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Coordinate body write failed.", error);
    }
    if (bytesWritten <= 0) {
      return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Coordinate body write made no progress.");
    }
    offset += bytesWritten;
  }
}

async function readExact(
  handle: FileHandle,
  length: number,
  position: number,
  code: Lcc2SogCoordinateStreamErrorCode,
  label: string,
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(bytes, offset, length - offset, position + offset));
    } catch (error: unknown) {
      bytes.fill(0);
      return fail(code, `${label} could not be read.`, error);
    }
    if (bytesRead <= 0) {
      bytes.fill(0);
      return fail(code, `${label} is truncated.`);
    }
    offset += bytesRead;
  }
  return bytes;
}

async function hashOpenedFile(
  handle: FileHandle,
  size: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(1, size)));
  try {
    let position = 0;
    while (position < size) {
      assertNotCancelled(signal);
      const length = Math.min(buffer.length, size - position);
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(buffer, 0, length, position));
      } catch (error: unknown) {
        return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Coordinate output could not be hashed through its open handle.", error);
      }
      if (bytesRead !== length) {
        return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Coordinate output ended before its checked byte length.");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    buffer.fill(0);
  }
}

async function openStableOutputFile(
  root: DirectoryWitness,
  name: string,
): Promise<OpenedBody> {
  await requireDirectory(root.root, root.identity, "Coordinate-stream output directory");
  const path = joinDirect(root.root, name);
  if (basename(name) !== name || !samePath(dirname(path), root.root)) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Unsafe output member: ${name}`);
  }
  const handle = await open(path, "r").catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_MISMATCH", `Missing output member ${name}.`, error));
  try {
    const opened = await handle.stat().catch((error: unknown) =>
      fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Output member ${name} cannot be inspected through its open handle.`, error));
    const linked = await lstat(path).catch((error: unknown) =>
      fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Output member ${name} disappeared after opening.`, error));
    const canonical = await realpath(path).catch((error: unknown) =>
      fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Output member ${name} cannot be resolved after opening.`, error));
    const identity = fileIdentity(opened);
    if (
      !opened.isFile() ||
      !linked.isFile() ||
      linked.isSymbolicLink() ||
      opened.nlink !== 1 ||
      linked.nlink !== 1 ||
      !sameFileIdentity(identity, fileIdentity(linked)) ||
      !samePath(canonical, path)
    ) {
      return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `Output member ${name} is indirect, linked, or unstable.`);
    }
    return { path, handle, identity };
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

async function requireStableOutputFile(
  root: DirectoryWitness,
  opened: OpenedBody,
  label: string,
): Promise<void> {
  await requireDirectory(root.root, root.identity, "Coordinate-stream output directory");
  const handleStat = await opened.handle.stat();
  const pathStat = await lstat(opened.path).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} disappeared.`, error));
  const canonical = await realpath(opened.path).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} cannot be resolved.`, error));
  if (
    !handleStat.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    handleStat.nlink !== 1 ||
    pathStat.nlink !== 1 ||
    !sameFileIdentity(opened.identity, fileIdentity(handleStat)) ||
    !sameFileIdentity(opened.identity, fileIdentity(pathStat)) ||
    !samePath(canonical, opened.path)
  ) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", `${label} identity changed.`);
  }
}

async function exactOutputInventory(root: DirectoryWitness): Promise<void> {
  await requireDirectory(root.root, root.identity, "Coordinate-stream output directory");
  const entries = await readdir(root.root, { withFileTypes: true }).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Coordinate output inventory became unavailable.", error));
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Coordinate output contains a non-regular member.");
  }
  const actual = entries.map(({ name }) => name).sort();
  const expected = [...OUTPUT_INVENTORY].sort();
  if (canonicalString(actual) !== canonicalString(expected)) {
    return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Coordinate output inventory is incomplete or contains extra files.");
  }
}

async function verifyStagedBody(
  claim: StagingClaim,
  name: string,
  expectedLength: number,
  expectedSha256: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const root: DirectoryWitness = { root: claim.staging, identity: claim.stagingIdentity };
  const opened = await openStableOutputFile(root, name);
  try {
    if (
      opened.identity.size !== expectedLength ||
      await hashOpenedFile(opened.handle, opened.identity.size, signal) !== expectedSha256
    ) {
      return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", `Staged output ${name} failed exact byte verification.`);
    }
    await requireStableOutputFile(root, opened, `Staged output ${name}`);
  } finally {
    await opened.handle.close();
  }
}

async function publishStaging(
  claim: StagingClaim,
  options: Lcc2SogCoordinateStreamOptionsV1,
): Promise<DirectoryWitness> {
  await requireStaging(claim);
  await options.testHooks?.beforePublish?.({
    stagingDirectory: claim.staging,
    targetDirectory: claim.target,
  });
  await requireStaging(claim);
  if (await pathExists(claim.target)) {
    return fail("LCC2_COORDINATE_OUTPUT_EXISTS", `Refusing racing output target: ${claim.target}`);
  }
  await rename(claim.staging, claim.target).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_EXISTS", "Atomic create-only coordinate publication failed.", error));
  const published = await lstat(claim.target).catch((error: unknown) =>
    fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Published coordinate output disappeared.", error));
  if (
    !published.isDirectory() ||
    published.isSymbolicLink() ||
    !sameObject(objectIdentity(published), claim.stagingIdentity)
  ) {
    return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Published coordinate output is not the claimed staging object.");
  }
  await options.testHooks?.afterPublishedIdentityRead?.({ targetDirectory: claim.target });
  const root = { root: claim.target, identity: claim.stagingIdentity };
  await requireDirectory(root.root, root.identity, "Published coordinate output");
  await requireDirectory(claim.parent, claim.parentIdentity, "Coordinate-stream output parent");
  return root;
}

export async function writeLcc2SogCoordinateStream(
  options: Lcc2SogCoordinateStreamOptionsV1,
): Promise<Lcc2SogCoordinateStreamReceiptV1> {
  const location = await outputLocation(options.manifestPath, options.outputDirectory);
  if (await pathExists(location.target)) {
    return fail("LCC2_COORDINATE_OUTPUT_EXISTS", `Refusing to replace existing output: ${location.target}`);
  }
  const preflight = await preflightCoordinateSource(options);
  const claim = await claimStaging(location);
  let published = false;
  let quantizedHandle: FileHandle | undefined;
  let float64Handle: FileHandle | undefined;
  try {
    await options.testHooks?.afterStagingClaimed?.({
      stagingDirectory: claim.staging,
      targetDirectory: claim.target,
    });
    await requireStaging(claim);
    quantizedHandle = await openCreateOnlyBody(claim, LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1);
    float64Handle = await openCreateOnlyBody(claim, LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1);
    await options.testHooks?.beforeFirstBodyWrite?.({
      closeBodyHandles: async () => {
        await Promise.all([
          quantizedHandle?.close(),
          float64Handle?.close(),
        ]);
      },
    });
    let quantizedPosition = 0;
    let float64Position = 0;
    const derived = await deriveCoordinateStream(options, {
      consume: async ({ chunk }) => {
        if (quantizedHandle === undefined || float64Handle === undefined) {
          return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Coordinate output handles closed before streaming completed.");
        }
        await writeExact(quantizedHandle, chunk.quantizedUint16LeXyz, quantizedPosition);
        await writeExact(float64Handle, chunk.dequantizedFloat64LeXyz, float64Position);
        quantizedPosition += chunk.quantizedUint16LeXyz.length;
        float64Position += chunk.dequantizedFloat64LeXyz.length;
      },
    }, preflight);
    try {
      await quantizedHandle.sync();
      await float64Handle.sync();
      await quantizedHandle.close();
      await float64Handle.close();
    } catch (error: unknown) {
      return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Coordinate body sync or close failed.", error);
    }
    quantizedHandle = undefined;
    float64Handle = undefined;
    if (
      quantizedPosition !== derived.quantizedByteLength ||
      float64Position !== derived.dequantizedByteLength
    ) {
      return fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Persisted coordinate byte counts do not match derived streams.");
    }
    await verifyStagedBody(
      claim,
      LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
      derived.quantizedByteLength,
      derived.quantizedSha256,
      options.signal,
    );
    await verifyStagedBody(
      claim,
      LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
      derived.dequantizedByteLength,
      derived.dequantizedSha256,
      options.signal,
    );
    const receipt = buildReceipt(derived);
    const encodedReceipt = receiptBytes(receipt);
    const receiptHandle = await openCreateOnlyBody(claim, LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1);
    try {
      await writeExact(receiptHandle, encodedReceipt, 0);
      await receiptHandle.sync().catch((error: unknown) =>
        fail("LCC2_COORDINATE_OUTPUT_WRITE_FAILED", "Coordinate receipt sync failed.", error));
    } finally {
      await receiptHandle.close();
    }
    await verifyStagedBody(
      claim,
      LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
      encodedReceipt.length,
      `sha256:${createHash("sha256").update(encodedReceipt).digest("hex")}`,
      options.signal,
    );
    await exactOutputInventory({ root: claim.staging, identity: claim.stagingIdentity });
    const publishedRoot = await publishStaging(claim, options);
    published = true;
    await exactOutputInventory(publishedRoot);
    await verifyPersistedOutput(publishedRoot, receipt, options.signal);
    return receipt;
  } finally {
    await quantizedHandle?.close().catch(() => undefined);
    await float64Handle?.close().catch(() => undefined);
    if (!published) await cleanupStaging(claim);
  }
}

async function verifyPersistedOutput(
  root: DirectoryWitness,
  expectedReceipt: Lcc2SogCoordinateStreamReceiptV1,
  signal: AbortSignal | undefined,
): Promise<void> {
  await exactOutputInventory(root);
  const plans = [
    {
      name: LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
      size: expectedReceipt.stream.quantized.byteLength,
      sha256: expectedReceipt.stream.quantized.sha256,
    },
    {
      name: LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
      size: expectedReceipt.stream.dequantized.byteLength,
      sha256: expectedReceipt.stream.dequantized.sha256,
    },
  ] as const;
  for (const plan of plans) {
    const opened = await openStableOutputFile(root, plan.name);
    try {
      if (
        opened.identity.size !== plan.size ||
        await hashOpenedFile(opened.handle, opened.identity.size, signal) !== plan.sha256
      ) {
        return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", `Published coordinate body ${plan.name} differs from its receipt.`);
      }
      await requireStableOutputFile(root, opened, `Published coordinate body ${plan.name}`);
    } finally {
      await opened.handle.close();
    }
  }
  const expectedBytes = receiptBytes(expectedReceipt);
  const receipt = await openStableOutputFile(root, LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1);
  try {
    if (receipt.identity.size !== expectedBytes.length || receipt.identity.size > MAX_RECEIPT_BYTES) {
      return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Published coordinate receipt has the wrong byte length.");
    }
    const actual = await readExact(
      receipt.handle,
      receipt.identity.size,
      0,
      "LCC2_COORDINATE_OUTPUT_MISMATCH",
      "Published coordinate receipt",
    );
    if (actual.compare(expectedBytes) !== 0) {
      return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Published coordinate receipt differs from exact regeneration.");
    }
    await requireStableOutputFile(root, receipt, "Published coordinate receipt");
  } finally {
    await receipt.handle.close();
  }
  await exactOutputInventory(root);
}

export async function checkLcc2SogCoordinateStream(
  options: Lcc2SogCoordinateStreamOptionsV1,
): Promise<Lcc2SogCoordinateStreamReceiptV1> {
  const location = await outputLocation(options.manifestPath, options.outputDirectory);
  const preflight = await preflightCoordinateSource(options);
  const root = await strictDirectory(location.target, "Coordinate-stream output directory")
    .catch((error: unknown) => {
      const coordinateError = findCoordinateError(error);
      if (coordinateError !== undefined) throw coordinateError;
      return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Coordinate output directory is missing or unsafe.", error);
    });
  await options.testHooks?.afterOutputIdentityRead?.({ targetDirectory: root.root });
  await requireDirectory(root.root, root.identity, "Coordinate-stream output directory");
  await exactOutputInventory(root);
  const quantized = await openStableOutputFile(root, LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1);
  let float64: OpenedBody | undefined;
  try {
    float64 = await openStableOutputFile(root, LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1);
    let quantizedPosition = 0;
    let float64Position = 0;
    const derived = await deriveCoordinateStream(options, {
      consume: async ({ chunk }) => {
        if (float64 === undefined) {
          return fail("LCC2_COORDINATE_OUTPUT_UNSAFE", "Float64 output closed during zero-write check.");
        }
        const actualQuantized = await readExact(
          quantized.handle,
          chunk.quantizedUint16LeXyz.length,
          quantizedPosition,
          "LCC2_COORDINATE_OUTPUT_MISMATCH",
          "Quantized coordinate body",
        );
        const actualFloat64 = await readExact(
          float64.handle,
          chunk.dequantizedFloat64LeXyz.length,
          float64Position,
          "LCC2_COORDINATE_OUTPUT_MISMATCH",
          "Float64 coordinate body",
        );
        try {
          if (
            actualQuantized.compare(chunk.quantizedUint16LeXyz) !== 0 ||
            actualFloat64.compare(chunk.dequantizedFloat64LeXyz) !== 0
          ) {
            return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Persisted coordinate bytes differ from exact source regeneration.");
          }
        } finally {
          actualQuantized.fill(0);
          actualFloat64.fill(0);
        }
        quantizedPosition += chunk.quantizedUint16LeXyz.length;
        float64Position += chunk.dequantizedFloat64LeXyz.length;
      },
    }, preflight);
    if (
      quantizedPosition !== derived.quantizedByteLength ||
      float64Position !== derived.dequantizedByteLength ||
      quantized.identity.size !== derived.quantizedByteLength ||
      float64.identity.size !== derived.dequantizedByteLength
    ) {
      return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Persisted coordinate body length differs from exact regeneration.");
    }
    if (
      await hashOpenedFile(quantized.handle, quantized.identity.size, options.signal) !== derived.quantizedSha256 ||
      await hashOpenedFile(float64.handle, float64.identity.size, options.signal) !== derived.dequantizedSha256
    ) {
      return fail("LCC2_COORDINATE_OUTPUT_MISMATCH", "Persisted coordinate body digest differs from exact regeneration.");
    }
    await requireStableOutputFile(root, quantized, "Quantized coordinate body");
    await requireStableOutputFile(root, float64, "Float64 coordinate body");
    const receipt = buildReceipt(derived);
    await verifyPersistedOutput(root, receipt, options.signal);
    await requireDirectory(location.parent, location.parentIdentity, "Coordinate-stream output parent");
    return receipt;
  } finally {
    await quantized.handle.close();
    await float64?.handle.close();
  }
}
