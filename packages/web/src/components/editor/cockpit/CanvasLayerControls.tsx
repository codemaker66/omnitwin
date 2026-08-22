import { type ReactElement } from "react";
import { Cuboid, Sparkles, Layers3, type LucideIcon } from "lucide-react";
import { COCKPIT_LAYER_MODES, type CockpitLayerMode } from "../../../lib/cockpit-modes.js";
import { resolvePlannerLayerPolicy } from "../../../lib/planner-layer-composition.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
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
export function CanvasLayerControls(): ReactElement {
  const layerMode = useCockpitStore((s) => s.layerMode);
  const cameraInteractionActive = useCockpitStore((s) => s.cameraInteractionActive);
  const roomIdentity = useCockpitStore((s) => s.plannerRoomIdentity);
  const space = useEditorStore((s) => s.space);
  const layerPolicy = resolvePlannerLayerPolicy({
    currentRoom: space === null
      ? null
      : {
        spaceId: space.id,
        venueId: space.venueId,
        roomSlug: space.slug,
      },
    roomIdentity,
    requestedMode: layerMode,
  });
  const effectiveMode: CockpitLayerMode = layerPolicy.effectiveMode;
  const lockedReason = layerPolicy.kind === "identity-pending"
    ? "Room identity is resolving. Architecture remains hidden."
    : layerPolicy.kind === "identity-unavailable"
      ? "Room identity is unavailable. Architecture remains hidden."
      : layerPolicy.kind === "captured-only"
        ? "Captured room source only. Alternative architecture layers are unavailable."
        : null;
  const lockedLabel = layerPolicy.kind === "identity-pending"
    ? "Identity resolving"
    : layerPolicy.kind === "identity-unavailable"
      ? "Source unavailable"
      : layerPolicy.kind === "captured-only"
        ? "Captured source"
        : null;
  const compactLabel = lockedLabel ?? LAYER_META[effectiveMode].label;
  return (
    <FloatingWidgetFrame
      id="planner-layer-controls"
      title="Visual layer"
      compactLabel={compactLabel}
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
      <div
        className={lockedReason === null
          ? "cockpit-layer-controls"
          : "cockpit-layer-controls cockpit-layer-controls--locked"}
        role={lockedReason === null ? "group" : "status"}
        aria-label={lockedReason === null ? "Visual layer" : lockedLabel ?? "Source status"}
        aria-live={lockedReason === null ? undefined : "polite"}
      >
        {lockedReason === null ? COCKPIT_LAYER_MODES.map((mode) => {
          const meta = LAYER_META[mode];
          const Icon = meta.Icon;
          const active = mode === effectiveMode;
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
        }) : (
          <>
            <Sparkles size={14} aria-hidden="true" />
            <strong className="cockpit-layer-controls__locked-label">{lockedLabel}</strong>
            <span className="cockpit-layer-controls__lock-note">{lockedReason}</span>
          </>
        )}
      </div>
    </FloatingWidgetFrame>
  );
}
