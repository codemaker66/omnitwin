import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
  GrandHallScopeReviewPackV1Schema,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";

import {
  GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
  GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA,
  GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
  GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
  GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION,
  GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
  __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure,
  buildGrandHallT554CleanupMarkerReceipt,
  computeGrandHallT554CleanupTargetInventorySha256,
  grandHallT554CleanupMarkerTargetId,
  parseGrandHallT554CleanupMarkerEvidence,
  parseGrandHallT554CleanupMarkerReceipt,
  sealGrandHallT554CleanupMarkerEvidence,
  serializeGrandHallT554CleanupMarkerEvidence,
  serializeGrandHallT554CleanupMarkerReceipt,
  type GrandHallT554CleanupMarkerBuiltPack,
  type GrandHallT554CleanupMarkerEvidenceMaterial,
  type GrandHallT554CleanupTarget,
} from "../grand-hall-t554-cleanup-marker-evidence.js";
import { GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME } from "../grand-hall-t554-review-pack.js";
import type { GrandHallT554ReviewPackV2SourceBundle } from "../grand-hall-t554-review-pack-v2.js";
import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
} from "../grand-hall-t554-panorama-review.js";
import {
  GRAND_HALL_T561_MANIFEST_FILENAME,
  GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
  GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA,
  GRAND_HALL_T561_RECEIPT_FILENAME,
  buildGrandHallT561ObservationManifest,
  sealGrandHallT561ObservationInput,
  serializeGrandHallT561ObservationInput,
  type GrandHallT561ObservationInputMaterial,
  type GrandHallT561ObservationReceipt,
} from "../grand-hall-t561-panorama-visual-observation.js";
import {
  __testOnlyBuildGrandHallT554ReviewPackV3,
  type GrandHallT554ReviewPackV3Options,
  type GrandHallT554ReviewPackV3SourceBundle,
  type GrandHallT554ReviewPackV3TestBuiltPack,
} from "../grand-hall-t554-review-pack-v3.js";
import {
  GRAND_HALL_T554_V3_MAX_JSON_BYTES,
  grandHallT554V3FileSha256,
} from "../grand-hall-t554-review-pack-v3-contract.js";
import {
  readGrandHallT554V3ExactFlatDirectory,
  readGrandHallT554V3StableDirectFile,
} from "../grand-hall-t554-review-pack-v3-files.js";

export function fixtureDigest(seed: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

const POSITIVE_SWEEPS = new Set<number>(
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
);

function predecessor(): GrandHallScopeReviewPackV1 {
  const path = resolve(
    process.cwd(),
    "../../docs/operations/grand-hall-t554-review-pack/review-pack.json",
  );
  return GrandHallScopeReviewPackV1Schema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

function observationRecord(file: GrandHallScopeReviewPackV1["panoramaDirectoryFiles"][number]) {
  const observed = POSITIVE_SWEEPS.has(file.embeddedSweepNumber ?? -1);
  return { sweepNumber: file.embeddedSweepNumber as number,
    relativePath: file.fileName, byteLength: file.byteLength,
    sha256: file.sha256 as `sha256:${string}`, widthPx: 8_192 as const,
    heightPx: 4_096 as const, observationState: observed
      ? "grand_hall_pixels_observed" as const
      : "no_grand_hall_pixels_observed" as const,
    frameContext: observed ? "broad_grand_hall_view" as const
      : "no_grand_hall_pixels_observed" as const,
    boundarySensitive: false, attentionRegions: [],
    note: `Authority-none observation of sweep ${String(file.embeddedSweepNumber)}.`,
    authority: "none" as const, humanReviewState: "pending" as const,
    roomMembershipAuthority: "none" as const, cameraPoseAuthority: "none" as const,
    maskAuthority: "none" as const, trainingInputPermitted: false as const,
    reconstructionInputPermitted: false as const, runtimeInputPermitted: false as const,
    publicEvidencePermitted: false as const };
}

function t561Receipt(
  manifestSha256: `sha256:${string}`,
  observationSetSha256: `sha256:${string}`,
): GrandHallT561ObservationReceipt {
  return { schemaVersion: GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA,
    state: "complete", authority: "none", manifestSha256,
    panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    observationSetSha256, payloadFileCount: 1, outputFileCount: 2,
    payloads: [{ relativePath: GRAND_HALL_T561_MANIFEST_FILENAME,
      byteLength: 100, sha256: fixtureDigest("manifest-file") }],
    guards: { sourceMutationPermitted: false, humanAcceptanceRecorded: false,
      nativeResolutionHumanReviewCompleted: false, roomMembershipAuthority: "none",
      cameraStationInferred: false, cameraPoseAuthority: "none", maskGenerated: false,
      maskAuthority: "none", t550CandidateSetChanged: false,
      t554AcceptanceAuthorized: false, trainingAuthorized: false,
      reconstructionAuthorized: false, runtimeAuthorized: false, stagingAuthorized: false,
      publicEvidenceAuthorized: false, generatedContentUsed: false },
    receiptSha256: fixtureDigest("t561-receipt") };
}

function reviewSourceBundle(): GrandHallT554ReviewPackV2SourceBundle {
  const v1 = predecessor();
  const material: GrandHallT561ObservationInputMaterial = {
    schemaVersion: GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
    subject: { venueSlug: "trades-hall", roomSlug: "grand-hall", taskId: "T-561",
      scope: "agent_visual_observation_of_all_supplied_panoramas" }, authority: "none",
    inspection: { method: "agent_visual_review_of_exact_source_file",
      displayedWidthPx: 2_048, displayedHeightPx: 1_024,
      displayMayHaveBeenResampled: true, nativeResolutionHumanReviewCompleted: false,
      humanAcceptanceRecorded: false },
    sourceBindings: { t554PanoramaManifestSha256:
        GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
      panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
      presentSourceCount: 148, absentSweepNumbersWithin1To149: [93] },
    records: v1.panoramaDirectoryFiles.map(observationRecord),
    absentSources: [{ sweepNumber: 93, sourceState: "absent_from_exact_supplied_inventory",
      visualObservationState: "not_observable_source_absent", authority: "none" }],
  };
  const input = sealGrandHallT561ObservationInput(material);
  const inputBytes = serializeGrandHallT561ObservationInput(input);
  const manifest = buildGrandHallT561ObservationManifest(
    input, { sha256: fixtureDigest(inputBytes), byteLength: inputBytes.length }, [],
  );
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const receipt = t561Receipt(manifest.manifestSha256, input.observationSetSha256);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const predecessorBytes = Buffer.from(`${JSON.stringify(v1, null, 2)}\n`);
  return { predecessor: v1,
    predecessorFile: { bytes: predecessorBytes, sha256: fixtureDigest(predecessorBytes) },
    observationInput: input,
    observationInputFile: { bytes: inputBytes, sha256: fixtureDigest(inputBytes) },
    observationManifest: manifest,
    observationManifestFile: { bytes: manifestBytes, sha256: fixtureDigest(manifestBytes) },
    observationReceipt: receipt,
    observationReceiptFile: { bytes: receiptBytes, sha256: fixtureDigest(receiptBytes) } };
}

const TARGET_FACTS = Object.freeze([
  ["mirror130_group000_sub002", 130, 1_120_640, 1_121_258, 350_795, 351_410, 616,
    "sha256:e220ad2146e2f7858009d53cd5c9407160693b3f449863a977b05836435a3eef",
    "sha256:778d4dea4d94101c44a11dcea4fe5d657001b810c7b25babfa767f5983a5baf2",
    592, "sha256:2b5d007fbe89e48f5dbcf52300b00c5a7fa73db0583f2718f22cab1276fb5af4",
    "424ff41f6e5d41969c635fcd61be9b3f_123.jpg", [-1.72, -0.423, -2.968],
    [1.682, 0.545, -0.894]],
  ["mirror131_group000_sub002", 131, 1_121_259, 1_121_267, 351_411, 351_416, 6,
    "sha256:53f8d3c7e8a10912218d4a2e23fce01ba5bb8a9bd8c3c883b9228edb119513ee",
    "sha256:657b9285314a66f2217595da6b8c2dd811b5e3b91714884fc67c6c5ad3b192ee",
    8, "sha256:baa5d8a2274797bd98bb28357a9741a2b4957f6eb1cdb5e7e3105a709c2c0406",
    "424ff41f6e5d41969c635fcd61be9b3f_123.jpg", [1.628, -0.578, -1.947],
    [1.634, -0.372, -1.587]],
  ["mirror136_group000_sub002", 136, 1_140_397, 1_142_522, 370_534, 372_656, 2_123,
    "sha256:a138f1fc09a98cb60eaafcab5b8d384186ea5a893612639264d550a089eb9736",
    "sha256:32f8e72b817ca7a3f6fd243e7c75b5637c5cda563d41aa8a1bb231c5e80edcd6",
    1_797, "sha256:a15dcd0bd814376ffdf5781c9478ae42f5b0a51ae5d06ad5cbd948b1ca3eea89",
    "424ff41f6e5d41969c635fcd61be9b3f_127.jpg", [-1.803, -1.173352, -3.589],
    [1.693, 0.5705, -0.368]],
  ["mirror142_group000_sub002", 142, 1_184_055, 1_184_223, 414_174, 414_339, 166,
    "sha256:b284bded47d3617f0c552ecda2ec3e6e682251719a34b8759635304c04a5a605",
    "sha256:406acfb31927b82506e4c96660fa8c91d2a48d3c6858ea21616df94d8a2adb4d",
    195, "sha256:65d565a20706f88064cc1dfd72533cd07bff6c2903c7db56fefcdc203493a9f0",
    "424ff41f6e5d41969c635fcd61be9b3f_132.jpg", [1.188, -0.671, -3.349],
    [1.682, 0.763, -0.438625]],
  ["mirror143_group000_sub002", 143, 1_184_224, 1_184_242, 414_340, 414_355, 16,
    "sha256:b9380aed44a0af5499eef225d757cda67f017bc2db83076fc96f8f5637815939",
    "sha256:1911462e0a00b0113b8a0bb6e374ce7b9458079664a76dab5b110f4761d4313e",
    15, "sha256:8acf3744f4d56f43885dc6003d54dbcf4e65f2ad9f68686298ff7683da945a61",
    "424ff41f6e5d41969c635fcd61be9b3f_132.jpg", [1.518, -1.22, -0.498],
    [1.684, -1.08, -0.402]],
] as const);

function cleanupTarget(index: number): GrandHallT554CleanupTarget {
  const row = TARGET_FACTS[index];
  if (row === undefined) throw new Error("Missing cleanup target fixture.");
  return { targetId: grandHallT554CleanupMarkerTargetId(row[0]), artifactClass: "Mirror",
    localizationBasis: "exact_literal_mirror_prefixed_obj_group", sourceGroupName: row[0],
    zeroBasedGroupOrdinal: row[1], sourceLineRangeOneBasedInclusive: {
      start: row[2], end: row[3] }, sourceRoomKey: { groupIndex: 0, subIndex: 2 },
    sourceFaceOrdinalRangeZeroBasedInclusive: { start: row[4], end: row[5] },
    sourceFaceCount: row[6], sourceFaceOrdinalSha256: row[7],
    sourceFaceRecordSha256: row[8], uniqueVertexCount: row[9],
    uniqueVertexIndexSha256: row[10], materialNames: [row[11]],
    boundsMeters: { min: [row[12][0], row[12][1], row[12][2]],
      max: [row[13][0], row[13][1], row[13][2]] }, selectedRoomMatch: false,
    uniqueVerticesSharedWithSelectedRoom: 0,
    disposition: GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION,
    cleanupDecision: "not_made_human_review_required", faceRemovalAuthorized: false,
    generatedGeometryUsed: false };
}

const CLEANUP_GUARDS = Object.freeze({ sourceMutationPermitted: false,
  cleanupApplied: false, sourceFacesRemoved: false, windowAbsenceClaimed: false,
  humanAcceptanceRecorded: false, nativeSourceReviewCompleted: false,
  architecturalAuthority: "none", roomBoundaryAuthority: "none",
  replacementGeometryGenerated: false, generatedContentUsed: false,
  trainingAuthorized: false, reconstructionAuthorized: false, runtimeAuthorized: false,
  stagingAuthorized: false, deploymentAuthorized: false, publicEvidenceAuthorized: false } as const);

function cleanupSourceBindings(): GrandHallT554CleanupMarkerEvidenceMaterial["sourceBindings"] {
  return { captureStageManifest: {
      sourceLocator: "CAPTURE_STAGE_ROOT/capture-stage-manifest.json", byteLength: 50_122,
      sha256: "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff",
      schemaVersion: "venviewer.capture-stage.v1",
      planSha256: "sha256:d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729",
      fileCount: 156, totalBytes: 22_277_494_876, sourceBytesReadThisRun: true },
    room9SourceBoundaryEvidence: {
      sourceLocator: "REPOSITORY/docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
      byteLength: 19_200,
      serializedFileSha256: "sha256:dd4e3348ffaf164de62497dd659b317b7c4e3ee761144417b8dff8f43b181f6d",
      evidenceSha256: "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
      sourceBytesReadThisRun: true }, obj: {
      sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.obj",
      byteLength: 38_381_816,
      sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      sourceBytesReadThisRun: true }, mtl: {
      sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.mtl",
      byteLength: 20_879,
      sha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
      sourceBytesReadThisRun: true }, matterpakReadme: {
      sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/readme.pdf", byteLength: 197_005,
      sha256: "sha256:fed6e334ea3a3a7eb769c5d67df75a3389d8b18891cec8f137fc9010925ab048",
      sourceBytesReadThisRun: true }, pointCloud: {
      sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/cloud.xyz", byteLength: 1_611_296_012,
      sha256: "sha256:a1e5fc55f62897e4cd08851f4e7e07e3949cc8e1894fbc6c02d029863b821144",
      bindingBasis: "exact_capture_stage_manifest_entry", sourceBytesReadThisRun: false,
      usedForLocalization: false } };
}

function cleanupMaterial(): GrandHallT554CleanupMarkerEvidenceMaterial {
  const targets = Array.from({ length: 5 }, (_, index) => cleanupTarget(index));
  return { schemaVersion: GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA,
    subject: { venueId: "trades-hall", roomId: "grand-hall", taskId: "T-554",
      scope: "source_explicit_cleanup_marker_localization_only",
      selectedMatterpakRoomKey: { groupIndex: 1, subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009" } }, authority: "none",
    reviewState: "machine_inventory_complete_human_pending",
    sourceBindings: cleanupSourceBindings(), vendorMarkerSemantics: {
      evidenceBasis: "human_reviewed_paraphrase_of_exact_hash_bound_matterpak_readme",
      referencedPagesOneBased: [2, 4], objMarkerEffect:
        "Window and Mirror markers may add triangular closure walls and remove mesh behind the marker line.",
      pointCloudMarkerEffect:
        "The XYZ export has points removed behind marker classes and does not contain the OBJ closure-wall triangles.",
      perMarkerManifestPresentInBoundEvidence: false,
      objGroupNamingGuaranteePresentInBoundEvidence: false, architecturalAuthority: "none" },
    objInventory: { vertexRecordCount: 237_561, textureCoordinateRecordCount: 531_888,
      faceRecordCount: 474_049, groupRecordCount: 159, useMaterialRecordCount: 159,
      literalChunkNamedGroupCount: 154, literalMirrorNamedGroupCount: 5,
      literalWindowNamedGroupCount: 0, otherGroupNameCount: 0,
      groupInventorySha256: "sha256:d0c82ec4789345762238f73b928afc2b5dc6f05773bac06958e0c33e17786fb7",
      selectedRoomGroupCount: 43, selectedRoomFaceCount: 119_564,
      selectedRoomUniqueVertexCount: 59_049 },
    targetIdRule: "matterpak-obj-group:<exact-source-group-name>",
    explicitCleanupTargets: targets,
    cleanupTargetInventorySha256: computeGrandHallT554CleanupTargetInventorySha256(targets),
    classEvidence: [{ artifactClass: "Window",
      localizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
      sourceLiteralGroupMatchRule: "case_sensitive_window_prefix", literalNamedGroupCount: 0,
      localizedTargetIds: [], absenceOfMarkerEffectClaimed: false,
      completenessScope: "literal_obj_group_names_only", nativeSourceReviewCompleted: false,
      humanReviewRequired: true }, { artifactClass: "Mirror",
      localizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
      sourceLiteralGroupMatchRule: "case_sensitive_mirror_prefix", literalNamedGroupCount: 5,
      localizedTargetIds: targets.map((target) => target.targetId),
      absenceOfMarkerEffectClaimed: false,
      completenessScope: "every_obj_group_name_matching_exact_literal_mirror_prefix_in_bound_obj",
      nativeSourceReviewCompleted: false, humanReviewRequired: true }], guards: CLEANUP_GUARDS,
    limitations: [
      "Literal OBJ group names provide exact source locators for five Mirror-labelled groups, but neither their non-selected group keys nor their separate vertex indices prove physical exclusion from the Grand Hall or their visual effect.",
      "No literal Window-prefixed OBJ group exists in the bound OBJ; this is metadata-inconclusive and is not evidence that Window marker effects are absent.",
      "The bound MatterPak README describes marker-driven closure walls and mesh removal generally but provides no per-marker manifest or group-naming guarantee.",
      "The staged point cloud is marker-affected according to the vendor documentation and was not used to localize cleanup targets in this run.",
      "Every cleanup decision, any face removal, and native-source visual review remain human-pending.",
    ] };
}

function cleanupBuiltPack(): GrandHallT554CleanupMarkerBuiltPack {
  const evidence = sealGrandHallT554CleanupMarkerEvidence(cleanupMaterial());
  const evidenceBytes = serializeGrandHallT554CleanupMarkerEvidence(evidence);
  const receipt = buildGrandHallT554CleanupMarkerReceipt(evidence, evidenceBytes);
  return { evidence, evidenceBytes, receipt,
    receiptBytes: serializeGrandHallT554CleanupMarkerReceipt(receipt) };
}

export interface GrandHallT554V3FixtureHarness {
  readonly root: string;
  readonly options: GrandHallT554ReviewPackV3Options;
  readonly bundle: GrandHallT554ReviewPackV3SourceBundle;
  readonly built: GrandHallT554ReviewPackV3TestBuiltPack;
}

async function createFixturePaths(root: string): Promise<GrandHallT554ReviewPackV3Options> {
  const directories = ["v1", "panoramas", "t554-panorama", "t561-pack",
    "cleanup-stage", "cleanup-source"];
  await Promise.all(directories.map((name) => mkdir(join(root, name))));
  return { predecessorReviewRoot: join(root, "v1"),
    panoramaSourceRoot: join(root, "panoramas"),
    t554PanoramaPackDirectory: join(root, "t554-panorama"),
    t561ObservationInputPath: join(root, "t561-input.json"),
    t561ObservationPackDirectory: join(root, "t561-pack"),
    cleanupCaptureStageRoot: join(root, "cleanup-stage"),
    cleanupSourceBoundaryEvidencePath: join(root, "cleanup-source", "boundary.json"),
    cleanupEvidencePackDirectory: join(root, "cleanup-pack"),
    outputDirectory: join(root, "v3-output") };
}

async function writeReviewFixtureFiles(
  options: GrandHallT554ReviewPackV3Options,
  review: GrandHallT554ReviewPackV2SourceBundle,
): Promise<void> {
  await Promise.all([
    writeFile(resolve(options.predecessorReviewRoot, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
      review.predecessorFile.bytes, { flag: "wx" }),
    writeFile(options.t561ObservationInputPath, review.observationInputFile.bytes, { flag: "wx" }),
    writeFile(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_MANIFEST_FILENAME),
      review.observationManifestFile.bytes, { flag: "wx" }),
    writeFile(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_RECEIPT_FILENAME),
      review.observationReceiptFile.bytes, { flag: "wx" }),
    writeFile(options.cleanupSourceBoundaryEvidencePath, "{}\n", { flag: "wx" }),
  ]);
}

async function directReviewFiles(
  options: GrandHallT554ReviewPackV3Options,
) {
  const read = (path: string) => readGrandHallT554V3StableDirectFile(
    path, GRAND_HALL_T554_V3_MAX_JSON_BYTES, "fixture source", "SOURCE_INVALID",
  );
  const [predecessorFile, inputFile, manifestFile, receiptFile] = await Promise.all([
    read(resolve(options.predecessorReviewRoot, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME)),
    read(options.t561ObservationInputPath),
    read(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_MANIFEST_FILENAME)),
    read(resolve(options.t561ObservationPackDirectory, GRAND_HALL_T561_RECEIPT_FILENAME)),
  ]);
  return { predecessor: predecessorFile, observationInput: inputFile,
    observationManifest: manifestFile, observationReceipt: receiptFile };
}

export async function createGrandHallT554V3Fixture(): Promise<GrandHallT554V3FixtureHarness> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-v3-"));
  const options = await createFixturePaths(root);
  const review = reviewSourceBundle();
  await writeReviewFixtureFiles(options, review);
  const cleanupBuilt = cleanupBuiltPack();
  const cleanupPublished = await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
    { captureStageRoot: options.cleanupCaptureStageRoot,
      sourceBoundaryEvidencePath: options.cleanupSourceBoundaryEvidencePath,
      outputDirectory: options.cleanupEvidencePackDirectory }, cleanupBuilt,
  );
  const cleanupRead = await readGrandHallT554V3ExactFlatDirectory(
    options.cleanupEvidencePackDirectory,
    [GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME],
    GRAND_HALL_T554_V3_MAX_JSON_BYTES,
  );
  const evidenceFile = cleanupRead.files.get(GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME);
  const receiptFile = cleanupRead.files.get(GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME);
  if (evidenceFile === undefined || receiptFile === undefined) throw new Error("Fixture cleanup pack missing.");
  const bundle: GrandHallT554ReviewPackV3SourceBundle = {
    review, reviewFiles: await directReviewFiles(options),
    t561Exact: { outputDirectory: options.t561ObservationPackDirectory,
      manifestSha256: review.observationManifest.manifestSha256,
      receiptSha256: review.observationReceipt.receiptSha256,
      sourceRecordCount: 148, absentSweepNumbersWithin1To149: [93],
      reviewAidCount: 0, outputFileCount: 2, authority: "none",
      nativeResolutionHumanReviewCompleted: false, exactRegenerationVerified: true },
    cleanupExact: { ...cleanupPublished,
      sourceVerificationState: "exact_source_regeneration_verified",
      exactRegenerationVerified: true },
    cleanupFiles: { read: cleanupRead, evidenceFile, receiptFile,
      evidence: parseGrandHallT554CleanupMarkerEvidence(evidenceFile.bytes),
      receipt: parseGrandHallT554CleanupMarkerReceipt(receiptFile.bytes) },
  };
  return { root, options, bundle, built: __testOnlyBuildGrandHallT554ReviewPackV3(bundle) };
}

export function expectedBuiltFile(
  built: GrandHallT554ReviewPackV3TestBuiltPack,
  name: string,
): Buffer {
  if (name.endsWith("publication-receipt-v3.json")) return built.receiptBytes;
  const bytes = built.payloads.get(name);
  if (bytes === undefined) throw new Error(`Missing built fixture file ${name}.`);
  return bytes;
}

export function hashBuiltFile(bytes: Buffer): `sha256:${string}` {
  return grandHallT554V3FileSha256(bytes);
}
