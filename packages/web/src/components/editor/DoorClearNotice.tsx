import { useId, useMemo, useState, type ReactElement } from "react";
import { DoorOpen } from "lucide-react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useAssemblyRecallStore } from "../../floor/assembly/recall.js";
import { doorBlockedLine, doorBlockers } from "../../lib/keep-doors-clear.js";
import { moveDoorBlockersClear } from "../../lib/door-clear-actions.js";
import type { PlacedItem } from "../../lib/placement.js";
import "./DoorClearNotice.css";

// ---------------------------------------------------------------------------
// DoorClearNotice — a table already in front of a door (Blake, 27 Oct 2026:
// "Keep them clear automatically (Recommended)").
//
// A layout saved before the door rule, or a piece nudged into a door's clear
// space by keys or typed figures, is never moved by itself. This says which
// table stands in front of which door, with one tap to move it clear
// (lib/door-clear-actions: free floor only, one undo step). When there is no
// free floor nearby, it says so instead of offering a tap that cannot work.
// It keeps out of the way while a piece is carried or placed and while the
// hall assembles. The status region stays mounted so a screen reader hears it.
// ---------------------------------------------------------------------------

export function DoorClearNotice({ mobile = false }: { readonly mobile?: boolean }): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const spaces = useDoorClearSpaceStore((state) => state.spaces);
  const carrying = useDoorClearSpaceStore((state) => state.carrying);
  const placing = useCatalogueStore((state) => state.selectedItemId !== null);
  const assembling = useAssemblyRecallStore((state) => state.active);
  const blockers = useMemo(() => doorBlockers(placedItems, spaces), [placedItems, spaces]);
  // The layout a tap could not clear: the hint stands until the layout changes.
  const [stuckOn, setStuckOn] = useState<readonly PlacedItem[] | null>(null);
  const lineId = useId();

  const shown = blockers.length > 0 && !carrying && !placing && !assembling;
  const stuck = stuckOn === placedItems;
  const many = blockers.length > 1;

  const moveClear = (): void => {
    moveDoorBlockersClear();
    const after = usePlacementStore.getState().placedItems;
    setStuckOn(doorBlockers(after, spaces).length > 0 ? after : null);
  };

  return (
    <div
      className={mobile ? "door-clear-notice is-mobile" : "door-clear-notice"}
      role="status"
      aria-live="polite"
      data-testid="door-clear-notice-region"
    >
      {shown && (
        <div className="door-clear-notice__card" data-testid="door-clear-notice">
          <DoorOpen className="door-clear-notice__mark" size={16} strokeWidth={1.5} aria-hidden="true" />
          <div className="door-clear-notice__words">
            <p className="door-clear-notice__line" id={lineId} data-testid="door-clear-notice-line">{doorBlockedLine(blockers)}</p>
            {stuck && (
              <p className="door-clear-notice__stuck" data-testid="door-clear-notice-stuck">
                {many
                  ? "There is no free floor near them. Make room beside them, or move them by hand."
                  : "There is no free floor near it. Make room beside it, or move it by hand."}
              </p>
            )}
          </div>
          {!stuck && (
            <button
              type="button"
              className="door-clear-notice__move"
              aria-describedby={lineId}
              onClick={moveClear}
              data-testid="door-clear-notice-move"
            >
              {many ? "Move them clear" : "Move it clear"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
