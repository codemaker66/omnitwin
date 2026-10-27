import { useMemo, type ReactElement } from "react";
import { Cuboid, Sparkles, Layers3, Footprints, type LucideIcon } from "lucide-react";
import { COCKPIT_LAYER_MODES, type CockpitLayerMode } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { roomSplatBundle } from "../../../data/room-splat-bundles.js";
import { TRADES_HALL_RUNTIME_ROOMS } from "../../../lib/runtime-package-resolution.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../../shared/FloatingWidgetFrame.js";
import "./CanvasLayerControls.css";
import { recordPlannerArrivalChoice } from "../../../lib/planner-room-arrival.js";
import { gaussianSplatsAvailable } from "../../../lib/splat-access.js";
import { useModelledGrandHall } from "../../grand-hall/hall-space.js";
import { HallViewControls } from "./HallViewControls.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { canReadInternalEventData } from "../../../lib/event-access.js";

// The photographed room is held back in production. Staff are told it is
// coming; a guest or client is shown no control that cannot work, and none of
// the engineering words (spec §13 rule 4, F-15).
const CAPTURE_COMING_SOON = "Photographed room · coming soon";

const LAYER_META: Readonly<Record<CockpitLayerMode, { readonly label: string; readonly Icon: LucideIcon }>> = {
  mesh: { label: "Model", Icon: Cuboid },
  splat: { label: "Capture", Icon: Sparkles },
  hybrid: { label: "Combined", Icon: Layers3 },
};

const LAYER_CONTROLS_DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "anchor",
  anchor: "top-left",
  offsetX: 456,
  offsetY: 82,
};

const LAYER_CONTROLS_AVOID_SELECTORS = [
  "[data-testid='cockpit-topbar']",
  "[data-testid='planner-tool-pill']",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  "[data-floating-widget-id='cockpit-minimap']",
  "[data-floating-widget-id='planner-spatial-hud']",
  "[data-floating-widget-id='save-send-panel']",
  "[data-floating-widget-id='truth-mode-indicator']",
  "[data-floating-widget-id='placement-coach']",
  "[data-testid='cockpit-truth-rail']",
  "[data-testid='truth-mode-popover']",
  ".planner-command-deck",
  "[data-testid='cockpit-bottom']",
] as const;

/**
 * Model / Capture / Combined view toggle, docked over the stage. Drives the
 * cockpit store's layer mode, which the scene reads to choose between the
 * procedural mesh and the measured Gaussian-splat capture.
 */
/**
 * Whether the loaded space's capture can be walked: it must exist and carry
 * walk data (where the scanner stood). Static manifest data — no fetch.
 */
function walkAvailableForSlug(spaceSlug: string | null): boolean {
  if (spaceSlug === null) return false;
  const known = TRADES_HALL_RUNTIME_ROOMS.some((room) => room.slug === spaceSlug);
  if (!known) return false;
  const bundle = roomSplatBundle(spaceSlug);
  return bundle !== null && bundle.spawn !== null && bundle.bounds !== null;
}

/**
 * The Grand Hall's views and light for a phone's View sheet: a phone's stage
 * docks no layer controls, and without these its visitors could never leave
 * daylight or the room view. Nothing outside the modelled hall. Choosing a
 * view closes the sheet, as a saved view does, so the glide can be watched;
 * choosing a light leaves it open, to compare one light with the next.
 */
export function HallViewSheetControls({ onViewChosen }: { readonly onViewChosen: () => void }): ReactElement | null {
  const splatsAvailable = gaussianSplatsAvailable();
  const spaceSlug = useEditorStore((s) => s.space?.slug ?? null);
  const povActive = useBookmarkStore((s) => s.activeReferenceId !== null);
  const walkAvailable = useMemo(() => walkAvailableForSlug(spaceSlug), [spaceSlug]);
  const modelledHall = useModelledGrandHall();
  if (!modelledHall) return null;
  return (
    <div className="hall-view-sheet" data-testid="hall-view-sheet">
      <HallViewControls captureAvailable={splatsAvailable && walkAvailable} povActive={povActive} moodLabels onViewChosen={onViewChosen} />
    </div>
  );
}

export function CanvasLayerControls({ embedded = false }: { readonly embedded?: boolean }): ReactElement | null {
  const staff = useAuthStore((state) => canReadInternalEventData(state));
  const layerMode = useCockpitStore((s) => s.layerMode);
  const splatsAvailable = gaussianSplatsAvailable();
  const visibleLayerMode = splatsAvailable ? layerMode : "mesh";
  const cameraInteractionActive = useCockpitStore((s) => s.cameraInteractionActive);
  const walkMode = useCockpitStore((s) => s.walkMode);
  const spaceSlug = useEditorStore((s) => s.space?.slug ?? null);
  const povActive = useBookmarkStore((s) => s.activeReferenceId !== null);
  const walkAvailable = useMemo(() => walkAvailableForSlug(spaceSlug), [spaceSlug]);
  const walkDisabled = !splatsAvailable || !walkAvailable || povActive;
  const modelledHall = useModelledGrandHall();

  // Esc never leaves Walk (spec 4.5; T-671 slice 5): a reflexive Esc steps
  // back one layer in the planner's one Escape order and never ejects you
  // from the room. The view switch here leaves it.

  const controls = (
    <div className="cockpit-layer-controls" role="group" aria-label="Room view">
      {COCKPIT_LAYER_MODES.map((mode) => {
        const meta = LAYER_META[mode];
        const Icon = meta.Icon;
        const unavailable = !splatsAvailable && mode !== "mesh";
        return <button key={mode} type="button" aria-pressed={mode === visibleLayerMode}
          disabled={unavailable} title={unavailable ? CAPTURE_COMING_SOON : undefined}
          className={mode === visibleLayerMode ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
          onClick={() => { recordPlannerArrivalChoice(); useCockpitStore.getState().setLayerMode(mode); }}>
          <Icon size={14} aria-hidden />{meta.label}
        </button>;
      })}
      <span className="cockpit-layer-controls__divider" aria-hidden />
      <button type="button" aria-pressed={splatsAvailable && walkMode} className={splatsAvailable && walkMode ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
        disabled={walkDisabled} data-testid="planner-walk-toggle"
        title={!splatsAvailable ? CAPTURE_COMING_SOON : walkDisabled ? "This room has no interior view yet, or a saved view is open" : "Switch between the interior and the view from above"}
        onClick={() => { recordPlannerArrivalChoice(); useCockpitStore.getState().setWalkMode(!walkMode); }}>
        <Footprints size={14} aria-hidden />{embedded ? "Interior" : "Walk"}
      </button>
    </div>
  );
  const notice = !splatsAvailable && <p className="cockpit-layer-controls__notice">{CAPTURE_COMING_SOON}</p>;
  // The Grand Hall is drawn as the real room, so it is always walkable and has
  // its own views and light; its capture is an extra, where one may be shown.
  if (embedded && modelledHall) {
    return (
      <div className="reference-layer-controls" data-testid="planner-layer-controls">
        <HallViewControls captureAvailable={splatsAvailable && walkAvailable} povActive={povActive} />
      </div>
    );
  }
  // Without the capture there is one view and nothing to choose: only staff
  // see the held-back controls, with the reason.
  if (!splatsAvailable && !staff) return null;
  if (embedded) return <div className="reference-layer-controls" data-testid="planner-layer-controls">{controls}{notice}</div>;
  return (
    <FloatingWidgetFrame
      id="planner-layer-controls"
      title="Room view"
      compactLabel={LAYER_META[visibleLayerMode].label}
      strategy="fixed"
      testId="planner-layer-controls"
      className="cockpit-layer-controls-widget"
      bodyClassName="cockpit-layer-controls-widget__body"
      defaultPlacement={LAYER_CONTROLS_DEFAULT_PLACEMENT}
      avoidSelectors={LAYER_CONTROLS_AVOID_SELECTORS}
      avoidPaddingPx={12}
      storageScope="desktop-cockpit-v1"
      zIndex={32}
      autoCompact={cameraInteractionActive}
    >
      <div className="cockpit-layer-controls" role="group" aria-label="Room view">
        {COCKPIT_LAYER_MODES.map((mode) => {
          const meta = LAYER_META[mode];
          const Icon = meta.Icon;
          const active = mode === visibleLayerMode;
          const unavailable = !splatsAvailable && mode !== "mesh";
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              disabled={unavailable}
              title={unavailable ? CAPTURE_COMING_SOON : undefined}
              className={active ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
              onClick={() => { recordPlannerArrivalChoice(); useCockpitStore.getState().setLayerMode(mode); }}
            >
              <Icon size={14} aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
        <span className="cockpit-layer-controls__divider" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={splatsAvailable && walkMode}
          className={splatsAvailable && walkMode ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
          disabled={walkDisabled}
          title={
            !splatsAvailable ? CAPTURE_COMING_SOON : walkDisabled
              ? (povActive
                ? "Leave the saved view before walking the room"
                : "This room's capture has no walk data yet")
              : (walkMode ? "Back to plan view (Esc)" : "Stand in the room at eye level")
          }
          data-testid="planner-walk-toggle"
          onClick={() => {
            // A plain synchronous flip, deliberately: the store-driven bisect
            // proved this exact mount path healthy, and wrapping the flip in
            // startTransition made R3F's first walk frame wedge intermittently
            // (a transition-committed Canvas subtree meeting the demand loop).
            recordPlannerArrivalChoice();
            useCockpitStore.getState().setWalkMode(!walkMode);
          }}
        >
          <Footprints size={14} aria-hidden="true" />
          Walk
        </button>
      </div>
      {notice}
    </FloatingWidgetFrame>
  );
}
