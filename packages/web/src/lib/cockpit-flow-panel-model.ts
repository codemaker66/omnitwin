// ---------------------------------------------------------------------------
// cockpit-flow-panel-model — pure presentation model for the Flow lens panel.
//
// Turns a GuestFlowReplayArtifact into the labelled rows the panel renders, so
// the React component stays thin and the formatting/grouping is unit-testable
// without WebGL or a DOM. No new claims are minted here — every value is the
// simulator's own output, presented honestly (the artifact already carries its
// "simulated planning support" disclosure). Where the doors were placed
// mid-wall by assumption, every figure the doors decide is withheld: travel
// times, the density peak, the bottleneck score, the route conflicts and the
// queue waits. A figure or an "attention" count for doors nobody surveyed is a
// verdict on an assumed input (redteam fix-first 2), the same rule the
// Rigging lens applies to a WLL nobody recorded; the panel asks for the doors.
// ---------------------------------------------------------------------------

import type { GuestFlowReplayArtifact } from "@omnitwin/types";
import { countLabel } from "./count-label.js";

export type FlowConflictSeverity = "info" | "attention" | "review";

export interface FlowPanelMetricRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface FlowPanelConflictRow {
  readonly key: string;
  readonly severity: FlowConflictSeverity;
  readonly message: string;
}

export interface FlowPanelQueueRow {
  readonly key: string;
  readonly label: string;
  readonly agents: number;
  readonly waitLabel: string;
}

export interface FlowPanelAssumptionRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly source: string;
}

export interface FlowPanelModel {
  readonly summary: readonly FlowPanelMetricRow[];
  readonly conflicts: readonly FlowPanelConflictRow[];
  readonly conflictCounts: Readonly<Record<FlowConflictSeverity, number>>;
  readonly queues: readonly FlowPanelQueueRow[];
  readonly assumptions: readonly FlowPanelAssumptionRow[];
  readonly disclosure: string;
  /** Whether the room's doors were recorded or placed mid-wall by assumption. */
  readonly doors: "recorded" | "not-recorded";
}

/** Format a duration in seconds as a compact human string. */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${String(total)} s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(remainder)} s`;
}

/** Coarse, honest qualifier for the simulator's relative path-density peak.
 *  NOT an occupancy figure — it is path-occupancy from the replay sampling, so
 *  it is labelled "relative", never persons/m² against an egress band. */
export function densityHotspotLabel(hotspotCount: number): string {
  if (hotspotCount <= 0) return "none flagged";
  return countLabel(hotspotCount, "hotspot");
}

/** Doors count as recorded only when every door position came from the
 *  caller (a survey), never when any was assumed mid-wall. */
export function doorRecordFromAssumptions(
  assumptions: readonly { readonly key: string; readonly value: unknown; readonly source: string }[],
): "recorded" | "not-recorded" {
  const doors = assumptions.find((assumption) => assumption.key === "door_positions");
  if (doors === undefined) return "not-recorded";
  const value = typeof doors.value === "string" ? doors.value : String(doors.value);
  return doors.source === "caller-provided" && !/assumed/i.test(value) ? "recorded" : "not-recorded";
}

/** Whether the simulation's doors were surveyed, so its figures may be shown.
 *  The panel, the in-scene conflict markers and density patches, and the plan
 *  inset all ask this one question. */
export function flowFiguresAllowed(artifact: Pick<GuestFlowReplayArtifact, "assumptions">): boolean {
  return doorRecordFromAssumptions(artifact.assumptions) === "recorded";
}

function severityValue(severity: string): FlowConflictSeverity {
  return severity === "review" || severity === "attention" ? severity : "info";
}

const NO_CONFLICTS: Readonly<Record<FlowConflictSeverity, number>> = { info: 0, attention: 0, review: 0 };

export function buildFlowPanelModel(artifact: GuestFlowReplayArtifact): FlowPanelModel {
  const m = artifact.metrics;
  const doors = doorRecordFromAssumptions(artifact.assumptions);
  if (doors === "not-recorded") {
    return {
      summary: [],
      conflicts: [],
      conflictCounts: NO_CONFLICTS,
      queues: [],
      assumptions: [],
      disclosure: artifact.disclosureLabel,
      doors,
    };
  }

  const summary: FlowPanelMetricRow[] = [
    { key: "agents", label: "Simulated agents", value: m.agentCount.toLocaleString("en-GB") },
    { key: "travel-time", label: "Avg travel time", value: formatSeconds(m.averageTravelTimeSeconds) },
    { key: "travel-distance", label: "Avg travel distance", value: `${m.averageTravelDistanceM.toFixed(1)} m` },
  ];
  if (m.averageWalkingSpeedMps !== undefined) {
    summary.push({ key: "speed", label: "Avg walking speed", value: `${m.averageWalkingSpeedMps.toFixed(2)} m/s` });
  }
  summary.push(
    { key: "density", label: "Peak density (relative)", value: `${m.maxDensity.toFixed(2)} · ${densityHotspotLabel(m.densityHotspotCount)}` },
  );
  summary.push({ key: "bottleneck", label: "Bottleneck score", value: `${String(Math.round(m.bottleneckScore * 100))} / 100` });

  const conflictCounts: Record<FlowConflictSeverity, number> = { info: 0, attention: 0, review: 0 };
  const conflicts: FlowPanelConflictRow[] = artifact.routeConflicts.map((conflict, index) => {
    const severity = severityValue(conflict.severity);
    conflictCounts[severity] += 1;
    return { key: `${conflict.id}-${String(index)}`, severity, message: conflict.message };
  });

  const queues: FlowPanelQueueRow[] = artifact.queueZones.map((zone, index) => ({
    key: `${zone.id}-${String(index)}`,
    label: zone.label,
    agents: zone.estimatedAgents,
    waitLabel: formatSeconds(zone.estimatedWaitSeconds),
  }));

  const assumptions: FlowPanelAssumptionRow[] = artifact.assumptions.map((assumption, index) => ({
    key: `${assumption.key}-${String(index)}`,
    label: assumption.label,
    value: String(assumption.value),
    source: assumption.source,
  }));

  return {
    summary,
    conflicts,
    conflictCounts,
    queues,
    assumptions,
    disclosure: artifact.disclosureLabel,
    doors,
  };
}
