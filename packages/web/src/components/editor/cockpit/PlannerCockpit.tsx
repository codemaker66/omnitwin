import { type ReactElement } from "react";
import { App as Editor3D } from "../../../App.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
import { CockpitTopBar } from "./CockpitTopBar.js";
import { CockpitTruthRail } from "./CockpitTruthRail.js";
import { CockpitBottom } from "./CockpitBottom.js";
import { CanvasLayerControls } from "./CanvasLayerControls.js";
import { CockpitMinimap } from "./CockpitMinimap.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import "./PlannerCockpit.css";

/**
 * The planner cockpit shell: a CSS grid that frames the live editable editor
 * (stage cell) with the navigation rail. In Phase 1 the top bar / Truth rail /
 * phase strip are labeled placeholders that Phase 2 replaces with real,
 * data-bound chrome.
 *
 * The stage hosts the full editor (App) so every editing surface — toolbox,
 * command deck, section slider, chair dialog, markup, measurement — stays
 * intact. `.cockpit-stage` is a containing block (CSS transform) so App's
 * fixed chrome is scoped to the stage rather than the viewport. The active
 * lens is exposed as `data-cockpit-mode` so CSS shows the editing toolbar in
 * the Design lens only.
 */
export function PlannerCockpit(): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  return (
    <div className="cockpit-shell" data-testid="cockpit-shell">
      <CockpitTopBar />
      <CockpitNavRail />
      <section className="cockpit-stage" data-cockpit-mode={activeMode} aria-label="Planner scene">
        <Editor3D />
        <CanvasLayerControls />
        <CockpitMinimap />
      </section>
      <CockpitTruthRail />
      <CockpitBottom />
    </div>
  );
}
