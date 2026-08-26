/**
 * T-554 root review descriptor.
 *
 * This adapter only binds already-persisted authority-none boundary and
 * panorama review manifests. It does not accept room membership, resolve an
 * interface, author a closed volume, author a panorama mask, or manufacture
 * the T-555/T-557 artifacts that do not exist yet.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_REVIEW_PANORAMA_COUNT,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GrandHallPanoramaE57SequenceHypothesisSchema,
  GrandHallScopeReviewPackMaterialV1Schema,
  GrandHallScopeReviewPackV1Schema,
  computeGrandHallInterfaceInventorySha256,
  computeGrandHallPanoramaDirectoryInventorySha256,
  computeGrandHallPanoramaSourceInventorySha256,
  computeGrandHallScopeReviewPackV1Sha256,
  type GrandHallInterfaceCandidate,
  type GrandHallPanoramaDirectoryFileIdentity,
  type GrandHallPanoramaE57SequenceHypothesis,
  type GrandHallPanoramaSourceJpgIdentity,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";

import {
  GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA,
  verifyPersistedT554BoundaryReviewPack,
} from "./grand-hall-t554-boundary-review.js";
import { verifyPersistedT554InterfaceAtlasEvidence } from "./grand-hall-t554-interface-atlas.js";
import {
  GRAND_HALL_T554_MANIFEST_FILENAME,
  GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA,
  verifyPersistedGrandHallT554PanoramaReviewPack,
} from "./grand-hall-t554-panorama-review.js";

export const GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME = "review-pack.json";
export const GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME = "boundary";
export const GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME = "panoramas";
export const GRAND_HALL_T554_BOUNDARY_MANIFEST_FILENAME = "manifest.json";
export const GRAND_HALL_T554_INTERFACE_ATLAS_DIRECTORY_NAME = "interfaces";
export const GRAND_HALL_T554_ROOT_CREATED_AT = "2026-08-25T19:35:34.419Z";
export const GRAND_HALL_T554_ROOT_CREATED_BY = "venviewer-t554-root-descriptor-v1";

const T550_PENDING_MEMBERSHIP_SHA256 =
  "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68";
const T551_SOURCE_RECEIPT_SHA256 =
  "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b";
const T551_SOURCE_EVIDENCE_SHA256 =
  "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4";
const T553_XGRIDS_SOURCE_RECEIPT_SHA256 =
  "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a";
const MAX_BOUNDARY_MANIFEST_BYTES = 2 * 1_024 * 1_024;
const MAX_PANORAMA_MANIFEST_BYTES = 4 * 1_024 * 1_024;
const MAX_ROOT_REVIEW_PACK_BYTES = 2 * 1_024 * 1_024;

type Sha256 = `sha256:${string}`;
type UnknownRecord = Readonly<Record<string, unknown>>;

interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly links: bigint;
  readonly size: bigint;
  readonly modifiedNs: bigint;
  readonly changedNs: bigint;
}

interface FileObjectIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly size: bigint;
}

interface StableJsonFile {
  readonly bytes: Buffer;
  readonly document: UnknownRecord;
  readonly fileSha256: Sha256;
}

interface StableJsonReadPolicy {
  readonly expectedLinkCount: bigint;
  readonly expectedFileObjectIdentity?: FileObjectIdentity;
}

const SINGLE_LINK_JSON_READ_POLICY: StableJsonReadPolicy = Object.freeze({
  expectedLinkCount: 1n,
});

export interface GrandHallT554RootReviewPackDirectories {
  readonly rootDirectory: string;
  readonly boundaryDirectory: string;
  readonly panoramaDirectory: string;
}

export interface BuiltGrandHallT554RootReviewPack {
  readonly artifact: GrandHallScopeReviewPackV1;
  readonly bytes: Buffer;
  readonly boundaryManifestFileSha256: Sha256;
  readonly panoramaManifestFileSha256: Sha256;
}

export interface VerifiedGrandHallT554RootReviewPack {
  readonly path: string;
  readonly artifactSha256: string;
  readonly fileSha256: Sha256;
  readonly boundaryManifestSha256: string;
  readonly interfaceAtlasManifestSha256: string;
  readonly panoramaManifestSha256: string;
  readonly authority: "none";
  readonly exactRegenerationVerified: true;
}

export interface GrandHallT554RootReviewWriterTestSeam {
  readonly afterPublishBeforeVerification?: (
    outputPath: string,
  ) => void | Promise<void>;
}

export interface GrandHallT554RootReviewReaderTestSeam {
  readonly afterOpenBeforeRead?: (path: string, label: string) => void;
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function field(record: UnknownRecord, key: string, label: string): unknown {
  if (!Object.hasOwn(record, key)) throw new Error(`${label}.${key} is absent`);
  return record[key];
}

function recordField(record: UnknownRecord, key: string, label: string): UnknownRecord {
  return asRecord(field(record, key, label), `${label}.${key}`);
}

function arrayField(record: UnknownRecord, key: string, label: string): readonly unknown[] {
  const value = field(record, key, label);
  if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array`);
  return value;
}

function stringField(record: UnknownRecord, key: string, label: string): string {
  const value = field(record, key, label);
  if (typeof value !== "string") throw new Error(`${label}.${key} must be a string`);
  return value;
}

function integerField(record: UnknownRecord, key: string, label: string): number {
  const value = field(record, key, label);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label}.${key} must be a safe integer`);
  }
  return value;
}

function literalField(
  record: UnknownRecord,
  key: string,
  expected: string | number | boolean | null,
  label: string,
): void {
  if (field(record, key, label) !== expected) {
    throw new Error(`${label}.${key} differs from the required authority-none evidence`);
  }
}

function sha256Field(record: UnknownRecord, key: string, label: string): Sha256 {
  const value = stringField(record, key, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label}.${key} must be a lowercase SHA-256 identity`);
  }
  return value as Sha256;
}

function vec3Field(record: UnknownRecord, key: string, label: string): [number, number, number] {
  const values = arrayField(record, key, label);
  if (
    values.length !== 3 ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error(`${label}.${key} must be a finite three-component vector`);
  }
  return [values[0] as number, values[1] as number, values[2] as number];
}

function descriptorIdentity(descriptor: number): FileIdentity {
  const stats = fstatSync(descriptor, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    links: stats.nlink,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function directFileIdentity(path: string, label: string): FileIdentity {
  const stats = lstatSync(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be one direct regular file`);
  }
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    links: stats.nlink,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.links === right.links &&
    left.size === right.size &&
    left.modifiedNs === right.modifiedNs &&
    left.changedNs === right.changedNs
  );
}

function directFileObjectIdentity(path: string): FileObjectIdentity | null {
  try {
    const stats = lstatSync(path, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
    return {
      device: stats.dev,
      inode: stats.ino,
      mode: stats.mode,
      size: stats.size,
    };
  } catch {
    return null;
  }
}

function sameFileObject(left: FileObjectIdentity, right: FileObjectIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.size === right.size
  );
}

function unlinkPublishedOutputIfStillOwned(
  outputPath: string,
  publishedIdentity: FileObjectIdentity,
): void {
  const currentIdentity = directFileObjectIdentity(outputPath);
  if (currentIdentity !== null && sameFileObject(currentIdentity, publishedIdentity)) {
    unlinkSync(outputPath);
  }
}

function readStableJsonFile(
  path: string,
  maxBytes: number,
  label: string,
  testSeam: GrandHallT554RootReviewReaderTestSeam = {},
  policy: StableJsonReadPolicy = SINGLE_LINK_JSON_READ_POLICY,
): StableJsonFile {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  const pathBefore = directFileIdentity(path, label);
  if (pathBefore.links !== policy.expectedLinkCount) {
    throw new Error(`${label} hard-link count differs from its read policy`);
  }
  if (
    policy.expectedFileObjectIdentity !== undefined &&
    !sameFileObject(pathBefore, policy.expectedFileObjectIdentity)
  ) {
    throw new Error(`${label} is not the owned file object authorized by its read policy`);
  }
  const canonicalBefore = realpathSync(path);
  const descriptor = openSync(canonicalBefore, "r");
  try {
    const before = descriptorIdentity(descriptor);
    if (!sameIdentity(pathBefore, before)) {
      throw new Error(`${label} changed before its stable read`);
    }
    const byteLength = Number(before.size);
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maxBytes) {
      throw new Error(`${label} exceeds its bounded byte length`);
    }
    testSeam.afterOpenBeforeRead?.(path, label);
    const bytes = readFileSync(descriptor);
    const after = descriptorIdentity(descriptor);
    let pathAfter: FileIdentity;
    try {
      pathAfter = directFileIdentity(path, label);
    } catch {
      throw new Error(`${label} changed during its stable read`);
    }
    if (
      bytes.byteLength !== byteLength ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, pathAfter) ||
      realpathSync(path) !== canonicalBefore ||
      pathAfter.links !== policy.expectedLinkCount ||
      policy.expectedFileObjectIdentity !== undefined &&
        !sameFileObject(pathAfter, policy.expectedFileObjectIdentity)
    ) {
      throw new Error(`${label} changed during its stable read`);
    }
    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.charCodeAt(0) === 0xfeff) throw new Error("BOM");
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${label} must be strict UTF-8 JSON`);
    }
    return {
      bytes,
      document: asRecord(parsed, label),
      fileSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  } finally {
    closeSync(descriptor);
  }
}

function directReviewDirectories(rootDirectory: string): GrandHallT554RootReviewPackDirectories {
  const root = resolve(rootDirectory);
  if (!isAbsolute(root) || lstatSync(root).isSymbolicLink()) {
    throw new Error("T-554 review-pack root must be a direct absolute directory");
  }
  const canonicalRoot = realpathSync(root);
  if (canonicalRoot !== root || !statSync(root).isDirectory()) {
    throw new Error("T-554 review-pack root must resolve directly to one regular directory");
  }
  return {
    rootDirectory: root,
    boundaryDirectory: resolve(root, GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME),
    panoramaDirectory: resolve(root, GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME),
  };
}

function matterpakRoomKey(room: UnknownRecord, label: string): string {
  const groupIndex = integerField(room, "groupIndex", label);
  const subIndex = integerField(room, "subIndex", label);
  return `matterpak:g${String(groupIndex).padStart(3, "0")}:s${String(subIndex).padStart(3, "0")}`;
}

function boundaryInterfaces(boundary: UnknownRecord): readonly GrandHallInterfaceCandidate[] {
  const exhaustive = recordField(boundary, "exhaustiveSharedInterfaces", "boundary manifest");
  literalField(exhaustive, "interfaceCount", GRAND_HALL_EXACT_INTERFACE_COUNT, "boundary interfaces");
  literalField(exhaustive, "allInterfacesResolved", false, "boundary interfaces");
  const interfaces = arrayField(exhaustive, "interfaces", "boundary interfaces");
  if (interfaces.length !== GRAND_HALL_EXACT_INTERFACE_COUNT) {
    throw new Error("boundary manifest must expose all eight exact interfaces");
  }
  return interfaces.map((value, index) => {
    const label = `boundary interface ${String(index)}`;
    const candidate = asRecord(value, label);
    const roomA = matterpakRoomKey(recordField(candidate, "roomA", label), `${label}.roomA`);
    if (roomA !== GRAND_HALL_MATTERPAK_ROOM_KEY) {
      throw new Error(`${label} does not originate at exact MatterPak room 9`);
    }
    literalField(candidate, "reviewState", "pending", label);
    literalField(candidate, "disposition", null, label);
    const bounds = recordField(candidate, "boundsMeters", label);
    return {
      interfaceId: stringField(candidate, "interfaceId", label),
      grandHallRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      adjacentSourceRoomKey: matterpakRoomKey(
        recordField(candidate, "roomB", label),
        `${label}.roomB`,
      ),
      sharedSourceVertexCount: integerField(candidate, "sharedVertexCount", label),
      sharedSourceVertexSetSha256: sha256Field(
        candidate,
        "sharedVertexIndicesSha256",
        label,
      ),
      boundsMeters: {
        min: vec3Field(bounds, "min", `${label}.boundsMeters`),
        max: vec3Field(bounds, "max", `${label}.boundsMeters`),
      },
    };
  });
}

interface PanoramaInventories {
  readonly directoryFiles: readonly GrandHallPanoramaDirectoryFileIdentity[];
  readonly candidateSources: readonly GrandHallPanoramaSourceJpgIdentity[];
  readonly sequenceHypotheses: readonly GrandHallPanoramaE57SequenceHypothesis[];
}

function panoramaFileBase(record: UnknownRecord, inventoryIndex: number): {
  readonly inventoryIndex: number;
  readonly fileName: string;
  readonly sha256: Sha256;
  readonly byteLength: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sweepNumber: number;
} {
  const label = `panorama record ${String(inventoryIndex)}`;
  literalField(record, "authority", "none", label);
  literalField(record, "stableDuringRead", true, label);
  literalField(record, "trainingInputPermitted", false, label);
  literalField(record, "reconstructionInputPermitted", false, label);
  literalField(record, "runtimeInputPermitted", false, label);
  return {
    inventoryIndex,
    fileName: stringField(record, "relativePath", label),
    sha256: sha256Field(record, "sha256", label),
    byteLength: integerField(record, "byteLength", label),
    widthPx: integerField(record, "widthPx", label),
    heightPx: integerField(record, "heightPx", label),
    sweepNumber: integerField(record, "sweepNumber", label),
  };
}

function panoramaInventories(panorama: UnknownRecord): PanoramaInventories {
  const sourceBindings = recordField(panorama, "sourceBindings", "panorama manifest");
  const membership = recordField(sourceBindings, "t550Membership", "panorama source bindings");
  literalField(
    membership,
    "canonicalMembershipSha256",
    T550_PENDING_MEMBERSHIP_SHA256,
    "T-550 membership binding",
  );
  const inventory = recordField(sourceBindings, "panoramaInventory", "panorama source bindings");
  literalField(inventory, "fileCount", GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT, "panorama inventory");
  literalField(inventory, "candidateRecordCount", GRAND_HALL_REVIEW_PANORAMA_COUNT, "panorama inventory");
  literalField(
    inventory,
    "ineligibleUnreviewedRecordCount",
    GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - GRAND_HALL_REVIEW_PANORAMA_COUNT,
    "panorama inventory",
  );
  const records = arrayField(inventory, "records", "panorama inventory");
  if (records.length !== GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT) {
    throw new Error("panorama manifest must bind all 148 source JPEGs");
  }
  const directoryFiles: GrandHallPanoramaDirectoryFileIdentity[] = [];
  const candidateSources: GrandHallPanoramaSourceJpgIdentity[] = [];
  records.forEach((value, inventoryIndex) => {
    const record = asRecord(value, `panorama record ${String(inventoryIndex)}`);
    const base = panoramaFileBase(record, inventoryIndex);
    if (
      base.widthPx !== GRAND_HALL_PANORAMA_WIDTH_PX ||
      base.heightPx !== GRAND_HALL_PANORAMA_HEIGHT_PX
    ) {
      throw new Error(`panorama record ${String(inventoryIndex)} differs from the exact 8192x4096 inventory`);
    }
    const eligibility = stringField(record, "reviewEligibility", `panorama record ${String(inventoryIndex)}`);
    if (eligibility === "t550_candidate_human_pending") {
      directoryFiles.push({
        inventoryIndex,
        fileName: base.fileName,
        sha256: base.sha256,
        byteLength: base.byteLength,
        widthPx: base.widthPx,
        heightPx: base.heightPx,
        t554Eligibility: "candidate_numeric_sweep_1_through_50",
        embeddedSweepNumber: base.sweepNumber,
        t554ReviewState: "human_pending",
        ineligibilityReason: null,
      });
      candidateSources.push({
        sweepNumber: base.sweepNumber,
        fileName: base.fileName,
        sha256: base.sha256,
        byteLength: base.byteLength,
        widthPx: base.widthPx,
        heightPx: base.heightPx,
      });
      return;
    }
    if (eligibility !== "not_in_t550_ineligible_unreviewed") {
      throw new Error(`panorama record ${String(inventoryIndex)} has an unknown T-554 eligibility`);
    }
    directoryFiles.push({
      inventoryIndex,
      fileName: base.fileName,
      sha256: base.sha256,
      byteLength: base.byteLength,
      widthPx: base.widthPx,
      heightPx: base.heightPx,
      t554Eligibility: "ineligible_unreviewed",
      embeddedSweepNumber: base.sweepNumber,
      t554ReviewState: "not_reviewed_in_t554",
      ineligibilityReason: "embedded_sweep_number_outside_1_through_50",
    });
  });
  candidateSources.sort((left, right) => left.sweepNumber - right.sweepNumber);
  const hypothesisValues = arrayField(
    sourceBindings,
    "panoramaE57SequenceHypotheses",
    "panorama source bindings",
  );
  if (hypothesisValues.length !== GRAND_HALL_REVIEW_PANORAMA_COUNT) {
    throw new Error("panorama manifest must expose exactly 50 authority-none sequence hypotheses");
  }
  const sequenceHypotheses = hypothesisValues.map((value, index) => {
    const label = `panorama sequence hypothesis ${String(index)}`;
    const hypothesis = asRecord(value, label);
    return GrandHallPanoramaE57SequenceHypothesisSchema.parse({
      sourceSweepNumber: integerField(hypothesis, "sourceSweepNumber", label),
      sourceJpgFileName: stringField(hypothesis, "sourceJpgFileName", label),
      sourceJpgSha256: sha256Field(hypothesis, "sourceJpgSha256", label),
      candidateScanIndex: integerField(hypothesis, "candidateScanIndex", label),
      state: field(hypothesis, "state", label),
      authority: field(hypothesis, "authority", label),
      geometricCameraAuthority: field(hypothesis, "geometricCameraAuthority", label),
      trainingAuthority: field(hypothesis, "trainingAuthority", label),
      reconstructionAuthority: field(hypothesis, "reconstructionAuthority", label),
      runtimeAuthority: field(hypothesis, "runtimeAuthority", label),
    });
  });
  return {
    directoryFiles,
    candidateSources,
    sequenceHypotheses,
  };
}

function assertManifestHeaders(boundary: UnknownRecord, panorama: UnknownRecord): void {
  literalField(
    boundary,
    "schemaVersion",
    GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA,
    "boundary manifest",
  );
  const subject = recordField(boundary, "subject", "boundary manifest");
  literalField(subject, "venueSlug", "trades-hall", "boundary subject");
  literalField(subject, "roomSlug", "grand-hall", "boundary subject");
  const lineage = recordField(boundary, "lineage", "boundary manifest");
  literalField(lineage, "t551SourceReceiptSha256", T551_SOURCE_RECEIPT_SHA256, "boundary lineage");
  literalField(lineage, "t551BoundaryEvidenceSha256", T551_SOURCE_EVIDENCE_SHA256, "boundary lineage");
  literalField(panorama, "schemaVersion", GRAND_HALL_T554_PANORAMA_REVIEW_SCHEMA, "panorama manifest");
  literalField(panorama, "authority", "none", "panorama manifest");
  literalField(panorama, "reviewState", "human_pending", "panorama manifest");
}

function rootArtifact(
  boundary: StableJsonFile,
  panorama: StableJsonFile,
  boundaryManifestSha256: Sha256,
  interfaceAtlasManifestSha256: Sha256,
  panoramaManifestSha256: Sha256,
): GrandHallScopeReviewPackV1 {
  assertManifestHeaders(boundary.document, panorama.document);
  literalField(boundary.document, "manifestSha256", boundaryManifestSha256, "boundary manifest");
  literalField(panorama.document, "manifestSha256", panoramaManifestSha256, "panorama manifest");
  const interfaces = boundaryInterfaces(boundary.document);
  const panoramas = panoramaInventories(panorama.document);
  const directoryInventorySha256 = computeGrandHallPanoramaDirectoryInventorySha256(
    panoramas.directoryFiles,
  );
  const candidateInventorySha256 = computeGrandHallPanoramaSourceInventorySha256(
    panoramas.candidateSources,
  );
  const interfaceInventorySha256 = computeGrandHallInterfaceInventorySha256(interfaces);
  const material = {
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: GRAND_HALL_T554_ROOT_CREATED_AT,
    createdBy: GRAND_HALL_T554_ROOT_CREATED_BY,
    authority: "none",
    reviewState: "human_pending",
    runtimeAuthorized: false,
    trainingAuthorized: false,
    generatedContentAuthorized: false,
    productionTrust: null,
    sourceEvidence: {
      t550PendingMembershipV1Sha256: T550_PENDING_MEMBERSHIP_SHA256,
      t551SourceEvidenceSha256: T551_SOURCE_EVIDENCE_SHA256,
      t551SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
      xgridsSourceReceiptSha256: T553_XGRIDS_SOURCE_RECEIPT_SHA256,
      matterPakE57SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
      panoramaDirectoryInventorySha256: directoryInventorySha256,
      boundaryReviewManifestSha256: boundaryManifestSha256,
      interfaceTopologyAtlasManifestSha256: interfaceAtlasManifestSha256,
      panoramaReviewManifestSha256: panoramaManifestSha256,
    },
    panoramaDirectoryFiles: [...panoramas.directoryFiles],
    candidatePanoramaSources: [...panoramas.candidateSources],
    panoramaSourceInventorySha256: candidateInventorySha256,
    panoramaE57SequenceHypotheses: [...panoramas.sequenceHypotheses],
    interfaceCandidates: [...interfaces],
    interfaceInventorySha256,
    proposalArtifacts: {
      roomMembership: {
        state: "source_candidate_present_human_pending",
        artifactSha256: T550_PENDING_MEMBERSHIP_SHA256,
      },
      portalDecisions: { state: "not_authored_human_pending", artifactSha256: null },
      closedSelectionVolume: { state: "not_authored_human_pending", artifactSha256: null },
      panoramaMaskSet: { state: "not_authored_human_pending", artifactSha256: null },
    },
    deferredArtifacts: {
      reviewedTransform: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
      outputInventoryMask: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
    },
    requiredHumanDecisions: [
      "accept_or_reject_room_membership",
      "resolve_every_interface",
      "accept_or_reject_closed_selection_volume",
      "accept_or_reject_every_panorama_mask",
    ],
  };
  const parsedMaterial = GrandHallScopeReviewPackMaterialV1Schema.parse(material);
  return GrandHallScopeReviewPackV1Schema.parse({
    ...parsedMaterial,
    artifactSha256: computeGrandHallScopeReviewPackV1Sha256(parsedMaterial),
  });
}

function serializedArtifact(artifact: GrandHallScopeReviewPackV1): Buffer {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

async function verifiedSourceManifests(
  directories: GrandHallT554RootReviewPackDirectories,
  testSeam: GrandHallT554RootReviewReaderTestSeam,
): Promise<{
  readonly boundary: StableJsonFile;
  readonly panorama: StableJsonFile;
  readonly boundaryManifestSha256: Sha256;
  readonly interfaceAtlasManifestSha256: Sha256;
  readonly panoramaManifestSha256: Sha256;
}> {
  const firstBoundaryDigest = verifyPersistedT554BoundaryReviewPack(
    directories.boundaryDirectory,
  );
  const firstInterfaceAtlas = verifyPersistedT554InterfaceAtlasEvidence(
    resolve(directories.boundaryDirectory, GRAND_HALL_T554_INTERFACE_ATLAS_DIRECTORY_NAME),
  );
  const firstPanorama = await verifyPersistedGrandHallT554PanoramaReviewPack(
    directories.panoramaDirectory,
  );
  const boundary = readStableJsonFile(
    resolve(directories.boundaryDirectory, GRAND_HALL_T554_BOUNDARY_MANIFEST_FILENAME),
    MAX_BOUNDARY_MANIFEST_BYTES,
    "T-554 boundary manifest",
    testSeam,
  );
  const panorama = readStableJsonFile(
    resolve(directories.panoramaDirectory, GRAND_HALL_T554_MANIFEST_FILENAME),
    MAX_PANORAMA_MANIFEST_BYTES,
    "T-554 panorama manifest",
    testSeam,
  );
  const finalBoundaryDigest = verifyPersistedT554BoundaryReviewPack(
    directories.boundaryDirectory,
  );
  const finalInterfaceAtlas = verifyPersistedT554InterfaceAtlasEvidence(
    resolve(directories.boundaryDirectory, GRAND_HALL_T554_INTERFACE_ATLAS_DIRECTORY_NAME),
  );
  const finalPanorama = await verifyPersistedGrandHallT554PanoramaReviewPack(
    directories.panoramaDirectory,
  );
  if (
    firstBoundaryDigest !== finalBoundaryDigest ||
    firstInterfaceAtlas.manifestSha256 !== finalInterfaceAtlas.manifestSha256 ||
    firstPanorama.manifestSha256 !== finalPanorama.manifestSha256
  ) {
    throw new Error("a T-554 source manifest changed between its two persisted verifications");
  }
  if (
    firstInterfaceAtlas.boundaryReviewManifestSha256 !== firstBoundaryDigest ||
    finalInterfaceAtlas.boundaryReviewManifestSha256 !== finalBoundaryDigest
  ) {
    throw new Error("the T-554 interface atlas does not bind the exact boundary manifest");
  }
  return {
    boundary,
    panorama,
    boundaryManifestSha256: finalBoundaryDigest,
    interfaceAtlasManifestSha256: finalInterfaceAtlas.manifestSha256,
    panoramaManifestSha256: finalPanorama.manifestSha256,
  };
}

export async function buildGrandHallT554RootReviewPack(
  rootDirectory: string,
  testSeam: GrandHallT554RootReviewReaderTestSeam = {},
): Promise<BuiltGrandHallT554RootReviewPack> {
  const directories = directReviewDirectories(rootDirectory);
  const verified = await verifiedSourceManifests(directories, testSeam);
  const artifact = rootArtifact(
    verified.boundary,
    verified.panorama,
    verified.boundaryManifestSha256,
    verified.interfaceAtlasManifestSha256,
    verified.panoramaManifestSha256,
  );
  return {
    artifact,
    bytes: serializedArtifact(artifact),
    boundaryManifestFileSha256: verified.boundary.fileSha256,
    panoramaManifestFileSha256: verified.panorama.fileSha256,
  };
}

export async function writeGrandHallT554RootReviewPack(
  rootDirectory: string,
  testSeam: GrandHallT554RootReviewWriterTestSeam = {},
): Promise<string> {
  const directories = directReviewDirectories(rootDirectory);
  const outputPath = resolve(directories.rootDirectory, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME);
  if (existsSync(outputPath)) throw new Error("T-554 root review descriptor already exists");
  const built = await buildGrandHallT554RootReviewPack(directories.rootDirectory);
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.partial-${String(process.pid)}-${randomUUID()}`,
  );
  let published = false;
  let publishedIdentity: FileObjectIdentity | null = null;
  try {
    writeFileSync(temporaryPath, built.bytes, { flag: "wx" });
    publishedIdentity = directFileObjectIdentity(temporaryPath);
    if (publishedIdentity === null) {
      throw new Error("T-554 temporary descriptor is not one direct regular file");
    }
    linkSync(temporaryPath, outputPath);
    published = true;
    // Retain the private hard link until verification finishes. A replacement
    // at outputPath therefore cannot reuse the published file identity while
    // failure cleanup decides which directory entry it is allowed to unlink.
    await testSeam.afterPublishBeforeVerification?.(outputPath);
    const verified = await verifyPersistedGrandHallT554RootReviewPackWithPolicy(
      directories.rootDirectory,
      {},
      {
        expectedLinkCount: 2n,
        expectedFileObjectIdentity: publishedIdentity,
      },
    );
    if (verified.artifactSha256 !== built.artifact.artifactSha256) {
      throw new Error("published T-554 root descriptor differs from its exact build");
    }
    unlinkSync(temporaryPath);
    return verified.artifactSha256;
  } catch (error) {
    if (published && publishedIdentity !== null) {
      unlinkPublishedOutputIfStillOwned(outputPath, publishedIdentity);
    }
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function verifyPersistedGrandHallT554RootReviewPackWithPolicy(
  rootDirectory: string,
  testSeam: GrandHallT554RootReviewReaderTestSeam,
  rootDescriptorReadPolicy: StableJsonReadPolicy,
): Promise<VerifiedGrandHallT554RootReviewPack> {
  const directories = directReviewDirectories(rootDirectory);
  const built = await buildGrandHallT554RootReviewPack(directories.rootDirectory, testSeam);
  const outputPath = resolve(directories.rootDirectory, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME);
  const persisted = readStableJsonFile(
    outputPath,
    MAX_ROOT_REVIEW_PACK_BYTES,
    "T-554 root review descriptor",
    testSeam,
    rootDescriptorReadPolicy,
  );
  const parsed = GrandHallScopeReviewPackV1Schema.parse(persisted.document);
  if (!persisted.bytes.equals(built.bytes) || parsed.artifactSha256 !== built.artifact.artifactSha256) {
    throw new Error("persisted T-554 root descriptor differs from exact manifest regeneration");
  }
  return {
    path: outputPath,
    artifactSha256: parsed.artifactSha256,
    fileSha256: persisted.fileSha256,
    boundaryManifestSha256: parsed.sourceEvidence.boundaryReviewManifestSha256,
    interfaceAtlasManifestSha256: parsed.sourceEvidence.interfaceTopologyAtlasManifestSha256,
    panoramaManifestSha256: parsed.sourceEvidence.panoramaReviewManifestSha256,
    authority: "none",
    exactRegenerationVerified: true,
  };
}

export async function verifyPersistedGrandHallT554RootReviewPack(
  rootDirectory: string,
  testSeam: GrandHallT554RootReviewReaderTestSeam = {},
): Promise<VerifiedGrandHallT554RootReviewPack> {
  return verifyPersistedGrandHallT554RootReviewPackWithPolicy(
    rootDirectory,
    testSeam,
    SINGLE_LINK_JSON_READ_POLICY,
  );
}
