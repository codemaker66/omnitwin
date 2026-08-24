import {
  ReconstructionSceneAuthorityMapV0Schema,
  TransformArtifactV0Schema,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT,
  FOUNDRY_E57_GEOMETRY_INVOCATION_V0,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
  FOUNDRY_E57_GEOMETRY_OPERATION,
  FOUNDRY_E57_GEOMETRY_OPERATION_VERSION,
  FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
  computeFoundryE57GeometryInputCompatibilitySha256,
  runFoundryE57GeometryWorker,
  sealFoundryE57GeometryReaderDescriptionV0,
  type FoundryE57GeometryCropArtifactV0,
  type FoundryE57GeometryInvocationV0,
  type FoundryE57GeometryReader,
} from "../e57-geometry-worker.js";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_INPUT_V0,
  FoundryGeneratedPointCorrespondenceCollectionInputV0Schema,
  FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema,
  FoundryGeneratedPointCorrespondenceCollectionV0Schema,
  compileFoundryGeneratedPointCorrespondenceCollectionV0,
  computeFoundryGeneratedPointCorrespondenceCollectionSha256,
  verifyFoundryGeneratedPointCorrespondenceCollectionV0,
} from "../generated-point-correspondence-collection.js";
import {
  FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
  computeFoundryMetricRegistrationInputSha256,
  verifyFoundryMetricRegistrationProposalV0,
} from "../metric-registration-proposal.js";

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

type Point = readonly [number, number, number];

const SOURCE_POINTS: readonly Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 2, 0],
  [0, 0, 3],
  [1, 1, 1],
  [2, -1, 0.5],
];

function transform([x, y, z]: Point): Point {
  return [10 - 2 * y, -3 + 2 * x, 5 + 2 * z];
}

function invocation(
  id: string,
  sourceDigestCharacter: string,
  sourceFactsDigestCharacter: string,
  pointCount: number,
  maximumOutputPoints: number = pointCount,
): FoundryE57GeometryInvocationV0 {
  const source = {
    assetId: `generated-${id}`,
    relativePath: `generated/${id}.e57`,
    inputType: "generic_e57" as const,
    sizeBytes: 4_096,
    sha256: digest(sourceDigestCharacter),
  };
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-1_000, -1_000, -1_000] as [number, number, number],
    maximum: [1_000, 1_000, 1_000] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const limits = {
    maximumInputPoints: pointCount,
    maximumOutputPoints,
    maximumBatchPoints:
      FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS as typeof FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
    maximumScans: 1,
  };
  const coordinateContract = {
    inputPointFrame: "e57_data3d_local_cartesian" as const,
    scanPoseConvention:
      "normalized_quaternion_wxyz_then_translation_metres" as const,
    outputFrame: "e57_root" as const,
    units: "metre" as const,
    axes: "right_handed_z_up" as const,
  };
  const contentPolicy = {
    capturedMovableContent: "unclassified_possible_and_retained" as const,
    semanticMasking: "not_performed" as const,
    placementAuthority: "excluded" as const,
    measurementAuthority: "excluded" as const,
    collisionAuthority: "excluded" as const,
    exportAuthority: "excluded" as const,
  };
  const sourceFactsArtifactSha256 = digest(sourceFactsDigestCharacter);
  return {
    schemaVersion: FOUNDRY_E57_GEOMETRY_INVOCATION_V0,
    operation: FOUNDRY_E57_GEOMETRY_OPERATION,
    operationVersion: FOUNDRY_E57_GEOMETRY_OPERATION_VERSION,
    executionMode: "local_dependency_injected_authority_none",
    source,
    sourceFactsArtifactSha256,
    crop,
    limits,
    coordinateContract,
    contentPolicy,
    checkpointContract: {
      format: FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT,
      formatVersion: "v0",
      stageId: FOUNDRY_E57_GEOMETRY_OPERATION,
      workerImageSha256: digest("3"),
      recipeSha256: digest("4"),
      stageGraphSha256: digest("5"),
      ingestManifestSha256: digest("6"),
      checkpointCommandSha256: digest("7"),
      inputCompatibilitySha256:
        computeFoundryE57GeometryInputCompatibilitySha256({
          source,
          sourceFactsArtifactSha256,
          crop,
          limits,
          coordinateContract,
          contentPolicy,
        }),
    },
    networkAccess: "none",
    imageDecoderAccess: "none",
    imageExtraction: "none",
    modelInference: "none",
    modelTraining: "none",
    authority: "none",
  };
}

function reader(
  exactInvocation: FoundryE57GeometryInvocationV0,
  points: readonly Point[],
): FoundryE57GeometryReader {
  return generatedReader(exactInvocation, points.length, (index) => {
    const point = points[index];
    if (point === undefined) throw new Error("generated point is missing");
    return point;
  });
}

function generatedReader(
  exactInvocation: FoundryE57GeometryInvocationV0,
  pointCount: number,
  pointAt: (index: number) => Point,
): FoundryE57GeometryReader {
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactInvocation.source,
    adapter: {
      name: "generated_point_records",
      version: "1.0.0",
      bridgeArtifactSha256: digest("8"),
      pythonVersion: null,
      numpyVersion: null,
      identityAuthority: "caller_supplied_unverified",
    },
    readPolicy: {
      sourceAccess: "dependency_injected_caller_asserted_identity",
      batchAccess: "dependency_injected",
      pointPayload: "cartesian_fields_only",
      fullContainerBytesHashed: false,
      imageDecoderAccess: false,
      imageExtraction: false,
      network: "none",
      modelInference: "none",
      modelTraining: "none",
    },
    coordinateContract: {
      pointFrame: "e57_data3d_local_cartesian",
      poseConvention: "normalized_quaternion_wxyz_then_translation_metres",
      rootFrame: "e57_root",
      units: "metre",
      axes: "right_handed_z_up",
    },
    scans: [
      {
        scanIndex: 0,
        data3dGuid: `{generated-${exactInvocation.source.assetId}}`,
        pointCount,
        pointFields: [
          "cartesianInvalidState",
          "cartesianX",
          "cartesianY",
          "cartesianZ",
        ],
        pose: {
          rotationWxyz: [1, 0, 0, 0],
          translationM: [0, 0, 0],
        },
      },
    ],
    totalPointCount: pointCount,
    authority: "none",
  });
  return {
    describe: () => Promise.resolve(description),
    readBatch: ({ startPointIndex, maximumPoints }) =>
      Promise.resolve({
        sourceSha256: exactInvocation.source.sha256,
        scanIndex: 0,
        data3dGuid: description.scans[0]?.data3dGuid,
        startPointIndex,
        points: Array.from(
          {
            length: Math.min(maximumPoints, pointCount - startPointIndex),
          },
          (_unused, offset) => {
            const [x, y, z] = pointAt(startPointIndex + offset);
            return {
              x,
              y,
              z,
              cartesianInvalidState: 0,
            };
          },
        ),
      }),
  };
}

async function artifact(
  id: string,
  sourceDigestCharacter: string,
  sourceFactsDigestCharacter: string,
  points: readonly Point[],
): Promise<FoundryE57GeometryCropArtifactV0> {
  const exactInvocation = invocation(
    id,
    sourceDigestCharacter,
    sourceFactsDigestCharacter,
    points.length,
  );
  const result = await runFoundryE57GeometryWorker({
    invocation: exactInvocation,
    reader: reader(exactInvocation, points),
  });
  if (result.status !== "succeeded") throw new Error("generated crop failed");
  return result.artifact;
}

async function sparseLateIndexArtifact(
  id: string,
  sourceDigestCharacter: string,
  sourceFactsDigestCharacter: string,
  retainedPoints: readonly Point[],
): Promise<FoundryE57GeometryCropArtifactV0> {
  const firstRetainedIndex = 250_000;
  const pointCount = firstRetainedIndex + retainedPoints.length;
  const baseInvocation = invocation(
    id,
    sourceDigestCharacter,
    sourceFactsDigestCharacter,
    pointCount,
    retainedPoints.length,
  );
  const crop = {
    ...baseInvocation.crop,
    minimum: [-100, -100, -100] as [number, number, number],
    maximum: [100, 100, 100] as [number, number, number],
  };
  const limits = {
    ...baseInvocation.limits,
    maximumOutputPoints: retainedPoints.length,
  };
  const exactInvocation: FoundryE57GeometryInvocationV0 = {
    ...baseInvocation,
    crop,
    limits,
    checkpointContract: {
      ...baseInvocation.checkpointContract,
      inputCompatibilitySha256:
        computeFoundryE57GeometryInputCompatibilitySha256({
          source: baseInvocation.source,
          sourceFactsArtifactSha256: baseInvocation.sourceFactsArtifactSha256,
          crop,
          limits,
          coordinateContract: baseInvocation.coordinateContract,
          contentPolicy: baseInvocation.contentPolicy,
        }),
    },
  };
  const result = await runFoundryE57GeometryWorker({
    invocation: exactInvocation,
    reader: generatedReader(exactInvocation, pointCount, (index) => {
      if (index < firstRetainedIndex) return [999, 999, 999];
      const point = retainedPoints[index - firstRetainedIndex];
      if (point === undefined)
        throw new Error("late generated point is missing");
      return point;
    }),
  });
  if (result.status !== "succeeded") {
    throw new Error("late-index generated crop failed");
  }
  return result.artifact;
}

function selections() {
  return SOURCE_POINTS.map((_point, index) => ({
    correspondenceId: `control-${String(index).padStart(2, "0")}`,
    partition: index < 4 ? ("fit" as const) : ("held_out" as const),
    sourceSelector: { scanIndex: 0, sourcePointIndex: index },
    targetSelector: { scanIndex: 0, sourcePointIndex: index },
    lineageClassification:
      index === 5 ? ("independent" as const) : ("shared_lineage" as const),
  }));
}

async function exactInput() {
  return {
    schemaVersion: FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_INPUT_V0,
    collectionId: "generated-grand-hall-controls",
    proposalId: "generated-grand-hall-registration",
    sourceArtifact: await artifact("source", "a", "1", SOURCE_POINTS),
    targetArtifact: await artifact(
      "target",
      "b",
      "2",
      SOURCE_POINTS.map(transform),
    ),
    operator: {
      operatorReference: "operator:generated-fixture",
      rationale: "Generated landmark pairs for deterministic contract testing.",
      identityAuthority: "caller_supplied_unverified" as const,
    },
    selections: selections(),
    compileProposal: true,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

function inaccessibleOversizedArray(length: number): {
  readonly value: unknown[];
  readonly wasRead: () => boolean;
} {
  let read = false;
  const value: unknown[] = [];
  Object.defineProperty(value, "0", {
    configurable: true,
    enumerable: true,
    get: () => {
      read = true;
      throw new Error("an oversized array element was read");
    },
  });
  value.length = length;
  return { value, wasRead: () => read };
}

describe("generated E57 point correspondence collection", () => {
  it("resolves exact ordered retained points into the canonical metric input and optional proposal", async () => {
    const input = await exactInput();
    const first = compileFoundryGeneratedPointCorrespondenceCollectionV0(input);
    const second =
      compileFoundryGeneratedPointCorrespondenceCollectionV0(input);

    expect(second).toEqual(first);
    expect(first.resolvedCorrespondences).toHaveLength(SOURCE_POINTS.length);
    expect(
      first.resolvedCorrespondences.map(({ source }) => ({
        scanIndex: source.selector.scanIndex,
        sourcePointIndex: source.selector.sourcePointIndex,
        data3dGuid: source.data3dGuid,
        coordinatesM: source.coordinatesM,
      })),
    ).toEqual(
      input.sourceArtifact.points.map((point) => ({
        scanIndex: point.scanIndex,
        sourcePointIndex: point.sourcePointIndex,
        data3dGuid: point.data3dGuid,
        coordinatesM: [point.xM, point.yM, point.zM],
      })),
    );
    expect(
      first.registrationInput.correspondences.map(({ source }) => source),
    ).toEqual(
      first.resolvedCorrespondences.map(({ source }) => ({
        pointId: source.pointId,
        evidenceSha256: source.evidenceSha256,
        coordinates: source.coordinatesM,
      })),
    );
    expect(first.registrationInput.partitions).toEqual({
      declaration: "fixed_before_solve",
      fitCorrespondenceIds: [
        "control-00",
        "control-01",
        "control-02",
        "control-03",
      ],
      heldOutCorrespondenceIds: ["control-04", "control-05"],
    });
    expect(first.registrationProposal?.sourceOverlap.status).toBe(
      "not_computed",
    );
    expect(first.registrationProposal?.authority).toEqual({
      movableContent: "none",
      measurement: "none",
      export: "none",
      runtime: "none",
    });
    expect(
      verifyFoundryMetricRegistrationProposalV0(
        first.registrationProposal,
        first.registrationInput,
      ),
    ).toEqual(first.registrationProposal);
    expect(
      verifyFoundryGeneratedPointCorrespondenceCollectionV0(first, input),
    ).toEqual(first);
  });

  it("accepts exact retained points whose scan source indices exceed the output-point cap", async () => {
    const firstRetainedIndex = 250_000;
    const sourceArtifact = await sparseLateIndexArtifact(
      "late-source",
      "c",
      "3",
      SOURCE_POINTS,
    );
    const targetArtifact = await sparseLateIndexArtifact(
      "late-target",
      "d",
      "4",
      SOURCE_POINTS.map(transform),
    );
    const lateSelections = selections().map((selection, index) => ({
      ...selection,
      sourceSelector: {
        scanIndex: 0,
        sourcePointIndex: firstRetainedIndex + index,
      },
      targetSelector: {
        scanIndex: 0,
        sourcePointIndex: firstRetainedIndex + index,
      },
    }));
    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      schemaVersion: FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_INPUT_V0,
      collectionId: "late-source-index-controls",
      proposalId: "late-source-index-registration",
      sourceArtifact,
      targetArtifact,
      operator: {
        operatorReference: "operator:late-index-fixture",
        rationale: "Generated sparse late-index controls.",
        identityAuthority: "caller_supplied_unverified",
      },
      selections: lateSelections,
      compileProposal: true,
    });

    expect(
      result.resolvedCorrespondences.map(
        ({ source }) => source.selector.sourcePointIndex,
      ),
    ).toEqual(SOURCE_POINTS.map((_point, index) => firstRetainedIndex + index));
    expect(result.registrationProposal?.registrationInputSha256).toBe(
      result.registrationInputSha256,
    );
  });

  it("retains unverified operator rationale and grants no D-024 authority", async () => {
    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0(
      await exactInput(),
    );

    expect(result.operator).toEqual({
      operatorReference: "operator:generated-fixture",
      rationale: "Generated landmark pairs for deterministic contract testing.",
      identityAuthority: "caller_supplied_unverified",
    });
    expect(result.sourceOverlap).toBe("not_computed");
    expect(result.qa).toBe("not_performed");
    expect(result.reviewedTransformArtifact).toBe("not_created");
    expect(result.sceneAuthorityMap).toBe("not_created");
    expect(result.authority).toEqual({
      geometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none",
    });
    expect(result.releaseEligibility).toBe("blocked");
    expect(result.verificationBoundary).toEqual({
      standalonePointEvidence: "self_consistent_not_artifact_membership_proof",
      exactArtifactMembership: "requires_recompile_from_exact_inputs",
      operatorAuthentication: "not_provided",
    });
    expect(TransformArtifactV0Schema.safeParse(result).success).toBe(false);
    expect(
      ReconstructionSceneAuthorityMapV0Schema.safeParse(result).success,
    ).toBe(false);
  });

  it("can emit the exact input without pretending proposal compilation occurred", async () => {
    const input = await exactInput();
    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      ...input,
      compileProposal: false,
    });

    expect(result.proposalCompilation).toBe("not_requested");
    expect(result.registrationProposal).toBeNull();
    expect(result.registrationInput.correspondences).toHaveLength(6);
    expect(
      FoundryGeneratedPointCorrespondenceCollectionV0Schema.parse(result),
    ).toEqual(result);
  });

  it("rejects one physical source under changed asset/path metadata", async () => {
    const input = await exactInput();
    const sameSourceSha = await artifact(
      "renamed-target",
      "a",
      "9",
      SOURCE_POINTS.map(transform),
    );
    expect(sameSourceSha.source.assetId).not.toBe(
      input.sourceArtifact.source.assetId,
    );
    expect(sameSourceSha.source.relativePath).not.toBe(
      input.sourceArtifact.source.relativePath,
    );
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          targetArtifact: sameSourceSha,
        }),
      "GENERATED_POINT_CORRESPONDENCE_PHYSICAL_SOURCE_NOT_DISTINCT",
    );

    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          targetArtifact: input.sourceArtifact,
        }),
      "GENERATED_POINT_CORRESPONDENCE_ARTIFACT_NOT_DISTINCT",
    );
  });

  it("allows distinct source files from one exact bundle-level source-facts artifact", async () => {
    const input = await exactInput();
    const sameBundleFactsTarget = await artifact(
      "same-bundle-target",
      "c",
      "1",
      SOURCE_POINTS.map(transform),
    );
    const sameFactsInput = {
      ...input,
      targetArtifact: sameBundleFactsTarget,
    };
    const result =
      compileFoundryGeneratedPointCorrespondenceCollectionV0(sameFactsInput);

    expect(result.sourceCrop.sourceFactsArtifactSha256).toBe(
      result.targetCrop.sourceFactsArtifactSha256,
    );
    expect(result.sourceCrop.sourceAssetSha256).not.toBe(
      result.targetCrop.sourceAssetSha256,
    );
    expect(result.captureLineageIndependence).toBe(
      "caller_supplied_unverified",
    );
    expect(
      verifyFoundryGeneratedPointCorrespondenceCollectionV0(
        result,
        sameFactsInput,
      ),
    ).toEqual(result);
  });

  it("rejects duplicate IDs and any source or target point reused across pairs", async () => {
    const input = await exactInput();
    const duplicateId = structuredClone(input.selections);
    duplicateId[1]!.correspondenceId = duplicateId[0]!.correspondenceId;
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: duplicateId,
        }),
      "GENERATED_POINT_CORRESPONDENCE_ID_DUPLICATE",
    );

    const reusedSource = structuredClone(input.selections);
    reusedSource[1]!.sourceSelector = reusedSource[0]!.sourceSelector;
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: reusedSource,
        }),
      "GENERATED_POINT_CORRESPONDENCE_SOURCE_POINT_REUSED",
    );

    const reusedTarget = structuredClone(input.selections);
    reusedTarget[1]!.targetSelector = reusedTarget[0]!.targetSelector;
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: reusedTarget,
        }),
      "GENERATED_POINT_CORRESPONDENCE_TARGET_POINT_REUSED",
    );
    expect(
      FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse({
        ...input,
        selections: reusedTarget,
      }).success,
    ).toBe(false);
  });

  it("rejects missing retained points and degenerate partition counts before solving", async () => {
    const input = await exactInput();
    const missing = structuredClone(input.selections);
    missing[5]!.targetSelector.sourcePointIndex = 999;
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: missing,
        }),
      "GENERATED_POINT_CORRESPONDENCE_POINT_MISSING",
    );

    const noHeldOut = input.selections.map((selection) => ({
      ...selection,
      partition: "fit" as const,
    }));
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: noHeldOut,
        }),
      "GENERATED_POINT_CORRESPONDENCE_PARTITION_COUNTS_INVALID",
    );
  });

  it("exact verification rejects order, partition, selector, or operator substitution", async () => {
    const input = await exactInput();
    const result =
      compileFoundryGeneratedPointCorrespondenceCollectionV0(input);
    const reordered = structuredClone(input);
    reordered.selections.reverse();
    expectCode(
      () =>
        verifyFoundryGeneratedPointCorrespondenceCollectionV0(
          result,
          reordered,
        ),
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
    );

    const repartitioned = structuredClone(input);
    repartitioned.selections[3]!.partition = "held_out";
    repartitioned.selections[4]!.partition = "fit";
    expectCode(
      () =>
        verifyFoundryGeneratedPointCorrespondenceCollectionV0(
          result,
          repartitioned,
        ),
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
    );

    const substituted = structuredClone(input);
    substituted.selections[4]!.sourceSelector.sourcePointIndex = 5;
    substituted.selections[5]!.sourceSelector.sourcePointIndex = 4;
    expectCode(
      () =>
        verifyFoundryGeneratedPointCorrespondenceCollectionV0(
          result,
          substituted,
        ),
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
    );

    const changedOperator = structuredClone(input);
    changedOperator.operator.rationale = "A substituted rationale.";
    expectCode(
      () =>
        verifyFoundryGeneratedPointCorrespondenceCollectionV0(
          result,
          changedOperator,
        ),
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
    );
  });

  it("cannot be resealed after resolved evidence or partition tampering", async () => {
    const input = await exactInput();
    const result =
      compileFoundryGeneratedPointCorrespondenceCollectionV0(input);
    const { collectionSha256: _collectionSha256, ...payload } = result;
    const tampered = structuredClone(payload);
    tampered.resolvedCorrespondences[0]!.source.coordinatesM[0] += 0.25;

    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(tampered),
    ).toThrow(FoundryIntegrityError);
    expect(
      FoundryGeneratedPointCorrespondenceCollectionV0Schema.safeParse({
        ...tampered,
        collectionSha256: result.collectionSha256,
      }).success,
    ).toBe(false);

    const duplicateSelector = structuredClone(payload);
    duplicateSelector.resolvedCorrespondences[1]!.source.selector =
      structuredClone(
        duplicateSelector.resolvedCorrespondences[0]!.source.selector,
      );
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        duplicateSelector,
      ),
    ).toThrow(FoundryIntegrityError);

    const duplicateTargetSelector = structuredClone(payload);
    duplicateTargetSelector.resolvedCorrespondences[1]!.target.selector =
      structuredClone(
        duplicateTargetSelector.resolvedCorrespondences[0]!.target.selector,
      );
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        duplicateTargetSelector,
      ),
    ).toThrow(FoundryIntegrityError);

    const substitutedGuid = structuredClone(payload);
    substitutedGuid.resolvedCorrespondences[0]!.source.data3dGuid =
      "{substituted-guid}";
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        substitutedGuid,
      ),
    ).toThrow(FoundryIntegrityError);
    expect(() =>
      verifyFoundryGeneratedPointCorrespondenceCollectionV0(
        { ...substitutedGuid, collectionSha256: result.collectionSha256 },
        input,
      ),
    ).toThrow(FoundryIntegrityError);
  });

  it("standalone payload validation rejects resealed root or physical-source aliasing", async () => {
    const input = await exactInput();
    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      ...input,
      compileProposal: false,
    });
    const { collectionSha256: _collectionSha256, ...payload } = result;

    const equalRoot = structuredClone(payload);
    equalRoot.targetCrop = structuredClone(equalRoot.sourceCrop);
    equalRoot.registrationInput.target = structuredClone(
      equalRoot.sourceCrop.registrationRoot,
    );
    equalRoot.registrationInputSha256 =
      computeFoundryMetricRegistrationInputSha256(equalRoot.registrationInput);
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(equalRoot),
    ).toThrow(FoundryIntegrityError);

    const sourceShaAlias = structuredClone(payload);
    sourceShaAlias.targetCrop.sourceAssetSha256 =
      sourceShaAlias.sourceCrop.sourceAssetSha256;
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        sourceShaAlias,
      ),
    ).toThrow(FoundryIntegrityError);

    const brokenRootRelation = structuredClone(payload);
    brokenRootRelation.sourceCrop.registrationRoot.rootSha256 = digest("f");
    brokenRootRelation.registrationInput.source = structuredClone(
      brokenRootRelation.sourceCrop.registrationRoot,
    );
    brokenRootRelation.registrationInputSha256 =
      computeFoundryMetricRegistrationInputSha256(
        brokenRootRelation.registrationInput,
      );
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        brokenRootRelation,
      ),
    ).toThrow(FoundryIntegrityError);

    const brokenRootId = structuredClone(payload);
    brokenRootId.sourceCrop.registrationRoot.rootId = "substituted-root";
    brokenRootId.registrationInput.source = structuredClone(
      brokenRootId.sourceCrop.registrationRoot,
    );
    brokenRootId.registrationInputSha256 =
      computeFoundryMetricRegistrationInputSha256(
        brokenRootId.registrationInput,
      );
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(brokenRootId),
    ).toThrow(FoundryIntegrityError);

    const brokenFrameId = structuredClone(payload);
    brokenFrameId.sourceCrop.registrationRoot.frame.frameId =
      "substituted-frame";
    brokenFrameId.registrationInput.source = structuredClone(
      brokenFrameId.sourceCrop.registrationRoot,
    );
    brokenFrameId.registrationInputSha256 =
      computeFoundryMetricRegistrationInputSha256(
        brokenFrameId.registrationInput,
      );
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(brokenFrameId),
    ).toThrow(FoundryIntegrityError);
  });

  it("demonstrates that a standalone seal is not exact artifact membership or operator authentication", async () => {
    const input = await exactInput();
    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      ...input,
      compileProposal: false,
    });
    const { collectionSha256: _collectionSha256, ...payload } = result;
    const locallyResealedPayload = structuredClone(payload);
    locallyResealedPayload.sourceCrop.sourceAssetRelativePath =
      "forged-summary/source.e57";
    locallyResealedPayload.operator.rationale =
      "A different caller-supplied, unauthenticated rationale.";
    const locallyResealed = {
      ...locallyResealedPayload,
      collectionSha256:
        computeFoundryGeneratedPointCorrespondenceCollectionSha256(
          locallyResealedPayload,
        ),
    };

    expect(
      FoundryGeneratedPointCorrespondenceCollectionV0Schema.safeParse(
        locallyResealed,
      ).success,
    ).toBe(true);
    expectCode(
      () =>
        verifyFoundryGeneratedPointCorrespondenceCollectionV0(locallyResealed, {
          ...input,
          compileProposal: false,
        }),
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
    );
  });

  it("rejects nested accessors and revoked proxies without executing getters or leaking attacker errors", async () => {
    const input = await exactInput();
    let operatorGetterRead = false;
    const hostileOperatorInput = {
      ...input,
      operator: { ...input.operator },
    };
    Object.defineProperty(hostileOperatorInput.operator, "operatorReference", {
      enumerable: true,
      configurable: true,
      get: () => {
        operatorGetterRead = true;
        throw new Error("attacker operator getter escaped");
      },
    });
    let operatorSchemaSuccess: boolean | undefined;
    expect(() => {
      operatorSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse(
          hostileOperatorInput,
        ).success;
    }).not.toThrow();
    expect(operatorSchemaSuccess).toBe(false);
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0(
          hostileOperatorInput,
        ),
      "GENERATED_POINT_CORRESPONDENCE_LIMIT_EXCEEDED",
    );
    expect(operatorGetterRead).toBe(false);

    const hostileSelectorInput = {
      ...input,
      selections: structuredClone(input.selections),
    };
    const firstSelection = hostileSelectorInput.selections[0];
    if (firstSelection === undefined)
      throw new Error("missing selection fixture");
    let selectorGetterRead = false;
    Object.defineProperty(firstSelection, "sourceSelector", {
      enumerable: true,
      configurable: true,
      get: () => {
        selectorGetterRead = true;
        throw new Error("attacker selector getter escaped");
      },
    });
    let selectorSchemaSuccess: boolean | undefined;
    expect(() => {
      selectorSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse(
          hostileSelectorInput,
        ).success;
    }).not.toThrow();
    expect(selectorSchemaSuccess).toBe(false);
    expect(() =>
      compileFoundryGeneratedPointCorrespondenceCollectionV0(
        hostileSelectorInput,
      ),
    ).toThrow(FoundryIntegrityError);
    expect(selectorGetterRead).toBe(false);

    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      ...input,
      compileProposal: false,
    });
    const { collectionSha256: _collectionSha256, ...payload } = result;
    const hostilePayload = {
      ...payload,
      operator: { ...payload.operator },
    };
    let payloadGetterRead = false;
    Object.defineProperty(hostilePayload.operator, "rationale", {
      enumerable: true,
      configurable: true,
      get: () => {
        payloadGetterRead = true;
        throw new Error("attacker payload getter escaped");
      },
    });
    let payloadSchemaSuccess: boolean | undefined;
    expect(() => {
      payloadSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema.safeParse(
          hostilePayload,
        ).success;
    }).not.toThrow();
    expect(payloadSchemaSuccess).toBe(false);
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        hostilePayload,
      ),
    ).toThrow(FoundryIntegrityError);
    expect(payloadGetterRead).toBe(false);

    const hostileCollection = {
      ...result,
      operator: { ...result.operator },
    };
    let collectionGetterRead = false;
    Object.defineProperty(hostileCollection.operator, "rationale", {
      enumerable: true,
      configurable: true,
      get: () => {
        collectionGetterRead = true;
        throw new Error("attacker collection getter escaped");
      },
    });
    let collectionSchemaSuccess: boolean | undefined;
    expect(() => {
      collectionSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionV0Schema.safeParse(
          hostileCollection,
        ).success;
    }).not.toThrow();
    expect(collectionSchemaSuccess).toBe(false);
    expect(() =>
      verifyFoundryGeneratedPointCorrespondenceCollectionV0(
        hostileCollection,
        input,
      ),
    ).toThrow(FoundryIntegrityError);
    expect(collectionGetterRead).toBe(false);

    const revokedOperator = Proxy.revocable(input.operator, {});
    const nestedRevokedInput = { ...input, operator: revokedOperator.proxy };
    revokedOperator.revoke();
    let revokedInputSchemaSuccess: boolean | undefined;
    expect(() => {
      revokedInputSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse(
          nestedRevokedInput,
        ).success;
    }).not.toThrow();
    expect(revokedInputSchemaSuccess).toBe(false);
    expect(() =>
      compileFoundryGeneratedPointCorrespondenceCollectionV0(
        nestedRevokedInput,
      ),
    ).toThrow(FoundryIntegrityError);

    const revokedInput = Proxy.revocable(input, {});
    revokedInput.revoke();
    expect(() =>
      compileFoundryGeneratedPointCorrespondenceCollectionV0(
        revokedInput.proxy,
      ),
    ).toThrow(FoundryIntegrityError);

    const revokedPayloadOperator = Proxy.revocable(payload.operator, {});
    const nestedRevokedPayload = {
      ...payload,
      operator: revokedPayloadOperator.proxy,
    };
    revokedPayloadOperator.revoke();
    let revokedPayloadSchemaSuccess: boolean | undefined;
    expect(() => {
      revokedPayloadSchemaSuccess =
        FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema.safeParse(
          nestedRevokedPayload,
        ).success;
    }).not.toThrow();
    expect(revokedPayloadSchemaSuccess).toBe(false);
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        nestedRevokedPayload,
      ),
    ).toThrow(FoundryIntegrityError);

    const revokedPayload = Proxy.revocable(payload, {});
    revokedPayload.revoke();
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        revokedPayload.proxy,
      ),
    ).toThrow(FoundryIntegrityError);

    const revokedCollection = Proxy.revocable(result, {});
    revokedCollection.revoke();
    expect(() =>
      verifyFoundryGeneratedPointCorrespondenceCollectionV0(
        revokedCollection.proxy,
        input,
      ),
    ).toThrow(FoundryIntegrityError);
  });

  it("rejects JSON-parsed __proto__ members without inheriting them across data-only clones", async () => {
    const input = await exactInput();
    const serializedInput = JSON.stringify(input);
    const inputWithProto = JSON.parse(
      `{"__proto__":{"compileProposal":false},${serializedInput.slice(1)}`,
    ) as unknown;
    let inputDecisionSuccess: boolean | undefined;
    expect(() => {
      inputDecisionSuccess =
        FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse(
          inputWithProto,
        ).success;
    }).not.toThrow();
    expect(inputDecisionSuccess).toBe(false);
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0(inputWithProto),
      "GENERATED_POINT_CORRESPONDENCE_INPUT_INVALID",
    );

    const result = compileFoundryGeneratedPointCorrespondenceCollectionV0({
      ...input,
      compileProposal: false,
    });
    const { collectionSha256: _collectionSha256, ...payload } = result;
    const serializedPayload = JSON.stringify(payload);
    const payloadWithProto = JSON.parse(
      `{"__proto__":{"releaseEligibility":"allowed"},${serializedPayload.slice(1)}`,
    ) as unknown;
    let payloadDecisionSuccess: boolean | undefined;
    expect(() => {
      payloadDecisionSuccess =
        FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema.safeParse(
          payloadWithProto,
        ).success;
    }).not.toThrow();
    expect(payloadDecisionSuccess).toBe(false);
    expect(() =>
      computeFoundryGeneratedPointCorrespondenceCollectionSha256(
        payloadWithProto,
      ),
    ).toThrow(FoundryIntegrityError);
  });

  it("preflights hostile oversized selection and crop arrays without reading an element", async () => {
    const input = await exactInput();
    const selectionsArray = inaccessibleOversizedArray(
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1,
    );
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          selections: selectionsArray.value,
        }),
      "GENERATED_POINT_CORRESPONDENCE_LIMIT_EXCEEDED",
    );
    expect(selectionsArray.wasRead()).toBe(false);
    expect(
      FoundryGeneratedPointCorrespondenceCollectionInputV0Schema.safeParse({
        ...input,
        selections: selectionsArray.value,
      }).success,
    ).toBe(false);
    expect(selectionsArray.wasRead()).toBe(false);

    const pointsArray = inaccessibleOversizedArray(250_001);
    expectCode(
      () =>
        compileFoundryGeneratedPointCorrespondenceCollectionV0({
          ...input,
          sourceArtifact: {
            ...input.sourceArtifact,
            points: pointsArray.value,
          },
        }),
      "GENERATED_POINT_CORRESPONDENCE_LIMIT_EXCEEDED",
    );
    expect(pointsArray.wasRead()).toBe(false);
  });
});
