import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  domainSeparatedSha256,
  FoundryIntegrityError,
  sha256RegularFileWithHead,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  FoundryGrandHallRoomMembershipV1Schema,
  type FoundryGrandHallRoomMembershipV1,
} from "@omnitwin/types";
import sharp from "sharp";

export const GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-panorama-review.v1";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_PANORAMA_INVENTORY_V1";
export const GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_PANORAMA_REVIEW_MANIFEST_V1";
export const GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR = "MATTERPORT_PANORAMA_ROOT";
export const GRAND_HALL_T554_PREVIEW_SOURCE_LOCATOR = "E57_PREVIEW_EVIDENCE_ROOT";
export const GRAND_HALL_T554_CEILING_PLAN_SOURCE_LOCATOR =
  "MATTERPAK_SOURCE_ROOT/ceilingcolorplan_001.jpg";
export const GRAND_HALL_T554_EXPECTED_SOURCE_FILE_COUNT = 148;
export const GRAND_HALL_T554_EXPECTED_WIDTH_PX = 8_192;
export const GRAND_HALL_T554_EXPECTED_HEIGHT_PX = 4_096;
export const GRAND_HALL_T554_EXPECTED_PREVIEW_WIDTH_PX = 512;
export const GRAND_HALL_T554_EXPECTED_PREVIEW_HEIGHT_PX = 256;
export const GRAND_HALL_T554_MEMBERSHIP_SHA256 =
  "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68";
export const GRAND_HALL_T554_CEILING_PLAN_SHA256 =
  "sha256:e94e9d6389000ea18d64aa875e2af75ee88ad31d4df970d449b99a2591f6064a";
export const GRAND_HALL_T554_CEILING_PLAN_BYTE_LENGTH = 1_982_157;
export const GRAND_HALL_T554_CEILING_PLAN_WIDTH_PX = 2_893;
export const GRAND_HALL_T554_CEILING_PLAN_HEIGHT_PX = 2_746;
export const GRAND_HALL_T554_OVERVIEW_FILENAME =
  "panorama-candidate-overview-review-only.png";
export const GRAND_HALL_T554_CROSSWALK_FILENAME =
  "panorama-crosswalk-six-review-only.png";
export const GRAND_HALL_T554_MANIFEST_FILENAME =
  "panorama-review-manifest-authority-none.json";

const GRAND_HALL_T554_REVIEW_OUTPUT_FILE_NAMES = Object.freeze([
  GRAND_HALL_T554_OVERVIEW_FILENAME,
  GRAND_HALL_T554_CROSSWALK_FILENAME,
] as const);

const JPEG_INSPECTION_HEAD_BYTES = 64 * 1024;
const MAX_JPEG_BYTES = 16 * 1024 * 1024;
const MAX_MEMBERSHIP_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_PNG_BYTES = 32 * 1024 * 1024;
const T550_CANDIDATE_COUNT = 50;
const CROSSWALK_PAIR_COUNT = 6;
const REVIEW_IMAGE_KERNEL = "lanczos3";

const EXPECTED_SOURCE_SWEEP_NUMBERS = Object.freeze(
  Array.from({ length: 149 }, (_, index) => index + 1).filter((value) => value !== 93),
);

export type GrandHallT554PanoramaReviewErrorCode =
  | "ARGUMENT_INVALID"
  | "PATH_NOT_ABSOLUTE"
  | "SOURCE_ROOT_UNSAFE"
  | "SOURCE_INVENTORY_INVALID"
  | "SOURCE_CHANGED"
  | "JPEG_INVALID"
  | "JPEG_DIMENSIONS_MISMATCH"
  | "T550_MEMBERSHIP_INVALID"
  | "T550_BINDING_MISMATCH"
  | "OUTPUT_OVERLAPS_SOURCE"
  | "OUTPUT_ALREADY_EXISTS"
  | "OUTPUT_PARENT_UNSAFE"
  | "OUTPUT_PUBLISH_FAILED"
  | "OUTPUT_VERIFICATION_FAILED"
  | "RENDER_FAILED";

export class GrandHallT554PanoramaReviewError extends Error {
  public readonly code: GrandHallT554PanoramaReviewErrorCode;

  public constructor(
    code: GrandHallT554PanoramaReviewErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554PanoramaReviewError";
    this.code = code;
  }
}

function requireSha256Digest(value: string, label: string): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_MEMBERSHIP_INVALID",
      `${label} is not a lowercase sha256 digest.`,
    );
  }
  return value as `sha256:${string}`;
}

export type GrandHallT554PanoramaNamingAnomaly =
  | "four_digit_zero_padded_sweep_id"
  | "filename_token_pg_instead_of_jpg";

export interface ParsedGrandHallT554PanoramaFilename {
  readonly sweepNumber: number;
  readonly digitToken: string;
  readonly namingAnomalies: readonly GrandHallT554PanoramaNamingAnomaly[];
}

export interface GrandHallT554StableJpegEvidence {
  readonly sourceLocator: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly mediaType: "image/jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly jpegFrame: "baseline_dct" | "extended_sequential_dct" | "progressive_dct";
  readonly jfifHeaderPresent: boolean;
  readonly stableDuringRead: true;
}

export interface GrandHallT554PanoramaInventoryFile
  extends GrandHallT554StableJpegEvidence,
    ParsedGrandHallT554PanoramaFilename {
  readonly relativePath: string;
}

export interface GrandHallT554PanoramaInventoryPolicy {
  readonly expectedFileCount: number;
  readonly expectedWidthPx: number;
  readonly expectedHeightPx: number;
  readonly expectedSweepNumbers: readonly number[];
}

export interface GrandHallT554PanoramaInventory {
  readonly sourceLocator: typeof GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly files: readonly GrandHallT554PanoramaInventoryFile[];
  readonly inventorySha256: `sha256:${string}`;
  readonly missingSweepNumbersWithin1To149: readonly number[];
  readonly readMode: "read_only";
  readonly sourceMutationPermitted: false;
  readonly networkAccess: "none";
}

export interface GrandHallT554T550RecordBinding {
  readonly scanIndex: number;
  readonly candidatePanoramaSweepNumber: number;
  readonly visualLocationInference:
    | "visually_consistent_grand_hall_interior"
    | "visually_mixed_portal_threshold"
    | "visually_consistent_adjacent_space";
  readonly allowedUse:
    | "mask_authoring_candidate_only"
    | "portal_boundary_and_mask_authoring_evidence_only"
    | "whole_frame_exclusion_and_boundary_evidence_only";
  readonly panoramaCorrespondenceState:
    | "candidate_sequence_unverified"
    | "diagnostic_pair_agent_reviewed";
  readonly pixelMaskState: "required_not_authored" | "not_applicable_whole_frame_excluded";
  readonly wholeFrameExclusionReason: "outside_room_camera_view" | null;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

export interface GrandHallT554T550Binding {
  readonly membershipSha256: `sha256:${string}`;
  readonly membershipFileSha256: `sha256:${string}`;
  readonly records: readonly GrandHallT554T550RecordBinding[];
}

interface GrandHallT554ReviewRecordBase extends GrandHallT554PanoramaInventoryFile {
  readonly authority: "none";
  readonly humanReviewState: "pending" | "unreviewed";
  readonly trainingInputPermitted: false;
  readonly reconstructionInputPermitted: false;
  readonly runtimeInputPermitted: false;
  readonly publicEvidencePermitted: false;
  readonly generatedDerivativeInputPermitted: false;
}

export interface GrandHallT554CandidateReviewRecord extends GrandHallT554ReviewRecordBase {
  readonly reviewEligibility: "t550_candidate_human_pending";
  readonly candidateScanIndex: number;
  readonly candidateMappingAuthority: "sequence_hypothesis_not_byte_lineage";
  readonly visualLocationInference: GrandHallT554T550RecordBinding["visualLocationInference"];
  readonly allowedUse: GrandHallT554T550RecordBinding["allowedUse"];
  readonly panoramaCorrespondenceState: GrandHallT554T550RecordBinding["panoramaCorrespondenceState"];
  readonly pixelMaskState: GrandHallT554T550RecordBinding["pixelMaskState"];
  readonly wholeFrameExclusionReason: GrandHallT554T550RecordBinding["wholeFrameExclusionReason"];
}

export interface GrandHallT554IneligibleReviewRecord extends GrandHallT554ReviewRecordBase {
  readonly reviewEligibility: "not_in_t550_ineligible_unreviewed";
  readonly candidateScanIndex: null;
  readonly candidateMappingAuthority: "none";
  readonly visualLocationInference: "not_reviewed";
  readonly allowedUse: "inventory_binding_only";
  readonly panoramaCorrespondenceState: "not_evaluated";
  readonly pixelMaskState: "not_authored_not_requested";
  readonly wholeFrameExclusionReason: null;
}

export type GrandHallT554PanoramaReviewRecord =
  | GrandHallT554CandidateReviewRecord
  | GrandHallT554IneligibleReviewRecord;

export interface GrandHallT554JpegInspectionTestSeam {
  readonly afterHashBeforeJpegInspection?: () => Promise<void> | void;
}

export interface CollectGrandHallT554PanoramaInventoryOptions {
  readonly sourceRoot: string;
  readonly policy?: GrandHallT554PanoramaInventoryPolicy;
  readonly testSeam?: {
    readonly beforeFinalDirectoryInventoryCheck?: () => Promise<void> | void;
  };
}

interface JpegDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly jpegFrame: GrandHallT554StableJpegEvidence["jpegFrame"];
  readonly jfifHeaderPresent: boolean;
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function isGrandHallT554PathWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return (
    fromParent === "" ||
    (!isAbsolute(fromParent) && !fromParent.startsWith(`..${sep}`) && fromParent !== "..")
  );
}

function requireAbsolutePath(path: string, label: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new GrandHallT554PanoramaReviewError("ARGUMENT_INVALID", `${label} is required.`);
  }
  if (!isAbsolute(path)) {
    throw new GrandHallT554PanoramaReviewError(
      "PATH_NOT_ABSOLUTE",
      `${label} must be an absolute local path.`,
    );
  }
  return resolve(path);
}

function mapSourceError(error: unknown, label: string): GrandHallT554PanoramaReviewError {
  if (error instanceof GrandHallT554PanoramaReviewError) return error;
  if (error instanceof FoundryIntegrityError && error.code.includes("CHANGED")) {
    return new GrandHallT554PanoramaReviewError(
      "SOURCE_CHANGED",
      `${label} changed during the read-only inspection.`,
      error,
    );
  }
  return new GrandHallT554PanoramaReviewError(
    "SOURCE_ROOT_UNSAFE",
    `${label} could not be inspected safely.`,
    error,
  );
}

async function resolveDirectDirectory(path: string, label: string): Promise<string> {
  const absolute = requireAbsolutePath(path, label);
  try {
    const before = await lstat(absolute);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new GrandHallT554PanoramaReviewError(
        "SOURCE_ROOT_UNSAFE",
        `${label} must be a direct regular directory, not a link or file.`,
      );
    }
    const canonical = await realpath(absolute);
    if (comparablePath(canonical) !== comparablePath(absolute)) {
      throw new GrandHallT554PanoramaReviewError(
        "SOURCE_ROOT_UNSAFE",
        `${label} must not resolve through an indirect path.`,
      );
    }
    return canonical;
  } catch (error) {
    throw mapSourceError(error, label);
  }
}

function readJpegDimensions(head: Uint8Array): JpegDimensions {
  if (head.length < 12 || head[0] !== 0xff || head[1] !== 0xd8) {
    throw new GrandHallT554PanoramaReviewError(
      "JPEG_INVALID",
      "Image bytes do not begin with a JPEG SOI marker.",
    );
  }
  const jfifHeaderPresent =
    head[2] === 0xff &&
    head[3] === 0xe0 &&
    head[6] === 0x4a &&
    head[7] === 0x46 &&
    head[8] === 0x49 &&
    head[9] === 0x46;
  let offset = 2;
  while (offset + 4 <= head.length) {
    while (offset < head.length && head[offset] === 0xff) offset += 1;
    if (offset >= head.length) break;
    const marker = head[offset] ?? 0;
    offset += 1;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 2 > head.length) break;
    const segmentLength = ((head[offset] ?? 0) << 8) | (head[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > head.length) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (segmentLength < 8) {
        throw new GrandHallT554PanoramaReviewError("JPEG_INVALID", "JPEG SOF is truncated.");
      }
      const heightPx = ((head[offset + 3] ?? 0) << 8) | (head[offset + 4] ?? 0);
      const widthPx = ((head[offset + 5] ?? 0) << 8) | (head[offset + 6] ?? 0);
      if (widthPx <= 0 || heightPx <= 0) {
        throw new GrandHallT554PanoramaReviewError(
          "JPEG_INVALID",
          "JPEG SOF has invalid dimensions.",
        );
      }
      const jpegFrame =
        marker === 0xc0
          ? "baseline_dct"
          : marker === 0xc1
            ? "extended_sequential_dct"
            : "progressive_dct";
      return { widthPx, heightPx, jpegFrame, jfifHeaderPresent };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  throw new GrandHallT554PanoramaReviewError(
    "JPEG_INVALID",
    `JPEG dimensions were not found within the first ${String(head.length)} bytes.`,
  );
}

export function parseGrandHallT554PanoramaFilename(
  name: string,
): ParsedGrandHallT554PanoramaFilename {
  if (name.includes("/") || name.includes("\\")) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      `Panorama filename must be a basename: ${name}`,
    );
  }
  const match = /^sweep_(\d{3,4})(jpg|pg)\.jpg$/u.exec(name);
  if (match === null) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      `Unexpected panorama filename: ${name}`,
    );
  }
  const digitToken = match[1] ?? "";
  const sweepNumber = Number.parseInt(digitToken, 10);
  if (!Number.isSafeInteger(sweepNumber) || sweepNumber < 1) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      `Panorama sweep ID must be a positive integer: ${name}`,
    );
  }
  const namingAnomalies: GrandHallT554PanoramaNamingAnomaly[] = [];
  if (digitToken.length === 4) namingAnomalies.push("four_digit_zero_padded_sweep_id");
  if (match[2] === "pg") namingAnomalies.push("filename_token_pg_instead_of_jpg");
  return { sweepNumber, digitToken, namingAnomalies };
}

export async function inspectStableGrandHallT554Jpeg(
  path: string,
  sourceLocator: string,
  testSeam?: GrandHallT554JpegInspectionTestSeam,
): Promise<GrandHallT554StableJpegEvidence> {
  let digest;
  try {
    digest = await sha256RegularFileWithHead(
      path,
      JPEG_INSPECTION_HEAD_BYTES,
      undefined,
      undefined,
      undefined,
      async () => {
        await testSeam?.afterHashBeforeJpegInspection?.();
      },
    );
  } catch (error) {
    throw mapSourceError(error, sourceLocator);
  }
  if (digest.sizeBytes <= 0 || digest.sizeBytes > MAX_JPEG_BYTES) {
    throw new GrandHallT554PanoramaReviewError(
      "JPEG_INVALID",
      `${sourceLocator} must be between 1 byte and ${String(MAX_JPEG_BYTES)} bytes.`,
    );
  }
  const dimensions = readJpegDimensions(digest.headBytes);
  return {
    sourceLocator,
    byteLength: digest.sizeBytes,
    sha256: `sha256:${digest.sha256}`,
    mediaType: "image/jpeg",
    ...dimensions,
    stableDuringRead: true,
  };
}

function panoramaInventoryDigestMaterial(
  files: readonly GrandHallT554PanoramaInventoryFile[],
): readonly object[] {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sweepNumber: file.sweepNumber,
    digitToken: file.digitToken,
    namingAnomalies: file.namingAnomalies,
    byteLength: file.byteLength,
    sha256: file.sha256,
    mediaType: file.mediaType,
    widthPx: file.widthPx,
    heightPx: file.heightPx,
    jpegFrame: file.jpegFrame,
    jfifHeaderPresent: file.jfifHeaderPresent,
  }));
}

export function computeGrandHallT554PanoramaInventorySha256(
  files: readonly GrandHallT554PanoramaInventoryFile[],
): `sha256:${string}` {
  return `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_INVENTORY_DOMAIN,
    toCanonicalJson(panoramaInventoryDigestMaterial(files)),
  )}`;
}

function validateInventoryPolicy(policy: GrandHallT554PanoramaInventoryPolicy): void {
  if (
    !Number.isSafeInteger(policy.expectedFileCount) ||
    policy.expectedFileCount <= 0 ||
    !Number.isSafeInteger(policy.expectedWidthPx) ||
    policy.expectedWidthPx <= 0 ||
    !Number.isSafeInteger(policy.expectedHeightPx) ||
    policy.expectedHeightPx <= 0 ||
    policy.expectedSweepNumbers.length !== policy.expectedFileCount ||
    new Set(policy.expectedSweepNumbers).size !== policy.expectedSweepNumbers.length
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "ARGUMENT_INVALID",
      "Panorama inventory policy is internally inconsistent.",
    );
  }
}

export async function collectGrandHallT554PanoramaInventory(
  options: CollectGrandHallT554PanoramaInventoryOptions,
): Promise<GrandHallT554PanoramaInventory> {
  const policy =
    options.policy ??
    Object.freeze({
      expectedFileCount: GRAND_HALL_T554_EXPECTED_SOURCE_FILE_COUNT,
      expectedWidthPx: GRAND_HALL_T554_EXPECTED_WIDTH_PX,
      expectedHeightPx: GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
      expectedSweepNumbers: EXPECTED_SOURCE_SWEEP_NUMBERS,
    });
  validateInventoryPolicy(policy);
  const root = await resolveDirectDirectory(options.sourceRoot, "Matterport panorama source root");
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length !== policy.expectedFileCount) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      `Expected ${String(policy.expectedFileCount)} panorama files but found ${String(entries.length)}.`,
    );
  }
  const parsed = entries.map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new GrandHallT554PanoramaReviewError(
        "SOURCE_INVENTORY_INVALID",
        `Panorama source entry must be a direct regular file: ${entry.name}`,
      );
    }
    return { entry, parsed: parseGrandHallT554PanoramaFilename(entry.name) };
  });
  parsed.sort((left, right) =>
    left.parsed.sweepNumber === right.parsed.sweepNumber
      ? left.entry.name.localeCompare(right.entry.name)
      : left.parsed.sweepNumber - right.parsed.sweepNumber,
  );
  const actualNumbers = parsed.map((value) => value.parsed.sweepNumber);
  if (
    new Set(actualNumbers).size !== actualNumbers.length ||
    actualNumbers.length !== policy.expectedSweepNumbers.length ||
    actualNumbers.some((value, index) => value !== policy.expectedSweepNumbers[index])
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "Panorama numeric sweep inventory does not match the exact expected set.",
    );
  }
  const files: GrandHallT554PanoramaInventoryFile[] = [];
  for (const value of parsed) {
    const evidence = await inspectStableGrandHallT554Jpeg(
      resolve(root, value.entry.name),
      `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${value.entry.name}`,
    );
    if (evidence.widthPx !== policy.expectedWidthPx || evidence.heightPx !== policy.expectedHeightPx) {
      throw new GrandHallT554PanoramaReviewError(
        "JPEG_DIMENSIONS_MISMATCH",
        `${value.entry.name} is ${String(evidence.widthPx)}x${String(evidence.heightPx)}; expected ${String(policy.expectedWidthPx)}x${String(policy.expectedHeightPx)}.`,
      );
    }
    files.push({
      ...evidence,
      relativePath: value.entry.name,
      ...value.parsed,
    });
  }
  const totalBytes = files.reduce((total, file) => total + file.byteLength, 0);
  await options.testSeam?.beforeFinalDirectoryInventoryCheck?.();
  const entriesAfter = await readdir(root, { withFileTypes: true });
  const initialNames = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  const finalNames = entriesAfter
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (
    entriesAfter.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    JSON.stringify(finalNames) !== JSON.stringify(initialNames) ||
    comparablePath(await realpath(root)) !== comparablePath(root)
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_CHANGED",
      "Panorama directory inventory changed during its race-safe read-only inspection.",
    );
  }
  return {
    sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
    fileCount: files.length,
    totalBytes,
    files,
    inventorySha256: computeGrandHallT554PanoramaInventorySha256(files),
    missingSweepNumbersWithin1To149: Array.from({ length: 149 }, (_, index) => index + 1).filter(
      (value) => !actualNumbers.includes(value),
    ),
    readMode: "read_only",
    sourceMutationPermitted: false,
    networkAccess: "none",
  };
}

export function buildGrandHallT554PanoramaReviewRecords(
  files: readonly GrandHallT554PanoramaInventoryFile[],
  t550: GrandHallT554T550Binding,
): readonly GrandHallT554PanoramaReviewRecord[] {
  if (t550.records.length !== T550_CANDIDATE_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      "T-550 binding must contain exactly 50 candidate scan records.",
    );
  }
  const t550BySweep = new Map(
    t550.records.map((record) => [record.candidatePanoramaSweepNumber, record] as const),
  );
  return files.map((file) => {
    const base = {
      ...file,
      authority: "none" as const,
      trainingInputPermitted: false as const,
      reconstructionInputPermitted: false as const,
      runtimeInputPermitted: false as const,
      publicEvidencePermitted: false as const,
      generatedDerivativeInputPermitted: false as const,
    };
    const binding = t550BySweep.get(file.sweepNumber);
    if (binding === undefined) {
      return {
        ...base,
        reviewEligibility: "not_in_t550_ineligible_unreviewed" as const,
        humanReviewState: "unreviewed" as const,
        candidateScanIndex: null,
        candidateMappingAuthority: "none" as const,
        visualLocationInference: "not_reviewed" as const,
        allowedUse: "inventory_binding_only" as const,
        panoramaCorrespondenceState: "not_evaluated" as const,
        pixelMaskState: "not_authored_not_requested" as const,
        wholeFrameExclusionReason: null,
      };
    }
    if (
      binding.relativePath !== file.relativePath ||
      binding.sha256 !== file.sha256 ||
      binding.byteLength !== file.byteLength ||
      binding.scanIndex + 1 !== file.sweepNumber
    ) {
      throw new GrandHallT554PanoramaReviewError(
        "T550_BINDING_MISMATCH",
        `T-550 evidence does not bind the current bytes for sweep ${String(file.sweepNumber)}.`,
      );
    }
    return {
      ...base,
      reviewEligibility: "t550_candidate_human_pending" as const,
      humanReviewState: "pending" as const,
      candidateScanIndex: binding.scanIndex,
      candidateMappingAuthority: "sequence_hypothesis_not_byte_lineage" as const,
      visualLocationInference: binding.visualLocationInference,
      allowedUse: binding.allowedUse,
      panoramaCorrespondenceState: binding.panoramaCorrespondenceState,
      pixelMaskState: binding.pixelMaskState,
      wholeFrameExclusionReason: binding.wholeFrameExclusionReason,
    };
  });
}

export interface GrandHallT554PreviewRecord extends GrandHallT554StableJpegEvidence {
  readonly scanIndex: number;
  readonly relativePath: string;
  readonly authority: "diagnostic_only";
  readonly derivationState: "historical_unverified";
  readonly trainingInputPermitted: false;
  readonly reconstructionInputPermitted: false;
  readonly runtimeInputPermitted: false;
}

interface LoadedT550Membership {
  readonly document: FoundryGrandHallRoomMembershipV1;
  readonly binding: GrandHallT554T550Binding;
}

interface StableBytesResult {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

async function readHandleExactly(handle: FileHandle, sizeBytes: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  while (offset < sizeBytes) {
    const result = await handle.read(bytes, offset, sizeBytes - offset, offset);
    if (result.bytesRead <= 0) {
      throw new GrandHallT554PanoramaReviewError(
        "SOURCE_CHANGED",
        "A source ended while its verified bytes were being reread.",
      );
    }
    offset += result.bytesRead;
  }
  return bytes;
}

async function readStableBytesMatching(
  path: string,
  sourceLocator: string,
  expectedSha256: `sha256:${string}` | undefined,
  expectedByteLength: number | undefined,
  maxBytes: number,
): Promise<StableBytesResult> {
  let captured: Buffer | undefined;
  let digest;
  try {
    digest = await sha256RegularFileWithHead(
      path,
      0,
      undefined,
      undefined,
      undefined,
      async (handle, sizeBytes, sourceSha256) => {
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) {
          throw new GrandHallT554PanoramaReviewError(
            "SOURCE_ROOT_UNSAFE",
            `${sourceLocator} exceeds its bounded read limit.`,
          );
        }
        const bytes = await readHandleExactly(handle, sizeBytes);
        if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
          throw new GrandHallT554PanoramaReviewError(
            "SOURCE_CHANGED",
            `${sourceLocator} changed between hashing and verified decode capture.`,
          );
        }
        captured = bytes;
      },
    );
  } catch (error) {
    throw mapSourceError(error, sourceLocator);
  }
  const sha256 = `sha256:${digest.sha256}` as const;
  if (
    captured === undefined ||
    (expectedSha256 !== undefined && sha256 !== expectedSha256) ||
    (expectedByteLength !== undefined && digest.sizeBytes !== expectedByteLength)
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      `${sourceLocator} no longer matches its expected digest and byte length.`,
    );
  }
  return { bytes: captured, byteLength: digest.sizeBytes, sha256 };
}

async function loadT550Membership(path: string): Promise<LoadedT550Membership> {
  const absolute = requireAbsolutePath(path, "T-550 membership artifact");
  const stable = await readStableBytesMatching(
    absolute,
    "T550_MEMBERSHIP_ARTIFACT",
    undefined,
    undefined,
    MAX_MEMBERSHIP_BYTES,
  );
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stable.bytes.toString("utf8"));
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_MEMBERSHIP_INVALID",
      "T-550 membership artifact is not valid UTF-8 JSON.",
      error,
    );
  }
  const result = FoundryGrandHallRoomMembershipV1Schema.safeParse(parsedJson);
  if (!result.success || result.data.membershipSha256 !== GRAND_HALL_T554_MEMBERSHIP_SHA256) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_MEMBERSHIP_INVALID",
      "T-550 membership artifact failed its strict schema or canonical digest.",
      result.success ? undefined : result.error,
    );
  }
  const document = result.data;
  return {
    document,
    binding: {
      membershipSha256: requireSha256Digest(
        document.membershipSha256,
        "T-550 canonical membership digest",
      ),
      membershipFileSha256: stable.sha256,
      records: document.scanRecords.map((record) => ({
        scanIndex: record.scanIndex,
        candidatePanoramaSweepNumber: record.candidatePanoramaSweepNumber,
        visualLocationInference: record.visualLocationInference,
        allowedUse: record.allowedUse,
        panoramaCorrespondenceState: record.panoramaCorrespondenceState,
        pixelMaskState: record.pixelMaskState,
        wholeFrameExclusionReason: record.wholeFrameExclusionReason,
        relativePath: record.candidatePanoramaEvidence.relativePath,
        byteLength: record.candidatePanoramaEvidence.byteLength,
        sha256: requireSha256Digest(
          record.candidatePanoramaEvidence.sha256,
          `T-550 candidate panorama digest for scan ${String(record.scanIndex)}`,
        ),
      })),
    },
  };
}

async function collectPreviewEvidence(
  previewRoot: string,
  membership: FoundryGrandHallRoomMembershipV1,
): Promise<readonly GrandHallT554PreviewRecord[]> {
  const root = await resolveDirectDirectory(previewRoot, "E57 diagnostic preview root");
  const previews: GrandHallT554PreviewRecord[] = [];
  for (const membershipRecord of membership.scanRecords) {
    const expected = membershipRecord.previewEvidence;
    const path = resolve(root, expected.relativePath);
    const evidence = await inspectStableGrandHallT554Jpeg(
      path,
      `${GRAND_HALL_T554_PREVIEW_SOURCE_LOCATOR}/${expected.relativePath}`,
    );
    if (
      evidence.sha256 !== expected.sha256 ||
      evidence.byteLength !== expected.byteLength ||
      evidence.widthPx !== GRAND_HALL_T554_EXPECTED_PREVIEW_WIDTH_PX ||
      evidence.heightPx !== GRAND_HALL_T554_EXPECTED_PREVIEW_HEIGHT_PX
    ) {
      throw new GrandHallT554PanoramaReviewError(
        "T550_BINDING_MISMATCH",
        `${expected.relativePath} does not match its T-550 diagnostic preview evidence.`,
      );
    }
    previews.push({
      ...evidence,
      scanIndex: membershipRecord.scanIndex,
      relativePath: expected.relativePath,
      authority: "diagnostic_only",
      derivationState: "historical_unverified",
      trainingInputPermitted: false,
      reconstructionInputPermitted: false,
      runtimeInputPermitted: false,
    });
  }
  return previews;
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

export interface GrandHallT554OutputSafetyOptions {
  readonly sourceRoots: readonly string[];
  readonly outputDirectory: string;
}

async function resolveDirectExistingOutputDirectory(path: string): Promise<string> {
  const absolute = requireAbsolutePath(path, "Review output directory");
  try {
    const before = await lstat(absolute);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "Review output must be a direct regular directory.",
      );
    }
    const canonical = await realpath(absolute);
    if (comparablePath(canonical) !== comparablePath(absolute)) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "Review output must not resolve through an indirect path.",
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Review output directory could not be verified.",
      error,
    );
  }
}

async function assertOutputDisjointFromSourceRoots(
  outputDirectory: string,
  sourceRoots: readonly string[],
): Promise<void> {
  for (const sourceRoot of sourceRoots) {
    const canonicalSource = await resolveDirectDirectory(sourceRoot, "Review source root");
    if (
      isGrandHallT554PathWithin(canonicalSource, outputDirectory) ||
      isGrandHallT554PathWithin(outputDirectory, canonicalSource)
    ) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_OVERLAPS_SOURCE",
        "Review output must be disjoint from every source root.",
      );
    }
  }
}

export async function assertGrandHallT554ReviewOutputSafety(
  options: GrandHallT554OutputSafetyOptions,
): Promise<{ readonly outputDirectory: string; readonly outputParent: string }> {
  const outputDirectory = requireAbsolutePath(options.outputDirectory, "Review output directory");
  if (await pathExists(outputDirectory)) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_ALREADY_EXISTS",
      "Review output directory must not already exist.",
    );
  }
  const outputParent = dirname(outputDirectory);
  let canonicalParent: string;
  try {
    const parentStats = await lstat(outputParent);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_PARENT_UNSAFE",
        "Review output parent must be a direct regular directory.",
      );
    }
    canonicalParent = await realpath(outputParent);
    if (comparablePath(canonicalParent) !== comparablePath(outputParent)) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_PARENT_UNSAFE",
        "Review output parent must not resolve through an indirect path.",
      );
    }
  } catch (error) {
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PARENT_UNSAFE",
      "Review output parent could not be verified.",
      error,
    );
  }
  await assertOutputDisjointFromSourceRoots(outputDirectory, options.sourceRoots);
  return { outputDirectory, outputParent: canonicalParent };
}

export async function assertGrandHallT554ExistingReviewOutputSafety(
  options: GrandHallT554OutputSafetyOptions,
): Promise<{ readonly outputDirectory: string }> {
  const outputDirectory = await resolveDirectExistingOutputDirectory(options.outputDirectory);
  await assertOutputDisjointFromSourceRoots(outputDirectory, options.sourceRoots);
  return { outputDirectory };
}

type Rgb = readonly [number, number, number];

const REVIEW_GOLD: Rgb = [214, 169, 78];
const REVIEW_WHITE: Rgb = [236, 238, 236];
const REVIEW_MUTED: Rgb = [151, 157, 157];
const REVIEW_INTERIOR: Rgb = [49, 170, 116];
const REVIEW_PORTAL: Rgb = [231, 165, 52];
const REVIEW_EXCLUDED: Rgb = [218, 76, 76];
const REVIEW_UNKNOWN: Rgb = [104, 112, 120];

const FONT_3X5: Readonly<Record<string, string>> = Object.freeze({
  " ": "000000000000000",
  "-": "000000111000000",
  _: "000000000000111",
  "/": "001001010100100",
  ".": "000000000000010",
  ":": "000010000010000",
  "#": "101111101111101",
  "?": "110001010000010",
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "110001010100111",
  "3": "110001010001110",
  "4": "101101111001001",
  "5": "111100110001110",
  "6": "111100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001110",
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "101111111111101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101111011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
});

function setRgb(canvas: Buffer, width: number, x: number, y: number, color: Rgb): void {
  const offset = (y * width + x) * 3;
  canvas[offset] = color[0];
  canvas[offset + 1] = color[1];
  canvas[offset + 2] = color[2];
}

function fillRectangle(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  const startX = Math.max(0, x);
  const endX = Math.min(canvasWidth, x + width);
  const startY = Math.max(0, y);
  const endY = Math.min(canvasHeight, y + height);
  for (let targetY = startY; targetY < endY; targetY += 1) {
    for (let targetX = startX; targetX < endX; targetX += 1) {
      setRgb(canvas, canvasWidth, targetX, targetY, color);
    }
  }
}

function drawText(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  text: string,
  scale: number,
  color: Rgb,
): void {
  let cursorX = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT_3X5[character] ?? FONT_3X5["?"] ?? "";
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== "1") continue;
        fillRectangle(
          canvas,
          canvasWidth,
          canvasHeight,
          cursorX + column * scale,
          y + row * scale,
          scale,
          scale,
          color,
        );
      }
    }
    cursorX += 4 * scale;
  }
}

function drawBorder(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  color: Rgb,
): void {
  fillRectangle(canvas, canvasWidth, canvasHeight, x, y, width, thickness, color);
  fillRectangle(canvas, canvasWidth, canvasHeight, x, y + height - thickness, width, thickness, color);
  fillRectangle(canvas, canvasWidth, canvasHeight, x, y, thickness, height, color);
  fillRectangle(canvas, canvasWidth, canvasHeight, x + width - thickness, y, thickness, height, color);
}

function blitRgb(
  canvas: Buffer,
  canvasWidth: number,
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): void {
  const sourceStride = sourceWidth * 3;
  const canvasStride = canvasWidth * 3;
  for (let row = 0; row < sourceHeight; row += 1) {
    source.copy(
      canvas,
      (y + row) * canvasStride + x * 3,
      row * sourceStride,
      (row + 1) * sourceStride,
    );
  }
}

function classificationColor(record: GrandHallT554CandidateReviewRecord): Rgb {
  if (record.visualLocationInference === "visually_mixed_portal_threshold") return REVIEW_PORTAL;
  if (record.visualLocationInference === "visually_consistent_adjacent_space") {
    return REVIEW_EXCLUDED;
  }
  return REVIEW_INTERIOR;
}

function classificationLabel(record: GrandHallT554CandidateReviewRecord): string {
  if (record.visualLocationInference === "visually_mixed_portal_threshold") {
    return "MIXED PORTAL - MASK REQUIRED";
  }
  if (record.visualLocationInference === "visually_consistent_adjacent_space") {
    return "ADJACENT SPACE - WHOLE FRAME EXCLUDE";
  }
  return "GRAND HALL CANDIDATE - MASK REQUIRED";
}

async function resizeVerifiedJpeg(
  bytes: Buffer,
  evidence: GrandHallT554StableJpegEvidence,
  width: number,
  height: number,
): Promise<Buffer> {
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const dimensions = readJpegDimensions(bytes.subarray(0, JPEG_INSPECTION_HEAD_BYTES));
  if (
    digest !== evidence.sha256 ||
    bytes.length !== evidence.byteLength ||
    dimensions.widthPx !== evidence.widthPx ||
    dimensions.heightPx !== evidence.heightPx
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_CHANGED",
      `${evidence.sourceLocator} failed its pre-decode byte and dimension check.`,
    );
  }
  try {
    const rendered = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: GRAND_HALL_T554_EXPECTED_WIDTH_PX * GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
    })
      .resize(width, height, { fit: "fill", kernel: REVIEW_IMAGE_KERNEL })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      rendered.info.width !== width ||
      rendered.info.height !== height ||
      rendered.info.channels !== 3
    ) {
      throw new Error("sharp returned an unexpected review raster shape");
    }
    return rendered.data;
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      `${evidence.sourceLocator} could not be decoded into a review-only raster.`,
      error,
    );
  }
}

async function encodeReviewPng(canvas: Buffer, width: number, height: number): Promise<Buffer> {
  try {
    return await sharp(canvas, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
      .toBuffer();
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      "Review canvas could not be encoded as a deterministic PNG derivative.",
      error,
    );
  }
}

interface RenderedReviewAsset {
  readonly relativePath: string;
  readonly mediaType: "image/png";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly authority: "none";
  readonly role: "review_only_resampled_contact_sheet";
  readonly reconstructionInputPermitted: false;
  readonly bytes: Buffer;
}

async function reviewAsset(
  relativePath: string,
  canvas: Buffer,
  widthPx: number,
  heightPx: number,
): Promise<RenderedReviewAsset> {
  const bytes = await encodeReviewPng(canvas, widthPx, heightPx);
  return {
    relativePath,
    mediaType: "image/png",
    widthPx,
    heightPx,
    byteLength: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    authority: "none",
    role: "review_only_resampled_contact_sheet",
    reconstructionInputPermitted: false,
    bytes,
  };
}

type CandidateByteLoader = (record: GrandHallT554CandidateReviewRecord) => Promise<Buffer>;

async function renderOverview(
  records: readonly GrandHallT554CandidateReviewRecord[],
  loadBytes: CandidateByteLoader,
): Promise<RenderedReviewAsset> {
  if (records.length !== T550_CANDIDATE_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      "Overview requires exactly 50 T-550 candidate records.",
    );
  }
  const width = 2_000;
  const headerHeight = 120;
  const columns = 5;
  const cellWidth = width / columns;
  const imageHeight = 200;
  const labelHeight = 72;
  const rowHeight = imageHeight + labelHeight;
  const height = headerHeight + 10 * rowHeight;
  const canvas = Buffer.alloc(width * height * 3);
  drawText(canvas, width, height, 24, 18, "REVIEW ONLY - AUTHORITY NONE", 4, REVIEW_GOLD);
  drawText(
    canvas,
    width,
    height,
    24,
    48,
    "CANDIDATE SCAN TO SWEEP MAPPING UNVERIFIED",
    3,
    REVIEW_WHITE,
  );
  drawText(
    canvas,
    width,
    height,
    24,
    75,
    "RESAMPLED VISUAL DERIVATIVE - NEVER A RECONSTRUCTION INPUT",
    2,
    REVIEW_MUTED,
  );
  for (const [index, record] of records.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = headerHeight + row * rowHeight;
    const bytes = await loadBytes(record);
    const resized = await resizeVerifiedJpeg(bytes, record, cellWidth, imageHeight);
    blitRgb(canvas, width, resized, cellWidth, imageHeight, x, y);
    drawBorder(canvas, width, height, x, y, cellWidth, rowHeight, 5, classificationColor(record));
    drawText(
      canvas,
      width,
      height,
      x + 10,
      y + imageHeight + 8,
      `SCAN ${String(record.candidateScanIndex).padStart(3, "0")} / SWEEP ${String(record.sweepNumber).padStart(3, "0")}`,
      2,
      REVIEW_WHITE,
    );
    drawText(
      canvas,
      width,
      height,
      x + 10,
      y + imageHeight + 28,
      classificationLabel(record),
      2,
      classificationColor(record),
    );
    drawText(
      canvas,
      width,
      height,
      x + 10,
      y + imageHeight + 48,
      `SHA ${record.sha256.slice(7, 19)} - UNVERIFIED MAP`,
      2,
      REVIEW_MUTED,
    );
  }
  return reviewAsset(GRAND_HALL_T554_OVERVIEW_FILENAME, canvas, width, height);
}

type CrosswalkPair = FoundryGrandHallRoomMembershipV1["sourceBindings"]["panoramaAuditSet"]["crosswalkEvidence"]["pairResults"][number];

interface CrosswalkRenderInputs {
  readonly pairs: readonly CrosswalkPair[];
  readonly candidates: ReadonlyMap<number, GrandHallT554CandidateReviewRecord>;
  readonly previews: ReadonlyMap<number, GrandHallT554PreviewRecord>;
  readonly loadCandidateBytes: CandidateByteLoader;
  readonly loadPreviewBytes: (record: GrandHallT554PreviewRecord) => Promise<Buffer>;
}

function fixedScore(value: number): string {
  return value.toFixed(6);
}

async function renderCrosswalk(inputs: CrosswalkRenderInputs): Promise<RenderedReviewAsset> {
  if (inputs.pairs.length !== CROSSWALK_PAIR_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      "Crosswalk review requires exactly six persisted diagnostic pairs.",
    );
  }
  const width = 2_000;
  const headerHeight = 140;
  const panelWidth = 980;
  const panelHeight = 490;
  const rowHeight = 590;
  const height = headerHeight + inputs.pairs.length * rowHeight;
  const canvas = Buffer.alloc(width * height * 3);
  drawText(canvas, width, height, 24, 18, "REVIEW ONLY - SIX DIAGNOSTIC PAIRS", 4, REVIEW_GOLD);
  drawText(
    canvas,
    width,
    height,
    24,
    50,
    "CANDIDATE CORRESPONDENCE - NOT BYTE LINEAGE - HUMAN CONFIRMATION NO",
    2,
    REVIEW_WHITE,
  );
  drawText(
    canvas,
    width,
    height,
    24,
    72,
    "LEFT MATTERPORT CANDIDATE / RIGHT HISTORICAL E57 PREVIEW",
    2,
    REVIEW_MUTED,
  );
  drawText(
    canvas,
    width,
    height,
    24,
    94,
    "RESAMPLED REVIEW DERIVATIVE - NEVER A RECONSTRUCTION INPUT",
    2,
    REVIEW_MUTED,
  );
  for (const [index, pair] of inputs.pairs.entries()) {
    const candidate = inputs.candidates.get(pair.scanIndex);
    const preview = inputs.previews.get(pair.scanIndex);
    if (candidate === undefined || preview === undefined) {
      throw new GrandHallT554PanoramaReviewError(
        "T550_BINDING_MISMATCH",
        `Crosswalk scan ${String(pair.scanIndex)} is missing bound image evidence.`,
      );
    }
    const y = headerHeight + index * rowHeight;
    const candidateRaster = await resizeVerifiedJpeg(
      await inputs.loadCandidateBytes(candidate),
      candidate,
      panelWidth,
      panelHeight,
    );
    const previewRaster = await resizeVerifiedJpeg(
      await inputs.loadPreviewBytes(preview),
      preview,
      panelWidth,
      panelHeight,
    );
    blitRgb(canvas, width, candidateRaster, panelWidth, panelHeight, 0, y);
    blitRgb(canvas, width, previewRaster, panelWidth, panelHeight, 1_020, y);
    drawBorder(canvas, width, height, 0, y, panelWidth, panelHeight, 5, classificationColor(candidate));
    drawBorder(canvas, width, height, 1_020, y, panelWidth, panelHeight, 5, REVIEW_UNKNOWN);
    drawText(
      canvas,
      width,
      height,
      12,
      y + panelHeight + 10,
      `SCAN ${String(pair.scanIndex).padStart(3, "0")} / SWEEP ${String(pair.candidatePanoramaSweepNumber).padStart(3, "0")} / RANK ${String(pair.candidateMatchRank)}`,
      2,
      REVIEW_WHITE,
    );
    drawText(
      canvas,
      width,
      height,
      12,
      y + panelHeight + 32,
      `SCORE ${fixedScore(pair.candidateMatchScore)} / SHIFT ${String(pair.bestCyclicShiftColumns)} / RUNNER SCAN ${String(pair.runnerUpScanIndex).padStart(3, "0")} SCORE ${fixedScore(pair.runnerUpScore)}`,
      2,
      pair.candidateMatchRank === 1 ? REVIEW_MUTED : REVIEW_EXCLUDED,
    );
    drawText(
      canvas,
      width,
      height,
      12,
      y + panelHeight + 54,
      `MARGIN ${fixedScore(pair.candidateMinusRunnerUpScore)} / HUMAN NO / E57 BYTE LINEAGE NO`,
      2,
      REVIEW_MUTED,
    );
  }
  return reviewAsset(GRAND_HALL_T554_CROSSWALK_FILENAME, canvas, width, height);
}

export interface GrandHallT554CeilingPlanEvidence extends GrandHallT554StableJpegEvidence {
  readonly sourceLocator: typeof GRAND_HALL_T554_CEILING_PLAN_SOURCE_LOCATOR;
  readonly authority: "none";
  readonly role: "human_boundary_reference_only";
  readonly closedBoundaryEstablished: false;
  readonly poseAuthority: false;
  readonly maskAuthority: false;
  readonly reconstructionInputPermitted: false;
}

export interface GrandHallT554ReviewOutputEvidence {
  readonly relativePath: string;
  readonly mediaType: "image/png";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly authority: "none";
  readonly role: "review_only_resampled_contact_sheet";
  readonly reconstructionInputPermitted: false;
}

export interface GrandHallT554PanoramaReviewManifest {
  readonly schemaVersion: typeof GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA;
  readonly subject: {
    readonly venueSlug: "trades-hall";
    readonly roomSlug: "grand-hall";
    readonly taskId: "T-554";
    readonly scope: "panorama_human_review_pack_only";
  };
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly sourceMutationPermitted: false;
  readonly networkAccess: "none";
  readonly sourceBindings: {
    readonly t550Membership: {
      readonly sourceLocator: "T550_MEMBERSHIP_ARTIFACT";
      readonly fileSha256: `sha256:${string}`;
      readonly canonicalMembershipSha256: `sha256:${string}`;
      readonly authority: "none";
    };
    readonly panoramaInventory: {
      readonly sourceLocator: typeof GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR;
      readonly fileCount: number;
      readonly totalBytes: number;
      readonly inventorySha256: `sha256:${string}`;
      readonly missingSweepNumbersWithin1To149: readonly number[];
      readonly candidateRecordCount: 50;
      readonly ineligibleUnreviewedRecordCount: 98;
      readonly records: readonly GrandHallT554PanoramaReviewRecord[];
    };
    readonly diagnosticPreviewInventory: {
      readonly sourceLocator: typeof GRAND_HALL_T554_PREVIEW_SOURCE_LOCATOR;
      readonly fileCount: 50;
      readonly totalBytes: number;
      readonly authority: "diagnostic_only";
      readonly derivationState: "historical_unverified";
      readonly records: readonly GrandHallT554PreviewRecord[];
    };
    readonly ceilingColorPlan: GrandHallT554CeilingPlanEvidence;
    readonly crosswalkEvidence: {
      readonly evidenceSha256: `sha256:${string}`;
      readonly pairCount: 6;
      readonly authority: "diagnostic_only";
      readonly humanConfirmationRecorded: false;
      readonly e57ByteLineageEstablished: false;
      readonly pairs: readonly CrosswalkPair[];
    };
  };
  readonly scopeGuards: {
    readonly candidateMappingState: "sequence_hypothesis_unverified";
    readonly inferredPosesGenerated: false;
    readonly masksGenerated: false;
    readonly masksAccepted: false;
    readonly humanAcceptanceRecorded: false;
    readonly closedBoundaryEstablished: false;
    readonly neighbouringRoomsPermitted: false;
    readonly facadeAssetsPermitted: false;
    readonly generatedFillPermitted: false;
    readonly historicalFilledEquirectsConsumed: false;
    readonly trainingAuthorized: false;
    readonly reconstructionAuthorized: false;
    readonly runtimeAuthorized: false;
    readonly publicEvidenceAuthorized: false;
  };
  readonly derivatives: {
    readonly resamplingPurpose: "review_display_only";
    readonly resamplingKernel: typeof REVIEW_IMAGE_KERNEL;
    readonly authoritativeMasksResampled: false;
    readonly mayBeUsedAsReconstructionInput: false;
    readonly outputs: readonly GrandHallT554ReviewOutputEvidence[];
  };
  readonly toolchain: {
    readonly nodeVersion: string;
    readonly sharpVersion: string;
    readonly libvipsVersion: string;
    readonly labelRenderer: "embedded_3x5_bitmap_font_v1";
    readonly outputEncoding: "png_rgb8_no_metadata";
  };
  readonly proof: {
    readonly everyPanoramaHasStableSha256AndDimensions: true;
    readonly everyT550CandidateMatchedExactBytes: true;
    readonly everyNonCandidateExplicitlyIneligibleUnreviewed: true;
    readonly everyDiagnosticPreviewMatchedExactBytes: true;
    readonly ceilingColorPlanMatchedExactBytes: true;
    readonly outputDirectoryWasAbsentBeforePublish: true;
    readonly outputPublishedByAtomicDirectoryRename: true;
    readonly sourceWrites: "none";
    readonly networkRequests: "none";
  };
  readonly warnings: readonly string[];
  readonly manifestSha256: `sha256:${string}`;
}

interface GrandHallT554ManifestInputs {
  readonly membership: LoadedT550Membership;
  readonly inventory: GrandHallT554PanoramaInventory;
  readonly records: readonly GrandHallT554PanoramaReviewRecord[];
  readonly previews: readonly GrandHallT554PreviewRecord[];
  readonly ceilingPlan: GrandHallT554CeilingPlanEvidence;
  readonly outputs: readonly RenderedReviewAsset[];
}

function outputEvidence(asset: RenderedReviewAsset): GrandHallT554ReviewOutputEvidence {
  const { bytes: _bytes, ...evidence } = asset;
  return evidence;
}

function requireToolVersion(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      `${label} version is unavailable; deterministic review evidence cannot be issued.`,
    );
  }
  return value;
}

function buildManifestMaterial(inputs: GrandHallT554ManifestInputs): Omit<
  GrandHallT554PanoramaReviewManifest,
  "manifestSha256"
> {
  const candidates = inputs.records.filter(
    (record) => record.reviewEligibility === "t550_candidate_human_pending",
  );
  const ineligible = inputs.records.filter(
    (record) => record.reviewEligibility === "not_in_t550_ineligible_unreviewed",
  );
  const crosswalk = inputs.membership.document.sourceBindings.panoramaAuditSet.crosswalkEvidence;
  if (
    candidates.length !== 50 ||
    ineligible.length !== 98 ||
    inputs.previews.length !== 50 ||
    crosswalk.pairResults.length !== 6
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      "Review manifest counts or diagnostic authority flags are inconsistent.",
    );
  }
  return {
    schemaVersion: GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA,
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      taskId: "T-554",
      scope: "panorama_human_review_pack_only",
    },
    authority: "none",
    reviewState: "human_pending",
    sourceMutationPermitted: false,
    networkAccess: "none",
    sourceBindings: {
      t550Membership: {
        sourceLocator: "T550_MEMBERSHIP_ARTIFACT",
        fileSha256: inputs.membership.binding.membershipFileSha256,
        canonicalMembershipSha256: inputs.membership.binding.membershipSha256,
        authority: "none",
      },
      panoramaInventory: {
        sourceLocator: inputs.inventory.sourceLocator,
        fileCount: inputs.inventory.fileCount,
        totalBytes: inputs.inventory.totalBytes,
        inventorySha256: inputs.inventory.inventorySha256,
        missingSweepNumbersWithin1To149: inputs.inventory.missingSweepNumbersWithin1To149,
        candidateRecordCount: 50,
        ineligibleUnreviewedRecordCount: 98,
        records: inputs.records,
      },
      diagnosticPreviewInventory: {
        sourceLocator: GRAND_HALL_T554_PREVIEW_SOURCE_LOCATOR,
        fileCount: 50,
        totalBytes: inputs.previews.reduce((total, preview) => total + preview.byteLength, 0),
        authority: "diagnostic_only",
        derivationState: "historical_unverified",
        records: inputs.previews,
      },
      ceilingColorPlan: inputs.ceilingPlan,
      crosswalkEvidence: {
        evidenceSha256: requireSha256Digest(
          crosswalk.evidenceSha256,
          "T-550 crosswalk evidence digest",
        ),
        pairCount: 6,
        authority: "diagnostic_only",
        humanConfirmationRecorded: false,
        e57ByteLineageEstablished: false,
        pairs: crosswalk.pairResults,
      },
    },
    scopeGuards: {
      candidateMappingState: "sequence_hypothesis_unverified",
      inferredPosesGenerated: false,
      masksGenerated: false,
      masksAccepted: false,
      humanAcceptanceRecorded: false,
      closedBoundaryEstablished: false,
      neighbouringRoomsPermitted: false,
      facadeAssetsPermitted: false,
      generatedFillPermitted: false,
      historicalFilledEquirectsConsumed: false,
      trainingAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      publicEvidenceAuthorized: false,
    },
    derivatives: {
      resamplingPurpose: "review_display_only",
      resamplingKernel: REVIEW_IMAGE_KERNEL,
      authoritativeMasksResampled: false,
      mayBeUsedAsReconstructionInput: false,
      outputs: inputs.outputs.map(outputEvidence),
    },
    toolchain: {
      nodeVersion: process.version,
      sharpVersion: requireToolVersion(sharp.versions.sharp, "sharp"),
      libvipsVersion: requireToolVersion(sharp.versions.vips, "libvips"),
      labelRenderer: "embedded_3x5_bitmap_font_v1",
      outputEncoding: "png_rgb8_no_metadata",
    },
    proof: {
      everyPanoramaHasStableSha256AndDimensions: true,
      everyT550CandidateMatchedExactBytes: true,
      everyNonCandidateExplicitlyIneligibleUnreviewed: true,
      everyDiagnosticPreviewMatchedExactBytes: true,
      ceilingColorPlanMatchedExactBytes: true,
      outputDirectoryWasAbsentBeforePublish: true,
      outputPublishedByAtomicDirectoryRename: true,
      sourceWrites: "none",
      networkRequests: "none",
    },
    warnings: [
      "Candidate scan-to-sweep correspondence is unverified and does not establish byte lineage or pose authority.",
      "These resampled contact sheets are human-review aids only and must never be used as reconstruction, training, runtime, or public evidence inputs.",
      "No panorama masks, inferred poses, closed boundary, generated fill, or human acceptance are contained in this package.",
      "The historical equirect_filled workspace was not read or consumed.",
    ],
  };
}

export function buildGrandHallT554PanoramaReviewManifest(
  inputs: GrandHallT554ManifestInputs,
): GrandHallT554PanoramaReviewManifest {
  const material = buildManifestMaterial(inputs);
  return {
    ...material,
    manifestSha256: `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN,
      toCanonicalJson(material),
    )}`,
  };
}

function serializeManifest(manifest: GrandHallT554PanoramaReviewManifest): Buffer {
  const { manifestSha256, ...material } = manifest;
  const recomputed = `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN,
    toCanonicalJson(material),
  )}`;
  if (manifestSha256 !== recomputed) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "Panorama review manifest self-digest is inconsistent before publication.",
    );
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      `${label} must be a JSON object.`,
    );
  }
  return value as Record<string, unknown>;
}

function requirePersistedSha256(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      `${label} must be a lowercase sha256 digest.`,
    );
  }
  return value as `sha256:${string}`;
}

function requireFalse(value: unknown, label: string): void {
  if (value !== false) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      `${label} must remain false in an authority-none review pack.`,
    );
  }
}

function parsePersistedGrandHallT554Manifest(
  bytes: Buffer,
): GrandHallT554PanoramaReviewManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama review manifest is not valid UTF-8 JSON.",
      error,
    );
  }
  const root = requireJsonRecord(parsed, "Panorama review manifest");
  const manifestSha256 = requirePersistedSha256(root.manifestSha256, "Manifest self-digest");
  const { manifestSha256: _manifestSha256, ...material } = root;
  const recomputed = `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN,
    toCanonicalJson(material),
  )}`;
  if (manifestSha256 !== recomputed) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama review manifest self-digest is invalid.",
    );
  }
  if (
    root.schemaVersion !== GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA ||
    root.authority !== "none" ||
    root.reviewState !== "human_pending" ||
    root.sourceMutationPermitted !== false ||
    root.networkAccess !== "none"
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama review manifest escaped its authority-none state.",
    );
  }
  const subject = requireJsonRecord(root.subject, "Manifest subject");
  if (
    subject.venueSlug !== "trades-hall" ||
    subject.roomSlug !== "grand-hall" ||
    subject.taskId !== "T-554" ||
    subject.scope !== "panorama_human_review_pack_only"
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama review manifest subject drifted.",
    );
  }
  const sourceBindings = requireJsonRecord(root.sourceBindings, "Manifest source bindings");
  const membershipBinding = requireJsonRecord(
    sourceBindings.t550Membership,
    "T-550 membership binding",
  );
  if (
    membershipBinding.sourceLocator !== "T550_MEMBERSHIP_ARTIFACT" ||
    membershipBinding.authority !== "none" ||
    membershipBinding.canonicalMembershipSha256 !== GRAND_HALL_T554_MEMBERSHIP_SHA256
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted T-550 membership binding drifted.",
    );
  }
  requirePersistedSha256(membershipBinding.fileSha256, "T-550 membership file digest");
  const panoramaInventory = requireJsonRecord(
    sourceBindings.panoramaInventory,
    "Panorama inventory",
  );
  const panoramaRecords = panoramaInventory.records;
  if (
    panoramaInventory.sourceLocator !== GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR ||
    panoramaInventory.fileCount !== 148 ||
    panoramaInventory.candidateRecordCount !== 50 ||
    panoramaInventory.ineligibleUnreviewedRecordCount !== 98 ||
    !Array.isArray(panoramaRecords) ||
    panoramaRecords.length !== 148
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama source inventory or eligibility counts drifted.",
    );
  }
  let candidateCount = 0;
  let ineligibleCount = 0;
  for (const [index, value] of panoramaRecords.entries()) {
    const record = requireJsonRecord(value, `Panorama record ${String(index)}`);
    requirePersistedSha256(record.sha256, `Panorama record ${String(index)} digest`);
    if (record.authority !== "none") {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "A persisted panorama record claims authority.",
      );
    }
    requireFalse(record.trainingInputPermitted, "Panorama training permission");
    requireFalse(record.reconstructionInputPermitted, "Panorama reconstruction permission");
    requireFalse(record.runtimeInputPermitted, "Panorama runtime permission");
    requireFalse(record.publicEvidencePermitted, "Panorama public-evidence permission");
    requireFalse(record.generatedDerivativeInputPermitted, "Panorama derivative-input permission");
    if (record.reviewEligibility === "t550_candidate_human_pending") candidateCount += 1;
    else if (record.reviewEligibility === "not_in_t550_ineligible_unreviewed") {
      ineligibleCount += 1;
    } else {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "A persisted panorama record has an unknown eligibility state.",
      );
    }
  }
  if (candidateCount !== 50 || ineligibleCount !== 98) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama records do not contain the exact 50+98 eligibility partition.",
    );
  }
  const previewInventory = requireJsonRecord(
    sourceBindings.diagnosticPreviewInventory,
    "Diagnostic preview inventory",
  );
  if (
    previewInventory.sourceLocator !== GRAND_HALL_T554_PREVIEW_SOURCE_LOCATOR ||
    previewInventory.fileCount !== 50 ||
    previewInventory.authority !== "diagnostic_only" ||
    previewInventory.derivationState !== "historical_unverified" ||
    !Array.isArray(previewInventory.records) ||
    previewInventory.records.length !== 50
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted diagnostic preview inventory drifted.",
    );
  }
  for (const [index, value] of previewInventory.records.entries()) {
    const record = requireJsonRecord(value, `Diagnostic preview ${String(index)}`);
    requirePersistedSha256(record.sha256, `Diagnostic preview ${String(index)} digest`);
    requireFalse(record.trainingInputPermitted, "Preview training permission");
    requireFalse(record.reconstructionInputPermitted, "Preview reconstruction permission");
    requireFalse(record.runtimeInputPermitted, "Preview runtime permission");
  }
  const ceiling = requireJsonRecord(sourceBindings.ceilingColorPlan, "Ceiling colour plan");
  if (
    ceiling.sourceLocator !== GRAND_HALL_T554_CEILING_PLAN_SOURCE_LOCATOR ||
    ceiling.authority !== "none" ||
    ceiling.role !== "human_boundary_reference_only"
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted ceiling colour-plan binding drifted.",
    );
  }
  requirePersistedSha256(ceiling.sha256, "Ceiling colour-plan digest");
  requireFalse(ceiling.closedBoundaryEstablished, "Ceiling-plan boundary claim");
  requireFalse(ceiling.poseAuthority, "Ceiling-plan pose authority");
  requireFalse(ceiling.maskAuthority, "Ceiling-plan mask authority");
  requireFalse(ceiling.reconstructionInputPermitted, "Ceiling-plan reconstruction permission");
  const crosswalk = requireJsonRecord(sourceBindings.crosswalkEvidence, "Crosswalk evidence");
  if (
    crosswalk.pairCount !== 6 ||
    crosswalk.authority !== "diagnostic_only" ||
    crosswalk.humanConfirmationRecorded !== false ||
    crosswalk.e57ByteLineageEstablished !== false ||
    !Array.isArray(crosswalk.pairs) ||
    crosswalk.pairs.length !== 6
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted crosswalk diagnostics overstate correspondence authority.",
    );
  }
  requirePersistedSha256(crosswalk.evidenceSha256, "Crosswalk evidence digest");
  for (const [index, value] of crosswalk.pairs.entries()) {
    const pair = requireJsonRecord(value, `Crosswalk pair ${String(index)}`);
    requireFalse(pair.humanConfirmationRecorded, "Crosswalk human confirmation");
    requireFalse(pair.e57ByteLineageEstablished, "Crosswalk E57 byte lineage");
  }
  const scopeGuards = requireJsonRecord(root.scopeGuards, "Scope guards");
  if (scopeGuards.candidateMappingState !== "sequence_hypothesis_unverified") {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted candidate mapping overstates its evidence.",
    );
  }
  for (const property of [
    "inferredPosesGenerated",
    "masksGenerated",
    "masksAccepted",
    "humanAcceptanceRecorded",
    "closedBoundaryEstablished",
    "neighbouringRoomsPermitted",
    "facadeAssetsPermitted",
    "generatedFillPermitted",
    "historicalFilledEquirectsConsumed",
    "trainingAuthorized",
    "reconstructionAuthorized",
    "runtimeAuthorized",
    "publicEvidenceAuthorized",
  ] as const) {
    requireFalse(scopeGuards[property], `Scope guard ${property}`);
  }
  const derivatives = requireJsonRecord(root.derivatives, "Review derivatives");
  if (
    derivatives.resamplingPurpose !== "review_display_only" ||
    derivatives.resamplingKernel !== REVIEW_IMAGE_KERNEL ||
    derivatives.authoritativeMasksResampled !== false ||
    derivatives.mayBeUsedAsReconstructionInput !== false ||
    !Array.isArray(derivatives.outputs) ||
    derivatives.outputs.length !== GRAND_HALL_T554_REVIEW_OUTPUT_FILE_NAMES.length
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted derivative policy or inventory drifted.",
    );
  }
  const expectedDimensions = new Map<string, readonly [number, number]>([
    [GRAND_HALL_T554_OVERVIEW_FILENAME, [2_000, 2_840]],
    [GRAND_HALL_T554_CROSSWALK_FILENAME, [2_000, 3_680]],
  ]);
  const observedOutputNames: string[] = [];
  for (const value of derivatives.outputs) {
    const output = requireJsonRecord(value, "Review output record");
    const name = output.relativePath;
    if (typeof name !== "string") {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "Persisted review output filename is malformed.",
      );
    }
    const dimensions = expectedDimensions.get(name);
    if (
      dimensions === undefined ||
      output.mediaType !== "image/png" ||
      output.widthPx !== dimensions[0] ||
      output.heightPx !== dimensions[1] ||
      typeof output.byteLength !== "number" ||
      !Number.isSafeInteger(output.byteLength) ||
      output.byteLength <= 0 ||
      output.byteLength > MAX_REVIEW_PNG_BYTES ||
      output.authority !== "none" ||
      output.role !== "review_only_resampled_contact_sheet" ||
      output.reconstructionInputPermitted !== false
    ) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        "Persisted review output evidence drifted.",
      );
    }
    requirePersistedSha256(output.sha256, `Review output ${name} digest`);
    observedOutputNames.push(name);
  }
  if (
    JSON.stringify(observedOutputNames.sort()) !==
    JSON.stringify([...GRAND_HALL_T554_REVIEW_OUTPUT_FILE_NAMES].sort())
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted review output names drifted.",
    );
  }
  return parsed as GrandHallT554PanoramaReviewManifest;
}

async function readStableOutputBytes(
  path: string,
  label: string,
  maxBytes: number,
  expectedSha256?: `sha256:${string}`,
  expectedByteLength?: number,
): Promise<StableBytesResult> {
  let captured: Buffer | undefined;
  try {
    const digest = await sha256RegularFileWithHead(
      path,
      0,
      undefined,
      undefined,
      undefined,
      async (handle, sizeBytes, sourceSha256) => {
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) {
          throw new GrandHallT554PanoramaReviewError(
            "OUTPUT_VERIFICATION_FAILED",
            `${label} exceeds its bounded verification size.`,
          );
        }
        const bytes = await readHandleExactly(handle, sizeBytes);
        if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
          throw new GrandHallT554PanoramaReviewError(
            "OUTPUT_VERIFICATION_FAILED",
            `${label} changed during stable verification.`,
          );
        }
        captured = bytes;
      },
    );
    const sha256 = `sha256:${digest.sha256}` as const;
    if (
      captured === undefined ||
      (expectedSha256 !== undefined && sha256 !== expectedSha256) ||
      (expectedByteLength !== undefined && digest.sizeBytes !== expectedByteLength)
    ) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        `${label} drifted from its manifest evidence.`,
      );
    }
    return { bytes: captured, byteLength: digest.sizeBytes, sha256 };
  } catch (error) {
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      `${label} could not be read as one stable regular file.`,
      error,
    );
  }
}

async function verifyReviewPngDecode(
  bytes: Buffer,
  evidence: GrandHallT554ReviewOutputEvidence,
): Promise<void> {
  try {
    const decoderOptions = {
      failOn: "error" as const,
      limitInputPixels: evidence.widthPx * evidence.heightPx,
    };
    const metadata = await sharp(bytes, decoderOptions).metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== evidence.widthPx ||
      metadata.height !== evidence.heightPx ||
      metadata.space !== "srgb" ||
      metadata.channels !== 3 ||
      metadata.depth !== "uchar" ||
      metadata.hasAlpha ||
      metadata.hasProfile ||
      metadata.isPalette ||
      metadata.bitsPerSample !== 8 ||
      metadata.exif !== undefined ||
      metadata.icc !== undefined ||
      metadata.iptc !== undefined ||
      metadata.xmp !== undefined ||
      (metadata.comments !== undefined && metadata.comments.length > 0)
    ) {
      throw new Error("PNG metadata does not match deterministic RGB8 no-metadata policy");
    }
    const decoded = await sharp(bytes, decoderOptions).raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== evidence.widthPx ||
      decoded.info.height !== evidence.heightPx ||
      decoded.info.channels !== 3 ||
      decoded.data.length !== evidence.widthPx * evidence.heightPx * 3
    ) {
      throw new Error("PNG full decode does not match its manifest dimensions and channels");
    }
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      `${evidence.relativePath} failed deterministic PNG decode verification.`,
      error,
    );
  }
}

function sortedEntryNames(entries: readonly { readonly name: string }[]): readonly string[] {
  return entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
}

function assertExactReviewOutputEntries(
  entries: readonly { readonly name: string; readonly isFile: () => boolean; readonly isSymbolicLink: () => boolean }[],
): void {
  const expected = [
    ...GRAND_HALL_T554_REVIEW_OUTPUT_FILE_NAMES,
    GRAND_HALL_T554_MANIFEST_FILENAME,
  ].sort((left, right) => left.localeCompare(right));
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    JSON.stringify(sortedEntryNames(entries)) !== JSON.stringify(expected)
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Panorama review output inventory drifted; exactly two PNGs and one manifest are required.",
    );
  }
}

interface InspectedPersistedGrandHallT554PanoramaReviewPack {
  readonly outputDirectory: string;
  readonly manifest: GrandHallT554PanoramaReviewManifest;
  readonly manifestBytes: Buffer;
  readonly manifestFileSha256: `sha256:${string}`;
  readonly manifestFileByteLength: number;
  readonly outputBytes: ReadonlyMap<string, Buffer>;
}

async function inspectPersistedGrandHallT554PanoramaReviewPack(
  outputDirectory: string,
): Promise<InspectedPersistedGrandHallT554PanoramaReviewPack> {
  const root = await resolveDirectExistingOutputDirectory(outputDirectory);
  const entriesBefore = await readdir(root, { withFileTypes: true });
  assertExactReviewOutputEntries(entriesBefore);
  const stableManifest = await readStableOutputBytes(
    resolve(root, GRAND_HALL_T554_MANIFEST_FILENAME),
    GRAND_HALL_T554_MANIFEST_FILENAME,
    MAX_REVIEW_MANIFEST_BYTES,
  );
  const manifest = parsePersistedGrandHallT554Manifest(stableManifest.bytes);
  const outputBytes = new Map<string, Buffer>();
  for (const evidence of manifest.derivatives.outputs) {
    const stable = await readStableOutputBytes(
      resolve(root, evidence.relativePath),
      evidence.relativePath,
      MAX_REVIEW_PNG_BYTES,
      evidence.sha256,
      evidence.byteLength,
    );
    await verifyReviewPngDecode(stable.bytes, evidence);
    outputBytes.set(evidence.relativePath, stable.bytes);
  }
  const entriesAfter = await readdir(root, { withFileTypes: true });
  assertExactReviewOutputEntries(entriesAfter);
  if (comparablePath(await realpath(root)) !== comparablePath(root)) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Panorama review output directory identity changed during verification.",
    );
  }
  return {
    outputDirectory: root,
    manifest,
    manifestBytes: stableManifest.bytes,
    manifestFileSha256: stableManifest.sha256,
    manifestFileByteLength: stableManifest.byteLength,
    outputBytes,
  };
}

export interface VerifiedPersistedGrandHallT554PanoramaReviewPack {
  readonly outputDirectory: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly manifestFileSha256: `sha256:${string}`;
  readonly manifestFileByteLength: number;
  readonly outputCount: 2;
  readonly persistedInventoryVerified: true;
  readonly pngDecodeVerified: true;
  readonly authority: "none";
}

export async function verifyPersistedGrandHallT554PanoramaReviewPack(
  outputDirectory: string,
): Promise<VerifiedPersistedGrandHallT554PanoramaReviewPack> {
  const inspected = await inspectPersistedGrandHallT554PanoramaReviewPack(outputDirectory);
  return {
    outputDirectory: inspected.outputDirectory,
    manifestSha256: inspected.manifest.manifestSha256,
    manifestFileSha256: inspected.manifestFileSha256,
    manifestFileByteLength: inspected.manifestFileByteLength,
    outputCount: 2,
    persistedInventoryVerified: true,
    pngDecodeVerified: true,
    authority: "none",
  };
}

async function verifyWrittenFile(
  path: string,
  expectedSha256: `sha256:${string}`,
  expectedByteLength: number,
): Promise<void> {
  const digest = await sha256RegularFileWithHead(path, 0);
  if (`sha256:${digest.sha256}` !== expectedSha256 || digest.sizeBytes !== expectedByteLength) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      `Published review output failed digest verification: ${basename(path)}`,
    );
  }
}

interface PublishResult {
  readonly manifestFileSha256: `sha256:${string}`;
  readonly manifestFileByteLength: number;
}

async function publishReviewPack(
  outputDirectory: string,
  outputParent: string,
  assets: readonly RenderedReviewAsset[],
  manifest: GrandHallT554PanoramaReviewManifest,
): Promise<PublishResult> {
  const temporaryDirectory = resolve(
    outputParent,
    `.${basename(outputDirectory)}.partial-${String(process.pid)}-${randomUUID()}`,
  );
  if (
    !isGrandHallT554PathWithin(outputParent, temporaryDirectory) ||
    (await pathExists(temporaryDirectory))
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "Safe temporary output directory could not be allocated.",
    );
  }
  const manifestBytes = serializeManifest(manifest);
  const manifestFileSha256 =
    `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}` as const;
  try {
    await mkdir(temporaryDirectory, { recursive: false });
    for (const asset of assets) {
      const path = resolve(temporaryDirectory, asset.relativePath);
      await writeFile(path, asset.bytes, { flag: "wx" });
      await verifyWrittenFile(path, asset.sha256, asset.byteLength);
    }
    const manifestPath = resolve(temporaryDirectory, GRAND_HALL_T554_MANIFEST_FILENAME);
    await writeFile(manifestPath, manifestBytes, { flag: "wx" });
    await verifyWrittenFile(manifestPath, manifestFileSha256, manifestBytes.length);
    await rename(temporaryDirectory, outputDirectory);
    for (const asset of assets) {
      await verifyWrittenFile(
        resolve(outputDirectory, asset.relativePath),
        asset.sha256,
        asset.byteLength,
      );
    }
    await verifyWrittenFile(
      resolve(outputDirectory, GRAND_HALL_T554_MANIFEST_FILENAME),
      manifestFileSha256,
      manifestBytes.length,
    );
    const inspected = await inspectPersistedGrandHallT554PanoramaReviewPack(outputDirectory);
    assertPersistedPackMatchesExactBuild(inspected, { manifest, outputs: assets });
    return {
      manifestFileSha256: inspected.manifestFileSha256,
      manifestFileByteLength: inspected.manifestFileByteLength,
    };
  } catch (error) {
    if (await pathExists(temporaryDirectory)) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    if (errnoCode(error) === "EEXIST" || errnoCode(error) === "ENOTEMPTY") {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_ALREADY_EXISTS",
        "Review output appeared before atomic publication completed.",
        error,
      );
    }
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "Panorama review pack could not be published atomically.",
      error,
    );
  }
}

async function inspectCeilingPlan(path: string): Promise<GrandHallT554CeilingPlanEvidence> {
  const evidence = await inspectStableGrandHallT554Jpeg(
    requireAbsolutePath(path, "MatterPak ceiling colour plan"),
    GRAND_HALL_T554_CEILING_PLAN_SOURCE_LOCATOR,
  );
  if (
    evidence.sha256 !== GRAND_HALL_T554_CEILING_PLAN_SHA256 ||
    evidence.byteLength !== GRAND_HALL_T554_CEILING_PLAN_BYTE_LENGTH ||
    evidence.widthPx !== GRAND_HALL_T554_CEILING_PLAN_WIDTH_PX ||
    evidence.heightPx !== GRAND_HALL_T554_CEILING_PLAN_HEIGHT_PX
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "T550_BINDING_MISMATCH",
      "MatterPak ceilingcolorplan_001.jpg does not match the reviewed source identity.",
    );
  }
  return {
    ...evidence,
    sourceLocator: GRAND_HALL_T554_CEILING_PLAN_SOURCE_LOCATOR,
    authority: "none",
    role: "human_boundary_reference_only",
    closedBoundaryEstablished: false,
    poseAuthority: false,
    maskAuthority: false,
    reconstructionInputPermitted: false,
  };
}

export interface GenerateGrandHallT554PanoramaReviewPackOptions {
  readonly panoramaSourceRoot: string;
  readonly e57PreviewRoot: string;
  readonly t550MembershipPath: string;
  readonly ceilingColorPlanPath: string;
  readonly outputDirectory: string;
}

export interface GeneratedGrandHallT554PanoramaReviewPack {
  readonly outputDirectory: string;
  readonly manifest: GrandHallT554PanoramaReviewManifest;
  readonly manifestFileSha256: `sha256:${string}`;
  readonly manifestFileByteLength: number;
}

interface BuiltGrandHallT554PanoramaReviewPack {
  readonly manifest: GrandHallT554PanoramaReviewManifest;
  readonly outputs: readonly RenderedReviewAsset[];
}

type GrandHallT554PanoramaReviewSourceOptions = Omit<
  GenerateGrandHallT554PanoramaReviewPackOptions,
  "outputDirectory"
>;

async function buildGrandHallT554PanoramaReviewPackFromSources(
  options: GrandHallT554PanoramaReviewSourceOptions,
): Promise<BuiltGrandHallT554PanoramaReviewPack> {
  const membership = await loadT550Membership(options.t550MembershipPath);
  const inventory = await collectGrandHallT554PanoramaInventory({
    sourceRoot: options.panoramaSourceRoot,
  });
  const records = buildGrandHallT554PanoramaReviewRecords(inventory.files, membership.binding);
  const previews = await collectPreviewEvidence(options.e57PreviewRoot, membership.document);
  const ceilingPlan = await inspectCeilingPlan(options.ceilingColorPlanPath);
  const candidateRecords = records
    .filter(
      (record): record is GrandHallT554CandidateReviewRecord =>
        record.reviewEligibility === "t550_candidate_human_pending",
    )
    .sort((left, right) => left.candidateScanIndex - right.candidateScanIndex);
  const candidateByScan = new Map(
    candidateRecords.map((record) => [record.candidateScanIndex, record] as const),
  );
  const previewByScan = new Map(previews.map((record) => [record.scanIndex, record] as const));
  const panoramaRoot = await resolveDirectDirectory(
    options.panoramaSourceRoot,
    "Matterport panorama source root",
  );
  const previewRoot = await resolveDirectDirectory(
    options.e57PreviewRoot,
    "E57 diagnostic preview root",
  );
  const loadCandidateBytes: CandidateByteLoader = async (record) =>
    (
      await readStableBytesMatching(
        resolve(panoramaRoot, record.relativePath),
        record.sourceLocator,
        record.sha256,
        record.byteLength,
        MAX_JPEG_BYTES,
      )
    ).bytes;
  const loadPreviewBytes = async (record: GrandHallT554PreviewRecord): Promise<Buffer> =>
    (
      await readStableBytesMatching(
        resolve(previewRoot, record.relativePath),
        record.sourceLocator,
        record.sha256,
        record.byteLength,
        MAX_JPEG_BYTES,
      )
    ).bytes;
  const overview = await renderOverview(candidateRecords, loadCandidateBytes);
  const crosswalk = await renderCrosswalk({
    pairs: membership.document.sourceBindings.panoramaAuditSet.crosswalkEvidence.pairResults,
    candidates: candidateByScan,
    previews: previewByScan,
    loadCandidateBytes,
    loadPreviewBytes,
  });
  const outputs = [overview, crosswalk] as const;
  const manifest = buildGrandHallT554PanoramaReviewManifest({
    membership,
    inventory,
    records,
    previews,
    ceilingPlan,
    outputs,
  });
  return { manifest, outputs };
}

function assertPersistedPackMatchesExactBuild(
  persisted: InspectedPersistedGrandHallT554PanoramaReviewPack,
  expected: BuiltGrandHallT554PanoramaReviewPack,
): void {
  const expectedManifestBytes = serializeManifest(expected.manifest);
  if (!persisted.manifestBytes.equals(expectedManifestBytes)) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted panorama manifest differs from exact source regeneration.",
    );
  }
  for (const asset of expected.outputs) {
    const bytes = persisted.outputBytes.get(asset.relativePath);
    if (bytes === undefined || !bytes.equals(asset.bytes)) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        `${asset.relativePath} differs from exact source regeneration.`,
      );
    }
  }
}

export async function generateGrandHallT554PanoramaReviewPack(
  options: GenerateGrandHallT554PanoramaReviewPackOptions,
): Promise<GeneratedGrandHallT554PanoramaReviewPack> {
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [
      options.panoramaSourceRoot,
      options.e57PreviewRoot,
      dirname(options.ceilingColorPlanPath),
    ],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildGrandHallT554PanoramaReviewPackFromSources(options);
  const published = await publishReviewPack(
    safety.outputDirectory,
    safety.outputParent,
    built.outputs,
    built.manifest,
  );
  return {
    outputDirectory: safety.outputDirectory,
    manifest: built.manifest,
    ...published,
  };
}

export interface CheckedGrandHallT554PanoramaReviewPack
  extends VerifiedPersistedGrandHallT554PanoramaReviewPack {
  readonly exactRegenerationVerified: true;
}

export async function checkGrandHallT554PanoramaReviewPack(
  options: GenerateGrandHallT554PanoramaReviewPackOptions,
): Promise<CheckedGrandHallT554PanoramaReviewPack> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [
      options.panoramaSourceRoot,
      options.e57PreviewRoot,
      dirname(options.ceilingColorPlanPath),
    ],
    outputDirectory: options.outputDirectory,
  });
  const firstInspection = await inspectPersistedGrandHallT554PanoramaReviewPack(
    safety.outputDirectory,
  );
  const expected = await buildGrandHallT554PanoramaReviewPackFromSources(options);
  assertPersistedPackMatchesExactBuild(firstInspection, expected);
  const finalInspection = await inspectPersistedGrandHallT554PanoramaReviewPack(
    safety.outputDirectory,
  );
  assertPersistedPackMatchesExactBuild(finalInspection, expected);
  return {
    outputDirectory: finalInspection.outputDirectory,
    manifestSha256: finalInspection.manifest.manifestSha256,
    manifestFileSha256: finalInspection.manifestFileSha256,
    manifestFileByteLength: finalInspection.manifestFileByteLength,
    outputCount: 2,
    persistedInventoryVerified: true,
    pngDecodeVerified: true,
    exactRegenerationVerified: true,
    authority: "none",
  };
}
