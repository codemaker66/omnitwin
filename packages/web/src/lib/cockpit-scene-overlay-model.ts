import type { AgentTrajectory, DensityHeatmapCell, RouteConflict } from "@omnitwin/types";
import type { CockpitMode, CockpitOverlayKey } from "./cockpit-modes.js";

// ---------------------------------------------------------------------------
// Cockpit scene-overlay model — pure selection + lens rules.
//
// Keeps the R3F overlay component thin: it asks this module which layers to
// draw (given the Layers toggles + the active lens) and which artifact slices
// to render, and renders the result. No WebGL here, so the rules are unit
// tested in isolation.
//
// Lens behaviour (the "lens change on one scene" idea): the flow family only
// appears in the Flow lens, review markers (route conflicts + heritage buffer)
// appear in Flow and Evidence, lighting probes only in Lighting. The Design
// lens stays clean for editing. Every layer still obeys its Layers toggle.
// ---------------------------------------------------------------------------

export interface CockpitOverlayLayers {
  readonly flowPaths: boolean;
  readonly agentMotes: boolean;
  readonly densityHeatmap: boolean;
  readonly routeConflicts: boolean;
  readonly heritageBuffer: boolean;
  readonly lightingProbes: boolean;
}

type OverlayVisibility = Record<CockpitOverlayKey, boolean>;

const FLOW_LENS: CockpitMode = "flow";
const EVIDENCE_LENS: CockpitMode = "evidence";
const LIGHTING_LENS: CockpitMode = "lighting";

function isFlowLens(mode: CockpitMode): boolean {
  return mode === FLOW_LENS;
}

function isReviewLens(mode: CockpitMode): boolean {
  return mode === FLOW_LENS || mode === EVIDENCE_LENS;
}

/** Decide which scene-overlay layers render, combining the Layers toggles with
 *  the active lens. A layer renders only when its toggle is on AND its lens is
 *  active. */
export function cockpitOverlayLayers(
  visibility: OverlayVisibility,
  activeMode: CockpitMode,
): CockpitOverlayLayers {
  return {
    flowPaths: visibility.guestFlow && isFlowLens(activeMode),
    agentMotes: visibility.agentReplay && isFlowLens(activeMode),
    densityHeatmap: visibility.densityHeatmap && isFlowLens(activeMode),
    routeConflicts: visibility.routeClearance && isReviewLens(activeMode),
    heritageBuffer: visibility.heritageBuffer && isReviewLens(activeMode),
    lightingProbes: visibility.lightingProbes && activeMode === LIGHTING_LENS,
  };
}

/** Whether the guest-flow replay artifact needs to be loaded at all. Lets the
 *  binding hook keep the replay worker idle outside the spatial-analysis lenses
 *  (perf: §8 of the cockpit design). */
export function shouldLoadReplay(visibility: OverlayVisibility, activeMode: CockpitMode): boolean {
  const layers = cockpitOverlayLayers(visibility, activeMode);
  return layers.flowPaths
    || layers.agentMotes
    || layers.densityHeatmap
    || layers.routeConflicts;
}

/** Multi-point trajectories suitable for floor polylines, capped. */
export function selectFlowTrajectories(
  trajectories: readonly AgentTrajectory[],
  max: number,
): readonly AgentTrajectory[] {
  return trajectories.filter((trajectory) => trajectory.points.length >= 2).slice(0, max);
}

/** Multi-point trajectories suitable for animated motes, capped independently. */
export function selectMoteTrajectories(
  trajectories: readonly AgentTrajectory[],
  max: number,
): readonly AgentTrajectory[] {
  return trajectories.filter((trajectory) => trajectory.points.length >= 2).slice(0, max);
}

/** Non-low density cells, hottest first, capped. */
export function selectDensityCells(
  cells: readonly DensityHeatmapCell[],
  max: number,
): readonly DensityHeatmapCell[] {
  return cells
    .filter((cell) => cell.level !== "low")
    .slice()
    .sort((a, b) => b.density - a.density)
    .slice(0, max);
}

const SEVERITY_RANK: Record<RouteConflict["severity"], number> = {
  review: 0,
  attention: 1,
  info: 2,
};

/** Review-worthy route conflicts (drops info), review before attention, capped. */
export function selectRouteConflicts(
  conflicts: readonly RouteConflict[],
  max: number,
): readonly RouteConflict[] {
  return conflicts
    .filter((conflict) => conflict.severity !== "info")
    .slice()
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, max);
}

export function densityLevelColor(level: DensityHeatmapCell["level"]): string {
  switch (level) {
    case "high":
      return "#e0654f";
    case "medium":
      return "#e0a24a";
    case "low":
      return "#6bd9e8";
  }
}

export function conflictSeverityColor(severity: RouteConflict["severity"]): string {
  switch (severity) {
    case "review":
      return "#e0654f";
    case "attention":
      return "#e0a24a";
    case "info":
      return "#6bd9e8";
  }
}
