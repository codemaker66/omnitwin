import {
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-layout-snapshot.js";
import {
  SCENARIO_INSTANCE_SCHEMA_VERSION,
  type ScenarioInstanceV0,
} from "./scenario-instance.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "./scenario-template.js";
import {
  VENREPLAY_ARTIFACT_SCHEMA_VERSION,
  VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS,
  VENREPLAY_MANIFEST_FILE_PATH,
  VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS,
  venreplayLogicalArtifactDigest,
  type VenreplayFileHash,
  type VenreplayManifestV0,
  type VenreplayPayloadFilePath,
} from "./venreplay-artifact.js";
import {
  VENREPLAY_WITNESS_SCHEMA_VERSION,
  type VenreplayArtifactFile,
  type VenreplayArtifactFileContent,
  type VenreplayWitnessV0,
} from "./venreplay-validator.js";

export const VENREPLAY_SYNTHETIC_FIXTURE_ID = "synthetic_bar_queue_fixture_v0";
export const VENREPLAY_SYNTHETIC_FIXTURE_FILE_NAME =
  "synthetic-bar-queue-fixture.v0.venreplay.zip";
export const VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT = "2026-01-01T00:00:00.000Z";
export const VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MTIME_DOS = 0;
export const VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MDATE_DOS = 33;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_3 = "3".repeat(64);
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_TABLE = buildCrc32Table();

interface SyntheticPayloadFile {
  readonly path: VenreplayPayloadFilePath;
  readonly role: VenreplayFileHash["role"];
  readonly content: string;
  readonly required: boolean;
}

export interface VenreplaySyntheticFixture {
  readonly fixtureId: string;
  readonly fileName: string;
  readonly generatedAt: string;
  readonly scenarioInstance: ScenarioInstanceV0;
  readonly witness: VenreplayWitnessV0;
  readonly manifest: VenreplayManifestV0;
  readonly files: readonly VenreplayArtifactFile[];
  readonly manifestFileSha256: string;
  readonly manifestFileByteSize: number;
  readonly logicalArtifactDigest: string;
  readonly zipBytes: Uint8Array;
  readonly zipSha256: string;
}

export const VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE: ScenarioInstanceV0 = {
  schemaVersion: SCENARIO_INSTANCE_SCHEMA_VERSION,
  instanceId: "synthetic_bar_queue_seed_42",
  templateId: "synthetic_bar_queue_template",
  templateVersion: "0.1.0",
  templateSchemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
  layoutSnapshotDigest: HASH_A,
  runtimePackageId: null,
  runtimePackageHash: null,
  policyBundle: {
    policyBundleId: "synthetic_planning_policy_v0",
    policyBundleVersion: "0.0.0",
    policyBundleDigest: HASH_B,
  },
  assumptionRefs: [
    {
      assumptionId: "synthetic_attendance_003",
      category: "attendance",
      contentHash: HASH_C,
    },
    {
      assumptionId: "synthetic_service_rate_fixture",
      category: "service_rate",
      contentHash: HASH_D,
    },
    {
      assumptionId: "synthetic_simulation_fixture",
      category: "simulation",
      contentHash: HASH_E,
    },
  ],
  routeModel: {
    routeModelType: "explicit_graph_path",
    routeModelId: "synthetic_queue_route_model",
    routeModelHash: HASH_F,
    dataSufficiency: "degraded_evidence",
  },
  simulator: {
    simulatorName: "manual_estimate",
    simulatorVersion: "0.0.0",
    simulatorHash: HASH_1,
    parameters: {
      deterministic: true,
      fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
      agentCount: 3,
    },
  },
  seed: {
    seedPolicy: "single_seed",
    seed: 42,
    seedSet: [],
  },
  artifactRefs: [
    {
      refType: "trajectory",
      ref: "fixture://venreplay/synthetic_bar_queue_fixture_v0/trajectory.csv",
      contentHash: HASH_2,
    },
    {
      refType: "metrics",
      ref: "fixture://venreplay/synthetic_bar_queue_fixture_v0/metrics.json",
      contentHash: HASH_3,
    },
  ],
  metricsSummary: [
    {
      metricName: "max_queue_length",
      value: 2,
      dataSufficiency: "degraded_evidence",
      worstCase: true,
    },
    {
      metricName: "queue_wait_time",
      value: {
        p95Seconds: 45,
      },
      dataSufficiency: "degraded_evidence",
      worstCase: false,
    },
  ],
  witnessBlockRef: {
    refType: "witness_block",
    ref: "witness_synthetic_bar_queue_seed_42",
    contentHash: HASH_3,
  },
  lifecycleState: "replay_ready",
  staleWhen: [
    "scenario_template_changed",
    "layout_snapshot_changed",
    "policy_bundle_changed",
    "assumptions_changed",
    "route_model_changed",
    "simulator_parameters_changed",
  ],
};

export const VENREPLAY_SYNTHETIC_WITNESS: VenreplayWitnessV0 = {
  schemaVersion: VENREPLAY_WITNESS_SCHEMA_VERSION,
  scenarioTemplateId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.templateId,
  scenarioTemplateVersion: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.templateVersion,
  scenarioInstanceId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId,
  layoutSnapshotHash: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.layoutSnapshotDigest,
  runtimePackageId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.runtimePackageId,
  runtimePackageHash: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.runtimePackageHash,
  policyBundleDigest:
    VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.policyBundle.policyBundleDigest,
  simulatorName: "manual_estimate",
  simulatorVersion: "0.0.0",
  simulatorHash: HASH_1,
  seed: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.seed,
  assumptions: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.assumptionRefs,
  limitations: [
    "Synthetic internal fixture for replay tooling.",
    "Not venue evidence and not decision material.",
  ],
  witnessBlockRef: {
    refType: "witness_block",
    ref: "witness_synthetic_bar_queue_seed_42",
    contentHash: HASH_3,
  },
  generatedAt: VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT,
  facts: {
    fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
    agentCount: 3,
    source: "synthetic_internal_fixture",
  },
};

export const VENREPLAY_SYNTHETIC_PAYLOAD_FILES: readonly SyntheticPayloadFile[] = [
  {
    path: "geometry.geojson",
    role: "geometry",
    content: jsonText({
      type: "FeatureCollection",
      properties: {
        fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
        scenarioInstanceId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId,
        layoutSnapshotHash: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.layoutSnapshotDigest,
        coordinateFrame: "synthetic_xy_meters",
        units: "metre",
        dataSufficiency: "degraded_evidence",
      },
      features: [
        {
          type: "Feature",
          id: "synthetic_walkable_area",
          properties: {
            feature_id: "synthetic_walkable_area",
            geometry_type: "Polygon",
            coordinate_frame: "synthetic_xy_meters",
            units: "metre",
            source_ref: "synthetic_fixture_geometry",
            data_sufficiency: "degraded_evidence",
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [6, 0],
                [6, 4],
                [0, 4],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: "Feature",
          id: "synthetic_bar_counter",
          properties: {
            feature_id: "synthetic_bar_counter",
            geometry_type: "LineString",
            coordinate_frame: "synthetic_xy_meters",
            units: "metre",
            source_ref: "synthetic_fixture_geometry",
            data_sufficiency: "degraded_evidence",
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [5, 0.75],
              [5, 3.25],
            ],
          },
        },
      ],
    }),
    required: true,
  },
  {
    path: "scenario.json",
    role: "scenario",
    content: jsonText(VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE as CanonicalJsonValue),
    required: true,
  },
  {
    path: "agents.csv",
    role: "agents",
    content: [
      "agent_id,profile_type,start_ref,goal_ref",
      "agent_001,guest,spawn_west,bar_counter",
      "agent_002,guest,spawn_west,bar_counter",
      "agent_003,staff,staff_start,bar_counter",
      "",
    ].join("\n"),
    required: true,
  },
  {
    path: "trajectory.csv",
    role: "trajectory",
    content: [
      "time_seconds,agent_id,x_m,y_m,level_id,state",
      "0,agent_001,0.5,1.0,ground,walking",
      "5,agent_001,2.5,1.4,ground,queued",
      "10,agent_001,4.6,1.8,ground,served",
      "0,agent_002,0.5,2.0,ground,walking",
      "5,agent_002,2.2,2.2,ground,queued",
      "10,agent_002,4.4,2.5,ground,served",
      "0,agent_003,5.2,3.2,ground,working",
      "5,agent_003,5.1,2.6,ground,working",
      "10,agent_003,5.0,2.0,ground,working",
      "",
    ].join("\n"),
    required: true,
  },
  {
    path: "metrics.json",
    role: "metrics",
    content: jsonText({
      schemaVersion: "venviewer.venreplay-metrics.v0",
      fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
      scenarioInstanceId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId,
      metrics: {
        max_queue_length: 2,
        queue_wait_time: {
          p95Seconds: 45,
        },
      },
      limitations: [
        "Synthetic internal fixture for replay tooling.",
        "Not venue evidence and not decision material.",
      ],
    }),
    required: true,
  },
  {
    path: "bottlenecks.geojson",
    role: "bottlenecks",
    content: jsonText({
      type: "FeatureCollection",
      properties: {
        fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
        scenarioInstanceId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId,
        dataSufficiency: "degraded_evidence",
      },
      features: [
        {
          type: "Feature",
          id: "synthetic_queue_point",
          properties: {
            feature_id: "synthetic_queue_point",
            geometry_type: "Point",
            coordinate_frame: "synthetic_xy_meters",
            units: "metre",
            source_ref: "synthetic_fixture_trajectory",
            data_sufficiency: "degraded_evidence",
            metric_name: "max_queue_length",
          },
          geometry: {
            type: "Point",
            coordinates: [2.35, 1.8],
          },
        },
      ],
    }),
    required: true,
  },
  {
    path: "witness.json",
    role: "witness",
    content: jsonText(VENREPLAY_SYNTHETIC_WITNESS as CanonicalJsonValue),
    required: true,
  },
] as const;

export const VENREPLAY_SYNTHETIC_MANIFEST: VenreplayManifestV0 = {
  schemaVersion: VENREPLAY_ARTIFACT_SCHEMA_VERSION,
  artifactVersion: "0.1.0",
  artifactId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
  scenarioTemplateId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.templateId,
  scenarioTemplateVersion: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.templateVersion,
  scenarioTemplateSchemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
  scenarioInstanceId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId,
  scenarioInstance: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE,
  layoutSnapshotHash: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.layoutSnapshotDigest,
  runtimePackageId: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.runtimePackageId,
  runtimePackageHash: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.runtimePackageHash,
  policyBundleDigest:
    VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.policyBundle.policyBundleDigest,
  simulatorName: "manual_estimate",
  simulatorVersion: "0.0.0",
  simulatorHash: HASH_1,
  seed: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.seed,
  seedCount: 1,
  generatedAt: VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT,
  assumptions: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.assumptionRefs,
  limitations: [
    "Synthetic internal fixture for replay tooling.",
    "Not venue evidence and not decision material.",
  ],
  fileHashes: VENREPLAY_SYNTHETIC_PAYLOAD_FILES.map(fileHash),
  csvColumnContracts: [
    {
      filePath: "agents.csv",
      contract: "agents_v0",
      columns: ["agent_id", "profile_type", "start_ref", "goal_ref"],
    },
    {
      filePath: "trajectory.csv",
      contract: "trajectory_v0",
      columns: ["time_seconds", "agent_id", "x_m", "y_m", "level_id", "state"],
    },
  ],
  geojsonFeatureContracts: [
    {
      filePath: "geometry.geojson",
      requirements: [...VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS],
    },
    {
      filePath: "bottlenecks.geojson",
      requirements: [...VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS],
    },
  ],
  metricsShape: [
    {
      metricName: "max_queue_length",
      dataSufficiency: "degraded_evidence",
      valuePath: "$.metrics.max_queue_length",
      unit: "agents",
    },
    {
      metricName: "queue_wait_time",
      dataSufficiency: "degraded_evidence",
      valuePath: "$.metrics.queue_wait_time",
      unit: "seconds",
    },
  ],
  witnessCompatibility: [...VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS],
  exposureTier: "internal_only",
  manifestExtension: {
    fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
    fixtureKind: "synthetic_internal",
    intendedUse: "unit_tests_and_browser_loader_development",
  },
};

const MANIFEST_TEXT = jsonText(VENREPLAY_SYNTHETIC_MANIFEST as CanonicalJsonValue);

export const VENREPLAY_SYNTHETIC_ARTIFACT_FILES: readonly VenreplayArtifactFile[] = [
  {
    path: VENREPLAY_MANIFEST_FILE_PATH,
    content: MANIFEST_TEXT,
  },
  ...VENREPLAY_SYNTHETIC_PAYLOAD_FILES.map((file) => ({
    path: file.path,
    content: file.content,
  })),
];

export const VENREPLAY_SYNTHETIC_MANIFEST_FILE_SHA256 = sha256Hex(MANIFEST_TEXT);
export const VENREPLAY_SYNTHETIC_MANIFEST_FILE_BYTE_SIZE = byteLength(MANIFEST_TEXT);
export const VENREPLAY_SYNTHETIC_LOGICAL_ARTIFACT_DIGEST =
  venreplayLogicalArtifactDigest(VENREPLAY_SYNTHETIC_MANIFEST);
export const VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES = deterministicStoredZip(
  VENREPLAY_SYNTHETIC_ARTIFACT_FILES,
);
export const VENREPLAY_SYNTHETIC_FIXTURE_ZIP_SHA256 = sha256Hex(
  VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES,
);

export const VENREPLAY_SYNTHETIC_FIXTURE: VenreplaySyntheticFixture = {
  fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
  fileName: VENREPLAY_SYNTHETIC_FIXTURE_FILE_NAME,
  generatedAt: VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT,
  scenarioInstance: VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE,
  witness: VENREPLAY_SYNTHETIC_WITNESS,
  manifest: VENREPLAY_SYNTHETIC_MANIFEST,
  files: VENREPLAY_SYNTHETIC_ARTIFACT_FILES,
  manifestFileSha256: VENREPLAY_SYNTHETIC_MANIFEST_FILE_SHA256,
  manifestFileByteSize: VENREPLAY_SYNTHETIC_MANIFEST_FILE_BYTE_SIZE,
  logicalArtifactDigest: VENREPLAY_SYNTHETIC_LOGICAL_ARTIFACT_DIGEST,
  zipBytes: VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES,
  zipSha256: VENREPLAY_SYNTHETIC_FIXTURE_ZIP_SHA256,
};

function jsonText(value: CanonicalJsonValue): string {
  return stableCanonicalJson(value);
}

function fileHash(file: SyntheticPayloadFile): VenreplayFileHash {
  return {
    path: file.path,
    role: file.role,
    sha256: sha256Hex(file.content),
    byteSize: byteLength(file.content),
    required: file.required,
  };
}

function byteLength(content: VenreplayArtifactFileContent): number {
  return typeof content === "string" ? utf8Bytes(content).byteLength : content.byteLength;
}

function deterministicStoredZip(files: readonly VenreplayArtifactFile[]): Uint8Array {
  const entries = [...files]
    .map((file) => ({
      path: file.path,
      pathBytes: utf8Bytes(file.path),
      contentBytes: typeof file.content === "string" ? utf8Bytes(file.content) : file.content,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const crc = crc32(entry.contentBytes);
    const localHeader = zipLocalHeader(entry.pathBytes, entry.contentBytes, crc);
    localParts.push(localHeader, entry.contentBytes);
    centralParts.push(zipCentralDirectoryHeader(entry.pathBytes, entry.contentBytes, crc, offset));
    offset += localHeader.byteLength + entry.contentBytes.byteLength;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = zipEndOfCentralDirectory(entries.length, centralDirectory.byteLength, offset);
  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function zipLocalHeader(
  pathBytes: Uint8Array,
  contentBytes: Uint8Array,
  crc: number,
): Uint8Array {
  const header = new Uint8Array(30 + pathBytes.byteLength);
  writeUint32LE(header, 0, 0x04034b50);
  writeUint16LE(header, 4, 20);
  writeUint16LE(header, 6, 0);
  writeUint16LE(header, 8, 0);
  writeUint16LE(header, 10, VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MTIME_DOS);
  writeUint16LE(header, 12, VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MDATE_DOS);
  writeUint32LE(header, 14, crc);
  writeUint32LE(header, 18, contentBytes.byteLength);
  writeUint32LE(header, 22, contentBytes.byteLength);
  writeUint16LE(header, 26, pathBytes.byteLength);
  writeUint16LE(header, 28, 0);
  header.set(pathBytes, 30);
  return header;
}

function zipCentralDirectoryHeader(
  pathBytes: Uint8Array,
  contentBytes: Uint8Array,
  crc: number,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + pathBytes.byteLength);
  writeUint32LE(header, 0, 0x02014b50);
  writeUint16LE(header, 4, 20);
  writeUint16LE(header, 6, 20);
  writeUint16LE(header, 8, 0);
  writeUint16LE(header, 10, 0);
  writeUint16LE(header, 12, VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MTIME_DOS);
  writeUint16LE(header, 14, VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MDATE_DOS);
  writeUint32LE(header, 16, crc);
  writeUint32LE(header, 20, contentBytes.byteLength);
  writeUint32LE(header, 24, contentBytes.byteLength);
  writeUint16LE(header, 28, pathBytes.byteLength);
  writeUint16LE(header, 30, 0);
  writeUint16LE(header, 32, 0);
  writeUint16LE(header, 34, 0);
  writeUint16LE(header, 36, 0);
  writeUint32LE(header, 38, 0);
  writeUint32LE(header, 42, localHeaderOffset);
  header.set(pathBytes, 46);
  return header;
}

function zipEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const record = new Uint8Array(22);
  writeUint32LE(record, 0, 0x06054b50);
  writeUint16LE(record, 4, 0);
  writeUint16LE(record, 6, 0);
  writeUint16LE(record, 8, entryCount);
  writeUint16LE(record, 10, entryCount);
  writeUint32LE(record, 12, centralDirectorySize);
  writeUint32LE(record, 16, centralDirectoryOffset);
  writeUint16LE(record, 20, 0);
  return record;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function buildCrc32Table(): readonly number[] {
  return Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ CRC32_POLYNOMIAL : crc >>> 1;
    }
    return crc >>> 0;
  });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
