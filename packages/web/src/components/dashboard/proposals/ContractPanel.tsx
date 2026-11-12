import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import { MAX_CONTRACT_TERMS_LENGTH, type StaffContractVersion, type StaffContractView } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { getProposalContract, prepareProposalContract } from "../../../api/contracts.js";
import type { DeskProposal } from "../../../api/proposals.js";
import { useLatestRequest } from "../../../hooks/use-latest-request.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { venueMoment } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The contract on an accepted proposal (Plan 19 L5): the venue sets its terms
// and the server prepares a version from the accepted proposal (the event,
// the quote as accepted, the client and their email), so nothing is retyped.
// The booker sees who signed which version and when, with the record a
// signature keeps. Changing the terms makes a new version for the client to
// sign; a signature already given stays with the version it signed.
// ---------------------------------------------------------------------------

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly view: StaffContractView };

/**
 * "Signed as Ada Client through the link sent to ada@example.com, Tue 27 Oct, 14:05."
 * or "Not signed yet." The name is what the signer typed; the email is where the
 * link went, not a checked identity, so the words keep the two apart.
 */
export function contractSignatureWords(version: StaffContractVersion): string {
  const signature = version.signature;
  if (signature === null) return "Not signed yet. The client signs it on their link.";
  return `Signed as ${signature.signerName} through the link sent to ${signature.signerEmail}, ${venueMoment(signature.signedAt) ?? signature.signedAt}.`;
}

export function ContractPanel({ proposal }: { readonly proposal: DeskProposal }): ReactElement {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const reads = useLatestRequest();
  const read = useCallback((): void => {
    const owns = reads.begin();
    getProposalContract(proposal.id).then(
      (view) => { if (owns()) setLoad({ kind: "ready", view }); },
      () => { if (owns()) setLoad((current) => current.kind === "ready" ? current : { kind: "error" }); },
    );
  }, [proposal.id, reads]);
  useEffect(() => { read(); }, [read]);

  return (
    <section className="enq-section pr-contract" aria-labelledby={headingId} data-testid="contract-panel">
      <h3 id={headingId}>Contract</h3>
      {load.kind === "loading" && <ActivityStatus>Reading the contract…</ActivityStatus>}
      {load.kind === "error" && (
        <>
          <p className="enq-confirm__error" role="alert">The contract could not be read.</p>
          <div className="enq-actions"><button type="button" className="enq-quiet" onClick={() => { setLoad({ kind: "loading" }); read(); }}>Try again</button></div>
        </>
      )}
      {load.kind === "ready" && <ContractBody proposal={proposal} view={load.view} onChanged={read} />}
    </section>
  );
}

function ContractBody({ proposal, view, onChanged }: { readonly proposal: DeskProposal; readonly view: StaffContractView; readonly onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const latest = view.versions[0] ?? null;
  const earlier = view.versions.slice(1);
  // What is on record always shows; only preparing a version waits for an
  // accepted proposal and the client's email.
  const acceptedVersion = view.acceptedVersion;
  const blocked = acceptedVersion === null
    ? "A contract is prepared once the client has accepted the proposal."
    : view.clientEmail === null
      ? "Add the client's email to the deal or the enquiry first: the contract names it, and the signature records it."
      : null;
  return (
    <>
      {latest !== null && (
        <div className="pr-contract__latest" data-signed={latest.signature !== null}>
          <p className="pr-contract__version" data-testid="contract-version">
            Version {String(latest.version)}, prepared {venueMoment(latest.createdAt) ?? ""}{latest.createdByLabel === null ? "" : ` by ${latest.createdByLabel}`}, from proposal version {String(latest.proposalVersion)}.
          </p>
          <p className="pr-contract__signature" data-testid="contract-signature">{contractSignatureWords(latest)}</p>
          {latest.signature !== null && <SignatureRecord version={latest} />}
        </div>
      )}
      {blocked !== null || acceptedVersion === null ? (
        <p className="enq-next__hint" data-testid="contract-blocked">{blocked}</p>
      ) : latest === null || editing ? (
        <PrepareContract proposal={proposal} acceptedVersion={acceptedVersion} latest={latest}
          onDone={() => { setEditing(false); onChanged(); }} onCancel={latest === null ? null : () => { setEditing(false); }} />
      ) : (
        <div className="enq-actions">
          <button type="button" className="enq-quiet" onClick={() => { setEditing(true); }} data-testid="contract-change">Change the terms…</button>
        </div>
      )}
      {earlier.length > 0 && (
        <details className="pr-contract__earlier">
          <summary>Earlier versions ({String(earlier.length)})</summary>
          <ul>
            {earlier.map((version) => (
              <li key={version.id}>
                Version {String(version.version)}: {contractSignatureWords(version)}
                {version.signature !== null && <SignatureRecord version={version} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** What the signature record keeps, for the venue's own file. */
function SignatureRecord({ version }: { readonly version: StaffContractVersion }): ReactElement | null {
  const signature = version.signature;
  if (signature === null) return null;
  return (
    <dl className="pr-contract__record" data-testid="signature-record">
      <div><dt>Document fingerprint</dt><dd><code>{signature.documentHash}</code></dd></div>
      <div><dt>Statement agreed to</dt><dd>{signature.consentStatement}</dd></div>
      <div><dt>Browser</dt><dd>{signature.userAgent ?? "Not given"}</dd></div>
      <div><dt>Through the link</dt><dd>{signature.shareTokenPrefix === null ? "Not recorded" : `${signature.shareTokenPrefix}…`}</dd></div>
    </dl>
  );
}

function PrepareContract({ proposal, acceptedVersion, latest, onDone, onCancel }: {
  readonly proposal: DeskProposal;
  readonly acceptedVersion: number;
  readonly latest: StaffContractVersion | null;
  readonly onDone: () => void;
  readonly onCancel: (() => void) | null;
}): ReactElement {
  const termsId = useId();
  const [terms, setTerms] = useState(latest?.document.terms ?? "");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const next = (latest?.version ?? 0) + 1;

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (working || terms.trim() === "") return;
    setWorking(true);
    setFailure(null);
    prepareProposalContract(proposal.id, { terms: terms.trim(), version: acceptedVersion }).then(
      () => { setWorking(false); onDone(); },
      (error: unknown) => {
        setWorking(false);
        setFailure(error instanceof ApiError && error.status !== 500 && error.message !== "" ? error.message : "The contract did not save. Please try again.");
      },
    );
  };

  return (
    <form onSubmit={save} noValidate data-testid="contract-prepare">
      <label className="pr-field" htmlFor={termsId}>
        {latest === null ? "The venue's terms" : `Terms for version ${String(next)}`}
        <textarea id={termsId} value={terms} rows={8} maxLength={MAX_CONTRACT_TERMS_LENGTH} onChange={(event) => { setTerms(event.target.value); }}
          data-testid="contract-terms" />
      </label>
      <p className="enq-next__hint">
        The contract takes the event, the quote the client accepted in version {String(acceptedVersion)}, and the client's name and email from the proposal; only the terms are written here.
      </p>
      {latest !== null && latest.signature !== null && (
        <p className="enq-next__hint" role="note">
          Version {String(latest.version)} is signed. Saving makes version {String(next)}, which the client signs afresh; the signature on version {String(latest.version)} stays on record.
        </p>
      )}
      <div className="enq-actions">
        <button type="submit" className="enq-cta" disabled={working || terms.trim() === ""} aria-busy={working} data-testid="contract-save">
          {working && <ActivityIndicator size={18} />}
          {working ? "Preparing…" : latest === null ? "Prepare the contract" : `Save as version ${String(next)}`}
        </button>
        {onCancel !== null && <button type="button" className="enq-quiet" onClick={onCancel} disabled={working}>Keep version {String(latest?.version ?? 1)}</button>}
      </div>
      <p className="enq-next__hint">The client sees it on their link. Nothing is emailed.</p>
      {failure !== null && <p className="enq-confirm__error" role="alert">{failure}</p>}
    </form>
  );
}
