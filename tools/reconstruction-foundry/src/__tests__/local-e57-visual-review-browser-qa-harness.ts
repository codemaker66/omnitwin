import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
} from "../local-app.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const DIGEST_1 = `sha256:${"1".repeat(64)}`;

interface FixturePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly cartesianInvalidState: 0;
}

function requireTestOnlyGuard(): void {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.FOUNDRY_BROWSER_QA !== "1"
  ) {
    throw new Error(
      "This browser-QA harness requires NODE_ENV=test and FOUNDRY_BROWSER_QA=1.",
    );
  }
}

function points(): FixturePoint[] {
  const output: FixturePoint[] = [];
  for (let xIndex = 0; xIndex <= 30; xIndex += 1) {
    for (let yIndex = 0; yIndex <= 22; yIndex += 1) {
      output.push({
        x: -6 + xIndex * 0.4,
        y: -4.4 + yIndex * 0.4,
        z: 0,
        cartesianInvalidState: 0,
      });
    }
  }
  for (let step = 0; step < 180; step += 1) {
    const angle = (step / 180) * Math.PI * 2;
    output.push({
      x: Math.cos(angle) * 3.2,
      y: Math.sin(angle) * 2.2,
      z: 0.25 + (step % 45) * 0.07,
      cartesianInvalidState: 0,
    });
  }
  return output;
}

function maximumReviewPoints(): FixturePoint[] {
  return Array.from({ length: 50_000 }, (_, index) => ({
    x: -6 + (index % 250) * 0.048,
    y: -4.4 + Math.floor(index / 250) * 0.044,
    z: Math.sin(index * 0.031) * 0.35 + 0.5,
    cartesianInvalidState: 0 as const,
  }));
}

function source(
  sha256: string = DIGEST_A,
): FoundryE57GeometryInvocationV0["source"] {
  return {
    assetId: "browser-qa-generated-e57-crop",
    relativePath: "browser-qa-generated-e57-crop.e57",
    inputType: "generic_e57",
    sizeBytes: 4_096,
    sha256,
  };
}

function invocation(input: {
  readonly exactSource: FoundryE57GeometryInvocationV0["source"];
  readonly pointCount: number;
  readonly maximumZ: number;
}): FoundryE57GeometryInvocationV0 {
  const crop = {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [-7, -5, -1] as [number, number, number],
    maximum: [7, 5, input.maximumZ] as [number, number, number],
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
    source: input.exactSource,
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
          source: input.exactSource,
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
  exactPoints: readonly FixturePoint[],
): FoundryE57GeometryReader {
  const data3dGuid = "{local-e57-visual-browser-qa}";
  const description = sealFoundryE57GeometryReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
    source: exactSource,
    adapter: {
      name: "local_visual_browser_qa_fixture",
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
        pointCount: exactPoints.length,
        pointFields: [
          "cartesianInvalidState",
          "cartesianX",
          "cartesianY",
          "cartesianZ",
        ],
        pose: { rotationWxyz: [1, 0, 0, 0], translationM: [0, 0, 0] },
      },
    ],
    totalPointCount: exactPoints.length,
    authority: "none",
  });
  return {
    describe: () => Promise.resolve(description),
    readBatch: ({ startPointIndex, maximumPoints }) =>
      Promise.resolve({
        sourceSha256: exactSource.sha256,
        scanIndex: 0,
        data3dGuid,
        startPointIndex,
        points: exactPoints.slice(
          startPointIndex,
          startPointIndex + maximumPoints,
        ),
      }),
  };
}

async function artifact(input: {
  readonly exactSource: FoundryE57GeometryInvocationV0["source"];
  readonly exactPoints: readonly FixturePoint[];
  readonly maximumZ: number;
}): Promise<FoundryE57GeometryCropArtifactV0> {
  const result = await runFoundryE57GeometryWorker({
    invocation: invocation({
      exactSource: input.exactSource,
      pointCount: input.exactPoints.length,
      maximumZ: input.maximumZ,
    }),
    reader: reader(input.exactSource, input.exactPoints),
  });
  if (result.status !== "succeeded") {
    throw new Error("The harmless browser-QA crop did not complete.");
  }
  return result.artifact;
}

function writeFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function main(): Promise<void> {
  requireTestOnlyGuard();
  const tempRoot = await mkdtemp(join(tmpdir(), "foundry-e57-visual-browser-qa-"));
  let app: LocalFoundryAppHandle | undefined;
  let stopRequested = false;
  const requestStop = (): void => {
    stopRequested = true;
    if (app !== undefined) void app.stop().catch(writeFailure);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    const exactPoints = points();
    const exactSource = source();
    const primary = await artifact({ exactSource, exactPoints, maximumZ: 4 });
    const comparison = await artifact({
      exactSource,
      exactPoints,
      maximumZ: 3.9,
    });
    const incompatible = await artifact({
      exactSource: source(sha256(Buffer.from("different-source", "utf8"))),
      exactPoints,
      maximumZ: 4,
    });
    const maximumExactSource = source(`sha256:${"9".repeat(64)}`);
    const maximumExactPoints = maximumReviewPoints();
    const [maximumCrop, maximumComparisonCrop] = await Promise.all([
      artifact({
        exactSource: maximumExactSource,
        exactPoints: maximumExactPoints,
        maximumZ: 4,
      }),
      artifact({
        exactSource: maximumExactSource,
        exactPoints: maximumExactPoints,
        maximumZ: 4.1,
      }),
    ]);
    const sourcePath = join(tempRoot, "harmless-browser-qa-source.txt");
    const primaryPath = join(tempRoot, "primary-crop.json");
    const comparisonPath = join(tempRoot, "comparison-crop.json");
    const incompatiblePath = join(tempRoot, "incompatible-crop.json");
    const maximumCropPath = join(tempRoot, "maximum-50000-point-crop.json");
    const maximumComparisonCropPath = join(
      tempRoot,
      "maximum-comparison-50000-point-crop.json",
    );
    await Promise.all([
      writeFile(sourcePath, "harmless browser QA source\n", { flag: "wx" }),
      writeFile(primaryPath, `${JSON.stringify(primary, null, 2)}\n`, {
        flag: "wx",
      }),
      writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, {
        flag: "wx",
      }),
      writeFile(incompatiblePath, `${JSON.stringify(incompatible, null, 2)}\n`, {
        flag: "wx",
      }),
      writeFile(maximumCropPath, `${JSON.stringify(maximumCrop)}\n`, {
        flag: "wx",
      }),
      writeFile(
        maximumComparisonCropPath,
        `${JSON.stringify(maximumComparisonCrop)}\n`,
        { flag: "wx" },
      ),
    ]);
    app = await startLocalFoundryApp({ source: sourcePath });
    const status = {
      url: app.url.replace("/?", "/room-review?"),
      tempRoot,
      primaryPath,
      comparisonPath,
      incompatiblePath,
      maximumCropPath,
      maximumComparisonCropPath,
    };
    const statusPath = process.env.FOUNDRY_BROWSER_QA_STATUS_PATH;
    if (statusPath !== undefined) {
      await writeFile(statusPath, `${JSON.stringify(status)}\n`, { flag: "wx" });
    }
    process.stdout.write(`${JSON.stringify(status)}\n`);
    if (stopRequested) await app.stop();
    await app.closed;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    if (app !== undefined && app.getPhase() !== "stopped") await app.stop();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});
