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
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES,
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS,
  FoundryE57PointClassificationMaskInputV0Schema,
  FoundryE57PointClassificationMaskPayloadV0Schema,
  FoundryE57PointClassificationMaskV0Schema,
  compileFoundryE57PointClassificationMaskV0,
  computeFoundryE57PointClassificationMaskSha256,
  deriveFoundryE57PointClassificationSelectorsV0,
  verifyFoundryE57PointClassificationMaskV0,
  type FoundryE57PointClassificationMaskInputV0,
} from "../e57-point-classification-mask.js";

type Point = readonly [number, number, number];

const POINTS: readonly Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
  [0, 2, 0],
  [0, 3, 0],
  [10, 10, 10],
  [20, 20, 20],
];

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

function invocation(): FoundryE57GeometryInvocationV0 {
  const source = {
    assetId: "Generated:Mask-Crop",
    relativePath: "generated/mask-crop.e57",
    inputType: "generic_e57" as const,
    sizeBytes: 4_096,
    sha256: digest("a"),
  };
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-100, -100, -100] as [number, number, number],
    maximum: [100, 100, 100] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const limits = {
    maximumInputPoints: POINTS.length,
    maximumOutputPoints: POINTS.length,
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
  const sourceFactsArtifactSha256 = digest("b");
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
      workerImageSha256: digest("c"),
      recipeSha256: digest("d"),
      stageGraphSha256: digest("e"),
      ingestManifestSha256: digest("f"),
      checkpointCommandSha256: digest("1"),
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
): FoundryE57GeometryReader {
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactInvocation.source,
    adapter: {
      name: "generated_mask_point_records",
      version: "1.0.0",
      bridgeArtifactSha256: digest("2"),
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
        data3dGuid: "{generated-mask-scan}",
        pointCount: POINTS.length,
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
    totalPointCount: POINTS.length,
    authority: "none",
  });
  return {
    describe: () => Promise.resolve(description),
    readBatch: ({ startPointIndex, maximumPoints }) =>
      Promise.resolve({
        sourceSha256: exactInvocation.source.sha256,
        scanIndex: 0,
        data3dGuid: "{generated-mask-scan}",
        startPointIndex,
        points: POINTS.slice(
          startPointIndex,
          startPointIndex + maximumPoints,
        ).map(([x, y, z]) => ({
          x,
          y,
          z,
          cartesianInvalidState: 0,
        })),
      }),
  };
}

async function artifact(): Promise<FoundryE57GeometryCropArtifactV0> {
  const exactInvocation = invocation();
  const result = await runFoundryE57GeometryWorker({
    invocation: exactInvocation,
    reader: reader(exactInvocation),
  });
  if (result.status !== "succeeded") throw new Error("generated crop failed");
  return result.artifact;
}

function authorship() {
  return {
    operatorId: "local-operator-001",
    operatorDisplayName: "Generated Fixture Operator",
    authoredAt: "2026-08-09T21:00:00.000Z",
    purposeNote:
      "Generated-only point classifications for deterministic local fusion testing.",
    identityAuthority: "caller_supplied_unverified" as const,
  };
}

async function maskInput(): Promise<FoundryE57PointClassificationMaskInputV0> {
  const exactArtifact = await artifact();
  const selectors = deriveFoundryE57PointClassificationSelectorsV0(
    exactArtifact,
    [
      { scanIndex: 0, sourcePointIndex: 0 },
      { scanIndex: 0, sourcePointIndex: 1 },
      { scanIndex: 0, sourcePointIndex: 4 },
    ],
  );
  return {
    schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
    artifact: exactArtifact,
    authorship: authorship(),
    defaultClassification: "unclassified_static_candidate",
    rules: [
      {
        ruleId: "movable-exact-points",
        classification: "captured_movable_visual_excluded",
        rationale:
          "These generated fixture points represent captured movable visual content.",
        selection: {
          kind: "exact_point_selectors",
          points: selectors.slice(0, 2),
        },
      },
      {
        ruleId: "privacy-metric-region",
        classification: "privacy_excluded",
        rationale:
          "This generated metric region exercises deterministic privacy exclusion.",
        selection: {
          kind: "inclusive_bounds_e57_root_m",
          frame: "e57_root",
          units: "metre",
          minimum: [2, -0.1, -0.1],
          maximum: [3, 0.1, 0.1],
        },
      },
      {
        ruleId: "explicit-static-point",
        classification: "unclassified_static_candidate",
        rationale:
          "This point is explicitly retained but remains only an unclassified candidate.",
        selection: {
          kind: "exact_point_selectors",
          points: selectors.slice(2),
        },
      },
    ],
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

function inaccessibleArray(length: number): {
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
      throw new Error("guard read an oversized element");
    },
  });
  value.length = length;
  return { value, wasRead: () => read };
}

describe("authority-none E57 point classification mask", () => {
  it("enumerates every retained point exactly once in stable source order", async () => {
    const input = await maskInput();
    const first = compileFoundryE57PointClassificationMaskV0(input);
    const second = compileFoundryE57PointClassificationMaskV0({
      ...input,
      rules: [...input.rules].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.classificationCounts).toEqual({
      sourceRetainedPoints: 8,
      capturedMovableVisualExcluded: 2,
      privacyExcluded: 2,
      unclassifiedStaticCandidate: 4,
    });
    expect(first.points).toHaveLength(8);
    expect(first.points.map((point) => point.pointOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(new Set(first.points.map((point) => point.pointId)).size).toBe(8);
    expect(first.points.map((point) => point.classification)).toEqual([
      "captured_movable_visual_excluded",
      "captured_movable_visual_excluded",
      "privacy_excluded",
      "privacy_excluded",
      "unclassified_static_candidate",
      "unclassified_static_candidate",
      "unclassified_static_candidate",
      "unclassified_static_candidate",
    ]);
    expect(first.points[4]?.classificationOrigin).toEqual({
      kind: "operator_rule",
      ruleId: "explicit-static-point",
    });
    expect(first.points[5]?.classificationOrigin).toEqual({
      kind: "declared_default",
      ruleId: null,
    });
    expect(
      verifyFoundryE57PointClassificationMaskV0(first, input.artifact),
    ).toEqual(first);
  });

  it("binds exact crop/source-facts/frame/unit and grants no review or architectural authority", async () => {
    const input = await maskInput();
    const result = compileFoundryE57PointClassificationMaskV0(input);

    expect(result.subject).toMatchObject({
      artifactSha256: input.artifact.artifactSha256,
      source: input.artifact.source,
      sourceFactsArtifactSha256: input.artifact.sourceFactsArtifactSha256,
      readerDescriptionSha256:
        input.artifact.readerDescription.descriptionSha256,
      frame: "e57_root",
      units: "metre",
      axes: "right_handed_z_up",
      sourceRetainedPointCount: 8,
    });
    expect(result.authorship).toEqual(authorship());
    expect(result.reviewStatus).toBe("not_reviewed");
    expect(result.authority).toEqual({
      pointClassification: "caller_supplied_unverified",
      architecturalGeometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none",
    });
    expect(result.capabilities).toEqual({
      localAuthorityNoneFusionExclusion: "allowed",
      sourceMutation: "not_authorized",
      transformArtifactCreation: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      qaApproval: "not_authorized",
      packageExport: "not_authorized",
      runtimeActivation: "not_authorized",
    });
    expect(result.verificationBoundary).toEqual({
      standaloneSchema: "payload_self_consistency_only",
      exactCropAndRuleBinding: "requires_recompile_from_exact_crop",
      digestAuthentication: "not_provided",
    });
  });

  it("rejects selector substitution, duplicate selectors, and missing points", async () => {
    const input = await maskInput();
    const firstRule = input.rules[0];
    if (
      firstRule === undefined ||
      firstRule.selection.kind !== "exact_point_selectors"
    ) {
      throw new Error("fixture selector rule missing");
    }
    const firstSelector = firstRule.selection.points[0];
    if (firstSelector === undefined)
      throw new Error("fixture selector missing");

    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [
            {
              ...firstRule,
              selection: {
                ...firstRule.selection,
                points: [{ ...firstSelector, evidenceSha256: digest("9") }],
              },
            },
            ...input.rules.slice(1),
          ],
        }),
      "E57_POINT_CLASSIFICATION_SELECTOR_BINDING_MISMATCH",
    );
    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [
            {
              ...firstRule,
              selection: {
                ...firstRule.selection,
                points: [firstSelector, firstSelector],
              },
            },
            ...input.rules.slice(1),
          ],
        }),
      "E57_POINT_CLASSIFICATION_SELECTOR_DUPLICATE",
    );
    expectCode(
      () =>
        deriveFoundryE57PointClassificationSelectorsV0(input.artifact, [
          { scanIndex: 0, sourcePointIndex: 999 },
        ]),
      "E57_POINT_CLASSIFICATION_SELECTOR_MISSING",
    );
  });

  it("rejects any point selected by multiple rules even when classifications agree", async () => {
    const input = await maskInput();
    const firstRule = input.rules[0];
    if (
      firstRule === undefined ||
      firstRule.selection.kind !== "exact_point_selectors"
    ) {
      throw new Error("fixture selector rule missing");
    }
    const overlapRule = {
      ruleId: "overlapping-movable-region",
      classification: "captured_movable_visual_excluded" as const,
      rationale:
        "This deliberately overlaps an exact selector and must fail closed.",
      selection: {
        kind: "inclusive_bounds_e57_root_m" as const,
        frame: "e57_root" as const,
        units: "metre" as const,
        minimum: [-0.1, -0.1, -0.1] as [number, number, number],
        maximum: [0.1, 0.1, 0.1] as [number, number, number],
      },
    };

    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [...input.rules, overlapRule],
        }),
      "E57_POINT_CLASSIFICATION_RULE_OVERLAP",
    );

    const maximumOverlappingRegions = Array.from(
      { length: FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES },
      (_value, index) => ({
        ruleId: `overlap-${String(index).padStart(3, "0")}`,
        classification: "privacy_excluded" as const,
        rationale:
          "Generated maximum-rule overlap must fail during bounded incremental assignment.",
        selection: {
          kind: "inclusive_bounds_e57_root_m" as const,
          frame: "e57_root" as const,
          units: "metre" as const,
          minimum: [-1, -1, -1] as [number, number, number],
          maximum: [1, 1, 1] as [number, number, number],
        },
      }),
    );
    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: maximumOverlappingRegions,
        }),
      "E57_POINT_CLASSIFICATION_RULE_OVERLAP",
    );
  });

  it("rejects empty metric regions and preview-correction shaped input", async () => {
    const input = await maskInput();
    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [
            ...input.rules,
            {
              ruleId: "empty-region",
              classification: "privacy_excluded",
              rationale:
                "No generated point is inside this region so it is not reproducible evidence.",
              selection: {
                kind: "inclusive_bounds_e57_root_m",
                frame: "e57_root",
                units: "metre",
                minimum: [50, 50, 50],
                maximum: [51, 51, 51],
              },
            },
          ],
        }),
      "E57_POINT_CLASSIFICATION_RULE_EMPTY",
    );
    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [
            ...input.rules,
            {
              ruleId: "preview-correction-forbidden",
              classification: "privacy_excluded",
              rationale:
                "Preview corrections are view state and cannot define exact source points.",
              selection: {
                kind: "inclusive_bounds_e57_root_m",
                frame: "e57_root",
                units: "metre",
                minimum: [50, 50, 50],
                maximum: [51, 51, 51],
                previewCorrection: {
                  translationM: [1, 0, 0],
                  rotationDegrees: [0, 0, 0],
                  scaleMultiplier: 1,
                },
              },
            },
          ],
        }),
      "E57_POINT_CLASSIFICATION_INPUT_INVALID",
    );
  });

  it("rejects artifact substitution and classification tampering", async () => {
    const input = await maskInput();
    const result = compileFoundryE57PointClassificationMaskV0(input);
    const substitutedArtifact = structuredClone(input.artifact);
    substitutedArtifact.sourceFactsArtifactSha256 = digest("8");
    expect(() =>
      verifyFoundryE57PointClassificationMaskV0(result, substitutedArtifact),
    ).toThrow();

    const { maskSha256: _maskSha256, ...payload } = result;
    const firstPoint = payload.points[0];
    if (firstPoint === undefined) throw new Error("fixture point missing");
    const changedPayload = {
      ...payload,
      points: [
        {
          ...firstPoint,
          classification: "privacy_excluded" as const,
        },
        ...payload.points.slice(1),
      ],
    };
    expect(() =>
      computeFoundryE57PointClassificationMaskSha256(changedPayload),
    ).toThrow();
    expect(
      FoundryE57PointClassificationMaskV0Schema.safeParse({
        ...changedPayload,
        maskSha256: result.maskSha256,
      }).success,
    ).toBe(false);

    const coupledPoints = payload.points.map((point) =>
      point.pointOrder === firstPoint.pointOrder
        ? {
            ...point,
            classification: "unclassified_static_candidate" as const,
            classificationOrigin: {
              kind: "declared_default" as const,
              ruleId: null,
            },
          }
        : point,
    );
    const coupledPayload = {
      ...payload,
      points: coupledPoints,
      classificationCounts: {
        ...payload.classificationCounts,
        capturedMovableVisualExcluded:
          payload.classificationCounts.capturedMovableVisualExcluded - 1,
        unclassifiedStaticCandidate:
          payload.classificationCounts.unclassifiedStaticCandidate + 1,
      },
    };
    expect(() =>
      computeFoundryE57PointClassificationMaskSha256(coupledPayload),
    ).toThrow();

    expect(() =>
      computeFoundryE57PointClassificationMaskSha256({
        ...payload,
        subject: {
          ...payload.subject,
          sourceBoundsM: {
            ...payload.subject.sourceBoundsM,
            maximum: [999, 999, 999],
          },
        },
      }),
    ).toThrow();
  });

  it("preflights hostile outer, selector, and output arrays before element access", async () => {
    const input = await maskInput();
    const rules = inaccessibleArray(
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES + 1,
    );
    const inputDecision =
      FoundryE57PointClassificationMaskInputV0Schema.safeParse({
        ...input,
        rules: rules.value,
      });
    expect(inputDecision.success).toBe(false);
    expect(rules.wasRead()).toBe(false);
    if (!inputDecision.success) {
      expect(inputDecision.error.issues.length).toBeLessThan(10);
    }

    const selectorRule = input.rules[0];
    if (
      selectorRule === undefined ||
      selectorRule.selection.kind !== "exact_point_selectors"
    ) {
      throw new Error("fixture selector rule missing");
    }
    const selectors = inaccessibleArray(
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS + 1,
    );
    expectCode(
      () =>
        compileFoundryE57PointClassificationMaskV0({
          ...input,
          rules: [
            {
              ...selectorRule,
              selection: {
                ...selectorRule.selection,
                points: selectors.value,
              },
            },
            ...input.rules.slice(1),
          ],
        }),
      "E57_POINT_CLASSIFICATION_LIMIT_EXCEEDED",
    );
    expect(selectors.wasRead()).toBe(false);

    const references = inaccessibleArray(
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS + 1,
    );
    expectCode(
      () =>
        deriveFoundryE57PointClassificationSelectorsV0(
          input.artifact,
          references.value,
        ),
      "E57_POINT_CLASSIFICATION_SELECTOR_INPUT_INVALID",
    );
    expect(references.wasRead()).toBe(false);

    const result = compileFoundryE57PointClassificationMaskV0(input);
    const points = inaccessibleArray(
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS + 1,
    );
    const { maskSha256: _maskSha256, ...payload } = result;
    const payloadDecision =
      FoundryE57PointClassificationMaskPayloadV0Schema.safeParse({
        ...payload,
        points: points.value,
      });
    const resultDecision = FoundryE57PointClassificationMaskV0Schema.safeParse({
      ...result,
      points: points.value,
    });
    expect(payloadDecision.success).toBe(false);
    expect(resultDecision.success).toBe(false);
    expect(points.wasRead()).toBe(false);

    const exactCapInvalidPoints = Array.from(
      { length: FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS },
      () => ({}),
    );
    const exactCapDecision =
      FoundryE57PointClassificationMaskPayloadV0Schema.safeParse({
        ...payload,
        points: exactCapInvalidPoints,
      });
    expect(exactCapDecision.success).toBe(false);
    if (!exactCapDecision.success) {
      expect(exactCapDecision.error.issues.length).toBeLessThan(10);
    }
  });
});
