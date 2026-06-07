import { describe, expect, it } from "vitest";
import {
  VENREPLAY_ARTIFACT_SCHEMA_VERSION,
  VENREPLAY_CSV_CONTRACTS,
  VENREPLAY_CSV_REQUIRED_COLUMNS,
  VENREPLAY_EXPOSURE_TIERS,
  VENREPLAY_FILE_ROLES,
  VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS,
  VENREPLAY_OPTIONAL_FILE_PATHS,
  VENREPLAY_REQUIRED_FILE_PATHS,
  VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS,
  VenreplayFileHashSchema,
  VenreplayManifestV0Schema,
  type VenreplayFileHash,
  type VenreplayManifestV0,
} from "../venreplay-artifact.js";
import {
  SCENARIO_INSTANCE_SCHEMA_VERSION,
  type ScenarioInstanceV0,
} from "../scenario-instance.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "../scenario-template.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_3 = "3".repeat(64);

const REPLAY_READY_INSTANCE: ScenarioInstanceV0 = {
  schemaVersion: SCENARIO_INSTANCE_SCHEMA_VERSION,
  instanceId: "bar_queue_after_speeches_seed_42",
  templateId: "bar_queue_after_speeches",
  templateVersion: "0.1.0",
  templateSchemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
  layoutSnapshotDigest: HASH_A,
  runtimePackageId: "runtime_package_grand_hall_internal_001",
  runtimePackageHash: HASH_B,
  policyBundle: {
    policyBundleId: "trades_hall_planning_draft_v0",
    policyBundleVersion: "0.0.0",
    policyBundleDigest: HASH_C,
  },
  assumptionRefs: [
    {
      assumptionId: "assumption_attendance_120",
      category: "attendance",
      contentHash: HASH_D,
    },
    {
      assumptionId: "assumption_service_rate_bar_001",
      category: "service_rate",
      contentHash: null,
    },
  ],
  routeModel: {
    routeModelType: "explicit_graph_path",
    routeModelId: "route_model_bar_queue_001",
    routeModelHash: HASH_E,
    dataSufficiency: "degraded_evidence",
  },
  simulator: {
    simulatorName: "manual_estimate",
    simulatorVersion: "0.0.0",
    simulatorHash: HASH_F,
    parameters: {
      deterministic: true,
      scenario: "bar_queue_after_speeches",
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
      ref: "r2://internal/venreplay/bar_queue_seed_42/trajectory.csv",
      contentHash: HASH_1,
    },
    {
      refType: "metrics",
      ref: "r2://internal/venreplay/bar_queue_seed_42/metrics.json",
      contentHash: HASH_2,
    },
    {
      refType: "bottlenecks",
      ref: "r2://internal/venreplay/bar_queue_seed_42/bottlenecks.geojson",
      contentHash: HASH_3,
    },
  ],
  metricsSummary: [
    {
      metricName: "max_queue_length",
      value: 18,
      dataSufficiency: "degraded_evidence",
      worstCase: true,
    },
    {
      metricName: "queue_wait_time",
      value: {
        p95Seconds: 420,
      },
      dataSufficiency: "degraded_evidence",
      worstCase: false,
    },
  ],
  witnessBlockRef: {
    refType: "witness_block",
    ref: "witness_bar_queue_seed_42",
    contentHash: HASH_3,
  },
  lifecycleState: "replay_ready",
  staleWhen: [
    "scenario_template_changed",
    "layout_snapshot_changed",
    "runtime_package_changed",
    "policy_bundle_changed",
    "assumptions_changed",
    "route_model_changed",
    "simulator_parameters_changed",
  ],
};

const FILE_HASHES: readonly VenreplayFileHash[] = [
  {
    path: "manifest.json",
    role: "manifest",
    sha256: HASH_A,
    byteSize: 512,
    required: true,
  },
  {
    path: "geometry.geojson",
    role: "geometry",
    sha256: HASH_B,
    byteSize: 1024,
    required: true,
  },
  {
    path: "scenario.json",
    role: "scenario",
    sha256: HASH_C,
    byteSize: 768,
    required: true,
  },
  {
    path: "agents.csv",
    role: "agents",
    sha256: HASH_D,
    byteSize: 2048,
    required: true,
  },
  {
    path: "trajectory.csv",
    role: "trajectory",
    sha256: HASH_E,
    byteSize: 4096,
    required: true,
  },
  {
    path: "metrics.json",
    role: "metrics",
    sha256: HASH_F,
    byteSize: 640,
    required: true,
  },
  {
    path: "bottlenecks.geojson",
    role: "bottlenecks",
    sha256: HASH_1,
    byteSize: 896,
    required: true,
  },
  {
    path: "witness.json",
    role: "witness",
    sha256: HASH_2,
    byteSize: 704,
    required: true,
  },
  {
    path: "scene.glb",
    role: "display_scene",
    sha256: HASH_3,
    byteSize: 8192,
    required: false,
  },
];

const VALID_MANIFEST: VenreplayManifestV0 = {
  schemaVersion: VENREPLAY_ARTIFACT_SCHEMA_VERSION,
  artifactVersion: "0.1.0",
  artifactId: "venreplay_bar_queue_after_speeches_seed_42",
  scenarioTemplateId: REPLAY_READY_INSTANCE.templateId,
  scenarioTemplateVersion: REPLAY_READY_INSTANCE.templateVersion,
  scenarioTemplateSchemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
  scenarioInstanceId: REPLAY_READY_INSTANCE.instanceId,
  scenarioInstance: REPLAY_READY_INSTANCE,
  layoutSnapshotHash: REPLAY_READY_INSTANCE.layoutSnapshotDigest,
  runtimePackageId: REPLAY_READY_INSTANCE.runtimePackageId,
  runtimePackageHash: REPLAY_READY_INSTANCE.runtimePackageHash,
  policyBundleDigest: REPLAY_READY_INSTANCE.policyBundle.policyBundleDigest,
  simulatorName: "manual_estimate",
  simulatorVersion: "0.0.0",
  simulatorHash: HASH_F,
  seed: REPLAY_READY_INSTANCE.seed,
  seedCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  assumptions: REPLAY_READY_INSTANCE.assumptionRefs,
  limitations: [
    "Internal planning replay for review; conclusions depend on stated assumptions.",
  ],
  fileHashes: [...FILE_HASHES],
  csvColumnContracts: [
    {
      filePath: "agents.csv",
      contract: "agents_v0",
      columns: [...VENREPLAY_CSV_REQUIRED_COLUMNS.agents_v0, "metadata_json"],
    },
    {
      filePath: "trajectory.csv",
      contract: "trajectory_v0",
      columns: [...VENREPLAY_CSV_REQUIRED_COLUMNS.trajectory_v0, "speed_mps"],
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
    fixtureScope: "schema_contract",
  },
};

function requireFileHash(path: VenreplayFileHash["path"]): VenreplayFileHash {
  const fileHash = FILE_HASHES.find((candidate) => candidate.path === path);
  if (fileHash === undefined) {
    throw new Error(`Missing test file hash ${path}.`);
  }

  return fileHash;
}

function requireAssumption(index: number): VenreplayManifestV0["assumptions"][number] {
  const assumption = VALID_MANIFEST.assumptions[index];
  if (assumption === undefined) {
    throw new Error(`Missing test assumption ${String(index)}.`);
  }

  return assumption;
}

function requireCsvContract(index: number): VenreplayManifestV0["csvColumnContracts"][number] {
  const contract = VALID_MANIFEST.csvColumnContracts[index];
  if (contract === undefined) {
    throw new Error(`Missing test CSV contract ${String(index)}.`);
  }

  return contract;
}

describe("Venreplay artifact schema", () => {
  it("pins portable artifact vocabularies", () => {
    expect(VENREPLAY_REQUIRED_FILE_PATHS).toEqual([
      "manifest.json",
      "geometry.geojson",
      "scenario.json",
      "agents.csv",
      "trajectory.csv",
      "metrics.json",
      "bottlenecks.geojson",
      "witness.json",
    ]);

    expect(VENREPLAY_OPTIONAL_FILE_PATHS).toEqual(["scene.glb"]);
    expect(VENREPLAY_FILE_ROLES).toEqual([
      "manifest",
      "geometry",
      "scenario",
      "agents",
      "trajectory",
      "metrics",
      "bottlenecks",
      "witness",
      "display_scene",
    ]);
    expect(VENREPLAY_CSV_CONTRACTS).toEqual(["agents_v0", "trajectory_v0"]);
    expect(VENREPLAY_EXPOSURE_TIERS).toEqual([
      "internal_only",
      "partner_preview",
      "authenticated_client",
      "expert_review",
    ]);
  });

  it("parses a replay-ready manifest with file hashes and contracts", () => {
    expect(VenreplayManifestV0Schema.parse(VALID_MANIFEST)).toEqual(VALID_MANIFEST);
  });

  it("rejects missing, duplicated, or mislabelled file hashes", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      fileHashes: VALID_MANIFEST.fileHashes.filter(
        (fileHash) => fileHash.path !== "trajectory.csv",
      ),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      fileHashes: [
        ...VALID_MANIFEST.fileHashes,
        {
          ...requireFileHash("manifest.json"),
          sha256: HASH_3,
        },
      ],
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      fileHashes: VALID_MANIFEST.fileHashes.map((fileHash) =>
        fileHash.path === "metrics.json"
          ? {
              ...fileHash,
              role: "trajectory",
            }
          : fileHash,
      ),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      fileHashes: VALID_MANIFEST.fileHashes.map((fileHash) =>
        fileHash.path === "scene.glb"
          ? {
              ...fileHash,
              required: true,
            }
          : fileHash,
      ),
    }).success).toBe(false);
  });

  it("rejects paths outside the portable v0 file set", () => {
    expect(VenreplayFileHashSchema.safeParse({
      path: "simulator-output.json",
      role: "metrics",
      sha256: HASH_A,
      byteSize: 128,
      required: false,
    }).success).toBe(false);
  });

  it("rejects scenario identity mismatches", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      scenarioInstanceId: "different_instance",
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      scenarioTemplateVersion: "0.2.0",
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      layoutSnapshotHash: HASH_3,
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      runtimePackageHash: HASH_3,
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      policyBundleDigest: HASH_3,
    }).success).toBe(false);
  });

  it("requires replay-ready scenario, simulator, witness, and matching seed metadata", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      scenarioInstance: {
        ...VALID_MANIFEST.scenarioInstance,
        lifecycleState: "metrics_ready",
      },
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      scenarioInstance: {
        ...VALID_MANIFEST.scenarioInstance,
        witnessBlockRef: null,
      },
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      simulatorVersion: "0.1.0",
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      seedCount: 2,
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      seed: {
        seedPolicy: "single_seed",
        seed: 7,
        seedSet: [],
      },
    }).success).toBe(false);
  });

  it("requires exact assumption references", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      assumptions: VALID_MANIFEST.assumptions.slice(1),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      assumptions: [
        ...VALID_MANIFEST.assumptions,
        requireAssumption(0),
      ],
    }).success).toBe(false);
  });

  it("requires complete CSV, GeoJSON, witness, and metrics contracts", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      csvColumnContracts: VALID_MANIFEST.csvColumnContracts.map((contract) =>
        contract.contract === "trajectory_v0"
          ? {
              ...contract,
              columns: contract.columns.filter((column) => column !== "agent_id"),
            }
          : contract,
      ),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      csvColumnContracts: [
        {
          filePath: "trajectory.csv",
          contract: "agents_v0",
          columns: [...VENREPLAY_CSV_REQUIRED_COLUMNS.agents_v0],
        },
        requireCsvContract(1),
      ],
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      geojsonFeatureContracts: VALID_MANIFEST.geojsonFeatureContracts.map((contract) =>
        contract.filePath === "geometry.geojson"
          ? {
              ...contract,
              requirements: contract.requirements.filter(
                (requirement) => requirement !== "coordinate_frame",
              ),
            }
          : contract,
      ),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      witnessCompatibility: VALID_MANIFEST.witnessCompatibility.filter(
        (requirement) => requirement !== "limitations",
      ),
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      metricsShape: VALID_MANIFEST.metricsShape.filter(
        (metric) => metric.metricName !== "queue_wait_time",
      ),
    }).success).toBe(false);
  });

  it("keeps the manifest metadata-only and strict", () => {
    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      browserReplayUrl: "https://example.invalid/replay",
    }).success).toBe(false);

    expect(VenreplayManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      exposureTier: "public_marketing",
    }).success).toBe(false);
  });
});
