import { type ReactElement } from "react";
import { PlannerScene } from "../PlannerScene.js";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import "./PlannerCockpit.css";

/**
 * The planner cockpit shell: a CSS grid that frames the live editable scene
 * (stage cell) with the navigation rail, and — in Phase 1 — placeholder top
 * bar / Truth rail / phase strip regions that Phase 2 replaces with real,
 * data-bound chrome. The tool toolbox shows only in the Design lens.
 */
export function PlannerCockpit(): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const isDesign = activeMode === "design";
  return (
    <div className="cockpit-shell" data-testid="cockpit-shell">
      <header className="cockpit-topbar cockpit-placeholder" aria-label="Planner status">
        <span>Venviewer — planner cockpit</span>
        <span>Planning evidence / human review required</span>
      </header>
      <CockpitNavRail />
      <section className="cockpit-stage" aria-label="Planner scene">
        <PlannerScene />
        {isDesign && <VerticalToolbox />}
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
