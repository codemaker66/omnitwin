import { z } from "zod";

export const CROWD_FLOW_SCENARIO_TYPES = [
  "guest_arrival",
  "guest_seating",
  "bar_queue",
  "catering_route",
  "staff_setup",
  "supplier_load_in",
  "wheelchair_route",
  "room_flip",
  "exit_flow_planning_check",
] as const;

export const CrowdFlowScenarioTypeSchema = z.enum(CROWD_FLOW_SCENARIO_TYPES);
export type CrowdFlowScenarioType = z.infer<typeof CrowdFlowScenarioTypeSchema>;

export const CROWD_AGENT_PROFILE_TYPES = [
  "guest",
  "staff",
  "wheelchair_user",
  "caterer",
  "supplier",
  "photographer",
  "av_technician",
  "venue_manager",
] as const;

export const CrowdAgentProfileTypeSchema = z.enum(CROWD_AGENT_PROFILE_TYPES);
export type CrowdAgentProfileType = z.infer<typeof CrowdAgentProfileTypeSchema>;

export const CROWD_REPLAY_BUNDLE_LIFECYCLE_STATES = [
  "not_created",
  "scenario_defined",
  "inputs_ready",
  "simulation_run",
  "metrics_ready",
  "replay_ready",
  "bundle_stale",
  "bundle_superseded",
] as const;

export const CrowdReplayBundleLifecycleStateSchema = z.enum(
  CROWD_REPLAY_BUNDLE_LIFECYCLE_STATES,
);
export type CrowdReplayBundleLifecycleState = z.infer<
  typeof CrowdReplayBundleLifecycleStateSchema
>;

export const CROWD_FLOW_METRIC_NAMES = [
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
] as const;

export const CrowdFlowMetricNameSchema = z.enum(CROWD_FLOW_METRIC_NAMES);
export type CrowdFlowMetricName = z.infer<typeof CrowdFlowMetricNameSchema>;

export const CROWD_SIMULATION_EVIDENCE_STATUSES = [
  "not_simulated",
  "scenario_ready",
  "simulation_running",
  "evidence_current",
  "evidence_partial",
  "evidence_stale",
  "evidence_failed",
  "human_review_required",
] as const;

export const CrowdSimulationEvidenceStatusSchema = z.enum(
  CROWD_SIMULATION_EVIDENCE_STATUSES,
);
export type CrowdSimulationEvidenceStatus = z.infer<
  typeof CrowdSimulationEvidenceStatusSchema
>;

export const CROWD_SIMULATOR_SOURCE_NAMES = [
  "jupedsim",
  "vadere",
  "recast_detour",
  "rvo2_orca",
  "anylogic",
  "pathfinder",
  "massmotion",
  "manual_estimate",
  "custom_venviewer_v0",
] as const;

export const CrowdSimulatorSourceNameSchema = z.enum(CROWD_SIMULATOR_SOURCE_NAMES);
export type CrowdSimulatorSourceName = z.infer<typeof CrowdSimulatorSourceNameSchema>;

export const CROWD_OPEN_SOURCE_SIMULATOR_SOURCE_NAMES = [
  "jupedsim",
  "vadere",
  "recast_detour",
  "rvo2_orca",
] as const satisfies readonly CrowdSimulatorSourceName[];

export const CROWD_BENCHMARK_SIMULATOR_SOURCE_NAMES = [
  "anylogic",
  "pathfinder",
  "massmotion",
] as const satisfies readonly CrowdSimulatorSourceName[];

