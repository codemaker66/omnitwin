import { type ReactElement, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { z } from "zod";
import { kitRequested } from "../../lib/guest-list/kit-switch.js";
import { usePrivatePageHead } from "../../lib/guest-list/use-private-page-head.js";
import { NotFoundPage } from "../../pages/NotFoundPage.js";
import "./KitGate.css";

// ---------------------------------------------------------------------------
// The planner's kit answers only on a device that has been given `?kit=on`;
// otherwise its pages are the not-found page. With the switch on, the page is
// private (titled, never indexed, never sent on as a referrer) and its address
// must name a plan: anything else is said plainly, and nothing is asked of the
// server. Both kit pages stand behind this one gate.
// ---------------------------------------------------------------------------

const PlanIdSchema = z.uuid();

export interface KitGateProps {
  /** The page's title in the browser's tab. */
  readonly title: string;
  /** The page, given the plan id once the address is known to name one. */
  readonly children: (planId: string) => ReactNode;
}

export function KitGate({ title, children }: KitGateProps): ReactElement {
  const { search } = useLocation();
  return kitRequested(search) ? <KitPage title={title}>{children}</KitPage> : <NotFoundPage />;
}

function KitPage({ title, children }: KitGateProps): ReactElement {
  const { code = "" } = useParams<{ code: string }>();
  usePrivatePageHead(title);

  if (!PlanIdSchema.safeParse(code).success) {
    return (
      <main className="kit-gate" data-register="ivory" data-testid="kit-not-a-plan">
        <div className="kit-gate__sheet">
          <h1 className="kit-gate__title">This address is not a plan</h1>
          <p className="kit-gate__lede">A guest list opens from a plan's own address.</p>
          <p className="kit-gate__action"><Link className="kit-gate__link" to="/plan">Open the planner</Link></p>
        </div>
      </main>
    );
  }
  return <>{children(code)}</>;
}
