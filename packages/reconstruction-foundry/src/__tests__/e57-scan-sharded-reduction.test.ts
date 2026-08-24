import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "../canonical-json.js";
import {
  FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_FORMAT,
  FOUNDRY_E57_SCAN_REDUCTION_OPERATION,
  FOUNDRY_E57_SCAN_REDUCTION_OPERATION_VERSION,
  FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0,
  FOUNDRY_E57_SCAN_SHARDED_REDUCTION_INVOCATION_V0,
  FoundryE57ScanShardedReductionInvocationV0Schema,
  FoundryE57ScanReductionMemberV0Schema,
  computeFoundryE57ScanReductionInputCompatibilitySha256,
  computeFoundryE57ScanShardedReductionInvocationSha256,
  runFoundryE57ScanShardedReduction,
  sealFoundryE57ScanShardedReaderDescriptionV0,
  type FoundryE57RawReducedScanV0,
  type FoundryE57ScanReductionMemberStore,
  type FoundryE57ScanReductionReader,
  type FoundryE57ScanShardedReaderDescriptionV0,
  type FoundryE57ScanShardedReductionInvocationV0,
} from "../e57-scan-sharded-reduction.js";
import { FoundryIntegrityError } from "../errors.js";
import { sha256RegularFile } from "../hash.js";
import { createFoundryLocalPye57ScanShardedReducer } from "../local-pye57-sequential-geometry-reader.js";

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

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(stableCanonicalJson(toCanonicalJson(value)), "utf8");
}

function resealStoredMember(
  member: ReturnType<typeof FoundryE57ScanReductionMemberV0Schema.parse>,
  changes: Readonly<Record<string, unknown>>,
): Buffer {
  const { memberSha256: _memberSha256, ...originalMaterial } = member;
  const material = { ...originalMaterial, ...changes };
  const resealed = {
    ...material,
    memberSha256: `sha256:${domainSeparatedSha256(
      "VENVIEWER_FOUNDRY_E57_SCAN_REDUCTION_MEMBER_V0",
      toCanonicalJson(material),
    )}`,
  };
  return canonicalBytes(resealed);
}

async function fileSha256(path: string): Promise<string> {
  const digest = await sha256RegularFile(path);
  return `sha256:${digest.sha256}`;
}

function source(input: {
  readonly sizeBytes?: number;
  readonly sha256?: string;
} = {}): FoundryE57ScanShardedReductionInvocationV0["source"] {
  return {
    assetId: "scan-sharded-e57-fixture",
    relativePath: "capture/tiny.e57",
    inputType: "generic_e57",
    sizeBytes: input.sizeBytes ?? 1_024,
    sha256: input.sha256 ?? DIGEST_B,
  };
}

function invocation(input: {
  readonly source?: FoundryE57ScanShardedReductionInvocationV0["source"];
  readonly maximumRepresentativesPerScan?: number;
  readonly maximumTotalRepresentatives?: number;
  readonly maximumInputPoints?: number;
  readonly maximumScans?: number;
  readonly crop?: FoundryE57ScanShardedReductionInvocationV0["crop"];
  readonly voxelSizeM?: number;
} = {}): FoundryE57ScanShardedReductionInvocationV0 {
  const exactSource = input.source ?? source();
  const crop = input.crop ?? {
    frame: "e57_root" as const,
    units: "metre" as const,
    minimum: [0, 2, 4] as [number, number, number],
    maximum: [12, 23, 33] as [number, number, number],
    boundary: "inclusive" as const,
  };
  const voxelPolicy = {
    kind: "fixed_metric_grid_first_source_point" as const,
    voxelSizeM: input.voxelSizeM ?? 2,
    originM: [10, 20, 30] as [number, number, number],
    indexRule: "ieee754_binary64_floor_toward_negative_infinity" as const,
    representativeRule:
      "first_valid_crop_point_in_source_order" as const,
    outputOrder: "source_point_index_ascending" as const,
  };
  const limits = {
    maximumInputPoints: input.maximumInputPoints ?? 100,
    maximumScans: input.maximumScans ?? 10,
    internalBatchPoints: 65_536 as const,
    maximumRepresentativesPerScan:
      input.maximumRepresentativesPerScan ?? 10,
    maximumTotalRepresentatives: input.maximumTotalRepresentatives ?? 20,
  };
  const coordinateContract = {
    inputPointFrame: "e57_data3d_local_cartesian" as const,
    scanPoseConvention:
      "normalized_quaternion_wxyz_then_translation_metres" as const,
    reductionFrame: "e57_root" as const,
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
  const persistenceContract = {
    memberCommit: "caller_supplied_create_only_then_exact_reread" as const,
    memberRewrite: "forbidden" as const,
    completedPrefix: "contiguous_scan_order_only" as const,
    resumeRead: "restart_current_scan_from_source_point_zero" as const,
    sourceResumeIdentity:
      "full_sha256_before_each_session_and_after_clean_terminal" as const,
    storeCustody: "caller_supplied_unverified" as const,
    executorAuthentication: "not_established" as const,
    fenceOwnership: "not_established" as const,
    activation: false as const,
  };
  const inputCompatibilitySha256 =
    computeFoundryE57ScanReductionInputCompatibilitySha256({
      source: exactSource,
      sourceFactsArtifactSha256: DIGEST_C,
      crop,
      voxelPolicy,
      limits,
      coordinateContract,
      contentPolicy,
      persistenceContract,
    });
  return {
    schemaVersion: FOUNDRY_E57_SCAN_SHARDED_REDUCTION_INVOCATION_V0,
    operation: FOUNDRY_E57_SCAN_REDUCTION_OPERATION,
    operationVersion: FOUNDRY_E57_SCAN_REDUCTION_OPERATION_VERSION,
    executionMode: "local_dependency_injected_authority_none",
    source: exactSource,
    sourceFactsArtifactSha256: DIGEST_C,
    crop,
    voxelPolicy,
    limits,
    coordinateContract,
    contentPolicy,
    persistenceContract,
    checkpointContract: {
      format: FOUNDRY_E57_SCAN_REDUCTION_CHECKPOINT_FORMAT,
      formatVersion: "v0",
      stageId: FOUNDRY_E57_SCAN_REDUCTION_OPERATION,
      workerImageSha256: DIGEST_D,
      recipeSha256: DIGEST_E,
      stageGraphSha256: DIGEST_F,
      ingestManifestSha256: DIGEST_1,
      checkpointCommandSha256: DIGEST_B,
      inputCompatibilitySha256,
    },
    networkAccess: "none",
    imageDecoderAccess: "none",
    imageExtraction: "none",
    modelInference: "none",
    modelTraining: "none",
    authority: "none",
    activation: false,
  };
}

class MemoryMemberStore implements FoundryE57ScanReductionMemberStore {
  description: Buffer | null = null;
  readonly members = new Map<number, Buffer>();
  readonly memberCreateCalls: number[] = [];
  listOverride: readonly number[] | null = null;
  descriptionCreateResult: "created" | "existing" = "created";
  memberCreateResult: "created" | "existing" = "created";
  corruptMemberReread = false;

  readReaderDescription(): Promise<Uint8Array | null> {
    return Promise.resolve(
      this.description === null ? null : Buffer.from(this.description),
    );
  }

  createReaderDescription(
    canonicalBytes: Uint8Array,
  ): Promise<"created" | "existing"> {
    if (this.descriptionCreateResult === "created") {
      this.description = Buffer.from(canonicalBytes);
    }
    return Promise.resolve(this.descriptionCreateResult);
  }

  listCommittedScanIndices(): Promise<readonly number[]> {
    return Promise.resolve(this.listOverride ?? [...this.members.keys()]);
  }

  readCommittedScanMember(
    scanIndex: number,
  ): Promise<Uint8Array | null> {
    const member = this.members.get(scanIndex);
    if (member === undefined) return Promise.resolve(null);
    const copy = Buffer.from(member);
    if (this.corruptMemberReread && copy.length > 0) {
      copy[0] = (copy[0] ?? 0) ^ 1;
    }
    return Promise.resolve(copy);
  }

  createCommittedScanMember(input: {
    readonly scanIndex: number;
    readonly canonicalBytes: Uint8Array;
    readonly memberSha256: string;
  }): Promise<"created" | "existing"> {
    this.memberCreateCalls.push(input.scanIndex);
    if (this.memberCreateResult === "created") {
      this.members.set(input.scanIndex, Buffer.from(input.canonicalBytes));
    }
    return Promise.resolve(this.memberCreateResult);
  }
}

function fixtureDescription(
  exactInvocation: FoundryE57ScanShardedReductionInvocationV0,
): FoundryE57ScanShardedReaderDescriptionV0 {
  return sealFoundryE57ScanShardedReaderDescriptionV0({
    schemaVersion: FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0,
    invocationSha256:
      computeFoundryE57ScanShardedReductionInvocationSha256(exactInvocation),
    inputCompatibilitySha256:
      exactInvocation.checkpointContract.inputCompatibilitySha256,
    source: exactInvocation.source,
    adapter: {
      name: "pye57_persistent_scan_sharded_reducer",
      version: "0.4.19",
      bridgeArtifactSha256: DIGEST_B,
      pythonExecutableSha256: DIGEST_C,
      pythonExecutableSizeBytes: 1,
      pythonVersion: "3.13.0",
      numpyVersion: "2.4.2",
      identityAuthority: "caller_supplied_unverified",
    },
    readPolicy: {
      sourceAccess: "read_only_pre_and_clean_terminal_sha256",
      scanAccess: "direct_scan_reader_sequential_from_source_point_zero",
      rawPointTransport: "kept_inside_pinned_python_bridge",
      emittedPayload: "bounded_reduced_representatives_only",
      imageDecoderAccess: false,
      imageExtraction: false,
      network: "none",
      modelInference: "none",
      modelTraining: "none",
    },
    crop: exactInvocation.crop,
    voxelPolicy: exactInvocation.voxelPolicy,
    limits: exactInvocation.limits,
    coordinateContract: exactInvocation.coordinateContract,
    scans: [
      {
        scanIndex: 0,
        data3dGuid: "{fixture-scan-0}",
        pointCount: 2,
        pointFields: ["cartesianX", "cartesianY", "cartesianZ"],
        pose: {
          rotationWxyz: [1, 0, 0, 0],
          translationM: [0, 0, 0],
        },
      },
      {
        scanIndex: 1,
        data3dGuid: "{fixture-scan-1}",
        pointCount: 2,
        pointFields: ["cartesianX", "cartesianY", "cartesianZ"],
        pose: {
          rotationWxyz: [1, 0, 0, 0],
          translationM: [0, 0, 0],
        },
      },
    ],
    totalPointCount: 4,
    authority: "none",
    activation: false,
  });
}

function eightPointDescription(
  exactInvocation: FoundryE57ScanShardedReductionInvocationV0,
): FoundryE57ScanShardedReaderDescriptionV0 {
  const base = fixtureDescription(exactInvocation);
  const {
    readerDescriptionSha256: _readerDescriptionSha256,
    ...baseMaterial
  } = base;
  return sealFoundryE57ScanShardedReaderDescriptionV0({
    ...baseMaterial,
    scans: [
      {
        scanIndex: 0,
        data3dGuid: "{fixture-scan-eight}",
        pointCount: 8,
        pointFields: ["cartesianX", "cartesianY", "cartesianZ"],
        pose: {
          rotationWxyz: [1, 0, 0, 0],
          translationM: [0, 0, 0],
        },
      },
    ],
    totalPointCount: 8,
  });
}

function eightPointRawScan(
  exactInvocation: FoundryE57ScanShardedReductionInvocationV0,
): FoundryE57RawReducedScanV0 {
  return {
    sourceSha256: exactInvocation.source.sha256,
    scanIndex: 0,
    data3dGuid: "{fixture-scan-eight}",
    counts: {
      source: 8,
      processed: 8,
      invalid: 0,
      croppedOut: 0,
      validInsideCrop: 8,
      representatives: 8,
    },
    points: [
      [0, -5, -9, -13, 0, 2, 4],
      [1, -4, -9, -13, 2, 2, 4],
      [2, -3, -9, -13, 4, 2, 4],
      [3, -2, -9, -13, 6, 2, 4],
      [4, -1, -9, -13, 8, 2, 4],
      [5, 0, -9, -13, 10, 2, 4],
      [6, 1, -9, -13, 12, 2, 4],
      [7, 1, -8, -13, 12, 4, 4],
    ],
    terminalSourceAfter: {
      sizeBytes: exactInvocation.source.sizeBytes,
      sha256: exactInvocation.source.sha256,
    },
  };
}

function rawScan(input: {
  readonly exactInvocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly scanIndex: 0 | 1;
  readonly empty?: boolean;
}): FoundryE57RawReducedScanV0 {
  const empty = input.empty ?? false;
  return {
    sourceSha256: input.exactInvocation.source.sha256,
    scanIndex: input.scanIndex,
    data3dGuid: `{fixture-scan-${String(input.scanIndex)}}`,
    counts: {
      source: 2,
      processed: 2,
      invalid: 0,
      croppedOut: empty ? 2 : 1,
      validInsideCrop: empty ? 0 : 1,
      representatives: empty ? 0 : 1,
    },
    points: empty
      ? []
      : [
          input.scanIndex === 0
            ? [0, 0, 0, 0, 10, 20, 30]
            : [0, -5, -9, -13, 0, 2, 4],
        ],
    terminalSourceAfter:
      input.scanIndex === 1
        ? {
            sizeBytes: input.exactInvocation.source.sizeBytes,
            sha256: input.exactInvocation.source.sha256,
          }
        : null,
  };
}

class FixtureReader implements FoundryE57ScanReductionReader {
  readonly requestedStarts: number[] = [];
  readonly requestedScans: number[] = [];
  closeCount = 0;

  constructor(
    private readonly description: FoundryE57ScanShardedReaderDescriptionV0,
    private readonly scans: readonly FoundryE57RawReducedScanV0[],
  ) {}

  describe(input: {
    readonly startScanIndex: number;
  }): Promise<unknown> {
    this.requestedStarts.push(input.startScanIndex);
    return Promise.resolve(this.description);
  }

  reduceNextScan(input: { readonly scanIndex: number }): Promise<unknown> {
    this.requestedScans.push(input.scanIndex);
    const scan = this.scans[input.scanIndex];
    if (scan === undefined) throw new Error("missing fixture scan");
    return Promise.resolve(scan);
  }

  close(): Promise<void> {
    this.closeCount += 1;
    return Promise.resolve();
  }
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
    const failure = error as FoundryIntegrityError;
    expect(failure.code).toBe(code);
    return failure;
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

async function generatedMultiScanFixture(): Promise<{
  readonly sourcePath: string;
  readonly exactSource: FoundryE57ScanShardedReductionInvocationV0["source"];
}> {
  if (LOCAL_PYTHON_EXECUTABLE === null) {
    throw new Error("local Python is unavailable");
  }
  const root = await mkdtemp(join(tmpdir(), "venviewer-e57-shards-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, "tiny.e57");
  const created = spawnSync(
    LOCAL_PYTHON_EXECUTABLE,
    [FIXTURE_SCRIPT, sourcePath, "--multi-scan"],
    { encoding: "utf8", windowsHide: true },
  );
  if (created.status !== 0) {
    throw new Error(`fixture generation failed: ${created.stderr}`);
  }
  const bytes = await readFile(sourcePath);
  expect(bytes.subarray(0, 8).toString("ascii")).toBe("ASTM-E57");
  return {
    sourcePath,
    exactSource: source({ sizeBytes: bytes.length, sha256: sha256(bytes) }),
  };
}

async function fakeReductionBridge(
  behavior:
    | "hang_after_command"
    | "oversized_null_points"
    | "wrong_adapter_version"
    | "wrong_nonce",
): Promise<{
  readonly sourcePath: string;
  readonly exactSource: FoundryE57ScanShardedReductionInvocationV0["source"];
  readonly bridgeScriptPath: string;
  readonly bridgeSha256: string;
  readonly processIdPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-e57-shard-fake-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, "fake.e57");
  const sourceBytes = Buffer.from("ASTM-E57 fake reduction stream", "ascii");
  await writeFile(sourcePath, sourceBytes);
  const processIdPath = join(root, "child.pid");
  const bridgeScriptPath = join(root, "fake_reduction_bridge.py");
  const script = [
    "import json",
    "import os",
    "from pathlib import Path",
    "import sys",
    `BEHAVIOR = ${JSON.stringify(behavior)}`,
    `Path(${JSON.stringify(processIdPath)}).write_text(str(os.getpid()), encoding='ascii')`,
    "def arg(name): return sys.argv[sys.argv.index(name) + 1]",
    "def emit(value):",
    "    sys.stdout.write(json.dumps(value, separators=(',', ':'), sort_keys=True) + '\\n')",
    "    sys.stdout.flush()",
    "pose = {'rotationWxyz': [1.0, 0.0, 0.0, 0.0], 'translationM': [0.0, 0.0, 0.0]}",
    "scan = {'scanIndex': 0, 'data3dGuid': '{fake-reduction-scan}', 'pointCount': 1, 'pointFields': ['cartesianX', 'cartesianY', 'cartesianZ'], 'pose': pose}",
    "crop = {'frame': 'e57_root', 'units': 'metre', 'minimum': [float(arg('--crop-min-x')), float(arg('--crop-min-y')), float(arg('--crop-min-z'))], 'maximum': [float(arg('--crop-max-x')), float(arg('--crop-max-y')), float(arg('--crop-max-z'))], 'boundary': 'inclusive'}",
    "voxel = {'kind': 'fixed_metric_grid_first_source_point', 'voxelSizeM': float(arg('--voxel-size')), 'originM': [float(arg('--voxel-origin-x')), float(arg('--voxel-origin-y')), float(arg('--voxel-origin-z'))], 'indexRule': 'ieee754_binary64_floor_toward_negative_infinity', 'representativeRule': 'first_valid_crop_point_in_source_order', 'outputOrder': 'source_point_index_ascending'}",
    "adapter_version = '9.9.9' if BEHAVIOR == 'wrong_adapter_version' else '0.4.19'",
    "emit({'protocolVersion': 'omnitwin.foundry.e57-scan-sharded-reduction-stream.v0', 'messageType': 'description', 'sequence': 0, 'requestedStartScanIndex': int(arg('--start-scan-index')), 'completedRepresentativeCount': int(arg('--completed-representative-count')), 'sourceBefore': {'sizeBytes': int(arg('--expected-size')), 'sha256': arg('--expected-sha256')}, 'bridge': {'sizeBytes': int(arg('--expected-bridge-size')), 'sha256': arg('--expected-bridge-sha256')}, 'interpreter': {'sizeBytes': int(arg('--expected-python-size')), 'sha256': arg('--expected-python-sha256')}, 'adapterVersion': adapter_version, 'numpyVersion': '2.4.2', 'pythonVersion': sys.version.split()[0], 'internalBatchPoints': 65536, 'scans': [scan], 'totalPointCount': 1, 'crop': crop, 'voxelPolicy': voxel, 'limits': {'maximumInputPoints': int(arg('--maximum-total-points')), 'maximumScans': int(arg('--maximum-scans')), 'internalBatchPoints': int(arg('--batch-points')), 'maximumRepresentativesPerScan': int(arg('--maximum-representatives-per-scan')), 'maximumTotalRepresentatives': int(arg('--maximum-total-representatives'))}, 'readPolicy': {'rawPointTransport': 'kept_inside_pinned_python_bridge', 'emittedPayload': 'bounded_reduced_representatives_only', 'imageDecoderAccess': False, 'imageExtraction': False, 'network': 'none', 'modelInference': 'none', 'modelTraining': 'none'}})",
    "if BEHAVIOR == 'wrong_adapter_version':",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "line = sys.stdin.readline()",
    "if BEHAVIOR == 'hang_after_command':",
    "    sys.stdin.readline()",
    "    sys.exit(0)",
    "command = json.loads(line)",
    "points = [None] * 1000000 if BEHAVIOR == 'oversized_null_points' else [[0, 0, 0, 0, 10.0, 20.0, 30.0]]",
    "emit({'protocolVersion': 'omnitwin.foundry.e57-scan-sharded-reduction-stream.v0', 'messageType': 'scan', 'sequence': 1, 'requestNonce': '0' * 64, 'sourceSha256': arg('--expected-sha256'), 'scanIndex': 0, 'data3dGuid': '{fake-reduction-scan}', 'counts': {'source': 1, 'processed': 1, 'invalid': 0, 'croppedOut': 0, 'validInsideCrop': 1, 'representatives': len(points)}, 'points': points, 'aggregateRepresentativeCount': int(arg('--completed-representative-count')) + len(points), 'terminalSourceAfter': {'sizeBytes': int(arg('--expected-size')), 'sha256': arg('--expected-sha256')}})",
    "sys.stdin.readline()",
    "",
  ].join("\n");
  const bridgeBytes = Buffer.from(script, "utf8");
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
  };
}

async function localReader(input: {
  readonly sourcePath: string;
  readonly processIds?: number[];
  readonly bridgeScriptPath?: string;
  readonly bridgeSha256?: string;
  readonly sessionDeadlineMs?: number;
}) {
  if (LOCAL_PYTHON_EXECUTABLE === null) {
    throw new Error("local Python is unavailable");
  }
  return createFoundryLocalPye57ScanShardedReducer({
    sourcePath: input.sourcePath,
    bridgeScriptPath: input.bridgeScriptPath ?? BRIDGE_SCRIPT,
    expectedBridgeArtifactSha256:
      input.bridgeSha256 ?? (await fileSha256(BRIDGE_SCRIPT)),
    pythonExecutable: LOCAL_PYTHON_EXECUTABLE,
    expectedPythonExecutableSha256: await fileSha256(
      LOCAL_PYTHON_EXECUTABLE,
    ),
    sessionDeadlineMs: input.sessionDeadlineMs,
    onProcessStarted: (processId) => input.processIds?.push(processId),
  });
}

function parseStoredMember(
  store: MemoryMemberStore,
  scanIndex: number,
) {
  const bytes = store.members.get(scanIndex);
  if (bytes === undefined) throw new Error("missing stored member");
  return FoundryE57ScanReductionMemberV0Schema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
}

describe("E57 scan-sharded reduction", () => {
  it("accepts the recorded Grand Hall source metadata without claiming a completed run", () => {
    const recorded = invocation({
      source: source({ sizeBytes: 20_518_437_888, sha256: DIGEST_B }),
      maximumInputPoints: 965_520_000,
      maximumScans: 149,
    });
    expect(
      FoundryE57ScanShardedReductionInvocationV0Schema.parse(recorded),
    ).toMatchObject({
      source: { sizeBytes: 20_518_437_888 },
      limits: {
        maximumInputPoints: 965_520_000,
        maximumScans: 149,
      },
      authority: "none",
      activation: false,
    });
  });

  it("reduces a genuine multi-scan ASTM E57 inside one bridge with exact negative and boundary voxel keys", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedMultiScanFixture();
    const exactInvocation = invocation({ source: fixture.exactSource });
    const store = new MemoryMemberStore();
    const processIds: number[] = [];
    const result = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: await localReader({
        sourcePath: fixture.sourcePath,
        processIds,
      }),
      store,
    });

    expect(result.status).toBe("succeeded");
    expect(result.checkpoint.completedMembers).toHaveLength(2);
    expect(result.checkpoint.totalRepresentativeCount).toBe(5);
    expect(result.checkpoint).toMatchObject({
      complete: true,
      nextScanIndex: null,
      storeCustody: "caller_supplied_unverified",
      executorAuthentication: "not_established",
      fenceOwnership: "not_established",
      authority: "none",
      activation: false,
    });
    expect(processIds).toHaveLength(1);
    expect(processExists(processIds[0]!)).toBe(false);

    const first = parseStoredMember(store, 0);
    expect(first.counts).toEqual({
      source: 5,
      processed: 5,
      invalid: 1,
      croppedOut: 1,
      validInsideCrop: 3,
      representatives: 3,
    });
    expect(first.points).toEqual([
      [0, -1, 0, 0, 8, 20, 30],
      [1, 0, 0, 0, 10, 21, 31],
      [3, 1, 1, 1, 12, 23, 33],
    ]);
    const second = parseStoredMember(store, 1);
    expect(second.counts).toEqual({
      source: 3,
      processed: 3,
      invalid: 0,
      croppedOut: 0,
      validInsideCrop: 3,
      representatives: 2,
    });
    expect(second.points).toEqual([
      [0, -5, -9, -13, 0, 2, 4],
      [2, -4, -8, -12, 2, 4, 6],
    ]);
  }, 30_000);

  it("cancels after one durable member and resumes at the first incomplete scan without rewriting it", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedMultiScanFixture();
    const exactInvocation = invocation({ source: fixture.exactSource });
    const store = new MemoryMemberStore();
    const firstController = new AbortController();
    const firstProcessIds: number[] = [];
    const first = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: await localReader({
        sourcePath: fixture.sourcePath,
        processIds: firstProcessIds,
      }),
      store,
      signal: firstController.signal,
      onMemberCommitted: () => {
        firstController.abort();
      },
    });
    expect(first.status).toBe("cancelled");
    expect(first.checkpoint.completedMembers).toHaveLength(1);
    const firstMemberBytes = Buffer.from(store.members.get(0)!);
    expect(processExists(firstProcessIds[0]!)).toBe(false);

    const secondProcessIds: number[] = [];
    const second = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: await localReader({
        sourcePath: fixture.sourcePath,
        processIds: secondProcessIds,
      }),
      store,
    });
    expect(second.status).toBe("succeeded");
    expect(second.checkpoint.completedMembers).toHaveLength(2);
    expect(store.memberCreateCalls).toEqual([0, 1]);
    expect(store.members.get(0)).toEqual(firstMemberBytes);
    expect(secondProcessIds).toHaveLength(1);
    expect(processExists(secondProcessIds[0]!)).toBe(false);
  }, 30_000);

  it("replays only the current incomplete scan after cancellation and preserves the completed prefix", async () => {
    const exactInvocation = invocation();
    const description = fixtureDescription(exactInvocation);
    const store = new MemoryMemberStore();
    const seedController = new AbortController();
    const seeded = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: new FixtureReader(description, [
        rawScan({ exactInvocation, scanIndex: 0 }),
        rawScan({ exactInvocation, scanIndex: 1 }),
      ]),
      store,
      signal: seedController.signal,
      onMemberCommitted: () => {
        seedController.abort();
      },
    });
    expect(seeded.status).toBe("cancelled");
    const memberZero = Buffer.from(store.members.get(0)!);
    const callsBeforeCurrentScan = [...store.memberCreateCalls];

    const currentScanController = new AbortController();
    const requestedStarts: number[] = [];
    const requestedScans: number[] = [];
    const interrupted = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: {
        describe: ({ startScanIndex }) => {
          requestedStarts.push(startScanIndex);
          return Promise.resolve(description);
        },
        reduceNextScan: ({ scanIndex }) => {
          requestedScans.push(scanIndex);
          currentScanController.abort();
          return Promise.reject(
            new FoundryIntegrityError(
              "E57_SCAN_REDUCTION_CANCELLED",
              "fixture current-scan cancellation",
            ),
          );
        },
        close: () => Promise.resolve(),
      },
      store,
      signal: currentScanController.signal,
    });
    expect(interrupted.status).toBe("cancelled");
    expect(requestedStarts).toEqual([1]);
    expect(requestedScans).toEqual([1]);
    expect(store.memberCreateCalls).toEqual(callsBeforeCurrentScan);
    expect(store.members.get(0)).toEqual(memberZero);

    const resumedReader = new FixtureReader(description, [
      rawScan({ exactInvocation, scanIndex: 0 }),
      rawScan({ exactInvocation, scanIndex: 1 }),
    ]);
    const resumed = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: resumedReader,
      store,
    });
    expect(resumed.status).toBe("succeeded");
    expect(resumedReader.requestedStarts).toEqual([1]);
    expect(resumedReader.requestedScans).toEqual([1]);
    expect(store.memberCreateCalls).toEqual([0, 1]);
    expect(store.members.get(0)).toEqual(memberZero);
  });

  it("fails closed when a genuine scan exceeds the explicit voxel representative cap", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedMultiScanFixture();
    const exactInvocation = invocation({
      source: fixture.exactSource,
      maximumRepresentativesPerScan: 1,
      maximumTotalRepresentatives: 2,
    });
    const store = new MemoryMemberStore();
    const processIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: await localReader({
          sourcePath: fixture.sourcePath,
          processIds,
        }),
        store,
      }),
      "E57_PYE57_REDUCTION_SCAN_OUTPUT_LIMIT_EXCEEDED",
    );
    expect(store.members.size).toBe(0);
    expect(processExists(processIds[0]!)).toBe(false);
  }, 30_000);

  it("commits completed scans but fails before an aggregate-cap-exhausting next scan", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const fixture = await generatedMultiScanFixture();
    const exactInvocation = invocation({
      source: fixture.exactSource,
      maximumRepresentativesPerScan: 2,
      maximumTotalRepresentatives: 2,
      voxelSizeM: 100,
    });
    const store = new MemoryMemberStore();
    const processIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: await localReader({
          sourcePath: fixture.sourcePath,
          processIds,
        }),
        store,
      }),
      "E57_PYE57_REDUCTION_AGGREGATE_OUTPUT_LIMIT_EXCEEDED",
    );
    expect(store.members.size).toBe(1);
    expect(parseStoredMember(store, 0).counts.representatives).toBe(2);
    expect(processExists(processIds[0]!)).toBe(false);
  }, 30_000);

  it("reuses nonce validation and deadline kill/wait for the reduction protocol", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const wrongNonce = await fakeReductionBridge("wrong_nonce");
    const wrongNonceIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: invocation({ source: wrongNonce.exactSource }),
        reader: await localReader({
          sourcePath: wrongNonce.sourcePath,
          bridgeScriptPath: wrongNonce.bridgeScriptPath,
          bridgeSha256: wrongNonce.bridgeSha256,
          processIds: wrongNonceIds,
        }),
        store: new MemoryMemberStore(),
      }),
      "E57_PYE57_REDUCTION_SCAN_BINDING_MISMATCH",
    );
    const wrongNonceProcessId = Number.parseInt(
      await readFile(wrongNonce.processIdPath, "utf8"),
      10,
    );
    expect(wrongNonceIds).toEqual([wrongNonceProcessId]);
    expect(processExists(wrongNonceProcessId)).toBe(false);

    const hanging = await fakeReductionBridge("hang_after_command");
    const hangingIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: invocation({ source: hanging.exactSource }),
        reader: await localReader({
          sourcePath: hanging.sourcePath,
          bridgeScriptPath: hanging.bridgeScriptPath,
          bridgeSha256: hanging.bridgeSha256,
          processIds: hangingIds,
          sessionDeadlineMs: 300,
        }),
        store: new MemoryMemberStore(),
      }),
      "E57_PYE57_STREAM_DEADLINE_EXCEEDED",
    );
    const hangingProcessId = Number.parseInt(
      await readFile(hanging.processIdPath, "utf8"),
      10,
    );
    expect(hangingIds).toEqual([hangingProcessId]);
    expect(processExists(hangingProcessId)).toBe(false);
  }, 30_000);

  it("rejects an unsupported adapter version and an oversized null point line before protocol Zod traversal", async () => {
    if (LOCAL_PYTHON_EXECUTABLE === null) return;
    const wrongVersion = await fakeReductionBridge(
      "wrong_adapter_version",
    );
    const wrongVersionIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: invocation({ source: wrongVersion.exactSource }),
        reader: await localReader({
          sourcePath: wrongVersion.sourcePath,
          bridgeScriptPath: wrongVersion.bridgeScriptPath,
          bridgeSha256: wrongVersion.bridgeSha256,
          processIds: wrongVersionIds,
        }),
        store: new MemoryMemberStore(),
      }),
      "E57_PYE57_REDUCTION_DESCRIPTION_MISMATCH",
    );
    expect(wrongVersionIds).toHaveLength(1);
    expect(processExists(wrongVersionIds[0]!)).toBe(false);

    const oversized = await fakeReductionBridge("oversized_null_points");
    const oversizedIds: number[] = [];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: invocation({ source: oversized.exactSource }),
        reader: await localReader({
          sourcePath: oversized.sourcePath,
          bridgeScriptPath: oversized.bridgeScriptPath,
          bridgeSha256: oversized.bridgeSha256,
          processIds: oversizedIds,
        }),
        store: new MemoryMemberStore(),
      }),
      "E57_PYE57_REDUCTION_SCAN_INVALID",
    );
    expect(oversizedIds).toHaveLength(1);
    expect(processExists(oversizedIds[0]!)).toBe(false);
  }, 30_000);

  it("accepts a completed empty scan but distinguishes an all-empty package from missing scans", async () => {
    const exactInvocation = invocation();
    const description = fixtureDescription(exactInvocation);
    const store = new MemoryMemberStore();
    const reader = new FixtureReader(description, [
      rawScan({ exactInvocation, scanIndex: 0, empty: true }),
      rawScan({ exactInvocation, scanIndex: 1 }),
    ]);
    const result = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader,
      store,
    });
    expect(result.status).toBe("succeeded");
    expect(parseStoredMember(store, 0)).toMatchObject({
      completion: "complete_empty",
      points: [],
    });
    expect(store.members.has(1)).toBe(true);

    const emptyStore = new MemoryMemberStore();
    const emptyReader = new FixtureReader(description, [
      rawScan({ exactInvocation, scanIndex: 0, empty: true }),
      rawScan({ exactInvocation, scanIndex: 1, empty: true }),
    ]);
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: emptyReader,
        store: emptyStore,
      }),
      "E57_SCAN_REDUCTION_ALL_SCANS_EMPTY",
    );
    expect(parseStoredMember(emptyStore, 0).completion).toBe(
      "complete_empty",
    );
    expect(parseStoredMember(emptyStore, 1).completion).toBe(
      "complete_empty",
    );
  });

  it("rejects reordered prefixes, tampered members, and create-only overwrite races", async () => {
    const exactInvocation = invocation();
    const description = fixtureDescription(exactInvocation);
    const baseline = new MemoryMemberStore();
    await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: new FixtureReader(description, [
        rawScan({ exactInvocation, scanIndex: 0 }),
        rawScan({ exactInvocation, scanIndex: 1 }),
      ]),
      store: baseline,
    });

    baseline.listOverride = [1, 0];
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: baseline,
      }),
      "E57_SCAN_REDUCTION_PREFIX_NONCONTIGUOUS",
    );

    baseline.listOverride = null;
    const memberZero = baseline.members.get(0);
    if (memberZero === undefined) throw new Error("missing baseline member");
    memberZero[memberZero.length - 2] =
      (memberZero[memberZero.length - 2] ?? 0) ^ 1;
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: baseline,
      }),
      "E57_SCAN_REDUCTION_MEMBER_TAMPERED",
    );

    const racingStore = new MemoryMemberStore();
    racingStore.memberCreateResult = "existing";
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, [
          rawScan({ exactInvocation, scanIndex: 0 }),
          rawScan({ exactInvocation, scanIndex: 1 }),
        ]),
        store: racingStore,
      }),
      "E57_SCAN_REDUCTION_STORE_OVERWRITE_RACE",
    );
    expect(racingStore.members.size).toBe(0);
  });

  it("rejects canonically resealed partial and per-scan-overlimit resume members", async () => {
    const exactInvocation = invocation({
      maximumRepresentativesPerScan: 1,
      maximumTotalRepresentatives: 2,
    });
    const description = fixtureDescription(exactInvocation);
    const baseline = new MemoryMemberStore();
    const controller = new AbortController();
    const baselineResult = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: new FixtureReader(description, [
        rawScan({ exactInvocation, scanIndex: 0 }),
        rawScan({ exactInvocation, scanIndex: 1 }),
      ]),
      store: baseline,
      signal: controller.signal,
      onMemberCommitted: () => {
        controller.abort();
      },
    });
    expect(baselineResult.status).toBe("cancelled");
    const valid = parseStoredMember(baseline, 0);
    if (baseline.description === null) {
      throw new Error("missing baseline description");
    }

    const partialStore = new MemoryMemberStore();
    partialStore.description = Buffer.from(baseline.description);
    partialStore.members.set(
      0,
      resealStoredMember(valid, {
        counts: {
          source: 1,
          processed: 1,
          invalid: 0,
          croppedOut: 0,
          validInsideCrop: 1,
          representatives: 1,
        },
      }),
    );
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: partialStore,
      }),
      "E57_SCAN_REDUCTION_MEMBER_TAMPERED",
    );

    const overLimitStore = new MemoryMemberStore();
    overLimitStore.description = Buffer.from(baseline.description);
    overLimitStore.members.set(
      0,
      resealStoredMember(valid, {
        counts: {
          source: 2,
          processed: 2,
          invalid: 0,
          croppedOut: 0,
          validInsideCrop: 2,
          representatives: 2,
        },
        points: [
          [0, 0, 0, 0, 10, 20, 30],
          [1, 1, 0, 0, 12, 20, 30],
        ],
      }),
    );
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: overLimitStore,
      }),
      "E57_SCAN_REDUCTION_MEMBER_BINDING_MISMATCH",
    );
  });

  it("rejects a wrong requested scan before any member-slot mutation", async () => {
    const exactInvocation = invocation();
    const description = fixtureDescription(exactInvocation);
    const store = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, [
          rawScan({ exactInvocation, scanIndex: 1 }),
        ]),
        store,
      }),
      "E57_SCAN_REDUCTION_REQUESTED_SCAN_MISMATCH",
    );
    expect(store.members.size).toBe(0);
    expect(store.memberCreateCalls).toEqual([]);
  });

  it("accepts eight valid representatives without applying the tuple-length cap to the outer point array", async () => {
    const exactInvocation = invocation({
      maximumRepresentativesPerScan: 8,
      maximumTotalRepresentatives: 8,
    });
    const store = new MemoryMemberStore();
    const result = await runFoundryE57ScanShardedReduction({
      invocation: exactInvocation,
      reader: new FixtureReader(eightPointDescription(exactInvocation), [
        eightPointRawScan(exactInvocation),
      ]),
      store,
    });
    expect(result.status).toBe("succeeded");
    expect(result.checkpoint.totalRepresentativeCount).toBe(8);
    expect(parseStoredMember(store, 0).points).toHaveLength(8);
  });

  it("preflights hostile persisted arrays and committed-index arrays before schema traversal or property access", async () => {
    const exactInvocation = invocation({ maximumScans: 2 });
    const description = fixtureDescription(exactInvocation);

    const descriptionStore = new MemoryMemberStore();
    descriptionStore.description = Buffer.from(
      JSON.stringify({
        ...description,
        scans: Array.from({ length: 100_000 }, () => null),
      }),
      "utf8",
    );
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: descriptionStore,
      }),
      "E57_SCAN_REDUCTION_DESCRIPTION_TAMPERED",
    );

    const memberStore = new MemoryMemberStore();
    memberStore.description = canonicalBytes(description);
    memberStore.members.set(
      0,
      Buffer.from(
        JSON.stringify({
          points: Array.from({ length: 1_000_000 }, () => null),
        }),
        "utf8",
      ),
    );
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: memberStore,
      }),
      "E57_SCAN_REDUCTION_MEMBER_BINDING_MISMATCH",
    );

    const sentinel = new Error("committed-index getter must not execute");
    const oversizedIndices = new Proxy(
      Array.from(
        { length: exactInvocation.limits.maximumScans + 1 },
        (_, index) => index,
      ),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) {
            throw sentinel;
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const oversizedIndexStore = new MemoryMemberStore();
    oversizedIndexStore.listOverride = oversizedIndices;
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: oversizedIndexStore,
      }),
      "E57_SCAN_REDUCTION_STORE_INDEX_PRECHECK_FAILED",
    );

    const accessorIndices = [0];
    Object.defineProperty(accessorIndices, "0", {
      configurable: true,
      enumerable: true,
      get(): never {
        throw sentinel;
      },
    });
    const accessorIndexStore = new MemoryMemberStore();
    accessorIndexStore.listOverride = accessorIndices;
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: new FixtureReader(description, []),
        store: accessorIndexStore,
      }),
      "E57_SCAN_REDUCTION_STORE_INDEX_PRECHECK_FAILED",
    );
  });

  it("preflights hostile description and point arrays without invoking Proxy or getter sentinels", async () => {
    const exactInvocation = invocation({ maximumScans: 2 });
    const description = fixtureDescription(exactInvocation);
    const sentinel = new Error("hostile getter must not execute");
    const oversizedScans = new Proxy(
      new Array(exactInvocation.limits.maximumScans + 1),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) {
            throw sentinel;
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const hostileDescription = { ...description, scans: oversizedScans };
    const descriptionStore = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: {
          describe: () => Promise.resolve(hostileDescription),
          reduceNextScan: () => Promise.reject(sentinel),
          close: () => Promise.resolve(),
        },
        store: descriptionStore,
      }),
      "E57_SCAN_REDUCTION_DESCRIPTION_PRECHECK_FAILED",
    );
    expect(descriptionStore.description).toBeNull();
    expect(descriptionStore.members.size).toBe(0);

    const oversizedPoints = new Proxy(
      new Array(
        exactInvocation.limits.maximumRepresentativesPerScan + 1,
      ),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) {
            throw sentinel;
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const oversizedRaw = {
      ...rawScan({ exactInvocation, scanIndex: 0 }),
      points: oversizedPoints,
    };
    const pointsStore = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: {
          describe: () => Promise.resolve(description),
          reduceNextScan: () => Promise.resolve(oversizedRaw),
          close: () => Promise.resolve(),
        },
        store: pointsStore,
      }),
      "E57_SCAN_REDUCTION_SCAN_PRECHECK_FAILED",
    );
    expect(pointsStore.members.size).toBe(0);

    const getterRaw = {
      ...rawScan({ exactInvocation, scanIndex: 0 }),
    };
    Object.defineProperty(getterRaw, "points", {
      configurable: true,
      enumerable: true,
      get(): never {
        throw sentinel;
      },
    });
    const getterStore = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: {
          describe: () => Promise.resolve(description),
          reduceNextScan: () => Promise.resolve(getterRaw),
          close: () => Promise.resolve(),
        },
        store: getterStore,
      }),
      "E57_SCAN_REDUCTION_SCAN_PRECHECK_FAILED",
    );
    expect(getterStore.members.size).toBe(0);

    const shared = { marker: "shared" };
    const repeatedReferenceRaw = {
      ...rawScan({ exactInvocation, scanIndex: 0 }),
      unknownDag: {
        left: shared,
        right: shared,
      },
    };
    const repeatedReferenceStore = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: {
          describe: () => Promise.resolve(description),
          reduceNextScan: () => Promise.resolve(repeatedReferenceRaw),
          close: () => Promise.resolve(),
        },
        store: repeatedReferenceStore,
      }),
      "E57_SCAN_REDUCTION_SCAN_PRECHECK_FAILED",
    );
    expect(repeatedReferenceStore.members.size).toBe(0);

    const prototypeKeyRaw = {
      ...rawScan({ exactInvocation, scanIndex: 0 }),
    };
    for (const key of ["__proto__", "constructor", "prototype"]) {
      Object.defineProperty(prototypeKeyRaw, key, {
        configurable: true,
        enumerable: true,
        value: { unexpected: key },
        writable: true,
      });
    }
    const prototypeKeyStore = new MemoryMemberStore();
    await expectCode(
      runFoundryE57ScanShardedReduction({
        invocation: exactInvocation,
        reader: {
          describe: () => Promise.resolve(description),
          reduceNextScan: () => Promise.resolve(prototypeKeyRaw),
          close: () => Promise.resolve(),
        },
        store: prototypeKeyStore,
      }),
      "E57_SCAN_REDUCTION_SCAN_INVALID",
    );
    expect(prototypeKeyStore.members.size).toBe(0);
  });
});
