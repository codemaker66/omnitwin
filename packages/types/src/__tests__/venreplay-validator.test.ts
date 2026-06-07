import { describe, expect, it } from "vitest";
import {
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "../canonical-layout-snapshot.js";
import {
  SCENARIO_INSTANCE_SCHEMA_VERSION,
  type ScenarioInstanceV0,
} from "../scenario-instance.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "../scenario-template.js";
import {
  VENREPLAY_ARTIFACT_SCHEMA_VERSION,
  VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS,
  VENREPLAY_MANIFEST_FILE_PATH,
  VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS,
  type VenreplayFileHash,
  type VenreplayManifestV0,
  type VenreplayPayloadFilePath,
} from "../venreplay-artifact.js";
import {
  VENREPLAY_WITNESS_SCHEMA_VERSION,
  validateVenreplayArtifact,
  type VenreplayArtifactFile,
  type VenreplayArtifactFileContent,
  type VenreplayWitnessV0,
} from "../venreplay-validator.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_3 = "3".repeat(64);

const SCENARIO_INSTANCE: ScenarioInstanceV0 = {
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

const WITNESS: VenreplayWitnessV0 = {
  schemaVersion: VENREPLAY_WITNESS_SCHEMA_VERSION,
  scenarioTemplateId: SCENARIO_INSTANCE.templateId,
  scenarioTemplateVersion: SCENARIO_INSTANCE.templateVersion,
  scenarioInstanceId: SCENARIO_INSTANCE.instanceId,
  layoutSnapshotHash: SCENARIO_INSTANCE.layoutSnapshotDigest,
  runtimePackageId: SCENARIO_INSTANCE.runtimePackageId,
  runtimePackageHash: SCENARIO_INSTANCE.runtimePackageHash,
  policyBundleDigest: SCENARIO_INSTANCE.policyBundle.policyBundleDigest,
  simulatorName: "manual_estimate",
  simulatorVersion: "0.0.0",
  simulatorHash: HASH_F,
  seed: SCENARIO_INSTANCE.seed,
  assumptions: SCENARIO_INSTANCE.assumptionRefs,
  limitations: [
    "Internal planning replay for review; conclusions depend on stated assumptions.",
  ],
  witnessBlockRef: {
    refType: "witness_block",
    ref: "witness_bar_queue_seed_42",
    contentHash: HASH_3,
  },
  generatedAt: "2026-01-01T00:00:00.000Z",
  facts: {
    evidenceKind: "planning_replay",
  },
};

interface PayloadFile {
  readonly path: VenreplayPayloadFilePath;
  readonly role: VenreplayFileHash["role"];
  readonly content: VenreplayArtifactFileContent;
  readonly required: boolean;
}

function jsonText(value: CanonicalJsonValue): string {
  return stableCanonicalJson(value);
}

function byteLength(content: VenreplayArtifactFileContent): number {
  return typeof content === "string" ? content.length : content.byteLength;
}

function fileHash(file: PayloadFile): VenreplayFileHash {
  return {
    path: file.path,
    role: file.role,
    sha256: sha256Hex(file.content),
    byteSize: byteLength(file.content),
    required: file.required,
  };
}

function basePayloadFiles(overrides: Partial<Record<VenreplayPayloadFilePath, VenreplayArtifactFileContent>> = {}): PayloadFile[] {
  const geometry = jsonText({
    type: "FeatureCollection",
    properties: {
      layoutSnapshotHash: SCENARIO_INSTANCE.layoutSnapshotDigest,
      runtimePackageHash: SCENARIO_INSTANCE.runtimePackageHash,
      requirements: [...VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS],
    },
    features: [],
  });
  const bottlenecks = jsonText({
    type: "FeatureCollection",
    properties: {
      scenarioInstanceId: SCENARIO_INSTANCE.instanceId,
      dataSufficiency: "degraded_evidence",
    },
    features: [],
  });

  return [
    {
      path: "geometry.geojson",
      role: "geometry",
      content: overrides["geometry.geojson"] ?? geometry,
      required: true,
    },
    {
      path: "scenario.json",
      role: "scenario",
      content: overrides["scenario.json"] ?? jsonText(SCENARIO_INSTANCE as CanonicalJsonValue),
      required: true,
    },
    {
      path: "agents.csv",
      role: "agents",
      content: overrides["agents.csv"] ??
        "agent_id,profile_type,start_ref,goal_ref\nagent_1,guest,spawn_1,goal_1\n",
      required: true,
    },
    {
      path: "trajectory.csv",
      role: "trajectory",
      content: overrides["trajectory.csv"] ??
        "time_seconds,agent_id,x_m,y_m,level_id,state\n0,agent_1,0,0,ground,walking\n",
      required: true,
    },
    {
      path: "metrics.json",
      role: "metrics",
      content: overrides["metrics.json"] ??
        jsonText({
          schemaVersion: "venviewer.venreplay-metrics.v0",
          scenarioInstanceId: SCENARIO_INSTANCE.instanceId,
          metrics: {
            max_queue_length: 18,
            queue_wait_time: {
              p95Seconds: 420,
            },
          },
          limitations: [
            "Internal planning replay for review; conclusions depend on stated assumptions.",
          ],
        }),
      required: true,
    },
    {
      path: "bottlenecks.geojson",
      role: "bottlenecks",
      content: overrides["bottlenecks.geojson"] ?? bottlenecks,
      required: true,
    },
    {
      path: "witness.json",
      role: "witness",
      content: overrides["witness.json"] ?? jsonText(WITNESS as CanonicalJsonValue),
      required: true,
    },
  ];
}

function buildManifest(payloadFiles: readonly PayloadFile[]): VenreplayManifestV0 {
  return {
    schemaVersion: VENREPLAY_ARTIFACT_SCHEMA_VERSION,
    artifactVersion: "0.1.0",
    artifactId: "venreplay_bar_queue_after_speeches_seed_42",
    scenarioTemplateId: SCENARIO_INSTANCE.templateId,
    scenarioTemplateVersion: SCENARIO_INSTANCE.templateVersion,
    scenarioTemplateSchemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
    scenarioInstanceId: SCENARIO_INSTANCE.instanceId,
    scenarioInstance: SCENARIO_INSTANCE,
    layoutSnapshotHash: SCENARIO_INSTANCE.layoutSnapshotDigest,
    runtimePackageId: SCENARIO_INSTANCE.runtimePackageId,
    runtimePackageHash: SCENARIO_INSTANCE.runtimePackageHash,
    policyBundleDigest: SCENARIO_INSTANCE.policyBundle.policyBundleDigest,
    simulatorName: "manual_estimate",
    simulatorVersion: "0.0.0",
    simulatorHash: HASH_F,
    seed: SCENARIO_INSTANCE.seed,
    seedCount: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    assumptions: SCENARIO_INSTANCE.assumptionRefs,
    limitations: [
      "Internal planning replay for review; conclusions depend on stated assumptions.",
    ],
    fileHashes: payloadFiles.map(fileHash),
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
  };
}

function buildArtifactFiles(payloadFiles = basePayloadFiles()): VenreplayArtifactFile[] {
  const manifest = buildManifest(payloadFiles);
  return [
    {
      path: VENREPLAY_MANIFEST_FILE_PATH,
      content: jsonText(manifest as CanonicalJsonValue),
    },
    ...payloadFiles.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  ];
}

function issueCodes(files: readonly VenreplayArtifactFile[]): string[] {
  return validateVenreplayArtifact(files).issues.map((issue) => issue.code);
}

describe("Venreplay artifact validator", () => {
  it("validates a complete artifact and reports manifest and logical digests", () => {
    const files = buildArtifactFiles();
    const manifestFile = files.find((file) => file.path === VENREPLAY_MANIFEST_FILE_PATH);
    if (manifestFile === undefined || typeof manifestFile.content !== "string") {
      throw new Error("Missing manifest fixture.");
    }

    const result = validateVenreplayArtifact(files);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.scenarioInstanceId).toBe(SCENARIO_INSTANCE.instanceId);
    expect(result.scenario?.instanceId).toBe(SCENARIO_INSTANCE.instanceId);
    expect(result.witness?.scenarioInstanceId).toBe(SCENARIO_INSTANCE.instanceId);
    expect(result.manifestFileSha256).toBe(sha256Hex(manifestFile.content));
    expect(result.manifestFileByteSize).toBe(manifestFile.content.length);
    expect(result.logicalArtifactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fileIntegrity.every((entry) => entry.actualSha256 === entry.expectedSha256))
      .toBe(true);
  });

  it("rejects missing required files, duplicate paths, and unknown archive entries", () => {
    expect(issueCodes(buildArtifactFiles().filter((file) => file.path !== "agents.csv")))
      .toContain("missing_file");

    expect(issueCodes([
      ...buildArtifactFiles(),
      {
        path: "agents.csv",
        content: "agent_id,profile_type,start_ref,goal_ref\nagent_2,guest,a,b\n",
      },
    ])).toContain("duplicate_file");

    expect(issueCodes([
      ...buildArtifactFiles(),
      {
        path: "raw-simulator-output.json",
        content: "{}",
      },
    ])).toContain("invalid_path");
  });

  it("rejects hash and byte-size mismatches", () => {
    const tampered = buildArtifactFiles().map((file) =>
      file.path === "trajectory.csv"
        ? {
            ...file,
            content: "tampered\n",
          }
        : file,
    );

    const codes = issueCodes(tampered);
    expect(codes).toContain("hash_mismatch");
    expect(codes).toContain("byte_size_mismatch");
  });

  it("requires every present payload file to be listed in manifest fileHashes", () => {
    const files = [
      ...buildArtifactFiles(),
      {
        path: "scene.glb",
        content: new Uint8Array([0, 1, 2, 3]),
      },
    ];

    expect(issueCodes(files)).toContain("missing_hash_entry");
  });

  it("rejects manifest, scenario, witness, and generic JSON shape failures", () => {
    const manifestBroken = buildArtifactFiles().map((file) =>
      file.path === VENREPLAY_MANIFEST_FILE_PATH
        ? {
            ...file,
            content: jsonText({
              schemaVersion: VENREPLAY_ARTIFACT_SCHEMA_VERSION,
            }),
          }
        : file,
    );
    expect(issueCodes(manifestBroken)).toContain("manifest_schema_invalid");

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({ "scenario.json": "{}" }))))
      .toContain("scenario_schema_invalid");

    const invalidWitness: Record<string, unknown> = {
      ...WITNESS,
    };
    delete invalidWitness.limitations;
    expect(issueCodes(buildArtifactFiles(basePayloadFiles({
      "witness.json": JSON.stringify(invalidWitness),
    })))).toContain("witness_schema_invalid");

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({ "metrics.json": "{" }))))
      .toContain("json_parse_failed");
  });

  it("rejects scenario identity drift from the manifest", () => {
    const driftedScenario: ScenarioInstanceV0 = {
      ...SCENARIO_INSTANCE,
      instanceId: "bar_queue_after_speeches_seed_7",
    };

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({
      "scenario.json": jsonText(driftedScenario as CanonicalJsonValue),
    })))).toContain("scenario_mismatch");
  });

  it("rejects witness references that drift from manifest layout/runtime inputs", () => {
    const driftedWitness: VenreplayWitnessV0 = {
      ...WITNESS,
      layoutSnapshotHash: HASH_1,
      runtimePackageHash: HASH_2,
    };

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({
      "witness.json": jsonText(driftedWitness as CanonicalJsonValue),
    })))).toContain("witness_mismatch");
  });

  it("rejects unsupported public-claim language in portable structured files", () => {
    const blockedPhrase = ["certified", "safe"].join(" ");
    const metricsWithBlockedPhrase = jsonText({
      schemaVersion: "venviewer.venreplay-metrics.v0",
      scenarioInstanceId: SCENARIO_INSTANCE.instanceId,
      note: blockedPhrase,
      metrics: {
        max_queue_length: 18,
      },
      limitations: [
        "Internal planning replay for review; conclusions depend on stated assumptions.",
      ],
    });

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({
      "metrics.json": metricsWithBlockedPhrase,
    })))).toContain("unsafe_public_claim_language");
  });

  it("decodes UTF-8 byte payloads and rejects invalid structured bytes", () => {
    const encodedAgents = new Uint8Array([
      ...Array.from("agent_id,profile_type,start_ref,goal_ref\n".split("")).map((char) =>
        char.charCodeAt(0),
      ),
    ]);
    expect(validateVenreplayArtifact(buildArtifactFiles(basePayloadFiles({
      "agents.csv": encodedAgents,
    }))).valid).toBe(true);

    expect(issueCodes(buildArtifactFiles(basePayloadFiles({
      "agents.csv": new Uint8Array([0xff, 0xff]),
    })))).toContain("utf8_decode_failed");
  });

  it("keeps manifest self-hash out of the manifest contract", () => {
    const payloadFiles = basePayloadFiles();
    const manifest = buildManifest(payloadFiles);

    expect(manifest.fileHashes.map((fileHash) => fileHash.path))
      .not.toContain(VENREPLAY_MANIFEST_FILE_PATH);
  });
});
