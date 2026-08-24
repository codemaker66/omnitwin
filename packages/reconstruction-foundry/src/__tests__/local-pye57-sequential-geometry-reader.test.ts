import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_E57_GEOMETRY_CHECKPOINT_FORMAT,
  FOUNDRY_E57_GEOMETRY_INVOCATION_V0,
  FOUNDRY_E57_GEOMETRY_OPERATION,
  FOUNDRY_E57_GEOMETRY_OPERATION_VERSION,
  computeFoundryE57GeometryInputCompatibilitySha256,
  runFoundryE57GeometryWorker,
  type FoundryE57GeometryInvocationV0,
  type FoundryE57GeometryReader,
} from "../e57-geometry-worker.js";
import { FoundryIntegrityError } from "../errors.js";
import { sha256RegularFile } from "../hash.js";
import { createFoundryLocalPye57SequentialGeometryReader } from "../local-pye57-sequential-geometry-reader.js";

const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const DIGEST_1 = `sha256:${"1".repeat(64)}`;

const pythonProbe = spawnSync(
  "python",
  ["-I", "-c", "import sys; print(sys.executable)"],
  { encoding: "utf8", windowsHide: true },
);
const LOCAL_PYTHON_EXECUTABLE =
  pythonProbe.status === 0 && pythonProbe.stdout.trim().length > 0
    ? pythonProbe.stdout.trim()
    : null;
const BRIDGE_SCRIPT = resolve(
  import.meta.dirname,
  "../../../../tools/reconstruction-foundry/python/e57_geometry_bridge.py",
);
const FIXTURE_SCRIPT = resolve(
  import.meta.dirname,
  "../../../../tools/reconstruction-foundry/python/create_tiny_e57_fixture.py",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fileSha256(path: string): Promise<string> {
  const digest = await sha256RegularFile(path);
  return `sha256:${digest.sha256}`;
}

function source(input: {
  readonly sizeBytes: number;
  readonly sha256: string;
}): FoundryE57GeometryInvocationV0["source"] {
  return {
    assetId: "sequential-e57-fixture",
    relativePath: "capture/tiny.e57",
    inputType: "generic_e57",
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
  };
}

function invocation(input: {
  readonly source: FoundryE57GeometryInvocationV0["source"];
  readonly maximumInputPoints?: number;
  readonly maximumOutputPoints?: number;
  readonly crop?: FoundryE57GeometryInvocationV0["crop"];
}): FoundryE57GeometryInvocationV0 {
  const crop =
    input.crop ??
    ({
      frame: "e57_root" as const,
      units: "metre" as const,
      minimum: [-1_000, -1_000, -1_000] as [number, number, number],
      maximum: [1_000, 1_000, 1_000] as [number, number, number],
      boundary: "inclusive" as const,
    } satisfies FoundryE57GeometryInvocationV0["crop"]);
  const limits = {
    maximumInputPoints: input.maximumInputPoints ?? 100,
    maximumOutputPoints: input.maximumOutputPoints ?? 100,
    maximumBatchPoints: 65_536 as const,
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
      source: input.source,
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

async function expectCode(
  operation: Promise<unknown>,
  code: string,
): Promise<FoundryIntegrityError> {
  try {
    await operation;
    throw new Error(`Expected ${code}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    const integrityFailure = error as FoundryIntegrityError;
    expect(integrityFailure.code).toBe(code);
    return integrityFailure;
  }
}

async function expectOneOfCodes(
  operation: Promise<unknown>,
  codes: readonly string[],
): Promise<FoundryIntegrityError> {
  try {
    await operation;
    throw new Error(`Expected one of ${codes.join(", ")}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    const integrityFailure = error as FoundryIntegrityError;
    expect(codes).toContain(integrityFailure.code);
    return integrityFailure;
  }
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function generatedFixture(input: {
  readonly mode: "single" | "multi_scan" | "batch_boundary";
}): Promise<{
  readonly root: string;
  readonly sourcePath: string;
  readonly exactSource: FoundryE57GeometryInvocationV0["source"];
}> {
  if (LOCAL_PYTHON_EXECUTABLE === null) {
    throw new Error("local Python is unavailable");
  }
  const root = await mkdtemp(join(tmpdir(), "venviewer-e57-stream-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, "tiny.e57");
  const created = spawnSync(
    LOCAL_PYTHON_EXECUTABLE,
    [
      FIXTURE_SCRIPT,
      sourcePath,
      ...(input.mode === "multi_scan"
        ? ["--multi-scan"]
        : input.mode === "batch_boundary"
          ? ["--batch-boundary"]
          : []),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (created.status !== 0) {
    throw new Error(`fixture generation failed: ${created.stderr}`);
  }
  const bytes = await readFile(sourcePath);
  expect(bytes.subarray(0, 8).toString("ascii")).toBe("ASTM-E57");
  return {
    root,
    sourcePath,
    exactSource: source({ sizeBytes: bytes.length, sha256: sha256(bytes) }),
  };
}

type FakeBridgeBehavior =
  | "cancel_after_first"
  | "exit_after_next"
  | "malformed_batch"
  | "bad_terminal_source"
  | "wrong_request_nonce"
  | "unsolicited_partial_before_next"
  | "extra_after_terminal"
  | "bad_pose_description"
  | "bad_field_description"
  | "bad_count_description";

function fakeBridgeSource(input: {
  readonly behavior: FakeBridgeBehavior;
  readonly processIdPath: string;
  readonly commandLogPath: string;
}): string {
  const behavior = JSON.stringify(input.behavior);
  const processIdPath = JSON.stringify(input.processIdPath);
  const commandLogPath = JSON.stringify(input.commandLogPath);
  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "import sys",
    `BEHAVIOR = ${behavior}`,
    `PID_PATH = Path(${processIdPath})`,
    `COMMAND_LOG = Path(${commandLogPath})`,
    "PID_PATH.write_text(str(os.getpid()), encoding='ascii')",
    "def arg(name):",
    "    return sys.argv[sys.argv.index(name) + 1]",
    "def emit(value):",
    "    sys.stdout.write(json.dumps(value, separators=(',', ':'), sort_keys=True) + '\\n')",
    "    sys.stdout.flush()",
    "pose = {'rotationWxyz': [1.0, 0.0, 0.0, 0.0], 'translationM': [0.0, 0.0, 0.0]}",
    "fields = ['cartesianInvalidState', 'cartesianX', 'cartesianY', 'cartesianZ']",
    "if BEHAVIOR == 'bad_pose_description': pose = {'rotationWxyz': [2.0, 0.0, 0.0, 0.0], 'translationM': [0.0, 0.0, 0.0]}",
    "if BEHAVIOR == 'bad_field_description': fields = ['cartesianX', 'cartesianY']",
    "scans = [",
    "    {'scanIndex': 0, 'data3dGuid': '{fake-scan-0}', 'pointCount': 1, 'pointFields': fields, 'pose': pose},",
    "    {'scanIndex': 1, 'data3dGuid': '{fake-scan-1}', 'pointCount': 1, 'pointFields': ['cartesianX', 'cartesianY', 'cartesianZ'], 'pose': {'rotationWxyz': [1.0, 0.0, 0.0, 0.0], 'translationM': [0.0, 0.0, 0.0]}},",
    "]",
    "total = 3 if BEHAVIOR == 'bad_count_description' else 2",
    "emit({",
    "    'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0',",
    "    'messageType': 'description',",
    "    'sequence': 0,",
    "    'sourceBefore': {'sizeBytes': int(arg('--expected-size')), 'sha256': arg('--expected-sha256')},",
    "    'bridge': {'sizeBytes': int(arg('--expected-bridge-size')), 'sha256': arg('--expected-bridge-sha256')},",
    "    'interpreter': {'sizeBytes': int(arg('--expected-python-size')), 'sha256': arg('--expected-python-sha256')},",
    "    'adapterVersion': '0.4.19', 'numpyVersion': '2.4.2', 'pythonVersion': sys.version.split()[0],",
    "    'batchPoints': 65536, 'scans': scans, 'totalPointCount': total,",
    "    'readPolicy': {'pointPayload': 'cartesian_fields_only', 'imageDecoderAccess': False, 'imageExtraction': False, 'network': 'none', 'modelInference': 'none', 'modelTraining': 'none'},",
    "})",
    "if BEHAVIOR in ('bad_pose_description', 'bad_field_description', 'bad_count_description'):",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "if BEHAVIOR == 'unsolicited_partial_before_next':",
    "    payload = {'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0', 'messageType': 'batch', 'sequence': 1, 'requestNonce': '0' * 64, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 0, 'data3dGuid': '{fake-scan-0}', 'startPointIndex': 0, 'points': [{'x': 0, 'y': 0, 'z': 0, 'cartesianInvalidState': 0}], 'terminal': None}",
    "    sys.stdout.write(json.dumps(payload, separators=(',', ':'), sort_keys=True))",
    "    sys.stdout.flush()",
    "    premature_command = sys.stdin.readline()",
    "    if premature_command: COMMAND_LOG.write_text(premature_command, encoding='utf8')",
    "    sys.stdout.write('\\n')",
    "    sys.stdout.flush()",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "line = sys.stdin.readline()",
    "COMMAND_LOG.write_text(line, encoding='utf8')",
    "first_command = json.loads(line)",
    "first_nonce = first_command['requestNonce']",
    "if BEHAVIOR == 'exit_after_next': sys.exit(7)",
    "if BEHAVIOR == 'malformed_batch':",
    "    payload = {'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0', 'messageType': 'batch', 'sequence': 1, 'requestNonce': first_nonce, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 0, 'data3dGuid': '{fake-scan-0}', 'startPointIndex': 0, 'points': [{'x': 0, 'y': 0, 'z': 0, 'cartesianInvalidState': 0}], 'terminal': None}",
    "    encoded = json.dumps(payload, separators=(',', ':'), sort_keys=True).replace('\\\"x\\\":0', '\\\"x\\\":1e309')",
    "    sys.stdout.write(encoded + '\\n')",
    "    sys.stdout.flush()",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "if BEHAVIOR == 'wrong_request_nonce': first_nonce = '0' * 64",
    "emit({'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0', 'messageType': 'batch', 'sequence': 1, 'requestNonce': first_nonce, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 0, 'data3dGuid': '{fake-scan-0}', 'startPointIndex': 0, 'points': [{'x': 0, 'y': 0, 'z': 0, 'cartesianInvalidState': 0}], 'terminal': None})",
    "second = sys.stdin.readline()",
    "if second: COMMAND_LOG.write_text(line + second, encoding='utf8')",
    "second_command = json.loads(second) if second else None",
    "second_nonce = second_command['requestNonce'] if second_command else ('0' * 64)",
    "if BEHAVIOR == 'bad_terminal_source':",
    "    emit({'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0', 'messageType': 'batch', 'sequence': 2, 'requestNonce': second_nonce, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 1, 'data3dGuid': '{fake-scan-1}', 'startPointIndex': 0, 'points': [{'x': 1, 'y': 1, 'z': 1, 'cartesianInvalidState': 0}], 'terminal': {'sourceAfter': {'sizeBytes': int(arg('--expected-size')), 'sha256': 'sha256:' + ('0' * 64)}, 'totalPointCount': 2, 'emittedPointCount': 2, 'batchCount': 2}})",
    "if BEHAVIOR == 'extra_after_terminal':",
    "    emit({'protocolVersion': 'omnitwin.foundry.e57-sequential-stream.v0', 'messageType': 'batch', 'sequence': 2, 'requestNonce': second_nonce, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 1, 'data3dGuid': '{fake-scan-1}', 'startPointIndex': 0, 'points': [{'x': 1, 'y': 1, 'z': 1, 'cartesianInvalidState': 0}], 'terminal': {'sourceAfter': {'sizeBytes': int(arg('--expected-size')), 'sha256': arg('--expected-sha256')}, 'totalPointCount': 2, 'emittedPointCount': 2, 'batchCount': 2}})",
    "    emit({'unexpected': 'post-terminal-record'})",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "sys.stdin.readline()",
    "",
  ].join("\n");
}

async function fakeBridgeFixture(
  behavior: FakeBridgeBehavior,
): Promise<{
  readonly sourcePath: string;
  readonly exactSource: FoundryE57GeometryInvocationV0["source"];
  readonly bridgeScriptPath: string;
  readonly bridgeSha256: string;
  readonly processIdPath: string;
  readonly commandLogPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-e57-fake-stream-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, "capture.e57");
  const sourceBytes = Buffer.from("ASTM-E57 fake bounded stream", "ascii");
  await writeFile(sourcePath, sourceBytes);
  const processIdPath = join(root, "child.pid");
  const commandLogPath = join(root, "commands.ndjson");
  const bridgeScriptPath = join(root, "fake_stream_bridge.py");
  const bridgeBytes = Buffer.from(
    fakeBridgeSource({ behavior, processIdPath, commandLogPath }),
    "utf8",
  );
  await writeFile(bridgeScriptPath, bridgeBytes);
  return {
    sourcePath,
    exactSource: source({
      sizeBytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
    }),
    bridgeScriptPath,
    bridgeSha256: sha256(bridgeBytes),
    processIdPath,
    commandLogPath,
  };
}

async function readerOptions(input: {
  readonly sourcePath: string;
  readonly bridgeScriptPath: string;
  readonly bridgeSha256: string;
  readonly commandDeadlineMs?: number;
  readonly onProcessStarted?: (processId: number) => void;
}): Promise<Parameters<
  typeof createFoundryLocalPye57SequentialGeometryReader
>[0]> {
  if (LOCAL_PYTHON_EXECUTABLE === null) {
    throw new Error("local Python is unavailable");
  }
  return {
    sourcePath: input.sourcePath,
    bridgeScriptPath: input.bridgeScriptPath,
    expectedBridgeArtifactSha256: input.bridgeSha256,
    pythonExecutable: LOCAL_PYTHON_EXECUTABLE,
    expectedPythonExecutableSha256: await fileSha256(
      LOCAL_PYTHON_EXECUTABLE,
    ),
    commandDeadlineMs: input.commandDeadlineMs,
    onProcessStarted: input.onProcessStarted,
  };
}

function observeReaderClose(reader: FoundryE57GeometryReader): {
  readonly reader: FoundryE57GeometryReader;
  readonly closeCount: () => number;
} {
  let closeCount = 0;
  return {
    reader: {
      describe: (input) => reader.describe(input),
      readBatch: (input) => reader.readBatch(input),
      close: async () => {
        closeCount += 1;
        await reader.close?.();
      },
    },
    closeCount: () => closeCount,
  };
}

describe("persistent sequential local pye57 reader", () => {
  it("opens one generated multi-scan ASTM E57 once and emits ordered bounded batches with terminal source identity", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedFixture({ mode: "multi_scan" });
    const processIds: number[] = [];
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: BRIDGE_SCRIPT,
          bridgeSha256: await fileSha256(BRIDGE_SCRIPT),
          onProcessStarted: (processId) => {
            processIds.push(processId);
          },
        }),
      ),
    );

    const result = await runFoundryE57GeometryWorker({
      invocation: invocation({ source: fixture.exactSource }),
      reader: observed.reader,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(processIds).toHaveLength(1);
    expect(observed.closeCount()).toBe(1);
    expect(processExists(processIds[0]!)).toBe(false);
    expect(result.artifact.readerDescription.scans).toHaveLength(2);
    expect(
      result.artifact.readerDescription.scans.map((scan) => scan.pointCount),
    ).toEqual([5, 3]);
    expect(result.artifact.readerDescription.adapter).toMatchObject({
      name: "pye57_persistent_sequential",
      version: "0.4.19",
      pythonExecutableSha256: await fileSha256(LOCAL_PYTHON_EXECUTABLE),
    });
    expect(result.artifact.readerDescription.readPolicy).toMatchObject({
      batchAccess: "persistent_sequential_bounded_buffer",
      fullContainerBytesHashed: true,
      imageDecoderAccess: false,
      imageExtraction: false,
      network: "none",
    });
    expect(result.artifact.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "persistent adapter avoids that replay only within one uninterrupted run",
        ),
        expect.stringContaining(
          "persistent adapter hashes before opening and after closing one uninterrupted stream session",
        ),
      ]),
    );
    expect(result.artifact.pointCounts).toEqual({
      source: 8,
      processed: 8,
      invalid: 1,
      croppedOut: 0,
      accepted: 7,
    });
    expect(
      result.artifact.points.map((point) => [
        point.scanIndex,
        point.sourcePointIndex,
      ]),
    ).toEqual([
      [0, 0],
      [0, 1],
      [0, 3],
      [0, 4],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  }, 30_000);

  it("round-trips one genuine 65,537-point scan as fixed 65,536 and 1 point batches", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedFixture({ mode: "batch_boundary" });
    const processIds: number[] = [];
    const reader = createFoundryLocalPye57SequentialGeometryReader(
      await readerOptions({
        sourcePath: fixture.sourcePath,
        bridgeScriptPath: BRIDGE_SCRIPT,
        bridgeSha256: await fileSha256(BRIDGE_SCRIPT),
        onProcessStarted: (processId) => {
          processIds.push(processId);
        },
      }),
    );
    const result = await runFoundryE57GeometryWorker({
      invocation: invocation({
        source: fixture.exactSource,
        maximumInputPoints: 70_000,
        maximumOutputPoints: 1,
        crop: {
          frame: "e57_root",
          units: "metre",
          minimum: [-10, -10, -10],
          maximum: [-1, -1, -1],
          boundary: "inclusive",
        },
      }),
      reader,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.checkpoint.committedBatchCount).toBe(2);
    expect(result.checkpoint.processedPointCount).toBe(65_537);
    expect(result.artifact.readerDescription.scans).toMatchObject([
      { scanIndex: 0, pointCount: 65_537 },
    ]);
    expect(result.artifact.pointCounts).toEqual({
      source: 65_537,
      processed: 65_537,
      invalid: 0,
      croppedOut: 65_537,
      accepted: 0,
    });
    expect(processIds).toHaveLength(1);
    expect(processExists(processIds[0]!)).toBe(false);
  }, 60_000);

  it("kills and waits for the child before rejecting malformed non-finite point protocol", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("malformed_batch");
    let processId: number | null = null;
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
          onProcessStarted: (value) => {
            processId = value;
          },
        }),
      ),
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader: observed.reader,
      }),
      "E57_PYE57_STREAM_BATCH_INVALID",
    );
    const recordedProcessId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(processId).toBe(recordedProcessId);
    expect(observed.closeCount()).toBe(1);
    expect(processExists(recordedProcessId)).toBe(false);
  });

  it("observes child exit before rejecting a missing commanded batch", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("exit_after_next");
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      ),
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader: observed.reader,
      }),
      "E57_PYE57_STREAM_CHILD_EXITED",
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(observed.closeCount()).toBe(1);
    expect(processExists(processId)).toBe(false);
  });

  it("binds each commanded batch to an unpredictable per-command nonce", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("wrong_request_nonce");
    const reader = createFoundryLocalPye57SequentialGeometryReader(
      await readerOptions({
        sourcePath: fixture.sourcePath,
        bridgeScriptPath: fixture.bridgeScriptPath,
        bridgeSha256: fixture.bridgeSha256,
      }),
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader,
      }),
      "E57_PYE57_STREAM_BATCH_BINDING_MISMATCH",
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(processExists(processId)).toBe(false);
  });

  it("rejects unsolicited partial stdout emitted before next and waits for child close", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture(
      "unsolicited_partial_before_next",
    );
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      ),
    );

    await expectOneOfCodes(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader: observed.reader,
      }),
      [
        "E57_PYE57_STREAM_UNSOLICITED_BYTES",
        "E57_PYE57_STREAM_UNSOLICITED_RECORD",
        "E57_PYE57_STREAM_BATCH_BINDING_MISMATCH",
      ],
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(observed.closeCount()).toBe(1);
    expect(processExists(processId)).toBe(false);
  });

  it("rejects extra stdout after terminal and waits for child close", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("extra_after_terminal");
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      ),
    );

    await expectOneOfCodes(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader: observed.reader,
      }),
      [
        "E57_PYE57_STREAM_UNSOLICITED_BYTES",
        "E57_PYE57_STREAM_UNSOLICITED_RECORD",
      ],
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(observed.closeCount()).toBe(1);
    expect(processExists(processId)).toBe(false);
  });

  it("rejects a terminal record whose post-read source identity drifted", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("bad_terminal_source");
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      ),
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader: observed.reader,
      }),
      "E57_PYE57_STREAM_TERMINAL_MISMATCH",
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(observed.closeCount()).toBe(1);
    expect(processExists(processId)).toBe(false);
  });

  it("closes after checkpoint cancellation without issuing another next command", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("cancel_after_first");
    const controller = new AbortController();
    const observed = observeReaderClose(
      createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      ),
    );

    const result = await runFoundryE57GeometryWorker({
      invocation: invocation({ source: fixture.exactSource }),
      reader: observed.reader,
      signal: controller.signal,
      onCheckpoint: () => {
        controller.abort();
      },
    });

    expect(result.status).toBe("cancelled");
    expect(observed.closeCount()).toBe(1);
    expect((await readFile(fixture.commandLogPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(processExists(processId)).toBe(false);
  });

  it("kills and waits at the bounded total-session deadline", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("cancel_after_first");
    const reader = createFoundryLocalPye57SequentialGeometryReader(
      await readerOptions({
        sourcePath: fixture.sourcePath,
        bridgeScriptPath: fixture.bridgeScriptPath,
        bridgeSha256: fixture.bridgeSha256,
        commandDeadlineMs: 300,
      }),
    );

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader,
      }),
      "E57_PYE57_STREAM_DEADLINE_EXCEEDED",
    );
    const processId = Number.parseInt(
      await readFile(fixture.processIdPath, "utf8"),
      10,
    );
    expect(processExists(processId)).toBe(false);
  });

  it.each([
    ["bad_pose_description", "E57_PYE57_STREAM_DESCRIPTION_INVALID"],
    ["bad_field_description", "E57_PYE57_STREAM_DESCRIPTION_INVALID"],
    ["bad_count_description", "E57_PYE57_STREAM_DESCRIPTION_MISMATCH"],
  ] as const)(
    "fails closed for %s and rejects only after child close",
    async (behavior, code) => {
      if (LOCAL_PYTHON_EXECUTABLE === null) return;
      const fixture = await fakeBridgeFixture(behavior);
      const reader = createFoundryLocalPye57SequentialGeometryReader(
        await readerOptions({
          sourcePath: fixture.sourcePath,
          bridgeScriptPath: fixture.bridgeScriptPath,
          bridgeSha256: fixture.bridgeSha256,
        }),
      );

      await expectCode(
        runFoundryE57GeometryWorker({
          invocation: invocation({ source: fixture.exactSource }),
          reader,
        }),
        code,
      );
      const processId = Number.parseInt(
        await readFile(fixture.processIdPath, "utf8"),
        10,
      );
      expect(processExists(processId)).toBe(false);
    },
  );

  it("refuses a non-pinned interpreter identity before process launch", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("exit_after_next");
    let spawnCount = 0;
    const reader = createFoundryLocalPye57SequentialGeometryReader({
      sourcePath: fixture.sourcePath,
      bridgeScriptPath: fixture.bridgeScriptPath,
      expectedBridgeArtifactSha256: fixture.bridgeSha256,
      pythonExecutable: LOCAL_PYTHON_EXECUTABLE,
      expectedPythonExecutableSha256: DIGEST_C,
      onProcessStarted: () => {
        spawnCount += 1;
      },
    });

    await expectCode(
      runFoundryE57GeometryWorker({
        invocation: invocation({ source: fixture.exactSource }),
        reader,
      }),
      "E57_PYE57_STREAM_PYTHON_IDENTITY_MISMATCH",
    );
    expect(spawnCount).toBe(0);
  });

  it("serializes opening lifecycle and lets close cancel and await an in-flight start", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await fakeBridgeFixture("exit_after_next");
    let spawnCount = 0;
    const reader = createFoundryLocalPye57SequentialGeometryReader(
      await readerOptions({
        sourcePath: fixture.sourcePath,
        bridgeScriptPath: fixture.bridgeScriptPath,
        bridgeSha256: fixture.bridgeSha256,
        onProcessStarted: () => {
          spawnCount += 1;
        },
      }),
    );
    const exactInvocation = invocation({ source: fixture.exactSource });
    const description = reader.describe({
      source: exactInvocation.source,
      maximumInputPoints: exactInvocation.limits.maximumInputPoints,
      maximumScans: exactInvocation.limits.maximumScans,
    });
    const concurrentDescription = expectCode(
      reader.describe({
        source: exactInvocation.source,
        maximumInputPoints: exactInvocation.limits.maximumInputPoints,
        maximumScans: exactInvocation.limits.maximumScans,
      }),
      "E57_PYE57_STREAM_RUN_ALREADY_ACTIVE",
    );
    const cancelledOpening = expectCode(
      description,
      "E57_GEOMETRY_CANCELLED",
    );

    if (reader.close === undefined) throw new Error("expected reader close");
    await Promise.all([reader.close(), concurrentDescription, cancelledOpening]);
    expect(spawnCount).toBe(0);
  });
});
