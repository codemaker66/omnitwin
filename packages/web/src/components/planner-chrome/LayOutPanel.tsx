import { useMemo, useRef, useState, type ReactElement } from "react";
import { usePlannerTruth } from "../../hooks/use-planner-truth.js";
import {
  AUTO_FILL_STYLES,
  autoFillPlacedLine,
  autoFillStyleOption,
  publishedFigureFor,
  roomAtSpacingLine,
  type AutoFillPlan,
  type AutoFillStyle,
} from "../../lib/auto-fill.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { sceneFurniturePlacements } from "../../lib/table-dressing.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { AutoFillPrompt } from "../editor/cockpit/AutoFillPrompt.js";
import { QuietKey } from "./Keys.js";
import "./chrome.css";
import "./dock.css";

// ---------------------------------------------------------------------------
// Lay out, in the right zone (T-671 slice 8′; card-dock plan: v1's Fill the
// room reached from the dock's Lay out key until the v2 panel of slice 13).
// The same question v1 asks ("How many guests?") for banquet rounds or
// theatre, on an empty floor; what it placed is said once it is there.
// ---------------------------------------------------------------------------

export function LayOutPanel(): ReactElement {
  const truth = usePlannerTruth();
  const placedItems = usePlacementStore((state) => state.placedItems);
  const sceneItems = useMemo(() => sceneFurniturePlacements(placedItems), [placedItems]);
  const [choosing, setChoosing] = useState<AutoFillStyle | null>(null);
  const [placed, setPlaced] = useState<AutoFillPlan | null>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const close = (): void => { usePlannerChromeStore.getState().close("right"); };
  useEscapeLayer("panel", { open: true, onEscape: close });
  const empty = sceneItems.length === 0;
  const short = placed === null
    ? null
    : roomAtSpacingLine(placed, publishedFigureFor(truth.published, autoFillStyleOption(placed.style).format));

  return (
    <section className="pc-lacquer pc-lacquer--raised pc-layout-panel" aria-label="Lay out" data-testid="lay-out-panel">
      <h2 className="pc-caps pc-layout-panel__heading">Lay out</h2>
      {placed !== null ? (
        <div className="pc-layout-panel__result" role="status">
          <p className="pc-meta">{autoFillPlacedLine(placed)}</p>
          {short !== null ? <p className="pc-meta">{short}</p> : null}
        </div>
      ) : !empty ? (
        <p className="pc-meta pc-layout-panel__line">Clear the floor to lay out a fresh room.</p>
      ) : choosing !== null ? (
        <AutoFillPrompt
          key={choosing}
          {...{
            // The prompt's own prop is named style; it is the layout's style, not CSS.
            style: choosing,
            published: truth.published,
            onPlaced: (plan: AutoFillPlan) => { setChoosing(null); setPlaced(plan); },
            onCancel: () => { setChoosing(null); window.setTimeout(() => { firstChoice.current?.focus(); }, 0); },
          }}
        />
      ) : (
        <div className="pc-layout-panel__choices" role="group" aria-label="Lay out as">
          {AUTO_FILL_STYLES.map((option, index) => (
            <QuietKey
              key={option.style}
              ref={index === 0 ? firstChoice : undefined}
              label={option.label}
              onPress={() => { setChoosing(option.style); }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
