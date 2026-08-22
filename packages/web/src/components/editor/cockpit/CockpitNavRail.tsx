import { type ReactElement } from "react";
import {
  Box, Users, Waypoints, FileCheck2, Lightbulb, Zap, Anchor, Volume2, ClipboardList,
  CircleDollarSign, Share2, ScanLine, type LucideIcon,
} from "lucide-react";
import { COCKPIT_MODES, type CockpitMode } from "../../../lib/cockpit-modes.js";
import {
  plannerAllowsOperationalGeometry,
  type PlannerLayerPolicy,
} from "../../../lib/planner-layer-composition.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";

const MODE_ICONS: Readonly<Record<CockpitMode, LucideIcon>> = {
  design: Box,
  guests: Users,
  flow: Waypoints,
  evidence: FileCheck2,
  lighting: Lightbulb,
  power: Zap,
  rigging: Anchor,
  av: Volume2,
  ops: ClipboardList,
  costs: CircleDollarSign,
  share: Share2,
};

export interface CockpitNavRailProps {
  readonly layerPolicy: PlannerLayerPolicy;
}

function unavailableRailLabel(policy: PlannerLayerPolicy): string {
  switch (policy.kind) {
    case "captured-only": return "Source";
    case "identity-pending": return "Resolving";
    case "identity-unavailable": return "Unavailable";
    case "configurable": return "Planner";
  }
}

export function CockpitNavRail({ layerPolicy }: CockpitNavRailProps): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const setMode = useCockpitStore((s) => s.setMode);
  const operationalGeometryAllowed = plannerAllowsOperationalGeometry(layerPolicy);
  if (!operationalGeometryAllowed) {
    return (
      <nav className="cockpit-rail" aria-label="Planner availability" data-testid="cockpit-rail">
        <div className="cockpit-rail__list">
          <div
            className="cockpit-rail__button is-active"
            data-testid="captured-source-rail-status"
            role="status"
          >
            <ScanLine size={20} aria-hidden="true" />
            <span>{unavailableRailLabel(layerPolicy)}</span>
          </div>
        </div>
      </nav>
    );
  }
  return (
    <nav className="cockpit-rail" aria-label="Planner lenses" data-testid="cockpit-rail">
      <div className="cockpit-rail__list">
        {COCKPIT_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode.id];
          const active = mode.id === activeMode;
          return (
            <button
              key={mode.id}
              type="button"
              className={active ? "cockpit-rail__button is-active" : "cockpit-rail__button"}
              aria-pressed={active}
              onClick={() => { setMode(mode.id); }}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
