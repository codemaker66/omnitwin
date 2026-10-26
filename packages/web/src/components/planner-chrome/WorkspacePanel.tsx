import { useEffect, useId, useRef, type ReactElement } from "react";
import { X } from "lucide-react";
import { COCKPIT_OVERLAY_KEYS, type CockpitOverlayKey } from "../../lib/cockpit-modes.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import {
  PRODUCTION_PARTS,
  PRODUCTION_PART_NAMES,
  cockpitModeFor,
  workspaceEntry,
  type ProductionPart,
} from "../../lib/workspaces-model.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { CockpitMinimap } from "../editor/cockpit/CockpitMinimap.js";
import { CostsLensPanel } from "../editor/cockpit/CostsLensPanel.js";
import { EvidenceLensPanel } from "../editor/cockpit/EvidenceLensPanel.js";
import { FlowLensPanel } from "../editor/cockpit/FlowLensPanel.js";
import { GuestsLensPanel } from "../editor/cockpit/GuestsLensPanel.js";
import { LightingLensPanel } from "../editor/cockpit/LightingLensPanel.js";
import { Segmented, Switch } from "./Controls.js";
import { Key } from "./Keys.js";
import { Notice } from "./Surfaces.js";
import { KeptBody } from "./workspace-keep.js";
import {
  closeWorkspace,
  useWorkspaceStore,
  useWorkspacesAllowed,
  workspaceTrigger,
} from "./workspace-state.js";
import "./chrome.css";
import "./workspaces.css";

// ---------------------------------------------------------------------------
// A workspace, in the right zone (T-674, v2 slice 18; spec 4.6, 6.15).
//
// A lacquer panel whose title is the menu's name for it (F-32), its one line
// under the title, and a close key. Its bodies are v1's lens panels, unedited,
// set on lacquer by workspaces.css: Design (snap, the overlays and, for staff,
// the map), Guests, Flow (guest flow, then the evidence), Production
// (Lighting · Power · Rigging · AV) and Costs. The room's overlays follow the
// workspace in front, as they followed v1's lens, and go back to Design when
// the panel closes. While an act's frozen layout is showing, the bodies stand
// aside, as v1's did, so nothing here can change the plan behind it.
//
// Opening it, or choosing another workspace, moves focus to its first
// control; Esc closes it (the one Escape order) and focus goes back to the
// menu's key. Only the people the menu shows it to ever see it.
// ---------------------------------------------------------------------------

const OVERLAY_NAMES: Readonly<Record<CockpitOverlayKey, string>> = {
  guestFlow: "Guest flow paths",
  agentReplay: "Guests moving",
  densityHeatmap: "Crowding",
  routeClearance: "Route clearance",
  heritageBuffer: "Heritage buffer",
  lightingProbes: "Light levels",
};

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** The first control a person can reach in a container, in order, skipping anything hidden. */
function firstControl(container: HTMLElement): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.tabIndex < 0 || element.hasAttribute("disabled")) continue;
    if (element.closest("[hidden]") !== null) continue;
    return element;
  }
  return null;
}

function DesignBody(): ReactElement {
  const snap = usePlacementStore((state) => state.snapEnabled);
  const overlays = useCockpitStore((state) => state.overlayVisibility);
  const headId = useId();
  return (
    <>
      <section className="pc-workspace__group" aria-labelledby={`${headId}-placing`}>
        <h3 id={`${headId}-placing`} className="pc-caps pc-workspace__group-head">Placing</h3>
        <Switch
          label="Snap to the 1 m grid"
          checked={snap}
          onChange={() => { usePlacementStore.getState().toggleSnap(); }}
        />
        <p className="pc-meta pc-workspace__note">
          Pieces line up with the walls and with each other either way. G turns snap on and off.
        </p>
      </section>
      <section className="pc-workspace__group" aria-labelledby={`${headId}-overlays`}>
        <h3 id={`${headId}-overlays`} className="pc-caps pc-workspace__group-head">Overlays</h3>
        {COCKPIT_OVERLAY_KEYS.map((key) => (
          <Switch
            key={key}
            label={OVERLAY_NAMES[key]}
            checked={overlays[key]}
            onChange={(visible) => { useCockpitStore.getState().setOverlay(key, visible); }}
          />
        ))}
        <p className="pc-meta pc-workspace__note">
          Each draws in its own workspace: paths, crowding and routes in Flow, light levels in Production.
        </p>
      </section>
      <section className="pc-workspace__group pc-workspace__map" aria-labelledby={`${headId}-map`}>
        <h3 id={`${headId}-map`} className="pc-caps pc-workspace__group-head">Map</h3>
        <CockpitMinimap embedded />
      </section>
    </>
  );
}

function ProductionBody({ part, layoutKey }: { readonly part: ProductionPart; readonly layoutKey: string }): ReactElement {
  return (
    <>
      <Segmented
        label="Production"
        className="pc-workspace__parts"
        value={part}
        options={PRODUCTION_PARTS.map((value) => ({ value, label: PRODUCTION_PART_NAMES[value] }))}
        onChange={(next) => { useWorkspaceStore.getState().setPart(next); }}
      />
      {/* Every part stays mounted while Production shows, so a part switch keeps what was typed. */}
      <div className="pc-workspace__part" hidden={part !== "lighting"} data-workspace-part="lighting">
        <LightingLensPanel />
      </div>
      <KeptBody layoutKey={layoutKey} part="power" hidden={part !== "power"} />
      <KeptBody layoutKey={layoutKey} part="rigging" hidden={part !== "rigging"} />
      <KeptBody layoutKey={layoutKey} part="av" hidden={part !== "av"} />
      {part !== "lighting" ? (
        <p className="pc-meta pc-workspace__note" data-testid="planner-workspace-kept-note">
          Not saved with the layout. The figures stay while the planner is open.
        </p>
      ) : null}
    </>
  );
}

export function WorkspacePanel(): ReactElement | null {
  const allowed = useWorkspacesAllowed();
  // Someone who may not see the workspaces (signed out, or a client's view) never keeps one open.
  useEffect(() => {
    if (!allowed) closeWorkspace();
  }, [allowed]);
  if (!allowed) return null;
  return <WorkspaceSurface />;
}

function WorkspaceSurface(): ReactElement {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const part = useWorkspaceStore((state) => state.part);
  const chosen = useWorkspaceStore((state) => state.chosen);
  const configId = useEditorStore((state) => state.configId);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const entry = workspaceEntry(workspace);
  const mode = cockpitModeFor(workspace, part);
  const layoutKey = configId ?? "this-layout";

  useEscapeLayer("panel", { open: true, onEscape: closeWorkspace, returnFocusTo: workspaceTrigger });

  // The room's overlays follow the workspace in front; the room is in Design again once it closes.
  useEffect(() => { useCockpitStore.getState().setMode(mode); }, [mode]);
  useEffect(() => () => { useCockpitStore.getState().setMode("design"); }, []);

  // Opening it, or choosing a workspace again, puts focus on its first control (spec 4.5).
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const body = panel.querySelector<HTMLElement>(".pc-workspace__body");
    const target = (body === null ? null : firstControl(body)) ?? closeRef.current;
    target?.focus({ preventScroll: true });
    if (body !== null) body.scrollTop = 0;
  }, [chosen]);

  const closeAndReturn = (): void => {
    closeWorkspace();
    workspaceTrigger()?.focus({ preventScroll: true });
  };

  return (
    <section
      ref={panelRef}
      className="pc-lacquer pc-lacquer--raised pc-workspace"
      data-register="forest"
      aria-labelledby={titleId}
      data-testid="planner-workspace"
      data-workspace={workspace}
    >
      <header className="pc-workspace__head">
        <div className="pc-workspace__titles">
          <h2 id={titleId} className="pc-title pc-workspace__title">{entry.name}</h2>
          <p className="pc-meta pc-workspace__line">{entry.line}</p>
        </div>
        <Key
          ref={closeRef}
          small
          iconOnly
          label={`Close ${entry.name}`}
          icon={<X className="pc-icon" aria-hidden="true" />}
          shortcut={["Esc"]}
          tooltipSide="below"
          onPress={closeAndReturn}
        />
      </header>
      {previewing ? (
        <Notice
          className="pc-workspace__notice"
          lead="An act's layout is showing"
          body="The saved plan is unchanged. Close the act's layout to use this workspace."
        />
      ) : (
        <div className="pc-workspace__body" key={workspace}>
          {workspace === "design" ? <DesignBody /> : null}
          {workspace === "guests" ? <GuestsLensPanel /> : null}
          {workspace === "flow" ? <><FlowLensPanel /><EvidenceLensPanel /></> : null}
          {workspace === "production" ? <ProductionBody part={part} layoutKey={layoutKey} /> : null}
          {workspace === "costs" ? <CostsLensPanel /> : null}
        </div>
      )}
    </section>
  );
}
