import { describe, expect, it } from "vitest";
import { CrowdReplayBundleLifecycleStateSchema } from "../crowd-simulation-replay.js";
import { DataSufficiencyOutcomeSchema } from "../data-sufficiency.js";
import {
  SCENARIO_INSTANCE_ARTIFACT_REF_TYPES,
  SCENARIO_INSTANCE_ROUTE_MODEL_TYPES,
  SCENARIO_INSTANCE_SCHEMA_VERSION,
  SCENARIO_INSTANCE_SEED_POLICIES,
  SCENARIO_INSTANCE_STALENESS_TRIGGERS,
  ScenarioInstanceArtifactRefTypeSchema,
  ScenarioInstanceRouteModelTypeSchema,
  ScenarioInstanceSeedPolicySchema,
  ScenarioInstanceStalenessTriggerSchema,
  ScenarioInstanceV0Schema,
  type ScenarioInstanceV0,
} from "../scenario-instance.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "../scenario-template.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

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
    policyBundleDigest: null,
  },
  assumptionRefs: [
    {
      assumptionId: "assumption_attendance_120",
      category: "attendance",
      contentHash: HASH_C,
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
    routeModelHash: HASH_C,
    dataSufficiency: "degraded_evidence",
  },
  simulator: {
    simulatorName: "manual_estimate",
    simulatorVersion: "0.0.0",
    simulatorHash: null,
    parameters: {
      scenario: "bar_queue_after_speeches",
      deterministic: true,
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
      contentHash: HASH_A,
    },
    {
      refType: "metrics",
      ref: "r2://internal/venreplay/bar_queue_seed_42/metrics.json",
      contentHash: HASH_B,
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
    contentHash: HASH_C,
  },
  lifecycleState: "replay_ready",
  staleWhen: [
    "scenario_template_changed",
    "layout_snapshot_changed",
    "assumptions_changed",
    "route_model_changed",
    "simulator_parameters_changed",
  ],
};

describe("Scenario Instance schema", () => {
  it("pins scenario-instance vocabularies", () => {
    expect(SCENARIO_INSTANCE_ROUTE_MODEL_TYPES).toEqual([
      "not_required",
      "explicit_polyline",
      "explicit_graph_path",
      "connector_graph",
      "navmesh",
      "unsupported",
    ]);

    expect(SCENARIO_INSTANCE_SEED_POLICIES).toEqual([
      "no_seed_required",
      "single_seed",
      "seed_set",
      "deterministic_recipe",
    ]);

    expect(SCENARIO_INSTANCE_ARTIFACT_REF_TYPES).toEqual([
      "trajectory",
      "heatmap",
      "bottlenecks",
      "metrics",
      "replay_bundle",
      "geometry",
      "route_model",
      "witness_block",
    ]);

    expect(SCENARIO_INSTANCE_STALENESS_TRIGGERS).toEqual([
      "scenario_template_changed",
      "layout_snapshot_changed",
      "runtime_package_changed",
      "policy_bundle_changed",
      "assumptions_changed",
      "route_model_changed",
      "simulator_changed",
      "simulator_parameters_changed",
      "seed_policy_changed",
    ]);
  });

  it("parses a replay-ready scenario instance", () => {
    expect(ScenarioInstanceV0Schema.parse(REPLAY_READY_INSTANCE)).toEqual(REPLAY_READY_INSTANCE);
  });

  it("requires simulator metadata for simulation lifecycle states", () => {
    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      simulator: null,
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      lifecycleState: "scenario_defined",
      simulator: null,
      metricsSummary: [],
      artifactRefs: [],
      witnessBlockRef: null,
    }).success).toBe(true);
  });

  it("requires metrics and trajectory refs for replay-ready state", () => {
    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      metricsSummary: [],
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      artifactRefs: REPLAY_READY_INSTANCE.artifactRefs.filter(
        (artifactRef) => artifactRef.refType !== "trajectory",
      ),
    }).success).toBe(false);
  });

  it("pins seed policy behavior", () => {
    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      seed: {
        seedPolicy: "single_seed",
        seed: null,
        seedSet: [],
      },
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      seed: {
        seedPolicy: "seed_set",
        seed: null,
        seedSet: [1],
      },
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      seed: {
        seedPolicy: "no_seed_required",
        seed: 1,
        seedSet: [],
      },
    }).success).toBe(false);
  });

  it("requires witness and unsupported-route refs to be explicit", () => {
    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      witnessBlockRef: {
        refType: "metrics",
        ref: "wrong_ref_type",
        contentHash: null,
      },
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      routeModel: {
        routeModelType: "unsupported",
        routeModelId: null,
        routeModelHash: null,
        dataSufficiency: "not_checked",
      },
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      routeModel: {
        routeModelType: "unsupported",
        routeModelId: null,
        routeModelHash: null,
        dataSufficiency: "unsupported_request",
      },
    }).success).toBe(true);
  });

  it("rejects template-only fields and invalid hashes", () => {
    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      requiredFlowZones: [],
    }).success).toBe(false);

    expect(ScenarioInstanceV0Schema.safeParse({
      ...REPLAY_READY_INSTANCE,
      layoutSnapshotDigest: "not-a-hash",
    }).success).toBe(false);
  });

  it("uses metadata-only vocabularies and compatible status axes", () => {
    const vocabularies = [
      SCENARIO_INSTANCE_ROUTE_MODEL_TYPES,
      SCENARIO_INSTANCE_SEED_POLICIES,
      SCENARIO_INSTANCE_ARTIFACT_REF_TYPES,
      SCENARIO_INSTANCE_STALENESS_TRIGGERS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }

    for (const value of SCENARIO_INSTANCE_ROUTE_MODEL_TYPES) {
      expect(ScenarioInstanceRouteModelTypeSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_INSTANCE_SEED_POLICIES) {
      expect(ScenarioInstanceSeedPolicySchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_INSTANCE_ARTIFACT_REF_TYPES) {
      expect(ScenarioInstanceArtifactRefTypeSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_INSTANCE_STALENESS_TRIGGERS) {
      expect(ScenarioInstanceStalenessTriggerSchema.safeParse(value).success).toBe(true);
    }

    expect(CrowdReplayBundleLifecycleStateSchema.safeParse("replay_ready").success).toBe(true);
    expect(DataSufficiencyOutcomeSchema.safeParse("unsupported_request").success).toBe(true);
  });
});
