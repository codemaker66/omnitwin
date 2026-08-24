import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT,
  FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0,
  FOUNDRY_E57_GEOMETRY_INVOCATION_V0,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
  FOUNDRY_E57_GEOMETRY_OPERATION,
  FOUNDRY_E57_GEOMETRY_OPERATION_VERSION,
  FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
  FoundryE57GeometryCheckpointV0Schema,
  computeFoundryE57GeometryInputCompatibilitySha256,
  runFoundryE57GeometryWorker,
  sealFoundryE57GeometryReaderDescriptionV0,
  type FoundryE57GeometryInvocationV0,
  type FoundryE57GeometryCheckpointV0,
  type FoundryE57GeometryReader,
} from "../e57-geometry-worker.js";
import { createFoundryLocalPye57GeometryReader } from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const DIGEST_1 = `sha256:${"1".repeat(64)}`;
const CHECKPOINT_DOMAIN = "VENVIEWER_FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0";

const pythonProbe = spawnSync(
  "python",
  ["-I", "-c", "import sys; print(sys.executable)"],
  { encoding: "utf8", windowsHide: true },
);
const LOCAL_PYTHON_EXECUTABLE =
  pythonProbe.status === 0 && pythonProbe.stdout.trim().length > 0
    ? pythonProbe.stdout.trim()
    : null;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function source(
  overrides: Partial<FoundryE57GeometryInvocationV0["source"]> = {},
): FoundryE57GeometryInvocationV0["source"] {
  return {
    assetId: "capture-e57",
    relativePath: "capture.e57",
    inputType: "generic_e57",
    sizeBytes: 4_096,
    sha256: DIGEST_A,
    ...overrides,
  };
}

function invocation(
  input: {
    readonly source?: FoundryE57GeometryInvocationV0["source"];
    readonly maximumOutputPoints?: number;
    readonly maximumBatchPoints?: number;
    readonly crop?: FoundryE57GeometryInvocationV0["crop"];
  } = {},
): FoundryE57GeometryInvocationV0 {
  const exactSource = input.source ?? source();
  const crop = input.crop ?? {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [9, -1, -1] as [number, number, number],
    maximum: [13, 4, 4] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const limits = {
    maximumInputPoints: 100,
    maximumOutputPoints: input.maximumOutputPoints ?? 100,
    maximumBatchPoints: (input.maximumBatchPoints ??
      FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS) as typeof FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
    maximumScans: 10,
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
  const inputCompatibilitySha256 =
    computeFoundryE57GeometryInputCompatibilitySha256({
      source: exactSource,
      sourceFactsArtifactSha256: DIGEST_B,
      crop,
      limits,
      coordinateContract,
      contentPolicy,
    });
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
      inputCompatibilitySha256,
    },
    networkAccess: "none",
    imageDecoderAccess: "none",
    imageExtraction: "none",
    modelInference: "none",
    modelTraining: "none",
    authority: "none",
  };
}

interface FixtureScan {
  readonly data3dGuid: string;
  readonly rotationWxyz?: readonly [number, number, number, number];
  readonly translationM: readonly [number, number, number];
  readonly points: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly cartesianInvalidState: number;
  }[];
}

const fixtureScans: readonly FixtureScan[] = [
  {
    data3dGuid: "{fixture-scan-0}",
    translationM: [10, 0, 0],
    points: [
      { x: -1, y: 0, z: 0, cartesianInvalidState: 0 },
      { x: 0, y: 1, z: 1, cartesianInvalidState: 0 },
    ],
  },
  {
    data3dGuid: "{fixture-scan-1}",
    translationM: [10, 0, 0],
    points: [
      { x: 1, y: 2, z: 2, cartesianInvalidState: 1 },
      { x: 3, y: 4, z: 4, cartesianInvalidState: 0 },
      { x: 100, y: 100, z: 100, cartesianInvalidState: 0 },
    ],
  },
];

function fixtureReader(
  exactSource: FoundryE57GeometryInvocationV0["source"] = source(),
  scans: readonly FixtureScan[] = fixtureScans,
): FoundryE57GeometryReader {
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactSource,
    adapter: {
      name: "dependency_injected_point_records",
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
    scans: scans.map((scan, scanIndex) => ({
      scanIndex,
      data3dGuid: scan.data3dGuid,
      pointCount: scan.points.length,
      pointFields: [
        "cartesianInvalidState",
        "cartesianX",
        "cartesianY",
        "cartesianZ",
      ],
      pose: {
        rotationWxyz: [...(scan.rotationWxyz ?? [1, 0, 0, 0])],
        translationM: [...scan.translationM],
      },
    })),
    totalPointCount: scans.reduce(
      (total, scan) => total + scan.points.length,
      0,
    ),
    authority: "none",
  });
  return {
    describe: () => Promise.resolve(description),
    readBatch: ({ scanIndex, startPointIndex, maximumPoints }) => {
      const scan = scans[scanIndex];
      if (scan === undefined) throw new Error("fixture scan missing");
      return Promise.resolve({
        sourceSha256: exactSource.sha256,
        scanIndex,
        data3dGuid: scan.data3dGuid,
        startPointIndex,
        points: scan.points.slice(
          startPointIndex,
          startPointIndex + maximumPoints,
        ),
      });
    },
  };
}

async function expectCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resealCheckpoint(
  material: Omit<FoundryE57GeometryCheckpointV0, "checkpointSha256">,
): FoundryE57GeometryCheckpointV0 {
  return FoundryE57GeometryCheckpointV0Schema.parse({
    ...material,
    checkpointSha256: `sha256:${domainSeparatedSha256(
      CHECKPOINT_DOMAIN,
      toCanonicalJson(material),
    )}`,
  });
}

describe("authority-none E57 geometry worker", () => {
  it("applies exact scan poses, inclusive crop, invalid-state exclusion, bounds, and movable authority exclusion", async () => {
    const result = await runFoundryE57GeometryWorker({
      invocation: invocation(),
      reader: fixtureReader(),
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.artifact.pointCounts).toEqual({
      source: 5,
      processed: 5,
      invalid: 1,
      croppedOut: 1,
      accepted: 3,
    });
    expect(result.artifact.points).toEqual([
      {
        scanIndex: 0,
        data3dGuid: "{fixture-scan-0}",
        sourcePointIndex: 0,
        xM: 9,
        yM: 0,
        zM: 0,
      },
      {
        scanIndex: 0,
        data3dGuid: "{fixture-scan-0}",
        sourcePointIndex: 1,
        xM: 10,
        yM: 1,
        zM: 1,
      },
      {
        scanIndex: 1,
        data3dGuid: "{fixture-scan-1}",
        sourcePointIndex: 1,
        xM: 13,
        yM: 4,
        zM: 4,
      },
    ]);
    expect(result.artifact.outputBoundsM).toEqual({
      minimum: [9, 0, 0],
      maximum: [13, 4, 4],
    });
    expect(result.artifact.coordinateContract).toEqual({
      inputPointFrame: "e57_data3d_local_cartesian",
      scanPoseConvention: "normalized_quaternion_wxyz_then_translation_metres",
      outputFrame: "e57_root",
      units: "metre",
      axes: "right_handed_z_up",
    });
    expect(result.artifact.movableContent).toEqual({
      classification: "not_performed",
      retainedContent: "may_include_captured_movable_objects",
      geometryAuthority: "none",
      placementAuthority: "excluded",
      measurementAuthority: "excluded",
      collisionAuthority: "excluded",
      exportAuthority: "excluded",
    });
    expect(result.artifact.authority).toBe("none");
    expect(result.artifact.capabilities).toEqual({
      runtimeRegistration: "not_authorized",
      immutableRegistration: "not_authorized",
      signing: "not_authorized",
      activation: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    });
  });

  it("applies the declared quaternion rotation before translation in the E57 root frame", async () => {
    const quarterTurn = Math.SQRT1_2;
    const scans: readonly FixtureScan[] = [
      {
        data3dGuid: "{rotated-scan}",
        rotationWxyz: [quarterTurn, 0, 0, quarterTurn],
        translationM: [3, 4, 5],
        points: [{ x: 1, y: 0, z: 0, cartesianInvalidState: 0 }],
      },
    ];
    const result = await runFoundryE57GeometryWorker({
      invocation: invocation({
        crop: {
          frame: "e57_root",
          units: "metre",
          minimum: [2.999, 4.999, 4.999],
          maximum: [3.001, 5.001, 5.001],
          boundary: "inclusive",
        },
      }),
      reader: fixtureReader(source(), scans),
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.artifact.readerDescription.scans[0]?.pose).toEqual({
      rotationWxyz: [quarterTurn, 0, 0, quarterTurn],
      translationM: [3, 4, 5],
    });
    expect(result.artifact.points).toHaveLength(1);
    expect(result.artifact.points[0]?.xM).toBeCloseTo(3, 12);
    expect(result.artifact.points[0]?.yM).toBeCloseTo(5, 12);
    expect(result.artifact.points[0]?.zM).toBeCloseTo(5, 12);
  });

  it("normalizes an accepted near-unit scan quaternion exactly once before crop testing", async () => {
    const quarterTurn = Math.SQRT1_2;
    const nearUnitScale = 1 + 5e-7;
    const scans: readonly FixtureScan[] = [
      {
        data3dGuid: "{near-unit-rotation}",
        rotationWxyz: [
          quarterTurn * nearUnitScale,
          0,
          0,
          quarterTurn * nearUnitScale,
        ],
        translationM: [0, 0, 0],
        points: [{ x: 1, y: 0, z: 0, cartesianInvalidState: 0 }],
      },
    ];
    const result = await runFoundryE57GeometryWorker({
      invocation: invocation({
        crop: {
          frame: "e57_root",
          units: "metre",
          minimum: [-1e-12, 0.999_999_999_999, -1e-12],
          maximum: [1e-12, 1.000_000_000_001, 1e-12],
          boundary: "inclusive",
        },
      }),
      reader: fixtureReader(source(), scans),
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.artifact.points).toHaveLength(1);
    expect(result.artifact.points[0]?.xM).toBeCloseTo(0, 12);
    expect(result.artifact.points[0]?.yM).toBeCloseTo(1, 12);
  });

  it("commits a batch checkpoint on cancellation and resumes to the exact uninterrupted artifact", async () => {
    const controller = new AbortController();
    const exactInvocation = invocation();
    const first = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      signal: controller.signal,
      onCheckpoint: () => {
        controller.abort();
      },
    });
    expect(first.status).toBe("cancelled");
    expect(first.checkpoint.processedPointCount).toBe(2);
    expect(first.checkpoint.cursor).toEqual({ scanIndex: 1, pointIndex: 0 });

    const resumed = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      checkpoint: first.checkpoint,
    });
    const uninterrupted = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
    });
    expect(resumed.status).toBe("succeeded");
    expect(uninterrupted.status).toBe("succeeded");
    if (
      resumed.status !== "succeeded" ||
      uninterrupted.status !== "succeeded"
    ) {
      throw new Error("expected successful comparison runs");
    }
    expect(resumed.artifact).toEqual(uninterrupted.artifact);
    expect(resumed.checkpoint).toEqual(uninterrupted.checkpoint);
  });

  it("never exposes the live same-run checkpoint object to a hostile callback", async () => {
    const exactInvocation = invocation();
    let callbackCount = 0;
    const attacked = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      onCheckpoint: (publishedCheckpoint) => {
        callbackCount += 1;
        Reflect.set(publishedCheckpoint, "checkpointSha256", DIGEST_C);
        Reflect.set(publishedCheckpoint, "cursor", null);
        Reflect.set(publishedCheckpoint, "committedBatchCount", 999);
        Reflect.set(publishedCheckpoint, "processedPointCount", 0);
        Reflect.set(publishedCheckpoint, "acceptedPointCount", 0);
        Reflect.set(publishedCheckpoint, "complete", true);
        const acceptedPoint = publishedCheckpoint.acceptedPoints[0];
        if (acceptedPoint !== undefined) Reflect.set(acceptedPoint, "xM", 999);
        Reflect.set(publishedCheckpoint.acceptedPoints, "length", 0);
        const firstScan = publishedCheckpoint.readerDescription.scans[0];
        if (firstScan !== undefined) Reflect.set(firstScan, "pointCount", 999);
      },
    });
    const uninterrupted = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
    });

    expect(callbackCount).toBe(2);
    expect(attacked.status).toBe("succeeded");
    expect(uninterrupted.status).toBe("succeeded");
    if (
      attacked.status !== "succeeded" ||
      uninterrupted.status !== "succeeded"
    ) {
      throw new Error("expected successful comparison runs");
    }
    expect(attacked.checkpoint).toEqual(uninterrupted.checkpoint);
    expect(attacked.artifact).toEqual(uninterrupted.artifact);
  });

  it("pauses after an explicit batch budget and produces deterministic checkpoint and artifact digests", async () => {
    const exactInvocation = invocation();
    const paused = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      maximumBatchesThisRun: 1,
    });
    expect(paused.status).toBe("paused");
    expect(paused.checkpoint.schemaVersion).toBe(
      FOUNDRY_E57_GEOMETRY_CHECKPOINT_V0,
    );
    expect(
      FoundryE57GeometryCheckpointV0Schema.safeParse(paused.checkpoint).success,
    ).toBe(true);
    const resumed = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      checkpoint: paused.checkpoint,
    });
    const repeated = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
    });
    expect(resumed.status).toBe("succeeded");
    expect(repeated.status).toBe("succeeded");
    if (resumed.status !== "succeeded" || repeated.status !== "succeeded") {
      throw new Error("expected deterministic successful runs");
    }
    expect(resumed.checkpoint.checkpointSha256).toBe(
      repeated.checkpoint.checkpointSha256,
    );
    expect(resumed.artifact.artifactSha256).toBe(
      repeated.artifact.artifactSha256,
    );
  });

  it("replays the source prefix and rejects re-sealed accepted-point, counter, and cursor checkpoint forgeries before continuation", async () => {
    const exactInvocation = invocation();
    const paused = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
      maximumBatchesThisRun: 1,
    });
    expect(paused.status).toBe("paused");
    const { checkpointSha256: _checkpointSha256, ...material } =
      structuredClone(paused.checkpoint);
    const firstPoint = material.acceptedPoints[0];
    const secondPoint = material.acceptedPoints[1];
    if (firstPoint === undefined || secondPoint === undefined) {
      throw new Error("expected two accepted prefix points");
    }

    const acceptedPointForgery = resealCheckpoint({
      ...material,
      acceptedPoints: [{ ...firstPoint, xM: 9.25 }, secondPoint],
      outputBoundsM: {
        minimum: [9.25, 0, 0],
        maximum: [10, 1, 1],
      },
    });
    const counterForgery = resealCheckpoint({
      ...material,
      invalidPointCount: 1,
      acceptedPointCount: 1,
      acceptedPoints: [secondPoint],
      outputBoundsM: {
        minimum: [10, 1, 1],
        maximum: [10, 1, 1],
      },
    });
    const cursorForgery = resealCheckpoint({
      ...material,
      cursor: { scanIndex: 0, pointIndex: 1 },
      processedPointCount: 1,
      invalidPointCount: 0,
      croppedOutPointCount: 0,
      acceptedPointCount: 1,
      acceptedPoints: [firstPoint],
      outputBoundsM: {
        minimum: [9, 0, 0],
        maximum: [9, 0, 0],
      },
    });

    for (const forged of [
      acceptedPointForgery,
      counterForgery,
      cursorForgery,
    ]) {
      expect(
        FoundryE57GeometryCheckpointV0Schema.safeParse(forged).success,
      ).toBe(true);
      let continuationCheckpointUsed = false;
      await expectCode(
        runFoundryE57GeometryWorker({
          invocation: exactInvocation,
          reader: fixtureReader(),
          checkpoint: forged,
          onCheckpoint: () => {
            continuationCheckpointUsed = true;
          },
        }),
        "E57_GEOMETRY_CHECKPOINT_REPLAY_MISMATCH",
      );
      expect(continuationCheckpointUsed).toBe(false);
    }
  });

  it("replays a supplied complete checkpoint before taking the artifact fast path", async () => {
    const exactInvocation = invocation();
    const completed = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader: fixtureReader(),
    });
    expect(completed.status).toBe("succeeded");
    if (completed.status !== "succeeded") throw new Error("expected success");
    const { checkpointSha256: _checkpointSha256, ...material } =
      structuredClone(completed.checkpoint);
    const lastPoint = material.acceptedPoints.at(-1);
    if (lastPoint === undefined)
      throw new Error("expected final accepted point");
    const forged = resealCheckpoint({
      ...material,
      acceptedPoints: [
        ...material.acceptedPoints.slice(0, -1),
        { ...lastPoint, xM: 12.75 },
      ],
      outputBoundsM: {
        minimum: [9, 0, 0],
        maximum: [12.75, 4, 4],
      },
    });

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: exactInvocation,
        reader: fixtureReader(),
        checkpoint: forged,
      }),
      "E57_GEOMETRY_CHECKPOINT_REPLAY_MISMATCH",
    );
  });

  it("fails closed for a non-finite valid point and a crop exceeding its explicit output limit", async () => {
    const invalidReader = fixtureReader(source(), [
      {
        data3dGuid: "{nonfinite}",
        translationM: [0, 0, 0],
        points: [{ x: Number.NaN, y: 0, z: 0, cartesianInvalidState: 0 }],
      },
    ]);
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({
          crop: {
            frame: "e57_root",
            units: "metre",
            minimum: [-1, -1, -1],
            maximum: [1, 1, 1],
            boundary: "inclusive",
          },
        }),
        reader: invalidReader,
      }),
      "E57_GEOMETRY_READER_BATCH_INVALID",
    );
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ maximumOutputPoints: 1 }),
        reader: fixtureReader(),
      }),
      "E57_GEOMETRY_OUTPUT_POINT_LIMIT_EXCEEDED",
    );
  });

  it("rejects a valid checkpoint when the exact crop invocation changes", async () => {
    const firstInvocation = invocation();
    const paused = await runFoundryE57GeometryWorker({
      invocation: firstInvocation,
      reader: fixtureReader(),
      maximumBatchesThisRun: 1,
    });
    const changedInvocation = invocation({
      crop: {
        frame: "e57_root",
        units: "metre",
        minimum: [9, -1, -1],
        maximum: [12, 4, 4],
        boundary: "inclusive",
      },
    });
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: changedInvocation,
        reader: fixtureReader(),
        checkpoint: paused.checkpoint,
      }),
      "E57_GEOMETRY_CHECKPOINT_INCOMPATIBLE",
    );
  });

  it("rejects caller-selected tiny batches, short reader batches, and excessive run budgets", async () => {
    expect(() => invocation({ maximumBatchPoints: 1 })).toThrow();
    const baseReader = fixtureReader();
    const shortReader: FoundryE57GeometryReader = {
      describe: (input) => baseReader.describe(input),
      readBatch: async (input) => {
        const raw = await baseReader.readBatch(input);
        if (typeof raw !== "object" || raw === null || !("points" in raw)) {
          throw new Error("unexpected fixture batch");
        }
        const points = raw.points;
        if (!Array.isArray(points))
          throw new Error("unexpected fixture points");
        return { ...raw, points: points.slice(0, -1) };
      },
    };
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation(),
        reader: shortReader,
      }),
      "E57_GEOMETRY_READER_BATCH_BINDING_MISMATCH",
    );
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation(),
        reader: fixtureReader(),
        maximumBatchesThisRun: 80,
      }),
      "E57_GEOMETRY_BATCH_BUDGET_INVALID",
    );
  });

  it("kills a local bridge at its bounded command deadline and rejects only after close", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const root = await mkdtemp(join(tmpdir(), "venviewer-e57-deadline-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "capture.e57");
    const sourceBytes = Buffer.from(
      "ASTM-E57 bounded deadline fixture",
      "ascii",
    );
    await writeFile(sourcePath, sourceBytes);
    const bridgeScriptPath = join(root, "slow_bridge.py");
    const childPidPath = join(root, "slow-bridge.pid");
    const bridgeBytes = Buffer.from(
      [
        "import os",
        "from pathlib import Path",
        "import time",
        `Path(${JSON.stringify(childPidPath)}).write_text(str(os.getpid()), encoding="ascii")`,
        "time.sleep(10)",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(bridgeScriptPath, bridgeBytes);
    const startedAt = Date.now();
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({
          source: source({
            sizeBytes: sourceBytes.length,
            sha256: sha256(sourceBytes),
          }),
        }),
        reader: createFoundryLocalPye57GeometryReader({
          sourcePath,
          bridgeScriptPath,
          expectedBridgeArtifactSha256: sha256(bridgeBytes),
          pythonExecutable: LOCAL_PYTHON_EXECUTABLE,
          commandDeadlineMs: 300,
        }),
      }),
      "E57_PYE57_BRIDGE_DEADLINE_EXCEEDED",
    );
    const childPid = Number.parseInt(await readFile(childPidPath, "utf8"), 10);
    expect(Number.isSafeInteger(childPid)).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("returns an exact dependency blocker when the configured Python runtime is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "venviewer-e57-missing-python-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "capture.e57");
    const bytes = Buffer.from("ASTM-E57 dependency blocker fixture", "ascii");
    await writeFile(sourcePath, bytes);
    const exactSource = source({
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });
    const bridgeScriptPath = resolve(
      import.meta.dirname,
      "../../../../tools/reconstruction-foundry/python/e57_geometry_bridge.py",
    );
    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: exactSource }),
        reader: createFoundryLocalPye57GeometryReader({
          sourcePath,
          bridgeScriptPath,
          expectedBridgeArtifactSha256: sha256(
            await readFile(bridgeScriptPath),
          ),
          pythonExecutable: join(root, "definitely-absent-python.exe"),
        }),
      }),
      "E57_PYE57_DEPENDENCY_UNAVAILABLE",
    );
  });

  it("fails with an exact blocker when the caller-supplied bridge artifact is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "venviewer-e57-missing-bridge-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "capture.e57");
    const bytes = Buffer.from("ASTM-E57 missing bridge fixture", "ascii");
    await writeFile(sourcePath, bytes);
    const exactSource = source({
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: exactSource }),
        reader: createFoundryLocalPye57GeometryReader({
          sourcePath,
          bridgeScriptPath: join(root, "absent-e57-bridge.py"),
          expectedBridgeArtifactSha256: DIGEST_C,
          pythonExecutable:
            LOCAL_PYTHON_EXECUTABLE ?? join(root, "absent-python.exe"),
        }),
      }),
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
    );
  });

  it("refuses to execute a bridge that does not match its caller-supplied digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "venviewer-e57-bridge-digest-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "capture.e57");
    const bytes = Buffer.from("ASTM-E57 bridge digest fixture", "ascii");
    await writeFile(sourcePath, bytes);
    const bridgeScriptPath = resolve(
      import.meta.dirname,
      "../../../../tools/reconstruction-foundry/python/e57_geometry_bridge.py",
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({
          source: source({
            sizeBytes: bytes.length,
            sha256: sha256(bytes),
          }),
        }),
        reader: createFoundryLocalPye57GeometryReader({
          sourcePath,
          bridgeScriptPath,
          expectedBridgeArtifactSha256: DIGEST_C,
          pythonExecutable:
            LOCAL_PYTHON_EXECUTABLE ?? join(root, "absent-python.exe"),
        }),
      }),
      "E57_PYE57_BRIDGE_IDENTITY_MISMATCH",
    );
  });

  it("round-trips a genuine tiny ASTM E57 while hashing the container without decoding or extracting images", async () => {
    const root = await mkdtemp(join(tmpdir(), "venviewer-real-tiny-e57-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "tiny.e57");
    const fixtureScript = resolve(
      import.meta.dirname,
      "../../../../tools/reconstruction-foundry/python/create_tiny_e57_fixture.py",
    );
    const bridgeScript = resolve(
      import.meta.dirname,
      "../../../../tools/reconstruction-foundry/python/e57_geometry_bridge.py",
    );
    const expectedBridgeArtifactSha256 = sha256(await readFile(bridgeScript));
    const created = spawnSync("python", [fixtureScript, sourcePath], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (created.status !== 0) {
      const fallbackBytes = Buffer.from("ASTM-E57 dependency probe", "ascii");
      await writeFile(sourcePath, fallbackBytes);
      const fallbackSource = source({
        sizeBytes: fallbackBytes.length,
        sha256: sha256(fallbackBytes),
      });
      await expectCode(
        runFoundryE57GeometryWorker({
          invocation: invocation({ source: fallbackSource }),
          reader: createFoundryLocalPye57GeometryReader({
            sourcePath,
            bridgeScriptPath: bridgeScript,
            expectedBridgeArtifactSha256,
            pythonExecutable:
              LOCAL_PYTHON_EXECUTABLE ?? join(root, "absent-python.exe"),
          }),
        }),
        "E57_PYE57_DEPENDENCY_UNAVAILABLE",
      );
      return;
    }

    const bytes = await readFile(sourcePath);
    expect(bytes.subarray(0, 8).toString("ascii")).toBe("ASTM-E57");
    const exactSource = source({
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });
    const exactInvocation = invocation({
      source: exactSource,
      crop: {
        frame: "e57_root",
        units: "metre",
        minimum: [7, 19, 29],
        maximum: [13, 24, 34],
        boundary: "inclusive",
      },
    });
    const reader = createFoundryLocalPye57GeometryReader({
      sourcePath,
      bridgeScriptPath: bridgeScript,
      expectedBridgeArtifactSha256,
      pythonExecutable:
        LOCAL_PYTHON_EXECUTABLE ?? join(root, "absent-python.exe"),
    });
    const result = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader,
    });
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.artifact.readerDescription.adapter).toMatchObject({
      name: "pye57",
      version: "0.4.19",
    });
    expect(result.artifact.readerDescription.readPolicy).toMatchObject({
      batchAccess: "scan_start_replay_bounded_buffer",
      pointPayload: "cartesian_fields_only",
      fullContainerBytesHashed: true,
      imageDecoderAccess: false,
      imageExtraction: false,
      network: "none",
    });
    expect(result.artifact.pointCounts).toEqual({
      source: 5,
      processed: 5,
      invalid: 1,
      croppedOut: 1,
      accepted: 3,
    });
    expect(result.artifact.outputBoundsM).toEqual({
      minimum: [8, 20, 30],
      maximum: [12, 23, 33],
    });
    const repeated = await runFoundryE57GeometryWorker({
      invocation: exactInvocation,
      reader,
    });
    expect(repeated.status).toBe("succeeded");
    if (repeated.status !== "succeeded") throw new Error("expected repeat");
    expect(repeated.artifact.artifactSha256).toBe(
      result.artifact.artifactSha256,
    );
    expect(repeated.checkpoint.checkpointSha256).toBe(
      result.checkpoint.checkpointSha256,
    );
  }, 30_000);
});
