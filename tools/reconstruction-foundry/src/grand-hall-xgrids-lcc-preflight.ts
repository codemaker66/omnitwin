import { TextDecoder } from "node:util";
import type { Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  domainSeparatedSha256,
  sha256RegularFileWithHead,
  toCanonicalJson,
  type ExpectedRegularFileIdentity,
} from "@omnitwin/reconstruction-foundry";

export const GRAND_HALL_XGRIDS_LCC_PREFLIGHT_V1 =
  "omnitwin.reconstruction-foundry/grand-hall-xgrids-lcc-preflight/v1";
export const GRAND_HALL_XGRIDS_LCC_PREFLIGHT_RECEIPT_DOMAIN =
  "OMNITWIN_GRAND_HALL_XGRIDS_LCC_PREFLIGHT_RECEIPT_V1";
export const GRAND_HALL_ROOM_MEMBERSHIP_SHA256 =
  "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68";

export const GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES = 128 * 1024 ** 3;
export const GRAND_HALL_XGRIDS_MINIMUM_SCRATCH_FREE_BYTES = 500 * 1024 ** 3;
export const GRAND_HALL_XGRIDS_MINIMUM_GPU_MEMORY_MIB = 24_000;
export const GRAND_HALL_XGRIDS_MINIMUM_DRIVER_VERSION = "581.90";
export const GRAND_HALL_XGRIDS_MINIMUM_COMPUTE_CAPABILITY_EXCLUSIVE = 7.5;

export interface XgridsExpectedFileV1 {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface XgridsSourcePolicyV1 {
  readonly expectedDirectories: readonly string[];
  readonly expectedFiles: readonly XgridsExpectedFileV1[];
  readonly expectedTotalBytes: number;
  readonly xbinRelativePath: string;
  readonly projectJsonRelativePath: string;
  readonly posesRelativePath: string;
}

export const GRAND_HALL_XGRIDS_SOURCE_POLICY_V1: XgridsSourcePolicyV1 =
  Object.freeze({
    expectedDirectories: Object.freeze([
      "external_data",
      "project_data",
      "project_data/log",
      "project_data/model",
    ]),
    expectedFiles: Object.freeze([
      Object.freeze({
        relativePath: "2026-05-31-101837.xbin",
        sizeBytes: 41_095_196_672,
        sha256: "42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
      }),
      Object.freeze({
        relativePath: "project_data/control_points.csv",
        sizeBytes: 0,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      }),
      Object.freeze({
        relativePath: "project_data/gnss.csv",
        sizeBytes: 6_077_731,
        sha256: "ba1baa1b9c1720f7785b84ecebeec0b1d620287672d6bb97ed6bdb43fb54d476",
      }),
      Object.freeze({
        relativePath: "project_data/log/data.ulg",
        sizeBytes: 56_123_435,
        sha256: "ad5a5d1a110fe4adefa1cbca4da1c84e4db40aa94cfa2b854df368621b4bce8c",
      }),
      Object.freeze({
        relativePath: "project_data/log/lixel.zip",
        sizeBytes: 120_042_466,
        sha256: "61b8acbb600e19176ef00a1d90a48d10e565922feb5beddd8741de135df29949",
      }),
      Object.freeze({
        relativePath: "project_data/log/project.json",
        sizeBytes: 2_415,
        sha256: "3fab1721433beb64e5a34c1916e60730195083dd0887f12db0a0f6b69035bc77",
      }),
      Object.freeze({
        relativePath: "project_data/model/hierarchy.bin",
        sizeBytes: 17_820,
        sha256: "bb11d48785f32db8f1b5eb56cb5b893aa2391cd04cad626f48dd6bb7abb25df5",
      }),
      Object.freeze({
        relativePath: "project_data/model/log.txt",
        sizeBytes: 18_917,
        sha256: "73e81b01af59410cda9d1ea21c58649bc76ca4af5967303791c434016b77d579",
      }),
      Object.freeze({
        relativePath: "project_data/model/metadata.json",
        sizeBytes: 1_301,
        sha256: "4c47093ab55432aa13194212bc6cc911a993bb7752e7f294e68ef86cf8a71252",
      }),
      Object.freeze({
        relativePath: "project_data/model/octree.bin",
        sizeBytes: 15_606_514,
        sha256: "bc7fe85d445cbf75b6734952b48be4b9bd01bac6a0641e0cf07b5ba766e603ca",
      }),
      Object.freeze({
        relativePath: "project_data/poses.csv",
        sizeBytes: 3_659_287,
        sha256: "b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127",
      }),
      Object.freeze({
        relativePath: "project_data/preview_photo.jpg",
        sizeBytes: 250_426,
        sha256: "8c28a341d540be467953f40c4029daad71e86983f2609e537aaf5168200de984",
      }),
    ]),
    expectedTotalBytes: 41_296_996_984,
    xbinRelativePath: "2026-05-31-101837.xbin",
    projectJsonRelativePath: "project_data/log/project.json",
    posesRelativePath: "project_data/poses.csv",
  });

export type GrandHallXgridsPreflightErrorCode =
  | "SOURCE_ARGUMENT_INVALID"
  | "SOURCE_PATH_NOT_ABSOLUTE"
  | "SOURCE_REMOTE_OR_DEVICE_PATH_REJECTED"
  | "SOURCE_ROOT_UNAVAILABLE"
  | "SOURCE_ROOT_NOT_DIRECTORY"
  | "SOURCE_PATH_INDIRECT"
  | "SOURCE_TREE_UNSAFE"
  | "SOURCE_TREE_MISMATCH"
  | "SOURCE_FILE_HARDLINKED"
  | "SOURCE_FILE_SIZE_MISMATCH"
  | "SOURCE_FILE_DIGEST_MISMATCH"
  | "SOURCE_CHANGED"
  | "XBIN_SIGNATURE_MISMATCH"
  | "PORTALCAM_METADATA_INVALID"
  | "PORTALCAM_METADATA_MISMATCH"
  | "POSES_ENCODING_INVALID"
  | "POSES_FORMAT_INVALID"
  | "POSES_FACTS_MISMATCH";

export class GrandHallXgridsPreflightError extends Error {
  public readonly code: GrandHallXgridsPreflightErrorCode;

  public constructor(
    code: GrandHallXgridsPreflightErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallXgridsPreflightError";
    this.code = code;
  }
}

interface TreeEntryIdentity {
  readonly kind: "directory" | "file";
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}

interface TreeSnapshot {
  readonly root: string;
  readonly rootIdentity: TreeEntryIdentity;
  readonly entries: ReadonlyMap<string, TreeEntryIdentity>;
}

export interface GrandHallPortalCamFactsV1 {
  readonly metadataRelativePath: "project_data/log/project.json";
  readonly metadataSha256: string;
  readonly metadataSizeBytes: 2_415;
  readonly deviceModel: "PortalCam";
  readonly deviceType: "AA";
  readonly scanMode: "LCC";
  readonly cameraList: readonly ["left_main", "left_seco", "right_main", "right_seco"];
  readonly projectScanMode: 1;
  readonly projectTimestampMilliseconds: "1780219117200";
  readonly projectScanTimeSeconds: 4_402;
  readonly softwareVersion: "V3.2.1_20250829.122027";
  readonly algorithmVersion: "v2.1.2.20250828.beta";
  readonly timeZone: "Europe/London";
  readonly privateDeviceIdentifiersEmitted: false;
}

export interface GrandHallPoseFactsV1 {
  readonly relativePath: "project_data/poses.csv";
  readonly sha256: string;
  readonly sizeBytes: 3_659_287;
  readonly rowCount: 42_850;
  readonly columnCount: 8;
  readonly timestampUnit: "seconds";
  readonly firstTimestampMicroseconds: "1780219119879549";
  readonly lastTimestampMicroseconds: "1780223405502131";
  readonly durationMicroseconds: "4285622582";
  readonly durationSecondsDecimal: "4285.622582";
  readonly timestampsStrictlyIncreasing: true;
}

export interface GrandHallXgridsVerifiedSourceV1 {
  readonly locator: "XGRIDS_CAPTURE_ROOT";
  readonly readMode: "read_only";
  readonly sourceMutationPermitted: false;
  readonly fileCount: 12;
  readonly directoryCount: 4;
  readonly totalBytes: 41_296_996_984;
  readonly files: readonly XgridsExpectedFileV1[];
  readonly inventorySha256: string;
  readonly xbin: {
    readonly relativePath: "2026-05-31-101837.xbin";
    readonly signatureHex: "58424147";
    readonly signatureAscii: "XBAG";
  };
  readonly portalCam: GrandHallPortalCamFactsV1;
  readonly poses: GrandHallPoseFactsV1;
  readonly proof: {
    readonly exactAllowlistedTree: true;
    readonly noLinkedOrHardlinkedFiles: true;
    readonly everyFileSizeAndSha256Matched: true;
    readonly allFilesStableDuringRead: true;
    readonly sourceWrites: "none";
    readonly networkAccess: "none";
  };
}

export interface GrandHallGpuObservationV1 {
  readonly state: "observed" | "unavailable";
  readonly gpuCount: number | null;
  readonly name: string | null;
  readonly memoryMiB: number | null;
  readonly driverVersion: string | null;
  readonly computeCapability: number | null;
  readonly query: "nvidia_smi_fixed_read_only_query";
}

export interface GrandHallScratchObservationV1 {
  readonly state: "observed" | "unavailable";
  readonly locator: "SCRATCH_ROOT";
  readonly freeBytes: number | null;
  readonly fileSystem: string | null;
  readonly driveType: string | null;
  readonly busType: string | null;
  readonly healthStatus: string | null;
  readonly operationalStatus: string | null;
  readonly diskCount: number | null;
  readonly directoryEmpty: boolean | null;
  readonly writeAccessCheck: "passed" | "failed" | "not_run";
  readonly writeBenchmarkPerformed: false;
}

export interface GrandHallLccObservationV1 {
  readonly state: "observed" | "unavailable";
  readonly locator: "LCC_INSTALL_ROOT";
  readonly executable: {
    readonly relativePath: "LccStudio.exe";
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null;
  readonly versionFile: {
    readonly relativePath: "build/version.json";
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null;
  readonly reportedInternalVersion: string | null;
  readonly releaseCompatibilityReview:
    | "reviewed_lcc_studio_2_3_or_newer"
    | "required_not_recorded";
  readonly futureSettingsEvidence: {
    readonly creatorDataEnabled: "required_not_recorded";
    readonly nvidiaNcoreDataSelected: "required_not_recorded";
    readonly pointCloudPreviewAccepted: "required_not_recorded";
    readonly lccResourceEstimatorAccepted: "required_not_recorded";
    readonly intelligentSpaceRecognitionDisabled: "required_not_recorded";
    readonly reconstructionConfigurationReviewed: "required_not_recorded";
  };
}

export interface GrandHallXgridsMachineObservationV1 {
  readonly platform: string;
  readonly architecture: string;
  readonly totalPhysicalMemoryBytes: number;
  readonly gpu: GrandHallGpuObservationV1;
  readonly scratch: GrandHallScratchObservationV1;
  readonly lcc: GrandHallLccObservationV1;
}

export const GRAND_HALL_XGRIDS_PREFLIGHT_BLOCKER_CODES = Object.freeze([
  "PLATFORM_WINDOWS_X64_REQUIRED",
  "RAM_128_GIB_REQUIRED",
  "SINGLE_NVIDIA_GPU_REQUIRED",
  "GPU_COMPUTE_CAPABILITY_ABOVE_7_5_REQUIRED",
  "GPU_MEMORY_24000_MIB_REQUIRED",
  "GPU_DRIVER_581_90_REQUIRED",
  "SCRATCH_OBSERVATION_REQUIRED",
  "SCRATCH_LOCAL_FIXED_DRIVE_REQUIRED",
  "SCRATCH_NVME_REQUIRED",
  "SCRATCH_HEALTHY_REQUIRED",
  "SCRATCH_NTFS_OR_REFS_REQUIRED",
  "SCRATCH_500_GIB_FREE_REQUIRED",
  "SCRATCH_EMPTY_DIRECTORY_REQUIRED",
  "SCRATCH_WRITE_ACCESS_REQUIRED",
  "LCC_INSTALLATION_OBSERVATION_REQUIRED",
  "LCC_2_3_OR_NEWER_REVIEW_REQUIRED",
] as const);

export type GrandHallXgridsPreflightBlockerCode =
  (typeof GRAND_HALL_XGRIDS_PREFLIGHT_BLOCKER_CODES)[number];

export interface GrandHallXgridsPreflightDecisionV1 {
  readonly status: "blocked" | "eligible_for_lcc_estimator_only";
  readonly blockers: readonly GrandHallXgridsPreflightBlockerCode[];
  readonly lccEstimatorEligible: boolean;
  readonly lccLaunchPerformed: false;
  readonly reconstructionAuthorized: false;
  readonly trainingAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly stagingAuthorized: false;
  readonly publicationAuthorized: false;
  readonly outputAuthority: "diagnostic_preflight_only";
  readonly captureDurationRiskBand:
    "above_128_gib_60_minute_reliable_reference_below_90_minute_risk_reference";
  readonly futureReconstructionGates: readonly [
    "creator_data_setting_evidence",
    "nvidia_ncore_selection_evidence",
    "point_cloud_preview_human_acceptance",
    "lcc_resource_estimator_acceptance",
    "reviewed_reconstruction_configuration",
  ];
}

export interface GrandHallXgridsLccPreflightReceiptMaterialV1 {
  readonly schemaVersion: typeof GRAND_HALL_XGRIDS_LCC_PREFLIGHT_V1;
  readonly venueSlug: "trades-hall";
  readonly roomSlug: "grand-hall";
  readonly membershipEvidenceSha256: typeof GRAND_HALL_ROOM_MEMBERSHIP_SHA256;
  readonly authority: "none";
  readonly source: GrandHallXgridsVerifiedSourceV1;
  readonly machine: GrandHallXgridsMachineObservationV1;
  readonly decision: GrandHallXgridsPreflightDecisionV1;
  readonly proof: {
    readonly absolutePathsSerialized: false;
    readonly privateDeviceIdentifiersSerialized: false;
    readonly sourceWrites: "none";
    readonly reconstructionProcessSpawned: false;
  };
}

export interface GrandHallXgridsLccPreflightReceiptV1
  extends GrandHallXgridsLccPreflightReceiptMaterialV1 {
  readonly receiptSha256: string;
}

export type GrandHallXgridsSourceHashFunction = (input: {
  readonly absolutePath: string;
  readonly expectedIdentity: ExpectedRegularFileIdentity;
  readonly headBytes: number;
  readonly captureContents: boolean;
  readonly signal?: AbortSignal;
}) => Promise<{
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly headBytes: Uint8Array;
  readonly capturedContents: Uint8Array | null;
}>;

export interface VerifyXgridsSourceOptionsV1 {
  readonly sourceRoot: string;
  /** @internal Allows small synthetic source trees only under NODE_ENV=test. */
  readonly testOnlyPolicy?: XgridsSourcePolicyV1;
  readonly hashFile?: GrandHallXgridsSourceHashFunction;
  readonly signal?: AbortSignal;
}

function fail(
  code: GrandHallXgridsPreflightErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallXgridsPreflightError(code, message, cause);
}

function comparablePath(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function pathContainsLexicalTraversal(value: string): boolean {
  const withoutDrive = /^[A-Za-z]:/u.test(value) ? value.slice(2) : value;
  return withoutDrive.split(/[\\/]+/u).some((part) => part === "." || part === "..");
}

function validateAbsoluteLocalRoot(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return fail("SOURCE_ARGUMENT_INVALID", "The XGRIDS source root must be a non-empty local path.");
  }
  if (!isAbsolute(value)) {
    return fail("SOURCE_PATH_NOT_ABSOLUTE", "The XGRIDS source root must be absolute.");
  }
  if (pathContainsLexicalTraversal(value)) {
    return fail("SOURCE_PATH_INDIRECT", "The XGRIDS source root cannot contain dot traversal segments.");
  }
  if (process.platform === "win32") {
    const windows = value.replaceAll("/", "\\");
    if (
      windows.startsWith("\\\\") ||
      windows.startsWith("\\?\\") ||
      windows.startsWith("\\.\\") ||
      !/^[A-Za-z]:\\/u.test(windows) ||
      windows.slice(2).includes(":")
    ) {
      return fail(
        "SOURCE_REMOTE_OR_DEVICE_PATH_REJECTED",
        "UNC, device, drive-relative, and alternate-data-stream source paths are rejected.",
      );
    }
  }
  return resolve(value);
}

function identityFromStats(stats: Stats, kind: "directory" | "file"): TreeEntryIdentity {
  return {
    kind,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    nlink: stats.nlink,
  };
}

function hashIdentity(entry: TreeEntryIdentity): ExpectedRegularFileIdentity {
  return {
    dev: entry.dev,
    ino: entry.ino,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.ctimeMs,
  };
}

function identitiesEqual(left: TreeEntryIdentity, right: TreeEntryIdentity): boolean {
  return left.kind === right.kind && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs && left.nlink === right.nlink;
}

function safeRelativePath(root: string, absolutePath: string): string {
  const value = relative(root, absolutePath).split(sep).join("/");
  if (
    value.length === 0 || value.startsWith("../") || value === ".." ||
    value.startsWith("/") || value.includes("\0") || value !== value.normalize("NFC")
  ) {
    return fail("SOURCE_TREE_UNSAFE", "The XGRIDS source tree contains an unsafe path.");
  }
  return value;
}

async function inspectEntry(root: string, absolutePath: string): Promise<TreeEntryIdentity> {
  let stats: Stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error: unknown) {
    return fail("SOURCE_ROOT_UNAVAILABLE", "The XGRIDS source tree is unavailable.", error);
  }
  if (stats.isSymbolicLink()) {
    return fail("SOURCE_PATH_INDIRECT", "The XGRIDS source tree contains a symbolic link or junction.");
  }
  const kind = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null;
  if (kind === null) {
    return fail("SOURCE_TREE_UNSAFE", "The XGRIDS source tree contains a non-regular entry.");
  }
  if (kind === "file" && stats.nlink !== 1) {
    return fail("SOURCE_FILE_HARDLINKED", "The XGRIDS source tree contains a hard-linked file.");
  }
  let canonical: string;
  try {
    canonical = await realpath(absolutePath);
  } catch (error: unknown) {
    return fail("SOURCE_ROOT_UNAVAILABLE", "The XGRIDS source tree cannot be resolved safely.", error);
  }
  if (
    comparablePath(canonical) !== comparablePath(absolutePath) ||
    (comparablePath(absolutePath) !== comparablePath(root) &&
      !comparablePath(absolutePath).startsWith(`${comparablePath(root)}${sep}`))
  ) {
    return fail("SOURCE_PATH_INDIRECT", "The XGRIDS source tree resolves indirectly or escapes its root.");
  }
  return identityFromStats(stats, kind);
}

async function snapshotTree(rootInput: string): Promise<TreeSnapshot> {
  const root = validateAbsoluteLocalRoot(rootInput);
  const rootIdentity = await inspectEntry(root, root);
  if (rootIdentity.kind !== "directory") {
    return fail("SOURCE_ROOT_NOT_DIRECTORY", "The XGRIDS source root must be a directory.");
  }
  const entries = new Map<string, TreeEntryIdentity>();
  const folded = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error: unknown) {
      return fail("SOURCE_ROOT_UNAVAILABLE", "The XGRIDS source tree cannot be enumerated.", error);
    }
    names.sort((left, right) => left.localeCompare(right, "en-US"));
    for (const name of names) {
      const absolutePath = resolve(directory, name);
      const relativePath = safeRelativePath(root, absolutePath);
      const foldedPath = relativePath.toLocaleLowerCase("en-US");
      const collision = folded.get(foldedPath);
      if (collision !== undefined) {
        return fail("SOURCE_TREE_UNSAFE", "The XGRIDS source tree contains a case-colliding path.");
      }
      folded.set(foldedPath, relativePath);
      const identity = await inspectEntry(root, absolutePath);
      entries.set(relativePath, identity);
      if (identity.kind === "directory") await visit(absolutePath);
    }
  };
  await visit(root);
  return { root, rootIdentity, entries };
}

function assertTreeMatchesPolicy(snapshot: TreeSnapshot, policy: XgridsSourcePolicyV1): void {
  const expectedDirectories = [...policy.expectedDirectories].sort();
  const expectedFiles = [...policy.expectedFiles].map((file) => file.relativePath).sort();
  const actualDirectories = [...snapshot.entries]
    .filter(([, identity]) => identity.kind === "directory")
    .map(([path]) => path)
    .sort();
  const actualFiles = [...snapshot.entries]
    .filter(([, identity]) => identity.kind === "file")
    .map(([path]) => path)
    .sort();
  if (
    JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories) ||
    JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)
  ) {
    return fail("SOURCE_TREE_MISMATCH", "The XGRIDS source tree does not match the exact allowlist.");
  }
  const total = policy.expectedFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (!Number.isSafeInteger(total) || total !== policy.expectedTotalBytes) {
    return fail("SOURCE_TREE_MISMATCH", "The XGRIDS source policy has inconsistent byte totals.");
  }
  for (const file of policy.expectedFiles) {
    const actual = snapshot.entries.get(file.relativePath);
    if (actual?.kind !== "file") {
      return fail("SOURCE_TREE_MISMATCH", "An expected XGRIDS source file is missing.");
    }
    if (actual.size !== file.sizeBytes) {
      return fail("SOURCE_FILE_SIZE_MISMATCH", "An XGRIDS source file has the wrong byte length.");
    }
  }
}

function snapshotsEqual(left: TreeSnapshot, right: TreeSnapshot): boolean {
  if (!identitiesEqual(left.rootIdentity, right.rootIdentity) || left.entries.size !== right.entries.size) {
    return false;
  }
  for (const [path, identity] of left.entries) {
    const other = right.entries.get(path);
    if (other === undefined || !identitiesEqual(identity, other)) return false;
  }
  return true;
}

const defaultHashFile: GrandHallXgridsSourceHashFunction = async (input) => {
  const expectedSize = input.expectedIdentity.size;
  const captured = input.captureContents ? Buffer.allocUnsafe(expectedSize) : null;
  const digest = await sha256RegularFileWithHead(
    input.absolutePath,
    input.headBytes,
    input.expectedIdentity,
    input.signal,
    captured === null
      ? undefined
      : (chunk, offset) => {
          Buffer.from(chunk).copy(captured, offset);
        },
  );
  return {
    sha256: digest.sha256,
    sizeBytes: digest.sizeBytes,
    headBytes: digest.headBytes,
    capturedContents: captured,
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectMember(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const member = value[key];
  if (!isRecord(member)) return fail("PORTALCAM_METADATA_INVALID", "PortalCam metadata has an invalid object member.");
  return member;
}

function parsePortalCamFacts(bytes: Uint8Array, sha256: string): GrandHallPortalCamFactsV1 {
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff || text.includes("\0")) throw new Error("invalid encoding");
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    return fail("PORTALCAM_METADATA_INVALID", "PortalCam project metadata is not strict UTF-8 JSON.", error);
  }
  if (!isRecord(parsed)) return fail("PORTALCAM_METADATA_INVALID", "PortalCam project metadata must be an object.");
  const device = objectMember(parsed, "DeviceInfo");
  const project = objectMember(parsed, "ProjectInfo");
  const cameras = device.CameraList;
  const expectedCameras = ["left_main", "left_seco", "right_main", "right_seco"];
  if (
    device.DeviceModel !== "PortalCam" || device.DeviceType !== "AA" ||
    device.ScanMode !== "LCC" || !Array.isArray(cameras) ||
    JSON.stringify(cameras) !== JSON.stringify(expectedCameras) ||
    project.ScanMode !== 1 || project.Timestamp !== 1_780_219_117_200 ||
    project.ScanTime !== 4_402 || device.SoftwareVersion !== "V3.2.1_20250829.122027" ||
    device.AlgorithmVersion !== "v2.1.2.20250828.beta" || device.TimeZone !== "Europe/London"
  ) {
    return fail("PORTALCAM_METADATA_MISMATCH", "PortalCam metadata does not match the bound capture facts.");
  }
  return Object.freeze({
    metadataRelativePath: "project_data/log/project.json",
    metadataSha256: `sha256:${sha256}`,
    metadataSizeBytes: 2_415,
    deviceModel: "PortalCam",
    deviceType: "AA",
    scanMode: "LCC",
    cameraList: Object.freeze([
      "left_main",
      "left_seco",
      "right_main",
      "right_seco",
    ] as const),
    projectScanMode: 1,
    projectTimestampMilliseconds: "1780219117200",
    projectScanTimeSeconds: 4_402,
    softwareVersion: "V3.2.1_20250829.122027",
    algorithmVersion: "v2.1.2.20250828.beta",
    timeZone: "Europe/London",
    privateDeviceIdentifiersEmitted: false,
  });
}

const DECIMAL_SIX = /^-?(?:0|[1-9][0-9]*)\.[0-9]{6}$/u;
const POSITIVE_TIMESTAMP = /^(?:0|[1-9][0-9]*)\.[0-9]{6}$/u;

function timestampMicroseconds(value: string): bigint {
  const [seconds, fraction] = value.split(".");
  if (seconds === undefined || fraction === undefined) {
    return fail("POSES_FORMAT_INVALID", "A pose timestamp is malformed.");
  }
  return BigInt(seconds) * 1_000_000n + BigInt(fraction);
}

function parsePoseFacts(bytes: Uint8Array, sha256: string): GrandHallPoseFactsV1 {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    return fail("POSES_ENCODING_INVALID", "The pose trajectory is not valid UTF-8.", error);
  }
  if (text.length === 0 || text.charCodeAt(0) === 0xfeff || text.includes("\0") || text.includes("\r")) {
    return fail("POSES_ENCODING_INVALID", "The pose trajectory must be BOM-free LF-delimited UTF-8.");
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (lines.length !== 42_850 || lines.some((line) => line.length === 0 || line.length > 512)) {
    return fail("POSES_FACTS_MISMATCH", "The pose trajectory row count or line bounds do not match.");
  }
  let previous: bigint | null = null;
  let first: bigint | null = null;
  let last: bigint | null = null;
  for (const line of lines) {
    const fields = line.split(",");
    if (
      fields.length !== 8 || !POSITIVE_TIMESTAMP.test(fields[0] ?? "") ||
      fields.slice(1).some((field) => !DECIMAL_SIX.test(field) || !Number.isFinite(Number(field)))
    ) {
      return fail("POSES_FORMAT_INVALID", "The pose trajectory must contain eight bounded decimal columns.");
    }
    const current = timestampMicroseconds(fields[0] ?? "");
    if (previous !== null && current <= previous) {
      return fail("POSES_FORMAT_INVALID", "Pose timestamps must be strictly increasing.");
    }
    first ??= current;
    previous = current;
    last = current;
  }
  if (
    first !== 1_780_219_119_879_549n || last !== 1_780_223_405_502_131n ||
    last - first !== 4_285_622_582n
  ) {
    return fail("POSES_FACTS_MISMATCH", "The pose trajectory endpoints or duration do not match.");
  }
  return Object.freeze({
    relativePath: "project_data/poses.csv",
    sha256: `sha256:${sha256}`,
    sizeBytes: 3_659_287,
    rowCount: 42_850,
    columnCount: 8,
    timestampUnit: "seconds",
    firstTimestampMicroseconds: "1780219119879549",
    lastTimestampMicroseconds: "1780223405502131",
    durationMicroseconds: "4285622582",
    durationSecondsDecimal: "4285.622582",
    timestampsStrictlyIncreasing: true,
  });
}

function computeInventorySha256(files: readonly XgridsExpectedFileV1[]): string {
  return `sha256:${domainSeparatedSha256(
    "OMNITWIN_GRAND_HALL_XGRIDS_SOURCE_INVENTORY_V1",
    toCanonicalJson(files),
  )}`;
}

export async function verifyGrandHallXgridsSource(
  options: VerifyXgridsSourceOptionsV1,
): Promise<GrandHallXgridsVerifiedSourceV1> {
  if (options.testOnlyPolicy !== undefined && process.env.NODE_ENV !== "test") {
    return fail("SOURCE_ARGUMENT_INVALID", "A synthetic source policy is forbidden outside tests.");
  }
  const policy = options.testOnlyPolicy ?? GRAND_HALL_XGRIDS_SOURCE_POLICY_V1;
  const before = await snapshotTree(options.sourceRoot);
  assertTreeMatchesPolicy(before, policy);
  const hashFile = options.hashFile ?? defaultHashFile;
  let xbinHead: Uint8Array | null = null;
  let projectBytes: Uint8Array | null = null;
  let posesBytes: Uint8Array | null = null;
  for (const expected of policy.expectedFiles) {
    if (options.signal?.aborted === true) {
      return fail("SOURCE_CHANGED", "The read-only XGRIDS verification was cancelled.");
    }
    const identity = before.entries.get(expected.relativePath);
    if (identity?.kind !== "file") return fail("SOURCE_TREE_MISMATCH", "An expected source file disappeared.");
    let digest: Awaited<ReturnType<GrandHallXgridsSourceHashFunction>>;
    try {
      digest = await hashFile({
        absolutePath: resolve(before.root, ...expected.relativePath.split("/")),
        expectedIdentity: hashIdentity(identity),
        headBytes: expected.relativePath === policy.xbinRelativePath ? 4 : 0,
        captureContents:
          expected.relativePath === policy.projectJsonRelativePath ||
          expected.relativePath === policy.posesRelativePath,
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (error instanceof GrandHallXgridsPreflightError) throw error;
      return fail("SOURCE_CHANGED", "A source file changed or became unreadable during verification.", error);
    }
    if (digest.sizeBytes !== expected.sizeBytes) {
      return fail("SOURCE_FILE_SIZE_MISMATCH", "A source file byte length changed during hashing.");
    }
    if (digest.sha256 !== expected.sha256) {
      return fail("SOURCE_FILE_DIGEST_MISMATCH", "A source file SHA-256 does not match the exact policy.");
    }
    if (expected.relativePath === policy.xbinRelativePath) xbinHead = digest.headBytes;
    if (expected.relativePath === policy.projectJsonRelativePath) projectBytes = digest.capturedContents;
    if (expected.relativePath === policy.posesRelativePath) posesBytes = digest.capturedContents;
  }
  const after = await snapshotTree(before.root);
  if (!snapshotsEqual(before, after)) {
    return fail("SOURCE_CHANGED", "The XGRIDS source tree changed during verification.");
  }
  if (xbinHead === null || Buffer.from(xbinHead).toString("hex") !== "58424147") {
    return fail("XBIN_SIGNATURE_MISMATCH", "The XBIN source does not begin with the exact XBAG signature.");
  }
  if (projectBytes === null || posesBytes === null) {
    return fail("SOURCE_CHANGED", "Digest-bound metadata bytes were not captured from the source handles.");
  }
  const portalCam = parsePortalCamFacts(projectBytes, policy.expectedFiles.find(
    (file) => file.relativePath === policy.projectJsonRelativePath,
  )?.sha256 ?? "");
  const poses = parsePoseFacts(posesBytes, policy.expectedFiles.find(
    (file) => file.relativePath === policy.posesRelativePath,
  )?.sha256 ?? "");
  const source: GrandHallXgridsVerifiedSourceV1 = {
    locator: "XGRIDS_CAPTURE_ROOT",
    readMode: "read_only",
    sourceMutationPermitted: false,
    fileCount: 12,
    directoryCount: 4,
    totalBytes: 41_296_996_984,
    files: Object.freeze(policy.expectedFiles.map((file) => Object.freeze({ ...file }))),
    inventorySha256: computeInventorySha256(policy.expectedFiles),
    xbin: {
      relativePath: "2026-05-31-101837.xbin",
      signatureHex: "58424147",
      signatureAscii: "XBAG",
    },
    portalCam,
    poses,
    proof: {
      exactAllowlistedTree: true,
      noLinkedOrHardlinkedFiles: true,
      everyFileSizeAndSha256Matched: true,
      allFilesStableDuringRead: true,
      sourceWrites: "none",
      networkAccess: "none",
    },
  };
  return deepFreeze(source);
}

function numericVersionAtLeast(actual: string, minimum: string): boolean {
  const parse = (value: string): number[] | null => {
    if (!/^[0-9]+(?:\.[0-9]+)+$/u.test(value)) return null;
    return value.split(".").map(Number);
  };
  const left = parse(actual);
  const right = parse(minimum);
  if (left === null || right === null) return false;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function evaluateBlockers(
  machine: GrandHallXgridsMachineObservationV1,
): GrandHallXgridsPreflightBlockerCode[] {
  const blockers: GrandHallXgridsPreflightBlockerCode[] = [];
  const add = (condition: boolean, code: GrandHallXgridsPreflightBlockerCode): void => {
    if (condition) blockers.push(code);
  };
  add(machine.platform !== "win32" || machine.architecture !== "x64", "PLATFORM_WINDOWS_X64_REQUIRED");
  add(
    !Number.isSafeInteger(machine.totalPhysicalMemoryBytes) ||
      machine.totalPhysicalMemoryBytes < GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
    "RAM_128_GIB_REQUIRED",
  );
  const gpu = machine.gpu;
  add(gpu.state !== "observed" || gpu.gpuCount !== 1 || gpu.name?.startsWith("NVIDIA ") !== true,
    "SINGLE_NVIDIA_GPU_REQUIRED");
  add(gpu.computeCapability === null || gpu.computeCapability <= GRAND_HALL_XGRIDS_MINIMUM_COMPUTE_CAPABILITY_EXCLUSIVE,
    "GPU_COMPUTE_CAPABILITY_ABOVE_7_5_REQUIRED");
  add(gpu.memoryMiB === null || gpu.memoryMiB < GRAND_HALL_XGRIDS_MINIMUM_GPU_MEMORY_MIB,
    "GPU_MEMORY_24000_MIB_REQUIRED");
  add(gpu.driverVersion === null || !numericVersionAtLeast(gpu.driverVersion, GRAND_HALL_XGRIDS_MINIMUM_DRIVER_VERSION),
    "GPU_DRIVER_581_90_REQUIRED");
  const scratch = machine.scratch;
  add(scratch.state !== "observed", "SCRATCH_OBSERVATION_REQUIRED");
  add(scratch.driveType !== "Fixed", "SCRATCH_LOCAL_FIXED_DRIVE_REQUIRED");
  add(scratch.busType !== "NVMe", "SCRATCH_NVME_REQUIRED");
  add(scratch.healthStatus !== "Healthy" || scratch.operationalStatus !== "Online" || scratch.diskCount !== 1,
    "SCRATCH_HEALTHY_REQUIRED");
  add(scratch.fileSystem !== "NTFS" && scratch.fileSystem !== "ReFS", "SCRATCH_NTFS_OR_REFS_REQUIRED");
  add(scratch.freeBytes === null || scratch.freeBytes < GRAND_HALL_XGRIDS_MINIMUM_SCRATCH_FREE_BYTES,
    "SCRATCH_500_GIB_FREE_REQUIRED");
  add(scratch.directoryEmpty !== true, "SCRATCH_EMPTY_DIRECTORY_REQUIRED");
  add(scratch.writeAccessCheck !== "passed", "SCRATCH_WRITE_ACCESS_REQUIRED");
  add(machine.lcc.state !== "observed", "LCC_INSTALLATION_OBSERVATION_REQUIRED");
  add(machine.lcc.releaseCompatibilityReview !== "reviewed_lcc_studio_2_3_or_newer",
    "LCC_2_3_OR_NEWER_REVIEW_REQUIRED");
  return blockers;
}

export function evaluateGrandHallXgridsPreflight(
  machine: GrandHallXgridsMachineObservationV1,
): GrandHallXgridsPreflightDecisionV1 {
  const blockers = Object.freeze(evaluateBlockers(machine));
  const eligible = blockers.length === 0;
  return Object.freeze({
    status: eligible ? "eligible_for_lcc_estimator_only" : "blocked",
    blockers,
    lccEstimatorEligible: eligible,
    lccLaunchPerformed: false,
    reconstructionAuthorized: false,
    trainingAuthorized: false,
    runtimeAuthorized: false,
    stagingAuthorized: false,
    publicationAuthorized: false,
    outputAuthority: "diagnostic_preflight_only",
    captureDurationRiskBand:
      "above_128_gib_60_minute_reliable_reference_below_90_minute_risk_reference",
    futureReconstructionGates: Object.freeze([
      "creator_data_setting_evidence",
      "nvidia_ncore_selection_evidence",
      "point_cloud_preview_human_acceptance",
      "lcc_resource_estimator_acceptance",
      "reviewed_reconstruction_configuration",
    ] as const),
  });
}

export function createGrandHallXgridsLccPreflightReceipt(
  source: GrandHallXgridsVerifiedSourceV1,
  machine: GrandHallXgridsMachineObservationV1,
): GrandHallXgridsLccPreflightReceiptV1 {
  const material: GrandHallXgridsLccPreflightReceiptMaterialV1 = {
    schemaVersion: GRAND_HALL_XGRIDS_LCC_PREFLIGHT_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    membershipEvidenceSha256: GRAND_HALL_ROOM_MEMBERSHIP_SHA256,
    authority: "none",
    source,
    machine,
    decision: evaluateGrandHallXgridsPreflight(machine),
    proof: {
      absolutePathsSerialized: false,
      privateDeviceIdentifiersSerialized: false,
      sourceWrites: "none",
      reconstructionProcessSpawned: false,
    },
  };
  const frozenMaterial = deepFreeze(material);
  return deepFreeze({
    ...frozenMaterial,
    receiptSha256: `sha256:${domainSeparatedSha256(
      GRAND_HALL_XGRIDS_LCC_PREFLIGHT_RECEIPT_DOMAIN,
      toCanonicalJson(frozenMaterial),
    )}`,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) deepFreeze(Reflect.get(object, key), seen);
  return Object.freeze(value);
}
