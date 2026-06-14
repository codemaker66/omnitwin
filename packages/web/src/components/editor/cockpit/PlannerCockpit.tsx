import { type ReactElement } from "react";
import { App as Editor3D } from "../../../App.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
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
      <header className="cockpit-topbar cockpit-placeholder" aria-label="Planner status">
        <span>Venviewer — planner cockpit</span>
        <span>Planning evidence / human review required</span>
      </header>
      <CockpitNavRail />
      <section className="cockpit-stage" data-cockpit-mode={activeMode} aria-label="Planner scene">
        <Editor3D />
      </section>
      <aside className="cockpit-panel cockpit-placeholder" aria-label="Truth Mode">
        <span>Truth Mode</span>
        <span>Human review required</span>
      </aside>
      <footer className="cockpit-bottom cockpit-placeholder" aria-label="Event phase graph">
        <span>Event Phase Graph</span>
      </footer>
    </div>
  );
}
