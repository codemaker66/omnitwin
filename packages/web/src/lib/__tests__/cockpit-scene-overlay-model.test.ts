import { describe, expect, it } from "vitest";
import type { AgentTrajectory, DensityHeatmapCell, RouteConflict } from "@omnitwin/types";
import { COCKPIT_OVERLAY_KEYS, type CockpitOverlayKey } from "../cockpit-modes.js";
import {
  cockpitOverlayLayers,
  conflictSeverityColor,
  densityLevelColor,
  selectDensityCells,
  selectFlowTrajectories,
  selectMoteTrajectories,
  selectRouteConflicts,
  shouldLoadReplay,
} from "../cockpit-scene-overlay-model.js";

function visibility(value: boolean): Record<CockpitOverlayKey, boolean> {
  return COCKPIT_OVERLAY_KEYS.reduce<Record<CockpitOverlayKey, boolean>>((acc, key) => {
    acc[key] = value;
    return acc;
  }, {} as Record<CockpitOverlayKey, boolean>);
}

function trajectory(agentId: string, pointCount: number): AgentTrajectory {
  return {
    agentId,
    profile: "guest",
    spawnId: "spawn-a",
    destinationId: "dest-a",
    points: Array.from({ length: pointCount }, (_unused, index) => ({ x: index, y: index, t: index })),
  };
}

function densityCell(level: DensityHeatmapCell["level"], density: number): DensityHeatmapCell {
  return { x: 0, y: 0, count: Math.round(density), density, level };
}

function conflict(id: string, severity: RouteConflict["severity"]): RouteConflict {
  return {
    id,
    conflictType: "route_crossing",
    severity,
    point: { x: 1, y: 1 },
    involvedAgentIds: ["a", "b"],
    message: "Simulated route crossing — human review required.",
  };
}

describe("cockpitOverlayLayers", () => {
  it("lights up the full flow family in the Flow lens when overlays are visible", () => {
    const layers = cockpitOverlayLayers(visibility(true), "flow");
    expect(layers.flowPaths).toBe(true);
    expect(layers.agentMotes).toBe(true);
    expect(layers.densityHeatmap).toBe(true);
    expect(layers.routeConflicts).toBe(true);
    expect(layers.heritageBuffer).toBe(true);
    expect(layers.lightingProbes).toBe(false);
  });

  it("keeps the editing scene clean in the Design lens", () => {
    const layers = cockpitOverlayLayers(visibility(true), "design");
    expect(layers.flowPaths).toBe(false);
    expect(layers.agentMotes).toBe(false);
    expect(layers.densityHeatmap).toBe(false);
    expect(layers.routeConflicts).toBe(false);
    expect(layers.heritageBuffer).toBe(false);
  });

  it("shows only review layers (conflicts + heritage) in the Evidence lens", () => {
    const layers = cockpitOverlayLayers(visibility(true), "evidence");
    expect(layers.flowPaths).toBe(false);
    expect(layers.agentMotes).toBe(false);
    expect(layers.routeConflicts).toBe(true);
    expect(layers.heritageBuffer).toBe(true);
  });

  it("shows lighting probes only in the Lighting lens", () => {
    expect(cockpitOverlayLayers(visibility(true), "lighting").lightingProbes).toBe(true);
    expect(cockpitOverlayLayers(visibility(true), "flow").lightingProbes).toBe(false);
  });

  it("respects the Layers toggle — a hidden overlay never renders even in its lens", () => {
    const partial = { ...visibility(true), guestFlow: false };
    const layers = cockpitOverlayLayers(partial, "flow");
    expect(layers.flowPaths).toBe(false);
    expect(layers.agentMotes).toBe(true);
  });
});

describe("shouldLoadReplay", () => {
  it("loads the replay only in spatial-analysis lenses", () => {
    expect(shouldLoadReplay(visibility(true), "flow")).toBe(true);
    expect(shouldLoadReplay(visibility(true), "evidence")).toBe(true);
    expect(shouldLoadReplay(visibility(true), "design")).toBe(false);
    expect(shouldLoadReplay(visibility(true), "costs")).toBe(false);
  });

  it("does not load when every relevant overlay is toggled off", () => {
    expect(shouldLoadReplay(visibility(false), "flow")).toBe(false);
  });

  it("does not load replay for the static heritage-only evidence guide", () => {
    const heritageOnly = { ...visibility(false), heritageBuffer: true };
    expect(cockpitOverlayLayers(heritageOnly, "evidence").heritageBuffer).toBe(true);
    expect(shouldLoadReplay(heritageOnly, "evidence")).toBe(false);
  });
});

describe("selectors", () => {
  it("keeps only multi-point flow trajectories, capped", () => {
    const input = [trajectory("a", 5), trajectory("b", 1), trajectory("c", 3), trajectory("d", 4)];
    const flow = selectFlowTrajectories(input, 2);
    expect(flow.map((t) => t.agentId)).toEqual(["a", "c"]);
  });

  it("caps mote trajectories independently", () => {
    const input = [trajectory("a", 3), trajectory("b", 3), trajectory("c", 3)];
    expect(selectMoteTrajectories(input, 2)).toHaveLength(2);
  });

  it("drops low-density cells and sorts the rest by density", () => {
    const cells = [
      densityCell("low", 0.2),
      densityCell("medium", 1.1),
      densityCell("high", 3.4),
      densityCell("medium", 0.9),
    ];
    const selected = selectDensityCells(cells, 10);
    expect(selected.map((c) => c.density)).toEqual([3.4, 1.1, 0.9]);
  });

  it("drops info conflicts and orders review before attention", () => {
    const conflicts = [
      conflict("c1", "info"),
      conflict("c2", "attention"),
      conflict("c3", "review"),
    ];
    const selected = selectRouteConflicts(conflicts, 10);
    expect(selected.map((c) => c.id)).toEqual(["c3", "c2"]);
  });
});

describe("tones", () => {
  it("maps density levels to distinct colours", () => {
    expect(densityLevelColor("high")).not.toEqual(densityLevelColor("medium"));
  });

  it("maps conflict severities to distinct colours", () => {
    expect(conflictSeverityColor("review")).not.toEqual(conflictSeverityColor("attention"));
  });
});
