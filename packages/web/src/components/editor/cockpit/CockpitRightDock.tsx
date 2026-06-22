import { type FC, type ReactElement } from "react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import type { CockpitMode } from "../../../lib/cockpit-modes.js";
import { CockpitTruthRail } from "./CockpitTruthRail.js";
import { FlowLensPanel } from "./FlowLensPanel.js";
import { CostsLensPanel } from "./CostsLensPanel.js";

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
  flow: FlowLensPanel,
  costs: CostsLensPanel,
};

/** The registered panel component for a lens, or null when it has none yet. */
export function panelForMode(mode: CockpitMode): FC | null {
  return LENS_PANELS[mode] ?? null;
}

export function CockpitRightDock(): ReactElement {
  const activeMode = useCockpitStore((state) => state.activeMode);
  const Panel = panelForMode(activeMode);
  return Panel !== null ? <Panel /> : <CockpitTruthRail />;
}
