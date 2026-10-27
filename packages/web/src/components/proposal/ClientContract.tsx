import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ClientContractView, ContractDocument } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { getShareContract, signShareContract } from "../../api/contracts.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { useLatestRequest } from "../../hooks/use-latest-request.js";
import { documentFacts, documentMoney, venueLongDate } from "./proposal-document-format.js";

// ---------------------------------------------------------------------------
// The client's contract (Plan 19 L5): the version the venue prepared from the
// proposal they accepted, to read and sign with a simple electronic signature
// (Electronic Communications Act 2000 s.7). The client types their name and
// ticks the statement, word for word as it is kept; the page says what the
// record keeps before they sign. The signature binds this exact version and
// its fingerprint: if the venue changes the contract while the page is open,
// the signature is refused, the new version is shown, and the typed name
// stays.
// ---------------------------------------------------------------------------

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly view: ClientContractView | null };

/** "Version 2 of the contract, prepared 27 October 2026, for the proposal you accepted (version 1)." */
export function contractPreparedWords(version: number, document: ContractDocument): string {
  const prepared = venueLongDate(document.preparedAt);
  return `Version ${String(version)} of the contract${prepared === null ? "" : `, prepared ${prepared}`}, for the proposal you accepted (version ${String(document.proposal.version)}).`;
}

function ContractDocumentView({ document, hash }: { readonly document: ContractDocument; readonly hash: string }): ReactElement {
  const facts = documentFacts(document.event);
  return (
    <div className="pd-contract" data-testid="contract-document">
      <dl className="pd-contract__parties">
        <div><dt>Between</dt><dd>{document.venue.name}{document.venue.address.trim() === "" ? "" : `, ${document.venue.address}`}</dd></div>
        <div><dt>And</dt><dd>{document.client.name} ({document.client.email})</dd></div>
        {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        {document.quote !== null && (
          <div><dt>Price</dt><dd>{documentMoney(document.quote.totalMinor, document.quote.currency)}, as quoted in version {String(document.proposal.version)}</dd></div>
        )}
      </dl>
      <h3 className="pd-contract__terms-heading">Terms</h3>
      <div className="pd-contract__terms">{document.terms}</div>
      <p className="pd-contract__fingerprint">Document fingerprint (SHA-256): <code>{hash}</code></p>
    </div>
  );
}

export function ClientContract({ token }: { readonly token: string }): ReactElement | null {
  const headingId = useId();
  const nameId = useId();
  const consentId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [problem, setProblem] = useState<"name" | "consent" | null>(null);
  const reads = useLatestRequest();
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const consentRef = useRef<HTMLInputElement | null>(null);
  const justSigned = useRef(false);

  const read = useCallback((): Promise<void> => {
    const owns = reads.begin();
    return getShareContract(token).then(
      (view) => { if (owns()) setLoad({ kind: "ready", view }); },
      () => { if (owns()) setLoad((current) => current.kind === "ready" ? current : { kind: "error" }); },
    );
  }, [reads, token]);
  useEffect(() => { void read(); }, [read]);

  const contract = load.kind === "ready" ? load.view?.contract ?? null : null;
  const signed = contract?.signature ?? null;
  // The form gives way to the signature: its sentence takes focus.
  useEffect(() => {
    if (signed !== null && justSigned.current) { justSigned.current = false; outcomeRef.current?.focus(); }
  }, [signed]);

  if (load.kind === "loading") return <p className="pd-settle__loading"><ActivityStatus>Checking for a contract…</ActivityStatus></p>;
  if (load.kind === "error") {
    return (
      <section className="pd-decision pd-settle" data-register="forest" aria-labelledby={headingId}>
        <h2 id={headingId}>Your contract</h2>
        <p role="alert" className="pd-decision__error">The contract could not be loaded.</p>
        <div className="pd-actions"><button type="button" className="pd-quiet" onClick={() => { setLoad({ kind: "loading" }); void read(); }}>Try again</button></div>
      </section>
    );
  }
  if (load.view === null || contract === null) return null;
  const statement = load.view.consentStatement;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (working) return;
    if (name.trim() === "") { setProblem("name"); nameRef.current?.focus(); return; }
    if (!consent) { setProblem("consent"); consentRef.current?.focus(); return; }
    setProblem(null);
    setWorking(true);
    setFailure(null);
    signShareContract(token, { contractVersion: contract.version, documentHash: contract.documentHash, signerName: name.trim(), consent: true })
      .then(() => { justSigned.current = true; return read(); })
      .catch(async (error: unknown) => {
        const changed = error instanceof ApiError && error.code === "CONTRACT_VERSION_CHANGED";
        setFailure(changed
          ? "The venue team changed the contract after you opened this page. The current version is shown above; please read it before signing. Your name is still here."
          : "Your signature did not reach the venue team. Nothing was signed. Please try again.");
        setConsent(false);
        if (changed) await read();
      })
      .finally(() => { setWorking(false); });
  };

  return (
    <section className="pd-decision pd-settle" data-register="forest" aria-labelledby={headingId} data-testid="client-contract">
      <h2 id={headingId}>Your contract</h2>
      <p className="pd-decision__what">{contractPreparedWords(contract.version, contract.document)}</p>
      <ContractDocumentView document={contract.document} hash={contract.documentHash} />
      {signed !== null ? (
        <p ref={outcomeRef} tabIndex={-1} className="pd-decision__outcome" role="status" data-testid="contract-signed">
          Signed by {signed.signerName} on {venueLongDate(signed.signedAt) ?? "the day it was signed"}.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="pd-decision__step" data-testid="contract-sign">
          <label className="pd-field" htmlFor={nameId}>
            Your full name
            <input ref={nameRef} id={nameId} autoComplete="name" value={name} maxLength={200} required
              aria-invalid={problem === "name"} onChange={(event) => { setName(event.target.value); if (event.target.value.trim() !== "") setProblem(null); }} />
          </label>
          <label className="pd-consent" htmlFor={consentId}>
            <input ref={consentRef} id={consentId} type="checkbox" checked={consent} aria-invalid={problem === "consent"}
              onChange={(event) => { setConsent(event.target.checked); if (event.target.checked) setProblem(null); }} />
            <span>{statement}</span>
          </label>
          {problem === "name" && <p role="alert" className="pd-decision__error">Please type your full name to sign.</p>}
          {problem === "consent" && <p role="alert" className="pd-decision__error">Please tick the statement to sign.</p>}
          <div className="pd-actions">
            <button type="submit" className="pd-button" disabled={working} aria-busy={working} data-testid="sign-contract">
              {working && <ActivityIndicator size={18} />}
              {working ? "Signing…" : `Sign version ${String(contract.version)}`}
            </button>
          </div>
          <p className="pd-decision__consequence">
            The venue keeps a record of your signature: the name you type, your email ({contract.document.client.email}), the date and time,
            this document's fingerprint and your browser's description of itself. It cannot be changed afterwards; if the contract changes,
            you are asked to sign the new version.
          </p>
        </form>
      )}
      {failure !== null && <p role="alert" className="pd-decision__error">{failure}</p>}
    </section>
  );
}
