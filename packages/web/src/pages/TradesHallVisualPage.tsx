import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  Boxes,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Cuboid,
  Eye,
  EyeOff,
  FileCheck2,
  Layers3,
  Lightbulb,
  Route,
  Share2,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { GrandHallRoom } from "../components/GrandHallRoom.js";
import {
  computeCameraTarget,
  computeDefaultCameraPosition,
  computeDistanceLimits,
} from "../components/CameraRig.js";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../components/scene/SparkSplatLayer.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import {
  TRADES_HALL_VISUAL_DEMO_STATE,
  visualEventPhasesFromGraph,
  visualPhaseById,
  type VisualCommandMode,
  type VisualEventPhase,
  type VisualInsightCard,
  type VisualOverlayKey,
} from "../lib/trades-hall-visual-demo-state.js";
import {
  decideRuntimeAsset,
  runtimeRoomTargetFromSearchParams,
  type RuntimeRoomTarget,
} from "../lib/runtime-package-resolution.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import { getEventPhaseGraph } from "../api/events.js";
import { getTruthModeSummary } from "../api/truth-mode.js";
import { AIDraftPanel } from "../components/ai/AIDraftPanel.js";
import type { AgentTrajectory, EventPhaseGraph, EvidenceTargetType, GuestFlowPoint, RuntimePackage, TruthModeSummary } from "@omnitwin/types";
import "./TradesHallVisualPage.css";

type VisualLayerMode = "hybrid" | "mesh" | "splat";
type LoadStatus = "empty" | "invalid" | "loading" | "loaded" | "error";
type PhaseGraphLoadStatus = "fixture" | "loading" | "loaded" | "error";
type TruthSummaryStatus = "loading" | "loaded" | "fallback";

interface VisualState {
  readonly status: LoadStatus;
  readonly message: string;
  readonly splatCount: number | null;
}

type OverlayState = Readonly<Record<VisualOverlayKey, boolean>>;

interface TruthModeTargetOption {
  readonly id: "table" | "route" | "room" | "runtimeAsset" | "reviewGate";
  readonly label: string;
  readonly targetType: EvidenceTargetType;
  readonly targetId: string;
  readonly fallbackSource: string;
  readonly fallbackAssumption: string;
  readonly fallbackReviewGate: string;
}

const EMPTY_STATE: VisualState = {
  status: "empty",
  message: "No real asset loaded yet",
  splatCount: null,
};

const LAYER_MODES: readonly { readonly value: VisualLayerMode; readonly label: string; readonly icon: LucideIcon }[] = [
  { value: "mesh", label: "Mesh", icon: Cuboid },
  { value: "splat", label: "Splat", icon: Sparkles },
  { value: "hybrid", label: "Hybrid", icon: Layers3 },
] as const;

const COMMAND_MODE_ICONS: Readonly<Record<VisualCommandMode, LucideIcon>> = {
  design: Box,
  guests: Users,
  flow: Waypoints,
  evidence: FileCheck2,
  lighting: Lightbulb,
  ops: ClipboardList,
  costs: CircleDollarSign,
  share: Share2,
};

const INSIGHT_ICONS: Readonly<Record<VisualInsightCard["id"], LucideIcon>> = {
  guestFlow: Users,
  evidencePack: ShieldQuestion,
  opsCompiler: BriefcaseBusiness,
  revenueScenario: ChartNoAxesCombined,
};

const INITIAL_OVERLAYS: OverlayState = {
  guestFlow: true,
  routeClearance: true,
  heritageBuffer: true,
  densityHeatmap: true,
  lightingProbes: true,
  agentReplay: true,
};

const VISUAL_STAGE_ASPECT = 16 / 9;
const VISUAL_CAMERA_BASE_POSITION = computeDefaultCameraPosition(GRAND_HALL_RENDER_DIMENSIONS, VISUAL_STAGE_ASPECT);
const VISUAL_CAMERA_POSITION = [
  VISUAL_CAMERA_BASE_POSITION[0],
  VISUAL_CAMERA_BASE_POSITION[1] * 1.42,
  VISUAL_CAMERA_BASE_POSITION[2],
] as const;
const VISUAL_CAMERA_TARGET = computeCameraTarget(GRAND_HALL_RENDER_DIMENSIONS, VISUAL_STAGE_ASPECT);
const VISUAL_CAMERA_DISTANCE_LIMITS = computeDistanceLimits(GRAND_HALL_RENDER_DIMENSIONS);
const REPLAY_OVERLAY_BOUNDS = { width: 22, height: 12 } as const;

function statusTone(status: LoadStatus): string {
  switch (status) {
    case "loaded":
      return "#8fd69d";
    case "loading":
      return "#e6bc63";
    case "invalid":
    case "error":
      return "#ef9c91";
    case "empty":
      return "#d7c9b6";
  }
}

function displayStatus(state: VisualState): string {
  if (state.status === "loaded" && state.splatCount !== null) {
    return `${state.message} (${state.splatCount.toLocaleString()} splats)`;
  }
  return state.message;
}

function insightMode(insightId: VisualInsightCard["id"]): VisualCommandMode {
  switch (insightId) {
    case "guestFlow":
      return "flow";
    case "evidencePack":
      return "evidence";
    case "opsCompiler":
      return "ops";
    case "revenueScenario":
      return "costs";
  }
}

function selectedModeLabel(mode: VisualCommandMode): string {
  return TRADES_HALL_VISUAL_DEMO_STATE.commandModes.find((item) => item.id === mode)?.label ?? "Design";
}

function overlayPoint(point: GuestFlowPoint): { readonly left: number; readonly top: number } {
  return {
    left: Math.max(4, Math.min(96, (point.x / REPLAY_OVERLAY_BOUNDS.width) * 100)),
    top: Math.max(4, Math.min(96, 100 - ((point.y / REPLAY_OVERLAY_BOUNDS.height) * 100))),
  };
}

function agentPointAtProgress(trajectory: AgentTrajectory, progress: number): GuestFlowPoint {
  const index = Math.min(
    trajectory.points.length - 1,
    Math.max(0, Math.round((trajectory.points.length - 1) * progress)),
  );
  return trajectory.points[index] ?? { x: 0, y: 0 };
}

function flowLineStyle(trajectory: AgentTrajectory): CSSProperties {
  const start = overlayPoint(agentPointAtProgress(trajectory, 0));
  const end = overlayPoint(agentPointAtProgress(trajectory, 1));
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  return {
    left: `${String(start.left)}%`,
    top: `${String(start.top)}%`,
    width: `${String(Math.max(12, Math.hypot(dx, dy)))}%`,
    transform: `rotate(${String(Math.atan2(dy, dx) * (180 / Math.PI))}deg)`,
  };
}

function pointStyle(point: GuestFlowPoint): CSSProperties {
  const position = overlayPoint(point);
  return {
    left: `${String(position.left)}%`,
    top: `${String(position.top)}%`,
  };
}

function slugForTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function buildTruthModeTargets(input: {
  readonly phase: VisualEventPhase;
  readonly runtimeTarget: RuntimeRoomTarget;
  readonly assetDecision: ReturnType<typeof decideRuntimeAsset>;
  readonly publishedPackage: RuntimePackage | null;
}): readonly TruthModeTargetOption[] {
  const reviewGate = TRADES_HALL_VISUAL_DEMO_STATE.reviewGates[1] ?? TRADES_HALL_VISUAL_DEMO_STATE.reviewGates[0];
  const reviewGateLabel = reviewGate?.label ?? "Review gate";
  const runtimeAssetTargetId = input.publishedPackage?.id ??
    input.assetDecision.splatUrl ??
    `${input.runtimeTarget.room}:runtime-asset`;

  return [
    {
      id: "table",
      label: "Selected table",
      targetType: "table",
      targetId: slugForTarget(TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.label),
      fallbackSource: "Selected table overlay from the current planner scene.",
      fallbackAssumption: `${TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.guests.toLocaleString("en-GB")} guests are shown for this table in the internal scene.`,
      fallbackReviewGate: "Table-level evidence is not reviewed.",
    },
    {
      id: "route",
      label: "Selected route",
      targetType: "route",
      targetId: `${input.phase.id}:route-clearance`,
      fallbackSource: `Route overlay for ${input.phase.label}.`,
      fallbackAssumption: "Route-clearance evidence is not checked in this runtime view.",
      fallbackReviewGate: "Route clearance needs review before operational use.",
    },
    {
      id: "room",
      label: "Selected room",
      targetType: "room",
      targetId: input.runtimeTarget.room,
      fallbackSource: `${input.runtimeTarget.roomLabel} room context.`,
      fallbackAssumption: "Room geometry is shown as planning context unless a reviewed evidence item is linked.",
      fallbackReviewGate: "Room-level evidence has not been signed in this view.",
    },
    {
      id: "runtimeAsset",
      label: "Runtime asset",
      targetType: "runtime_asset",
      targetId: runtimeAssetTargetId,
      fallbackSource: input.assetDecision.splatUrl === null
        ? "No runtime visual asset is mounted for this room."
        : "Runtime visual asset is mounted as planning context.",
      fallbackAssumption: input.assetDecision.splatUrl === null
        ? "Procedural context remains the visible fallback."
        : "Loaded visual asset still needs provenance and review records.",
      fallbackReviewGate: "Runtime asset review state is separate from visual loading.",
    },
    {
      id: "reviewGate",
      label: "Review gate",
      targetType: "review_gate",
      targetId: slugForTarget(reviewGateLabel),
      fallbackSource: `${reviewGateLabel} review gate from the internal command shell.`,
      fallbackAssumption: "Gate state is visible as planning workflow context.",
      fallbackReviewGate: reviewGate?.owner ?? "Human review required.",
    },
  ];
}

function fallbackTruthModeSummary(input: {
  readonly target: TruthModeTargetOption;
  readonly visualState: VisualState;
  readonly phase: VisualEventPhase;
  readonly activeMode: VisualCommandMode;
}): TruthModeSummary {
  const runtimeLoaded = input.target.id === "runtimeAsset" && input.visualState.status === "loaded";
  const missingRuntime = input.target.id === "runtimeAsset" && input.visualState.status !== "loaded";
  const evidenceStatus = missingRuntime ? "missing" : runtimeLoaded ? "partial" : "not_checked";

  return {
    targetType: input.target.targetType,
    targetId: input.target.targetId,
    source: input.target.fallbackSource,
    confidence: runtimeLoaded ? "low" : "unknown",
    assumption: `${input.target.fallbackAssumption} Current mode: ${selectedModeLabel(input.activeMode)}; phase: ${input.phase.label}.`,
    evidenceStatus,
    reviewGate: input.target.fallbackReviewGate,
    staleState: runtimeLoaded ? "review_due" : "unknown",
    safeWording: [
      "Planning evidence",
      "Human review required",
      input.target.id === "route" ? "Route-clearance evidence is not checked" : "Evidence is not yet signed",
    ],
    humanReviewRequired: true,
    counts: {
      evidenceItems: 0,
      checkResults: 0,
      assumptions: 0,
      reviewGates: input.target.id === "reviewGate" || input.target.id === "route" ? 1 : 0,
      staleEvents: 0,
    },
  };
}

function truthSummaryStatusLabel(status: TruthSummaryStatus): string {
  switch (status) {
    case "loaded":
      return "runtime data";
    case "loading":
      return "loading";
    case "fallback":
      return "demo fallback";
  }
}

function VenueCommandTopBar({
  phase,
  visualState,
  runtimeTarget,
}: {
  readonly phase: VisualEventPhase;
  readonly visualState: VisualState;
  readonly runtimeTarget: RuntimeRoomTarget;
}): ReactElement {
  const runtimeLabel = visualState.status === "loaded" ||
    visualState.status === "loading" ||
    visualState.status === "invalid"
    ? visualState.message
    : "No real asset loaded yet";

  return (
    <header className="visual-topbar">
      <div className="visual-brand">
        <span className="visual-brand-mark" aria-hidden="true">
          <Boxes size={18} />
        </span>
        <div>
          <p className="visual-brand-title">Venviewer</p>
          <p className="visual-brand-subtitle">{TRADES_HALL_VISUAL_DEMO_STATE.shellLabel}</p>
        </div>
      </div>
      <div className="visual-topbar-cell">
        <div>
          <p className="visual-field-label">Venue</p>
          <p className="visual-field-value">{runtimeTarget.venue}</p>
        </div>
      </div>
      <div className="visual-topbar-cell">
        <div>
          <p className="visual-field-label">Room / phase</p>
          <p className="visual-field-value">{runtimeTarget.roomLabel} / {phase.label}</p>
        </div>
      </div>
      <div className="visual-topbar-cell">
        <span className="visual-review-pill">
          <ShieldQuestion size={15} aria-hidden="true" />
          Planning evidence / human review required
        </span>
      </div>
      <div className="visual-topbar-cell">
        <CheckCircle2 size={17} aria-hidden="true" color="#78d292" />
        <div>
          <p className="visual-field-label">Save status</p>
          <p className="visual-field-value">Internal draft saved</p>
        </div>
      </div>
      <div className="visual-runtime-cell">
        <p className="visual-field-label">Runtime asset</p>
        <p className="visual-field-value visual-runtime-status">{runtimeLabel}</p>
      </div>
      <div className="visual-top-icon" aria-hidden="true">
        <Layers3 size={23} />
      </div>
    </header>
  );
}

function VenueCommandRail({
  activeMode,
  onModeChange,
}: {
  readonly activeMode: VisualCommandMode;
  readonly onModeChange: (mode: VisualCommandMode) => void;
}): ReactElement {
  return (
    <nav className="visual-rail" aria-label="Visual command modes">
      <div className="visual-rail-list">
        {TRADES_HALL_VISUAL_DEMO_STATE.commandModes.map((mode) => {
          const Icon = COMMAND_MODE_ICONS[mode.id];
          return (
            <button
              key={mode.id}
              type="button"
              className={mode.id === activeMode ? "visual-rail-button is-active" : "visual-rail-button"}
              onClick={() => { onModeChange(mode.id); }}
              aria-pressed={mode.id === activeMode}
            >
              <Icon aria-hidden="true" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
      <div className="visual-user-token" aria-label="Internal user initials">VM</div>
    </nav>
  );
}

function CanvasLayerControls({
  mode,
  onModeChange,
}: {
  readonly mode: VisualLayerMode;
  readonly onModeChange: (mode: VisualLayerMode) => void;
}): ReactElement {
  return (
    <div className="visual-layer-controls" aria-label="Canvas layer controls">
      {LAYER_MODES.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            className={mode === item.value ? "is-active" : undefined}
            onClick={() => { onModeChange(item.value); }}
            aria-pressed={mode === item.value}
          >
            <Icon size={14} aria-hidden="true" /> {item.label}
          </button>
        );
      })}
    </div>
  );
}

function VenueCanvasOverlays({ overlays }: { readonly overlays: OverlayState }): ReactElement {
  const replay = TRADES_HALL_VISUAL_DEMO_STATE.guestFlowReplay;
  const flowTrajectories = replay.trajectories.slice(0, 4);
  const ghostTrajectories = replay.trajectories.slice(0, 8);
  const densityCells = replay.densityHeatmap.cells
    .filter((cell) => cell.level !== "low")
    .slice(0, 7);
  const reviewConflicts = replay.routeConflicts
    .filter((conflict) => conflict.severity !== "info")
    .slice(0, 3);

  return (
    <div className="visual-stage-overlay" aria-hidden="true">
      {overlays.guestFlow && (
        <>
          {flowTrajectories.map((trajectory) => (
            <span
              key={trajectory.agentId}
              className="visual-flow-line"
              style={flowLineStyle(trajectory)}
            />
          ))}
        </>
      )}
      {overlays.agentReplay && (
        <>
          {ghostTrajectories.map((trajectory, index) => (
            <span
              key={trajectory.agentId}
              className="visual-ghost-agent"
              style={pointStyle(agentPointAtProgress(trajectory, 0.42 + (index % 4) * 0.12))}
            />
          ))}
        </>
      )}
      {overlays.densityHeatmap && (
        <>
          <span className="visual-density-heatmap" />
          {densityCells.map((cell) => (
            <span
              key={`${String(cell.x)}:${String(cell.y)}:${String(cell.count)}`}
              className={`visual-density-cell ${cell.level}`}
              style={pointStyle(cell)}
            />
          ))}
        </>
      )}
      {overlays.routeClearance && (
        <>
          <span className="visual-callout clearance-a">
            <strong>1.20 m</strong>
            <span>route clearance</span>
          </span>
          <span className="visual-callout clearance-b">
            <strong>1.20 m</strong>
            <span>route clearance</span>
          </span>
        </>
      )}
      {overlays.heritageBuffer && (
        <>
          <span className="visual-callout heritage">
            <strong>Heritage buffer</strong>
            <span>Do not place</span>
          </span>
          <span className="visual-callout conflict">
            <strong>Route conflict</strong>
            <span>review required</span>
          </span>
          {reviewConflicts.map((conflict) => (
            <span
              key={conflict.id}
              className="visual-route-conflict-marker"
              style={pointStyle(conflict.point)}
            />
          ))}
        </>
      )}
      <span className="visual-callout table">
        <strong>{TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.label}</strong>
        <span>{TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.guests} guests</span>
        {TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.notes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </span>
      <span className="visual-selected-ring" />
      {overlays.lightingProbes && (
        <>
          <span className="visual-probe probe-a" />
          <span className="visual-probe probe-b" />
          <span className="visual-probe probe-c" />
        </>
      )}
    </div>
  );
}

function VenueOverlayLegend({
  overlays,
  onToggleOverlay,
}: {
  readonly overlays: OverlayState;
  readonly onToggleOverlay: (key: VisualOverlayKey) => void;
}): ReactElement {
  const replay = TRADES_HALL_VISUAL_DEMO_STATE.guestFlowReplay;
  const replayMetrics = replay.metrics;

  return (
    <section className="visual-overlay-legend" aria-label="Venue overlay legend">
      <h2>Overlays</h2>
      {TRADES_HALL_VISUAL_DEMO_STATE.overlayOptions.map((overlay) => {
        const visible = overlays[overlay.id];
        return (
          <div className="visual-overlay-row" key={overlay.id}>
            <Route size={17} aria-hidden="true" color={visible ? "#6bd9e8" : "#6f675f"} />
            <span>
              {overlay.label}
              <small>{overlay.description}</small>
            </span>
            <button
              type="button"
              className={visible ? "visual-overlay-button is-on" : "visual-overlay-button"}
              onClick={() => { onToggleOverlay(overlay.id); }}
              aria-label={`${visible ? "Hide" : "Show"} ${overlay.label}`}
              aria-pressed={visible}
            >
              {visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            </button>
          </div>
        );
      })}
      <div className="visual-replay-metrics" aria-label="Guest flow replay metrics">
        <p>{replay.disclosureLabel}</p>
        <span>Agents {replayMetrics.agentCount.toLocaleString("en-GB")}</span>
        <span>Bottleneck score {Math.round(replayMetrics.bottleneckScore * 100)}%</span>
        <span>Max density {replayMetrics.maxDensity.toFixed(2)} p/m2</span>
        <span>Route conflicts {replayMetrics.routeConflictCount}</span>
        <small>Human review required before operational reliance.</small>
      </div>
    </section>
  );
}

function ViewTool({ activeMode }: { readonly activeMode: VisualCommandMode }): ReactElement {
  return (
    <div className="visual-view-tool" aria-label="View shortcuts">
      <button type="button" className="is-active" aria-label="3D view">3D</button>
      <button type="button" aria-label="2D view">2D</button>
      <button type="button" aria-label={`Current mode ${selectedModeLabel(activeMode)}`}>
        <SlidersHorizontal size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

function RuntimeAssetPackagePanel({
  runtimeTarget,
  packageId,
  activeAssetUrl,
  opacity,
  visualState,
  onOpacityChange,
}: {
  readonly runtimeTarget: RuntimeRoomTarget;
  readonly packageId: string | null;
  readonly activeAssetUrl: string | null;
  readonly opacity: number;
  readonly visualState: VisualState;
  readonly onOpacityChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="visual-asset-form">
      <p className="visual-row-title">Registered runtime package</p>
      <div className="visual-runtime-details">
        <span>Room</span>
        <strong>{runtimeTarget.roomLabel}</strong>
      </div>
      <div className="visual-runtime-details">
        <span>Package</span>
        <strong>{packageId ?? "none"}</strong>
      </div>
      <p className="visual-url-copy">Current URL: {activeAssetUrl ?? "none"}</p>
      <p className="visual-url-copy">
        Manual runtime URLs are disabled here. Register an AssetVersion and RuntimePackage before Spark loads a
        room asset.
      </p>
      <p className="visual-url-copy" style={{ color: statusTone(visualState.status) }}>
        {displayStatus(visualState)}
      </p>
      <label className="visual-opacity" htmlFor="splat-opacity">
        <span>Splat opacity</span>
        <span>{Math.round(opacity * 100)}%</span>
        <input
          id="splat-opacity"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(event) => { onOpacityChange(Number(event.currentTarget.value)); }}
        />
      </label>
    </div>
  );
}

function TruthModePanel({
  activeMode,
  phase,
  truthTargets,
  selectedTruthTargetId,
  truthSummary,
  truthSummaryStatus,
  visualState,
  runtimeTarget,
  packageId,
  activeAssetUrl,
  opacity,
  onOpacityChange,
  onSelectTruthTarget,
}: {
  readonly activeMode: VisualCommandMode;
  readonly phase: VisualEventPhase;
  readonly truthTargets: readonly TruthModeTargetOption[];
  readonly selectedTruthTargetId: TruthModeTargetOption["id"];
  readonly truthSummary: TruthModeSummary;
  readonly truthSummaryStatus: TruthSummaryStatus;
  readonly visualState: VisualState;
  readonly runtimeTarget: RuntimeRoomTarget;
  readonly packageId: string | null;
  readonly activeAssetUrl: string | null;
  readonly opacity: number;
  readonly onOpacityChange: (value: number) => void;
  readonly onSelectTruthTarget: (targetId: TruthModeTargetOption["id"]) => void;
}): ReactElement {
  const selectedTruthTarget = truthTargets.find((target) => target.id === selectedTruthTargetId) ?? truthTargets[0];
  return (
    <aside className="visual-panel" aria-label="Truth Mode and visual evidence panel">
      <div className="visual-panel-inner">
        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Truth Mode</h2>
            <span className="visual-panel-badge">{truthSummary.counts.evidenceItems}</span>
          </div>
          <div className="visual-truth-targets" aria-label="Truth Mode selection">
            {truthTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                className={target.id === selectedTruthTargetId ? "is-active" : undefined}
                onClick={() => { onSelectTruthTarget(target.id); }}
                aria-pressed={target.id === selectedTruthTargetId}
              >
                {target.label}
              </button>
            ))}
          </div>
          <p className="visual-row-copy visual-truth-context">
            {truthSummaryStatusLabel(truthSummaryStatus)} for {selectedModeLabel(activeMode)} / {phase.label}
          </p>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><Box size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Source</p>
              <p className="visual-row-copy">{truthSummary.source}</p>
            </div>
            <span className={`visual-state-chip ${truthSummaryStatus}`}>{truthSummaryStatusLabel(truthSummaryStatus)}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ChartNoAxesCombined size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Confidence</p>
              <p className="visual-row-copy">{truthSummary.confidence}</p>
            </div>
            <span className="visual-state-chip draft">{truthSummary.confidence}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ClipboardList size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Assumption</p>
              <p className="visual-row-copy">{truthSummary.assumption}</p>
            </div>
            <span className="visual-state-chip simulated">{truthSummary.counts.assumptions}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><FileCheck2 size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Evidence status</p>
              <p className="visual-row-copy">{truthSummary.safeWording.join(" / ")}</p>
            </div>
            <span className={`visual-state-chip ${truthSummary.evidenceStatus}`}>{truthSummary.evidenceStatus}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ShieldQuestion size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Review gate</p>
              <p className="visual-row-copy">{truthSummary.reviewGate}</p>
            </div>
            <span className="visual-state-chip">{truthSummary.humanReviewRequired ? "review" : "clear"}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><Route size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Stale / current</p>
              <p className="visual-row-copy">
                {truthSummary.staleState === "current"
                  ? "Current evidence state for this selection."
                  : "Evidence may be missing, stale, or awaiting review."}
              </p>
            </div>
            <span className={`visual-state-chip ${truthSummary.staleState}`}>{truthSummary.staleState}</span>
          </div>
          {selectedTruthTarget !== undefined && (
            <div className="visual-ai-draft-panel">
              <AIDraftPanel
                title="AI Truth Mode draft"
                useCase="truth_mode_explanation"
                actionLabel="Draft explanation"
                context={{
                  selectedTarget: selectedTruthTarget.label,
                  targetType: selectedTruthTarget.targetType,
                  targetId: selectedTruthTarget.targetId,
                  source: truthSummary.source,
                  confidence: truthSummary.confidence,
                  assumption: truthSummary.assumption,
                  evidenceStatus: truthSummary.evidenceStatus,
                  staleState: truthSummary.staleState,
                  reviewGate: truthSummary.reviewGate,
                  humanReviewRequired: truthSummary.humanReviewRequired,
                  activeMode: selectedModeLabel(activeMode),
                  phase: phase.label,
                }}
              />
            </div>
          )}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Review gates</h2>
            <span className="visual-panel-badge">{TRADES_HALL_VISUAL_DEMO_STATE.reviewGates.length}</span>
          </div>
          {TRADES_HALL_VISUAL_DEMO_STATE.reviewGates.map((gate) => (
            <div className="visual-gate-row" key={gate.label}>
              <span className="visual-state-chip">●</span>
              <div>
                <p className="visual-row-title">{gate.label}</p>
                <p className="visual-row-copy">{gate.owner}</p>
              </div>
              <span className="visual-state-chip">{gate.state}</span>
            </div>
          ))}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Evidence status</h2>
          </div>
          {TRADES_HALL_VISUAL_DEMO_STATE.evidenceStatuses.map((status) => (
            <div className="visual-status-row" key={status.label}>
              <span className={`visual-state-chip ${status.state}`}>□</span>
              <p className="visual-row-title">{status.label}</p>
              <span className={`visual-state-chip ${status.state}`}>{status.state}</span>
            </div>
          ))}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Runtime asset</h2>
          </div>
          <RuntimeAssetPackagePanel
            runtimeTarget={runtimeTarget}
            packageId={packageId}
            activeAssetUrl={activeAssetUrl}
            opacity={opacity}
            visualState={visualState}
            onOpacityChange={onOpacityChange}
          />
        </section>
      </div>
    </aside>
  );
}

function EventPhaseGraph({
  phases,
  selectedPhaseId,
  onSelectPhase,
  loadStatus,
}: {
  readonly phases: readonly VisualEventPhase[];
  readonly selectedPhaseId: string;
  readonly onSelectPhase: (phaseId: string) => void;
  readonly loadStatus: PhaseGraphLoadStatus;
}): ReactElement {
  const statusCopy = loadStatus === "loaded"
    ? "Live event phase data"
    : loadStatus === "loading"
      ? "Loading event phase data"
      : loadStatus === "error"
        ? "Event phase data unavailable; showing internal demo fixture"
        : "Internal demo phase fixture";

  return (
    <section className="visual-phase-graph" aria-label="Event Phase Graph">
      <h2>Event Phase Graph</h2>
      <p className="visual-phase-source">{statusCopy}</p>
      <div className="visual-phase-track">
        {phases.map((phase, index) => (
          <button
            key={phase.id}
            type="button"
            className={phase.id === selectedPhaseId ? "visual-phase-card is-selected" : "visual-phase-card"}
            onClick={() => { onSelectPhase(phase.id); }}
            aria-pressed={phase.id === selectedPhaseId}
          >
            <span className="visual-phase-node">{index + 1}</span>
            <p className="visual-phase-title">{phase.label}</p>
            <p className="visual-phase-meta">Starts {phase.timeLabel}</p>
            <p className="visual-phase-meta">Duration {phase.durationLabel}</p>
            <p className="visual-phase-meta">Guests {phase.guestCountLabel}</p>
            <p className="visual-phase-meta">Density {phase.maxDensityLabel}</p>
            <p className="visual-phase-meta">{phase.staffConflictsLabel}</p>
            <p className="visual-phase-meta">Ops tasks {phase.opsTasks}</p>
            <p className="visual-phase-meta">Review gates {phase.reviewGates}</p>
            <p className={phase.reviewState === "ok" ? "visual-phase-ok" : "visual-phase-review"}>
              {phase.reviewState === "ok" ? "No phase gates" : "Review gates"}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function VisualInsightCards({
  activeOverlay,
  onInsightSelect,
}: {
  readonly activeOverlay: VisualOverlayKey;
  readonly onInsightSelect: (insight: VisualInsightCard) => void;
}): ReactElement {
  return (
    <section className="visual-insight-grid" aria-label="Visual insight cards">
      {TRADES_HALL_VISUAL_DEMO_STATE.insightCards.map((card) => {
        const Icon = INSIGHT_ICONS[card.id];
        return (
          <button
            key={card.id}
            type="button"
            className={`visual-insight-card ${card.tone}${activeOverlay === card.overlayKey ? " is-active" : ""}`}
            onClick={() => { onInsightSelect(card); }}
            aria-pressed={activeOverlay === card.overlayKey}
          >
            <span>
              <span className="visual-insight-icon"><Icon size={23} aria-hidden="true" /></span>
              <h3>{card.label}</h3>
            </span>
            <span>
              <p className="visual-insight-value">{card.value}</p>
              <p className="visual-insight-detail">{card.detail}</p>
            </span>
          </button>
        );
      })}
    </section>
  );
}

export function TradesHallVisualPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const runtimeTarget = useMemo(() => runtimeRoomTargetFromSearchParams(searchParams), [searchParams]);
  const [layerMode, setLayerMode] = useState<VisualLayerMode>("hybrid");
  const [opacity, setOpacity] = useState(0.82);
  const [activeMode, setActiveMode] = useState<VisualCommandMode>("design");
  const [selectedPhaseId, setSelectedPhaseId] = useState(TRADES_HALL_VISUAL_DEMO_STATE.defaultPhaseId);
  const [selectedTruthTargetId, setSelectedTruthTargetId] = useState<TruthModeTargetOption["id"]>("table");
  const [activeOverlay, setActiveOverlay] = useState<VisualOverlayKey>("guestFlow");
  const [overlays, setOverlays] = useState<OverlayState>(INITIAL_OVERLAYS);
  const [publishedPackage, setPublishedPackage] = useState<RuntimePackage | null>(null);
  const [phaseGraph, setPhaseGraph] = useState<EventPhaseGraph | null>(null);
  const [phaseGraphStatus, setPhaseGraphStatus] = useState<PhaseGraphLoadStatus>("fixture");
  const [truthSummary, setTruthSummary] = useState<TruthModeSummary | null>(null);
  const [truthSummaryStatus, setTruthSummaryStatus] = useState<TruthSummaryStatus>("fallback");
  const [visualState, setVisualState] = useState<VisualState>(() => {
    if (runtimeTarget.error !== null) {
      return { status: "invalid", message: runtimeTarget.error, splatCount: null };
    }
    return EMPTY_STATE;
  });

  const assetDecision = useMemo(
    () => decideRuntimeAsset(null, publishedPackage),
    [publishedPackage],
  );
  const eventPhases = useMemo(
    () => phaseGraph === null
      ? TRADES_HALL_VISUAL_DEMO_STATE.eventPhases
      : visualEventPhasesFromGraph(phaseGraph),
    [phaseGraph],
  );
  const selectedPhase = visualPhaseById(selectedPhaseId, eventPhases);
  const truthTargets = useMemo(
    () => buildTruthModeTargets({ phase: selectedPhase, runtimeTarget, assetDecision, publishedPackage }),
    [assetDecision, publishedPackage, runtimeTarget, selectedPhase],
  );
  const selectedTruthTarget = truthTargets.find((target) => target.id === selectedTruthTargetId) ?? truthTargets[0] ?? {
    id: "room",
    label: "Selected room",
    targetType: "room",
    targetId: runtimeTarget.room,
    fallbackSource: `${runtimeTarget.roomLabel} room context.`,
    fallbackAssumption: "Room geometry is shown as planning context unless a reviewed evidence item is linked.",
    fallbackReviewGate: "Human review required.",
  };
  const fallbackTruthSummary = useMemo(
    () => fallbackTruthModeSummary({
      target: selectedTruthTarget,
      visualState,
      phase: selectedPhase,
      activeMode,
    }),
    [activeMode, selectedPhase, selectedTruthTarget, visualState],
  );
  const displayedTruthSummary = truthSummary ?? fallbackTruthSummary;
  const meshVisible = layerMode === "hybrid" || layerMode === "mesh";
  const splatVisible = layerMode === "hybrid" || layerMode === "splat";

  useEffect(() => {
    if (runtimeTarget.error !== null) {
      setVisualState({ status: "invalid", message: runtimeTarget.error, splatCount: null });
      return;
    }
    if (assetDecision.source === "none") {
      setVisualState(EMPTY_STATE);
    }
  }, [assetDecision.source, runtimeTarget.error]);

  useEffect(() => {
    let cancelled = false;
    if (eventId === null || eventId.trim().length === 0) {
      setPhaseGraph(null);
      setPhaseGraphStatus("fixture");
      return () => { cancelled = true; };
    }

    setPhaseGraphStatus("loading");
    void getEventPhaseGraph(eventId)
      .then((graph) => {
        if (cancelled) return;
        setPhaseGraph(graph);
        setPhaseGraphStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setPhaseGraph(null);
        setPhaseGraphStatus("error");
      });

    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    if (eventPhases.some((phase) => phase.id === selectedPhaseId)) return;
    const firstPhase = eventPhases[0];
    setSelectedPhaseId(firstPhase?.id ?? TRADES_HALL_VISUAL_DEMO_STATE.defaultPhaseId);
  }, [eventPhases, selectedPhaseId]);

  useEffect(() => {
    let cancelled = false;
    setTruthSummary(null);
    setTruthSummaryStatus("loading");
    void getTruthModeSummary({
      targetType: selectedTruthTarget.targetType,
      targetId: selectedTruthTarget.targetId,
    })
      .then((summary) => {
        if (cancelled) return;
        setTruthSummary(summary);
        setTruthSummaryStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setTruthSummary(null);
        setTruthSummaryStatus("fallback");
      });

    return () => { cancelled = true; };
  }, [selectedTruthTarget.targetId, selectedTruthTarget.targetType]);

  // Fetch the latest usable runtime package for the selected room. A failure
  // or empty API result leaves publishedPackage null and keeps fallback.
  useEffect(() => {
    let cancelled = false;
    if (runtimeTarget.error !== null) {
      setPublishedPackage(null);
      return () => { cancelled = true; };
    }
    void getLatestRuntimePackage({ venue: runtimeTarget.venue, room: runtimeTarget.room })
      .then((pkg) => { if (!cancelled) setPublishedPackage(pkg); })
      .catch(() => { if (!cancelled) setPublishedPackage(null); });
    return () => { cancelled = true; };
  }, [runtimeTarget.error, runtimeTarget.room, runtimeTarget.venue]);

  // When a package asset becomes the active decision,
  // show a loading line until Spark resolves it; onLoad/onError refine it.
  useEffect(() => {
    if (assetDecision.source === "package" && assetDecision.splatUrl !== null) {
      setVisualState({ status: "loading", message: "Loading runtime asset", splatCount: null });
    }
  }, [assetDecision.source, assetDecision.splatUrl]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setVisualState({
      status: "loaded",
      message: assetDecision.evidenceLabel,
      splatCount: event.splatCount,
    });
  }, [assetDecision.evidenceLabel]);

  const handleError = useCallback((event: SparkSplatErrorEvent) => {
    setVisualState({
      status: "error",
      message: event.error.message,
      splatCount: null,
    });
  }, []);

  const toggleOverlay = useCallback((key: VisualOverlayKey) => {
    setActiveOverlay(key);
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const handleInsightSelect = useCallback((card: VisualInsightCard) => {
    setActiveMode(insightMode(card.id));
    setActiveOverlay(card.overlayKey);
    setOverlays((current) => ({ ...current, [card.overlayKey]: true }));
  }, []);

  return (
    <main className="visual-shell">
      <VenueCommandTopBar phase={selectedPhase} visualState={visualState} runtimeTarget={runtimeTarget} />
      <VenueCommandRail activeMode={activeMode} onModeChange={setActiveMode} />
      <section className="visual-stage" aria-label="Trades Hall visual command canvas">
        <div className="visual-canvas-frame">
          <Canvas
            dpr={[1, 2]}
            camera={{ fov: 42, near: 0.1, far: 180, position: VISUAL_CAMERA_POSITION }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#111415"]} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[6, 9, 6]} intensity={0.65} />
            {meshVisible && <GrandHallRoom />}
            {assetDecision.splatUrl !== null && (
              <SparkSplatLayer
                url={assetDecision.splatUrl}
                visible={splatVisible}
                opacity={opacity}
                onLoad={handleLoad}
                onError={handleError}
              />
            )}
            <OrbitControls
              makeDefault
              target={VISUAL_CAMERA_TARGET}
              minDistance={VISUAL_CAMERA_DISTANCE_LIMITS.minDistance}
              maxDistance={VISUAL_CAMERA_DISTANCE_LIMITS.maxDistance}
              maxPolarAngle={Math.PI * 0.49}
            />
          </Canvas>
        </div>
        <CanvasLayerControls mode={layerMode} onModeChange={setLayerMode} />
        <VenueCanvasOverlays overlays={overlays} />
        <VenueOverlayLegend overlays={overlays} onToggleOverlay={toggleOverlay} />
        <ViewTool activeMode={activeMode} />
      </section>
      <TruthModePanel
        activeMode={activeMode}
        phase={selectedPhase}
        truthTargets={truthTargets}
        selectedTruthTargetId={selectedTruthTarget.id}
        truthSummary={displayedTruthSummary}
        truthSummaryStatus={truthSummaryStatus}
        visualState={visualState}
        runtimeTarget={runtimeTarget}
        packageId={publishedPackage?.id ?? null}
        activeAssetUrl={assetDecision.splatUrl}
        opacity={opacity}
        onOpacityChange={setOpacity}
        onSelectTruthTarget={setSelectedTruthTargetId}
      />
      <footer className="visual-bottom">
        <EventPhaseGraph
          phases={eventPhases}
          selectedPhaseId={selectedPhaseId}
          onSelectPhase={setSelectedPhaseId}
          loadStatus={phaseGraphStatus}
        />
        <VisualInsightCards activeOverlay={activeOverlay} onInsightSelect={handleInsightSelect} />
      </footer>
    </main>
  );
}
