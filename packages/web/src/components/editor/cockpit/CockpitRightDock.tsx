import { type FC, type ReactElement } from "react";
import { ScanLine } from "lucide-react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import type { CockpitMode } from "../../../lib/cockpit-modes.js";
import {
  plannerAllowsOperationalGeometry,
  type PlannerLayerPolicy,
} from "../../../lib/planner-layer-composition.js";
import { CockpitTruthRail } from "./CockpitTruthRail.js";
import { FlowLensPanel } from "./FlowLensPanel.js";
import { CostsLensPanel } from "./CostsLensPanel.js";
import { ShareLensPanel } from "./ShareLensPanel.js";
import { GuestsLensPanel } from "./GuestsLensPanel.js";
import { OpsLensPanel } from "./OpsLensPanel.js";
import { EvidenceLensPanel } from "./EvidenceLensPanel.js";
import { LightingLensPanel } from "./LightingLensPanel.js";
import { PowerLensPanel } from "./PowerLensPanel.js";
import { RiggingLensPanel } from "./RiggingLensPanel.js";
import { AVLensPanel } from "./AVLensPanel.js";
import {
  FurnitureInspectionDock,
  useSelectedGeneratedFurniture,
} from "./FurnitureInspectionDock.js";
import { LensPanel, LensPanelSection } from "./LensPanel.js";

// ---------------------------------------------------------------------------
// CockpitRightDock — the contextual right column (Epic 0).
//
// A lens appears as a real tool panel here only when it registers one in
// LENS_PANELS. Unregistered lenses fall back to the Truth rail, so the right
// column is always meaningful — never an empty dead panel. The chosen component
// IS the grid child (each owns `grid-area: panel`), so there is no wrapper and
// no layout regression to the Design lens or the Truth rail.
// ---------------------------------------------------------------------------

export const LENS_PANELS: Partial<Record<CockpitMode, FC>> = {
  guests: GuestsLensPanel,
  flow: FlowLensPanel,
  evidence: EvidenceLensPanel,
  lighting: LightingLensPanel,
  power: PowerLensPanel,
  rigging: RiggingLensPanel,
  av: AVLensPanel,
  ops: OpsLensPanel,
  costs: CostsLensPanel,
  share: ShareLensPanel,
};

/** The registered panel component for a lens, or null when it has none yet. */
export function panelForMode(mode: CockpitMode): FC | null {
  return LENS_PANELS[mode] ?? null;
}

export interface CockpitRightDockProps {
  readonly layerPolicy: PlannerLayerPolicy;
}

interface UnavailableDockCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly source: string;
  readonly body: string;
  readonly footer: string;
}

function unavailableDockCopy(policy: PlannerLayerPolicy): UnavailableDockCopy {
  switch (policy.kind) {
    case "captured-only":
      return {
        eyebrow: "Captured source",
        title: "Grand Hall",
        source: "Source only",
        body: "Furniture fit, capacity, guest flow, route clearance, costs, and operational quantities stay hidden until a reviewed room-local alignment and collision surface are registered.",
        footer: "Captured visual inspection only · no operational reliance.",
      };
    case "identity-pending":
      return {
        eyebrow: "Room access",
        title: "Identity resolving",
        source: "Resolving",
        body: "Operational geometry and planning tools stay hidden until the current venue and room identity have been verified.",
        footer: "Room identity pending · no operational reliance.",
      };
    case "identity-unavailable":
      return {
        eyebrow: "Room access",
        title: "Identity unavailable",
        source: "Unavailable",
        body: "Operational geometry and planning tools are unavailable because the current venue and room identity could not be verified.",
        footer: "Room identity unavailable · no operational reliance.",
      };
    case "configurable":
      return {
        eyebrow: "Planner",
        title: "Operational geometry",
        source: "Available",
        body: "Operational planning tools are available for this room.",
        footer: "Planning evidence · human review required.",
      };
  }
}

function OperationalGeometryUnavailableDock({ layerPolicy }: CockpitRightDockProps): ReactElement {
  const copy = unavailableDockCopy(layerPolicy);
  return (
    <LensPanel
      eyebrow={copy.eyebrow}
      title={copy.title}
      icon={<ScanLine size={18} />}
      source={copy.source}
      testId="operational-geometry-unavailable-dock"
      footer={copy.footer}
    >
      <LensPanelSection label="Operational geometry unavailable">
        <p className="lens-panel__paragraph">{copy.body}</p>
      </LensPanelSection>
    </LensPanel>
  );
}

export function CockpitRightDock({ layerPolicy }: CockpitRightDockProps): ReactElement {
  const activeMode = useCockpitStore((state) => state.activeMode);
  const generatedFurnitureSelection = useSelectedGeneratedFurniture();
  if (!plannerAllowsOperationalGeometry(layerPolicy)) {
    return <OperationalGeometryUnavailableDock layerPolicy={layerPolicy} />;
  }
  if (activeMode === "design" && generatedFurnitureSelection !== null) {
    return <FurnitureInspectionDock selection={generatedFurnitureSelection} />;
  }
  const Panel = panelForMode(activeMode);
  return Panel !== null ? <Panel /> : <CockpitTruthRail />;
}
