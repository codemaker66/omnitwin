import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as reconstructionFoundryCliPublic from "../index.js";

import {
  GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
  GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA,
  GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
  GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_SCHEMA,
  GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
  GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION,
  GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
  GrandHallT554CleanupMarkerEvidenceError,
  __testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure,
  __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure,
  analyzeGrandHallT554CleanupMarkerObj,
  assertExactGrandHallT554CleanupMarkerAnalysis,
  buildGrandHallT554CleanupMarkerReceipt,
  checkGrandHallT554CleanupMarkerEvidencePack,
  computeGrandHallT554CleanupTargetInventorySha256,
  generateGrandHallT554CleanupMarkerEvidencePack,
  grandHallT554CleanupMarkerTargetId,
  inspectPersistedGrandHallT554CleanupMarkerEvidencePackStructure,
  parseGrandHallT554CleanupMarkerEvidence,
  parseGrandHallT554CleanupMarkerReceipt,
  sealGrandHallT554CleanupMarkerEvidence,
  serializeGrandHallT554CleanupMarkerEvidence,
  serializeGrandHallT554CleanupMarkerReceipt,
  type GrandHallT554CleanupMarkerBuiltPack,
  type GrandHallT554CleanupMarkerEvidenceMaterial,
  type GrandHallT554CleanupTarget,
} from "../grand-hall-t554-cleanup-marker-evidence.js";
import {
  parseGrandHallT554CleanupMarkerEvidenceArguments,
  runGrandHallT554CleanupMarkerEvidenceCli,
} from "../grand-hall-t554-cleanup-marker-evidence-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function digest(seed: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(seed, "utf8").digest("hex")}`;
}

const SYNTHETIC_OBJ = [
  "v 0 0 0",
  "v 1 0 0",
  "v 0 1 0",
  "v 10 0 0",
  "v 11 0 0",
  "v 10 1 0",
  "vt 0 0",
  "g chunk000_group001_sub009",
  "usemtl room.jpg",
  "f 1/1 2/1 3/1",
  "g mirror001_group000_sub002",
  "usemtl mirror.jpg",
  "f 4/1 5/1 6/1",
].join("\n");

const EXACT_TARGET_FACTS = [
  {
    groupName: "mirror130_group000_sub002",
    ordinal: 130,
    lines: [1_120_640, 1_121_258],
    faces: [350_795, 351_410, 616],
    faceOrdinalSha256: "sha256:e220ad2146e2f7858009d53cd5c9407160693b3f449863a977b05836435a3eef",
    faceRecordSha256: "sha256:778d4dea4d94101c44a11dcea4fe5d657001b810c7b25babfa767f5983a5baf2",
    vertices: [592, "sha256:2b5d007fbe89e48f5dbcf52300b00c5a7fa73db0583f2718f22cab1276fb5af4"],
    material: "424ff41f6e5d41969c635fcd61be9b3f_123.jpg",
    bounds: [[-1.72, -0.423, -2.968], [1.682, 0.545, -0.894]],
  },
  {
    groupName: "mirror131_group000_sub002",
    ordinal: 131,
    lines: [1_121_259, 1_121_267],
    faces: [351_411, 351_416, 6],
    faceOrdinalSha256: "sha256:53f8d3c7e8a10912218d4a2e23fce01ba5bb8a9bd8c3c883b9228edb119513ee",
    faceRecordSha256: "sha256:657b9285314a66f2217595da6b8c2dd811b5e3b91714884fc67c6c5ad3b192ee",
    vertices: [8, "sha256:baa5d8a2274797bd98bb28357a9741a2b4957f6eb1cdb5e7e3105a709c2c0406"],
    material: "424ff41f6e5d41969c635fcd61be9b3f_123.jpg",
    bounds: [[1.628, -0.578, -1.947], [1.634, -0.372, -1.587]],
  },
  {
    groupName: "mirror136_group000_sub002",
    ordinal: 136,
    lines: [1_140_397, 1_142_522],
    faces: [370_534, 372_656, 2_123],
    faceOrdinalSha256: "sha256:a138f1fc09a98cb60eaafcab5b8d384186ea5a893612639264d550a089eb9736",
    faceRecordSha256: "sha256:32f8e72b817ca7a3f6fd243e7c75b5637c5cda563d41aa8a1bb231c5e80edcd6",
    vertices: [1_797, "sha256:a15dcd0bd814376ffdf5781c9478ae42f5b0a51ae5d06ad5cbd948b1ca3eea89"],
    material: "424ff41f6e5d41969c635fcd61be9b3f_127.jpg",
    bounds: [[-1.803, -1.173352, -3.589], [1.693, 0.5705, -0.368]],
  },
  {
    groupName: "mirror142_group000_sub002",
    ordinal: 142,
    lines: [1_184_055, 1_184_223],
    faces: [414_174, 414_339, 166],
    faceOrdinalSha256: "sha256:b284bded47d3617f0c552ecda2ec3e6e682251719a34b8759635304c04a5a605",
    faceRecordSha256: "sha256:406acfb31927b82506e4c96660fa8c91d2a48d3c6858ea21616df94d8a2adb4d",
    vertices: [195, "sha256:65d565a20706f88064cc1dfd72533cd07bff6c2903c7db56fefcdc203493a9f0"],
    material: "424ff41f6e5d41969c635fcd61be9b3f_132.jpg",
    bounds: [[1.188, -0.671, -3.349], [1.682, 0.763, -0.438625]],
  },
  {
    groupName: "mirror143_group000_sub002",
    ordinal: 143,
    lines: [1_184_224, 1_184_242],
    faces: [414_340, 414_355, 16],
    faceOrdinalSha256: "sha256:b9380aed44a0af5499eef225d757cda67f017bc2db83076fc96f8f5637815939",
    faceRecordSha256: "sha256:1911462e0a00b0113b8a0bb6e374ce7b9458079664a76dab5b110f4761d4313e",
    vertices: [15, "sha256:8acf3744f4d56f43885dc6003d54dbcf4e65f2ad9f68686298ff7683da945a61"],
    material: "424ff41f6e5d41969c635fcd61be9b3f_132.jpg",
    bounds: [[1.518, -1.22, -0.498], [1.684, -1.08, -0.402]],
  },
] as const;

function fakeTarget(index: number): GrandHallT554CleanupTarget {
  const facts = EXACT_TARGET_FACTS[index];
  if (facts === undefined) throw new Error("Missing exact test target facts.");
  return {
    targetId: grandHallT554CleanupMarkerTargetId(facts.groupName),
    artifactClass: "Mirror",
    localizationBasis: "exact_literal_mirror_prefixed_obj_group",
    sourceGroupName: facts.groupName,
    zeroBasedGroupOrdinal: facts.ordinal,
    sourceLineRangeOneBasedInclusive: {
      start: facts.lines[0],
      end: facts.lines[1],
    },
    sourceRoomKey: { groupIndex: 0, subIndex: 2 },
    sourceFaceOrdinalRangeZeroBasedInclusive: {
      start: facts.faces[0],
      end: facts.faces[1],
    },
    sourceFaceCount: facts.faces[2],
    sourceFaceOrdinalSha256: facts.faceOrdinalSha256,
    sourceFaceRecordSha256: facts.faceRecordSha256,
    uniqueVertexCount: facts.vertices[0],
    uniqueVertexIndexSha256: facts.vertices[1],
    materialNames: [facts.material],
    boundsMeters: {
      min: [facts.bounds[0][0], facts.bounds[0][1], facts.bounds[0][2]],
      max: [facts.bounds[1][0], facts.bounds[1][1], facts.bounds[1][2]],
    },
    selectedRoomMatch: false,
    uniqueVerticesSharedWithSelectedRoom: 0,
    disposition: GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION,
    cleanupDecision: "not_made_human_review_required",
    faceRemovalAuthorized: false,
    generatedGeometryUsed: false,
  };
}

const FAKE_SOURCE_BINDINGS = {
  captureStageManifest: {
    sourceLocator: "CAPTURE_STAGE_ROOT/capture-stage-manifest.json",
    byteLength: 50_122,
    sha256: "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff",
    schemaVersion: "venviewer.capture-stage.v1",
    planSha256: "sha256:d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729",
    fileCount: 156,
    totalBytes: 22_277_494_876,
    sourceBytesReadThisRun: true,
  },
  room9SourceBoundaryEvidence: {
    sourceLocator: "REPOSITORY/docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
    byteLength: 19_200,
    serializedFileSha256:
      "sha256:dd4e3348ffaf164de62497dd659b317b7c4e3ee761144417b8dff8f43b181f6d",
    evidenceSha256: "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
    sourceBytesReadThisRun: true,
  },
  obj: {
    sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.obj",
    byteLength: 38_381_816,
    sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
    sourceBytesReadThisRun: true,
  },
  mtl: {
    sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.mtl",
    byteLength: 20_879,
    sha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
    sourceBytesReadThisRun: true,
  },
  matterpakReadme: {
    sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/readme.pdf",
    byteLength: 197_005,
    sha256: "sha256:fed6e334ea3a3a7eb769c5d67df75a3389d8b18891cec8f137fc9010925ab048",
    sourceBytesReadThisRun: true,
  },
  pointCloud: {
    sourceLocator: "CAPTURE_STAGE_ROOT/source/matterpak/cloud.xyz",
    byteLength: 1_611_296_012,
    sha256: "sha256:a1e5fc55f62897e4cd08851f4e7e07e3949cc8e1894fbc6c02d029863b821144",
    bindingBasis: "exact_capture_stage_manifest_entry",
    sourceBytesReadThisRun: false,
    usedForLocalization: false,
  },
} as const satisfies GrandHallT554CleanupMarkerEvidenceMaterial["sourceBindings"];

const FAKE_OBJ_INVENTORY = {
  vertexRecordCount: 237_561,
  textureCoordinateRecordCount: 531_888,
  faceRecordCount: 474_049,
  groupRecordCount: 159,
  useMaterialRecordCount: 159,
  literalChunkNamedGroupCount: 154,
  literalMirrorNamedGroupCount: 5,
  literalWindowNamedGroupCount: 0,
  otherGroupNameCount: 0,
  groupInventorySha256:
    "sha256:d0c82ec4789345762238f73b928afc2b5dc6f05773bac06958e0c33e17786fb7",
  selectedRoomGroupCount: 43,
  selectedRoomFaceCount: 119_564,
  selectedRoomUniqueVertexCount: 59_049,
} as const;

const FAKE_GUARDS = {
  sourceMutationPermitted: false,
  cleanupApplied: false,
  sourceFacesRemoved: false,
  windowAbsenceClaimed: false,
  humanAcceptanceRecorded: false,
  nativeSourceReviewCompleted: false,
  architecturalAuthority: "none",
  roomBoundaryAuthority: "none",
  replacementGeometryGenerated: false,
  generatedContentUsed: false,
  trainingAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  stagingAuthorized: false,
  deploymentAuthorized: false,
  publicEvidenceAuthorized: false,
} as const;

function fakeClassEvidence(
  targets: readonly GrandHallT554CleanupTarget[],
): GrandHallT554CleanupMarkerEvidenceMaterial["classEvidence"] {
  return [{
    artifactClass: "Window",
    localizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
    sourceLiteralGroupMatchRule: "case_sensitive_window_prefix",
    literalNamedGroupCount: 0,
    localizedTargetIds: [],
    absenceOfMarkerEffectClaimed: false,
    completenessScope: "literal_obj_group_names_only",
    nativeSourceReviewCompleted: false,
    humanReviewRequired: true,
  }, {
    artifactClass: "Mirror",
    localizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
    sourceLiteralGroupMatchRule: "case_sensitive_mirror_prefix",
    literalNamedGroupCount: 5,
    localizedTargetIds: targets.map((target) => target.targetId),
    absenceOfMarkerEffectClaimed: false,
    completenessScope:
      "every_obj_group_name_matching_exact_literal_mirror_prefix_in_bound_obj",
    nativeSourceReviewCompleted: false,
    humanReviewRequired: true,
  }];
}

function fakeEvidenceMaterial(): GrandHallT554CleanupMarkerEvidenceMaterial {
  const targets = Array.from({ length: 5 }, (_, index) => fakeTarget(index));
  return {
    schemaVersion: GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA,
    subject: {
      venueId: "trades-hall",
      roomId: "grand-hall",
      taskId: "T-554",
      scope: "source_explicit_cleanup_marker_localization_only",
      selectedMatterpakRoomKey: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
      },
    },
    authority: "none",
    reviewState: "machine_inventory_complete_human_pending",
    sourceBindings: FAKE_SOURCE_BINDINGS,
    vendorMarkerSemantics: {
      evidenceBasis: "human_reviewed_paraphrase_of_exact_hash_bound_matterpak_readme",
      referencedPagesOneBased: [2, 4],
      objMarkerEffect:
        "Window and Mirror markers may add triangular closure walls and remove mesh behind the marker line.",
      pointCloudMarkerEffect:
        "The XYZ export has points removed behind marker classes and does not contain the OBJ closure-wall triangles.",
      perMarkerManifestPresentInBoundEvidence: false,
      objGroupNamingGuaranteePresentInBoundEvidence: false,
      architecturalAuthority: "none",
    },
    objInventory: FAKE_OBJ_INVENTORY,
    targetIdRule: "matterpak-obj-group:<exact-source-group-name>",
    explicitCleanupTargets: targets,
    cleanupTargetInventorySha256: computeGrandHallT554CleanupTargetInventorySha256(targets),
    classEvidence: fakeClassEvidence(targets),
    guards: FAKE_GUARDS,
    limitations: [
      "Literal OBJ group names provide exact source locators for five Mirror-labelled groups, but neither their non-selected group keys nor their separate vertex indices prove physical exclusion from the Grand Hall or their visual effect.",
      "No literal Window-prefixed OBJ group exists in the bound OBJ; this is metadata-inconclusive and is not evidence that Window marker effects are absent.",
      "The bound MatterPak README describes marker-driven closure walls and mesh removal generally but provides no per-marker manifest or group-naming guarantee.",
      "The staged point cloud is marker-affected according to the vendor documentation and was not used to localize cleanup targets in this run.",
      "Every cleanup decision, any face removal, and native-source visual review remain human-pending.",
    ],
  };
}

function fakeBuiltPack(): GrandHallT554CleanupMarkerBuiltPack {
  const evidence = sealGrandHallT554CleanupMarkerEvidence(fakeEvidenceMaterial());
  const evidenceBytes = serializeGrandHallT554CleanupMarkerEvidence(evidence);
  const receipt = buildGrandHallT554CleanupMarkerReceipt(evidence, evidenceBytes);
  return {
    evidence,
    evidenceBytes,
    receipt,
    receiptBytes: serializeGrandHallT554CleanupMarkerReceipt(receipt),
  };
}

function differentlySerializedPack(
  built: GrandHallT554CleanupMarkerBuiltPack,
): GrandHallT554CleanupMarkerBuiltPack {
  const evidenceBytes = Buffer.from(`${JSON.stringify(built.evidence)}\n`, "utf8");
  const receipt = buildGrandHallT554CleanupMarkerReceipt(built.evidence, evidenceBytes);
  return {
    evidence: built.evidence,
    evidenceBytes,
    receipt,
    receiptBytes: serializeGrandHallT554CleanupMarkerReceipt(receipt),
  };
}

describe("T-554 cleanup-marker source analysis", () => {
  it("localizes literal Mirror groups while keeping Window evidence inconclusive", () => {
    const analysis = analyzeGrandHallT554CleanupMarkerObj(SYNTHETIC_OBJ);

    expect(analysis.explicitCleanupTargets).toHaveLength(1);
    expect(analysis.explicitCleanupTargets[0]).toMatchObject({
      targetId: "matterpak-obj-group:mirror001_group000_sub002",
      sourceGroupName: "mirror001_group000_sub002",
      sourceFaceCount: 1,
      selectedRoomMatch: false,
      uniqueVerticesSharedWithSelectedRoom: 0,
      disposition:
        "source_group_key_differs_from_selected_room_key_physical_relevance_unresolved",
      faceRemovalAuthorized: false,
      generatedGeometryUsed: false,
    });
    expect(analysis.objInventory).toMatchObject({
      literalMirrorNamedGroupCount: 1,
      literalWindowNamedGroupCount: 0,
      selectedRoomGroupCount: 1,
      selectedRoomFaceCount: 1,
    });
    expect(analysis.windowLocalizationState)
      .toBe("metadata_inconclusive_no_explicit_source_locator");
    expect(analysis.mirrorLocalizationState)
      .toBe("literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified");
    expect(() => {
      assertExactGrandHallT554CleanupMarkerAnalysis(analysis);
    })
      .toThrow(expect.objectContaining({ code: "SOURCE_MISMATCH" }));
  });

  it("rejects invented cleanup target identifiers", () => {
    expect(() => grandHallT554CleanupMarkerTargetId("window1_group001_sub009"))
      .toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
    expect(() => grandHallT554CleanupMarkerTargetId("mirror-not-a-source-group"))
      .toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });
});

describe("T-554 cleanup-marker semantic sealing", () => {
  it("seals and parses authority-none evidence and receipt cross-digests", () => {
    const built = fakeBuiltPack();
    const evidence = parseGrandHallT554CleanupMarkerEvidence(built.evidenceBytes);
    const receipt = parseGrandHallT554CleanupMarkerReceipt(built.receiptBytes);

    expect(evidence.authority).toBe("none");
    expect(evidence.classEvidence[0]).toMatchObject({
      artifactClass: "Window",
      localizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
      localizedTargetIds: [],
      absenceOfMarkerEffectClaimed: false,
      nativeSourceReviewCompleted: false,
    });
    expect(evidence.guards).toMatchObject({
      cleanupApplied: false,
      sourceFacesRemoved: false,
      windowAbsenceClaimed: false,
      generatedContentUsed: false,
    });
    expect(receipt).toMatchObject({
      schemaVersion: GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_SCHEMA,
      evidenceSha256: evidence.evidenceSha256,
      cleanupTargetInventorySha256: evidence.cleanupTargetInventorySha256,
      receiptWrittenLast: true,
    });
  });

  it("rejects forged semantic digests and any Window absence claim", () => {
    const built = fakeBuiltPack();
    const forgedDigest = JSON.parse(built.evidenceBytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    forgedDigest.evidenceSha256 = digest("forged");
    expect(() => parseGrandHallT554CleanupMarkerEvidence(
      Buffer.from(`${JSON.stringify(forgedDigest)}\n`, "utf8"),
    )).toThrow(expect.objectContaining({ code: "OUTPUT_VERIFICATION_FAILED" }));

    const material = fakeEvidenceMaterial();
    const forgedWindow = {
      ...material,
      classEvidence: [
        { ...material.classEvidence[0], absenceOfMarkerEffectClaimed: true },
        material.classEvidence[1],
      ],
    };
    expect(() => sealGrandHallT554CleanupMarkerEvidence(
      forgedWindow as GrandHallT554CleanupMarkerEvidenceMaterial,
    )).toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });

  it("rejects a self-consistent pack whose exact source-face digest was forged", () => {
    const material = fakeEvidenceMaterial();
    const targets = material.explicitCleanupTargets.map((target, index) =>
      index === 0 ? { ...target, sourceFaceRecordSha256: digest("forged-face") } : target
    );
    const forged = {
      ...material,
      explicitCleanupTargets: targets,
      cleanupTargetInventorySha256:
        computeGrandHallT554CleanupTargetInventorySha256(targets),
      classEvidence: [
        material.classEvidence[0],
        {
          ...material.classEvidence[1],
          localizedTargetIds: targets.map((target) => target.targetId),
        },
      ],
    };

    expect(() => sealGrandHallT554CleanupMarkerEvidence(
      forged as GrandHallT554CleanupMarkerEvidenceMaterial,
    )).toThrow(expect.objectContaining({ code: "SOURCE_MISMATCH" }));
  });
});

async function makeTestPaths(prefix: string): Promise<{
  readonly root: string;
  readonly options: {
    readonly captureStageRoot: string;
    readonly sourceBoundaryEvidencePath: string;
    readonly outputDirectory: string;
  };
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  const stage = join(root, "stage");
  const evidenceRoot = join(root, "source-evidence");
  const sourceBoundaryEvidencePath = join(evidenceRoot, "boundary.json");
  const outputDirectory = join(root, "output");
  await mkdir(stage);
  await mkdir(evidenceRoot);
  await writeFile(sourceBoundaryEvidencePath, "{}\n", { flag: "wx" });
  return {
    root,
    options: { captureStageRoot: stage, sourceBoundaryEvidencePath, outputDirectory },
  };
}

describe("T-554 race-safe no-replace receipt-last publication", () => {
  it("publishes two exact structural files without source-verification claims", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-");
    const built = fakeBuiltPack();
    const published = await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      built,
    );
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    const receiptPath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
    );
    const beforeBytes = await Promise.all([readFile(evidencePath), readFile(receiptPath)]);
    const beforeStats = await Promise.all([stat(evidencePath), stat(receiptPath)]);
    const inspected = await inspectPersistedGrandHallT554CleanupMarkerEvidencePackStructure(
      options.outputDirectory,
    );
    const afterBytes = await Promise.all([readFile(evidencePath), readFile(receiptPath)]);
    const afterStats = await Promise.all([stat(evidencePath), stat(receiptPath)]);

    expect(published).toMatchObject({
      explicitCleanupTargetCount: 5,
      windowLocalizedTargetCount: 0,
      mirrorLocalizedTargetCount: 5,
      outputFileCount: 2,
      authority: "none",
      cleanupApplied: false,
      sourceFacesRemoved: false,
      sourceVerificationState: "not_checked_structural_only",
    });
    expect(published.evidenceFileSha256).toBe(
      `sha256:${createHash("sha256").update(built.evidenceBytes).digest("hex")}`,
    );
    expect(published.receiptFileSha256).toBe(
      `sha256:${createHash("sha256").update(built.receiptBytes).digest("hex")}`,
    );
    expect(inspected.sourceVerificationState).toBe("not_checked_structural_only");
    expect(afterBytes[0]?.equals(beforeBytes[0] as Buffer)).toBe(true);
    expect(afterBytes[1]?.equals(beforeBytes[1] as Buffer)).toBe(true);
    expect(afterStats.map((value) => value.mtimeMs))
      .toEqual(beforeStats.map((value) => value.mtimeMs));
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      built,
    ))
      .rejects.toBeDefined();
  });

  it("never replaces a destination that appears after the safety check", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-destination-race-");
    const markerPath = join(options.outputDirectory, "foreign.txt");
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
      {
        beforeOutputReservation: async () => {
          await mkdir(options.outputDirectory);
          await writeFile(markerPath, "foreign", { flag: "wx" });
        },
      },
    )).rejects.toBeDefined();

    await expect(readFile(markerPath, "utf8")).resolves.toBe("foreign");
  });

  it("quarantines a reserved directory rather than deleting a raced foreign file", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-file-race-");
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
      {
        afterOutputReservation: async () => {
          await writeFile(evidencePath, "foreign", { flag: "wx" });
        },
      },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    await expect(readFile(evidencePath, "utf8")).resolves.toBe("foreign");
  });

  it("never deletes its first file when a foreign receipt wins the exclusive name", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-receipt-race-");
    const built = fakeBuiltPack();
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    const receiptPath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
    );
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      built,
      {
        beforeReceiptWrite: () => writeFile(receiptPath, "foreign", { flag: "wx" }),
      },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    await expect(readFile(evidencePath)).resolves.toEqual(built.evidenceBytes);
    await expect(readFile(receiptPath, "utf8")).resolves.toBe("foreign");
  });

  it("rejects a different valid serialization raced in before its first inspection", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-built-byte-race-");
    const built = fakeBuiltPack();
    const replacement = differentlySerializedPack(built);
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    const receiptPath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
    );
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      built,
      {
        beforeInspection: async () => {
          await unlink(evidencePath);
          await unlink(receiptPath);
          await writeFile(evidencePath, replacement.evidenceBytes, { flag: "wx" });
          await writeFile(receiptPath, replacement.receiptBytes, { flag: "wx" });
        },
      },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    await expect(readFile(evidencePath)).resolves.toEqual(replacement.evidenceBytes);
    await expect(readFile(receiptPath)).resolves.toEqual(replacement.receiptBytes);
  });

  it("quarantines a replacement of its reserved output directory", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-directory-race-");
    await expect(__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
      {
        afterOutputReservation: async () => {
          await rmdir(options.outputDirectory);
          await mkdir(options.outputDirectory);
        },
      },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    expect((await stat(options.outputDirectory)).isDirectory()).toBe(true);
  });

  it("rejects output inventory mutation during structural inspection", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-drift-");
    await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
    );
    await expect(__testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure(
      options.outputDirectory,
      {
        afterInitialDirectorySnapshot: () =>
          writeFile(join(options.outputDirectory, "unexpected.txt"), "drift", { flag: "wx" }),
      },
    )).rejects.toBeInstanceOf(GrandHallT554CleanupMarkerEvidenceError);
  });

  it("rejects same-name output file replacement between inventory snapshots", async () => {
    const { options } = await makeTestPaths("grand-hall-cleanup-marker-replacement-");
    await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
    );
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    const evidenceBytes = await readFile(evidencePath);
    await expect(__testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure(
      options.outputDirectory,
      {
        afterInitialDirectorySnapshot: async () => {
          await unlink(evidencePath);
          await writeFile(evidencePath, evidenceBytes, { flag: "wx" });
        },
      },
    )).rejects.toBeInstanceOf(GrandHallT554CleanupMarkerEvidenceError);
  });

  it("rejects swap-read-restore even when the original file returns for the final snapshot", async () => {
    const { root, options } = await makeTestPaths("grand-hall-cleanup-marker-read-splice-");
    await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
    );
    const evidencePath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    );
    const backupPath = join(root, "original-evidence.json");
    const evidenceBytes = await readFile(evidencePath);
    await expect(__testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure(
      options.outputDirectory,
      {
        afterInitialDirectorySnapshot: async () => {
          await rename(evidencePath, backupPath);
          await writeFile(evidencePath, evidenceBytes, { flag: "wx" });
        },
        afterOutputReads: async () => {
          await unlink(evidencePath);
          await rename(backupPath, evidencePath);
        },
      },
    )).rejects.toBeInstanceOf(GrandHallT554CleanupMarkerEvidenceError);
  });

  it("rejects a hard-linked output payload", async () => {
    const { root, options } = await makeTestPaths("grand-hall-cleanup-marker-hardlink-");
    await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
    );
    const receiptPath = join(
      options.outputDirectory,
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
    );
    await expect(__testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure(
      options.outputDirectory,
      {
        afterInitialDirectorySnapshot: () =>
          link(receiptPath, join(root, "receipt-hardlink.json")),
      },
    ))
      .rejects.toBeInstanceOf(GrandHallT554CleanupMarkerEvidenceError);
  });

  it.runIf(process.platform === "win32")("rejects a junction used as the output leaf", async () => {
    const { root, options } = await makeTestPaths("grand-hall-cleanup-marker-junction-");
    await __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
      options,
      fakeBuiltPack(),
    );
    const junctionPath = join(root, "output-junction");
    await symlink(options.outputDirectory, junctionPath, "junction");

    await expect(inspectPersistedGrandHallT554CleanupMarkerEvidencePackStructure(junctionPath))
      .rejects.toBeDefined();
  });

  it("exposes no injectable exact-build or exact-check dependency parameter", () => {
    expect(generateGrandHallT554CleanupMarkerEvidencePack).toHaveLength(1);
    expect(checkGrandHallT554CleanupMarkerEvidencePack).toHaveLength(1);
    expect(runGrandHallT554CleanupMarkerEvidenceCli).toHaveLength(2);
    const internalConstructionExports = [
      "GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_DOMAIN",
      "GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_DOMAIN",
      "GRAND_HALL_T554_CLEANUP_TARGET_INVENTORY_DOMAIN",
      "GrandHallT554CleanupMarkerEvidenceMaterialSchema",
      "GrandHallT554CleanupMarkerEvidenceSchema",
      "GrandHallT554CleanupMarkerReceiptSchema",
      "GrandHallT554CleanupTargetSchema",
      "analyzeGrandHallT554CleanupMarkerObj",
      "assertExactGrandHallT554CleanupMarkerAnalysis",
      "buildGrandHallT554CleanupMarkerReceipt",
      "computeGrandHallT554CleanupTargetInventorySha256",
      "grandHallT554CleanupMarkerTargetId",
      "parseGrandHallT554CleanupMarkerEvidence",
      "parseGrandHallT554CleanupMarkerReceipt",
      "sealGrandHallT554CleanupMarkerEvidence",
      "serializeGrandHallT554CleanupMarkerEvidence",
      "serializeGrandHallT554CleanupMarkerReceipt",
      "__testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure",
      "__testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure",
    ];
    for (const name of internalConstructionExports) {
      expect(name in reconstructionFoundryCliPublic).toBe(false);
    }
  });
});

describe("T-554 cleanup-marker CLI", () => {
  it("parses required paths exactly once and reports the additive v2 help", async () => {
    const argv = [
      "--check",
      "--stage",
      "C:\\stage",
      "--source-boundary-evidence",
      "C:\\repo\\boundary.json",
      "--output",
      "D:\\evidence",
    ];
    expect(parseGrandHallT554CleanupMarkerEvidenceArguments(argv)).toEqual({
      check: true,
      captureStageRoot: "C:\\stage",
      sourceBoundaryEvidencePath: "C:\\repo\\boundary.json",
      outputDirectory: "D:\\evidence",
    });
    expect(() => parseGrandHallT554CleanupMarkerEvidenceArguments([
      ...argv,
      "--stage",
      "C:\\other",
    ])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));

    const output: string[] = [];
    await expect(runGrandHallT554CleanupMarkerEvidenceCli(
      ["--help"],
      { write: (text) => output.push(text) },
    )).resolves.toBe(0);
    expect(output.join("")).toContain("evidence v2 pack");
  });
});
