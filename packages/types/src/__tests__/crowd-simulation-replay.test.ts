import { describe, expect, it } from "vitest";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  CROWD_AGENT_PROFILE_TYPES,
  CROWD_BENCHMARK_SIMULATOR_SOURCE_NAMES,
  CROWD_FLOW_METRIC_NAMES,
  CROWD_FLOW_SCENARIO_TYPES,
  CROWD_OPEN_SOURCE_SIMULATOR_SOURCE_NAMES,
  CROWD_REPLAY_BUNDLE_LIFECYCLE_STATES,
  CROWD_SIMULATION_EVIDENCE_STATUSES,
  CROWD_SIMULATOR_SOURCE_NAMES,
  CrowdAgentProfileTypeSchema,
  CrowdFlowMetricNameSchema,
  CrowdFlowScenarioTypeSchema,
  CrowdReplayBundleLifecycleStateSchema,
  CrowdSimulationEvidenceStatusSchema,
  CrowdSimulatorSourceNameSchema,
} from "../crowd-simulation-replay.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Crowd Simulation Replay metadata vocabulary", () => {
  it("pins all documented flow scenario types", () => {
    expect(CROWD_FLOW_SCENARIO_TYPES).toEqual([
      "guest_arrival",
      "guest_seating",
      "bar_queue",
      "catering_route",
      "staff_setup",
      "supplier_load_in",
      "wheelchair_route",
      "room_flip",
      "exit_flow_planning_check",
    ]);

    for (const scenarioType of CROWD_FLOW_SCENARIO_TYPES) {
      expect(CrowdFlowScenarioTypeSchema.safeParse(scenarioType).success).toBe(true);
    }
  });

  it("pins all documented agent profile types", () => {
    expect(CROWD_AGENT_PROFILE_TYPES).toEqual([
      "guest",
      "staff",
      "wheelchair_user",
      "caterer",
      "supplier",
      "photographer",
      "av_technician",
      "venue_manager",
    ]);

    for (const profileType of CROWD_AGENT_PROFILE_TYPES) {
      expect(CrowdAgentProfileTypeSchema.safeParse(profileType).success).toBe(true);
    }
  });

  it("pins replay bundle lifecycle states without implying a simulator exists", () => {
    expect(CROWD_REPLAY_BUNDLE_LIFECYCLE_STATES).toEqual([
      "not_created",
      "scenario_defined",
      "inputs_ready",
      "simulation_run",
      "metrics_ready",
      "replay_ready",
      "bundle_stale",
      "bundle_superseded",
    ]);

    expect(CrowdReplayBundleLifecycleStateSchema.safeParse("replay_ready").success).toBe(true);
    expect(CrowdReplayBundleLifecycleStateSchema.safeParse("jupedsim").success).toBe(false);
  });

  it("pins all documented flow metrics", () => {
    expect(CROWD_FLOW_METRIC_NAMES).toEqual([
      "total_completion_time",
      "average_travel_time",
      "max_queue_length",
      "queue_wait_time",
      "density_hotspot_count",
      "bottleneck_count",
      "route_conflict_count",
      "accessibility_route_status",
      "staff_route_conflict_count",
      "catering_route_conflict_count",
      "egress_planning_warning_count",
    ]);

    for (const metricName of CROWD_FLOW_METRIC_NAMES) {
      expect(CrowdFlowMetricNameSchema.safeParse(metricName).success).toBe(true);
    }
  });

  it("keeps simulation evidence status separate from legal certification language", () => {
    expect(CROWD_SIMULATION_EVIDENCE_STATUSES).toEqual([
      "not_simulated",
      "scenario_ready",
      "simulation_running",
      "evidence_current",
      "evidence_partial",
      "evidence_stale",
      "evidence_failed",
      "human_review_required",
    ]);

    const bannedLegalStatuses = [
      "evacuation_certified",
      "fire_approved",
      "legally_compliant",
      "certified_evacuation_model",
      "regulator_approved",
    ] as const;

    for (const status of bannedLegalStatuses) {
      expect(CrowdSimulationEvidenceStatusSchema.safeParse(status).success).toBe(false);
    }
  });

  it("includes open-source and benchmark/professional simulator sources", () => {
    expect(CROWD_SIMULATOR_SOURCE_NAMES).toEqual([
      "jupedsim",
      "vadere",
      "recast_detour",
      "rvo2_orca",
      "anylogic",
      "pathfinder",
      "massmotion",
      "manual_estimate",
      "custom_venviewer_v0",
    ]);

    expect(CROWD_OPEN_SOURCE_SIMULATOR_SOURCE_NAMES).toEqual([
      "jupedsim",
      "vadere",
      "recast_detour",
      "rvo2_orca",
    ]);
    expect(CROWD_BENCHMARK_SIMULATOR_SOURCE_NAMES).toEqual([
      "anylogic",
      "pathfinder",
      "massmotion",
    ]);

    for (const sourceName of CROWD_SIMULATOR_SOURCE_NAMES) {
      expect(CrowdSimulatorSourceNameSchema.safeParse(sourceName).success).toBe(true);
    }
  });

  it("keeps Crowd Simulation evidence status separate from Layout Proof claim statuses", () => {
    expect(overlap(CROWD_SIMULATION_EVIDENCE_STATUSES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(CrowdSimulationEvidenceStatusSchema.safeParse("pass").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("evidence_current").success).toBe(false);
  });

  it("is metadata-only string vocabulary for future replay bundle work", () => {
    const everyValue = [
      ...CROWD_FLOW_SCENARIO_TYPES,
      ...CROWD_AGENT_PROFILE_TYPES,
      ...CROWD_REPLAY_BUNDLE_LIFECYCLE_STATES,
      ...CROWD_FLOW_METRIC_NAMES,
      ...CROWD_SIMULATION_EVIDENCE_STATUSES,
      ...CROWD_SIMULATOR_SOURCE_NAMES,
    ];

    expect(everyValue.every((value) => typeof value === "string")).toBe(true);
  });
});

