import {
  ReconstructionSceneAuthorityMapV0Schema,
  TransformArtifactV0Schema,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
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
import {
  FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
  compileFoundryE57PointClassificationMaskV0,
  deriveFoundryE57PointClassificationSelectorsV0,
  type FoundryE57PointClassification,
  type FoundryE57PointClassificationMaskV0,
} from "../e57-point-classification-mask.js";
import {
  FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
  FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
  compileFoundryMetricRegistrationProposalV0,
  type FoundryMetricRegistrationProposalV0,
} from "../metric-registration-proposal.js";
import {
  FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0,
  FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS,
  FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES,
  FoundryBoundedPointSourceFusionInputV0Schema,
  FoundryBoundedPointSourceFusionPayloadV0Schema,
  FoundryBoundedPointSourceFusionV0Schema,
  compileFoundryBoundedPointSourceFusionV0,
  computeFoundryBoundedPointSourceFusionSha256,
  deriveFoundryE57CropMetricRegistrationPointsV0,
  deriveFoundryE57CropMetricRegistrationSourceV0,
  verifyFoundryBoundedPointSourceFusionV0,
  type FoundryBoundedPointSourceFusionInputV0,
  type FoundryMetricTargetBindingV0,
} from "../bounded-point-source-fusion.js";

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

const TARGET: FoundryMetricTargetBindingV0 = {
  rootId: "generated-metric-target",
  rootSha256: digest("c"),
  frame: {
    frameId: "candidate-canonical-metric-frame",
    frameSha256: digest("d"),
    units: "meters",
    handedness: "right",
    upAxis: "z",
    axisConvention: "right-handed xyz with z up",
  },
};

type Point = readonly [number, number, number];

const BASE_POINTS: readonly Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 2, 0],
  [0, 0, 3],
  [1, 1, 1],
  [2, -1, 0.5],
  [4, 4, 4],
  [5, 5, 5],
];

function invocation(
  id: string,
  sourceDigestCharacter: string,
  pointCount: number,
): FoundryE57GeometryInvocationV0 {
  const source = {
    assetId: `capture-${id}`,
    relativePath: `generated/${id}.e57`,
    inputType: "generic_e57" as const,
    sizeBytes: 4_096,
    sha256: digest(sourceDigestCharacter),
  };
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-1_000_000_000, -1_000_000_000, -1_000_000_000] as [
      number,
      number,
      number,
    ],
    maximum: [1_000_000_000, 1_000_000_000, 1_000_000_000] as [
      number,
      number,
      number,
    ],
    boundary: "inclusive" as const,
  };
  const limits = {
    maximumInputPoints: pointCount,
    maximumOutputPoints: pointCount,
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
  const sourceFactsArtifactSha256 = digest("e");
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
      workerImageSha256: digest("1"),
      recipeSha256: digest("2"),
      stageGraphSha256: digest("3"),
      ingestManifestSha256: digest("4"),
      checkpointCommandSha256: digest("5"),
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
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactInvocation.source,
    adapter: {
      name: "generated_point_records",
      version: "1.0.0",
      bridgeArtifactSha256: digest("6"),
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
        pointCount: points.length,
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
    totalPointCount: points.length,
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
        points: points
          .slice(startPointIndex, startPointIndex + maximumPoints)
          .map(([x, y, z]) => ({
            x,
            y,
            z,
            cartesianInvalidState: 0,
          })),
      }),
  };
}

async function artifact(
  id: string,
  sourceDigestCharacter: string,
  points: readonly Point[] = BASE_POINTS,
): Promise<FoundryE57GeometryCropArtifactV0> {
  const exactInvocation = invocation(id, sourceDigestCharacter, points.length);
  const result = await runFoundryE57GeometryWorker({
    invocation: exactInvocation,
    reader: reader(exactInvocation, points),
  });
  if (result.status !== "succeeded") throw new Error("generated crop failed");
  return result.artifact;
}

function transformed(
  point: Point,
  variant: "a" | "b",
): [number, number, number] {
  return variant === "a"
    ? [10 - 2 * point[1], -3 + 2 * point[0], 5 + 2 * point[2]]
    : [100 + point[0], 20 + point[1], -5 + point[2]];
}

function registration(
  exactArtifact: FoundryE57GeometryCropArtifactV0,
  variant: "a" | "b",
  sourcePointsOverride?: readonly Point[],
  target: FoundryMetricTargetBindingV0 = TARGET,
): FoundryMetricRegistrationProposalV0 {
  const selectors = exactArtifact.points.slice(0, 6).map((point) => ({
    scanIndex: point.scanIndex,
    sourcePointIndex: point.sourcePointIndex,
  }));
  const pointBindings = deriveFoundryE57CropMetricRegistrationPointsV0(
    exactArtifact,
    selectors,
  );
  const sourcePoints =
    sourcePointsOverride ?? pointBindings.map((point) => point.coordinates);
  return compileFoundryMetricRegistrationProposalV0({
    schemaVersion: FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
    proposalId: `registration-${variant}-${exactArtifact.artifactSha256.slice(7, 31)}`,
    source: deriveFoundryE57CropMetricRegistrationSourceV0(exactArtifact),
    target,
    correspondences: pointBindings.map((point, index) => {
      const sourceCoordinates = sourcePoints[index];
      if (sourceCoordinates === undefined) {
        throw new Error("generated correspondence is missing");
      }
      return {
        correspondenceId: `control-${String(index).padStart(2, "0")}`,
        source: {
          ...point,
          coordinates: sourceCoordinates,
        },
        target: {
          pointId: `target-${variant}-${String(index).padStart(2, "0")}`,
          evidenceSha256: digest("789abc"[index] ?? "f"),
          coordinates: transformed(sourceCoordinates, variant),
        },
        lineageClassification:
          index === 5 ? ("independent" as const) : ("shared_lineage" as const),
      };
    }),
    partitions: {
      declaration: "fixed_before_solve",
      fitCorrespondenceIds: [
        "control-00",
        "control-01",
        "control-02",
        "control-03",
        "control-04",
      ],
      heldOutCorrespondenceIds: ["control-05"],
    },
  });
}

async function fusionInput(): Promise<FoundryBoundedPointSourceFusionInputV0> {
  const first = await artifact("alpha", "a");
  const second = await artifact("beta", "b");
  return {
    schemaVersion: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0,
    target: TARGET,
    sources: [
      { artifact: first, registrationProposal: registration(first, "a") },
      { artifact: second, registrationProposal: registration(second, "b") },
    ],
  };
}

function classificationMask(
  exactArtifact: FoundryE57GeometryCropArtifactV0,
  rules: readonly {
    readonly ruleId: string;
    readonly classification: FoundryE57PointClassification;
    readonly pointOrders: readonly number[];
  }[],
): FoundryE57PointClassificationMaskV0 {
  return compileFoundryE57PointClassificationMaskV0({
    schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
    artifact: exactArtifact,
    authorship: {
      operatorId: "generated-test-operator",
      operatorDisplayName: "Generated Test Operator",
      authoredAt: "2026-08-09T12:00:00.000Z",
      purposeNote:
        "Generated-only exact point classification for authority-none fusion tests.",
      identityAuthority: "caller_supplied_unverified",
    },
    defaultClassification: "unclassified_static_candidate",
    rules: rules.map((rule) => ({
      ruleId: rule.ruleId,
      classification: rule.classification,
      rationale:
        "Generated-only operator-authored rule with no architectural authority.",
      selection: {
        kind: "exact_point_selectors",
        points: deriveFoundryE57PointClassificationSelectorsV0(
          exactArtifact,
          rule.pointOrders.map((pointOrder) => {
            const point = exactArtifact.points[pointOrder];
            if (point === undefined) {
              throw new Error("generated classification point is missing");
            }
            return {
              scanIndex: point.scanIndex,
              sourcePointIndex: point.sourcePointIndex,
            };
          }),
        ),
      },
    })),
  });
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

describe("bounded authority-none point-source fusion", () => {
  it("applies exact registrations into one metric target with stable point/source lineage", async () => {
    const input = await fusionInput();
    const result = compileFoundryBoundedPointSourceFusionV0(input);

    expect(result.pointCounts).toEqual({
      sources: 2,
      sourceCropPoints: 16,
      capturedMovableVisualExcluded: 0,
      privacyExcluded: 0,
      fused: 16,
    });
    expect(result.target).toEqual(TARGET);
    expect(result.sources.map((source) => source.artifactSha256)).toEqual(
      [...input.sources]
        .map(({ artifact: sourceArtifact }) => sourceArtifact.artifactSha256)
        .sort(),
    );
    expect(result.points).toHaveLength(16);
    expect(result.points[0]).toMatchObject({
      sourceOrder: 0,
      sourcePointOrder: 0,
      classificationMaskPointId: null,
      contentClassification: "unclassified_static_candidate",
      authority: "none",
    });
    for (const point of result.points) {
      const source = result.sources[point.sourceOrder];
      expect(source?.sourceId).toBe(point.sourceId);
      expect(point.targetCoordinatesM.every(Number.isFinite)).toBe(true);
    }
    expect(result.fusionMethod).toBe(
      "transformed_stable_point_union_without_deduplication",
    );
    expect(result.sourceOverlap).toEqual({
      status: "not_computed",
      deduplication: "not_performed",
    });
    expect(verifyFoundryBoundedPointSourceFusionV0(result, input)).toEqual(
      result,
    );
  });

  it("is byte-deterministic and independent of caller source order", async () => {
    const input = await fusionInput();
    const first = compileFoundryBoundedPointSourceFusionV0(input);
    const reordered = compileFoundryBoundedPointSourceFusionV0({
      ...input,
      sources: [...input.sources].reverse(),
    });

    expect(reordered).toEqual(first);
    expect(reordered.fusionSha256).toBe(first.fusionSha256);
  });

  it("consumes exact self-verifying masks, omits movable/privacy points, and retains only authority-none static candidates", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const firstMask = classificationMask(first.artifact, [
      {
        ruleId: "captured-movable-exclusion",
        classification: "captured_movable_visual_excluded",
        pointOrders: [6],
      },
      {
        ruleId: "privacy-exclusion",
        classification: "privacy_excluded",
        pointOrders: [7],
      },
    ]);
    const secondMask = classificationMask(second.artifact, [
      {
        ruleId: "explicit-static-candidate",
        classification: "unclassified_static_candidate",
        pointOrders: [7],
      },
    ]);
    const exactInput: FoundryBoundedPointSourceFusionInputV0 = {
      ...input,
      sources: [
        { ...first, pointClassificationMask: firstMask },
        { ...second, pointClassificationMask: secondMask },
      ],
    };

    const result = compileFoundryBoundedPointSourceFusionV0(exactInput);

    expect(result.pointCounts).toEqual({
      sources: 2,
      sourceCropPoints: 16,
      capturedMovableVisualExcluded: 1,
      privacyExcluded: 1,
      fused: 14,
    });
    expect(result.masking).toMatchObject({
      coverage: "all_sources",
      classificationAuthority: "caller_supplied_unverified",
      unmaskedSourceContent: "none",
      authority: "none",
    });
    expect(
      new Set(result.masking.sourceOrderedExactPointMaskArtifactSha256s),
    ).toEqual(new Set([firstMask.maskSha256, secondMask.maskSha256]));
    expect(result.releaseBlockers).not.toContain(
      "EXACT_POINT_MASK_ARTIFACT_REQUIRED",
    );
    expect(result.releaseBlockers).toContain(
      "AUTHORED_POINT_CLASSIFICATION_REVIEW_REQUIRED",
    );
    expect(result.releaseBlockers).toContain(
      "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
    );
    expect(result.releaseBlockers).toContain("PRIVACY_REVIEW_REQUIRED");
    expect(
      result.points.every(
        (point) =>
          point.classificationMaskPointId !== null &&
          point.contentClassification === "unclassified_static_candidate" &&
          point.authority === "none",
      ),
    ).toBe(true);
    const firstLineage = result.sources.find(
      (source) => source.artifactSha256 === first.artifact.artifactSha256,
    );
    if (firstLineage === undefined) throw new Error("missing first lineage");
    expect(firstLineage).toMatchObject({
      artifactPointCount: 8,
      fusedPointCount: 6,
      excludedPointCounts: {
        capturedMovableVisual: 1,
        privacy: 1,
      },
      masking: {
        status: "exact_operator_draft_applied",
        exactPointMaskArtifactSha256: firstMask.maskSha256,
        classificationAuthority: "caller_supplied_unverified",
        reviewStatus: "not_reviewed",
        authority: "none",
      },
    });
    const firstOutputPoints = result.points.filter(
      (point) => point.sourceOrder === firstLineage.sourceOrder,
    );
    expect(firstOutputPoints.map((point) => point.sourcePointOrder)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(verifyFoundryBoundedPointSourceFusionV0(result, exactInput)).toEqual(
      result,
    );
  });

  it("rejects a mask bound to another exact crop artifact", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const wrongMask = classificationMask(second.artifact, [
      {
        ruleId: "wrong-crop-static",
        classification: "unclassified_static_candidate",
        pointOrders: [7],
      },
    ]);

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { ...first, pointClassificationMask: wrongMask },
            second,
          ],
        }),
      "POINT_SOURCE_FUSION_MASK_BINDING_MISMATCH",
    );
  });

  it("rejects an excluded registration control point", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    if (first === undefined) throw new Error("missing fixture source");
    const mask = classificationMask(first.artifact, [
      {
        ruleId: "invalid-control-exclusion",
        classification: "captured_movable_visual_excluded",
        pointOrders: [0],
      },
    ]);

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { ...first, pointClassificationMask: mask },
            input.sources[1],
          ],
        }),
      "POINT_SOURCE_FUSION_EXCLUDED_CONTROL_POINT",
    );
  });

  it("fails explicitly when a mask excludes every point from one source", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    if (first === undefined) throw new Error("missing fixture source");
    const mask = classificationMask(first.artifact, [
      {
        ruleId: "exclude-entire-generated-crop",
        classification: "privacy_excluded",
        pointOrders: first.artifact.points.map((_point, index) => index),
      },
    ]);

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { ...first, pointClassificationMask: mask },
            input.sources[1],
          ],
        }),
      "POINT_SOURCE_FUSION_EMPTY_AFTER_EXCLUSIONS",
    );
  });

  it("preserves the broader exact E57 source ID instead of narrowing it to a runtime key", async () => {
    const first = await artifact("Mixed:Case", "0");
    const second = await artifact("plain", "1");
    const result = compileFoundryBoundedPointSourceFusionV0({
      schemaVersion: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0,
      target: TARGET,
      sources: [
        { artifact: first, registrationProposal: registration(first, "a") },
        { artifact: second, registrationProposal: registration(second, "b") },
      ],
    });

    expect(result.sources.map((source) => source.sourceAssetId)).toContain(
      "capture-Mixed:Case",
    );
  });

  it("rejects an exact-artifact substitution under another proposal", async () => {
    const input = await fusionInput();
    const substitute = await artifact("substitute", "f");
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            {
              artifact: substitute,
              registrationProposal: input.sources[0]?.registrationProposal,
            },
            input.sources[1],
          ],
        }),
      "POINT_SOURCE_FUSION_SOURCE_BINDING_MISMATCH",
    );
  });

  it("rejects a target-root or target-frame substitution", async () => {
    const input = await fusionInput();
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          target: { ...TARGET, rootSha256: digest("e") },
        }),
      "POINT_SOURCE_FUSION_TARGET_BINDING_MISMATCH",
    );
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          target: {
            ...TARGET,
            frame: {
              ...TARGET.frame,
              frameSha256: digest("e"),
            },
          },
        }),
      "POINT_SOURCE_FUSION_TARGET_BINDING_MISMATCH",
    );
  });

  it("rejects a non-finite transform before any point transformation", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const invalidProposal = structuredClone(first.registrationProposal);
    invalidProposal.solve.matrixColumnMajor[0] = Number.NaN;

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { artifact: first.artifact, registrationProposal: invalidProposal },
            second,
          ],
        }),
      "POINT_SOURCE_FUSION_INPUT_INVALID",
    );
  });

  it("requires every source control to bind an exact crop point ID, digest, and coordinate", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    if (first === undefined) throw new Error("missing fixture source");
    const shiftedControls = BASE_POINTS.map(
      ([x, y, z]) => [x + 0.25, y, z] as Point,
    );
    const unboundProposal = registration(first.artifact, "a", shiftedControls);

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { artifact: first.artifact, registrationProposal: unboundProposal },
            input.sources[1],
          ],
        }),
      "POINT_SOURCE_FUSION_CONTROL_POINT_BINDING_MISMATCH",
    );
  });

  it("rejects duplicate crop artifacts instead of double-counting them", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    if (first === undefined) throw new Error("missing fixture source");
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [first, first],
        }),
      "POINT_SOURCE_FUSION_DUPLICATE_ARTIFACT",
    );
  });

  it("preflights aggregate point count before deep parsing", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const repeatedPoint = first.artifact.points[0];
    if (repeatedPoint === undefined) throw new Error("missing fixture point");
    const oversizedLength =
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS / 2 + 1;
    const oversized = Array.from(
      { length: oversizedLength },
      () => repeatedPoint,
    );

    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            { ...first, artifact: { ...first.artifact, points: oversized } },
            { ...second, artifact: { ...second.artifact, points: oversized } },
          ],
        }),
      "POINT_SOURCE_FUSION_LIMIT_EXCEEDED",
    );
  });

  it("preflights aggregate nested mask point and selector budgets before element access", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const firstMask = classificationMask(first.artifact, [
      {
        ruleId: "first-static-mask",
        classification: "unclassified_static_candidate",
        pointOrders: [7],
      },
    ]);
    const secondMask = classificationMask(second.artifact, [
      {
        ruleId: "second-static-mask",
        classification: "unclassified_static_candidate",
        pointOrders: [7],
      },
    ]);
    const overHalf =
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS / 2 + 1;
    const firstMaskPoints = inaccessibleOversizedArray(overHalf);
    const secondMaskPoints = inaccessibleOversizedArray(overHalf);
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            {
              ...first,
              pointClassificationMask: {
                ...firstMask,
                points: firstMaskPoints.value,
              },
            },
            {
              ...second,
              pointClassificationMask: {
                ...secondMask,
                points: secondMaskPoints.value,
              },
            },
          ],
        }),
      "POINT_SOURCE_FUSION_LIMIT_EXCEEDED",
    );
    expect(firstMaskPoints.wasRead()).toBe(false);
    expect(secondMaskPoints.wasRead()).toBe(false);

    const firstSelectors = inaccessibleOversizedArray(overHalf);
    const secondSelectors = inaccessibleOversizedArray(overHalf);
    const firstRule = firstMask.classificationRules[0];
    const secondRule = secondMask.classificationRules[0];
    if (
      firstRule === undefined ||
      firstRule.selection.kind !== "exact_point_selectors" ||
      secondRule === undefined ||
      secondRule.selection.kind !== "exact_point_selectors"
    ) {
      throw new Error("missing exact-selector fixture rules");
    }
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            {
              ...first,
              pointClassificationMask: {
                ...firstMask,
                classificationRules: [
                  {
                    ...firstRule,
                    selection: {
                      ...firstRule.selection,
                      points: firstSelectors.value,
                    },
                  },
                ],
              },
            },
            {
              ...second,
              pointClassificationMask: {
                ...secondMask,
                classificationRules: [
                  {
                    ...secondRule,
                    selection: {
                      ...secondRule.selection,
                      points: secondSelectors.value,
                    },
                  },
                ],
              },
            },
          ],
        }),
      "POINT_SOURCE_FUSION_LIMIT_EXCEEDED",
    );
    expect(firstSelectors.wasRead()).toBe(false);
    expect(secondSelectors.wasRead()).toBe(false);
  });

  it("rejects oversized exported-schema arrays before reading an element", async () => {
    const input = await fusionInput();
    const result = compileFoundryBoundedPointSourceFusionV0(input);
    const outerSources = inaccessibleOversizedArray(
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES + 1,
    );
    const inputDecision =
      FoundryBoundedPointSourceFusionInputV0Schema.safeParse({
        ...input,
        sources: outerSources.value,
      });
    expect(inputDecision.success).toBe(false);
    expect(outerSources.wasRead()).toBe(false);
    if (!inputDecision.success) {
      expect(inputDecision.error.issues.length).toBeLessThan(10);
    }

    const oversizedPoints = inaccessibleOversizedArray(
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS + 1,
    );
    const { fusionSha256: _fusionSha256, ...payload } = result;
    const payloadDecision =
      FoundryBoundedPointSourceFusionPayloadV0Schema.safeParse({
        ...payload,
        points: oversizedPoints.value,
      });
    const resultDecision = FoundryBoundedPointSourceFusionV0Schema.safeParse({
      ...result,
      points: oversizedPoints.value,
    });
    expect(payloadDecision.success).toBe(false);
    expect(resultDecision.success).toBe(false);
    expect(oversizedPoints.wasRead()).toBe(false);
    if (!payloadDecision.success) {
      expect(payloadDecision.error.issues.length).toBeLessThan(10);
    }
    if (!resultDecision.success) {
      expect(resultDecision.error.issues.length).toBeLessThan(10);
    }

    const firstPoint = result.points[0];
    if (firstPoint === undefined) throw new Error("missing fused point");
    const exactCapInvalidPoints = Array.from(
      { length: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS },
      () => ({
        ...firstPoint,
        sourceOrder: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES,
      }),
    );
    const exactCapDecision =
      FoundryBoundedPointSourceFusionPayloadV0Schema.safeParse({
        ...payload,
        points: exactCapInvalidPoints,
      });
    expect(exactCapDecision.success).toBe(false);
    if (!exactCapDecision.success) {
      expect(exactCapDecision.error.issues.length).toBeLessThan(10);
    }
  });

  it("preflights oversized nested proposal and output matrix arrays", async () => {
    const input = await fusionInput();
    const first = input.sources[0];
    const second = input.sources[1];
    if (first === undefined || second === undefined) {
      throw new Error("missing fixture sources");
    }
    const correspondenceOrder = inaccessibleOversizedArray(
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1,
    );
    expectCode(
      () =>
        compileFoundryBoundedPointSourceFusionV0({
          ...input,
          sources: [
            {
              artifact: first.artifact,
              registrationProposal: {
                ...first.registrationProposal,
                correspondenceOrder: correspondenceOrder.value,
              },
            },
            second,
          ],
        }),
      "POINT_SOURCE_FUSION_LIMIT_EXCEEDED",
    );
    expect(correspondenceOrder.wasRead()).toBe(false);

    const result = compileFoundryBoundedPointSourceFusionV0(input);
    const matrix = inaccessibleOversizedArray(17);
    const firstLineage = result.sources[0];
    if (firstLineage === undefined) throw new Error("missing fused source");
    const resultDecision = FoundryBoundedPointSourceFusionV0Schema.safeParse({
      ...result,
      sources: [
        {
          ...firstLineage,
          registration: {
            ...firstLineage.registration,
            matrixColumnMajor: matrix.value,
          },
        },
        ...result.sources.slice(1),
      ],
    });
    expect(resultDecision.success).toBe(false);
    expect(matrix.wasRead()).toBe(false);
    if (!resultDecision.success) {
      expect(resultDecision.error.issues.length).toBeLessThan(10);
    }
  });

  it("fails closed when a non-control point transforms beyond the bounded metric envelope", async () => {
    const distantPoints = [...BASE_POINTS, [600_000_000, 0, 0] as Point];
    const first = await artifact("distant", "9", distantPoints);
    const second = await artifact("near", "8");
    const input: FoundryBoundedPointSourceFusionInputV0 = {
      schemaVersion: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0,
      target: TARGET,
      sources: [
        { artifact: first, registrationProposal: registration(first, "a") },
        { artifact: second, registrationProposal: registration(second, "b") },
      ],
    };

    expectCode(
      () => compileFoundryBoundedPointSourceFusionV0(input),
      "POINT_SOURCE_FUSION_COORDINATE_OUT_OF_RANGE",
    );
  });

  it("cannot be resealed after transformed-point tampering", async () => {
    const input = await fusionInput();
    const result = compileFoundryBoundedPointSourceFusionV0(input);
    const { fusionSha256: _fusionSha256, ...payload } = result;
    const firstPoint = payload.points[0];
    if (firstPoint === undefined) throw new Error("missing fixture point");
    const changedPayload = {
      ...payload,
      points: [
        {
          ...firstPoint,
          targetCoordinatesM: [
            firstPoint.targetCoordinatesM[0] + 1,
            firstPoint.targetCoordinatesM[1],
            firstPoint.targetCoordinatesM[2],
          ],
        },
        ...payload.points.slice(1),
      ],
    };
    expect(() =>
      computeFoundryBoundedPointSourceFusionSha256(changedPayload),
    ).toThrow();
    expect(
      FoundryBoundedPointSourceFusionV0Schema.safeParse({
        ...changedPayload,
        fusionSha256: result.fusionSha256,
      }).success,
    ).toBe(false);
  });

  it("emits explicit masking/review/package blockers and grants no D-024 authority", async () => {
    const result = compileFoundryBoundedPointSourceFusionV0(
      await fusionInput(),
    );

    expect(result.masking).toEqual({
      coverage: "none",
      visualReviewDraftUse: "not_accepted_as_exact_point_mask",
      sourceOrderedExactPointMaskArtifactSha256s: [],
      classificationAuthority: "none",
      retainedPointClassification:
        "unclassified_static_candidate_non_authoritative",
      excludedPointDisposition: "omitted_from_fusion",
      unmaskedSourceContent:
        "possible_movable_or_privacy_content_retained",
      authority: "none",
    });
    expect(result.releaseEligibility).toBe("blocked");
    expect(result.releaseBlockers).toContain(
      "EXACT_POINT_MASK_ARTIFACT_REQUIRED",
    );
    expect(result.releaseBlockers).toContain(
      "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
    );
    expect(result.releaseBlockers).toContain("PRIVACY_REVIEW_REQUIRED");
    expect(result.releaseBlockers).toContain(
      "REVIEWED_TRANSFORM_ARTIFACT_REQUIRED",
    );
    expect(result.packageCompatibility).toEqual({
      roomRealityPackageAssembly: "not_created",
      representationEligibility: "blocked",
      exactMemberIdentities: "not_verified",
      movableObjectClassification: "not_verified",
    });
    expect(result.authority).toEqual({
      geometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none",
    });
    expect(result.capabilities).toEqual({
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
      exportAuthority: "not_authorized",
      runtimePackageRegistration: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      transformArtifactCreation: "not_authorized",
      qaApproval: "not_authorized",
    });
    expect(result.execution).toEqual({
      mode: "pure_deterministic_in_memory_compile",
      interruptionResume: "not_implemented",
      checkpointBoundary: "none_authenticated_for_fusion",
      recovery: "rerun_from_exact_inputs",
    });
    expect(result.verificationBoundary).toEqual({
      standaloneSchema: "payload_self_consistency_only",
      exactArtifactAndProposalBinding: "requires_recompile_from_exact_inputs",
      digestAuthentication: "not_provided",
    });
    expect(TransformArtifactV0Schema.safeParse(result).success).toBe(false);
    expect(
      ReconstructionSceneAuthorityMapV0Schema.safeParse(result).success,
    ).toBe(false);
  });

  it("verifier rejects a valid result compiled from different exact inputs", async () => {
    const input = await fusionInput();
    const result = compileFoundryBoundedPointSourceFusionV0(input);
    const alternativeArtifact = await artifact("alternative", "7");
    const retainedSource = input.sources[1];
    if (retainedSource === undefined) throw new Error("missing fixture source");
    const alternativeInput: FoundryBoundedPointSourceFusionInputV0 = {
      ...input,
      sources: [
        {
          artifact: alternativeArtifact,
          registrationProposal: registration(alternativeArtifact, "a"),
        },
        retainedSource,
      ],
    };

    expectCode(
      () => verifyFoundryBoundedPointSourceFusionV0(result, alternativeInput),
      "POINT_SOURCE_FUSION_RECOMPUTATION_MISMATCH",
    );
  });
});
