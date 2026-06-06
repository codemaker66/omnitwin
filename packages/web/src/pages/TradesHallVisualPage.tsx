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
  TRADES_HALL_VISUAL_DEMO_STATE,
  visualPhaseById,
  type VisualCommandMode,
  type VisualEventPhase,
  type VisualInsightCard,
  type VisualOverlayKey,
} from "../lib/trades-hall-visual-demo-state.js";
import {
  parseRuntimeSplatUrl,
  runtimeSplatUrlFromSearchParams,
} from "../lib/runtime-visual-asset.js";
import { decideRuntimeAsset } from "../lib/runtime-package-resolution.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import type { RuntimePackage } from "@omnitwin/types";
import "./TradesHallVisualPage.css";

type VisualLayerMode = "hybrid" | "mesh" | "splat";
type LoadStatus = "empty" | "invalid" | "loading" | "loaded" | "error";

interface VisualState {
  readonly status: LoadStatus;
  readonly message: string;
  readonly splatCount: number | null;
}

type OverlayState = Readonly<Record<VisualOverlayKey, boolean>>;

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

function VenueCommandTopBar({
  phase,
  visualState,
}: {
  readonly phase: VisualEventPhase;
  readonly visualState: VisualState;
}): ReactElement {
  const runtimeLabel = visualState.status === "loaded"
    ? "Runtime asset loaded, not yet verified/signed."
    : visualState.status === "loading"
      ? "Loading runtime asset"
      : "No captured visual layer loaded";

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
          <p className="visual-field-value">{TRADES_HALL_VISUAL_DEMO_STATE.venueName}</p>
        </div>
      </div>
      <div className="visual-topbar-cell">
        <div>
          <p className="visual-field-label">Event phase</p>
          <p className="visual-field-value">{TRADES_HALL_VISUAL_DEMO_STATE.eventName} / {phase.label}</p>
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
  return (
    <div className="visual-stage-overlay" aria-hidden="true">
      {overlays.guestFlow && (
        <>
          <span className="visual-flow-line one" />
          <span className="visual-flow-line two" />
          <span className="visual-flow-line three" />
        </>
      )}
      {overlays.agentReplay && (
        <>
          <span className="visual-ghost-agent agent-a" />
          <span className="visual-ghost-agent agent-b" />
          <span className="visual-ghost-agent agent-c" />
          <span className="visual-ghost-agent agent-d" />
        </>
      )}
      {overlays.densityHeatmap && <span className="visual-density-heatmap" />}
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
        <section className="visual-panel-section">
          <div className="visual-panel-heading">
            <h2>Truth Mode</h2>
            <span className="visual-panel-badge">3</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><Box size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Source</p>
              <p className="visual-row-copy">
                {runtimeLoaded
                  ? "Runtime asset URL mounted; procedural context remains visible for comparison."
                  : "Procedural Grand Hall context only; no captured runtime visual layer is mounted."}
              </p>
            </div>
            <span className="visual-state-chip">{runtimeLoaded ? "loaded" : "pending"}</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ShieldQuestion size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Verification</p>
              <p className="visual-row-copy">
                {runtimeLoaded
                  ? "Signature, provenance, and review records are not loaded in this internal route."
                  : "No runtime bundle, signature, or review record is loaded."}
              </p>
            </div>
            <span className="visual-state-chip">review</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ChartNoAxesCombined size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Confidence</p>
              <p className="visual-row-copy">
                Draft command-shell UI for {selectedModeLabel(activeMode)} mode during {phase.label}.
              </p>
            </div>
            <span className="visual-state-chip draft">draft</span>
          </div>
          <div className="visual-truth-row">
            <span className="visual-truth-icon"><ClipboardList size={17} aria-hidden="true" /></span>
            <div>
              <p className="visual-row-title">Assumptions</p>
              <p className="visual-row-copy">{TRADES_HALL_VISUAL_DEMO_STATE.internalFixtureLabel}</p>
            </div>
            <span className="visual-state-chip simulated">demo</span>
          </div>
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
      <h2>Event Phase Graph</h2>
      <div className="visual-phase-track">
        {TRADES_HALL_VISUAL_DEMO_STATE.eventPhases.map((phase, index) => (
          <button
            key={phase.id}
            type="button"
            className={phase.id === selectedPhaseId ? "visual-phase-card is-selected" : "visual-phase-card"}
            onClick={() => { onSelectPhase(phase.id); }}
            aria-pressed={phase.id === selectedPhaseId}
          >
            <span className="visual-phase-node">{index + 1}</span>
            <p className="visual-phase-title">{phase.label}</p>
            <p className="visual-phase-meta">{phase.timeLabel} / {phase.durationLabel}</p>
            <p className="visual-phase-meta">Max density {phase.maxDensityLabel}</p>
            <p className="visual-phase-meta">Staff conflicts {phase.staffConflicts}</p>
            <p className="visual-phase-meta">Ops tasks {phase.opsTasks}</p>
            <p className={phase.reviewState === "ok" ? "visual-phase-ok" : "visual-phase-review"}>
              {phase.reviewState === "ok" ? "Ready" : "Review"}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAsset = useMemo(() => runtimeSplatUrlFromSearchParams(searchParams), [searchParams]);
  const [draftUrl, setDraftUrl] = useState(queryAsset.url ?? "");
  const [layerMode, setLayerMode] = useState<VisualLayerMode>("hybrid");
  const [opacity, setOpacity] = useState(0.82);
  const [activeMode, setActiveMode] = useState<VisualCommandMode>("design");
  const [selectedPhaseId, setSelectedPhaseId] = useState(TRADES_HALL_VISUAL_DEMO_STATE.defaultPhaseId);
  const [activeOverlay, setActiveOverlay] = useState<VisualOverlayKey>("guestFlow");
  const [overlays, setOverlays] = useState<OverlayState>(INITIAL_OVERLAYS);
  const [publishedPackage, setPublishedPackage] = useState<RuntimePackage | null>(null);
  const [visualState, setVisualState] = useState<VisualState>(() => {
    if (queryAsset.error !== null) {
      return { status: "invalid", message: queryAsset.error, splatCount: null };
    }
    return queryAsset.ok ? { status: "loading", message: "Loading runtime asset", splatCount: null } : EMPTY_STATE;
  });

  const parsedDraft = useMemo(() => parseRuntimeSplatUrl(draftUrl), [draftUrl]);
  const activeAsset = queryAsset.ok && queryAsset.url !== null ? queryAsset : null;
  const activeAssetUrl = activeAsset?.url ?? null;
  // Manual dev URL wins; otherwise the latest published RuntimePackage; otherwise
  // null → procedural Grand Hall fallback. See runtime-package-resolution.
  const assetDecision = useMemo(
    () => decideRuntimeAsset(activeAssetUrl, publishedPackage),
    [activeAssetUrl, publishedPackage],
  );
  const selectedPhase = visualPhaseById(selectedPhaseId);
  const meshVisible = layerMode === "hybrid" || layerMode === "mesh";
  const splatVisible = layerMode === "hybrid" || layerMode === "splat";

  useEffect(() => {
    setDraftUrl(queryAsset.url ?? "");
    if (queryAsset.error !== null) {
      setVisualState({ status: "invalid", message: queryAsset.error, splatCount: null });
      return;
    }
    setVisualState(queryAsset.ok ? { status: "loading", message: "Loading runtime asset", splatCount: null } : EMPTY_STATE);
  }, [queryAsset.error, queryAsset.ok, queryAsset.url]);

  // Fetch the latest published runtime package once on mount. A failure (or
  // none published) leaves publishedPackage null → procedural fallback.
  useEffect(() => {
    let cancelled = false;
    void getLatestRuntimePackage()
      .then((pkg) => { if (!cancelled) setPublishedPackage(pkg); })
      .catch(() => { if (!cancelled) setPublishedPackage(null); });
    return () => { cancelled = true; };
  }, []);

  // When a published asset becomes the active decision (no manual override),
  // show a loading line until Spark resolves it; onLoad/onError refine it.
  useEffect(() => {
    if (assetDecision.source === "published" && assetDecision.splatUrl !== null) {
      setVisualState({ status: "loading", message: "Loading runtime asset", splatCount: null });
    }
  }, [assetDecision.source, assetDecision.splatUrl]);

  const submitUrl = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = parseRuntimeSplatUrl(draftUrl);
    if (!next.ok || next.url === null) {
      setVisualState({
        status: next.error === null ? "empty" : "invalid",
        message: next.error ?? EMPTY_STATE.message,
        splatCount: null,
      });
      if (next.error === null) {
        setSearchParams({}, { replace: true });
      }
      return;
    }

    setVisualState({ status: "loading", message: "Loading runtime asset", splatCount: null });
    setSearchParams({ splatUrl: next.url }, { replace: true });
  }, [draftUrl, setSearchParams]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setVisualState({
      status: "loaded",
      message: assetDecision.source === "published"
        ? assetDecision.evidenceLabel
        : "Runtime asset loaded, not yet verified/signed.",
      splatCount: event.splatCount,
    });
  }, [assetDecision.source, assetDecision.evidenceLabel]);

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
      <VenueCommandTopBar phase={selectedPhase} visualState={visualState} />
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
        visualState={visualState}
        draftUrl={draftUrl}
        parsedDraftOk={parsedDraft.ok}
        parsedDraftError={parsedDraft.error}
        activeAssetUrl={activeAssetUrl}
        opacity={opacity}
        onDraftUrlChange={setDraftUrl}
        onSubmitUrl={submitUrl}
        onOpacityChange={setOpacity}
      />
      <footer className="visual-bottom">
        <EventPhaseGraph selectedPhaseId={selectedPhaseId} onSelectPhase={setSelectedPhaseId} />
        <VisualInsightCards activeOverlay={activeOverlay} onInsightSelect={handleInsightSelect} />
      </footer>
    </main>
  );
}
