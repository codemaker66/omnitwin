import { type ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { z } from "zod";
import { kitRequested } from "../lib/guest-list/kit-switch.js";
import { usePrivatePageHead } from "../lib/guest-list/use-private-page-head.js";
import { NotFoundPage } from "./NotFoundPage.js";

// ---------------------------------------------------------------------------
// The planner's guest list (the planner's kit). Its address is
// /plan/:code/guests, and it answers only on a device that has been given
// `?kit=on`. This is the shell: the switch, the plan-id check, the private
// page head and one root. The list itself is not opened here.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Guest list";
const PlanIdSchema = z.uuid();

function GuestListShell(): ReactElement {
  const { code = "" } = useParams<{ code: string }>();
  usePrivatePageHead(PAGE_TITLE);

  if (!PlanIdSchema.safeParse(code).success) {
    return (
      <main className="gl" data-register="ivory" data-testid="guest-list-not-a-plan">
        <h1>This address is not a plan</h1>
        <p><Link to="/plan">Open the planner</Link></p>
      </main>
    );
  }
  return <div className="gl" data-register="ivory" data-testid="guest-list-page" />;
}

export function GuestListPage(): ReactElement {
  const { search } = useLocation();
  return kitRequested(search) ? <GuestListShell /> : <NotFoundPage />;
}

export default GuestListPage;
