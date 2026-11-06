import { useEffect, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActivityStatus } from "../components/shared/Activity.js";
import { takeDepositReturnToken } from "../components/proposal/deposit-return.js";
import "../components/proposal/ProposalDocument.css";

// ---------------------------------------------------------------------------
// Back from Stripe's payment page (Plan 19 L5). Stripe is given this address,
// never the client's proposal link: Stripe keeps the address and shows the
// way back on its page, and the share token is the client's key to their
// proposal. The tab that left kept the token; this page returns to it, says
// how the client came back, and forgets the token. A different tab or device
// has no token here, so the page says plainly where to look instead.
// ---------------------------------------------------------------------------

type Outcome = "returned" | "left";

export function DepositReturnPage(): ReactElement {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const outcome: Outcome = search.get("outcome") === "left" ? "left" : "returned";
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const token = takeDepositReturnToken();
    if (token === null) { setMissing(true); return; }
    void navigate(`/proposal-share/${encodeURIComponent(token)}?deposit=${outcome}`, { replace: true });
  }, [navigate, outcome]);

  return (
    <main aria-label="Back from the payment page" className="pd-page" data-register="ivory">
      <div className="pd-sheet pd-state">
        {!missing ? (
          <ActivityStatus variant="panel">Returning to your proposal…</ActivityStatus>
        ) : (
          <>
            <h1>{outcome === "left" ? "Nothing was charged" : "Your payment is with Stripe"}</h1>
            <p>
              {outcome === "left"
                ? "You left Stripe's page before paying. Open your proposal link from the venue team's message to pay when you are ready."
                : "Open your proposal link from the venue team's message to see your deposit. It shows as paid once Stripe confirms it."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
