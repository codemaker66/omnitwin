import { useEffect, useId, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { getProposalPreview, type PublicProposal } from "../api/proposals.js";
import { ProposalDocument } from "../components/proposal/ProposalDocument.js";
import { documentMoney, documentTitle } from "../components/proposal/proposal-document-format.js";
import { ActivityStatus } from "../components/shared/Activity.js";
import { useLatestRequest } from "../hooks/use-latest-request.js";

// ---------------------------------------------------------------------------
// Preview as the client (roadmap X1): the venue team reads the proposal's
// latest saved version exactly as its client would, in a tab of its own, so
// a draft in the desk's composer is never lost. It calls no public endpoint:
// nothing is answered, and it is never counted as the link being opened. The
// band says which version the client's link shows.
// ---------------------------------------------------------------------------

type PreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "refused"; readonly words: string }
  | { readonly kind: "ready"; readonly proposal: PublicProposal };

function refusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "PROPOSAL_HAS_NO_VERSION") return "Nothing is saved on this proposal yet. Save a version, then preview it.";
    if (error.status === 404) return "There is no such proposal. It may have been deleted.";
    if (error.status === 403) return "This proposal is not one you can preview.";
  }
  return "The preview could not be read. Please try again.";
}

/** Which version the client's link shows, beside this one. */
export function previewStanding(version: number, sentVersion: number | null): string {
  if (sentVersion === null) return "It has not been sent yet.";
  if (sentVersion === version) return "This is the version the client's link shows.";
  return `It has not been sent yet; the client's link shows version ${String(sentVersion)}.`;
}

function PreviewDecision({ proposal }: { readonly proposal: PublicProposal }): ReactElement {
  const headingId = useId();
  const total = proposal.quote === null ? null : documentMoney(proposal.quote.totalMinor, proposal.quote.currency);
  return (
    <section className="pd-decision" data-register="forest" aria-labelledby={headingId} data-testid="preview-decision">
      <h2 id={headingId}>Your decision</h2>
      <p className="pd-decision__what">
        {total === null ? `Version ${String(proposal.version)}.` : `Version ${String(proposal.version)} comes to ${total}.`}
      </p>
      <p className="pd-decision__hint">
        Here the client gives their name and accepts, or asks for changes. Nothing can be answered from this preview.
      </p>
    </section>
  );
}

export function ProposalPreviewPage(): ReactElement {
  const { proposalId } = useParams<{ proposalId: string }>();
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const reads = useLatestRequest();

  useEffect(() => {
    const owns = reads.begin();
    if (proposalId === undefined || proposalId === "") {
      setState({ kind: "refused", words: "There is no such proposal." });
      return;
    }
    setState({ kind: "loading" });
    getProposalPreview(proposalId).then(
      (proposal) => { if (owns()) setState({ kind: "ready", proposal }); },
      (error: unknown) => { if (owns()) setState({ kind: "refused", words: refusal(error) }); },
    );
  }, [proposalId, reads]);

  useEffect(() => {
    if (state.kind === "ready") document.title = `Preview — ${documentTitle(state.proposal)}`;
  }, [state]);

  if (state.kind !== "ready") {
    return (
      <main aria-label="Proposal preview" className="pd-page" data-register="ivory">
        <div className="pd-sheet pd-state">
          {state.kind === "loading"
            ? <ActivityStatus variant="panel">Opening the preview…</ActivityStatus>
            : <><h1>No preview</h1><p role="alert">{state.words}</p></>}
        </div>
      </main>
    );
  }

  const { proposal } = state;
  return (
    <main aria-label="Proposal preview">
      <ProposalDocument
        proposal={proposal}
        showStanding={proposal.sentVersion === proposal.version}
        band={(
          <p className="pd-band" data-register="forest" data-testid="preview-band">
            <strong>Preview of version {String(proposal.version)}, as the client sees it.</strong>{" "}
            {previewStanding(proposal.version, proposal.sentVersion)}{" "}
            Opening it here is not counted as the link being opened.
          </p>
        )}
        decision={proposal.status === "sent" || proposal.status === "draft" || proposal.status === "changes_requested"
          ? <PreviewDecision proposal={proposal} /> : null}
      />
    </main>
  );
}
