import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSearchParams } from "react-router-dom";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
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
  Sparkles,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { GrandHallRoom } from "../components/GrandHallRoom.js";
import type { AdaptiveResolutionOptions } from "../components/AdaptiveResolution.js";
import { RoomMesh } from "../components/editor/RoomMesh.js";
import {
  computeCameraTarget,
  computeDefaultCameraPosition,
  computeDistanceLimits,
} from "../components/CameraRig.js";
import type { SparkSplatErrorEvent, SparkSplatLoadEvent } from "../components/scene/SparkSplatLayer.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import { roomGeometries } from "../data/room-geometries.js";
import {
  TRADES_HALL_GUEST_FLOW_REPLAY_INPUT,
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
  runtimeAssetCameraViewForRoom,
  runtimeAssetViewTransformForRoom,
  runtimeRoomTargetFromSearchParams,
  type RuntimeAssetCameraBounds,
  type RuntimeAssetCameraView,
  type RuntimeAssetViewTransform,
  type RuntimeRoomTarget,
} from "../lib/runtime-package-resolution.js";
import {
  runGuestFlowReplayInBrowser,
  type GuestFlowReplayRunMode,
} from "../lib/guest-flow-replay-worker.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import { getEventPhaseGraph } from "../api/events.js";
import { getLatestGuestFlowReplay } from "../api/guest-flow-replay.js";
import { getTruthModeSummary } from "../api/truth-mode.js";
import { AIDraftPanel } from "../components/ai/AIDraftPanel.js";
import {
  FloatingWidgetFrame,
  type FloatingWidgetPlacement,
} from "../components/shared/FloatingWidgetFrame.js";
import type { AgentTrajectory, EventPhaseGraph, EvidenceTargetType, GuestFlowPoint, GuestFlowReplayArtifact, RuntimePackage, TruthModeSummary } from "@omnitwin/types";
import "./TradesHallVisualPage.css";

const LazySparkSplatLayer = lazy(async () => {
  const module = await import("../components/scene/SparkSplatLayer.js");
  return { default: module.SparkSplatLayer };
});

type VisualLayerMode = "hybrid" | "mesh" | "splat";
type LoadStatus = "empty" | "invalid" | "loading" | "loaded" | "error";
type PhaseGraphLoadStatus = "fixture" | "loading" | "loaded" | "error";
type TruthSummaryStatus = "loading" | "loaded" | "fallback";
type ReplayStatus = "fixture" | "loading" | "api" | GuestFlowReplayRunMode | "error";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuidOrNull(value: string | null): string | null {
  if (value === null) return null;
  return UUID_PATTERN.test(value) ? value : null;
}

interface VisualState {
  readonly status: LoadStatus;
  readonly message: string;
  readonly splatCount: number | null;
}

type OverlayState = Readonly<Record<VisualOverlayKey, boolean>>;
type RuntimeSplatBounds = NonNullable<SparkSplatLoadEvent["localBounds"]>;

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
const RUNTIME_ASSET_DEFAULT_OVERLAYS: OverlayState = {
  guestFlow: false,
  routeClearance: false,
  heritageBuffer: false,
  densityHeatmap: false,
  lightingProbes: false,
  agentReplay: false,
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
const RUNTIME_SPLAT_FIT_MAX_DIMENSION = 42;
const RUNTIME_SPLAT_MIN_SCALE = 0.2;
const RUNTIME_SPLAT_MAX_SCALE = 4;
export const LEAN_VISUAL_SCENE_MAX_VIEWPORT_WIDTH = 1099;
export const TABLET_VISUAL_DPR = 0.75;
export const VISUAL_CANVAS_PERFORMANCE = {
  min: 0.25,
  debounce: 180,
} as const;
const GRAND_HALL_ROOM_GEOMETRY = roomGeometries["Grand Hall"];

export interface VisualCanvasGlOptions {
  readonly antialias: boolean;
  readonly powerPreference: "high-performance";
}

interface VisualMouseButtons {
  readonly LEFT: number;
  readonly MIDDLE: number;
  readonly RIGHT: number;
}

const LEAN_VISUAL_MOUSE_BUTTONS: VisualMouseButtons = {
  LEFT: -1,
  MIDDLE: -1,
  RIGHT: -1,
};

export function visualCanvasDprForViewportWidth(viewportWidth: number): [number, number] {
  if (viewportWidth > 480 && viewportWidth <= LEAN_VISUAL_SCENE_MAX_VIEWPORT_WIDTH) {
    return [TABLET_VISUAL_DPR, TABLET_VISUAL_DPR];
  }
  return [1, 1];
}

export function visualCanvasGlForViewportWidth(viewportWidth: number): VisualCanvasGlOptions {
  return {
    antialias: viewportWidth > LEAN_VISUAL_SCENE_MAX_VIEWPORT_WIDTH,
    powerPreference: "high-performance",
  };
}

export function visualAdaptiveResolutionForViewportWidth(viewportWidth: number): AdaptiveResolutionOptions {
  const [minDpr, maxDpr] = visualCanvasDprForViewportWidth(viewportWidth);
  return {
    enabled: false,
    minDpr,
    maxDpr,
  };
}

export function shouldUseSmoothVisualControls(viewportWidth: number): boolean {
  return viewportWidth > LEAN_VISUAL_SCENE_MAX_VIEWPORT_WIDTH;
}

export function visualMouseButtonsForViewportWidth(viewportWidth: number): VisualMouseButtons | undefined {
  return shouldUseSmoothVisualControls(viewportWidth) ? undefined : LEAN_VISUAL_MOUSE_BUTTONS;
}

export function shouldUseLeanVisualMesh(viewportWidth: number): boolean {
  return viewportWidth <= LEAN_VISUAL_SCENE_MAX_VIEWPORT_WIDTH;
}

function readVisualViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function useVisualViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(readVisualViewportWidth);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = (): void => { setViewportWidth(window.innerWidth); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, []);

  return viewportWidth;
}

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

function mergeRuntimeSplatBounds(
  urls: readonly string[],
  boundsByUrl: Readonly<Record<string, RuntimeSplatBounds>>,
): RuntimeSplatBounds | null {
  let merged: RuntimeSplatBounds | null = null;
  for (const url of urls) {
    const bounds = boundsByUrl[url];
    if (bounds === undefined) return null;
    merged = merged === null
      ? bounds
      : {
        min: [
          Math.min(merged.min[0], bounds.min[0]),
          Math.min(merged.min[1], bounds.min[1]),
          Math.min(merged.min[2], bounds.min[2]),
        ],
        max: [
          Math.max(merged.max[0], bounds.max[0]),
          Math.max(merged.max[1], bounds.max[1]),
          Math.max(merged.max[2], bounds.max[2]),
        ],
      };
  }
  return merged;
}

function fittedZUpRuntimeTransform(
  bounds: RuntimeSplatBounds | null,
  fallback: RuntimeAssetViewTransform,
): RuntimeAssetViewTransform {
  if (bounds === null) return fallback;

  const widthX = bounds.max[0] - bounds.min[0];
  const lengthY = bounds.max[1] - bounds.min[1];
  const maxFloorDimension = Math.max(widthX, lengthY);
  if (!Number.isFinite(maxFloorDimension) || maxFloorDimension <= 0) return fallback;

  const scale = Math.min(
    RUNTIME_SPLAT_MAX_SCALE,
    Math.max(RUNTIME_SPLAT_MIN_SCALE, RUNTIME_SPLAT_FIT_MAX_DIMENSION / maxFloorDimension),
  );
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerY = (bounds.min[1] + bounds.max[1]) / 2;

  return {
    position: [
      Number((-centerX * scale).toFixed(3)),
      Number((-bounds.min[2] * scale).toFixed(3)),
      Number((centerY * scale).toFixed(3)),
    ],
    rotation: fallback.rotation,
    scale: Number(scale.toFixed(4)),
    note: "Auto-fitted from Spark-loaded SOG bounds for internal visual QA; signed room-local alignment still required.",
  };
}

function replayStatusLabel(status: ReplayStatus): string {
  switch (status) {
    case "worker":
      return "Worker replay generated";
    case "main-thread-fallback":
      return "Deterministic fallback replay";
    case "api":
      return "Saved replay loaded";
    case "loading":
      return "Generating replay";
    case "error":
      return "Replay fallback fixture";
    case "fixture":
      return "Internal replay fixture";
  }
}

function overlayPoint(point: GuestFlowPoint): { readonly left: number; readonly top: number } {
  return {
    left: Math.max(4, Math.min(96, (point.x / REPLAY_OVERLAY_BOUNDS.width) * 100)),
    top: Math.max(4, Math.min(96, 100 - ((point.y / REPLAY_OVERLAY_BOUNDS.height) * 100))),
  };
}

function agentPointAtProgress(trajectory: AgentTrajectory, progress: number): GuestFlowPoint {
  const boundedProgress = Math.max(0, Math.min(1, progress));
  const index = Math.min(
    trajectory.points.length - 1,
    Math.max(0, Math.round((trajectory.points.length - 1) * boundedProgress)),
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

function truthSummaryStatusLabel(
  status: TruthSummaryStatus,
  targetId?: TruthModeTargetOption["id"],
): string {
  switch (status) {
    case "loaded":
      return "runtime data";
    case "loading":
      return "loading";
    case "fallback":
      return targetId === "runtimeAsset" ? "runtime package context" : "internal fixture context";
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

function VisualCalloutWidget({
  id,
  title,
  compactLabel,
  placement,
  tone,
  defaultMinimized = false,
  storageScope,
  autoCompact = false,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly compactLabel: string;
  readonly placement: FloatingWidgetPlacement;
  readonly tone?: "gold" | "danger";
  readonly defaultMinimized?: boolean;
  readonly storageScope?: string;
  readonly autoCompact?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const toneClassName = tone === undefined ? "" : `visual-callout-widget--${tone}`;
  return (
    <FloatingWidgetFrame
      id={`visual-callout-${id}`}
      title={title}
      compactLabel={compactLabel}
      defaultPlacement={placement}
      defaultMinimized={defaultMinimized}
      storageScope={storageScope}
      className={["visual-callout-widget", toneClassName].filter(Boolean).join(" ")}
      bodyClassName="visual-callout-widget__body"
      zIndex={7}
      autoCompact={autoCompact}
    >
      <div className="visual-callout">
        {children}
      </div>
    </FloatingWidgetFrame>
  );
}

function VenueCanvasOverlays({
  overlays,
  replay,
  replayProgress,
  planningCuesVisible,
  isNarrowViewport,
  cameraInteractionActive,
}: {
  readonly overlays: OverlayState;
  readonly replay: GuestFlowReplayArtifact;
  readonly replayProgress: number;
  readonly planningCuesVisible: boolean;
  readonly isNarrowViewport: boolean;
  readonly cameraInteractionActive: boolean;
}): ReactElement {
  const flowTrajectories = replay.trajectories.slice(0, 4);
  const ghostTrajectories = replay.trajectories.slice(0, 8);
  const densityCells = replay.densityHeatmap.cells
    .filter((cell) => cell.level !== "low")
    .slice(0, 7);
  const reviewConflicts = replay.routeConflicts
    .filter((conflict) => conflict.severity !== "info")
    .slice(0, 3);
  const calloutStorageScope = isNarrowViewport ? "mobile" : "desktop";
  const calloutDefaultMinimized = isNarrowViewport;
  const calloutPlacement = (desktop: FloatingWidgetPlacement, mobileOffsetY: number): FloatingWidgetPlacement => (
    isNarrowViewport
      ? { type: "anchor", anchor: "top-left", offsetX: 16, offsetY: mobileOffsetY }
      : desktop
  );

  return (
    <div className="visual-stage-overlay" aria-label="Venue spatial overlays">
      {!cameraInteractionActive && overlays.guestFlow && (
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
      {!cameraInteractionActive && overlays.agentReplay && (
        <>
          {ghostTrajectories.map((trajectory, index) => (
            <span
              key={trajectory.agentId}
              className="visual-ghost-agent"
              style={pointStyle(agentPointAtProgress(trajectory, (replayProgress + (index % 4) * 0.08) % 1))}
            />
          ))}
        </>
      )}
      {!cameraInteractionActive && overlays.densityHeatmap && (
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
          <VisualCalloutWidget
            id="route-clearance-a"
            title="Route clearance"
            compactLabel="1.20 m"
            placement={calloutPlacement({ type: "percent", xPercent: 0.16, yPercent: 0.62 }, 112)}
            defaultMinimized={calloutDefaultMinimized}
            storageScope={calloutStorageScope}
            autoCompact={cameraInteractionActive}
          >
            <strong>1.20 m</strong>
            <span>route clearance</span>
          </VisualCalloutWidget>
          <VisualCalloutWidget
            id="route-clearance-b"
            title="Route clearance"
            compactLabel="1.20 m"
            placement={calloutPlacement({ type: "percent", xPercent: 0.72, yPercent: 0.7 }, 154)}
            defaultMinimized={calloutDefaultMinimized}
            storageScope={calloutStorageScope}
            autoCompact={cameraInteractionActive}
          >
            <strong>1.20 m</strong>
            <span>route clearance</span>
          </VisualCalloutWidget>
        </>
      )}
      {overlays.heritageBuffer && (
        <>
          <VisualCalloutWidget
            id="heritage-buffer"
            title="Heritage buffer"
            compactLabel="Do not place"
            placement={calloutPlacement({ type: "percent", xPercent: 0.09, yPercent: 0.31 }, 196)}
            tone="gold"
            defaultMinimized={calloutDefaultMinimized}
            storageScope={calloutStorageScope}
            autoCompact={cameraInteractionActive}
          >
            <strong>Heritage buffer</strong>
            <span>Do not place</span>
          </VisualCalloutWidget>
          <VisualCalloutWidget
            id="route-conflict"
            title="Route conflict"
            compactLabel="Review"
            placement={calloutPlacement({ type: "percent", xPercent: 0.7, yPercent: 0.38 }, 238)}
            tone="danger"
            defaultMinimized={calloutDefaultMinimized}
            storageScope={calloutStorageScope}
            autoCompact={cameraInteractionActive}
          >
            <strong>Route conflict</strong>
            <span>review required</span>
          </VisualCalloutWidget>
          {!cameraInteractionActive && reviewConflicts.map((conflict) => (
            <span
              key={conflict.id}
              className="visual-route-conflict-marker"
              style={pointStyle(conflict.point)}
            />
          ))}
        </>
      )}
      {planningCuesVisible && (
        <>
          <VisualCalloutWidget
            id="selected-table"
            title={TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.label}
            compactLabel={TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.label}
            placement={calloutPlacement({ type: "percent", xPercent: 0.45, yPercent: 0.57 }, 280)}
            defaultMinimized={calloutDefaultMinimized}
            storageScope={calloutStorageScope}
            autoCompact={cameraInteractionActive}
          >
            <strong>{TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.label}</strong>
            <span>{TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.guests} guests</span>
            {TRADES_HALL_VISUAL_DEMO_STATE.selectedTable.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </VisualCalloutWidget>
          {!cameraInteractionActive && <span className="visual-selected-ring" />}
        </>
      )}
      {!cameraInteractionActive && overlays.lightingProbes && (
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
  replay,
  replayProgress,
  replayStatus,
  replayRunning,
  onReplayProgressChange,
  onToggleReplay,
  onResetReplay,
}: {
  readonly overlays: OverlayState;
  readonly onToggleOverlay: (key: VisualOverlayKey) => void;
  readonly replay: GuestFlowReplayArtifact;
  readonly replayProgress: number;
  readonly replayStatus: ReplayStatus;
  readonly replayRunning: boolean;
  readonly onReplayProgressChange: (progress: number) => void;
  readonly onToggleReplay: () => void;
  readonly onResetReplay: () => void;
}): ReactElement {
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
        <p>Simulated guest flow · planning evidence</p>
        <span>{replay.disclosureLabel}</span>
        <span>{replayStatusLabel(replayStatus)}</span>
        <span>Agents {replayMetrics.agentCount.toLocaleString("en-GB")}</span>
        <span>Bottleneck score {Math.round(replayMetrics.bottleneckScore * 100)}%</span>
        <span>Max density {replayMetrics.maxDensity.toFixed(2)} p/m2</span>
        <span>Route conflicts {replayMetrics.routeConflictCount}</span>
        <span>Navmesh {replay.navmesh.walkableCellCount.toLocaleString("en-GB")} walkable cells</span>
            <div className="visual-replay-controls" role="group" aria-label="Replay controls">
          <button type="button" onClick={onToggleReplay}>{replayRunning ? "Pause" : "Play"}</button>
          <input
            aria-label="Replay progress"
            type="range"
            min="0"
            max="100"
            value={Math.round(replayProgress * 100)}
            onChange={(event) => { onReplayProgressChange(Number(event.target.value) / 100); }}
          />
          <button type="button" onClick={onResetReplay}>Reset</button>
        </div>
        <small>Human review required before operational reliance.</small>
      </div>
    </section>
  );
}

function ReplayStatusStrip({
  replay,
  replayStatus,
}: {
  readonly replay: GuestFlowReplayArtifact;
  readonly replayStatus: ReplayStatus;
}): ReactElement {
  return (
    <section className="visual-replay-strip" aria-label="Guest flow replay status">
      <span>Simulated guest flow</span>
      <strong>{replayStatusLabel(replayStatus)}</strong>
      <span>Planning evidence</span>
      <span>Human review required</span>
      <span>{replay.metrics.routeConflictCount} conflict marker(s) - simulated</span>
    </section>
  );
}

function ViewTool({ activeMode }: { readonly activeMode: VisualCommandMode }): ReactElement {
  const activeModeLabel = selectedModeLabel(activeMode);
  return (
    <div className="visual-view-tool" aria-label="Visual view status">
      <span className="visual-view-tool__item is-active" aria-label="Current visual view: 3D">3D</span>
      <span className="visual-view-tool__item visual-view-tool__item--mode" aria-label={`Active command mode: ${activeModeLabel}`}>
        {activeModeLabel}
      </span>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampVectorToBounds(vector: Vector3, bounds: RuntimeAssetCameraBounds | null): boolean {
  if (bounds === null) return false;
  const x = clampNumber(vector.x, bounds.min[0], bounds.max[0]);
  const y = clampNumber(vector.y, bounds.min[1], bounds.max[1]);
  const z = clampNumber(vector.z, bounds.min[2], bounds.max[2]);
  const changed = x !== vector.x || y !== vector.y || z !== vector.z;
  if (changed) vector.set(x, y, z);
  return changed;
}

function vectorFromTuple(vector: Vector3, tuple: readonly [number, number, number]): void {
  vector.set(tuple[0], tuple[1], tuple[2]);
}

function smootherStep(value: number): number {
  const t = clampNumber(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function VisualCameraControls({
  position,
  target,
  fov,
  minDistance,
  maxDistance,
  runtimeCameraView,
  smoothControls,
  mouseButtons,
  onCameraInteractionChange,
}: {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly runtimeCameraView: RuntimeAssetCameraView | null;
  readonly smoothControls: boolean;
  readonly mouseButtons: VisualMouseButtons | undefined;
  readonly onCameraInteractionChange: (active: boolean) => void;
}): ReactElement {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const arrivalElapsedMsRef = useRef(0);
  const arrivalActiveRef = useRef(false);
  const userControlStartedRef = useRef(false);
  const cameraSettleTimerRef = useRef<number | null>(null);
  const arrivalPositionRef = useRef(new Vector3());
  const arrivalTargetRef = useRef(new Vector3());
  const settledPositionRef = useRef(new Vector3());
  const settledTargetRef = useRef(new Vector3());
  const animatedTargetRef = useRef(new Vector3());
  const targetBounds = runtimeCameraView?.targetBounds ?? null;
  const cameraBounds = runtimeCameraView?.cameraBounds ?? null;
  const cameraArrivalPosition = runtimeCameraView?.arrivalPosition ?? null;
  const cameraArrivalTarget = runtimeCameraView?.arrivalTarget ?? null;
  const hasCameraArrival = cameraArrivalPosition !== null &&
    cameraArrivalTarget !== null &&
    (runtimeCameraView?.arrivalDurationMs ?? 0) > 0;

  const clampRuntimeCamera = useCallback((): boolean => {
    let changed = false;
    const controls = controlsRef.current;
    if (controls !== null) {
      changed = clampVectorToBounds(controls.target, targetBounds) || changed;
    }
    changed = clampVectorToBounds(camera.position, cameraBounds) || changed;
    if (changed) {
      controls?.update();
      invalidate();
    }
    return changed;
  }, [camera, cameraBounds, invalidate, targetBounds]);

  useEffect(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.fov = fov;
    }
    vectorFromTuple(settledPositionRef.current, position);
    vectorFromTuple(settledTargetRef.current, target);
    const startPosition = hasCameraArrival ? cameraArrivalPosition : position;
    const startTarget = hasCameraArrival ? cameraArrivalTarget : target;
    vectorFromTuple(arrivalPositionRef.current, startPosition);
    vectorFromTuple(arrivalTargetRef.current, startTarget);
    camera.position.copy(arrivalPositionRef.current);
    camera.lookAt(arrivalTargetRef.current);
    camera.updateProjectionMatrix();
    const controls = controlsRef.current;
    if (controls !== null) {
      controls.target.copy(arrivalTargetRef.current);
      clampRuntimeCamera();
      controls.update();
    }
    arrivalElapsedMsRef.current = 0;
    arrivalActiveRef.current = hasCameraArrival;
    userControlStartedRef.current = false;
    invalidate();
  }, [
    camera,
    cameraArrivalPosition,
    cameraArrivalTarget,
    clampRuntimeCamera,
    fov,
    hasCameraArrival,
    invalidate,
    position,
    target,
  ]);

  useEffect(() => () => {
    if (cameraSettleTimerRef.current !== null) {
      window.clearTimeout(cameraSettleTimerRef.current);
      cameraSettleTimerRef.current = null;
    }
    onCameraInteractionChange(false);
  }, [onCameraInteractionChange]);

  useFrame((_state, delta) => {
    if (runtimeCameraView === null) return;
    const controls = controlsRef.current;
    if (arrivalActiveRef.current && !userControlStartedRef.current) {
      arrivalElapsedMsRef.current += delta * 1000;
      const progress = runtimeCameraView.arrivalDurationMs <= 0
        ? 1
        : arrivalElapsedMsRef.current / runtimeCameraView.arrivalDurationMs;
      const easedProgress = smootherStep(progress);
      camera.position.lerpVectors(arrivalPositionRef.current, settledPositionRef.current, easedProgress);
      if (controls !== null) {
        controls.target.lerpVectors(arrivalTargetRef.current, settledTargetRef.current, easedProgress);
        controls.update();
      } else {
        animatedTargetRef.current.lerpVectors(arrivalTargetRef.current, settledTargetRef.current, easedProgress);
        camera.lookAt(animatedTargetRef.current);
      }
      clampRuntimeCamera();
      invalidate();
      if (progress >= 1) {
        arrivalActiveRef.current = false;
      }
      return;
    }
    if (arrivalActiveRef.current && userControlStartedRef.current) {
      arrivalActiveRef.current = false;
    }
    clampRuntimeCamera();
  });

  const handleControlsStart = useCallback((): void => {
    userControlStartedRef.current = true;
    arrivalActiveRef.current = false;
    if (cameraSettleTimerRef.current !== null) {
      window.clearTimeout(cameraSettleTimerRef.current);
      cameraSettleTimerRef.current = null;
    }
    onCameraInteractionChange(true);
  }, [onCameraInteractionChange]);

  const handleControlsEnd = useCallback((): void => {
    if (cameraSettleTimerRef.current !== null) {
      window.clearTimeout(cameraSettleTimerRef.current);
    }
    cameraSettleTimerRef.current = window.setTimeout(() => {
      cameraSettleTimerRef.current = null;
      onCameraInteractionChange(false);
    }, smoothControls ? 120 : 40);
  }, [onCameraInteractionChange, smoothControls]);

  const handleControlsChange = useCallback((): void => {
    if (runtimeCameraView !== null) {
      clampRuntimeCamera();
    }
    invalidate();
  }, [clampRuntimeCamera, invalidate, runtimeCameraView]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      regress={smoothControls}
      enableDamping={smoothControls}
      dampingFactor={smoothControls ? runtimeCameraView?.dampingFactor ?? 0.14 : 0}
      target={target}
      minDistance={minDistance}
      maxDistance={maxDistance}
      panSpeed={runtimeCameraView?.panSpeed}
      rotateSpeed={runtimeCameraView?.rotateSpeed}
      zoomSpeed={runtimeCameraView?.zoomSpeed}
      mouseButtons={mouseButtons}
      minPolarAngle={runtimeCameraView?.minPolarAngle ?? 0}
      maxPolarAngle={runtimeCameraView?.maxPolarAngle ?? Math.PI * 0.49}
      onStart={handleControlsStart}
      onChange={handleControlsChange}
      onEnd={handleControlsEnd}
    />
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
            {truthSummaryStatusLabel(truthSummaryStatus, selectedTruthTarget?.id)} for {selectedModeLabel(activeMode)} / {phase.label}
          </p>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><Box size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Source</p>
              <p className="visual-row-copy">{truthSummary.source}</p>
            </div>
            <span className={`visual-state-chip ${truthSummaryStatus}`}>
              {truthSummaryStatusLabel(truthSummaryStatus, selectedTruthTarget?.id)}
            </span>
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
  const viewportWidth = useVisualViewportWidth();
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
  const [guestFlowReplay, setGuestFlowReplay] = useState<GuestFlowReplayArtifact>(TRADES_HALL_VISUAL_DEMO_STATE.guestFlowReplay);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>("fixture");
  const [replayProgress, setReplayProgress] = useState(0.42);
  const [replayRunning, setReplayRunning] = useState(false);
  const [visualCameraInteractionActive, setVisualCameraInteractionActive] = useState(false);
  const [splatLoadCounts, setSplatLoadCounts] = useState<Record<string, number>>({});
  const [splatLoadBounds, setSplatLoadBounds] = useState<Record<string, RuntimeSplatBounds>>({});
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
  const activeSplatUrls = assetDecision.splatUrls;
  const activeSplatUrlKey = activeSplatUrls.join("|");
  const hasRegisteredRuntimeAsset = assetDecision.source === "package" && activeSplatUrls.length > 0;
  const baseRuntimeAssetViewTransform = useMemo(
    () => runtimeAssetViewTransformForRoom(runtimeTarget.room),
    [runtimeTarget.room],
  );
  const runtimeAssetCameraView = useMemo(
    () => runtimeAssetCameraViewForRoom(runtimeTarget.room),
    [runtimeTarget.room],
  );
  const mergedSplatBounds = useMemo(
    () => runtimeTarget.room === "reception-room"
      ? mergeRuntimeSplatBounds(activeSplatUrls, splatLoadBounds)
      : null,
    [activeSplatUrls, runtimeTarget.room, splatLoadBounds],
  );
  const runtimeAssetViewTransform = useMemo(
    () => fittedZUpRuntimeTransform(mergedSplatBounds, baseRuntimeAssetViewTransform),
    [baseRuntimeAssetViewTransform, mergedSplatBounds],
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
  const meshVisible = !hasRegisteredRuntimeAsset && (layerMode === "hybrid" || layerMode === "mesh");
  const splatVisible = activeSplatUrls.length > 0 && (
    hasRegisteredRuntimeAsset || layerMode === "hybrid" || layerMode === "splat"
  );
  const visualCameraPosition = hasRegisteredRuntimeAsset ? runtimeAssetCameraView.position : VISUAL_CAMERA_POSITION;
  const visualCameraTarget = hasRegisteredRuntimeAsset ? runtimeAssetCameraView.target : VISUAL_CAMERA_TARGET;
  const visualCameraDistanceLimits = hasRegisteredRuntimeAsset
    ? {
      minDistance: runtimeAssetCameraView.minDistance,
      maxDistance: runtimeAssetCameraView.maxDistance,
    }
    : VISUAL_CAMERA_DISTANCE_LIMITS;
  const visualRuntimeCameraView = hasRegisteredRuntimeAsset ? runtimeAssetCameraView : null;
  const visualCameraFov = visualRuntimeCameraView?.fov ?? 42;
  const visualCameraKey = hasRegisteredRuntimeAsset ? "runtime-asset-camera" : "procedural-camera";
  const visualCanvasDpr = visualCanvasDprForViewportWidth(viewportWidth);
  const visualCanvasGl = visualCanvasGlForViewportWidth(viewportWidth);
  const isNarrowVisualViewport = viewportWidth <= 640;
  const visualWidgetStorageScope = isNarrowVisualViewport ? "mobile" : "desktop";
  const layerControlsPlacement: FloatingWidgetPlacement = isNarrowVisualViewport
    ? { type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 22 }
    : { type: "anchor", anchor: "top-left", offsetX: 24, offsetY: 22 };
  const overlayLegendPlacement: FloatingWidgetPlacement = isNarrowVisualViewport
    ? { type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 66 }
    : { type: "anchor", anchor: "top-right", offsetX: 24, offsetY: 22 };
  const smoothVisualControls = hasRegisteredRuntimeAsset && shouldUseSmoothVisualControls(viewportWidth);
  const visualMouseButtons = hasRegisteredRuntimeAsset
    ? visualMouseButtonsForViewportWidth(viewportWidth)
    : LEAN_VISUAL_MOUSE_BUTTONS;
  const visualFallbackRoomGeometry = roomGeometries[runtimeTarget.roomLabel] ?? GRAND_HALL_ROOM_GEOMETRY;
  const visualFallbackRoomVariant = runtimeTarget.room === "grand-hall" ? "grand-hall" : "generic";

  useEffect(() => {
    let cancelled = false;
    setReplayStatus("loading");

    const loadReplay = async (): Promise<void> => {
      const scopedEventId = uuidOrNull(eventId);
      const scopedPhaseId = uuidOrNull(selectedPhaseId);
      const scopedConfigurationId = TRADES_HALL_GUEST_FLOW_REPLAY_INPUT.layout.configurationId;

      if (scopedEventId !== null || scopedPhaseId !== null || scopedConfigurationId !== null) {
        try {
          const stored = await getLatestGuestFlowReplay({
            eventId: scopedEventId,
            phaseId: scopedPhaseId,
            configurationId: scopedConfigurationId,
          });
          if (cancelled) return;
          setGuestFlowReplay(stored.artifact);
          setReplayStatus("api");
          return;
        } catch {
          // API/auth may be unavailable on the internal dev route. The local
          // deterministic worker keeps the surface useful without exposing data.
        }
      }

      try {
        const result = await runGuestFlowReplayInBrowser(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT);
        if (cancelled) return;
        setGuestFlowReplay(result.artifact);
        setReplayStatus(result.mode);
      } catch {
        if (cancelled) return;
        setGuestFlowReplay(TRADES_HALL_VISUAL_DEMO_STATE.guestFlowReplay);
        setReplayStatus("error");
      }
    };

    void loadReplay();
    return () => { cancelled = true; };
  }, [eventId, selectedPhaseId]);

  useEffect(() => {
    if (!replayRunning) return;
    const id = window.setInterval(() => {
      setReplayProgress((current) => Number(((current + 0.025) % 1).toFixed(3)));
    }, 220);
    return () => { window.clearInterval(id); };
  }, [replayRunning]);

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
    if (assetDecision.source === "package" && activeSplatUrls.length > 0) {
      setSplatLoadCounts({});
      setSplatLoadBounds({});
      setOverlays(RUNTIME_ASSET_DEFAULT_OVERLAYS);
      setOpacity(1);
      setSelectedTruthTargetId("runtimeAsset");
      setVisualState({
        status: "loading",
        message: `Loading runtime asset chunks (0/${activeSplatUrls.length.toLocaleString("en-GB")})`,
        splatCount: null,
      });
      setLayerMode("splat");
    }
  }, [activeSplatUrlKey, activeSplatUrls.length, assetDecision.source]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setSplatLoadCounts((current) => ({
      ...current,
      [event.url]: event.splatCount,
    }));
    if (event.localBounds !== null) {
      const bounds = event.localBounds;
      setSplatLoadBounds((current) => ({
        ...current,
        [event.url]: bounds,
      }));
    }
  }, []);

  useEffect(() => {
    if (assetDecision.source !== "package" || activeSplatUrls.length === 0) return;
    const loadedCount = activeSplatUrls.filter((url) => splatLoadCounts[url] !== undefined).length;
    if (loadedCount === 0) return;
    const totalSplats = activeSplatUrls.reduce((sum, url) => sum + (splatLoadCounts[url] ?? 0), 0);
    const allLoaded = loadedCount === activeSplatUrls.length;
    setVisualState({
      status: allLoaded ? "loaded" : "loading",
      message: allLoaded
        ? assetDecision.evidenceLabel
        : `Loading runtime asset chunks (${loadedCount.toLocaleString("en-GB")}/${activeSplatUrls.length.toLocaleString("en-GB")})`,
      splatCount: totalSplats,
    });
  }, [
    activeSplatUrlKey,
    activeSplatUrls,
    assetDecision.evidenceLabel,
    assetDecision.source,
    splatLoadCounts,
  ]);

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
            frameloop="demand"
            dpr={visualCanvasDpr}
            performance={VISUAL_CANVAS_PERFORMANCE}
            camera={{ fov: visualCameraFov, near: 0.1, far: 180, position: visualCameraPosition }}
            gl={visualCanvasGl}
          >
            <VisualCameraControls
              key={visualCameraKey}
              position={visualCameraPosition}
              target={visualCameraTarget}
              fov={visualCameraFov}
              minDistance={visualCameraDistanceLimits.minDistance}
              maxDistance={visualCameraDistanceLimits.maxDistance}
              runtimeCameraView={visualRuntimeCameraView}
              smoothControls={smoothVisualControls}
              mouseButtons={visualMouseButtons}
              onCameraInteractionChange={setVisualCameraInteractionActive}
            />
            <color attach="background" args={["#111415"]} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[6, 9, 6]} intensity={0.65} />
            {meshVisible && (
              visualFallbackRoomGeometry !== undefined ? (
                <RoomMesh
                  geometry={visualFallbackRoomGeometry}
                  variant={visualFallbackRoomVariant}
                  detail="lean"
                />
              ) : (
                <GrandHallRoom />
              )
            )}
            {activeSplatUrls.length > 0 ? (
              <Suspense fallback={null}>
                {activeSplatUrls.map((splatUrl, index) => (
                  <LazySparkSplatLayer
                    key={splatUrl}
                    url={splatUrl}
                    visible={splatVisible}
                    opacity={opacity}
                    position={runtimeAssetViewTransform.position}
                    rotation={runtimeAssetViewTransform.rotation}
                    scale={runtimeAssetViewTransform.scale}
                    includeRendererHost={index === 0}
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                ))}
              </Suspense>
            ) : null}
          </Canvas>
        </div>
        <FloatingWidgetFrame
          id="visual-layer-controls"
          title="Visual layer"
          compactLabel={layerMode}
          defaultPlacement={layerControlsPlacement}
          defaultMinimized={isNarrowVisualViewport}
          storageScope={visualWidgetStorageScope}
          zIndex={9}
          autoCompact={visualCameraInteractionActive}
        >
          <CanvasLayerControls mode={layerMode} onModeChange={setLayerMode} />
        </FloatingWidgetFrame>
        <VenueCanvasOverlays
          overlays={overlays}
          replay={guestFlowReplay}
          replayProgress={replayProgress}
          planningCuesVisible={!hasRegisteredRuntimeAsset}
          isNarrowViewport={isNarrowVisualViewport}
          cameraInteractionActive={visualCameraInteractionActive}
        />
        <FloatingWidgetFrame
          id="visual-overlay-legend"
          title="Overlay controls"
          compactLabel="Overlays"
          defaultPlacement={overlayLegendPlacement}
          defaultMinimized
          storageScope={visualWidgetStorageScope}
          zIndex={8}
          autoCompact={visualCameraInteractionActive}
        >
          <VenueOverlayLegend
            overlays={overlays}
            onToggleOverlay={toggleOverlay}
            replay={guestFlowReplay}
            replayProgress={replayProgress}
            replayStatus={replayStatus}
            replayRunning={replayRunning}
            onReplayProgressChange={setReplayProgress}
            onToggleReplay={() => { setReplayRunning((running) => !running); }}
            onResetReplay={() => {
              setReplayRunning(false);
              setReplayProgress(0);
            }}
          />
        </FloatingWidgetFrame>
        <FloatingWidgetFrame
          id="visual-view-status"
          title="View status"
          compactLabel="3D"
          defaultPlacement={{ type: "anchor", anchor: "bottom-left", offsetX: 24, offsetY: 24 }}
          defaultMinimized
          storageScope={visualWidgetStorageScope}
          zIndex={8}
          autoCompact={visualCameraInteractionActive}
        >
          <ViewTool activeMode={activeMode} />
        </FloatingWidgetFrame>
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
        <ReplayStatusStrip replay={guestFlowReplay} replayStatus={replayStatus} />
        <VisualInsightCards activeOverlay={activeOverlay} onInsightSelect={handleInsightSelect} />
      </footer>
    </main>
  );
}
