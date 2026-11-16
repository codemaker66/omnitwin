import { type ReactElement } from "react";
import { KitGate } from "../components/guest-list/KitGate.js";

// ---------------------------------------------------------------------------
// The planner's table plan and paper (the planner's kit). Its address is
// /plan/:code/guests/paper, with the sheet named in `?sheet=`, and it answers
// only on a device that has been given `?kit=on`. This is the shell: the kit's
// gate (the switch, the plan-id check and the private page head) and one root.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Table plan and paper";

export function GuestPaperPage(): ReactElement {
  return (
    <KitGate title={PAGE_TITLE}>
      {() => <div className="gp" data-register="ivory" data-testid="guest-paper-page" />}
    </KitGate>
  );
}

export default GuestPaperPage;
