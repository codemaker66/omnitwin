import { createHash } from "node:crypto";
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
import {
  CanonicalJsonValueSchema,
  stableCanonicalJson,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS,
  LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0,
  LOCAL_E57_VISUAL_MAX_POINTS,
  LocalRoomRealityReviewError,
  compileLocalE57VisualInspectionDraftV0,
  parseLocalE57VisualReviewArtifactV0,
  verifyLocalE57VisualInspectionDraftV0,
} from "../local-room-reality-review.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const DIGEST_1 = `sha256:${"1".repeat(64)}`;
const VISUAL_DRAFT_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0";

function visualDraftDigest(payload: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(payload);
  return `sha256:${createHash("sha256")
    .update(
      `${VISUAL_DRAFT_DIGEST_DOMAIN}\n${stableCanonicalJson(canonical)}`,
      "utf8",
    )
    .digest("hex")}`;
}

interface FixturePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly cartesianInvalidState: number;
}

function source(
  sha256: string = DIGEST_A,
): FoundryE57GeometryInvocationV0["source"] {
  return {
    assetId: "bounded-review-crop",
    relativePath: "bounded-review-crop.e57",
    inputType: "generic_e57",
    sizeBytes: 4_096,
    sha256,
  };
}

function invocation(input: {
  readonly source: FoundryE57GeometryInvocationV0["source"];
  readonly pointCount: number;
  readonly cropMaximumX?: number;
}): FoundryE57GeometryInvocationV0 {
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-2, -2, -2] as [number, number, number],
    maximum: [
      input.cropMaximumX ?? input.pointCount + 2,
      2,
      2,
    ] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const limits: FoundryE57GeometryInvocationV0["limits"] = {
    maximumInputPoints: input.pointCount,
    maximumOutputPoints: input.pointCount,
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
    source: input.source,
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
          source: input.source,
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
  exactSource: FoundryE57GeometryInvocationV0["source"],
  points: readonly FixturePoint[],
): FoundryE57GeometryReader {
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactSource,
    adapter: {
      name: "local_visual_review_fixture",
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
        data3dGuid: "{local-visual-review-fixture}",
        pointCount: points.length,
        pointFields: [
          "cartesianInvalidState",
          "cartesianX",
          "cartesianY",
          "cartesianZ",
        ],
        pose: { rotationWxyz: [1, 0, 0, 0], translationM: [0, 0, 0] },
      },
    ],
    totalPointCount: points.length,
    authority: "none",
  });
  return {
    describe: () => Promise.resolve(description),
    readBatch: ({ startPointIndex, maximumPoints }) =>
      Promise.resolve({
        sourceSha256: exactSource.sha256,
        scanIndex: 0,
        data3dGuid: "{local-visual-review-fixture}",
        startPointIndex,
        points: points.slice(startPointIndex, startPointIndex + maximumPoints),
      }),
  };
}

async function artifact(input: {
  readonly sourceSha256?: string;
  readonly cropMaximumX?: number;
  readonly pointCount?: number;
  readonly pointOffsetX?: number;
} = {}): Promise<FoundryE57GeometryCropArtifactV0> {
  const pointCount = input.pointCount ?? 3;
  const exactSource = source(input.sourceSha256);
  const points = Array.from({ length: pointCount }, (_, index) => ({
    x: (input.pointOffsetX ?? 0) + index,
    y: index % 2,
    z: 0,
    cartesianInvalidState: 0,
  }));
  const result = await runFoundryE57GeometryWorker({
    invocation: invocation({
      source: exactSource,
      pointCount,
      cropMaximumX: input.cropMaximumX,
    }),
    reader: reader(exactSource, points),
  });
  if (result.status !== "succeeded") {
    throw new Error("The bounded visual fixture did not complete.");
  }
  return result.artifact;
}

function decisions() {
  return LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.map((dimensionId) => ({
    dimensionId,
    observation:
      dimensionId === "crop"
        ? ("preview_issue_observed" as const)
        : ("not_assessed" as const),
    note:
      dimensionId === "crop"
        ? "The north edge needs a tighter preview-only crop proposal."
        : "",
  }));
}

describe("bounded local E57 visual inspection draft", () => {
  it("binds exact compatible artifacts, view, decisions, and preview-only annotations deterministically", async () => {
    const primary = await artifact();
    const comparison = await artifact({ cropMaximumX: 3.5 });
    const input = {
      primaryArtifact: primary,
      comparisonArtifact: comparison,
      metadataReviewDraftSha256: null,
      reviewedAt: "2026-08-09T14:00:00.000Z",
      reviewedBy: "Local visual reviewer",
      view: {
        projection: "orthographic_preview" as const,
        yawDegrees: 25,
        pitchDegrees: -18,
        zoom: 1.4,
        targetM: [1, 0.5, 0] as [number, number, number],
        canvasAspectRatio: 1.6,
        comparisonVisible: true,
        comparisonOpacity: 0.55,
        previewBoundsM: {
          minimum: [-1, -1, -1] as [number, number, number],
          maximum: [2.5, 1, 1] as [number, number, number],
        },
        previewCorrection: {
          translationM: [0, 0, 0] as [number, number, number],
          rotationDegrees: [0, 0, 0] as [number, number, number],
          scaleMultiplier: 1,
        },
      },
      decisions: decisions(),
      annotations: [
        {
          dimensionId: "crop" as const,
          note: "Preview a tighter north edge without changing crop geometry.",
          boundsM: {
            minimum: [-1, -1, -1] as [number, number, number],
            maximum: [2.5, 1, 1] as [number, number, number],
          },
          previewCorrection: {
            translationM: [0, 0, 0] as [number, number, number],
            rotationDegrees: [0, 0, 0] as [number, number, number],
            scaleMultiplier: 1,
          },
        },
      ],
    };

    const first = compileLocalE57VisualInspectionDraftV0(input);
    const second = compileLocalE57VisualInspectionDraftV0(input);
    const changedPreview = compileLocalE57VisualInspectionDraftV0({
      ...input,
      view: {
        ...input.view,
        previewCorrection: {
          ...input.view.previewCorrection,
          scaleMultiplier: 1.01,
        },
      },
    });

    expect(second).toEqual(first);
    expect(changedPreview.viewSha256).not.toBe(first.viewSha256);
    expect(changedPreview.reviewDraftSha256).not.toBe(
      first.reviewDraftSha256,
    );
    expect(first.schemaVersion).toBe(LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0);
    expect(first.authority).toBe("none");
    expect(first.subject.primaryArtifactSha256).toBe(primary.artifactSha256);
    expect(first.subject.comparisonArtifactSha256).toBe(
      comparison.artifactSha256,
    );
    expect(first.view).toMatchObject({
      canvasAspectRatio: 1.6,
      comparisonVisible: true,
      previewBoundsM: {
        minimum: [-1, -1, -1],
        maximum: [2.5, 1, 1],
      },
      previewCorrection: { scaleMultiplier: 1 },
    });
    expect(first.decisions).toHaveLength(7);
    expect(first.decisions[0]?.artifactDigests).toEqual([
      primary.artifactSha256,
      comparison.artifactSha256,
    ]);
    expect(first.annotations[0]).toMatchObject({
      annotationId: "annotation-001",
      viewSha256: first.viewSha256,
      previewCorrection: { scaleMultiplier: 1 },
    });
    expect(first.capabilities).toEqual({
      execution: "not_authorized",
      correctionApplication: "not_authorized",
      transformArtifactCreation: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      qaApproval: "not_authorized",
      packageExport: "not_authorized",
      runtimeActivation: "not_authorized",
    });
    expect(verifyLocalE57VisualInspectionDraftV0(first)).toEqual(first);

    const {
      reviewDraftSha256: _comparisonCountDigest,
      ...comparisonCountPayload
    } = first;
    const missingComparisonCountPayload = {
      ...comparisonCountPayload,
      inspectionBoundary: {
        ...comparisonCountPayload.inspectionBoundary,
        comparisonPointCount: null,
      },
    };
    expect(() =>
      verifyLocalE57VisualInspectionDraftV0({
        ...missingComparisonCountPayload,
        reviewDraftSha256: visualDraftDigest(missingComparisonCountPayload),
      }),
    ).toThrow(/exactly when a distinct comparison artifact is bound/u);

    const zeroPointComparisonPayload = {
      ...comparisonCountPayload,
      inspectionBoundary: {
        ...comparisonCountPayload.inspectionBoundary,
        comparisonPointCount: 0,
      },
    };
    expect(() =>
      verifyLocalE57VisualInspectionDraftV0({
        ...zeroPointComparisonPayload,
        reviewDraftSha256: visualDraftDigest(zeroPointComparisonPayload),
      }),
    ).toThrow(/has points/u);

    const {
      reviewDraftSha256: _duplicateComparisonDigest,
      ...duplicateComparisonPayloadBase
    } = first;
    const duplicateArtifactDigests = [
      first.subject.primaryArtifactSha256,
      first.subject.primaryArtifactSha256,
    ];
    const duplicateComparisonPayload = {
      ...duplicateComparisonPayloadBase,
      subject: {
        ...duplicateComparisonPayloadBase.subject,
        comparisonArtifactSha256: first.subject.primaryArtifactSha256,
      },
      decisions: duplicateComparisonPayloadBase.decisions.map((decision) => ({
        ...decision,
        artifactDigests: duplicateArtifactDigests,
      })),
      annotations: duplicateComparisonPayloadBase.annotations.map(
        (annotation) => ({
          ...annotation,
          artifactDigests: duplicateArtifactDigests,
        }),
      ),
    };
    expect(() =>
      verifyLocalE57VisualInspectionDraftV0({
        ...duplicateComparisonPayload,
        reviewDraftSha256: visualDraftDigest(duplicateComparisonPayload),
      }),
    ).toThrow(/must be distinct/u);
  });

  it("fails closed for tampering, cross-source overlays, and invalid decision notes", async () => {
    const primary = await artifact();
    const compatible = await artifact({ cropMaximumX: 3.5 });
    const emptyCompatible = await artifact({ pointOffsetX: 100 });
    const differentSource = await artifact({ sourceSha256: DIGEST_F });

    expect(() =>
      parseLocalE57VisualReviewArtifactV0({
        ...primary,
        authority: "measured",
      }),
    ).toThrow(LocalRoomRealityReviewError);
    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        comparisonArtifact: differentSource,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: true,
          comparisonOpacity: 0.5,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions(),
        annotations: [],
      }),
    ).toThrow(/same exact source bytes/u);
    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: false,
          comparisonOpacity: 0.5,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions().map((decision) =>
          decision.dimensionId === "alignment"
            ? {
                ...decision,
                observation: "preview_issue_observed" as const,
                note: "short",
              }
            : decision,
        ),
        annotations: [],
      }),
    ).toThrow(/12 to 1000/u);

    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: false,
          comparisonOpacity: 0.5,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions().map((decision) =>
          decision.dimensionId === "source_comparison"
            ? {
                ...decision,
                observation: "no_preview_issue_observed" as const,
                note: "The two visible previews appear aligned in this view.",
              }
            : decision,
        ),
        annotations: [],
      }),
    ).toThrow(/must remain not assessed/u);

    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: true,
          comparisonOpacity: 0.5,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions(),
        annotations: [],
      }),
    ).toThrow(/can be visible only/u);

    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        comparisonArtifact: compatible,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: true,
          comparisonOpacity: 0,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions(),
        annotations: [],
      }),
    ).toThrow(/minimum preview opacity/u);

    expect(() =>
      compileLocalE57VisualInspectionDraftV0({
        primaryArtifact: primary,
        comparisonArtifact: emptyCompatible,
        metadataReviewDraftSha256: null,
        reviewedAt: "2026-08-09T14:00:00.000Z",
        reviewedBy: "Local visual reviewer",
        view: {
          projection: "orthographic_preview",
          yawDegrees: 0,
          pitchDegrees: 0,
          zoom: 1,
          targetM: [0, 0, 0],
          canvasAspectRatio: 1.6,
          comparisonVisible: true,
          comparisonOpacity: 0.55,
          previewBoundsM: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
          previewCorrection: {
            translationM: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scaleMultiplier: 1,
          },
        },
        decisions: decisions(),
        annotations: [],
      }),
    ).toThrow(/has points/u);
  });

  it("rejects a valid generated crop above the deliberate browser point budget", async () => {
    const oversized = await artifact({
      pointCount: LOCAL_E57_VISUAL_MAX_POINTS + 1,
    });

    expect(() => parseLocalE57VisualReviewArtifactV0(oversized)).toThrow(
      new RegExp(String(LOCAL_E57_VISUAL_MAX_POINTS), "u"),
    );
  }, 20_000);
});
