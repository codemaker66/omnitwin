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
} from "@omnitwin/reconstruction-foundry";
import { describe, expect, it } from "vitest";
import {
  LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0,
  LocalE57PointClassificationMaskError,
  compileLocalE57PointClassificationMaskV0,
} from "../local-e57-point-classification-mask.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const DIGEST_1 = `sha256:${"1".repeat(64)}`;

const POINTS = [
  { x: 0, y: 0, z: 0, cartesianInvalidState: 0 },
  { x: 1, y: 0, z: 0, cartesianInvalidState: 0 },
  { x: 2, y: 0, z: 0, cartesianInvalidState: 0 },
  { x: 3, y: 0, z: 0, cartesianInvalidState: 0 },
  { x: 4, y: 0, z: 0, cartesianInvalidState: 0 },
] as const;

function source(): FoundryE57GeometryInvocationV0["source"] {
  return {
    assetId: "local-mask-generated-fixture",
    relativePath: "local-mask-generated-fixture.e57",
    inputType: "generic_e57",
    sizeBytes: 4_096,
    sha256: DIGEST_A,
  };
}

function invocation(): FoundryE57GeometryInvocationV0 {
  const exactSource = source();
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-1, -1, -1] as [number, number, number],
    maximum: [5, 1, 1] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const limits: FoundryE57GeometryInvocationV0["limits"] = {
    maximumInputPoints: POINTS.length,
    maximumOutputPoints: POINTS.length,
    maximumBatchPoints: FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
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
  return {
    schemaVersion: FOUNDRY_E57_GEOMETRY_INVOCATION_V0,
    operation: FOUNDRY_E57_GEOMETRY_OPERATION,
    operationVersion: FOUNDRY_E57_GEOMETRY_OPERATION_VERSION,
    executionMode: "local_dependency_injected_authority_none",
    source: exactSource,
    sourceFactsArtifactSha256: DIGEST_B,
    crop,
    limits,
    coordinateContract,
    contentPolicy,
    checkpointContract: {
      format: FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT,
      formatVersion: "v0",
      stageId: FOUNDRY_E57_GEOMETRY_OPERATION,
      workerImageSha256: DIGEST_C,
      recipeSha256: DIGEST_D,
      stageGraphSha256: DIGEST_E,
      ingestManifestSha256: DIGEST_F,
      checkpointCommandSha256: DIGEST_1,
      inputCompatibilitySha256:
        computeFoundryE57GeometryInputCompatibilitySha256({
          source: exactSource,
          sourceFactsArtifactSha256: DIGEST_B,
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
  const data3dGuid = "{local-mask-generated-fixture}";
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactInvocation.source,
    adapter: {
      name: "local_mask_generated_fixture",
      version: "1.0.0",
      bridgeArtifactSha256: DIGEST_C,
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
        data3dGuid,
        pointCount: POINTS.length,
        pointFields: [
          "cartesianInvalidState",
          "cartesianX",
          "cartesianY",
          "cartesianZ",
        ],
        pose: { rotationWxyz: [1, 0, 0, 0], translationM: [0, 0, 0] },
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
        data3dGuid,
        startPointIndex,
        points: POINTS.slice(startPointIndex, startPointIndex + maximumPoints),
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

function request(exactArtifact: FoundryE57GeometryCropArtifactV0) {
  return {
    schemaVersion: LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0,
    artifact: exactArtifact,
    authorship: {
      operatorId: "local-operator-001",
      operatorDisplayName: "Generated Fixture Operator",
      authoredAt: "2026-08-09T22:00:00.000Z",
      purposeNote:
        "Prepare generated-only movable and privacy exclusions for local testing.",
      identityAuthority: "caller_supplied_unverified",
    },
    defaultClassification: "unclassified_static_candidate",
    rules: [
      {
        ruleId: "movable-bounds",
        classification: "captured_movable_visual_excluded",
        rationale:
          "Generated points zero and one represent movable captured fixture content.",
        selection: {
          kind: "inclusive_bounds_e57_root_m",
          frame: "e57_root",
          units: "metre",
          minimum: [-0.1, -0.1, -0.1],
          maximum: [1.1, 0.1, 0.1],
        },
      },
      {
        ruleId: "privacy-exact",
        classification: "privacy_excluded",
        rationale:
          "Generated point three represents one exact privacy-sensitive fixture point.",
        selection: {
          kind: "exact_point_references",
          points: [{ scanIndex: 0, sourcePointIndex: 3 }],
        },
      },
    ],
  } as const;
}

function expectMaskError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LocalE57PointClassificationMaskError);
    expect((error as LocalE57PointClassificationMaskError).code).toBe(code);
  }
}

describe("local loopback E57 classification-mask adapter", () => {
  it("reuses shared selector derivation, compilation, and verification", async () => {
    const exactArtifact = await artifact();
    const mask = compileLocalE57PointClassificationMaskV0(
      request(exactArtifact),
    );

    expect(mask.subject.artifactSha256).toBe(exactArtifact.artifactSha256);
    expect(mask.classificationCounts).toEqual({
      sourceRetainedPoints: 5,
      capturedMovableVisualExcluded: 2,
      privacyExcluded: 1,
      unclassifiedStaticCandidate: 2,
    });
    expect(mask.classificationRules[1]?.selection).toMatchObject({
      kind: "exact_point_selectors",
      points: [
        {
          scanIndex: 0,
          sourcePointIndex: 3,
        },
      ],
    });
    expect(mask.reviewStatus).toBe("not_reviewed");
    expect(mask.releaseEligibility).toBe("blocked");
    expect(mask.authority.architecturalGeometry).toBe("none");
    expect(mask.capabilities.runtimeActivation).toBe("not_authorized");
    expect(mask.maskSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails closed on empty, overlapping, and missing exact selections", async () => {
    const exactArtifact = await artifact();
    const base = request(exactArtifact);

    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          rules: [
            {
              ...base.rules[0],
              selection: {
                ...base.rules[0].selection,
                minimum: [50, 50, 50],
                maximum: [51, 51, 51],
              },
            },
          ],
        }),
      "E57_POINT_CLASSIFICATION_RULE_EMPTY",
    );
    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          rules: [
            base.rules[0],
            {
              ruleId: "overlap-privacy",
              classification: "privacy_excluded",
              rationale:
                "This generated privacy region deliberately overlaps the movable region.",
              selection: {
                kind: "inclusive_bounds_e57_root_m",
                frame: "e57_root",
                units: "metre",
                minimum: [1, -0.1, -0.1],
                maximum: [2, 0.1, 0.1],
              },
            },
          ],
        }),
      "E57_POINT_CLASSIFICATION_RULE_OVERLAP",
    );
    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          rules: [
            {
              ...base.rules[1],
              selection: {
                kind: "exact_point_references",
                points: [{ scanIndex: 0, sourcePointIndex: 999 }],
              },
            },
          ],
        }),
      "E57_POINT_CLASSIFICATION_SELECTOR_MISSING",
    );
  });

  it("rejects preview corrections, unclassified authoring, and artifact tampering", async () => {
    const exactArtifact = await artifact();
    const base = request(exactArtifact);
    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          rules: [
            {
              ...base.rules[0],
              selection: {
                ...base.rules[0].selection,
                previewCorrection: {
                  translationM: [1, 0, 0],
                  rotationDegrees: [0, 0, 0],
                  scaleMultiplier: 1,
                },
              },
            },
          ],
        }),
      "LOCAL_E57_MASK_REQUEST_INVALID",
    );
    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          rules: [
            {
              ...base.rules[0],
              classification: "unclassified_static_candidate",
            },
          ],
        }),
      "LOCAL_E57_MASK_REQUEST_INVALID",
    );
    expectMaskError(
      () =>
        compileLocalE57PointClassificationMaskV0({
          ...base,
          artifact: {
            ...exactArtifact,
            artifactSha256: DIGEST_F,
          },
        }),
      "LOCAL_E57_MASK_COMPILATION_FAILED",
    );
  });
});
