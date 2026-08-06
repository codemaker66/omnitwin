import { type ReactElement } from "react";
import { App as Editor3D } from "../../../App.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
import { CockpitTopBar } from "./CockpitTopBar.js";
import { CockpitRightDock } from "./CockpitRightDock.js";
import { CockpitBottom } from "./CockpitBottom.js";
import { CanvasLayerControls } from "./CanvasLayerControls.js";
import { CockpitMinimap } from "./CockpitMinimap.js";
import { RoomResolveCaption } from "./RoomResolveCaption.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { GeneratedFurnitureProxyBadge } from "./FurnitureInspectionDock.js";
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
  const resolvePhase = useCockpitStore((s) => s.roomResolve.phase);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.activeFrame !== null);
  return (
    <div
      className="cockpit-shell"
      data-testid="cockpit-shell"
      data-layout-timeline-preview={String(timelinePreviewActive)}
    >
      <CockpitTopBar />
      <CockpitNavRail />
      <section
        className="cockpit-stage"
        data-cockpit-mode={activeMode}
        data-resolve-phase={resolvePhase}
        data-layout-timeline-preview={String(timelinePreviewActive)}
        aria-label="Planner scene"
      >
        <Editor3D />
        <RoomResolveCaption />
        {/* Never gated on preview: the preview frame renders generated
            proxies too, and the AI-provenance disclosure has to be on screen
            whenever they are. The badge counts the visible item set itself. */}
        <GeneratedFurnitureProxyBadge />
        {timelinePreviewActive && (
          <p
            className="layout-timeline-preview-caption"
            data-testid="layout-timeline-preview-caption"
            role="status"
          >
            Phase preview · saved plan unchanged
          </p>
        )}
        <CanvasLayerControls />
        <CockpitMinimap />
      </section>
      {timelinePreviewActive ? (
        <aside
          className="cockpit-panel cockpit-preview-lock"
          data-testid="cockpit-preview-lock"
          aria-label="Phase preview editing lock"
        >
          <span className="cockpit-preview-lock__title">Phase preview</span>
          <strong>Editing is paused</strong>
          <p>Return to the saved plan from the timeline before changing this layout.</p>
        </aside>
      ) : <CockpitRightDock />}
      <CockpitBottom />
    </div>
  );
}
