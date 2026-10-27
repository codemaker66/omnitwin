import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import type { DepositRequestView, StaffDepositView } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { cancelProposalDeposit, getProposalDeposit, requestProposalDeposit } from "../../../api/deposits.js";
import type { DeskProposal } from "../../../api/proposals.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { useLatestRequest } from "../../../hooks/use-latest-request.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { depositAskedWords, depositStateWords, depositWithdrawable, parsePercentToBasisPoints, previewPercent } from "./deposit-format.js";

// ---------------------------------------------------------------------------
// The deposit, on an accepted proposal (Plan 19 L5): ask for an amount or a
// percentage of the accepted quote, see where it stands as Stripe reports it
// (declined, paid, refunded, still settling), and withdraw it while unpaid.
// Stripe test mode: the panel says so, every time. Paying confirms nothing in
// the Diary; the booking stays the venue's own decision.
// ---------------------------------------------------------------------------

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly view: StaffDepositView };

function refusalWords(error: unknown): string {
  if (error instanceof ApiError && error.status !== 500 && error.message !== "") return error.message;
  return "That did not save. Please try again.";
}

export function DepositPanel({ proposal }: { readonly proposal: DeskProposal }): ReactElement {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const reads = useLatestRequest();

  const read = useCallback((): void => {
    const owns = reads.begin();
    getProposalDeposit(proposal.id).then(
      (view) => { if (owns()) setLoad({ kind: "ready", view }); },
      () => { if (owns()) setLoad((current) => current.kind === "ready" ? current : { kind: "error" }); },
    );
  }, [proposal.id, reads]);
  useEffect(() => { read(); }, [read]);

  return (
    <section className="enq-section pr-deposit" aria-labelledby={headingId} data-testid="deposit-panel">
      <h3 id={headingId}>Deposit</h3>
      {load.kind === "loading" && <ActivityStatus>Reading the deposit…</ActivityStatus>}
      {load.kind === "error" && (
        <>
          <p className="enq-confirm__error" role="alert">The deposit could not be read.</p>
          <div className="enq-actions"><button type="button" className="enq-quiet" onClick={() => { setLoad({ kind: "loading" }); read(); }}>Try again</button></div>
        </>
      )}
      {load.kind === "ready" && <DepositBody proposal={proposal} view={load.view} onChanged={read} />}
    </section>
  );
}

function DepositBody({ proposal, view, onChanged }: { readonly proposal: DeskProposal; readonly view: StaffDepositView; readonly onChanged: () => void }): ReactElement {
  const inForce = view.requests.find((request) => request.cancelledAt === null) ?? null;
  const earlier = view.requests.filter((request) => request !== inForce);
  if (view.availability === "off") {
    // Records stay readable when deposits are switched off; only asking stops.
    return (
      <>
        {inForce !== null && <InForce proposal={proposal} request={inForce} onChanged={onChanged} />}
        <p className="enq-next__hint">
          {inForce === null
            ? "Deposits are not set up for this venue. Once its Stripe account is connected, you ask for one here."
            : "Deposits are switched off for this venue just now, so no new one can be asked for."}
        </p>
        {earlier.length > 0 && <Earlier requests={earlier} />}
      </>
    );
  }
  return (
    <>
      {inForce === null ? <AskForDeposit proposal={proposal} onAsked={onChanged} /> : <InForce proposal={proposal} request={inForce} onChanged={onChanged} />}
      {earlier.length > 0 && <Earlier requests={earlier} />}
      {view.availability === "test" && (
        <p className="enq-next__hint pr-deposit__test" data-testid="deposit-test-mode">Stripe test mode: no real money moves. Paying does not confirm the booking in the Diary.</p>
      )}
    </>
  );
}

function AskForDeposit({ proposal, onAsked }: { readonly proposal: DeskProposal; readonly onAsked: () => void }): ReactElement {
  const basisName = useId();
  const valueId = useId();
  const [basis, setBasis] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const total = proposal.latestTotalMinor;
  const currency = proposal.latestCurrency ?? "GBP";
  const version = proposal.sentVersion;
  if (total === null || version === null || total <= 0) {
    return <p className="enq-next__hint">The accepted version has no quote to take a deposit from.</p>;
  }

  const points = basis === "percent" ? parsePercentToBasisPoints(value) : null;
  const amountMinor = basis === "percent" ? points === null ? null : previewPercent(total, points) : parsePoundsToMinor(value);
  const tooMuch = amountMinor !== null && amountMinor > total;
  const ready = amountMinor !== null && amountMinor > 0 && !tooMuch;

  const ask = (event: FormEvent): void => {
    event.preventDefault();
    if (amountMinor === null || !ready || working) return;
    setWorking(true);
    setFailure(null);
    const input = basis === "percent" && points !== null
      ? { basis: "percent" as const, percentBasisPoints: points, version }
      : { basis: "amount" as const, amountMinor: amountMinor, version };
    requestProposalDeposit(proposal.id, input).then(
      () => { setWorking(false); setValue(""); onAsked(); },
      (error: unknown) => { setWorking(false); setFailure(refusalWords(error)); },
    );
  };

  return (
    <form onSubmit={ask} noValidate data-testid="deposit-ask">
      <fieldset className="pr-deposit__basis">
        <legend className="vv-sr-only">Ask for</legend>
        <label><input type="radio" name={basisName} checked={basis === "percent"} onChange={() => { setBasis("percent"); setValue(""); }} /> A percentage of the quote</label>
        <label><input type="radio" name={basisName} checked={basis === "amount"} onChange={() => { setBasis("amount"); setValue(""); }} /> An amount</label>
      </fieldset>
      <label className="pr-field" htmlFor={valueId}>
        {basis === "percent" ? "Percentage" : "Amount in pounds"}
        <input id={valueId} inputMode="decimal" autoComplete="off" value={value} placeholder={basis === "percent" ? "25" : "500.00"}
          onChange={(event) => { setValue(event.target.value); }} data-testid="deposit-value" aria-invalid={tooMuch} />
      </label>
      <p className="enq-next__hint" role="status">
        {amountMinor === null
          ? `Of version ${String(version)}'s ${formatMinorAsCurrency(total, currency)}, the quote the client accepted.`
          : tooMuch
            ? `More than the ${formatMinorAsCurrency(total, currency)} accepted.`
            : `Comes to ${formatMinorAsCurrency(amountMinor, currency)} of the ${formatMinorAsCurrency(total, currency)} accepted in version ${String(version)}.`}
      </p>
      <div className="enq-actions">
        <button type="submit" className="enq-cta" disabled={!ready || working} aria-busy={working} data-testid="deposit-ask-button">
          {working && <ActivityIndicator size={18} />}
          {working ? "Asking…" : ready ? `Ask for ${formatMinorAsCurrency(amountMinor, currency)}` : "Ask for a deposit"}
        </button>
      </div>
      <p className="enq-next__hint">The client sees it on their link and pays on Stripe's page. Nothing is emailed.</p>
      {failure !== null && <p className="enq-confirm__error" role="alert">{failure}</p>}
    </form>
  );
}

function InForce({ proposal, request, onChanged }: { readonly proposal: DeskProposal; readonly request: DepositRequestView; readonly onChanged: () => void }): ReactElement {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const withdraw = (): void => {
    if (working) return;
    setWorking(true);
    setFailure(null);
    cancelProposalDeposit(proposal.id, request.id).then(
      () => { setWorking(false); onChanged(); },
      (error: unknown) => { setWorking(false); setFailure(refusalWords(error)); onChanged(); },
    );
  };
  return (
    <div className="pr-deposit__in-force" data-state={request.state}>
      <p className="pr-deposit__asked" data-testid="deposit-asked">{depositAskedWords(request)}</p>
      <p className="pr-deposit__state" data-testid="deposit-state">{depositStateWords(request)}</p>
      {request.payments.length > 1 && (
        <p className="enq-next__hint">{String(request.payments.length)} payment pages opened in all.</p>
      )}
      {depositWithdrawable(request) && (
        <div className="enq-actions">
          <button type="button" className="enq-quiet" onClick={withdraw} disabled={working} aria-busy={working} data-testid="deposit-withdraw">
            {working && <ActivityIndicator size={18} />}
            {working ? "Withdrawing…" : "Withdraw the request"}
          </button>
        </div>
      )}
      {depositWithdrawable(request) && <p className="enq-next__hint">Withdrawing closes any payment page the client has open. You can then ask again.</p>}
      {failure !== null && <p className="enq-confirm__error" role="alert">{failure}</p>}
    </div>
  );
}

function Earlier({ requests }: { readonly requests: readonly DepositRequestView[] }): ReactElement {
  return (
    <details className="pr-deposit__earlier">
      <summary>Earlier requests ({String(requests.length)})</summary>
      <ul>
        {requests.map((request) => (
          <li key={request.id}>{depositAskedWords(request)}. {depositStateWords(request)}</li>
        ))}
      </ul>
    </details>
  );
}
