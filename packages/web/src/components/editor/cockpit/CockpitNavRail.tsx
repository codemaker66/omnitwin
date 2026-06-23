import { type ReactElement } from "react";
import {
  Box, Users, Waypoints, FileCheck2, Lightbulb, Zap, ClipboardList,
  CircleDollarSign, Share2, type LucideIcon,
} from "lucide-react";
import { COCKPIT_MODES, type CockpitMode } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";

const MODE_ICONS: Readonly<Record<CockpitMode, LucideIcon>> = {
  design: Box,
  guests: Users,
  flow: Waypoints,
  evidence: FileCheck2,
  lighting: Lightbulb,
  power: Zap,
  ops: ClipboardList,
  costs: CircleDollarSign,
  share: Share2,
};

export function CockpitNavRail(): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const setMode = useCockpitStore((s) => s.setMode);
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
