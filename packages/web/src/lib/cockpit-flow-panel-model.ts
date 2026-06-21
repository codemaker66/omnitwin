// ---------------------------------------------------------------------------
// cockpit-flow-panel-model — pure presentation model for the Flow lens panel.
//
// Turns a GuestFlowReplayArtifact into the labelled rows the panel renders, so
// the React component stays thin and the formatting/grouping is unit-testable
// without WebGL or a DOM. No new claims are minted here — every value is the
// simulator's own output, presented honestly (the artifact already carries its
// "simulated planning support" disclosure).
// ---------------------------------------------------------------------------

import type { GuestFlowReplayArtifact } from "@omnitwin/types";

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
  if (hotspotCount === 1) return "1 hotspot";
  return `${String(hotspotCount)} hotspots`;
}

function severityValue(severity: string): FlowConflictSeverity {
  return severity === "review" || severity === "attention" ? severity : "info";
}

export function buildFlowPanelModel(artifact: GuestFlowReplayArtifact): FlowPanelModel {
  const m = artifact.metrics;

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
    { key: "bottleneck", label: "Bottleneck score", value: `${String(Math.round(m.bottleneckScore * 100))} / 100` },
  );

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
  };
}
