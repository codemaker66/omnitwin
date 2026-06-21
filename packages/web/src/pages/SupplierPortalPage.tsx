import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  acknowledgeSupplierShare,
  getSupplierShare,
  type CreateSupplierAcknowledgementInput,
  type SupplierAcknowledgementStatus,
  type SupplierSafePackView,
} from "../api/supplier-coordination.js";
import "./SupplierPortalPage.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; pack: SupplierSafePackView };

const STATUS_LABELS: Readonly<Record<SupplierSafePackView["status"], string>> = {
  draft: "Draft",
  issued: "Issued",
  acknowledged: "Acknowledged",
  changes_requested: "Clarification requested",
  revoked: "Withdrawn",
  expired: "Expired",
};

const ITEM_KIND_LABELS: Readonly<Record<SupplierSafePackView["items"][number]["kind"], string>> = {
  requirement: "Requirement",
  load_in_window: "Load-in",
  handoff_instruction: "Handoff",
  contact_note: "Contact",
};

const ACK_STATUS_LABELS: Readonly<Record<SupplierAcknowledgementStatus, string>> = {
  acknowledged: "Acknowledged",
  needs_clarification: "Needs clarification",
};

function formatDateTime(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusAllowsAcknowledgement(status: SupplierSafePackView["status"]): boolean {
  return status === "issued" || status === "changes_requested";
}

function sourceVersionLabel(pack: SupplierSafePackView): string {
  const compiled = formatDateTime(pack.source.compiledAt);
  return compiled === null
    ? `Handoff v${String(pack.source.handoffVersion)}`
    : `Handoff v${String(pack.source.handoffVersion)} - ${compiled}`;
}

function newestAcknowledgementLabel(acknowledgements: readonly SupplierSafePackView["acknowledgements"][number][]): string | null {
  const latest = acknowledgements[acknowledgements.length - 1];
  if (latest === undefined) return null;
  const when = formatDateTime(latest.createdAt);
  const actor = latest.acknowledgedByName ?? "Supplier contact";
  return when === null ? actor : `${actor} - ${when}`;
}

export function SupplierPortalPage(): ReactElement {
  const { token } = useParams<{ token?: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [ackStatus, setAckStatus] = useState<SupplierAcknowledgementStatus>("acknowledged");
  const [ackName, setAckName] = useState("");
  const [ackEmail, setAckEmail] = useState("");
  const [ackNote, setAckNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (token === undefined || token.length === 0) {
      setState({ kind: "error" });
      return;
    }
    let cancelled = false;
    getSupplierShare(token)
      .then((pack) => {
        if (!cancelled) setState({ kind: "ready", pack });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submitDisabled = useMemo(() => {
    const hasIdentity = ackName.trim().length > 0 || ackEmail.trim().length > 0;
    const hasClarificationNote = ackStatus === "acknowledged" || ackNote.trim().length > 0;
    return submitting || !hasIdentity || !hasClarificationNote;
  }, [ackEmail, ackName, ackNote, ackStatus, submitting]);

  const submitAcknowledgement = useCallback(() => {
    if (token === undefined || token.length === 0 || state.kind !== "ready" || submitDisabled) return;
    setSubmitting(true);
    setSubmitError(null);

    const input: CreateSupplierAcknowledgementInput = {
      status: ackStatus,
      acknowledgedByName: ackName.trim().length > 0 ? ackName.trim() : null,
      acknowledgedByEmail: ackEmail.trim().length > 0 ? ackEmail.trim() : null,
      note: ackNote.trim().length > 0 ? ackNote.trim() : null,
    };

    acknowledgeSupplierShare(token, input)
      .then(() => getSupplierShare(token))
      .then((pack) => {
        setState({ kind: "ready", pack });
        setAckNote("");
      })
      .catch(() => {
        setSubmitError("We could not send this supplier response. Please check the details and try again.");
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [ackEmail, ackName, ackNote, ackStatus, state, submitDisabled, token]);

  if (state.kind === "loading") {
    return (
      <main className="supplier-portal" aria-label="Supplier handoff">
        <section className="supplier-portal__state" role="status" aria-live="polite">
          <h1>Loading supplier handoff</h1>
          <p>Preparing the supplier-scoped pack and acknowledgement state.</p>
        </section>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="supplier-portal" aria-label="Supplier handoff">
        <section className="supplier-portal__state">
          <h1>This supplier link is not available</h1>
          <p>The link may have expired or been withdrawn. Please contact the venue team for the current handoff pack.</p>
        </section>
      </main>
    );
  }

  const { pack } = state;
  const issuedAt = formatDateTime(pack.issuedAt);
  const expiresAt = formatDateTime(pack.expiresAt);
  const latestAcknowledgement = newestAcknowledgementLabel(pack.acknowledgements);
  const canAcknowledge = statusAllowsAcknowledgement(pack.status);

  return (
    <main className="supplier-portal" aria-label="Supplier handoff">
      <div className="supplier-portal__shell">
        <section className="supplier-portal__hero">
          <div className="supplier-portal__headline">
            <p className="supplier-portal__label">{pack.venueName ?? "Venue supplier handoff"}</p>
            <h1 className="supplier-portal__title">{pack.title}</h1>
            <p className="supplier-portal__subline">{pack.supplierNotice}</p>
            <div className="supplier-portal__source-grid" aria-label="Source references">
              <div className="supplier-portal__source-cell">
                <span>Source</span>
                <strong>{pack.source.sourceLabel}</strong>
              </div>
              <div className="supplier-portal__source-cell">
                <span>Compiled</span>
                <strong>{sourceVersionLabel(pack)}</strong>
              </div>
              <div className="supplier-portal__source-cell">
                <span>Snapshot</span>
                <strong>{pack.source.snapshotHashPrefix}</strong>
              </div>
            </div>
          </div>

          <aside className="supplier-portal__panel supplier-portal__contact" aria-label="Supplier contact and status">
            <p className="supplier-portal__label">Supplier pack</p>
            <div className="supplier-portal__contact-list">
              <div className="supplier-portal__contact-row">
                <span>Status</span>
                <strong><span className="supplier-portal__status">{STATUS_LABELS[pack.status]}</span></strong>
              </div>
              <div className="supplier-portal__contact-row">
                <span>Supplier</span>
                <strong>{pack.supplierName ?? "Supplier contact"}</strong>
              </div>
              <div className="supplier-portal__contact-row">
                <span>Venue contact</span>
                <strong>{pack.contactName ?? "Venue team"}</strong>
              </div>
              <div className="supplier-portal__contact-row">
                <span>Email</span>
                <strong>{pack.contactEmail ?? "Use the venue contact channel"}</strong>
              </div>
              <div className="supplier-portal__contact-row">
                <span>Issued</span>
                <strong>{issuedAt ?? "Not recorded"}</strong>
              </div>
              <div className="supplier-portal__contact-row">
                <span>Expires</span>
                <strong>{expiresAt ?? "No expiry set"}</strong>
              </div>
            </div>
          </aside>
        </section>

        <section className="supplier-portal__main">
          <div className="supplier-portal__stack">
            <section className="supplier-portal__panel" aria-label="Changes since previous handoff">
              <p className="supplier-portal__label">Changes since previous handoff</p>
              <h2 className="supplier-portal__section-title">Current planning delta</h2>
              <p className="supplier-portal__copy">{pack.changesSincePreviousHandoff.summary}</p>
              <div className="supplier-portal__change-strip">
                <div className="supplier-portal__change-stat">
                  <strong>{pack.changesSincePreviousHandoff.addedCount}</strong>
                  <span>Added line items</span>
                </div>
                <div className="supplier-portal__change-stat">
                  <strong>{pack.changesSincePreviousHandoff.changedCount}</strong>
                  <span>Changed line items</span>
                </div>
                <div className="supplier-portal__change-stat">
                  <strong>{pack.changesSincePreviousHandoff.removedCount}</strong>
                  <span>Removed line items</span>
                </div>
              </div>
            </section>

            <section className="supplier-portal__panel" aria-label="Supplier requirements">
              <p className="supplier-portal__label">Supplier scope</p>
              <h2 className="supplier-portal__section-title">Requirements and arrival windows</h2>
              <div className="supplier-portal__item-list">
                {pack.items.map((item) => (
                  <article className="supplier-portal__item" key={`${String(item.sortOrder)}-${item.title}`}>
                    <div className="supplier-portal__item-header">
                      <h3>{item.title}</h3>
                      <span className="supplier-portal__item-kind">{ITEM_KIND_LABELS[item.kind]}</span>
                    </div>
                    <p className="supplier-portal__copy">{item.detail}</p>
                    <div className="supplier-portal__meta">
                      <span>{item.arrivalWindow ?? "Arrival window to confirm with venue"}</span>
                      <span>{item.sourceRef ?? "Source reference retained by venue"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="supplier-portal__panel supplier-portal__notice" aria-label="Planning note">
              <p className="supplier-portal__copy">
                This supplier view is a planning handoff for coordination. Timing, access, delivery sequence, and setup details remain subject to venue-team confirmation.
              </p>
            </section>
          </div>

          <aside className="supplier-portal__stack">
            <section className="supplier-portal__panel" aria-label="Acknowledgement state">
              <p className="supplier-portal__label">Acknowledgement</p>
              <h2 className="supplier-portal__section-title">
                {latestAcknowledgement === null ? "Awaiting supplier response" : "Latest response"}
              </h2>
              {latestAcknowledgement === null ? (
                <p className="supplier-portal__copy">No supplier acknowledgement has been recorded for this pack yet.</p>
              ) : (
                <p className="supplier-portal__copy">{latestAcknowledgement}</p>
              )}

              {pack.acknowledgements.length > 0 ? (
                <div className="supplier-portal__ack-list">
                  {pack.acknowledgements.map((ack) => (
                    <div className="supplier-portal__ack" key={`${ack.createdAt}-${ack.acknowledgedByName ?? "supplier"}`}>
                      <strong>{ACK_STATUS_LABELS[ack.status]}</strong>
                      <span>{ack.acknowledgedByName ?? "Supplier contact"} - {formatDateTime(ack.createdAt) ?? "time not recorded"}</span>
                      {ack.note !== null ? <p className="supplier-portal__copy">{ack.note}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {canAcknowledge ? (
              <section className="supplier-portal__panel" aria-label="Respond to supplier handoff">
                <p className="supplier-portal__label">Respond</p>
                <h2 className="supplier-portal__section-title">Confirm receipt</h2>
                <div className="supplier-portal__form">
                  <fieldset className="supplier-portal__choice-group">
                    <legend className="supplier-portal__legend">Response</legend>
                    <label className="supplier-portal__choice">
                      <input
                        type="radio"
                        name="supplier-ack-status"
                        value="acknowledged"
                        checked={ackStatus === "acknowledged"}
                        onChange={() => { setAckStatus("acknowledged"); }}
                      />
                      Acknowledge handoff
                    </label>
                    <label className="supplier-portal__choice">
                      <input
                        type="radio"
                        name="supplier-ack-status"
                        value="needs_clarification"
                        checked={ackStatus === "needs_clarification"}
                        onChange={() => { setAckStatus("needs_clarification"); }}
                      />
                      Need clarification
                    </label>
                  </fieldset>

                  <div className="supplier-portal__field">
                    <label htmlFor="supplier-ack-name">Name</label>
                    <input
                      id="supplier-ack-name"
                      value={ackName}
                      onChange={(event) => { setAckName(event.target.value); }}
                      maxLength={160}
                      autoComplete="name"
                    />
                  </div>

                  <div className="supplier-portal__field">
                    <label htmlFor="supplier-ack-email">Email</label>
                    <input
                      id="supplier-ack-email"
                      value={ackEmail}
                      onChange={(event) => { setAckEmail(event.target.value); }}
                      maxLength={255}
                      autoComplete="email"
                      inputMode="email"
                    />
                  </div>

                  <div className="supplier-portal__field">
                    <label htmlFor="supplier-ack-note">
                      {ackStatus === "needs_clarification" ? "Clarification needed" : "Note for the venue team"}
                    </label>
                    <textarea
                      id="supplier-ack-note"
                      value={ackNote}
                      onChange={(event) => { setAckNote(event.target.value); }}
                      maxLength={4000}
                    />
                  </div>

                  <button
                    className="supplier-portal__button"
                    type="button"
                    onClick={submitAcknowledgement}
                    disabled={submitDisabled}
                  >
                    {ackStatus === "acknowledged" ? "Acknowledge handoff" : "Send clarification request"}
                  </button>

                  {submitError !== null ? <div className="supplier-portal__alert" role="alert">{submitError}</div> : null}
                </div>
              </section>
            ) : (
              <section className="supplier-portal__panel" aria-label="Response closed">
                <p className="supplier-portal__label">Response closed</p>
                <p className="supplier-portal__copy">This pack is not currently awaiting a supplier response.</p>
              </section>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
