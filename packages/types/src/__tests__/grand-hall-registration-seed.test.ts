import { describe, expect, it } from "vitest";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "../canonical-layout-snapshot.js";

import {
  GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
  GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
  GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX,
  GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
  GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256,
  GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE,
  GRAND_HALL_REGISTRATION_SEED_INITIAL_MATRIX_FLOAT64_HEX,
  GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS,
  GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS,
  GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_CORRESPONDENCE_COUNT,
  GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS,
  GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
  GrandHallRegistrationSeedV1MaterialSchema,
  GrandHallRegistrationSeedV1Schema,
  computeGrandHallRegistrationSeedIterationSha256,
  computeGrandHallRegistrationSeedMatrixSha256,
  computeGrandHallRegistrationSeedMetricsSha256,
  computeGrandHallRegistrationSeedReplayResultSha256,
  computeGrandHallRegistrationSeedTraceSha256,
  computeGrandHallRegistrationSeedV1Sha256,
  type GrandHallRegistrationSeedV1,
  type GrandHallRegistrationSeedV1Material,
} from "../grand-hall-registration-seed.js";

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function matrix() {
  return [...GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX] as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
    "3ff0000000000000",
  ];
}

function buildMaterial(): GrandHallRegistrationSeedV1Material {
  const iterations =
    GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS.map(
      (mutualCorrespondenceCount, index) => {
        const iterationOrdinal = index + 1;
        const stage = GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE.find(
          (candidate) =>
            iterationOrdinal >= candidate.firstIteration &&
            iterationOrdinal <= candidate.lastIteration,
        );
        if (stage === undefined)
          throw new Error("fixed test schedule is incomplete");
        const material = {
          iterationOrdinal,
          stageOrdinal: stage.stageOrdinal,
          maximumCorrespondenceDistanceMetresFloat64Hex:
            stage.maximumCorrespondenceDistanceMetresFloat64Hex,
          sourceVertexCount: 24_977,
          targetVertexCount: 59_049,
          mutualCorrespondenceCount,
          correspondencePairInventoryRawSha256:
            GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256[index]!,
        };
        return {
          ...material,
          iterationSha256:
            computeGrandHallRegistrationSeedIterationSha256(material),
        };
      },
    );
  const traceMaterial = {
    iterationCount: 40 as const,
    iterations: [...iterations],
  };
  const iterationTrace = {
    ...traceMaterial,
    traceSha256: computeGrandHallRegistrationSeedTraceSha256(traceMaterial),
  };
  const candidateMatrix = matrix();
  const lastFitMetrics = { ...GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS };
  const postfitMetrics = {
    ...GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS,
  };
  const allSourceMetrics = {
    ...GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
  };
  const replayBindings = {
    workerSchemaVersion: GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1,
    implementationSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
    environmentLockSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
    environmentLockAppliedToExecution: false,
    loadedRuntimeClosureVerifiedAgainstLock: false,
    algorithmCanonicalJsonSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
    seedAdapterCanonicalJsonSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
    determinismScope: "same_runtime_same_host_only" as const,
  } as const;
  const sourceOrdinals =
    "sha256:dd4472d4ae5a0c3a926e69565733923a464a0779e16f37963889184e0db3035d";
  const sourceCoordinates =
    "sha256:337109fc3a5b0224df6ef6d90c2e799f31ce9c613d34cb94b666e1382dadefd6";
  const targetOrdinals =
    "sha256:91f810dcec2873d9e3d072b3f53b393f82f1ea62c0fc5b1f0095cfbb7db6e917";
  const targetCoordinates =
    "sha256:27e7d980d3e535dad43d59af4c17ff3d8152c0138d5c8904eb2e2e319d5acdde";
  const lastFitPairs = iterations[39]!.correspondencePairInventoryRawSha256;
  const finalResult = {
    lastFitInput: {
      iterationOrdinal: 40 as const,
      correspondenceCount:
        GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS[39],
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256: lastFitPairs,
      distancesPackedLittleEndianFloat64RawSha256:
        "sha256:61f56f6eb0c80e805bf33563d4ca9d8844b15fecfc74bdf18c04855a3d3e112a",
      metrics: lastFitMetrics,
    },
    candidateArfToCvfRowMajorMatrixFloat64Hex: candidateMatrix,
    finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256:
      "sha256:c2cd63576b9227ed27a136ff87a4823e6401b5318de27f046a0c05567e0c7d2a",
    postfitAllSourceToTargetAudit: {
      sourceVertexCount: 24_977 as const,
      distancesPackedLittleEndianFloat64RawSha256:
        "sha256:db86df37dcdab47a1f8e6f146cab61e6a02b5f87dc1b4a0345dbd82972ebb7d4",
      metrics: allSourceMetrics,
    },
    postfitAudit: {
      maximumCorrespondenceDistanceMetresFloat64Hex:
        "3fbeb851eb851eb8" as const,
      correspondenceCount:
        GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_CORRESPONDENCE_COUNT,
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256:
        "sha256:9ee8d05eab0925f04734700ccd1eeebb7612bc2f81a3a9fd039e6f3f9b0bcc5e",
      distancesPackedLittleEndianFloat64RawSha256:
        "sha256:373711d105def9ab5992788e8ab4bbe05697ceeddce117ba3781477f55a413bd",
      metrics: postfitMetrics,
      exactNearestNeighbourTies: [
        {
          direction: "source_to_target" as const,
          tiedQueryVertexCount: 1 as const,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            "sha256:07e48e05237181ba2b3b532ee75511b2c10e7d8be4b2b30b551ecbb80e622c20",
        },
        {
          direction: "target_to_source" as const,
          tiedQueryVertexCount: 1_002 as const,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            "sha256:2463918bd6d02825251cb09d67087a86802cbf5c42c0b55f5994c41636a4746e",
        },
      ] as const,
    },
    termination: "fixed_40_iterations" as const,
    convergenceClaimed: false as const,
  };
  const replayResultMaterial = {
    workerSchemaVersion: replayBindings.workerSchemaVersion,
    implementationSha256: replayBindings.implementationSha256,
    environmentLockSha256: replayBindings.environmentLockSha256,
    environmentLockAppliedToExecution:
      replayBindings.environmentLockAppliedToExecution,
    loadedRuntimeClosureVerifiedAgainstLock:
      replayBindings.loadedRuntimeClosureVerifiedAgainstLock,
    algorithmCanonicalJsonSha256: replayBindings.algorithmCanonicalJsonSha256,
    seedAdapterCanonicalJsonSha256:
      replayBindings.seedAdapterCanonicalJsonSha256,
    sourceSelectedOrdinalInventoryRawSha256: sourceOrdinals,
    sourceSelectedCoordinateInventoryRawSha256: sourceCoordinates,
    targetSelectedOrdinalInventoryRawSha256: targetOrdinals,
    targetSelectedCoordinateInventoryRawSha256: targetCoordinates,
    iterationTraceSha256: iterationTrace.traceSha256,
    lastFitInputCorrespondenceInventoryRawSha256: lastFitPairs,
    lastFitInputDistanceInventoryRawSha256:
      finalResult.lastFitInput.distancesPackedLittleEndianFloat64RawSha256,
    lastFitInputCorrespondenceCount:
      finalResult.lastFitInput.correspondenceCount,
    lastFitInputMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(lastFitMetrics),
    finalMatrixSha256:
      computeGrandHallRegistrationSeedMatrixSha256(candidateMatrix),
    finalTransformedSelectedSourceRawSha256:
      finalResult.finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetDistanceInventoryRawSha256:
      finalResult.postfitAllSourceToTargetAudit
        .distancesPackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(allSourceMetrics),
    postfitCorrespondenceInventoryRawSha256:
      finalResult.postfitAudit
        .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256,
    postfitCorrespondenceDistanceInventoryRawSha256:
      finalResult.postfitAudit.distancesPackedLittleEndianFloat64RawSha256,
    postfitCorrespondenceCount: finalResult.postfitAudit.correspondenceCount,
    postfitMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(postfitMetrics),
    sourceToTargetTieCount: 1,
    sourceToTargetTieOrdinalInventoryRawSha256:
      "sha256:07e48e05237181ba2b3b532ee75511b2c10e7d8be4b2b30b551ecbb80e622c20",
    targetToSourceTieCount: 1_002,
    targetToSourceTieOrdinalInventoryRawSha256:
      "sha256:2463918bd6d02825251cb09d67087a86802cbf5c42c0b55f5994c41636a4746e",
    workerCanonicalReceiptSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
  } as const;
  const replayResultSha256 =
    computeGrandHallRegistrationSeedReplayResultSha256(replayResultMaterial);
  const run = (replayOrdinal: 1 | 2) => ({
    replayOrdinal,
    ...replayResultMaterial,
    replayResultSha256,
  });

  return GrandHallRegistrationSeedV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1,
    artifactId: "grand-hall-historical-registration-seed-001",
    createdAt: "2026-08-28T14:00:00.000Z",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    classification: "historical_replay_candidate",
    source: {
      frame: "ARF",
      coordinateConvention: "xgrids_big_obj_native_source_z_up",
      exactBigObj: {
        sha256:
          "sha256:ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
        byteLength: 2_222_742,
        vertexRecordCount: 34_040,
        faceRecordCount: 59_763,
        orderedVerticesPackedLittleEndianFloat64RawSha256:
          "sha256:94515cd5c338cae7b774c698cc880b31c85035f45247aab98f2847a5f4bfdb9e",
        boundsMetres: {
          min: [-31.858929, -23.662237, -6.327585],
          max: [3.825, 4.925, 8.617472],
        },
      },
      upstreamLineage: {
        rawXgridsReceiptSha256:
          "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a",
        rawXgridsInventorySha256:
          "sha256:6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236",
        rawXgridsXbinSha256:
          "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
        processedBigModelGuid: "2d483e031ad40e259c75f765d6f5fcbb",
        processedBigInventorySha256:
          GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
        historicalSogCoreInventorySha256:
          "sha256:4585ff38e79858c35c4c1774a29a759ff85881bf5ee3d46bd7f96cae40e69c5a",
        historicalSogManifestSha256:
          "sha256:927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
        historicalFrontierReceiptSha256:
          "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
      },
      selection: {
        rule: "all_big_obj_vertices_whose_fixed_initial_placement_is_within_expanded_room9_vertex_aabb",
        initialPlacement: {
          operationOrder: "positive_90_degrees_about_z_then_translate",
          translationMetres: [0, 0, 2.3],
          rowMajorMatrixFloat64Hex: [
            ...GRAND_HALL_REGISTRATION_SEED_INITIAL_MATRIX_FLOAT64_HEX,
          ],
        },
        targetEnvelopeBasis: "exact_room9_unique_face_referenced_vertex_aabb",
        aabbExpansionMetresFloat64Hex: "3fe8000000000000",
        boundaryComparison: "inclusive_on_all_three_axes",
        ordering:
          "trimesh_loaded_vertex_ordinal_ascending_with_process_false_and_maintain_order_true",
        expectedSelectedVertexCount: 24_977,
        selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256:
          sourceOrdinals,
        selectedOriginalVerticesPackedLittleEndianFloat64RawSha256:
          sourceCoordinates,
        selectedVertexInventoryCount: 24_977,
      },
    },
    target: {
      frame: "CVF",
      coordinateConvention: "matterpak_local_metres_right_handed_z_up",
      exactMatterPakObj: {
        sha256:
          "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
        byteLength: 38_381_816,
        vertexRecordCount: 237_561,
        faceRecordCount: 474_049,
        orderedVerticesPackedLittleEndianFloat64RawSha256:
          "sha256:6131e230ef394052f760be75bc2b8dcf7812dafe405dad3b22f1fd049cf7a72f",
        boundsMetres: {
          min: [-6.166, -12.362, -4.151],
          max: [21.365002, 13.696001, 9.05],
        },
      },
      exactRoom9: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
        groupCount: 43,
        faceCount: 119_564,
        uniqueGlobalFaceReferencedVertexCount: 59_049,
        connectedComponentCount: 90,
        verticesSharedWithOtherRoomGroups: 174,
        vertexAabbMetres: {
          min: [-2.425, -11.334001, -1.02],
          max: [19.695002, 1.553, 9.05],
        },
        faceOrdinalInventorySha256:
          "sha256:bdad33cd4525d7b2edba37a8b7ee730ea0ba184b32e24e43123a0ad2bc4e4d75",
      },
      upstreamLineage: {
        matterPakE57ReceiptSha256:
          "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
        room9BoundaryEvidenceSha256:
          "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
        room9BoundaryManifestSha256:
          "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3",
        interfaceAtlasSha256:
          "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc",
        scopeReviewPackSha256:
          "sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530",
      },
      selection: {
        rule: "unique_global_vertices_referenced_by_all_exact_room9_faces",
        faceSelectionPredicate:
          "active_obj_group_string_ends_with__group001_sub009",
        deduplicationKey: "matterpak_obj_global_vertex_ordinal",
        ordering: "matterpak_obj_global_vertex_ordinal_ascending",
        selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256:
          targetOrdinals,
        selectedOrderedVerticesPackedLittleEndianFloat64RawSha256:
          targetCoordinates,
        selectedVertexInventoryCount: 59_049,
      },
    },
    replayBindings,
    schedule: {
      method: "mutual_nearest_neighbor_point_to_point_icp",
      iterationCount: 40,
      stages: GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE.map((stage) => ({
        ...stage,
      })),
    },
    iterationTrace,
    finalResult,
    repeatability: {
      method: "two_separate_os_process_replays_with_identical_bound_inputs",
      replayCount: 2,
      twoProcessProofSchemaVersion:
        GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
      twoProcessProofCanonicalJsonSha256:
        GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
      twoProcessProofCanonicalJsonVerified: true,
      twoProcessProofReceiptBindingVerified: true,
      childEntryImplementationSha256:
        GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256,
      twoProcessRunnerImplementationSha256:
        GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
      canonicalWorkerReceiptByteLength:
        GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
      canonicalWorkerReceiptIncludedInProof: false,
      runs: [run(1), run(2)],
      determinismScope: "same_runtime_same_host_only",
      bitExactCanonicalWorkerReceipt: true,
      bitExactMappedIterationTrace: true,
      completeWorkerIterationEvidenceBoundByCanonicalReceipt: true,
      bitExactFinalCorrespondences: true,
      bitExactFinalMatrix: true,
      bitExactFinalMetrics: true,
    },
    guardrails: {
      authority: "none",
      architecturalEvidence: false,
      humanReviewRequiredBeforeAnyPromotion: true,
      productionTrust: null,
      roomMembershipAuthority: "none",
      sourceSelectionIsGrandHallMask: false,
      cleanupDecisionAccepted: false,
      matrixPermittedUse: "historical_candidate_nomination_aid_only",
      matrixUsedAsMeasurement: false,
      matrixUsedAsSolverInput: false,
      coordinatePairs: null,
      acceptedTransform: null,
      outputMask: null,
      runtimeAdmission: null,
      deploymentAuthorization: null,
      publicationAuthorization: null,
      permitsCoordinateAcceptance: false,
      permitsTransformAcceptance: false,
      permitsOutputMasking: false,
      permitsRuntimeUse: false,
      permitsDeployment: false,
      permitsPublication: false,
    },
  });
}

function artifact(): GrandHallRegistrationSeedV1 {
  const material = buildMaterial();
  return GrandHallRegistrationSeedV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallRegistrationSeedV1Sha256(material),
  });
}

function resealUnchecked(
  value: GrandHallRegistrationSeedV1,
): GrandHallRegistrationSeedV1 {
  const { artifactSha256: previousArtifactSha256, ...material } = value;
  void previousArtifactSha256;
  const canonical = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(material),
  );
  return {
    ...material,
    artifactSha256: `sha256:${sha256Hex(
      `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}\n${canonical}`,
    )}`,
  };
}

function expectRejectedAfterTopLevelReseal(
  value: GrandHallRegistrationSeedV1,
  expectedIssuePathPrefix?: readonly (string | number)[],
): void {
  const result = GrandHallRegistrationSeedV1Schema.safeParse(
    resealUnchecked(value),
  );
  expect(result.success).toBe(false);
  if (!result.success && expectedIssuePathPrefix !== undefined) {
    expect(
      result.error.issues.some((issue) =>
        expectedIssuePathPrefix.every(
          (segment, index) => issue.path[index] === segment,
        ),
      ),
    ).toBe(true);
  }
}

describe("GrandHallRegistrationSeedV1Schema", () => {
  it("accepts a strict authority-none replay artifact and validates every canonical digest", () => {
    const value = artifact();
    expect(value.classification).toBe("historical_replay_candidate");
    expect(value.guardrails.authority).toBe("none");
    expect(value.finalResult.lastFitInput.correspondenceCount).toBe(8_294);
    expect(value.finalResult.postfitAudit.correspondenceCount).toBe(8_290);
    expect(
      value.finalResult.postfitAudit.exactNearestNeighbourTies.map(
        (tie) => tie.tiedQueryVertexCount,
      ),
    ).toEqual([1, 1_002]);
  });

  it("rejects the nearby 24,951 count for the exact historical selection", () => {
    const value = structuredClone(artifact());
    Reflect.set(value.source.selection, "expectedSelectedVertexCount", 24_951);
    expectRejectedAfterTopLevelReseal(value);
  });

  it("rejects a different source or target identity", () => {
    const wrongSource = structuredClone(artifact());
    Reflect.set(wrongSource.source.exactBigObj, "byteLength", 2_222_743);
    expectRejectedAfterTopLevelReseal(wrongSource);

    const wrongRoom = structuredClone(artifact());
    Reflect.set(wrongRoom.target.exactRoom9, "subIndex", 8);
    expectRejectedAfterTopLevelReseal(wrongRoom);

    const wrongProcessedInventory = structuredClone(artifact());
    Reflect.set(
      wrongProcessedInventory.source.upstreamLineage,
      "processedBigInventorySha256",
      digest(4),
    );
    expectRejectedAfterTopLevelReseal(wrongProcessedInventory);
  });

  it("rejects selection ambiguity, reinterpretation, or digest conflation", () => {
    const exclusive = structuredClone(artifact());
    Reflect.set(exclusive.source.selection, "boundaryComparison", "exclusive");
    expectRejectedAfterTopLevelReseal(exclusive);

    const conflated = structuredClone(artifact());
    Reflect.set(
      conflated.source.selection,
      "selectedOriginalVerticesPackedLittleEndianFloat64RawSha256",
      conflated.source.selection
        .selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256,
    );
    expectRejectedAfterTopLevelReseal(conflated);
  });

  it("rejects an incomplete, reordered, differently thresholded, or different-count trace", () => {
    const incomplete = structuredClone(artifact());
    Reflect.set(
      incomplete.iterationTrace,
      "iterations",
      incomplete.iterationTrace.iterations.slice(0, -1),
    );
    expectRejectedAfterTopLevelReseal(incomplete);

    const reordered = structuredClone(artifact());
    Reflect.set(reordered.iterationTrace.iterations[8]!, "iterationOrdinal", 8);
    expectRejectedAfterTopLevelReseal(reordered);

    const threshold = structuredClone(artifact());
    Reflect.set(
      threshold.iterationTrace.iterations[8]!,
      "maximumCorrespondenceDistanceMetresFloat64Hex",
      "3fe3333333333333",
    );
    expectRejectedAfterTopLevelReseal(threshold);

    const count = structuredClone(artifact());
    Reflect.set(
      count.iterationTrace.iterations[20]!,
      "mutualCorrespondenceCount",
      1,
    );
    expectRejectedAfterTopLevelReseal(count);
  });

  it("rejects non-canonical binary64 values and non-rigid matrices", () => {
    const uppercase = structuredClone(artifact());
    Reflect.set(
      uppercase.finalResult.candidateArfToCvfRowMajorMatrixFloat64Hex,
      0,
      "3FF0000000000000",
    );
    expectRejectedAfterTopLevelReseal(uppercase);

    const scaled = structuredClone(artifact());
    Reflect.set(
      scaled.finalResult.candidateArfToCvfRowMajorMatrixFloat64Hex,
      0,
      "4000000000000000",
    );
    expectRejectedAfterTopLevelReseal(scaled);
  });

  it("keeps iteration-40 prefit and postfit audit identities distinct", () => {
    const conflated = structuredClone(artifact());
    Reflect.set(
      conflated.finalResult.postfitAudit,
      "correspondenceCount",
      conflated.finalResult.lastFitInput.correspondenceCount,
    );
    expectRejectedAfterTopLevelReseal(conflated);
  });

  it("rejects false repeatability evidence or cross-host determinism claims", () => {
    const forgedProof = structuredClone(artifact());
    Reflect.set(
      forgedProof.repeatability,
      "twoProcessProofCanonicalJsonSha256",
      digest(998),
    );
    expectRejectedAfterTopLevelReseal(forgedProof);

    for (const field of [
      "twoProcessProofCanonicalJsonVerified",
      "twoProcessProofReceiptBindingVerified",
    ] as const) {
      const weakened = structuredClone(artifact());
      Reflect.set(weakened.repeatability, field, false);
      expectRejectedAfterTopLevelReseal(weakened, ["repeatability", field]);
    }

    const mismatch = structuredClone(artifact());
    Reflect.set(
      mismatch.repeatability.runs[1],
      "workerCanonicalReceiptSha256",
      digest(999),
    );
    expectRejectedAfterTopLevelReseal(mismatch, [
      "repeatability",
      "runs",
      1,
      "workerCanonicalReceiptSha256",
    ]);

    const validRun = artifact().repeatability.runs[0];
    const {
      replayOrdinal: validReplayOrdinal,
      replayResultSha256: validReplayResultSha256,
      ...forgedReplayResult
    } = validRun;
    void validReplayOrdinal;
    void validReplayResultSha256;
    Reflect.set(
      forgedReplayResult,
      "workerCanonicalReceiptSha256",
      digest(999),
    );
    expect(() =>
      computeGrandHallRegistrationSeedReplayResultSha256(forgedReplayResult),
    ).toThrow();

    const crossHost = structuredClone(artifact());
    Reflect.set(crossHost.repeatability, "determinismScope", "cross_host");
    expectRejectedAfterTopLevelReseal(crossHost);
  });

  it("rejects claims that the environment lock governed or fully verified execution", () => {
    for (const field of [
      "environmentLockAppliedToExecution",
      "loadedRuntimeClosureVerifiedAgainstLock",
    ] as const) {
      const forgedBinding = structuredClone(artifact());
      Reflect.set(forgedBinding.replayBindings, field, true);
      expectRejectedAfterTopLevelReseal(forgedBinding, [
        "replayBindings",
        field,
      ]);

      const forgedRun = structuredClone(artifact());
      Reflect.set(forgedRun.repeatability.runs[0], field, true);
      expectRejectedAfterTopLevelReseal(forgedRun, [
        "repeatability",
        "runs",
        0,
        field,
      ]);

      const validRun = artifact().repeatability.runs[0];
      const {
        replayOrdinal: validReplayOrdinal,
        replayResultSha256: validReplayResultSha256,
        ...forgedReplayResult
      } = validRun;
      void validReplayOrdinal;
      void validReplayResultSha256;
      Reflect.set(forgedReplayResult, field, true);
      expect(() =>
        computeGrandHallRegistrationSeedReplayResultSha256(forgedReplayResult),
      ).toThrow();
    }
  });

  it("rejects every authority, runtime, deployment, and publication escalation", () => {
    const mutations: Array<
      readonly [
        readonly (string | number)[],
        (value: GrandHallRegistrationSeedV1) => void,
      ]
    > = [
      [
        ["guardrails", "authority"],
        (value) => {
          Reflect.set(value.guardrails, "authority", "accepted");
        },
      ],
      [
        ["guardrails", "architecturalEvidence"],
        (value) => {
          Reflect.set(value.guardrails, "architecturalEvidence", true);
        },
      ],
      [
        ["guardrails", "humanReviewRequiredBeforeAnyPromotion"],
        (value) => {
          Reflect.set(
            value.guardrails,
            "humanReviewRequiredBeforeAnyPromotion",
            false,
          );
        },
      ],
      [
        ["guardrails", "productionTrust"],
        (value) => {
          Reflect.set(value.guardrails, "productionTrust", digest(900));
        },
      ],
      [
        ["guardrails", "roomMembershipAuthority"],
        (value) => {
          Reflect.set(value.guardrails, "roomMembershipAuthority", "accepted");
        },
      ],
      [
        ["guardrails", "sourceSelectionIsGrandHallMask"],
        (value) => {
          Reflect.set(value.guardrails, "sourceSelectionIsGrandHallMask", true);
        },
      ],
      [
        ["guardrails", "cleanupDecisionAccepted"],
        (value) => {
          Reflect.set(value.guardrails, "cleanupDecisionAccepted", true);
        },
      ],
      [
        ["guardrails", "matrixUsedAsMeasurement"],
        (value) => {
          Reflect.set(value.guardrails, "matrixUsedAsMeasurement", true);
        },
      ],
      [
        ["guardrails", "matrixUsedAsSolverInput"],
        (value) => {
          Reflect.set(value.guardrails, "matrixUsedAsSolverInput", true);
        },
      ],
      [
        ["guardrails", "coordinatePairs"],
        (value) => {
          Reflect.set(value.guardrails, "coordinatePairs", []);
        },
      ],
      [
        ["guardrails", "acceptedTransform"],
        (value) => {
          Reflect.set(value.guardrails, "acceptedTransform", {});
        },
      ],
      [
        ["guardrails", "outputMask"],
        (value) => {
          Reflect.set(value.guardrails, "outputMask", {});
        },
      ],
      [
        ["guardrails", "runtimeAdmission"],
        (value) => {
          Reflect.set(value.guardrails, "runtimeAdmission", {});
        },
      ],
      [
        ["guardrails", "deploymentAuthorization"],
        (value) => {
          Reflect.set(value.guardrails, "deploymentAuthorization", {});
        },
      ],
      [
        ["guardrails", "publicationAuthorization"],
        (value) => {
          Reflect.set(value.guardrails, "publicationAuthorization", {});
        },
      ],
      [
        ["guardrails", "permitsCoordinateAcceptance"],
        (value) => {
          Reflect.set(value.guardrails, "permitsCoordinateAcceptance", true);
        },
      ],
      [
        ["guardrails", "permitsTransformAcceptance"],
        (value) => {
          Reflect.set(value.guardrails, "permitsTransformAcceptance", true);
        },
      ],
      [
        ["guardrails", "permitsOutputMasking"],
        (value) => {
          Reflect.set(value.guardrails, "permitsOutputMasking", true);
        },
      ],
      [
        ["guardrails", "permitsRuntimeUse"],
        (value) => {
          Reflect.set(value.guardrails, "permitsRuntimeUse", true);
        },
      ],
      [
        ["guardrails", "permitsDeployment"],
        (value) => {
          Reflect.set(value.guardrails, "permitsDeployment", true);
        },
      ],
      [
        ["guardrails", "permitsPublication"],
        (value) => {
          Reflect.set(value.guardrails, "permitsPublication", true);
        },
      ],
      [
        [],
        (value) => {
          Reflect.set(value, "runtimePackage", digest(999));
        },
      ],
    ];
    for (const [expectedIssuePathPrefix, mutate] of mutations) {
      const value = structuredClone(artifact());
      mutate(value);
      expectRejectedAfterTopLevelReseal(value, expectedIssuePathPrefix);
    }
  }, 15_000);

  it("rejects a stale top-level self-digest", () => {
    const value = structuredClone(artifact());
    value.artifactSha256 = digest(999);
    expect(GrandHallRegistrationSeedV1Schema.safeParse(value).success).toBe(
      false,
    );
  });
});
