import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicProposal,
  respondToProposal,
  type ProposalResponseAction,
  type PublicProposal,
} from "../api/proposals.js";

// ---------------------------------------------------------------------------
// ProposalPage — the client-facing share-link surface (T-427 phase 3).
//
// CLIENT-SAFE by construction: it renders only the public proposal shape
// (no internal IDs, no layout references, no staff vocabulary). SAFE
// language: figures are presented as planning estimates prepared by the
// venue team; nothing here claims certification, compliance, or occupancy
// approval. Actions available to the client are exactly the two the state
// machine grants the client role on a sent proposal: accept, or request
// changes with a note.
// ---------------------------------------------------------------------------

const SERIF = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const SANS = "'Inter', -apple-system, sans-serif";
const GRAPHITE = "#16181d";
const PANEL = "#1e2128";
const CREAM = "#f2ede3";
const CREAM_MUT = "#b8b2a6";
const GOLD = "#c9a96a";
const HAIRLINE = "rgba(201, 169, 106, 0.25)";

function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

function formatSentDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; proposal: PublicProposal };

const STATUS_BANNERS: Partial<Record<PublicProposal["status"], { heading: string; body: string }>> = {
  accepted: {
    heading: "Proposal accepted",
    body: "Thank you — the venue team has been notified and will be in touch to confirm the next steps.",
  },
  changes_requested: {
    heading: "Changes requested",
    body: "Your feedback has been shared with the venue team. They will review it and send an updated proposal.",
  },
  declined: {
    heading: "Proposal declined",
    body: "This proposal has been declined. The venue team remains available if your plans change.",
  },
  expired: {
    heading: "Proposal expired",
    body: "This proposal is no longer current. Please contact the venue team for an updated version.",
  },
};

export function ProposalPage(): ReactElement {
  const { shareCode } = useParams<{ shareCode: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (shareCode === undefined || shareCode.length === 0) {
      setState({ kind: "error" });
      return;
    }
    getPublicProposal(shareCode)
      .then((proposal) => {
        if (!cancelled) setState({ kind: "ready", proposal });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => { cancelled = true; };
  }, [shareCode]);

  const respond = useCallback(
    (action: ProposalResponseAction, note?: string) => {
      if (shareCode === undefined || state.kind !== "ready" || submitting) return;
      setSubmitting(true);
      setActionError(null);
      respondToProposal(shareCode, action, note)
        .then((result) => {
          setState({ kind: "ready", proposal: { ...state.proposal, status: result.status } });
          setShowChangesForm(false);
        })
        .catch(() => {
          setActionError("Something went wrong sending your response. Please try again, or contact the venue team directly.");
        })
        .finally(() => { setSubmitting(false); });
    },
    [shareCode, state, submitting],
  );

  if (state.kind === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: GRAPHITE, color: CREAM_MUT, fontFamily: SANS }}>
        Loading proposal…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: GRAPHITE, fontFamily: SANS, padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, color: CREAM, marginBottom: 12 }}>
            This proposal link isn't available
          </h1>
          <p style={{ color: CREAM_MUT, fontSize: 15, lineHeight: 1.6 }}>
            The link may have expired or been withdrawn. Please contact the venue team
            who sent it to you for an up-to-date copy.
          </p>
        </div>
      </div>
    );
  }

  const { proposal } = state;
  const banner = STATUS_BANNERS[proposal.status];
  const sentDate = formatSentDate(proposal.sentAt);
  const canRespond = proposal.status === "sent";

  return (
    <div style={{ minHeight: "100vh", background: GRAPHITE, fontFamily: SANS, color: CREAM, padding: "48px 20px 80px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 36 }}>
          {proposal.venueName !== null && (
            <div style={{ color: GOLD, fontSize: 12, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 14 }}>
              {proposal.venueName}
            </div>
          )}
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 42, lineHeight: 1.15, margin: 0 }}>
            {proposal.title}
          </h1>
          {sentDate !== null && (
            <div style={{ color: CREAM_MUT, fontSize: 14, marginTop: 10 }}>Prepared for you on {sentDate}</div>
          )}
        </header>

        {banner !== undefined && (
          <section role="status" style={{ background: PANEL, border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: "18px 22px", marginBottom: 28 }}>
            <div style={{ color: GOLD, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{banner.heading}</div>
            <div style={{ color: CREAM_MUT, fontSize: 14, lineHeight: 1.6 }}>{banner.body}</div>
          </section>
        )}

        {proposal.clientMessage !== null && (
          <section style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 16, lineHeight: 1.75, color: CREAM, whiteSpace: "pre-wrap", margin: 0 }}>
              {proposal.clientMessage}
            </p>
          </section>
        )}

        {proposal.quote !== null && (
          <section aria-label="Quote" style={{ background: PANEL, border: `1px solid ${HAIRLINE}`, borderRadius: 12, padding: "26px 28px", marginBottom: 28 }}>
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, margin: "0 0 18px" }}>Your quote</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: CREAM_MUT, textAlign: "left" }}>
                  <th style={{ fontWeight: 500, padding: "6px 0" }}>Item</th>
                  <th style={{ fontWeight: 500, padding: "6px 0", textAlign: "right" }}>Qty</th>
                  <th style={{ fontWeight: 500, padding: "6px 0", textAlign: "right" }}>Unit</th>
                  <th style={{ fontWeight: 500, padding: "6px 0", textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {proposal.quote.lineItems.map((item, index) => (
                  <tr key={index} style={{ borderTop: `1px solid ${HAIRLINE}` }}>
                    <td style={{ padding: "10px 0", paddingRight: 12 }}>{item.description}</td>
                    <td style={{ padding: "10px 0", textAlign: "right" }}>{item.quantity}</td>
                    <td style={{ padding: "10px 0", textAlign: "right" }}>{formatMinor(item.unitAmountMinor, proposal.quote?.currency ?? "GBP")}</td>
                    <td style={{ padding: "10px 0", textAlign: "right" }}>{formatMinor(item.lineTotalMinor, proposal.quote?.currency ?? "GBP")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `1px solid ${GOLD}` }}>
                  <td colSpan={3} style={{ padding: "12px 0", fontWeight: 600 }}>Total</td>
                  <td style={{ padding: "12px 0", textAlign: "right", fontWeight: 600, color: GOLD, fontSize: 16 }}>
                    {formatMinor(proposal.quote.totalMinor, proposal.quote.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {proposal.capacityNote !== null && (
          <section style={{ background: PANEL, border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: "16px 22px", marginBottom: 28 }}>
            <div style={{ color: GOLD, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
              Capacity guidance — planning estimate
            </div>
            <div style={{ color: CREAM_MUT, fontSize: 14, lineHeight: 1.6 }}>{proposal.capacityNote}</div>
          </section>
        )}

        {canRespond && (
          <section aria-label="Respond to this proposal" style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { respond("accept"); }}
                disabled={submitting}
                style={{ background: GOLD, color: GRAPHITE, border: "none", borderRadius: 8, padding: "13px 30px", fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer", fontFamily: SANS, opacity: submitting ? 0.6 : 1 }}
              >
                Accept proposal
              </button>
              <button
                type="button"
                onClick={() => { setShowChangesForm((open) => !open); }}
                disabled={submitting}
                style={{ background: "transparent", color: CREAM, border: `1px solid ${HAIRLINE}`, borderRadius: 8, padding: "13px 30px", fontSize: 15, cursor: submitting ? "default" : "pointer", fontFamily: SANS }}
              >
                Request changes
              </button>
            </div>

            {showChangesForm && (
              <div style={{ marginTop: 18 }}>
                <label htmlFor="proposal-changes-note" style={{ display: "block", color: CREAM_MUT, fontSize: 13, marginBottom: 8 }}>
                  Tell the venue team what you'd like changed
                </label>
                <textarea
                  id="proposal-changes-note"
                  value={changesNote}
                  onChange={(event) => { setChangesNote(event.target.value); }}
                  maxLength={1000}
                  rows={4}
                  style={{ width: "100%", boxSizing: "border-box", background: PANEL, color: CREAM, border: `1px solid ${HAIRLINE}`, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: SANS, resize: "vertical" }}
                />
                <button
                  type="button"
                  onClick={() => { respond("request_changes", changesNote); }}
                  disabled={submitting || changesNote.trim().length === 0}
                  style={{ marginTop: 10, background: "transparent", color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: SANS, opacity: submitting || changesNote.trim().length === 0 ? 0.5 : 1 }}
                >
                  Send request
                </button>
              </div>
            )}

            {actionError !== null && (
              <div role="alert" style={{ marginTop: 14, color: "#e0a8a0", fontSize: 14 }}>{actionError}</div>
            )}
          </section>
        )}

        <footer style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 18, color: CREAM_MUT, fontSize: 12.5, lineHeight: 1.7 }}>
          Planning document prepared by the venue team. Figures and capacity wording are
          planning estimates for discussion — they are reviewed by a human before anything
          is finalised, and nothing here is a safety, occupancy, or compliance determination.
        </footer>
      </div>
    </div>
  );
}
