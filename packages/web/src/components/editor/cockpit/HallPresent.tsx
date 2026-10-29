// ---------------------------------------------------------------------------
// HallPresent — Present on a phone or tablet, in the Grand Hall's View sheet
//
// The desktop's Present is in the planner's command deck, which a touch or
// narrow screen does not show. Here it is the sheet's last row, with what it
// plays (or why it can't) written beneath it, since a touch screen shows no
// tooltip. Once the room starts to play, the sheet steps out of the way.
// ---------------------------------------------------------------------------

import { useId, type ReactElement } from "react";
import { Clapperboard } from "lucide-react";
import { pressPlannerPresent, presentLine, usePlannerPresent } from "../planner-present.js";

export function HallPresent({ onPresented }: { readonly onPresented: () => void }): ReactElement {
  const present = usePlannerPresent();
  const lineId = useId();
  return (
    <div className="hall-view-present">
      <button
        type="button"
        className="cockpit-layer-btn hall-view-present__button"
        aria-describedby={lineId}
        disabled={present.kind === "unavailable"}
        data-testid="hall-view-present"
        // A press from the keys (Enter or Space) has no pointer behind it: detail 0.
        onClick={(event) => { if (pressPlannerPresent(event.detail === 0) !== null) onPresented(); }}
      >
        <Clapperboard size={14} aria-hidden="true" />
        Present
      </button>
      <p id={lineId} className="hall-view-present__line">{presentLine(present)}</p>
    </div>
  );
}
