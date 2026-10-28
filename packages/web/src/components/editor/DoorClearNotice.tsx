import { useId, useMemo, useState, type ReactElement } from "react";
import { DoorOpen } from "lucide-react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useAssemblyRecallStore } from "../../floor/assembly/recall.js";
import { doorBlockedLine, doorBlockers, type DoorBlocker } from "../../lib/keep-doors-clear.js";
import { moveDoorBlockersClear } from "../../lib/door-clear-actions.js";
import type { PlacedItem } from "../../lib/placement.js";
import { isTableDressingApplicator } from "../../lib/table-dressing.js";
import "./DoorClearNotice.css";

const NO_BLOCKERS: readonly DoorBlocker[] = [];

// ---------------------------------------------------------------------------
// DoorClearNotice — a table in front of a door. Blake, 28 Oct 2026: "let
// people place tables within the red zone but have a warning on it (an
// aesthetic warning of some kind, not something annoying or makes it look
// bad)".
//
// A piece placed in a door's clear space, or a layout saved before the door
// rule, is never moved by itself. This says calmly which table is in front of
// which door, beside the floor's warm glow (DoorClearSpaceLayer), with one tap
// to move it clear (lib/door-clear-actions: free floor only, one undo step).
// When there is no free floor nearby, it says so instead of offering a tap
// that cannot work. It keeps out of the way while a piece is carried or
// placed and while the hall assembles. The status region stays mounted so a
// screen reader hears it. In the new chrome it sits in the zone above the
// dock (`zoned`), apart from the slate's own notice.
// ---------------------------------------------------------------------------

export function DoorClearNotice({ mobile = false, zoned = false }: { readonly mobile?: boolean; readonly zoned?: boolean }): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const spaces = useDoorClearSpaceStore((state) => state.spaces);
  const carrying = useDoorClearSpaceStore((state) => state.carrying);
  // A piece set down on the floor, as the floor layer reads it: a cloth or place setting dresses a table instead.
  const placing = useCatalogueStore((state) => state.selectedItemId !== null && !isTableDressingApplicator(state.selectedItemId));
  const assembling = useAssemblyRecallStore((state) => state.active);
  // Read only while the notice can show: a carry rewrites the layout every frame.
  const idle = !carrying && !placing && !assembling;
  const blockers = useMemo(() => (idle ? doorBlockers(placedItems, spaces) : NO_BLOCKERS), [idle, placedItems, spaces]);
  // The layout a tap could not clear: the hint stands until the layout changes.
  const [stuckOn, setStuckOn] = useState<readonly PlacedItem[] | null>(null);
  const lineId = useId();

  const shown = blockers.length > 0;
  const stuck = stuckOn === placedItems;
  const many = blockers.length > 1;

  const moveClear = (): void => {
    moveDoorBlockersClear();
    const after = usePlacementStore.getState().placedItems;
    setStuckOn(doorBlockers(after, spaces).length > 0 ? after : null);
  };

  return (
    <div
      className={zoned ? "door-clear-notice is-zoned" : mobile ? "door-clear-notice is-mobile" : "door-clear-notice"}
      role="status"
      aria-live="polite"
      data-testid="door-clear-notice-region"
    >
      {shown && (
        <div className="door-clear-notice__card" data-testid="door-clear-notice">
          <DoorOpen className="door-clear-notice__mark" size={16} strokeWidth={1.5} aria-hidden="true" />
          <div className="door-clear-notice__words">
            <p className="door-clear-notice__line" id={lineId} data-testid="door-clear-notice-line">{doorBlockedLine(blockers, spaces)}</p>
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
