/**
 * Reproducible source receipt for the non-authoritative Grand Hall room-9
 * surface selection. Absolute operator paths are inputs only and are never
 * copied into the receipt.
 *
 * E57 translations come from the provenance-safe staged extractor at
 * tools/twin-forge/e57-scripts/extract_e57_poses.py. This receipt generator
 * does not reopen a mutable historical E57 or duplicate pye57 extraction.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import {
  classifyVerticalFirstHits,
  computeGrandHallRoom9EvidenceSha256,
  computeGrandHallRoom9SourceReceiptSha256,
  GRAND_HALL_ROOM_9,
  parseMatterportObjText,
  summarizeMatterportRoomSelection,
  summarizeSharedVertexInterface,
  type CameraTranslation,
  type JsonValue,
  type ParsedMatterportObj,
  type VerticalFirstHitResult,
} from "./grand-hall-room9-boundary.js";
import { readE57LogicalBytes } from "./grand-hall-pilot-inspection.js";

const OBJ_FILENAME = "424ff41f6e5d41969c635fcd61be9b3f.obj";
const MTL_FILENAME = "424ff41f6e5d41969c635fcd61be9b3f.mtl";
const COLOR_PLAN_FILENAME = "colorplan_001.jpg";
const README_FILENAME = "readme.pdf";
const E57_FILENAME = "cloud_0.e57";
const MAX_E57_XML_LOGICAL_BYTES = 64 * 1024 * 1024;

const STAGED_PATHS = Object.freeze({
  obj: `source/matterpak/${OBJ_FILENAME}`,
  mtl: `source/matterpak/${MTL_FILENAME}`,
  colorPlan: `source/matterpak/${COLOR_PLAN_FILENAME}`,
  readme: `source/matterpak/${README_FILENAME}`,
  e57: `source/e57/${E57_FILENAME}`,
});

const SOURCE_LOCATORS = Object.freeze({
  obj: `MATTERPAK_SOURCE_ROOT/${OBJ_FILENAME}`,
  mtl: `MATTERPAK_SOURCE_ROOT/${MTL_FILENAME}`,
  colorPlan: `MATTERPAK_SOURCE_ROOT/${COLOR_PLAN_FILENAME}`,
  readme: `MATTERPAK_SOURCE_ROOT/${README_FILENAME}`,
  e57: `E57_SOURCE_ROOT/${E57_FILENAME}`,
});

export const GRAND_HALL_ROOM9_SOURCE_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-room9-source-receipt.v1";

export const GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE =
  "Grand Hall room-9 source receipt failed; no receipt was issued.";

export interface StableSourceIdentity {
  readonly sourceLocator: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

export interface E57PoseInventoryEvidence {
  readonly schemaVersion: "venviewer.e57-poses.v1";
  readonly captureStagePlanSha256: `sha256:${string}`;
  readonly captureStageManifestSha256: `sha256:${string}`;
  readonly sourceHashVerifiedThisRun: true;
  readonly extractorName: "pye57";
  readonly extractorVersion: string;
  readonly coordinateConvention: string;
  readonly scanCount: number;
  readonly poseSha256: `sha256:${string}`;
  readonly posesJsonFileSha256: `sha256:${string}`;
  readonly data3DGuidSha256: `sha256:${string}`;
  readonly embeddedPinholeImageCount: number;
  readonly imageProbeSchemaVersion: "venviewer.e57-image2d-probe.v1";
}

export interface MatterportCoordinateCrosswalkEvidence {
  readonly e57RootGuid: string;
  readonly matterpakObjStemGuid: string;
  readonly exactGuidMatch: true;
  readonly identityTransformUsedForClassifier: true;
  readonly classificationFrameAuthority: "diagnostic-only";
  readonly reviewedTransformArtifactPresent: false;
  readonly runtimeOverlayAuthority: false;
}

export interface E57SameRunVerification {
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly rootGuid: string;
  readonly fullByteHashVerifiedAgainstStageManifest: true;
  readonly stableFileIdentityBeforeAndAfter: true;
}

export interface GrandHallRoom9ReceiptInputs {
  readonly sources: {
    readonly obj: StableSourceIdentity;
    readonly mtl: StableSourceIdentity;
    readonly colorPlan: StableSourceIdentity & {
      readonly pixelWidth: number;
      readonly pixelHeight: number;
    };
    readonly readme: StableSourceIdentity;
    readonly e57: StableSourceIdentity;
  };
  readonly objText: string;
  readonly cameras: readonly CameraTranslation[];
  readonly e57PoseInventory: E57PoseInventoryEvidence;
  readonly e57SameRunVerification: E57SameRunVerification;
  readonly coordinateCrosswalk: MatterportCoordinateCrosswalkEvidence;
}

export interface BuiltGrandHallRoom9SourceReceipt {
  readonly material: JsonValue;
  readonly receiptSha256: `sha256:${string}`;
  readonly document: JsonValue;
}

export interface GrandHallRoom9SourceReceiptFileOptions {
  /** Verified capture stage root consumed by e57_stage_guard.py. */
  readonly captureStageRoot: string;
  /** Disjoint output directory previously created by extract_e57_poses.py. */
  readonly poseEvidenceRoot: string;
  /** probe-evidence.json previously created by probe_images2d.py. */
  readonly imageProbeEvidencePath: string;
  /** Optional deterministic test seam; production callers omit it. */
  readonly e57InspectionTestSeam?: E57InspectionTestSeam;
}

export interface E57InspectionTestSeam {
  /** Runs after the byte hash and before XML extraction/post-read identity checks. */
  readonly afterHashBeforeXmlRead?: () => void;
}

interface ObjRecordInventory {
  readonly vertexRecordCount: number;
  readonly textureCoordinateRecordCount: number;
  readonly faceRecordCount: number;
  readonly groupRecordCount: number;
  readonly useMaterialRecordCount: number;
}

interface ContiguousHitRange {
  readonly start: number;
  end: number;
  readonly state: "hit" | "no-hit";
  readonly groupIndex: number | null;
  readonly subIndex: number | null;
}

type JsonRecord = { readonly [key: string]: JsonValue };
type UnknownRecord = { readonly [key: string]: unknown };

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function requireNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function prefixedSha256(value: unknown, label: string): `sha256:${string}` {
  const text = requireString(value, label).toLowerCase();
  const normalized = text.startsWith("sha256:") ? text : `sha256:${text}`;
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return normalized as `sha256:${string}`;
}

function jsonValue(value: unknown, label = "$receipt"): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => jsonValue(entry, `${label}[${String(index)}]`));
  }
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = jsonValue(entry, `${label}.${key}`);
    }
    return output;
  }
  throw new Error(`${label} is not canonical JSON material`);
}

function validateSourceIdentity(identity: StableSourceIdentity): void {
  if (
    !/^(?:E57|MATTERPAK)_SOURCE_ROOT\/[A-Za-z0-9._/-]+$/u.test(identity.sourceLocator) ||
    identity.sourceLocator.includes("..") ||
    identity.sourceLocator.includes("\\")
  ) {
    throw new Error(`unsafe stable source locator: ${identity.sourceLocator}`);
  }
  requireNonnegativeInteger(identity.byteLength, `${identity.sourceLocator} byteLength`);
  prefixedSha256(identity.sha256, `${identity.sourceLocator} sha256`);
}

function inspectObjRecords(text: string): ObjRecordInventory {
  let vertexRecordCount = 0;
  let textureCoordinateRecordCount = 0;
  let faceRecordCount = 0;
  let groupRecordCount = 0;
  let useMaterialRecordCount = 0;
  for (const rawLine of text.split(/\r?\n/u)) {
    const recordType = rawLine.trimStart().split(/\s+/u, 1)[0];
    if (recordType === "v") vertexRecordCount += 1;
    else if (recordType === "vt") textureCoordinateRecordCount += 1;
    else if (recordType === "f") faceRecordCount += 1;
    else if (recordType === "g") groupRecordCount += 1;
    else if (recordType === "usemtl") useMaterialRecordCount += 1;
  }
  return {
    vertexRecordCount,
    textureCoordinateRecordCount,
    faceRecordCount,
    groupRecordCount,
    useMaterialRecordCount,
  };
}

function hitRanges(results: readonly VerticalFirstHitResult[]): ContiguousHitRange[] {
  const ranges: ContiguousHitRange[] = [];
  for (const result of results) {
    const last = ranges.at(-1);
    const groupIndex = result.state === "hit" ? result.group.groupIndex : null;
    const subIndex = result.state === "hit" ? result.group.subIndex : null;
    if (
      last !== undefined &&
      last.state === result.state &&
      last.groupIndex === groupIndex &&
      last.subIndex === subIndex &&
      last.end + 1 === result.cameraIndex
    ) {
      last.end = result.cameraIndex;
    } else {
      ranges.push({
        start: result.cameraIndex,
        end: result.cameraIndex,
        state: result.state,
        groupIndex,
        subIndex,
      });
    }
  }
  return ranges;
}

function boundaryCheck(result: VerticalFirstHitResult): JsonValue {
  if (result.state === "no-hit") {
    return {
      state: result.state,
      scanIndex: result.cameraIndex,
      poseTranslation: result.cameraTranslation,
    };
  }
  return {
    state: result.state,
    scanIndex: result.cameraIndex,
    poseTranslation: result.cameraTranslation,
    hitGroup: result.group.name,
    hitMaterial: result.material,
    sourceFaceOrdinal: result.sourceFaceOrdinal,
    hitDistanceMeters: result.distance,
    hitZMeters: result.hitPoint[2],
  };
}

function receiptMaterial(
  inputs: GrandHallRoom9ReceiptInputs,
  model: ParsedMatterportObj,
): JsonValue {
  for (const identity of Object.values(inputs.sources)) validateSourceIdentity(identity);
  if (
    inputs.coordinateCrosswalk.e57RootGuid !== inputs.coordinateCrosswalk.matterpakObjStemGuid ||
    inputs.coordinateCrosswalk.matterpakObjStemGuid !== OBJ_FILENAME.slice(0, -4)
  ) {
    throw new Error("E57 root GUID and MatterPak OBJ stem do not match");
  }
  if (
    inputs.e57SameRunVerification.sha256 !== inputs.sources.e57.sha256 ||
    inputs.e57SameRunVerification.byteLength !== inputs.sources.e57.byteLength ||
    inputs.e57SameRunVerification.rootGuid !== inputs.coordinateCrosswalk.e57RootGuid
  ) {
    throw new Error("same-run E57 verification does not bind the E57 source and GUID crosswalk");
  }
  if (inputs.sources.obj.sourceLocator !== SOURCE_LOCATORS.obj) {
    throw new Error(`OBJ locator must be ${SOURCE_LOCATORS.obj}`);
  }
  if (inputs.sources.mtl.sourceLocator !== SOURCE_LOCATORS.mtl) {
    throw new Error(`MTL locator must be ${SOURCE_LOCATORS.mtl}`);
  }
  if (inputs.sources.colorPlan.sourceLocator !== SOURCE_LOCATORS.colorPlan) {
    throw new Error(`colour-plan locator must be ${SOURCE_LOCATORS.colorPlan}`);
  }
  if (inputs.sources.readme.sourceLocator !== SOURCE_LOCATORS.readme) {
    throw new Error(`README locator must be ${SOURCE_LOCATORS.readme}`);
  }
  if (inputs.sources.e57.sourceLocator !== SOURCE_LOCATORS.e57) {
    throw new Error(`E57 locator must be ${SOURCE_LOCATORS.e57}`);
  }

  const records = inspectObjRecords(inputs.objText);
  const room = summarizeMatterportRoomSelection(model, GRAND_HALL_ROOM_9);
  const portal13 = summarizeSharedVertexInterface(model, GRAND_HALL_ROOM_9, {
    groupIndex: 1,
    subIndex: 13,
  });
  const portal14 = summarizeSharedVertexInterface(model, GRAND_HALL_ROOM_9, {
    groupIndex: 1,
    subIndex: 14,
  });
  const classification = classifyVerticalFirstHits(model, inputs.cameras);
  const grandHallScanIndices: number[] = [];
  const nonGrandHallScanIndices: number[] = [];
  const noHitScanIndices: number[] = [];
  for (const result of classification.results) {
    if (result.state === "no-hit") {
      noHitScanIndices.push(result.cameraIndex);
    } else if (result.group.groupIndex === 1 && result.group.subIndex === 9) {
      grandHallScanIndices.push(result.cameraIndex);
    } else {
      nonGrandHallScanIndices.push(result.cameraIndex);
    }
  }
  const requestedBoundaryChecks = new Set([0, 17, 18, 48, 49]);
  const first50BoundaryChecks = classification.results
    .filter((result) => requestedBoundaryChecks.has(result.cameraIndex))
    .map(boundaryCheck);
  if (first50BoundaryChecks.length !== requestedBoundaryChecks.size) {
    throw new Error("camera inventory is missing a required boundary-check index");
  }

  return jsonValue({
    schemaVersion: GRAND_HALL_ROOM9_SOURCE_RECEIPT_SCHEMA,
    generator: {
      implementationRef:
        "tools/reconstruction-foundry/src/grand-hall-room9-source-receipt.ts",
      classifierRef: "tools/reconstruction-foundry/src/grand-hall-room9-boundary.ts",
      poseExtractorRef: "tools/twin-forge/e57-scripts/extract_e57_poses.py",
      stageGuardRef: "tools/twin-forge/e57-scripts/e57_stage_guard.py",
      poseExtractorReadmeRef: "tools/twin-forge/README.md#verified-stage-reconstruction-inputs",
      sourceMutationPermitted: false,
      generatedGeometryUsed: false,
    },
    sourceBindings: inputs.sources,
    e57PoseInventory: inputs.e57PoseInventory,
    e57SameRunVerification: inputs.e57SameRunVerification,
    coordinateCrosswalk: inputs.coordinateCrosswalk,
    objInventory: records,
    room9FaceSelection: {
      groupCount: room.groupCount,
      faceCount: room.faceCount,
      uniqueVertexCount: room.uniqueVertexCount,
      materialCount: room.materialCount,
      connectedComponentCount: room.connectedComponentCount,
      verticesSharedWithOtherRoomGroups: room.sourceSharedVertexCount,
      boundsMeters: room.bounds,
      groupNames: room.groupNames,
    },
    cameraClassification: {
      method: classification.method,
      scanCount: classification.results.length,
      scanIndexMinimum: classification.results[0]?.cameraIndex ?? null,
      scanIndexMaximum: classification.results.at(-1)?.cameraIndex ?? null,
      grandHallRoom9ScanIndices: grandHallScanIndices,
      nonGrandHallScanIndices,
      noHitScanIndices,
      contiguousHitRanges: hitRanges(classification.results),
      first50BoundaryChecks,
    },
    portalInterfaceCandidates: [
      {
        roomA: portal13.roomA,
        roomB: portal13.roomB,
        sharedVertexCount: portal13.sharedVertexCount,
        boundsMeters: portal13.bounds,
      },
      {
        roomA: portal14.roomA,
        roomB: portal14.roomB,
        sharedVertexCount: portal14.sharedVertexCount,
        boundsMeters: portal14.bounds,
      },
    ],
  });
}

export function createGrandHallRoom9SourceReceipt(
  inputs: GrandHallRoom9ReceiptInputs,
): BuiltGrandHallRoom9SourceReceipt {
  const model = parseMatterportObjText(inputs.objText);
  const material = receiptMaterial(inputs, model);
  const receiptSha256 = computeGrandHallRoom9SourceReceiptSha256(material);
  if (material === null || Array.isArray(material) || typeof material !== "object") {
    throw new Error("source receipt material must be an object");
  }
  const materialRecord = material as JsonRecord;
  const document = jsonValue({ ...materialRecord, receiptSha256 });
  return { material, receiptSha256, document };
}

function fileSha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(path: string, label: string): UnknownRecord {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return requireRecord(parsed, label);
}

function safeFileWithin(root: string, relativePath: string): string {
  if (!isAbsolute(root)) throw new Error("verified source root must be absolute");
  if (relativePath.includes("\\") || isAbsolute(relativePath)) {
    throw new Error(`staged path must be canonical relative POSIX: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`staged path is not canonical: ${relativePath}`);
  }
  const unresolvedRoot = resolve(root);
  if (lstatSync(unresolvedRoot).isSymbolicLink()) {
    throw new Error("verified source root cannot be a symbolic link");
  }
  const realRoot = realpathSync(unresolvedRoot);
  let candidate = realRoot;
  for (const part of parts) {
    candidate = resolve(candidate, part);
    if (lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`staged path traverses a symbolic link: ${relativePath}`);
    }
  }
  const canonical = realpathSync(candidate);
  const fromRoot = relative(realRoot, canonical);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`staged path escapes the verified root: ${relativePath}`);
  }
  if (!statSync(canonical).isFile()) {
    throw new Error(`staged path is not a regular direct file: ${relativePath}`);
  }
  return canonical;
}

function safeDirectFile(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`${label} cannot be a symbolic link`);
  }
  const canonical = realpathSync(path);
  if (!statSync(canonical).isFile()) throw new Error(`${label} must be a regular file`);
  return canonical;
}

interface StageManifestFile {
  readonly targetRelativePath: string;
  readonly sizeBytes: number;
  readonly sha256: `sha256:${string}`;
}

function stageManifestFiles(manifest: UnknownRecord): Map<string, StageManifestFile> {
  if (manifest.schemaVersion !== "venviewer.capture-stage.v1") {
    throw new Error("unsupported capture-stage manifest schema");
  }
  if (!Array.isArray(manifest.files)) throw new Error("capture-stage files must be an array");
  const files = new Map<string, StageManifestFile>();
  for (const [index, value] of manifest.files.entries()) {
    const record = requireRecord(value, `capture-stage files[${String(index)}]`);
    const targetRelativePath = requireString(
      record.targetRelativePath,
      `capture-stage files[${String(index)}].targetRelativePath`,
    );
    if (files.has(targetRelativePath)) {
      throw new Error(`duplicate capture-stage target: ${targetRelativePath}`);
    }
    files.set(targetRelativePath, {
      targetRelativePath,
      sizeBytes: requireNonnegativeInteger(
        record.sizeBytes,
        `capture-stage ${targetRelativePath} sizeBytes`,
      ),
      sha256: prefixedSha256(record.sha256, `capture-stage ${targetRelativePath} sha256`),
    });
  }
  return files;
}

function requiredStageFile(
  files: ReadonlyMap<string, StageManifestFile>,
  targetRelativePath: string,
): StageManifestFile {
  const file = files.get(targetRelativePath);
  if (file === undefined) throw new Error(`capture stage omits ${targetRelativePath}`);
  return file;
}

function verifySmallStageFile(
  captureStageRoot: string,
  manifestFile: StageManifestFile,
  sourceLocator: string,
): StableSourceIdentity & { readonly bytes: Uint8Array } {
  const path = safeFileWithin(captureStageRoot, manifestFile.targetRelativePath);
  const bytes = readFileSync(path);
  const actualSha256 = fileSha256(bytes);
  if (bytes.byteLength !== manifestFile.sizeBytes || actualSha256 !== manifestFile.sha256) {
    throw new Error(`staged source differs from its manifest: ${manifestFile.targetRelativePath}`);
  }
  return {
    sourceLocator,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    bytes,
  };
}

function jpegDimensions(bytes: Uint8Array): { readonly pixelWidth: number; readonly pixelHeight: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("colour plan is not a JPEG");
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const high = bytes[offset];
    const low = bytes[offset + 1];
    if (high === undefined || low === undefined) break;
    const segmentLength = high * 256 + low;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error("colour-plan JPEG has an invalid segment length");
    }
    if (sofMarkers.has(marker)) {
      const heightHigh = bytes[offset + 3];
      const heightLow = bytes[offset + 4];
      const widthHigh = bytes[offset + 5];
      const widthLow = bytes[offset + 6];
      if (
        heightHigh === undefined ||
        heightLow === undefined ||
        widthHigh === undefined ||
        widthLow === undefined
      ) {
        throw new Error("colour-plan JPEG SOF segment is truncated");
      }
      return {
        pixelWidth: widthHigh * 256 + widthLow,
        pixelHeight: heightHigh * 256 + heightLow,
      };
    }
    offset += segmentLength;
  }
  throw new Error("colour-plan JPEG has no supported SOF marker");
}

interface FileIdentitySnapshot {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly modifiedNs: bigint;
  readonly changedNs: bigint;
}

export interface VerifiedE57Inspection {
  readonly rootGuid: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

function descriptorIdentity(descriptor: number): FileIdentitySnapshot {
  const stats = fstatSync(descriptor, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function pathIdentity(path: string): FileIdentitySnapshot {
  const stats = statSync(path, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function sameFileIdentity(left: FileIdentitySnapshot, right: FileIdentitySnapshot): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.modifiedNs === right.modifiedNs &&
    left.changedNs === right.changedNs
  );
}

function readE57RootGuidFromDescriptor(
  descriptor: number,
  fileByteLength: number,
): string {
  const header = Buffer.alloc(48);
  if (readSync(descriptor, header, 0, header.byteLength, 0) !== header.byteLength) {
    throw new Error("staged E57 header is truncated");
  }
  if (header.toString("ascii", 0, 8) !== "ASTM-E57") {
    throw new Error("staged source is not an ASTM E57 file");
  }
  const declaredPhysicalLength = Number(header.readBigUInt64LE(16));
  const xmlPhysicalOffset = Number(header.readBigUInt64LE(24));
  const xmlLogicalLength = Number(header.readBigUInt64LE(32));
  const pageSize = Number(header.readBigUInt64LE(40));
  if (
    declaredPhysicalLength !== fileByteLength ||
    !Number.isSafeInteger(xmlPhysicalOffset) ||
    !Number.isSafeInteger(xmlLogicalLength) ||
    xmlPhysicalOffset < 48 ||
    xmlLogicalLength <= 0 ||
    xmlLogicalLength > MAX_E57_XML_LOGICAL_BYTES ||
    pageSize !== 1024
  ) {
    throw new Error("staged E57 has an unsupported or inconsistent XML header layout");
  }
  const pageStart = Math.floor(xmlPhysicalOffset / 1024) * 1024;
  const offsetInPage = xmlPhysicalOffset - pageStart;
  const remainingPhysicalBytes = fileByteLength - pageStart;
  const fullRemainingPages = Math.floor(remainingPhysicalBytes / 1024);
  const partialRemainingPageBytes = remainingPhysicalBytes % 1024;
  const availableLogicalBytes =
    fullRemainingPages * 1020 + Math.min(partialRemainingPageBytes, 1020) - offsetInPage;
  if (
    pageStart < 0 ||
    pageStart >= fileByteLength ||
    offsetInPage < 0 ||
    offsetInPage >= 1020 ||
    xmlLogicalLength > availableLogicalBytes
  ) {
    throw new Error("staged E57 XML range exceeds the available paged payload");
  }
  const conservativePhysicalSpan =
    Math.ceil((offsetInPage + xmlLogicalLength) / 1020) * 1024 + 2048;
  const physicalSpan = Math.min(conservativePhysicalSpan, fileByteLength - pageStart);
  const physicalChunk = Buffer.alloc(physicalSpan);
  if (
    readSync(descriptor, physicalChunk, 0, physicalChunk.byteLength, pageStart) !==
    physicalChunk.byteLength
  ) {
    throw new Error("staged E57 XML range is truncated");
  }
  const xmlBytes = readE57LogicalBytes(
    new Uint8Array(
      physicalChunk.buffer,
      physicalChunk.byteOffset,
      physicalChunk.byteLength,
    ),
    offsetInPage,
    xmlLogicalLength,
  );
  const xml = new TextDecoder().decode(xmlBytes);
  const rootPrefixEnd = xml.search(/<data3D[\s>]/u);
  const rootPrefix = rootPrefixEnd < 0 ? xml : xml.slice(0, rootPrefixEnd);
  const match = /<guid[^>]*>\s*<!\[CDATA\[([0-9a-f]+)\]\]>\s*<\/guid>/u.exec(rootPrefix);
  if (match?.[1] === undefined || !/^[0-9a-f]{32}$/u.test(match[1])) {
    throw new Error("staged E57 XML does not expose one lowercase root GUID");
  }
  return match[1];
}

/**
 * Hashes and inspects the staged E57 through one open descriptor, then proves
 * the descriptor and path identity did not change before accepting the GUID.
 */
export function inspectRaceSafeE57Source(
  path: string,
  expected: StableSourceIdentity,
  testSeam: E57InspectionTestSeam = {},
): VerifiedE57Inspection {
  validateSourceIdentity(expected);
  const canonicalBefore = realpathSync(path);
  if (lstatSync(path).isSymbolicLink()) throw new Error("staged E57 cannot be a symbolic link");
  const descriptor = openSync(canonicalBefore, "r");
  try {
    const descriptorBefore = descriptorIdentity(descriptor);
    const pathBefore = pathIdentity(canonicalBefore);
    if (!sameFileIdentity(descriptorBefore, pathBefore)) {
      throw new Error("staged E57 path and open descriptor identities differ");
    }
    if (
      descriptorBefore.size !== BigInt(expected.byteLength) ||
      descriptorBefore.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("staged E57 byte length differs from the capture-stage manifest");
    }

    const digest = createHash("sha256");
    const block = Buffer.allocUnsafe(8 * 1024 * 1024);
    const byteLength = Number(descriptorBefore.size);
    let offset = 0;
    while (offset < byteLength) {
      const requested = Math.min(block.byteLength, byteLength - offset);
      const bytesRead = readSync(descriptor, block, 0, requested, offset);
      if (bytesRead <= 0) throw new Error("staged E57 ended during same-run hashing");
      digest.update(block.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const sha256: `sha256:${string}` = `sha256:${digest.digest("hex")}`;
    if (sha256 !== expected.sha256) {
      throw new Error("staged E57 SHA-256 differs from the capture-stage manifest");
    }
    testSeam.afterHashBeforeXmlRead?.();
    const rootGuid = readE57RootGuidFromDescriptor(descriptor, byteLength);

    const descriptorAfter = descriptorIdentity(descriptor);
    const canonicalAfter = realpathSync(path);
    const pathAfter = pathIdentity(canonicalAfter);
    if (
      canonicalAfter !== canonicalBefore ||
      lstatSync(path).isSymbolicLink() ||
      !sameFileIdentity(descriptorBefore, descriptorAfter) ||
      !sameFileIdentity(descriptorAfter, pathAfter)
    ) {
      throw new Error("staged E57 changed during same-run hash and XML inspection");
    }
    return { rootGuid, byteLength, sha256 };
  } finally {
    closeSync(descriptor);
  }
}

function finiteVector(value: unknown, length: number, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain ${String(length)} numbers`);
  }
  return value.map((entry, index) => requireFiniteNumber(entry, `${label}[${String(index)}]`));
}

/** Python 3 finite-float repr as used by json.dumps for pose vectors. */
function pythonFloatRepresentation(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Python canonical JSON rejects non-finite numbers");
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";

  const sign = value < 0 ? "-" : "";
  const javascript = Math.abs(value).toString();
  let digits: string;
  let exponent: number;
  if (javascript.includes("e")) {
    const [coefficient = "", exponentText = ""] = javascript.split("e");
    digits = coefficient.replace(".", "").replace(/^0+/u, "");
    exponent = Number(exponentText);
  } else {
    const [integer = "", fraction = ""] = javascript.split(".");
    if (integer !== "0") {
      digits = `${integer}${fraction}`.replace(/^0+/u, "");
      exponent = integer.length - 1;
    } else {
      let leadingZeros = 0;
      while (fraction[leadingZeros] === "0") leadingZeros += 1;
      digits = fraction.slice(leadingZeros);
      exponent = -(leadingZeros + 1);
    }
  }
  digits = digits.replace(/0+$/u, "") || "0";

  // CPython's finite float repr switches to scientific notation outside
  // exponents [-4, 15], pads exponent magnitude to two digits, and preserves
  // the `.0` marker for integer-valued floats in fixed notation.
  if (exponent < -4 || exponent >= 16) {
    const coefficient = `${digits[0] ?? "0"}${digits.length > 1 ? `.${digits.slice(1)}` : ""}`;
    const exponentSign = exponent < 0 ? "-" : "+";
    return `${sign}${coefficient}e${exponentSign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  const decimalPosition = exponent + 1;
  let body: string;
  if (decimalPosition <= 0) {
    body = `0.${"0".repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    body = `${digits}${"0".repeat(decimalPosition - digits.length)}.0`;
  } else {
    body = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  return `${sign}${body}`;
}

/**
 * Reproduces `e57_stage_guard.canonical_json_sha256(poses)` exactly for the
 * finite numeric pose schema emitted by extract_e57_poses.py.
 */
export function computePythonCanonicalPoseSha256(value: unknown): `sha256:${string}` {
  const poses = requireRecord(value, "poses JSON");
  const poseEntries: string[] = [];
  const keys = Object.keys(poses).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    if (!/^(?:0|[1-9]\d*)$/u.test(key)) throw new Error(`invalid pose key ${key}`);
    const pose = requireRecord(poses[key], `pose ${key}`);
    const poseKeys = Object.keys(pose).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (poseKeys.length !== 2 || poseKeys[0] !== "rotation" || poseKeys[1] !== "translation") {
      throw new Error(`pose ${key} must contain exactly rotation and translation`);
    }
    const rotation = finiteVector(pose.rotation, 4, `pose ${key} rotation`);
    const translation = finiteVector(pose.translation, 3, `pose ${key} translation`);
    const vector = (items: readonly number[]): string =>
      `[${items.map((item) => pythonFloatRepresentation(item)).join(",")}]`;
    poseEntries.push(
      `${JSON.stringify(key)}:{"rotation":${vector(rotation)},"translation":${vector(translation)}}`,
    );
  }
  const canonical = `{${poseEntries.join(",")}}`;
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function camerasFromPoseJson(value: UnknownRecord): CameraTranslation[] {
  const keys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
  const cameras: CameraTranslation[] = [];
  for (const [expectedIndex, key] of keys.entries()) {
    if (key !== String(expectedIndex)) {
      throw new Error(`pose keys must be contiguous from zero; expected ${String(expectedIndex)}`);
    }
    const pose = requireRecord(value[key], `pose ${key}`);
    const rotation = finiteVector(pose.rotation, 4, `pose ${key} rotation`);
    const norm = Math.hypot(...rotation);
    if (Math.abs(norm - 1) > 1e-5) throw new Error(`pose ${key} quaternion is not normalized`);
    const translation = finiteVector(pose.translation, 3, `pose ${key} translation`);
    cameras.push({
      index: expectedIndex,
      translation: [translation[0] ?? 0, translation[1] ?? 0, translation[2] ?? 0],
    });
  }
  return cameras;
}

function poseInventoryEvidence(
  poseEvidence: UnknownRecord,
  imageProbe: UnknownRecord,
  posesJson: UnknownRecord,
  posesJsonBytes: Uint8Array,
  cameras: readonly CameraTranslation[],
  stagePlanSha256: `sha256:${string}`,
  stageManifestSha256: `sha256:${string}`,
  e57: StageManifestFile,
): E57PoseInventoryEvidence {
  if (poseEvidence.schemaVersion !== "venviewer.e57-poses.v1") {
    throw new Error("unsupported E57 pose-evidence schema");
  }
  const captureStage = requireRecord(poseEvidence.captureStage, "pose-evidence captureStage");
  const sourceE57 = requireRecord(poseEvidence.sourceE57, "pose-evidence sourceE57");
  const extractor = requireRecord(poseEvidence.extractor, "pose-evidence extractor");
  const manifestSha = prefixedSha256(
    captureStage.manifestSha256,
    "pose-evidence captureStage.manifestSha256",
  );
  if (manifestSha !== stageManifestSha256) {
    throw new Error("pose evidence does not bind the supplied capture-stage manifest");
  }
  const sourceSha = prefixedSha256(sourceE57.sha256, "pose-evidence sourceE57.sha256");
  const sourceSize = requireNonnegativeInteger(
    sourceE57.sizeBytes,
    "pose-evidence sourceE57.sizeBytes",
  );
  if (sourceSha !== e57.sha256 || sourceSize !== e57.sizeBytes) {
    throw new Error("pose evidence E57 identity differs from the capture-stage manifest");
  }
  if (!requireBoolean(sourceE57.hashVerifiedThisRun, "sourceE57.hashVerifiedThisRun")) {
    throw new Error("pose extraction must have re-hashed the staged E57");
  }
  if (extractor.name !== "pye57") throw new Error("pose evidence must use pye57");
  const scanCount = requireNonnegativeInteger(poseEvidence.scanCount, "pose-evidence scanCount");
  if (scanCount !== cameras.length) throw new Error("pose count differs from pose evidence");
  const declaredPoseSha256 = prefixedSha256(
    poseEvidence.poseSha256,
    "pose-evidence poseSha256",
  );
  const computedPoseSha256 = computePythonCanonicalPoseSha256(posesJson);
  if (computedPoseSha256 !== declaredPoseSha256) {
    throw new Error("poses JSON canonical SHA-256 differs from pose evidence");
  }

  if (imageProbe.schemaVersion !== "venviewer.e57-image2d-probe.v1") {
    throw new Error("unsupported E57 image-probe schema");
  }
  const probeSourceSha = prefixedSha256(
    imageProbe.sourceE57Sha256,
    "image probe sourceE57Sha256",
  );
  const probePlanSha = prefixedSha256(
    imageProbe.captureStagePlanSha256,
    "image probe captureStagePlanSha256",
  );
  const posePlanSha = prefixedSha256(captureStage.planSha256, "captureStage.planSha256");
  if (posePlanSha !== stagePlanSha256) {
    throw new Error("pose evidence does not bind the capture-stage plan");
  }
  if (probeSourceSha !== e57.sha256 || probePlanSha !== stagePlanSha256) {
    throw new Error("image probe does not bind the same staged E57");
  }
  if (imageProbe.representation !== "pinholeRepresentation") {
    throw new Error("image probe did not observe a pinhole representation");
  }

  return {
    schemaVersion: "venviewer.e57-poses.v1",
    captureStagePlanSha256: stagePlanSha256,
    captureStageManifestSha256: manifestSha,
    sourceHashVerifiedThisRun: true,
    extractorName: "pye57",
    extractorVersion: requireString(extractor.version, "pose-evidence extractor.version"),
    coordinateConvention: requireString(
      poseEvidence.coordinateConvention,
      "pose-evidence coordinateConvention",
    ),
    scanCount,
    poseSha256: declaredPoseSha256,
    posesJsonFileSha256: fileSha256(posesJsonBytes),
    data3DGuidSha256: prefixedSha256(
      poseEvidence.data3DGuidSha256,
      "pose-evidence data3DGuidSha256",
    ),
    embeddedPinholeImageCount: requireNonnegativeInteger(
      imageProbe.imageCount,
      "image probe imageCount",
    ),
    imageProbeSchemaVersion: "venviewer.e57-image2d-probe.v1",
  };
}

export function createGrandHallRoom9SourceReceiptFromFiles(
  options: GrandHallRoom9SourceReceiptFileOptions,
): BuiltGrandHallRoom9SourceReceipt {
  const manifestPath = safeFileWithin(options.captureStageRoot, "capture-stage-manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  const manifest = requireRecord(JSON.parse(manifestBytes.toString("utf8")), "capture-stage manifest");
  const manifestFiles = stageManifestFiles(manifest);
  const stagePlanSha256 = prefixedSha256(
    manifest.planSha256,
    "capture-stage manifest planSha256",
  );
  const stageManifestSha256 = fileSha256(manifestBytes);

  const obj = verifySmallStageFile(
    options.captureStageRoot,
    requiredStageFile(manifestFiles, STAGED_PATHS.obj),
    SOURCE_LOCATORS.obj,
  );
  const mtl = verifySmallStageFile(
    options.captureStageRoot,
    requiredStageFile(manifestFiles, STAGED_PATHS.mtl),
    SOURCE_LOCATORS.mtl,
  );
  const colorPlan = verifySmallStageFile(
    options.captureStageRoot,
    requiredStageFile(manifestFiles, STAGED_PATHS.colorPlan),
    SOURCE_LOCATORS.colorPlan,
  );
  const readme = verifySmallStageFile(
    options.captureStageRoot,
    requiredStageFile(manifestFiles, STAGED_PATHS.readme),
    SOURCE_LOCATORS.readme,
  );
  const e57ManifestFile = requiredStageFile(manifestFiles, STAGED_PATHS.e57);
  const e57Path = safeFileWithin(options.captureStageRoot, STAGED_PATHS.e57);
  const e57SourceIdentity: StableSourceIdentity = {
    sourceLocator: SOURCE_LOCATORS.e57,
    byteLength: e57ManifestFile.sizeBytes,
    sha256: e57ManifestFile.sha256,
  };

  const poseEvidencePath = safeFileWithin(options.poseEvidenceRoot, "pose-evidence.json");
  const posesJsonPath = safeFileWithin(options.poseEvidenceRoot, "poses.json");
  const poseEvidence = readJson(poseEvidencePath, "pose evidence");
  const posesJsonBytes = readFileSync(posesJsonPath);
  const posesJson = requireRecord(JSON.parse(posesJsonBytes.toString("utf8")), "poses JSON");
  const cameras = camerasFromPoseJson(posesJson);
  const imageProbe = readJson(
    safeDirectFile(options.imageProbeEvidencePath, "image probe evidence"),
    "image probe evidence",
  );
  const dimensions = jpegDimensions(colorPlan.bytes);
  const e57PoseInventory = poseInventoryEvidence(
    poseEvidence,
    imageProbe,
    posesJson,
    posesJsonBytes,
    cameras,
    stagePlanSha256,
    stageManifestSha256,
    e57ManifestFile,
  );
  const e57Inspection = inspectRaceSafeE57Source(
    e57Path,
    e57SourceIdentity,
    options.e57InspectionTestSeam,
  );
  const observedE57RootGuid = e57Inspection.rootGuid;
  const matterpakObjStemGuid = OBJ_FILENAME.slice(0, -4);
  if (observedE57RootGuid !== matterpakObjStemGuid) {
    throw new Error("staged E57 root GUID does not match the MatterPak OBJ stem");
  }

  const sourceIdentity = (
    value: StableSourceIdentity & { readonly bytes: Uint8Array },
  ): StableSourceIdentity => ({
    sourceLocator: value.sourceLocator,
    byteLength: value.byteLength,
    sha256: value.sha256,
  });
  return createGrandHallRoom9SourceReceipt({
    sources: {
      obj: sourceIdentity(obj),
      mtl: sourceIdentity(mtl),
      colorPlan: { ...sourceIdentity(colorPlan), ...dimensions },
      readme: sourceIdentity(readme),
      e57: e57SourceIdentity,
    },
    objText: new TextDecoder().decode(obj.bytes),
    cameras,
    e57PoseInventory,
    e57SameRunVerification: {
      byteLength: e57Inspection.byteLength,
      sha256: e57Inspection.sha256,
      rootGuid: e57Inspection.rootGuid,
      fullByteHashVerifiedAgainstStageManifest: true,
      stableFileIdentityBeforeAndAfter: true,
    },
    coordinateCrosswalk: {
      e57RootGuid: observedE57RootGuid,
      matterpakObjStemGuid,
      exactGuidMatch: true,
      identityTransformUsedForClassifier: true,
      classificationFrameAuthority: "diagnostic-only",
      reviewedTransformArtifactPresent: false,
      runtimeOverlayAuthority: false,
    },
  });
}

function jsonRecord(value: JsonValue, label: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requireJsonPath(root: JsonRecord, path: readonly string[]): JsonValue {
  let current: JsonValue = root;
  for (const part of path) current = jsonRecord(current, path.join("."))[part] ?? null;
  return current;
}

/**
 * Fail closed if a persisted policy-bearing artifact drifts from the generated
 * source receipt. Human interpretation fields remain outside this comparison.
 */
export function verifyGrandHallRoom9EvidenceAgainstReceipt(
  evidence: JsonValue,
  receipt: BuiltGrandHallRoom9SourceReceipt,
): void {
  const root = jsonRecord(evidence, "evidence");
  const storedEvidenceSha256 = prefixedSha256(
    root.evidenceSha256,
    "evidence evidenceSha256",
  );
  const evidenceMaterial: { [key: string]: JsonValue } = { ...root };
  delete evidenceMaterial.evidenceSha256;
  const computedEvidenceSha256 = computeGrandHallRoom9EvidenceSha256(evidenceMaterial);
  if (storedEvidenceSha256 !== computedEvidenceSha256) {
    throw new Error("persisted evidence canonical self-digest does not match its material");
  }
  const generation = jsonRecord(requireJsonPath(root, ["generation"]), "evidence generation");
  if (generation.sourceReceiptSha256 !== receipt.receiptSha256) {
    throw new Error("persisted evidence sourceReceiptSha256 does not match generated receipt");
  }
  const receiptRoot = jsonRecord(receipt.material, "source receipt");
  const comparisons: readonly (readonly [readonly string[], readonly string[]])[] = [
    [["sourceBindings", "obj"], ["sourceBindings", "obj"]],
    [["sourceBindings", "mtl"], ["sourceBindings", "mtl"]],
    [["sourceBindings", "colorPlan"], ["sourceBindings", "colorPlan"]],
    [["sourceBindings", "matterpakReadme"], ["sourceBindings", "readme"]],
    [["sourceBindings", "e57"], ["sourceBindings", "e57"]],
    [["e57PoseInventory"], ["e57PoseInventory"]],
    [["e57SameRunVerification"], ["e57SameRunVerification"]],
    [["coordinateCrosswalk"], ["coordinateCrosswalk"]],
    [["objInventory"], ["objInventory"]],
    [["room9FaceSelection", "groupCount"], ["room9FaceSelection", "groupCount"]],
    [["room9FaceSelection", "faceCount"], ["room9FaceSelection", "faceCount"]],
    [["room9FaceSelection", "uniqueVertexCount"], ["room9FaceSelection", "uniqueVertexCount"]],
    [["room9FaceSelection", "materialCount"], ["room9FaceSelection", "materialCount"]],
    [
      ["room9FaceSelection", "connectedComponentCount"],
      ["room9FaceSelection", "connectedComponentCount"],
    ],
    [
      ["room9FaceSelection", "verticesSharedWithOtherRoomGroups"],
      ["room9FaceSelection", "verticesSharedWithOtherRoomGroups"],
    ],
    [["room9FaceSelection", "boundsMeters"], ["room9FaceSelection", "boundsMeters"]],
    [["room9FaceSelection", "groupNames"], ["room9FaceSelection", "groupNames"]],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "scanCount"],
      ["cameraClassification", "scanCount"],
    ],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "scanIndexMinimum"],
      ["cameraClassification", "scanIndexMinimum"],
    ],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "scanIndexMaximum"],
      ["cameraClassification", "scanIndexMaximum"],
    ],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "grandHallRoom9ScanIndices"],
      ["cameraClassification", "grandHallRoom9ScanIndices"],
    ],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "nonGrandHallScanIndices"],
      ["cameraClassification", "nonGrandHallScanIndices"],
    ],
    [
      ["verticalFirstHitClassification", "classifiedCameraSet", "noHitScanIndices"],
      ["cameraClassification", "noHitScanIndices"],
    ],
    [
      ["verticalFirstHitClassification", "method"],
      ["cameraClassification", "method"],
    ],
    [
      ["verticalFirstHitClassification", "contiguousHitRanges"],
      ["cameraClassification", "contiguousHitRanges"],
    ],
    [
      ["verticalFirstHitClassification", "first50BoundaryChecks"],
      ["cameraClassification", "first50BoundaryChecks"],
    ],
  ];
  for (const [evidencePath, receiptPath] of comparisons) {
    const left = requireJsonPath(root, evidencePath);
    const right = requireJsonPath(receiptRoot, receiptPath);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      throw new Error(`persisted evidence drift at ${evidencePath.join(".")}`);
    }
  }
  const artifactInterfaces = requireJsonPath(root, ["portalInterfaceCandidates"]);
  const receiptInterfaces = requireJsonPath(receiptRoot, ["portalInterfaceCandidates"]);
  if (!Array.isArray(artifactInterfaces) || !Array.isArray(receiptInterfaces)) {
    throw new Error("portal interface candidates must be arrays");
  }
  const artifactInterfaceArray = artifactInterfaces as readonly JsonValue[];
  const receiptInterfaceArray = receiptInterfaces as readonly JsonValue[];
  const artifactInterfaceProjection = artifactInterfaceArray.map((value) => {
    const record = jsonRecord(value, "artifact portal interface");
    return {
      roomA: record.roomA,
      roomB: record.roomB,
      sharedVertexCount: record.sharedVertexCount,
      boundsMeters: record.boundsMeters,
    };
  });
  if (JSON.stringify(artifactInterfaceProjection) !== JSON.stringify(receiptInterfaceArray)) {
    throw new Error("persisted portal interface evidence drifted from the source receipt");
  }
}
