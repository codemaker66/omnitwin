import { useCallback, useEffect, useId, useState, type ReactElement } from "react";
import type { ClientDepositView, DepositPaymentView, DepositRequestView } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { getShareDeposit, startShareDepositCheckout } from "../../api/deposits.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { useLatestRequest } from "../../hooks/use-latest-request.js";
import { documentMoney, venueLongDate } from "./proposal-document-format.js";
import { keepDepositReturnToken } from "./deposit-return.js";

// ---------------------------------------------------------------------------
// The client's deposit (Plan 19 L5), below their accepted proposal. The venue
// asks for it; the client pays on Stripe's own page, opened by the API, so no
// card detail ever reaches this page. While Venviewer is in Stripe's test
// mode the page says so plainly: nothing real is taken. Where it stands is
// said from what Stripe has reported, including a declined card, a refund and
// a payment still settling. Back from Stripe, the page reads the deposit
// again a few times, since Stripe's confirmation can arrive a moment after
// the client does.
// ---------------------------------------------------------------------------

/** How the client came back from Stripe's page, if they did. */
export type DepositReturn = "returned" | "left" | null;

const CONFIRMATION_READS = 6;
const CONFIRMATION_GAP_MS = 2_500;

/** The attempt that speaks for the request now: the newest. */
function latestAttempt(request: DepositRequestView): DepositPaymentView | null {
  return request.payments[0] ?? null;
}

/** What the deposit asks for: "A deposit of £625.00, 25% of the £2,500.00 you accepted in version 1." */
export function depositAskWords(request: DepositRequestView): string {
  const amount = documentMoney(request.amountMinor, request.currency);
  const total = documentMoney(request.quoteTotalMinor, request.currency);
  const share = request.basis === "percent" && request.percentBasisPoints !== null
    ? `${(request.percentBasisPoints / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}% of the ${total}`
    : `against the ${total}`;
  return `A deposit of ${amount}, ${share} you accepted in version ${String(request.proposalVersion)}.`;
}

/** Where it stands, in the client's words, and whether they can pay now. */
export function depositStandingWords(request: DepositRequestView): { readonly words: string | null; readonly payable: boolean } {
  const amount = documentMoney(request.amountMinor, request.currency);
  const attempt = latestAttempt(request);
  switch (request.state) {
    case "paid": {
      const on = venueLongDate(attempt?.paidAt ?? null);
      return { words: on === null ? `${amount} paid.` : `${amount} paid on ${on}.`, payable: false };
    }
    case "partially_refunded": {
      const refunded = documentMoney(attempt?.amountRefundedMinor ?? 0, request.currency);
      return { words: `${amount} paid. ${refunded} of it has been refunded.`, payable: false };
    }
    case "refunded":
      return { words: `Your ${amount} deposit has been refunded.`, payable: false };
    case "processing":
      return { words: "Your payment is on its way. Bank payments take a few working days to confirm; this page shows it once Stripe has.", payable: false };
    case "mismatch":
      return { words: "Stripe reported a payment that does not match this deposit. The venue team will be in touch.", payable: false };
    case "cancelled":
      return { words: "The venue team has withdrawn this deposit request.", payable: false };
    case "requested":
      break;
  }
  switch (attempt?.state) {
    case "declined":
      return { words: `Your last attempt did not go through${attempt.failureMessage === null ? "." : `: ${attempt.failureMessage}`} You can try again.`, payable: true };
    case "failed":
      return { words: "Your bank payment did not go through. You can pay again.", payable: true };
    case "expired":
      return { words: "The payment page closed before a payment was made. You can open it again.", payable: true };
    default:
      return { words: null, payable: true };
  }
}

function checkoutFailureWords(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "PAYMENT_PROVIDER_UNAVAILABLE" || error.code === "DEPOSIT_AMOUNT_MISMATCH") return error.message;
    if (error.code === "DEPOSIT_REQUEST_CHANGED" || error.status === 404) return "This deposit request changed while the page was open. It is shown as it now stands.";
    if (error.code === "DEPOSIT_SETTLING") return "This deposit has been paid, or is being paid.";
  }
  return "Stripe's payment page could not be opened. Nothing was charged. Please try again.";
}

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly view: ClientDepositView | null };

export function ClientDeposit({ token, returned }: { readonly token: string; readonly returned: DepositReturn }): ReactElement | null {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const reads = useLatestRequest();

  const read = useCallback((): void => {
    const owns = reads.begin();
    getShareDeposit(token).then(
      (view) => { if (owns()) setLoad({ kind: "ready", view }); },
      () => { if (owns()) setLoad((current) => current.kind === "ready" ? current : { kind: "error" }); },
    );
  }, [reads, token]);

  useEffect(() => { read(); }, [read]);

  const request = load.kind === "ready" ? load.view?.request ?? null : null;
  // Back from Stripe with nothing reported yet: Stripe's confirmation is on
  // its way, so the deposit is read again, a few times, then left to the client.
  const awaiting = returned === "returned" && request !== null && request.state === "requested"
    && (latestAttempt(request)?.state ?? "open") === "open";
  useEffect(() => {
    if (!awaiting || checks >= CONFIRMATION_READS) return;
    const timer = window.setTimeout(() => { setChecks((n) => n + 1); read(); }, CONFIRMATION_GAP_MS);
    return () => { window.clearTimeout(timer); };
  }, [awaiting, checks, read]);

  if (load.kind === "loading") return <p className="pd-settle__loading"><ActivityStatus>Checking for a deposit…</ActivityStatus></p>;
  if (load.kind === "error") {
    return (
      <section className="pd-decision pd-settle" data-register="forest" aria-labelledby={headingId}>
        <h2 id={headingId}>Your deposit</h2>
        <p role="alert" className="pd-decision__error">The deposit could not be loaded.</p>
        <div className="pd-actions">
          <button type="button" className="pd-quiet" onClick={() => { setLoad({ kind: "loading" }); read(); }}>Try again</button>
        </div>
      </section>
    );
  }
  if (load.view === null || request === null) return null;

  const mode = load.view.mode;
  const found = depositStandingWords(request);
  // Read only once the link can no longer pay (withdrawn, or the proposal archived).
  const standing = { ...found, payable: found.payable && load.view.payable };
  const amount = documentMoney(request.amountMinor, request.currency);

  const pay = (): void => {
    if (opening) return;
    setOpening(true);
    setFailure(null);
    startShareDepositCheckout(token, request.id).then(
      (url) => {
        // Stripe is given an address without the token; this tab keeps it to come back.
        keepDepositReturnToken(token);
        window.location.assign(url);
      },
      (error: unknown) => {
        setFailure(checkoutFailureWords(error));
        setOpening(false);
        read();
      },
    );
  };

  return (
    <section className="pd-decision pd-settle" data-register="forest" aria-labelledby={headingId} data-testid="client-deposit">
      <h2 id={headingId}>Your deposit</h2>
      <p className="pd-decision__what">{depositAskWords(request)}</p>
      {standing.words !== null && <p className="pd-decision__notice" data-state={request.state} data-testid="deposit-standing">{standing.words}</p>}
      {awaiting && checks < CONFIRMATION_READS && <ActivityStatus>Waiting for Stripe to confirm your payment…</ActivityStatus>}
      {awaiting && checks >= CONFIRMATION_READS && (
        <p className="pd-decision__hint" role="status">
          Stripe has not confirmed a payment yet. If you paid, it will show here shortly.{" "}
          <button type="button" className="pd-link" onClick={() => { setChecks(0); read(); }}>Check again</button>
        </p>
      )}
      {returned === "left" && standing.payable && <p className="pd-decision__hint" role="status">You left Stripe's page before paying. Nothing was charged.</p>}
      {standing.payable && !awaiting && (
        <div className="pd-actions">
          <button type="button" className="pd-button" onClick={pay} disabled={opening} aria-busy={opening} data-testid="pay-deposit">
            {opening && <ActivityIndicator size={18} />}
            {opening ? "Opening Stripe…" : `Pay ${amount}`}
          </button>
        </div>
      )}
      {standing.payable && (
        <p className="pd-decision__consequence">
          You pay on Stripe's secure page and come back here. Paying the deposit does not confirm the booking; the venue team does that.
        </p>
      )}
      {mode === "test" && (
        <p className="pd-settle__test" data-testid="deposit-test-mode">
          Test mode: this is a rehearsal of the payment. Stripe takes no real money, and a real card is never charged.
        </p>
      )}
      {failure !== null && <p role="alert" className="pd-decision__error">{failure}</p>}
    </section>
  );
}
