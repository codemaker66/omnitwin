import { startTransition, useEffect, useMemo, type ReactElement } from "react";
import { Cuboid, Sparkles, Layers3, Footprints, type LucideIcon } from "lucide-react";
import { COCKPIT_LAYER_MODES, type CockpitLayerMode } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { roomSplatBundle } from "../../../data/room-splat-bundles.js";
import { TRADES_HALL_RUNTIME_ROOMS } from "../../../lib/runtime-package-resolution.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../../shared/FloatingWidgetFrame.js";
import "./CanvasLayerControls.css";

const LAYER_META: Readonly<Record<CockpitLayerMode, { readonly label: string; readonly Icon: LucideIcon }>> = {
  mesh: { label: "Mesh", Icon: Cuboid },
  splat: { label: "Splat", Icon: Sparkles },
  hybrid: { label: "Hybrid", Icon: Layers3 },
};

const LAYER_CONTROLS_DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "anchor",
  anchor: "top-left",
  offsetX: 456,
  offsetY: 82,
};

const LAYER_CONTROLS_AVOID_SELECTORS = [
  "[data-testid='cockpit-topbar']",
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
 * Mesh / Splat / Hybrid renderer toggle, docked over the stage. Drives the
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

export function CanvasLayerControls(): ReactElement {
  const layerMode = useCockpitStore((s) => s.layerMode);
  const cameraInteractionActive = useCockpitStore((s) => s.cameraInteractionActive);
  const walkMode = useCockpitStore((s) => s.walkMode);
  const spaceSlug = useEditorStore((s) => s.space?.slug ?? null);
  const povActive = useBookmarkStore((s) => s.activeReferenceId !== null);
  const walkAvailable = useMemo(() => walkAvailableForSlug(spaceSlug), [spaceSlug]);
  const walkDisabled = !walkAvailable || povActive;

  // Escape leaves the room. Listening only while walking keeps this from
  // shadowing the rig's own Escape duties (tours, POV exit), none of which
  // can be active at the same time as walk.
  useEffect(() => {
    if (!walkMode) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Escape") return;
      event.preventDefault();
      useCockpitStore.getState().setWalkMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [walkMode]);

  return (
    <FloatingWidgetFrame
      id="planner-layer-controls"
      title="Visual layer"
      compactLabel={LAYER_META[layerMode].label}
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
      <div className="cockpit-layer-controls" role="group" aria-label="Visual layer">
        {COCKPIT_LAYER_MODES.map((mode) => {
          const meta = LAYER_META[mode];
          const Icon = meta.Icon;
          const active = mode === layerMode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              className={active ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
              onClick={() => { useCockpitStore.getState().setLayerMode(mode); }}
            >
              <Icon size={14} aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
        <span className="cockpit-layer-controls__divider" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={walkMode}
          className={walkMode ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
          disabled={walkDisabled}
          title={
            walkDisabled
              ? (povActive
                ? "Leave the POV reference before walking the room"
                : "This room's capture has no walk data yet")
              : (walkMode ? "Back to plan view (Esc)" : "Stand in the room at eye level")
          }
          data-testid="planner-walk-toggle"
          onClick={() => {
            // Entering walk mounts a camera into a scene holding millions of
            // gaussians. Inside a discrete event React flushes that mount
            // synchronously, which on a slow GPU wedges the main thread hard
            // enough that even devtools evaluates starve; the same mount
            // scheduled as a transition completes cleanly (proven by bisect:
            // store-driven entry works, click-driven entry hung). Non-urgent
            // is also simply true — this is a mode change, not a keystroke.
            startTransition(() => { useCockpitStore.getState().setWalkMode(!walkMode); });
          }}
        >
          <Footprints size={14} aria-hidden="true" />
          Walk
        </button>
      </div>
    </FloatingWidgetFrame>
  );
}
