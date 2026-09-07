import { useState, type ReactElement } from "react";
import { ChevronDown, Layers3, Map, ScanLine, ShieldQuestion } from "lucide-react";
import { COCKPIT_OVERLAY_KEYS, type CockpitOverlayKey } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { SectionSlider } from "../../SectionSlider.js";
import { CockpitTruthRail } from "./CockpitTruthRail.js";
import { CockpitMinimap } from "./CockpitMinimap.js";
import "./ReferenceSceneSettings.css";

const OVERLAY_LABELS: Readonly<Record<CockpitOverlayKey, string>> = {
  guestFlow: "Guest flow",
  routeClearance: "Route clearance",
  heritageBuffer: "Heritage buffer",
  densityHeatmap: "Density heatmap",
  lightingProbes: "Lighting probes",
  agentReplay: "Agents replay",
};

/** Existing scene settings, disclosed within the reference viewer's More menu. */
export function ReferenceSceneSettings({ className = "" }: { readonly className?: string }): ReactElement {
  const overlays = useCockpitStore((state) => state.overlayVisibility);
  const previewLocked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);

  return <section className={`reference-scene-settings ${className}`} aria-label="Scene settings" data-testid="reference-scene-settings">
    {previewLocked ? <p role="status">Return to the saved plan to use scene settings.</p> : <>
      <details open={navigationOpen} onToggle={(event) => { setNavigationOpen(event.currentTarget.open); }}>
        <summary><Map size={15} aria-hidden />Plan navigation<ChevronDown size={13} aria-hidden /></summary>
        {navigationOpen && <CockpitMinimap embedded />}
      </details>
      <details>
        <summary><Layers3 size={15} aria-hidden />Scene overlays<ChevronDown size={13} aria-hidden /></summary>
        <div className="reference-scene-settings__body">
          {COCKPIT_OVERLAY_KEYS.map((key) => <label className="reference-scene-settings__overlay" key={key}>
            <input type="checkbox" checked={overlays[key]} onChange={(event) => {
              if (useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
              useCockpitStore.getState().setOverlay(key, event.currentTarget.checked);
            }} />
            <span>{OVERLAY_LABELS[key]}</span>
          </label>)}
          <p className="reference-scene-settings__note">Planning overlays require human review.</p>
        </div>
      </details>
      <details>
        <summary><ScanLine size={15} aria-hidden />Model section height<ChevronDown size={13} aria-hidden /></summary>
        <div className="reference-scene-settings__body">
          <SectionSlider embedded />
          <p className="reference-scene-settings__note">Model walls and ceiling.</p>
        </div>
      </details>
      <details open={evidenceOpen} onToggle={(event) => { setEvidenceOpen(event.currentTarget.open); }}>
        <summary><ShieldQuestion size={15} aria-hidden />Recorded evidence<ChevronDown size={13} aria-hidden /></summary>
        {evidenceOpen && <CockpitTruthRail />}
      </details>
    </>}
  </section>;
}
