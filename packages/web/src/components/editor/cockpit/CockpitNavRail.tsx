import { Fragment, useId, type ReactElement } from "react";
import {
  Box, Users, Waypoints, FileCheck2, Lightbulb, Zap, Anchor, Volume2, ClipboardList,
  CircleDollarSign, Share2, type LucideIcon,
} from "lucide-react";
import type { CockpitMode } from "../../../lib/cockpit-modes.js";
import type { CockpitLens } from "../../../lib/cockpit-lenses.js";
import { useLensRail, useShownLens } from "../../../lib/use-lens-rail.js";
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

/**
 * The lens rail. Which lenses it offers, whether they are named and where the
 * "Venue tools" divider falls all come from the viewer's rail
 * (lib/cockpit-lenses.ts, Blake's decision 5); with its keys off it is
 * today's eleven unnamed icons. A divided run of lenses is a labelled group,
 * so a screen reader entering it hears "Venue tools" once, and its visible
 * label is the divider. Design is pressed whenever the active lens is one
 * this viewer is not offered.
 */
export function CockpitNavRail(): ReactElement {
  const lensRail = useLensRail();
  const shown = useShownLens();
  const setMode = useCockpitStore((s) => s.setMode);
  const groupId = useId();
  const renderLens = (lens: CockpitLens): ReactElement => {
    const Icon = MODE_ICONS[lens.id];
    const active = lens.id === shown;
    return (
      <button
        key={lens.id}
        type="button"
        className={active ? "cockpit-rail__button is-active" : "cockpit-rail__button"}
        aria-pressed={active}
        aria-label={lens.label}
        // A visible name needs no tooltip repeating it.
        title={lensRail.named ? undefined : lens.label}
        onClick={() => { setMode(lens.id); }}
      >
        <Icon size={20} aria-hidden="true" />
        <span>{lens.label}</span>
      </button>
    );
  };
  return (
    <nav
      className={lensRail.named ? "cockpit-rail is-named" : "cockpit-rail"}
      aria-label="Planner lenses"
      data-testid="cockpit-rail"
    >
      <div className="cockpit-rail__list">
        {lensRail.sections.map((section, index) => {
          if (section.label === null) return <Fragment key={`lenses-${String(index)}`}>{section.lenses.map(renderLens)}</Fragment>;
          const labelId = `${groupId}-${String(index)}`;
          return (
            <div key={section.label} className="cockpit-rail__group" role="group" aria-labelledby={labelId}>
              <span id={labelId} className="cockpit-rail__divider">{section.label}</span>
              {section.lenses.map(renderLens)}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
