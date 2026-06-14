import { type ReactElement } from "react";
import { Cuboid, Sparkles, Layers3, type LucideIcon } from "lucide-react";
import { COCKPIT_LAYER_MODES, type CockpitLayerMode } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import "./CanvasLayerControls.css";

const LAYER_META: Readonly<Record<CockpitLayerMode, { readonly label: string; readonly Icon: LucideIcon }>> = {
  mesh: { label: "Mesh", Icon: Cuboid },
  splat: { label: "Splat", Icon: Sparkles },
  hybrid: { label: "Hybrid", Icon: Layers3 },
};

/**
 * Mesh / Splat / Hybrid renderer toggle, docked over the stage. Drives the
 * cockpit store's layer mode, which the scene reads to choose between the
 * procedural mesh and the measured Gaussian-splat capture.
 */
export function CanvasLayerControls(): ReactElement {
  const layerMode = useCockpitStore((s) => s.layerMode);
  return (
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
    </div>
  );
}
