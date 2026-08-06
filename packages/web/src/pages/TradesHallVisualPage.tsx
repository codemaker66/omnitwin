import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
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
  TRADES_HALL_COMMAND_FIXTURE,
  visualPhaseById,
  type VisualCommandMode,
  type VisualEventPhase,
  type VisualInsightCard,
  type VisualOverlayKey,
  type VisualTruthSection,
} from "../lib/trades-hall-command-fixture.js";
import {
  parseRuntimeSplatUrl,
  runtimeSplatUrlFromSearchParams,
} from "../lib/runtime-visual-asset.js";
import "./TradesHallVisualPage.css";

type VisualLayerMode = "hybrid" | "mesh" | "splat";
type LoadStatus = "empty" | "invalid" | "loading" | "loaded" | "error";
type OverlayState = Readonly<Record<VisualOverlayKey, boolean>>;

interface VisualState {
  readonly status: LoadStatus;
  readonly message: string;
  readonly splatCount: number | null;
}

const EMPTY_STATE: VisualState = {
  status: "empty",
  message: TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.emptyLabel,
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

const TRUTH_ICONS: Readonly<Record<VisualTruthSection["id"], LucideIcon>> = {
  source: Box,
  verification: ShieldQuestion,
  confidence: ChartNoAxesCombined,
  assumptions: ClipboardList,
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
  VISUAL_CAMERA_BASE_POSITION[0] * 0.94,
  VISUAL_CAMERA_BASE_POSITION[1] * 1.54,
  VISUAL_CAMERA_BASE_POSITION[2] * 1.02,
] as const;
const VISUAL_CAMERA_TARGET = computeCameraTarget(GRAND_HALL_RENDER_DIMENSIONS, VISUAL_STAGE_ASPECT);
const VISUAL_CAMERA_DISTANCE_LIMITS = computeDistanceLimits(GRAND_HALL_RENDER_DIMENSIONS);

function statusTone(status: LoadStatus): string {
  switch (status) {
    case "loaded":
      return "#78d292";
    case "loading":
      return "#e8b55e";
    case "invalid":
    case "error":
      return "#ef8d82";
    case "empty":
      return "#d7c9b6";
  }
}

function displayStatus(state: VisualState): string {
  if (state.status === "loaded" && state.splatCount !== null) {
    return `${state.message} (${state.splatCount.toLocaleString("en-GB")} splats)`;
  }
  return state.message;
}

function selectedModeLabel(mode: VisualCommandMode): string {
  return TRADES_HALL_COMMAND_FIXTURE.commandModes.find((item) => item.id === mode)?.label ?? "Design";
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

function runtimeTopbarLabel(visualState: VisualState): string {
  switch (visualState.status) {
    case "loaded":
      return "Runtime asset loaded / not yet signed";
    case "loading":
      return TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.loadingLabel;
    case "invalid":
    case "error":
      return "Runtime asset unavailable";
    case "empty":
      return "No captured visual layer loaded";
  }
}

function VenueTopBar({
  phase,
  visualState,
}: {
  readonly phase: VisualEventPhase;
  readonly visualState: VisualState;
}): ReactElement {
  return (
    <header className="visual-topbar">
      <div className="visual-brand">
        <span className="visual-brand-mark" aria-hidden="true">
          <Boxes size={18} />
        </span>
        <p className="visual-brand-title">{TRADES_HALL_COMMAND_FIXTURE.venue.productName}</p>
      </div>

      <div className="visual-topbar-cell">
        <p className="visual-field-label">Venue</p>
        <p className="visual-field-value">{TRADES_HALL_COMMAND_FIXTURE.venue.name}</p>
      </div>

      <div className="visual-topbar-cell">
        <p className="visual-field-label">Event phase</p>
        <p className="visual-field-value">{TRADES_HALL_COMMAND_FIXTURE.venue.eventName} / {phase.label}</p>
      </div>

      <div className="visual-topbar-review">
        <span className="visual-review-pill">
          <ShieldQuestion size={15} aria-hidden="true" />
          Planning evidence / human review required
        </span>
      </div>

      <div className="visual-topbar-cell visual-topbar-cell--save">
        <CheckCircle2 size={17} aria-hidden="true" />
        <span>
          <p className="visual-field-label">Save status</p>
          <p className="visual-field-value">{TRADES_HALL_COMMAND_FIXTURE.saveStatus.label}</p>
        </span>
      </div>

      <div className="visual-topbar-cell visual-topbar-cell--runtime">
        <Layers3 size={17} aria-hidden="true" />
        <span>
          <p className="visual-field-label">Runtime asset</p>
          <p className="visual-field-value">{runtimeTopbarLabel(visualState)}</p>
        </span>
      </div>

      <button type="button" className="visual-top-icon" aria-label="Layer menu">
        <Layers3 size={23} />
      </button>
    </header>
  );
}

function VenueLeftRail({
  activeMode,
  onModeChange,
}: {
  readonly activeMode: VisualCommandMode;
  readonly onModeChange: (mode: VisualCommandMode) => void;
}): ReactElement {
  return (
    <nav className="visual-rail" aria-label="Visual command modes">
      <div className="visual-rail-mark" aria-hidden="true">
        <Boxes size={19} />
      </div>
      <div className="visual-rail-list">
        {TRADES_HALL_COMMAND_FIXTURE.commandModes.map((mode) => {
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
            <Icon size={14} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectedObjectCallout(): ReactElement {
  const table = TRADES_HALL_COMMAND_FIXTURE.selectedTable;
  return (
    <div className="visual-callout visual-callout--table" aria-hidden="true">
      <div className="visual-callout-kicker">Selected table</div>
      <strong>{table.label}</strong>
      <span>{table.guests} guests</span>
      {table.notes.map((note) => (
        <span key={note}>{note}</span>
      ))}
    </div>
  );
}

function CanvasOverlays({ overlays }: { readonly overlays: OverlayState }): ReactElement {
  const [primaryHeritage, secondaryHeritage] = TRADES_HALL_COMMAND_FIXTURE.heritageLabels;
  const [primaryMeasurement, secondaryMeasurement] = TRADES_HALL_COMMAND_FIXTURE.measurementLabels;

  return (
    <div className="visual-stage-overlay" aria-label="Visual planning overlays">
      {overlays.guestFlow && (
        <svg className="visual-flow-svg" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
          <path className="visual-flow-path main" d="M86 472 C 210 408, 274 388, 415 398 S 655 374, 812 264" />
          <path className="visual-flow-path alt" d="M215 508 C 350 465, 472 476, 602 432 S 790 391, 890 304" />
          <path className="visual-flow-path service" d="M612 154 C 642 238, 684 281, 777 314 S 861 410, 910 500" />
        </svg>
      )}

      {overlays.agentReplay && (
        <div className="visual-agent-layer" aria-hidden="true">
          <span className="visual-ghost-agent agent-a" />
          <span className="visual-ghost-agent agent-b" />
          <span className="visual-ghost-agent agent-c" />
          <span className="visual-ghost-agent agent-d" />
          <span className="visual-ghost-agent agent-e" />
          <span className="visual-ghost-agent agent-f" />
        </div>
      )}

      {overlays.densityHeatmap && (
        <div className="visual-density-wrap" aria-hidden="true">
          <span className="visual-density-heatmap" />
          <span className="visual-callout visual-callout--queue">
            <strong>Bar queue</strong>
            <span>Simulated wait - 4.2 min</span>
          </span>
        </div>
      )}

      {overlays.routeClearance && primaryMeasurement !== undefined && secondaryMeasurement !== undefined && (
        <>
          <span className="visual-callout visual-callout--clearance-a">
            <strong>{primaryMeasurement.label}</strong>
            <span>{primaryMeasurement.detail}</span>
          </span>
          <span className="visual-callout visual-callout--clearance-b">
            <strong>{secondaryMeasurement.label}</strong>
            <span>{secondaryMeasurement.detail}</span>
          </span>
        </>
      )}

      {overlays.heritageBuffer && primaryHeritage !== undefined && secondaryHeritage !== undefined && (
        <>
          <span className="visual-callout visual-callout--heritage-a">
            <strong>{primaryHeritage.label}</strong>
            <span>{primaryHeritage.detail}</span>
          </span>
          <span className="visual-callout visual-callout--heritage-b">
            <strong>{secondaryHeritage.label}</strong>
            <span>{secondaryHeritage.detail}</span>
          </span>
          <span className="visual-callout visual-callout--conflict">
            <strong>Route conflict</strong>
            <span>review required</span>
          </span>
        </>
      )}

      <SelectedObjectCallout />
      <span className="visual-selected-ring" aria-hidden="true" />

      {overlays.lightingProbes && (
        <>
          <span className="visual-probe probe-a" aria-hidden="true" />
          <span className="visual-probe probe-b" aria-hidden="true" />
          <span className="visual-probe probe-c" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

function CanvasOverlayLegend({
  overlays,
  onToggleOverlay,
}: {
  readonly overlays: OverlayState;
  readonly onToggleOverlay: (key: VisualOverlayKey) => void;
}): ReactElement {
  return (
    <section className="visual-overlay-legend" aria-label="Venue overlay legend">
      <div className="visual-mini-heading">Overlays</div>
      {TRADES_HALL_COMMAND_FIXTURE.overlayOptions.map((overlay) => {
        const visible = overlays[overlay.id];
        return (
          <div className="visual-overlay-row" key={overlay.id}>
            <Route size={15} aria-hidden="true" />
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
              {visible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function FloatingViewPalette({ activeMode }: { readonly activeMode: VisualCommandMode }): ReactElement {
  return (
    <div className="visual-view-palette" aria-label="Floating view palette">
      <button type="button" aria-label="2D preview">2D</button>
      <button type="button" className="is-active" aria-label="3D view"><Cuboid size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Measure view"><Route size={16} aria-hidden="true" /></button>
      <button type="button" aria-label={`Current mode ${selectedModeLabel(activeMode)}`}><SlidersHorizontal size={16} aria-hidden="true" /></button>
    </div>
  );
}

function AssetUrlForm({
  draftUrl,
  parsedDraftOk,
  parsedDraftError,
  activeAssetUrl,
  opacity,
  visualState,
  onDraftUrlChange,
  onSubmitUrl,
  onOpacityChange,
}: {
  readonly draftUrl: string;
  readonly parsedDraftOk: boolean;
  readonly parsedDraftError: string | null;
  readonly activeAssetUrl: string | null;
  readonly opacity: number;
  readonly visualState: VisualState;
  readonly onDraftUrlChange: (value: string) => void;
  readonly onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  readonly onOpacityChange: (value: number) => void;
}): ReactElement {
  return (
    <form className="visual-asset-form" onSubmit={onSubmitUrl}>
      <label htmlFor="splat-url" className="visual-row-title">Runtime splat URL</label>
      <div className="visual-url-row">
        <input
          id="splat-url"
          className="visual-url-input"
          value={draftUrl}
          onChange={(event) => { onDraftUrlChange(event.currentTarget.value); }}
          placeholder="https://.../scene.ply"
          spellCheck={false}
        />
        <button type="submit" className="visual-load-button" disabled={!parsedDraftOk}>
          Load
        </button>
      </div>
      {parsedDraftError !== null && <p className="visual-error-copy">{parsedDraftError}</p>}
      <p className="visual-url-copy">Current URL: {activeAssetUrl ?? "none"}</p>
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
    </form>
  );
}

function TruthModePanel({
  activeMode,
  phase,
  visualState,
  draftUrl,
  parsedDraftOk,
  parsedDraftError,
  activeAssetUrl,
  opacity,
  onDraftUrlChange,
  onSubmitUrl,
  onOpacityChange,
}: {
  readonly activeMode: VisualCommandMode;
  readonly phase: VisualEventPhase;
  readonly visualState: VisualState;
  readonly draftUrl: string;
  readonly parsedDraftOk: boolean;
  readonly parsedDraftError: string | null;
  readonly activeAssetUrl: string | null;
  readonly opacity: number;
  readonly onDraftUrlChange: (value: string) => void;
  readonly onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  readonly onOpacityChange: (value: number) => void;
}): ReactElement {
  const runtimeLoaded = visualState.status === "loaded";

  return (
    <aside className="visual-panel" aria-label="Truth Mode and visual evidence panel">
      <div className="visual-panel-inner">
        <section className="visual-panel-section visual-panel-section--hero">
          <div className="visual-panel-heading">
            <h2>Truth Mode</h2>
            <span className="visual-panel-menu" aria-hidden="true">?</span>
          </div>
          <p className="visual-panel-summary">
            {runtimeLoaded
              ? "Runtime asset URL mounted; signature and provenance are still outside this internal fixture."
              : "Procedural venue context only. No real asset loaded yet."}
          </p>
          <p className="visual-panel-summary visual-panel-summary--accent">
            {selectedModeLabel(activeMode)} mode / {phase.label}
          </p>
        </section>

        <section className="visual-panel-section">
          {TRADES_HALL_COMMAND_FIXTURE.truthSections.map((section) => {
            const Icon = TRUTH_ICONS[section.id];
            return (
              <div className="visual-truth-row" key={section.id}>
                <span className={`visual-truth-icon ${section.state}`}><Icon size={17} aria-hidden="true" /></span>
                <div>
                  <p className="visual-row-title">{section.label}</p>
                  <p className="visual-row-copy visual-row-copy--strong">{section.value}</p>
                  <p className="visual-row-copy">{section.detail}</p>
                </div>
              </div>
            );
          })}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Review gates</h2>
            <span className="visual-panel-badge">{TRADES_HALL_COMMAND_FIXTURE.reviewGates.length}</span>
          </div>
          {TRADES_HALL_COMMAND_FIXTURE.reviewGates.map((gate) => (
            <div className="visual-gate-row" key={gate.label}>
              <span className={`visual-gate-dot ${gate.state}`} aria-hidden="true" />
              <p className="visual-row-title">{gate.label}</p>
              <span className="visual-state-chip">{gate.owner}</span>
            </div>
          ))}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Evidence status</h2>
          </div>
          {TRADES_HALL_COMMAND_FIXTURE.evidenceStatuses.map((status) => (
            <div className="visual-status-row" key={status.label}>
              <span className={`visual-status-icon ${status.state}`} aria-hidden="true" />
              <p className="visual-row-title">{status.label}</p>
              <span className={`visual-state-chip ${status.state}`}>{status.state}</span>
            </div>
          ))}
        </section>

        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Runtime asset</h2>
          </div>
          <AssetUrlForm
            draftUrl={draftUrl}
            parsedDraftOk={parsedDraftOk}
            parsedDraftError={parsedDraftError}
            activeAssetUrl={activeAssetUrl}
            opacity={opacity}
            visualState={visualState}
            onDraftUrlChange={onDraftUrlChange}
            onSubmitUrl={onSubmitUrl}
            onOpacityChange={onOpacityChange}
          />
        </section>
      </div>
    </aside>
  );
}

function EventPhaseGraph({
  selectedPhaseId,
  onSelectPhase,
}: {
  readonly selectedPhaseId: string;
  readonly onSelectPhase: (phaseId: string) => void;
}): ReactElement {
  return (
    <section className="visual-phase-graph" aria-label="Event Phase Graph">
      <div className="visual-bottom-heading">
        <h2>Event Phase Graph</h2>
        <span>Total event duration: 6h 35m</span>
      </div>
      <div className="visual-phase-track">
        {TRADES_HALL_COMMAND_FIXTURE.eventPhases.map((phase, index) => (
          <button
            key={phase.id}
            type="button"
            className={phase.id === selectedPhaseId ? "visual-phase-card is-selected" : "visual-phase-card"}
            onClick={() => { onSelectPhase(phase.id); }}
            aria-pressed={phase.id === selectedPhaseId}
          >
            <span className="visual-phase-node">{index + 1}</span>
            <p className="visual-phase-title">{phase.label}</p>
            <p className="visual-phase-time">{phase.timeLabel} / {phase.durationLabel}</p>
            <p className="visual-phase-meta">Max density <strong>{phase.maxDensityLabel}</strong></p>
            <p className="visual-phase-meta">Completion <strong>{phase.completionLabel}</strong></p>
            <p className="visual-phase-meta">Staff conflicts <strong>{phase.staffConflicts}</strong></p>
            <p className="visual-phase-meta">Ops tasks <strong>{phase.opsTasks}</strong></p>
            <p className={phase.reviewState === "ok" ? "visual-phase-ok" : "visual-phase-review"}>
              {phase.reviewState === "ok" ? "Ready" : "Review"}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function InsightCards({
  activeOverlay,
  onInsightSelect,
}: {
  readonly activeOverlay: VisualOverlayKey;
  readonly onInsightSelect: (insight: VisualInsightCard) => void;
}): ReactElement {
  return (
    <section className="visual-insight-grid" aria-label="Visual insight cards">
      {TRADES_HALL_COMMAND_FIXTURE.insightCards.map((card) => {
        const Icon = INSIGHT_ICONS[card.id];
        return (
          <button
            key={card.id}
            type="button"
            className={`visual-insight-card ${card.tone}${activeOverlay === card.overlayKey ? " is-active" : ""}`}
            onClick={() => { onInsightSelect(card); }}
            aria-pressed={activeOverlay === card.overlayKey}
          >
            <span className="visual-insight-icon"><Icon size={25} aria-hidden="true" /></span>
            <span className="visual-insight-copy">
              <h3>{card.label}</h3>
              <p className="visual-insight-value">{card.value}</p>
              <p className="visual-insight-detail">{card.detail}</p>
            </span>
          </button>
        );
      })}
    </section>
  );
}

function VenueCommandShell({
  activeMode,
  activeOverlay,
  activeAssetUrl,
  draftUrl,
  layerMode,
  opacity,
  overlays,
  parsedDraftError,
  parsedDraftOk,
  selectedPhase,
  selectedPhaseId,
  visualState,
  onDraftUrlChange,
  onInsightSelect,
  onLayerModeChange,
  onOpacityChange,
  onPhaseChange,
  onSubmitUrl,
  onToggleOverlay,
  onModeChange,
  onSparkError,
  onSparkLoad,
}: {
  readonly activeMode: VisualCommandMode;
  readonly activeOverlay: VisualOverlayKey;
  readonly activeAssetUrl: string | null;
  readonly draftUrl: string;
  readonly layerMode: VisualLayerMode;
  readonly opacity: number;
  readonly overlays: OverlayState;
  readonly parsedDraftError: string | null;
  readonly parsedDraftOk: boolean;
  readonly selectedPhase: VisualEventPhase;
  readonly selectedPhaseId: string;
  readonly visualState: VisualState;
  readonly onDraftUrlChange: (value: string) => void;
  readonly onInsightSelect: (insight: VisualInsightCard) => void;
  readonly onLayerModeChange: (mode: VisualLayerMode) => void;
  readonly onOpacityChange: (value: number) => void;
  readonly onPhaseChange: (phaseId: string) => void;
  readonly onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  readonly onToggleOverlay: (key: VisualOverlayKey) => void;
  readonly onModeChange: (mode: VisualCommandMode) => void;
  readonly onSparkError: (event: SparkSplatErrorEvent) => void;
  readonly onSparkLoad: (event: SparkSplatLoadEvent) => void;
}): ReactElement {
  const meshVisible = layerMode === "hybrid" || layerMode === "mesh";
  const splatVisible = layerMode === "hybrid" || layerMode === "splat";

  return (
    <main className="visual-shell">
      <VenueTopBar phase={selectedPhase} visualState={visualState} />
      <VenueLeftRail activeMode={activeMode} onModeChange={onModeChange} />

      <section className="visual-stage" aria-label="Trades Hall visual command canvas">
        <div className="visual-canvas-frame">
          <Canvas
            dpr={[1, 2]}
            camera={{ fov: 39, near: 0.1, far: 180, position: VISUAL_CAMERA_POSITION }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#080a0c"]} />
            <ambientLight intensity={0.68} />
            <directionalLight position={[6, 9, 6]} intensity={0.78} />
            {meshVisible && <GrandHallRoom />}
            {activeAssetUrl !== null && (
              <SparkSplatLayer
                url={activeAssetUrl}
                visible={splatVisible}
                opacity={opacity}
                onLoad={onSparkLoad}
                onError={onSparkError}
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
        <CanvasLayerControls mode={layerMode} onModeChange={onLayerModeChange} />
        <CanvasOverlays overlays={overlays} />
        <CanvasOverlayLegend overlays={overlays} onToggleOverlay={onToggleOverlay} />
        <FloatingViewPalette activeMode={activeMode} />
      </section>

      <TruthModePanel
        activeMode={activeMode}
        phase={selectedPhase}
        visualState={visualState}
        draftUrl={draftUrl}
        parsedDraftOk={parsedDraftOk}
        parsedDraftError={parsedDraftError}
        activeAssetUrl={activeAssetUrl}
        opacity={opacity}
        onDraftUrlChange={onDraftUrlChange}
        onSubmitUrl={onSubmitUrl}
        onOpacityChange={onOpacityChange}
      />

      <footer className="visual-bottom">
        <EventPhaseGraph selectedPhaseId={selectedPhaseId} onSelectPhase={onPhaseChange} />
        <InsightCards activeOverlay={activeOverlay} onInsightSelect={onInsightSelect} />
      </footer>
    </main>
  );
}

export function TradesHallVisualPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAsset = useMemo(() => runtimeSplatUrlFromSearchParams(searchParams), [searchParams]);
  const [draftUrl, setDraftUrl] = useState(queryAsset.url ?? "");
  const [layerMode, setLayerMode] = useState<VisualLayerMode>("hybrid");
  const [opacity, setOpacity] = useState(0.82);
  const [activeMode, setActiveMode] = useState<VisualCommandMode>("design");
  const [selectedPhaseId, setSelectedPhaseId] = useState(TRADES_HALL_COMMAND_FIXTURE.defaultPhaseId);
  const [activeOverlay, setActiveOverlay] = useState<VisualOverlayKey>("guestFlow");
  const [overlays, setOverlays] = useState<OverlayState>(INITIAL_OVERLAYS);
  const [visualState, setVisualState] = useState<VisualState>(() => {
    if (queryAsset.error !== null) {
      return { status: "invalid", message: queryAsset.error, splatCount: null };
    }
    return queryAsset.ok ? {
      status: "loading",
      message: TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.loadingLabel,
      splatCount: null,
    } : EMPTY_STATE;
  });

  const parsedDraft = useMemo(() => parseRuntimeSplatUrl(draftUrl), [draftUrl]);
  const activeAsset = queryAsset.ok && queryAsset.url !== null ? queryAsset : null;
  const activeAssetUrl = activeAsset?.url ?? null;
  const selectedPhase = visualPhaseById(selectedPhaseId);

  useEffect(() => {
    setDraftUrl(queryAsset.url ?? "");
    if (queryAsset.error !== null) {
      setVisualState({ status: "invalid", message: queryAsset.error, splatCount: null });
      return;
    }
    setVisualState(queryAsset.ok ? {
      status: "loading",
      message: TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.loadingLabel,
      splatCount: null,
    } : EMPTY_STATE);
  }, [queryAsset.error, queryAsset.ok, queryAsset.url]);

  const submitUrl = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = parseRuntimeSplatUrl(draftUrl);
    if (!next.ok || next.url === null) {
      setVisualState({
        status: next.error === null ? "empty" : "invalid",
        message: next.error ?? TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.emptyLabel,
        splatCount: null,
      });
      if (next.error === null) {
        setSearchParams({}, { replace: true });
      }
      return;
    }

    setVisualState({
      status: "loading",
      message: TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.loadingLabel,
      splatCount: null,
    });
    setSearchParams({ splatUrl: next.url }, { replace: true });
  }, [draftUrl, setSearchParams]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setVisualState({
      status: "loaded",
      message: TRADES_HALL_COMMAND_FIXTURE.runtimeAsset.loadedLabel,
      splatCount: event.splatCount,
    });
  }, []);

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
    <VenueCommandShell
      activeMode={activeMode}
      activeOverlay={activeOverlay}
      activeAssetUrl={activeAssetUrl}
      draftUrl={draftUrl}
      layerMode={layerMode}
      opacity={opacity}
      overlays={overlays}
      parsedDraftError={parsedDraft.error}
      parsedDraftOk={parsedDraft.ok}
      selectedPhase={selectedPhase}
      selectedPhaseId={selectedPhaseId}
      visualState={visualState}
      onDraftUrlChange={setDraftUrl}
      onInsightSelect={handleInsightSelect}
      onLayerModeChange={setLayerMode}
      onOpacityChange={setOpacity}
      onPhaseChange={setSelectedPhaseId}
      onSubmitUrl={submitUrl}
      onToggleOverlay={toggleOverlay}
      onModeChange={setActiveMode}
      onSparkError={handleError}
      onSparkLoad={handleLoad}
    />
  );
}
