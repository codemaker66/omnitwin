import { type ReactElement } from "react";
import { App as Editor3D } from "../../../App.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
import { CockpitTopBar } from "./CockpitTopBar.js";
import { CockpitRightDock } from "./CockpitRightDock.js";
import { WhenRibbon } from "./WhenRibbon.js";
import { CockpitBottom } from "./CockpitBottom.js";
import { CanvasLayerControls } from "./CanvasLayerControls.js";
import { CockpitMinimap } from "./CockpitMinimap.js";
import { RoomResolveCaption } from "./RoomResolveCaption.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
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
export function PlannerCockpit({ mobile = false }: { readonly mobile?: boolean }): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const resolvePhase = useCockpitStore((s) => s.roomResolve.phase);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const timelinePreviewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const timelineUnavailableMessage = useLayoutTimelinePreviewStore((state) => state.unavailableMessage);
  return (
    <div
      className={`cockpit-shell${mobile ? " is-mobile" : ""}`}
      data-testid="cockpit-shell"
      data-layout-timeline-preview={String(timelinePreviewActive)}
    >
      {mobile ? null : <CockpitTopBar key="topbar" />}
      {mobile ? null : <CockpitNavRail key="rail" />}
      <section
        key="stage"
        className="cockpit-stage"
        data-cockpit-mode={activeMode}
        data-resolve-phase={resolvePhase}
        data-layout-timeline-preview={String(timelinePreviewActive)}
        aria-label="Planner scene"
      >
        <Editor3D />
        {mobile || timelinePreviewActive ? null : <RoomResolveCaption />}
        {timelinePreviewActive && (
          <p
            className="layout-timeline-preview-caption"
            data-testid="layout-timeline-preview-caption"
            role="status"
          >
            {timelinePreviewMode === "unavailable"
              ? `Layout unavailable · ${timelineUnavailableMessage ?? "No frozen keyframe for this time"} · no room shell or saved layout shown`
              : timelinePreviewMode === "schedule-gap"
                ? `Schedule gap · ${timelineUnavailableMessage ?? "No room phase is scheduled for this time"} · no room shell or saved layout shown`
                : "Visualizing phase change · frozen room outline + furniture are the plan · motion is not saved"}
          </p>
        )}
        {mobile || timelinePreviewActive ? null : <CanvasLayerControls />}
        {mobile ? null : <CockpitMinimap />}
      </section>
      {mobile ? null : timelinePreviewActive ? (
        <aside
          key="preview-lock"
          className="cockpit-panel cockpit-preview-lock"
          data-testid="cockpit-preview-lock"
          aria-label="Phase preview editing lock"
        >
          <span className="cockpit-preview-lock__title">Phase preview</span>
          <strong>Editing is paused</strong>
          <p>Return to the saved plan from the timeline before changing this layout.</p>
        </aside>
      ) : <CockpitRightDock key="right-dock" />}
      {/* The When ribbon (S2) shares the transport's clock and booking; it
          rests while a phase preview holds the stage. */}
      {mobile || timelinePreviewActive ? null : <WhenRibbon />}
      <CockpitBottom key="room-layout-timeline" />
    </div>
  );
}
