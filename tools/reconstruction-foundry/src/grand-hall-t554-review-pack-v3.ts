import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_SCOPE_REVIEW_PACK_V3,
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GRAND_HALL_T554_HUMAN_DECISIONS_V3,
  GrandHallScopeReviewPackMaterialV3Schema,
  GrandHallScopeReviewPackV3Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  GrandHallT554HumanDecisionsV3Schema,
  computeGrandHallScopeReviewPackV3Sha256,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  computeGrandHallT554HumanDecisionsV3Sha256,
  type GrandHallScopeReviewPackV3,
  type GrandHallT554ClosedVolumeReviewV1,
  type GrandHallT554HumanDecisionsV3,
} from "@omnitwin/types";
import { stableCanonicalJson, toCanonicalJson } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
  GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
  checkGrandHallT554CleanupMarkerEvidencePack,
  parseGrandHallT554CleanupMarkerEvidence,
  parseGrandHallT554CleanupMarkerReceipt,
  type ExactSourceRegeneratedGrandHallT554CleanupMarkerEvidencePack,
  type GrandHallT554CleanupMarkerEvidence,
  type GrandHallT554CleanupMarkerReceipt,
} from "./grand-hall-t554-cleanup-marker-evidence.js";
import { GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME } from "./grand-hall-t554-review-pack.js";
import {
  buildGrandHallT554ReviewPackV2,
  loadGrandHallT554ReviewPackV2Sources,
  type GrandHallT554ReviewPackV2SourceBundle,
} from "./grand-hall-t554-review-pack-v2.js";
import {
  GRAND_HALL_T561_MANIFEST_FILENAME,
  GRAND_HALL_T561_RECEIPT_FILENAME,
  checkGrandHallT561ObservationPack,
  type VerifiedGrandHallT561ObservationPack,
} from "./grand-hall-t561-panorama-visual-observation.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_MAX_JSON_BYTES,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA,
  GrandHallT554ReviewPackV3Error,
  grandHallT554V3FileSha256,
  parseGrandHallT554ReviewPackV3Receipt,
  parseGrandHallT554ReviewPackV3TestReceipt,
  sealGrandHallT554ReviewPackV3Receipt,
  sealGrandHallT554ReviewPackV3TestReceipt,
  serializeGrandHallT554V3Json,
  type GrandHallT554ReviewPackV3Receipt,
  type GrandHallT554ReviewPackV3TestReceipt,
  type GrandHallT554V3Sha256,
} from "./grand-hall-t554-review-pack-v3-contract.js";
import {
  assertGrandHallT554V3ExistingOutputSafety,
  assertGrandHallT554V3NewOutputSafety,
  assertGrandHallT554V3OwnedDirectory,
  assertGrandHallT554V3SnapshotsEqual,
  grandHallT554V3ComparablePath,
  grandHallT554V3SameFileState,
  readGrandHallT554V3ExactFlatDirectory,
  readGrandHallT554V3StableDirectFile,
  snapshotGrandHallT554V3DirectDirectory,
  writeGrandHallT554V3ExclusiveSyncedFile,
  type GrandHallT554V3CanonicalNodeInput,
  type GrandHallT554V3DirectorySnapshot,
  type GrandHallT554V3OutputSafety,
  type GrandHallT554V3SnapshotRead,
  type GrandHallT554V3SnapshotReadTestSeam,
  type GrandHallT554V3StableFile,
} from "./grand-hall-t554-review-pack-v3-files.js";

export {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  GrandHallT554ReviewPackV3Error,
} from "./grand-hall-t554-review-pack-v3-contract.js";

const EXPECTED_OUTPUT_NAMES = Object.freeze([
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
] as const);

export interface GrandHallT554ReviewPackV3Options {
  readonly predecessorReviewRoot: string;
  readonly panoramaSourceRoot: string;
  readonly t554PanoramaPackDirectory: string;
  readonly t561ObservationInputPath: string;
  readonly t561ObservationPackDirectory: string;
  readonly cleanupCaptureStageRoot: string;
  readonly cleanupSourceBoundaryEvidencePath: string;
  readonly cleanupEvidencePackDirectory: string;
  readonly outputDirectory: string;
}

export interface VerifiedGrandHallT554ReviewPackV3 {
  readonly verificationMode: "published_exact_sources" | "checked_exact_regeneration";
  readonly exactRegenerationVerified: true;
  readonly reviewPackSha256: GrandHallT554V3Sha256;
  readonly receiptSha256: GrandHallT554V3Sha256;
  readonly panoramaDecisionCount: 148;
  readonly observedGrandHallPixelSourceCount: 74;
  readonly noObservedGrandHallPixelSourceCount: 74;
  readonly absentSweepNumbersWithin1To149: readonly [93];
  readonly interfaceDecisionCount: 8;
  readonly cleanupInspectionCount: 2;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly nativeResolutionHumanReviewCompleted: false;
}

interface ReviewBoundFiles {
  readonly predecessor: GrandHallT554V3StableFile;
  readonly observationInput: GrandHallT554V3StableFile;
  readonly observationManifest: GrandHallT554V3StableFile;
  readonly observationReceipt: GrandHallT554V3StableFile;
}

interface CleanupBoundFiles {
  readonly read: GrandHallT554V3SnapshotRead;
  readonly evidenceFile: GrandHallT554V3StableFile;
  readonly receiptFile: GrandHallT554V3StableFile;
  readonly evidence: GrandHallT554CleanupMarkerEvidence;
  readonly receipt: GrandHallT554CleanupMarkerReceipt;
}

export interface GrandHallT554ReviewPackV3SourceBundle {
  readonly review: GrandHallT554ReviewPackV2SourceBundle;
  readonly reviewFiles: ReviewBoundFiles;
  readonly t561Exact: VerifiedGrandHallT561ObservationPack & {
    readonly exactRegenerationVerified: true;
  };
  readonly cleanupExact: ExactSourceRegeneratedGrandHallT554CleanupMarkerEvidencePack;
  readonly cleanupFiles: CleanupBoundFiles;
}

type GrandHallT554ReviewPackV3AnyReceipt =
  | GrandHallT554ReviewPackV3Receipt
  | GrandHallT554ReviewPackV3TestReceipt;

interface GrandHallT554ReviewPackV3BuiltPack<
  Receipt extends GrandHallT554ReviewPackV3AnyReceipt,
> {
  readonly reviewPack: GrandHallScopeReviewPackV3;
  readonly humanDecisions: GrandHallT554HumanDecisionsV3;
  readonly closedVolumeTemplate: GrandHallT554ClosedVolumeReviewV1;
  readonly payloads: ReadonlyMap<string, Buffer>;
  readonly receipt: Receipt;
  readonly receiptBytes: Buffer;
}

type BuiltGrandHallT554ReviewPackV3 = GrandHallT554ReviewPackV3BuiltPack<
  GrandHallT554ReviewPackV3Receipt
>;
type AnyBuiltGrandHallT554ReviewPackV3 = GrandHallT554ReviewPackV3BuiltPack<
  GrandHallT554ReviewPackV3AnyReceipt
>;

/** Test-only built artifact type; excluded from the package root. */
export type GrandHallT554ReviewPackV3TestBuiltPack =
  GrandHallT554ReviewPackV3BuiltPack<GrandHallT554ReviewPackV3TestReceipt>;

interface PersistedV3Pack {
  readonly read: GrandHallT554V3SnapshotRead;
  readonly reviewPack: GrandHallScopeReviewPackV3;
  readonly humanDecisions: GrandHallT554HumanDecisionsV3;
  readonly closedVolume: GrandHallT554ClosedVolumeReviewV1;
  readonly receipt: GrandHallT554ReviewPackV3AnyReceipt;
}

type GrandHallT554ReviewPackV3ReceiptKind = "production" | "structural_test_only";

interface ExactCheckRunners {
  readonly checkT561: typeof checkGrandHallT561ObservationPack;
  readonly checkCleanup: typeof checkGrandHallT554CleanupMarkerEvidencePack;
  readonly loadReview: typeof loadGrandHallT554ReviewPackV2Sources;
}

const EXACT_CHECK_RUNNERS: ExactCheckRunners = {
  checkT561: checkGrandHallT561ObservationPack,
  checkCleanup: checkGrandHallT554CleanupMarkerEvidencePack,
  loadReview: loadGrandHallT554ReviewPackV2Sources,
};

function sourceNodes(
  options: GrandHallT554ReviewPackV3Options,
): readonly GrandHallT554V3CanonicalNodeInput[] {
  return [
    { path: options.predecessorReviewRoot, label: "T-554 v1 root", kind: "directory" },
    { path: options.panoramaSourceRoot, label: "Panorama source root", kind: "directory" },
    { path: options.t554PanoramaPackDirectory, label: "T-554 panorama pack", kind: "directory" },
    { path: options.t561ObservationInputPath, label: "T-561 observation input", kind: "file" },
    { path: options.t561ObservationPackDirectory, label: "T-561 observation pack", kind: "directory" },
    { path: options.cleanupCaptureStageRoot, label: "Cleanup capture stage", kind: "directory" },
    { path: options.cleanupSourceBoundaryEvidencePath, label: "T-551 source evidence", kind: "file" },
    { path: options.cleanupEvidencePackDirectory, label: "Cleanup evidence pack", kind: "directory" },
  ];
}

async function readReviewBoundFiles(
  options: GrandHallT554ReviewPackV3Options,
): Promise<ReviewBoundFiles> {
  const read = (path: string, label: string) => readGrandHallT554V3StableDirectFile(
    path, GRAND_HALL_T554_V3_MAX_JSON_BYTES, label, "SOURCE_INVALID",
  );
  const [predecessor, observationInput, observationManifest, observationReceipt] =
    await Promise.all([
      read(resolve(options.predecessorReviewRoot, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME), "T-554 v1 review pack"),
      read(options.t561ObservationInputPath, "T-561 observation input"),
      read(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_MANIFEST_FILENAME), "T-561 manifest"),
      read(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_RECEIPT_FILENAME), "T-561 receipt"),
    ]);
  return { predecessor, observationInput, observationManifest, observationReceipt };
}

function assertStableSourceFile(
  before: GrandHallT554V3StableFile,
  after: GrandHallT554V3StableFile,
  label: string,
): void {
  if (!before.bytes.equals(after.bytes) || before.sha256 !== after.sha256 ||
    !grandHallT554V3SameFileState(before.stats, after.stats)) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", `${label} changed across V3 source-verification phases.`,
    );
  }
}

function assertReviewFilesStable(
  before: ReviewBoundFiles,
  after: ReviewBoundFiles,
): void {
  assertStableSourceFile(before.predecessor, after.predecessor, "T-554 v1 review pack");
  assertStableSourceFile(before.observationInput, after.observationInput, "T-561 observation input");
  assertStableSourceFile(before.observationManifest, after.observationManifest, "T-561 manifest");
  assertStableSourceFile(before.observationReceipt, after.observationReceipt, "T-561 receipt");
}

function assertReviewBundleFiles(
  review: GrandHallT554ReviewPackV2SourceBundle,
  files: ReviewBoundFiles,
): void {
  const pairs = [
    [review.predecessorFile, files.predecessor],
    [review.observationInputFile, files.observationInput],
    [review.observationManifestFile, files.observationManifest],
    [review.observationReceiptFile, files.observationReceipt],
  ] as const;
  if (pairs.some(([bundleFile, directFile]) =>
    bundleFile.sha256 !== directFile.sha256 || !bundleFile.bytes.equals(directFile.bytes)
  )) throw new GrandHallT554ReviewPackV3Error(
    "SOURCE_INVALID", "V2 source parsing was not bound to the V3 descriptor reads.",
  );
}

function requireReadFile(
  read: GrandHallT554V3SnapshotRead,
  name: string,
  code: "SOURCE_INVALID" | "OUTPUT_VERIFICATION_FAILED" = "OUTPUT_VERIFICATION_FAILED",
): GrandHallT554V3StableFile {
  const file = read.files.get(name);
  if (file === undefined) throw new GrandHallT554ReviewPackV3Error(
    code, `Required file ${name} was not read.`,
  );
  return file;
}

async function readCleanupBoundFiles(directory: string): Promise<CleanupBoundFiles> {
  const names = [
    GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
  ] as const;
  try {
    const read = await readGrandHallT554V3ExactFlatDirectory(
      directory, names, GRAND_HALL_T554_V3_MAX_JSON_BYTES,
    );
    const evidenceFile = requireReadFile(read, names[0], "SOURCE_INVALID");
    const receiptFile = requireReadFile(read, names[1], "SOURCE_INVALID");
    return { read, evidenceFile, receiptFile,
      evidence: parseGrandHallT554CleanupMarkerEvidence(evidenceFile.bytes),
      receipt: parseGrandHallT554CleanupMarkerReceipt(receiptFile.bytes) };
  } catch (error) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", "Cleanup evidence input could not be bound safely.", error,
    );
  }
}

function assertCleanupReceiptBinding(files: CleanupBoundFiles): void {
  const { evidence, receipt, evidenceFile } = files;
  if (receipt.evidenceSha256 !== evidence.evidenceSha256 ||
    receipt.cleanupTargetInventorySha256 !== evidence.cleanupTargetInventorySha256 ||
    receipt.payload.byteLength !== evidenceFile.bytes.length ||
    receipt.payload.sha256 !== evidenceFile.sha256) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", "Cleanup evidence and receipt are not exactly byte-cross-bound.",
    );
  }
}

function assertCleanupExactSummary(
  exact: ExactSourceRegeneratedGrandHallT554CleanupMarkerEvidencePack,
  files: CleanupBoundFiles,
): void {
  if (grandHallT554V3ComparablePath(exact.outputDirectory) !==
      grandHallT554V3ComparablePath(dirname(files.evidenceFile.absolutePath)) ||
    exact.evidenceSha256 !== files.evidence.evidenceSha256 ||
    exact.cleanupTargetInventorySha256 !== files.evidence.cleanupTargetInventorySha256 ||
    exact.receiptSha256 !== files.receipt.receiptSha256 ||
    exact.evidenceFileSha256 !== files.evidenceFile.sha256 ||
    exact.receiptFileSha256 !== files.receiptFile.sha256) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", "Cleanup persisted bytes differ from their real exact-source check.",
    );
  }
}

function assertT561ExactSummary(
  exact: VerifiedGrandHallT561ObservationPack & { readonly exactRegenerationVerified: true },
  review: GrandHallT554ReviewPackV2SourceBundle,
  files: ReviewBoundFiles,
): void {
  if (exact.absentSweepNumbersWithin1To149.join(",") !== "93" ||
    grandHallT554V3ComparablePath(exact.outputDirectory) !==
      grandHallT554V3ComparablePath(dirname(files.observationManifest.absolutePath)) ||
    exact.outputFileCount !== review.observationReceipt.outputFileCount ||
    exact.reviewAidCount !== review.observationManifest.reviewAids.length ||
    exact.manifestSha256 !== review.observationManifest.manifestSha256 ||
    exact.receiptSha256 !== review.observationReceipt.receiptSha256) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", "T-561 parsed bindings differ from the real exact-regeneration check.",
    );
  }
}

function assertT551CleanupBinding(
  review: GrandHallT554ReviewPackV2SourceBundle,
  cleanup: CleanupBoundFiles,
): void {
  const t551 = review.predecessor.sourceEvidence.t551SourceEvidenceSha256;
  const boundaryManifest = review.predecessor.sourceEvidence.boundaryReviewManifestSha256;
  if (t551 === boundaryManifest ||
    cleanup.evidence.sourceBindings.room9SourceBoundaryEvidence.evidenceSha256 !== t551) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID",
      "Cleanup evidence must bind the concrete T-551 source evidence, not its review manifest.",
    );
  }
}

function t561Options(options: GrandHallT554ReviewPackV3Options) {
  return { panoramaSourceRoot: options.panoramaSourceRoot,
    t554PanoramaPackDirectory: options.t554PanoramaPackDirectory,
    observationInputPath: options.t561ObservationInputPath,
    outputDirectory: options.t561ObservationPackDirectory };
}

function cleanupOptions(options: GrandHallT554ReviewPackV3Options) {
  return { captureStageRoot: options.cleanupCaptureStageRoot,
    sourceBoundaryEvidencePath: options.cleanupSourceBoundaryEvidencePath,
    outputDirectory: options.cleanupEvidencePackDirectory };
}

async function loadVerifiedSources(
  options: GrandHallT554ReviewPackV3Options,
  runners: ExactCheckRunners,
): Promise<GrandHallT554ReviewPackV3SourceBundle> {
  const [t561Exact, cleanupExact] = await Promise.all([
    runners.checkT561(t561Options(options)),
    runners.checkCleanup(cleanupOptions(options)),
  ]);
  const [reviewFilesBefore, cleanupBefore] = await Promise.all([
    readReviewBoundFiles(options), readCleanupBoundFiles(options.cleanupEvidencePackDirectory),
  ]);
  const review = await runners.loadReview(options);
  const [reviewFilesAfter, cleanupFiles] = await Promise.all([
    readReviewBoundFiles(options), readCleanupBoundFiles(options.cleanupEvidencePackDirectory),
  ]);
  assertReviewFilesStable(reviewFilesBefore, reviewFilesAfter);
  assertGrandHallT554V3SnapshotsEqual(cleanupBefore.read.final, cleanupFiles.read.initial,
    "Cleanup evidence changed across V3 source-verification phases.");
  assertReviewBundleFiles(review, reviewFilesAfter);
  assertT561ExactSummary(t561Exact, review, reviewFilesAfter);
  assertCleanupReceiptBinding(cleanupFiles);
  assertCleanupExactSummary(cleanupExact, cleanupFiles);
  assertT551CleanupBinding(review, cleanupFiles);
  return { review, reviewFiles: reviewFilesAfter, t561Exact, cleanupExact, cleanupFiles };
}

function buildReviewPack(
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): GrandHallScopeReviewPackV3 {
  const v2 = buildGrandHallT554ReviewPackV2(bundle.review).reviewPack;
  const { artifactSha256: _discardedArtifactSha256, ...v2Material } = v2;
  void _discardedArtifactSha256;
  const material = GrandHallScopeReviewPackMaterialV3Schema.parse({
    ...v2Material,
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    createdBy: "venviewer-t554-v3-human-pending-generator-v1",
    sourceEvidence: { ...v2.sourceEvidence,
      cleanupMarkerEvidenceSha256: bundle.cleanupFiles.evidence.evidenceSha256,
      cleanupTargetInventorySha256:
        bundle.cleanupFiles.evidence.cleanupTargetInventorySha256 },
  });
  return GrandHallScopeReviewPackV3Schema.parse({ ...material,
    artifactSha256: computeGrandHallScopeReviewPackV3Sha256(material) });
}

function pendingPanoramaDecisions(pack: GrandHallScopeReviewPackV3) {
  return pack.panoramaRecords.map((record) => ({ source: record.source,
    sourceObservation: record.observation, result: "UNSURE" as const,
    classification: null, maskFileName: null, reviewedMaskBinding: null,
    maskReviewed: false, nativeResolutionHumanReviewCompleted: false,
    nativeReviewEvidenceSha256: null, maskReasonCodes: [], note: null }));
}

function pendingCleanupInspections(pack: GrandHallScopeReviewPackV3) {
  return (["Window", "Mirror"] as const).map((artifactClass) => ({ artifactClass,
    sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
    cleanupMarkerEvidenceSha256: pack.sourceEvidence.cleanupMarkerEvidenceSha256,
    cleanupTargetInventorySha256: pack.sourceEvidence.cleanupTargetInventorySha256,
    localizationState: null, reviewedTargetIds: [], nativeSourceReviewCompleted: false,
    result: "UNSURE" as const, note: null }));
}

function buildHumanDecisions(
  pack: GrandHallScopeReviewPackV3,
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): GrandHallT554HumanDecisionsV3 {
  return GrandHallT554HumanDecisionsV3Schema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    venueSlug: "trades-hall", roomSlug: "grand-hall",
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    authority: "none", reviewState: "human_pending", finalDecision: "PENDING",
    reviewer: null, nativeResolutionHumanReviewCompleted: false,
    nativeReviewEvidenceSetSha256: null, generatedFillPermitted: false,
    geometricCameraAuthority: "none", matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: bundle.review.predecessor.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      result: "UNSURE", note: null }, cleanupArtifactInspections: pendingCleanupInspections(pack),
    closedSelectionVolumeDecision: { reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      reviewArtifactSha256: null, result: "UNSURE", note: null }, panoramaDecisionCount: 148,
    panoramaDecisions: pendingPanoramaDecisions(pack),
    interfaceDecisions: pack.interfaceCandidates.map((source) => ({ source,
      result: "UNSURE" as const, reviewedClosurePlaneBinding: null, note: null })),
    sourceInterfaceInventorySha256: pack.interfaceInventorySha256,
  });
}

function buildClosedVolume(
  pack: GrandHallScopeReviewPackV3,
): GrandHallT554ClosedVolumeReviewV1 {
  return GrandHallT554ClosedVolumeReviewV1Schema.parse({
    schemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
    venueSlug: "trades-hall", roomSlug: "grand-hall",
    reviewPackSha256: pack.artifactSha256, authority: "none",
    reviewState: "human_pending", finalDecision: "PENDING", reviewer: null,
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME, units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon", footprintXY: [], zMin: null,
    zMax: null, rendered: false, collisionGeometry: false,
    exportedAsArchitecture: false, generatedGeometryCreated: false, note: null,
  });
}

function payloadRows(payloads: ReadonlyMap<string, Buffer>) {
  return [...payloads].map(([relativePath, bytes]) => ({ relativePath,
    byteLength: bytes.length, sha256: grandHallT554V3FileSha256(bytes) }))
    .sort((left, right) => left.relativePath < right.relativePath ? -1 : 1);
}

function receiptSourceBindings(bundle: GrandHallT554ReviewPackV3SourceBundle) {
  const review = bundle.review;
  const files = bundle.reviewFiles;
  const cleanup = bundle.cleanupFiles;
  return {
    predecessorReviewPackArtifactSha256: review.predecessor.artifactSha256,
    predecessorReviewPackFileSha256: files.predecessor.sha256,
    predecessorReviewPackFileByteLength: files.predecessor.bytes.length,
    t561ObservationInputFileSha256: files.observationInput.sha256,
    t561ObservationInputFileByteLength: files.observationInput.bytes.length,
    t561ObservationSetSha256: review.observationInput.observationSetSha256,
    t561ManifestSha256: review.observationManifest.manifestSha256,
    t561ManifestFileSha256: files.observationManifest.sha256,
    t561ManifestFileByteLength: files.observationManifest.bytes.length,
    t561ReceiptSha256: review.observationReceipt.receiptSha256,
    t561ReceiptFileSha256: files.observationReceipt.sha256,
    t561ReceiptFileByteLength: files.observationReceipt.bytes.length,
    t551SourceEvidenceSha256: review.predecessor.sourceEvidence.t551SourceEvidenceSha256,
    cleanupMarkerEvidenceSha256: cleanup.evidence.evidenceSha256,
    cleanupTargetInventorySha256: cleanup.evidence.cleanupTargetInventorySha256,
    cleanupEvidenceFileSha256: cleanup.evidenceFile.sha256,
    cleanupEvidenceFileByteLength: cleanup.evidenceFile.bytes.length,
    cleanupReceiptSha256: cleanup.receipt.receiptSha256,
    cleanupReceiptFileSha256: cleanup.receiptFile.sha256,
    cleanupReceiptFileByteLength: cleanup.receiptFile.bytes.length,
  };
}

function receiptCommon(
  pack: GrandHallScopeReviewPackV3,
  decisions: GrandHallT554HumanDecisionsV3,
  volume: GrandHallT554ClosedVolumeReviewV1,
  payloads: ReadonlyMap<string, Buffer>,
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): object {
  return { authority: "none", sourceBindings: receiptSourceBindings(bundle),
    reviewPackSha256: pack.artifactSha256,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsV3Sha256(decisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewV1Sha256(volume),
    payloadFileCount: 3, outputFileCount: 4, payloads: payloadRows(payloads),
    guards: { humanAcceptanceRecorded: false,
      nativeResolutionHumanReviewCompleted: false, masksAuthored: false,
      cleanupAuthority: "none", roomMembershipAuthority: "none",
      interfaceAuthority: "none", closedVolumeAuthority: "none",
      trainingAuthorized: false, reconstructionAuthorized: false,
      runtimeAuthorized: false, generatedContentAuthorized: false,
      publicEvidenceAuthorized: false }, receiptWrittenLast: true,
  };
}

function buildReceipt(
  artifacts: PayloadArtifacts,
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): GrandHallT554ReviewPackV3Receipt {
  return sealGrandHallT554ReviewPackV3Receipt({
    schemaVersion: GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
    state: "complete_human_pending",
    exactSourceChecks: { t561ExactRegenerationVerified: true,
      cleanupExactRegenerationVerified: true },
    ...receiptCommon(artifacts.reviewPack, artifacts.humanDecisions,
      artifacts.closedVolumeTemplate, artifacts.payloads, bundle),
  });
}

function buildTestReceipt(
  artifacts: PayloadArtifacts,
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): GrandHallT554ReviewPackV3TestReceipt {
  return sealGrandHallT554ReviewPackV3TestReceipt({
    schemaVersion: GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA,
    state: "structural_test_only",
    exactSourceChecks: { t561ExactRegenerationVerified: false,
      cleanupExactRegenerationVerified: false },
    ...receiptCommon(artifacts.reviewPack, artifacts.humanDecisions,
      artifacts.closedVolumeTemplate, artifacts.payloads, bundle),
  });
}

interface PayloadArtifacts {
  readonly reviewPack: GrandHallScopeReviewPackV3;
  readonly humanDecisions: GrandHallT554HumanDecisionsV3;
  readonly closedVolumeTemplate: GrandHallT554ClosedVolumeReviewV1;
  readonly payloads: ReadonlyMap<string, Buffer>;
}

function buildPayloadArtifacts(
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): PayloadArtifacts {
  const reviewPack = buildReviewPack(bundle);
  const humanDecisions = buildHumanDecisions(reviewPack, bundle);
  const closedVolumeTemplate = buildClosedVolume(reviewPack);
  const payloads = new Map<string, Buffer>([
    [GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
      serializeGrandHallT554V3Json(closedVolumeTemplate)],
    [GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
      serializeGrandHallT554V3Json(humanDecisions)],
    [GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
      serializeGrandHallT554V3Json(reviewPack)],
  ]);
  return { reviewPack, humanDecisions, closedVolumeTemplate, payloads };
}

function buildVerifiedGrandHallT554ReviewPackV3(
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): BuiltGrandHallT554ReviewPackV3 {
  const artifacts = buildPayloadArtifacts(bundle);
  const receipt = buildReceipt(artifacts, bundle);
  return { ...artifacts, receipt,
    receiptBytes: serializeGrandHallT554V3Json(receipt) };
}

function parseReceiptByKind(
  bytes: Buffer,
  kind: GrandHallT554ReviewPackV3ReceiptKind,
): GrandHallT554ReviewPackV3AnyReceipt {
  return kind === "production"
    ? parseGrandHallT554ReviewPackV3Receipt(bytes)
    : parseGrandHallT554ReviewPackV3TestReceipt(bytes);
}

function serializedPayloadArtifacts(
  built: AnyBuiltGrandHallT554ReviewPackV3,
): ReadonlyMap<string, Buffer> {
  return new Map([
    [GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
      serializeGrandHallT554V3Json(built.closedVolumeTemplate)],
    [GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
      serializeGrandHallT554V3Json(built.humanDecisions)],
    [GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
      serializeGrandHallT554V3Json(built.reviewPack)],
  ]);
}

interface PreflightedV3Publication {
  readonly payloads: readonly (readonly [string, Buffer])[];
  readonly receiptBytes: Buffer;
  readonly files: ReadonlyMap<string, Buffer>;
}

function assertBuiltPreflight(
  built: AnyBuiltGrandHallT554ReviewPackV3,
  receiptKind: GrandHallT554ReviewPackV3ReceiptKind,
): PreflightedV3Publication {
  const expected = serializedPayloadArtifacts(built);
  const payloadsValid = built.payloads.size === expected.size && [...expected].every(
    ([name, bytes]) => built.payloads.get(name)?.equals(bytes) === true,
  );
  const receipt = parseReceiptByKind(built.receiptBytes, receiptKind);
  const receiptBytesValid = built.receiptBytes.equals(serializeGrandHallT554V3Json(receipt));
  const receiptObjectValid = canonicalValuesEqual(receipt, built.receipt);
  const receiptPayloadsValid = receipt.payloads.every((payload) => {
      const bytes = built.payloads.get(payload.relativePath);
      return bytes !== undefined && bytes.length === payload.byteLength &&
        grandHallT554V3FileSha256(bytes) === payload.sha256;
    });
  if (!payloadsValid || !receiptBytesValid || !receiptObjectValid || !receiptPayloadsValid) {
    const failed = [!payloadsValid && "payload-map", !receiptBytesValid && "receipt-bytes",
      !receiptObjectValid && "receipt-object", !receiptPayloadsValid && "receipt-payloads"]
      .filter((value): value is string => typeof value === "string").join(", ");
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", `Built V3 zero-write preflight failed: ${failed}.`,
    );
  }
  const payloads = [...expected].map(
    ([name, bytes]): readonly [string, Buffer] => [name, Buffer.from(bytes)],
  );
  const receiptBytes = serializeGrandHallT554V3Json(receipt);
  return { payloads, receiptBytes, files: new Map([...payloads,
    [GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME, receiptBytes]]) };
}

function parsePersistedArtifacts(
  read: GrandHallT554V3SnapshotRead,
  receiptKind: GrandHallT554ReviewPackV3ReceiptKind,
): PersistedV3Pack {
  try {
    const reviewFile = requireReadFile(read, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME);
    const decisionsFile = requireReadFile(read, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME);
    const volumeFile = requireReadFile(read, GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME);
    const receiptFile = requireReadFile(read, GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    return { read,
      reviewPack: GrandHallScopeReviewPackV3Schema.parse(
        parseGrandHallT554StrictJson(reviewFile.bytes)),
      humanDecisions: GrandHallT554HumanDecisionsV3Schema.parse(
        parseGrandHallT554StrictJson(decisionsFile.bytes)),
      closedVolume: GrandHallT554ClosedVolumeReviewV1Schema.parse(
        parseGrandHallT554StrictJson(volumeFile.bytes)),
      receipt: parseReceiptByKind(receiptFile.bytes, receiptKind) };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "Persisted T-554 v3 artifacts are invalid.", error,
    );
  }
}

function assertPendingPanoramas(decisions: GrandHallT554HumanDecisionsV3): void {
  const invalid = decisions.panoramaDecisions.some((row) =>
    row.result !== "UNSURE" || row.classification !== null ||
    row.maskFileName !== null || row.reviewedMaskBinding !== null || row.maskReviewed ||
    row.nativeResolutionHumanReviewCompleted || row.nativeReviewEvidenceSha256 !== null ||
    row.maskReasonCodes.length !== 0 || row.note !== null
  );
  if (invalid) throw new GrandHallT554ReviewPackV3Error(
    "OUTPUT_VERIFICATION_FAILED", "All 148 V3 panorama rows must remain wholly human-pending.",
  );
}

function assertPendingSecondaryDecisions(
  decisions: GrandHallT554HumanDecisionsV3,
): void {
  const cleanupInvalid = decisions.cleanupArtifactInspections.some((row) =>
    row.result !== "UNSURE" || row.localizationState !== null ||
    row.reviewedTargetIds.length !== 0 || row.nativeSourceReviewCompleted || row.note !== null
  );
  const interfaceInvalid = decisions.interfaceDecisions.some((row) =>
    row.result !== "UNSURE"
  );
  const volumeInvalid = decisions.closedSelectionVolumeDecision.result !== "UNSURE";
  if (cleanupInvalid || interfaceInvalid ||
    volumeInvalid ||
    decisions.matterPakRoomDecision.result !== "UNSURE" ||
    decisions.matterPakRoomDecision.note !== null) throw new GrandHallT554ReviewPackV3Error(
    "OUTPUT_VERIFICATION_FAILED", "V3 room, cleanup, and interface decisions must be blank.",
  );
}

function assertPendingDocument(pack: PersistedV3Pack): void {
  const decisions = pack.humanDecisions;
  const volume = pack.closedVolume;
  if (decisions.reviewState !== "human_pending" || decisions.finalDecision !== "PENDING" ||
    decisions.reviewer !== null || decisions.nativeResolutionHumanReviewCompleted ||
    decisions.nativeReviewEvidenceSetSha256 !== null ||
    volume.reviewState !== "human_pending" || volume.finalDecision !== "PENDING" ||
    volume.reviewer !== null || volume.footprintXY.length !== 0 ||
    volume.zMin !== null || volume.zMax !== null || volume.note !== null) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "V3 decisions and volume must remain exactly human-pending.",
    );
  }
  assertPendingPanoramas(decisions);
  assertPendingSecondaryDecisions(decisions);
}

function assertExactObservationSurface(pack: PersistedV3Pack): void {
  const review = pack.reviewPack;
  const t561 = review.sourceEvidence.t561AuthorityNoneObservation;
  if (review.panoramaRecords.length !== 148 ||
    t561.absentSweepNumbersWithin1To149.join(",") !== "93") {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "V3 is not the exact 148 / 74-74 / absent-93 surface.",
    );
  }
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function assertDecisionRowsBound(
  review: GrandHallScopeReviewPackV3,
  decisions: GrandHallT554HumanDecisionsV3,
): void {
  const decisionPanoramas = decisions.panoramaDecisions.map((row) => ({
    source: row.source, observation: row.sourceObservation,
  }));
  const reviewPanoramas = review.panoramaRecords.map((row) => ({
    source: row.source, observation: row.observation,
  }));
  const decisionInterfaces = decisions.interfaceDecisions.map((row) => row.source);
  if (!canonicalValuesEqual(decisionPanoramas, reviewPanoramas) ||
    !canonicalValuesEqual(decisionInterfaces, review.interfaceCandidates)) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "V3 decisions changed exact review-pack source rows.",
    );
  }
}

function assertArtifactBindings(pack: PersistedV3Pack): void {
  const { reviewPack: review, humanDecisions: decisions, closedVolume: volume } = pack;
  const t551 = review.sourceEvidence.t551SourceEvidenceSha256;
  if (t551 === review.sourceEvidence.boundaryReviewManifestSha256 ||
    decisions.reviewPackSha256 !== review.artifactSha256 ||
    decisions.sourcePanoramaInventorySha256 !== review.panoramaSourceInventorySha256 ||
    decisions.sourceObservationInventorySha256 !== review.panoramaObservationInventorySha256 ||
    decisions.sourceInterfaceInventorySha256 !== review.interfaceInventorySha256 ||
    decisions.matterPakRoomDecision.sourceMembershipV1Sha256 !==
      review.sourceEvidence.t550PendingMembershipV1Sha256 ||
    volume.reviewPackSha256 !== review.artifactSha256 ||
    decisions.matterPakRoomDecision.sourceBoundaryEvidenceSha256 !== t551 ||
    decisions.cleanupArtifactInspections.some((row) =>
      row.sourceBoundaryEvidenceSha256 !== t551 ||
      row.cleanupMarkerEvidenceSha256 !== review.sourceEvidence.cleanupMarkerEvidenceSha256 ||
      row.cleanupTargetInventorySha256 !== review.sourceEvidence.cleanupTargetInventorySha256
    )) throw new GrandHallT554ReviewPackV3Error(
    "OUTPUT_VERIFICATION_FAILED", "V3 artifacts do not bind the exact T-551 and cleanup evidence.",
  );
  assertDecisionRowsBound(review, decisions);
}

function assertReceiptPayloadFiles(pack: PersistedV3Pack): void {
  for (const payload of pack.receipt.payloads) {
    const file = requireReadFile(pack.read, payload.relativePath);
    if (file.bytes.length !== payload.byteLength || file.sha256 !== payload.sha256) {
      throw new GrandHallT554ReviewPackV3Error(
        "OUTPUT_VERIFICATION_FAILED", `${payload.relativePath} differs from its V3 receipt.`,
      );
    }
  }
}

function assertReceiptArtifactBindings(pack: PersistedV3Pack): void {
  const { receipt, reviewPack: review, humanDecisions: decisions, closedVolume: volume } = pack;
  const t561 = review.sourceEvidence.t561AuthorityNoneObservation;
  const bindings = receipt.sourceBindings;
  if (receipt.reviewPackSha256 !== review.artifactSha256 ||
    receipt.humanDecisionsSha256 !== computeGrandHallT554HumanDecisionsV3Sha256(decisions) ||
    receipt.closedVolumeReviewSha256 !== computeGrandHallT554ClosedVolumeReviewV1Sha256(volume) ||
    bindings.predecessorReviewPackArtifactSha256 !==
      review.sourceEvidence.predecessorReviewPack.artifactSha256 ||
    bindings.t561ObservationSetSha256 !== t561.observationSetSha256 ||
    bindings.t561ManifestSha256 !== t561.manifestSha256 ||
    bindings.t561ReceiptSha256 !== t561.receiptSha256 ||
    bindings.t551SourceEvidenceSha256 !== review.sourceEvidence.t551SourceEvidenceSha256 ||
    bindings.cleanupMarkerEvidenceSha256 !== review.sourceEvidence.cleanupMarkerEvidenceSha256 ||
    bindings.cleanupTargetInventorySha256 !== review.sourceEvidence.cleanupTargetInventorySha256) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "V3 receipt semantic cross-bindings disagree.",
    );
  }
  assertReceiptPayloadFiles(pack);
}

async function inspectPersistedPack(
  outputDirectory: string,
  testSeam: GrandHallT554V3SnapshotReadTestSeam = {},
  receiptKind: GrandHallT554ReviewPackV3ReceiptKind = "production",
): Promise<PersistedV3Pack> {
  const read = await readGrandHallT554V3ExactFlatDirectory(
    outputDirectory, EXPECTED_OUTPUT_NAMES, GRAND_HALL_T554_V3_MAX_JSON_BYTES, testSeam,
  );
  const pack = parsePersistedArtifacts(read, receiptKind);
  assertExactObservationSurface(pack);
  assertPendingDocument(pack);
  assertArtifactBindings(pack);
  assertReceiptArtifactBindings(pack);
  return pack;
}

function expectedFiles(built: AnyBuiltGrandHallT554ReviewPackV3): ReadonlyMap<string, Buffer> {
  return new Map([...built.payloads,
    [GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME, built.receiptBytes]]);
}

function assertExactBuiltBytes(
  persisted: PersistedV3Pack,
  built: AnyBuiltGrandHallT554ReviewPackV3,
): void {
  for (const [name, bytes] of expectedFiles(built)) {
    const file = requireReadFile(persisted.read, name);
    if (!file.bytes.equals(bytes) || file.sha256 !== grandHallT554V3FileSha256(bytes)) {
      throw new GrandHallT554ReviewPackV3Error(
        "OUTPUT_VERIFICATION_FAILED", `${name} differs from exact V3 regeneration.`,
      );
    }
  }
}

function assertExactPreflightBytes(
  persisted: PersistedV3Pack,
  publication: PreflightedV3Publication,
): void {
  for (const [name, bytes] of publication.files) {
    const file = requireReadFile(persisted.read, name);
    if (!file.bytes.equals(bytes) || file.sha256 !== grandHallT554V3FileSha256(bytes)) {
      throw new GrandHallT554ReviewPackV3Error(
        "OUTPUT_VERIFICATION_FAILED", `${name} differs from its preflighted V3 bytes.`,
      );
    }
  }
}

function assertBuiltCyclesEqual(
  before: BuiltGrandHallT554ReviewPackV3,
  after: BuiltGrandHallT554ReviewPackV3,
): void {
  const beforeFiles = expectedFiles(before);
  const afterFiles = expectedFiles(after);
  const stable = beforeFiles.size === afterFiles.size && [...beforeFiles].every(
    ([name, bytes]) => afterFiles.get(name)?.equals(bytes) === true,
  );
  if (!stable) throw new GrandHallT554ReviewPackV3Error(
    "SOURCE_INVALID", "Exact V3 source regeneration changed across operation phases.",
  );
}

function assertInitialOutputSafetyBinding(
  safety: GrandHallT554V3OutputSafety,
  persisted: PersistedV3Pack,
): GrandHallT554V3DirectorySnapshot["stats"] {
  if (safety.outputStats === undefined ||
    !grandHallT554V3SameFileState(safety.outputStats, persisted.read.initial.stats)) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_UNSAFE", "V3 output changed after its initial canonical safety check.",
    );
  }
  return safety.outputStats;
}

function assertSourceCyclesStable(
  before: GrandHallT554ReviewPackV3SourceBundle,
  after: GrandHallT554ReviewPackV3SourceBundle,
): void {
  assertReviewFilesStable(before.reviewFiles, after.reviewFiles);
  assertGrandHallT554V3SnapshotsEqual(before.cleanupFiles.read.final,
    after.cleanupFiles.read.initial,
    "Cleanup evidence changed across complete V3 operation phases.");
  if (before.t561Exact.manifestSha256 !== after.t561Exact.manifestSha256 ||
    before.t561Exact.receiptSha256 !== after.t561Exact.receiptSha256 ||
    before.cleanupExact.evidenceSha256 !== after.cleanupExact.evidenceSha256 ||
    before.cleanupExact.receiptSha256 !== after.cleanupExact.receiptSha256) {
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID", "Exact source-check summaries changed during the V3 operation.",
    );
  }
}

interface PublishTestSeam {
  readonly beforeReservation?: () => Promise<void> | void;
  readonly afterReservation?: (output: string) => Promise<void> | void;
  readonly beforePayloadWrite?: (name: string, output: string) => Promise<void> | void;
  readonly beforeReceiptWrite?: (output: string) => Promise<void> | void;
  readonly beforeInspection?: (output: string) => Promise<void> | void;
}

interface PublicationContext {
  reserved: boolean;
  outputStats: GrandHallT554V3DirectorySnapshot["stats"] | undefined;
}

async function assertPublicationOwnership(
  safety: GrandHallT554V3OutputSafety,
  outputStats: GrandHallT554V3DirectorySnapshot["stats"],
): Promise<void> {
  await assertGrandHallT554V3OwnedDirectory(
    safety.outputDirectory, outputStats, "Reserved V3 output",
  );
  await assertGrandHallT554V3OwnedDirectory(
    safety.outputParent, safety.parentStats, "V3 output parent",
  );
}

async function writePayloads(
  safety: GrandHallT554V3OutputSafety,
  outputStats: GrandHallT554V3DirectorySnapshot["stats"],
  publication: PreflightedV3Publication,
  seam: PublishTestSeam,
): Promise<void> {
  const validate = () => assertPublicationOwnership(safety, outputStats);
  for (const [name, bytes] of publication.payloads) {
    await seam.beforePayloadWrite?.(name, safety.outputDirectory);
    await validate();
    await writeGrandHallT554V3ExclusiveSyncedFile(
      resolve(safety.outputDirectory, name), bytes, validate,
    );
  }
  await seam.beforeReceiptWrite?.(safety.outputDirectory);
  await validate();
  await writeGrandHallT554V3ExclusiveSyncedFile(
    resolve(safety.outputDirectory, GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME),
    publication.receiptBytes, validate,
  );
}

async function reserveOutput(
  safety: GrandHallT554V3OutputSafety,
  context: PublicationContext,
  seam: PublishTestSeam,
): Promise<GrandHallT554V3DirectorySnapshot["stats"]> {
  await seam.beforeReservation?.();
  await assertGrandHallT554V3OwnedDirectory(
    safety.outputParent, safety.parentStats, "V3 output parent",
  );
  await mkdir(safety.outputDirectory, { recursive: false });
  context.reserved = true;
  const snapshot = await snapshotGrandHallT554V3DirectDirectory(safety.outputDirectory);
  context.outputStats = snapshot.stats;
  await assertGrandHallT554V3OwnedDirectory(safety.outputParent, safety.parentStats, "V3 output parent");
  return snapshot.stats;
}

async function publishBuiltPack(
  safety: GrandHallT554V3OutputSafety,
  built: AnyBuiltGrandHallT554ReviewPackV3,
  seam: PublishTestSeam = {},
  receiptKind: GrandHallT554ReviewPackV3ReceiptKind = "production",
): Promise<PersistedV3Pack> {
  const publication = assertBuiltPreflight(built, receiptKind);
  const context: PublicationContext = { reserved: false, outputStats: undefined };
  try {
    const outputStats = await reserveOutput(safety, context, seam);
    await seam.afterReservation?.(safety.outputDirectory);
    await writePayloads(safety, outputStats, publication, seam);
    await assertGrandHallT554V3OwnedDirectory(safety.outputParent, safety.parentStats, "V3 output parent");
    await seam.beforeInspection?.(safety.outputDirectory);
    const persisted = await inspectPersistedPack(safety.outputDirectory, {}, receiptKind);
    await assertGrandHallT554V3OwnedDirectory(safety.outputDirectory, outputStats, "Reserved V3 output");
    assertExactPreflightBytes(persisted, publication);
    await assertGrandHallT554V3OwnedDirectory(
      safety.outputParent, safety.parentStats, "V3 output parent",
    );
    return persisted;
  } catch (error) {
    if (context.reserved) throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_UNSAFE",
      `V3 publication failed after reservation; ${safety.outputDirectory} is quarantined without deletion.`,
      error,
    );
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_PUBLISH_FAILED", "V3 output could not be reserved without replacement.", error,
    );
  }
}

function verifiedSummary(
  persisted: PersistedV3Pack,
  verificationMode: VerifiedGrandHallT554ReviewPackV3["verificationMode"],
): VerifiedGrandHallT554ReviewPackV3 {
  if (persisted.receipt.schemaVersion !== GRAND_HALL_T554_V3_RECEIPT_SCHEMA) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "Authoritative V3 summary requires a production receipt.",
    );
  }
  return { verificationMode, exactRegenerationVerified: true,
    reviewPackSha256: persisted.reviewPack.artifactSha256 as GrandHallT554V3Sha256,
    receiptSha256: persisted.receipt.receiptSha256,
    panoramaDecisionCount: 148, observedGrandHallPixelSourceCount: 74,
    noObservedGrandHallPixelSourceCount: 74, absentSweepNumbersWithin1To149: [93],
    interfaceDecisionCount: 8, cleanupInspectionCount: 2, authority: "none",
    reviewState: "human_pending", nativeResolutionHumanReviewCompleted: false };
}

async function verifyPublishedOperationEnd(
  options: GrandHallT554ReviewPackV3Options,
  safety: GrandHallT554V3OutputSafety,
  initialSources: GrandHallT554ReviewPackV3SourceBundle,
  initialBuilt: BuiltGrandHallT554ReviewPackV3,
  published: PersistedV3Pack,
): Promise<PersistedV3Pack> {
  try {
    const finalSources = await loadVerifiedSources(options, EXACT_CHECK_RUNNERS);
    const finalBuilt = buildVerifiedGrandHallT554ReviewPackV3(finalSources);
    assertSourceCyclesStable(initialSources, finalSources);
    assertBuiltCyclesEqual(initialBuilt, finalBuilt);
    const final = await inspectPersistedPack(options.outputDirectory);
    assertGrandHallT554V3SnapshotsEqual(published.read.final, final.read.initial,
      "V3 output changed during the final exact-source regeneration.");
    assertExactBuiltBytes(final, finalBuilt);
    await assertGrandHallT554V3OwnedDirectory(
      safety.outputDirectory, published.read.final.stats, "Published V3 output",
    );
    await assertGrandHallT554V3OwnedDirectory(
      safety.outputParent, safety.parentStats, "Published V3 output parent",
    );
    return final;
  } catch (error) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_UNSAFE",
      `Published V3 output is quarantined after ambiguous final verification: ${options.outputDirectory}.`,
      error,
    );
  }
}

export async function generateGrandHallT554ReviewPackV3(
  options: GrandHallT554ReviewPackV3Options,
): Promise<VerifiedGrandHallT554ReviewPackV3> {
  const safety = await assertGrandHallT554V3NewOutputSafety(
    options.outputDirectory, sourceNodes(options),
  );
  const initialSources = await loadVerifiedSources(options, EXACT_CHECK_RUNNERS);
  const initialBuilt = buildVerifiedGrandHallT554ReviewPackV3(initialSources);
  const published = await publishBuiltPack(safety, initialBuilt);
  const final = await verifyPublishedOperationEnd(
    { ...options, outputDirectory: safety.outputDirectory },
    safety, initialSources, initialBuilt, published,
  );
  return verifiedSummary(final, "published_exact_sources");
}

export async function checkGrandHallT554ReviewPackV3(
  options: GrandHallT554ReviewPackV3Options,
): Promise<VerifiedGrandHallT554ReviewPackV3> {
  const safety = await assertGrandHallT554V3ExistingOutputSafety(
    options.outputDirectory, sourceNodes(options),
  );
  const before = await inspectPersistedPack(safety.outputDirectory);
  const outputStats = assertInitialOutputSafetyBinding(safety, before);
  const initialSources = await loadVerifiedSources(options, EXACT_CHECK_RUNNERS);
  const initialBuilt = buildVerifiedGrandHallT554ReviewPackV3(initialSources);
  const middle = await inspectPersistedPack(safety.outputDirectory);
  assertGrandHallT554V3SnapshotsEqual(before.read.final, middle.read.initial,
    "V3 output changed while exact sources were independently regenerated.");
  assertExactBuiltBytes(middle, initialBuilt);
  const finalSources = await loadVerifiedSources(options, EXACT_CHECK_RUNNERS);
  const finalBuilt = buildVerifiedGrandHallT554ReviewPackV3(finalSources);
  assertSourceCyclesStable(initialSources, finalSources);
  assertBuiltCyclesEqual(initialBuilt, finalBuilt);
  const final = await inspectPersistedPack(safety.outputDirectory);
  assertGrandHallT554V3SnapshotsEqual(middle.read.final, final.read.initial,
    "V3 output changed during the final exact-source regeneration.");
  assertExactBuiltBytes(final, finalBuilt);
  await assertGrandHallT554V3OwnedDirectory(
    safety.outputDirectory, outputStats, "Checked V3 output",
  );
  await assertGrandHallT554V3OwnedDirectory(
    safety.outputParent, safety.parentStats, "Checked V3 output parent",
  );
  return verifiedSummary(final, "checked_exact_regeneration");
}

export interface GrandHallT554ReviewPackV3StructuralTestSummary {
  readonly sourceVerificationState: "not_checked_test_only";
  readonly reviewPackSha256: GrandHallT554V3Sha256;
  readonly receiptSha256: GrandHallT554V3Sha256;
}

function structuralSummary(pack: PersistedV3Pack): GrandHallT554ReviewPackV3StructuralTestSummary {
  if (pack.receipt.schemaVersion !== GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "Structural test summary requires a test-only receipt.",
    );
  }
  return { sourceVerificationState: "not_checked_test_only",
    reviewPackSha256: pack.reviewPack.artifactSha256 as GrandHallT554V3Sha256,
    receiptSha256: pack.receipt.receiptSha256 };
}

/** Test-only construction seam; excluded from the package root. */
export function __testOnlyBuildGrandHallT554ReviewPackV3(
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): GrandHallT554ReviewPackV3TestBuiltPack {
  const artifacts = buildPayloadArtifacts(bundle);
  const receipt = buildTestReceipt(artifacts, bundle);
  return { ...artifacts, receipt,
    receiptBytes: serializeGrandHallT554V3Json(receipt) };
}

/** Test-only structural publisher; it never claims exact source verification. */
export async function __testOnlyPublishGrandHallT554ReviewPackV3Structure(
  options: GrandHallT554ReviewPackV3Options,
  built: GrandHallT554ReviewPackV3TestBuiltPack,
  seam: PublishTestSeam = {},
): Promise<GrandHallT554ReviewPackV3StructuralTestSummary> {
  const safety = await assertGrandHallT554V3NewOutputSafety(
    options.outputDirectory, sourceNodes(options),
  );
  return structuralSummary(await publishBuiltPack(
    safety, built, seam, "structural_test_only",
  ));
}

interface StructuralCheckTestSeam {
  readonly afterInitialInspection?: () => Promise<void> | void;
  readonly finalRead?: GrandHallT554V3SnapshotReadTestSeam;
}

/** Test-only exact-byte checker; it never claims that real sources were regenerated. */
export async function __testOnlyCheckGrandHallT554ReviewPackV3Structure(
  options: GrandHallT554ReviewPackV3Options,
  built: GrandHallT554ReviewPackV3TestBuiltPack,
  seam: StructuralCheckTestSeam = {},
): Promise<GrandHallT554ReviewPackV3StructuralTestSummary> {
  const safety = await assertGrandHallT554V3ExistingOutputSafety(
    options.outputDirectory, sourceNodes(options),
  );
  const before = await inspectPersistedPack(
    safety.outputDirectory, {}, "structural_test_only",
  );
  await seam.afterInitialInspection?.();
  const after = await inspectPersistedPack(
    safety.outputDirectory, seam.finalRead, "structural_test_only",
  );
  assertGrandHallT554V3SnapshotsEqual(before.read.final, after.read.initial,
    "V3 output changed between structural check phases.");
  assertExactBuiltBytes(after, built);
  return structuralSummary(after);
}

/** Test-only persisted read race seam; excluded from the package root. */
export async function __testOnlyInspectGrandHallT554ReviewPackV3Structure(
  outputDirectory: string,
  seam: GrandHallT554V3SnapshotReadTestSeam,
): Promise<GrandHallT554ReviewPackV3StructuralTestSummary> {
  return structuralSummary(await inspectPersistedPack(
    outputDirectory, seam, "structural_test_only",
  ));
}

/** Test-only source-binding validator; excluded from the package root. */
export function __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings(
  bundle: GrandHallT554ReviewPackV3SourceBundle,
): void {
  assertReviewBundleFiles(bundle.review, bundle.reviewFiles);
  assertT561ExactSummary(bundle.t561Exact, bundle.review, bundle.reviewFiles);
  assertCleanupReceiptBinding(bundle.cleanupFiles);
  assertCleanupExactSummary(bundle.cleanupExact, bundle.cleanupFiles);
  assertT551CleanupBinding(bundle.review, bundle.cleanupFiles);
}

/** Test-only proof that the public source path fixes the real checker functions. */
export async function __testOnlyLoadGrandHallT554ReviewPackV3Sources(
  options: GrandHallT554ReviewPackV3Options,
  runners: ExactCheckRunners,
): Promise<GrandHallT554ReviewPackV3SourceBundle> {
  return await loadVerifiedSources(options, runners);
}
