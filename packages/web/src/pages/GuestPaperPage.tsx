import { type ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { z } from "zod";
import { kitRequested } from "../lib/guest-list/kit-switch.js";
import { usePrivatePageHead } from "../lib/guest-list/use-private-page-head.js";
import { NotFoundPage } from "./NotFoundPage.js";

// ---------------------------------------------------------------------------
// The planner's table plan and paper (the planner's kit). Its address is
// /plan/:code/guests/paper, with the sheet named in `?sheet=`, and it answers
// only on a device that has been given `?kit=on`. This is the shell: the
// switch, the plan-id check, the private page head and one root.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Table plan and paper";
const PlanIdSchema = z.uuid();

function GuestPaperShell(): ReactElement {
  const { code = "" } = useParams<{ code: string }>();
  usePrivatePageHead(PAGE_TITLE);

  if (!PlanIdSchema.safeParse(code).success) {
    return (
      <main className="gp" data-register="ivory" data-testid="guest-paper-not-a-plan">
        <h1>This address is not a plan</h1>
        <p><Link to="/plan">Open the planner</Link></p>
      </main>
    );
  }
  return <div className="gp" data-register="ivory" data-testid="guest-paper-page" />;
}

export function GuestPaperPage(): ReactElement {
  const { search } = useLocation();
  return kitRequested(search) ? <GuestPaperShell /> : <NotFoundPage />;
}

export default GuestPaperPage;
