import { useCallback, useEffect, useState } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import {
  approveLayout,
  getAvailableTransitions,
  getReviewHistory,
  listPendingReviews,
  rejectLayout,
  requestChanges,
  startReview,
  withdrawReview,
  type PendingReviewEntry,
  type ReviewHistoryEntry,
} from "../../api/configuration-reviews.js";
import { useToastStore } from "../../stores/toast-store.js";
import { useReviewViewers } from "../../hooks/use-review-viewers.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";

// ---------------------------------------------------------------------------
// ReviewsView — staff approval dashboard for pending configuration reviews.
//
// Scope this iteration:
//   - List view: all pending reviews scoped by the user's role (staff →
//     own venue, admin → everywhere). Cards sorted by submittedAt asc so
//     the oldest unactioned review surfaces at the top.
//   - Detail view: event metadata, history timeline, action buttons
//     (Start Review / Approve / Request Changes / Reject / Withdraw).
//     Rejection + changes-requested open a note modal (both actions
//     require a note by API contract).
//   - Side-by-side 3D preview + inline extracted sheet is Phase 4 polish;
//     for now "Open Layout" and "Preview Sheet" buttons deep-link
//     to the existing pages.
//
// Visual language matches EnquiriesView: pill status badges, card rows,
// sticky back button, modal confirmations for destructive transitions.
// ---------------------------------------------------------------------------

const STATUS_VISUALS: Readonly<Record<ConfigurationReviewStatus, {
  readonly label: string;
  readonly background: string;
  readonly color: string;
}>> = {
  draft:             { label: "Draft",              background: "rgba(246, 241, 232, 0.09)", color: "rgba(246, 241, 232, 0.72)" },
  submitted:         { label: "Submitted",          background: "rgba(215, 181, 109, 0.14)", color: "#f1c978" },
  under_review:      { label: "Under Review",       background: "rgba(104, 216, 210, 0.13)", color: "#68d8d2" },
  approved:          { label: "Approved",           background: "rgba(143, 209, 158, 0.13)", color: "#9ff2cb" },
  rejected:          { label: "Rejected",           background: "rgba(255, 91, 71, 0.13)", color: "#ffb59a" },
  changes_requested: { label: "Changes Requested",  background: "rgba(242, 179, 94, 0.14)", color: "#f2b35e" },
  withdrawn:         { label: "Withdrawn",          background: "rgba(246, 241, 232, 0.07)", color: "rgba(246, 241, 232, 0.58)" },
  archived:          { label: "Archived",           background: "rgba(246, 241, 232, 0.07)", color: "rgba(246, 241, 232, 0.58)" },
};

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  borderRadius: 8, padding: 16, marginBottom: 8,
  border: "1px solid rgba(215, 181, 109, 0.22)", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
  textAlign: "left", width: "100%", fontFamily: "inherit",
};

const buttonPrimary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "linear-gradient(135deg, #d7b56d, #f0cf84)", backgroundColor: "#d7b56d", color: "#0b0d0d", border: "1px solid rgba(255,224,154,0.52)", borderRadius: 8, cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "rgba(255,247,232,0.07)", color: "#fff7e8", border: "1px solid rgba(215,181,109,0.25)", borderRadius: 8, cursor: "pointer",
};

const buttonDanger: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "rgba(255,91,71,0.16)", color: "#ffd2bd", border: "1px solid rgba(255,125,91,0.44)", borderRadius: 8, cursor: "pointer",
};

const buttonWarning: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "rgba(242,179,94,0.18)", color: "#f2b35e", border: "1px solid rgba(242,179,94,0.42)", borderRadius: 8, cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  borderRadius: 12,
  padding: 24,
  border: "1px solid rgba(215, 181, 109, 0.24)",
  color: "#f6f1e8",
  boxShadow: "0 22px 70px rgba(0,0,0,0.28)",
};

const alertStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255, 181, 82, 0.38)",
  background: "rgba(255, 181, 82, 0.09)",
  color: "#ffd89a",
  fontSize: 13,
  lineHeight: 1.45,
};

type ReviewContextState =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function ReviewStatusBadge({ status }: { status: ConfigurationReviewStatus }): React.ReactElement {
  const visual = STATUS_VISUALS[status];
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      background: visual.background,
      color: visual.color,
      borderRadius: 999,
    }}>
      {visual.label}
    </span>
  );
}

/**
 * Presence badge — "Catherine is viewing" pill shown in the review
 * detail header when another staff member is actively viewing the
 * same review. Pluralises cleanly for 2+ viewers.
 *
 * Rendered as role="status" with an aria-label so screen readers
 * announce the presence change without disrupting the review flow.
 */
function PresenceBadge({
  viewers,
}: {
  readonly viewers: readonly { readonly displayName: string }[];
}): React.ReactElement {
  const names = viewers.map((v) => v.displayName);
  const label = names.length === 1
    ? `${names[0] ?? ""} is viewing`
    : names.length === 2
      ? `${names[0] ?? ""} and ${names[1] ?? ""} are viewing`
      : `${names[0] ?? ""} and ${String(names.length - 1)} others are viewing`;
  const title = names.join(", ");
  return (
    <span
      role="status"
      aria-label={label}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 500,
        color: "#1f4e9b",
        background: "rgba(104,216,210,0.13)",
        borderRadius: 999,
        border: "1px solid rgba(104,216,210,0.32)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#68d8d2",
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Note modal — for reject + request-changes. Enforces non-empty note
// client-side; the API also validates.
// ---------------------------------------------------------------------------

interface NoteModalProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly confirmStyle: React.CSSProperties;
  readonly onConfirm: (note: string) => void;
  readonly onCancel: () => void;
  readonly inFlight: boolean;
  readonly errorMessage: string | null;
}

function NoteModal(props: NoteModalProps): React.ReactElement {
  const [note, setNote] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>();
  const trimmed = note.trim();
  const canConfirm = trimmed.length > 0 && !props.inFlight;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-note-modal-title"
      aria-describedby="review-note-modal-description"
      onClick={() => { if (!props.inFlight) props.onCancel(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !props.inFlight) props.onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 40%, rgba(104,216,210,0.08), transparent 34%), radial-gradient(circle at 78% 18%, rgba(215,181,109,0.1), transparent 28%), rgba(0,0,0,0.82)",
        contain: "paint",
      }}
    >
      <div ref={trapRef} onClick={(event) => { event.stopPropagation(); }} style={{
        background: "linear-gradient(150deg, rgba(22,19,15,0.98), rgba(10,10,9,0.95))",
        border: "1px solid rgba(215,181,109,0.28)",
        borderRadius: 8, padding: 24, maxWidth: 520, width: "90%",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }}>
        <h3 id="review-note-modal-title" style={{ margin: "0 0 8px", fontSize: 18, color: "#fff7e8" }}>{props.title}</h3>
        <p id="review-note-modal-description" style={{ margin: "0 0 16px", fontSize: 14, color: "rgba(246,241,232,0.72)", lineHeight: 1.5 }}>
          {props.description}
        </p>
        {props.errorMessage !== null && (
          <div role="alert" style={{ ...alertStyle, marginBottom: 12 }}>
            {props.errorMessage}
          </div>
        )}
        <textarea
          aria-label="Review note"
          value={note}
          onChange={(e) => { setNote(e.target.value); }}
          placeholder="Explain what needs to change…"
          rows={5}
          maxLength={2000}
          style={{
            width: "100%", padding: 10, fontSize: 14, fontFamily: "inherit",
            border: "1px solid rgba(215,181,109,0.28)", borderRadius: 8, resize: "vertical",
            color: "#fff7e8",
            background: "rgba(255,247,232,0.08)",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" style={buttonSecondary} onClick={props.onCancel} disabled={props.inFlight}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...props.confirmStyle, opacity: canConfirm ? 1 : 0.5, cursor: canConfirm ? "pointer" : "not-allowed" }}
            onClick={() => { props.onConfirm(trimmed); }}
            disabled={!canConfirm}
          >
            {props.inFlight ? "Submitting…" : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view — per-review actions + history
// ---------------------------------------------------------------------------

interface DetailViewProps {
  readonly entry: PendingReviewEntry;
  readonly onBack: () => void;
  readonly onStatusChange: (id: string, next: ConfigurationReviewStatus) => void;
}

function DetailView({ entry, onBack, onStatusChange }: DetailViewProps): React.ReactElement {
  const addToast = useToastStore((s) => s.addToast);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<readonly ConfigurationReviewStatus[]>([]);
  const [contextState, setContextState] = useState<ReviewContextState>({ status: "loading" });
  const [inFlight, setInFlight] = useState(false);
  const [modal, setModal] = useState<null | "reject" | "changes">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Presence — who else is viewing this same review. Heartbeats + polls
  // while mounted; fires an explicit leave on unmount so other viewers
  // drop the badge within a couple of seconds.
  const { viewers } = useReviewViewers(entry.id);

  const loadContext = useCallback((): void => {
    setContextState({ status: "loading" });
    setActionError(null);
    void (async () => {
      try {
        const [hist, trans] = await Promise.all([
          getReviewHistory(entry.id),
          getAvailableTransitions(entry.id),
        ]);
        setHistory([...hist]);
        setAvailableTransitions(trans.availableTransitions);
        setContextState({ status: "ready" });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Review context unavailable.";
        setHistory([]);
        setAvailableTransitions([]);
        setContextState({ status: "error", message });
        addToast("Failed to load review context", "error");
      }
    })();
  }, [entry.id, addToast]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  const can = (status: ConfigurationReviewStatus): boolean =>
    availableTransitions.includes(status);

  const handleStartReview = (): void => {
    setInFlight(true);
    setActionError(null);
    void (async () => {
      try {
        const next = await startReview(entry.id);
        addToast("Review started", "success");
        onStatusChange(entry.id, next);
      } catch {
        setActionError("Could not start this review. Check your role and retry before making a decision.");
        addToast("Failed to start review", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleApprove = (): void => {
    setInFlight(true);
    setActionError(null);
    void (async () => {
      try {
        const { reviewStatus } = await approveLayout(entry.id);
        addToast("Layout approved — planner + hallkeepers notified", "success");
        onStatusChange(entry.id, reviewStatus);
      } catch {
        setActionError("Approval did not save. The layout has not been approved.");
        addToast("Failed to approve", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleReject = (note: string): void => {
    setInFlight(true);
    setActionError(null);
    void (async () => {
      try {
        const next = await rejectLayout(entry.id, note);
        addToast("Rejection sent to planner", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch {
        setActionError("Rejection did not save. The planner has not been notified.");
        addToast("Failed to reject", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleRequestChanges = (note: string): void => {
    setInFlight(true);
    setActionError(null);
    void (async () => {
      try {
        const next = await requestChanges(entry.id, note);
        addToast("Change request sent to planner", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch {
        setActionError("Change request did not save. The planner has not been notified.");
        addToast("Failed to request changes", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleWithdraw = (): void => {
    setInFlight(true);
    setActionError(null);
    void (async () => {
      try {
        const next = await withdrawReview(entry.id);
        addToast("Review withdrawn", "success");
        onStatusChange(entry.id, next);
      } catch {
        setActionError("Withdraw did not save. This review is still active.");
        addToast("Failed to withdraw", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: "none", border: "none", color: "#68d8d2",
          cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0,
        }}
      >
        &larr; Back to pending reviews
      </button>

      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{entry.name}</h2>
          <ReviewStatusBadge status={entry.reviewStatus} />
          {viewers.length > 0 && <PresenceBadge viewers={viewers} />}
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12,
          fontSize: 13, color: "#666", marginBottom: 20,
        }}>
          <div style={{ color: "rgba(246,241,232,0.72)" }}>Guests: {String(entry.guestCount)}</div>
          {entry.submittedAt !== null && (
            <div style={{ color: "rgba(246,241,232,0.72)" }}>Submitted: {new Date(entry.submittedAt).toLocaleString()}</div>
          )}
          <div style={{ color: "rgba(246,241,232,0.72)" }}>Last updated: {new Date(entry.updatedAt).toLocaleString()}</div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          <a href={`/plan/${entry.id}`} target="_blank" rel="noreferrer"
            style={{ ...buttonSecondary, textDecoration: "none", display: "inline-block" }}>
            Open Layout
          </a>
          <a href={`/hallkeeper/${entry.id}`} target="_blank" rel="noreferrer"
            style={{ ...buttonSecondary, textDecoration: "none", display: "inline-block" }}>
            Preview Sheet
          </a>
        </div>

        <div style={{ borderTop: "1px solid rgba(215,181,109,0.16)", paddingTop: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#f1c978", margin: "0 0 8px" }}>Actions</h3>
          {contextState.status === "loading" && (
            <div role="status" aria-live="polite" style={{ ...alertStyle, color: "rgba(246,241,232,0.72)" }}>
              Loading review gates, transitions, and decision history...
            </div>
          )}
          {contextState.status === "error" && (
            <div role="alert" data-testid="review-context-error" style={alertStyle}>
              <div style={{ marginBottom: 10 }}>Could not load the review context: {contextState.message}</div>
              <button type="button" style={buttonSecondary} onClick={loadContext}>
                Retry review context
              </button>
            </div>
          )}
          {actionError !== null && (
            <div role="alert" data-testid="review-action-error" style={{ ...alertStyle, marginBottom: 10 }}>
              {actionError}
            </div>
          )}
          {contextState.status === "ready" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {can("under_review") && (
              <button type="button" style={buttonSecondary} onClick={handleStartReview} disabled={inFlight}>
                Start Review
              </button>
            )}
            {can("approved") && (
              <button type="button" style={buttonPrimary} onClick={handleApprove} disabled={inFlight}>
                Approve
              </button>
            )}
            {can("changes_requested") && (
              <button type="button" style={buttonWarning} onClick={() => { setModal("changes"); }} disabled={inFlight}>
                Request Changes
              </button>
            )}
            {can("rejected") && (
              <button type="button" style={buttonDanger} onClick={() => { setModal("reject"); }} disabled={inFlight}>
                Reject
              </button>
            )}
            {can("withdrawn") && (
              <button type="button" style={buttonSecondary} onClick={handleWithdraw} disabled={inFlight}>
                Withdraw
              </button>
            )}
            {availableTransitions.length === 0 && (
              <span style={{ fontSize: 12, color: "rgba(246,241,232,0.58)" }}>
                No actions available for your role in state &lsquo;{entry.reviewStatus}&rsquo;.
              </span>
            )}
          </div>
          )}
        </div>

        {contextState.status === "ready" && history.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(215,181,109,0.16)", paddingTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#f1c978", margin: "0 0 8px" }}>Timeline</h3>
            {history.map((h) => (
              <div key={h.id} style={{
                fontSize: 12, color: "rgba(246,241,232,0.66)", padding: "6px 0",
                borderLeft: "2px solid rgba(215,181,109,0.22)", paddingLeft: 12, marginLeft: 4,
              }}>
                <ReviewStatusBadge status={h.fromStatus} /> &rarr; <ReviewStatusBadge status={h.toStatus} />
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {new Date(h.createdAt).toLocaleString()}
                  {h.changedByName !== null && (
                    <>
                      <span aria-hidden="true" style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                      <span>{h.changedByName}</span>
                    </>
                  )}
                </div>
                {h.note !== null && h.note !== "" && (
                  <div style={{
                    fontSize: 12, color: "#fff7e8", marginTop: 4,
                    padding: "6px 10px", background: "rgba(255,247,232,0.07)", borderRadius: 4,
                  }}>
                    {h.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal === "reject" && (
        <NoteModal
          title="Reject this layout?"
          description="Tell the planner why you're rejecting. This note is emailed directly to them and stored in the review history."
          confirmLabel="Send rejection"
          confirmStyle={buttonDanger}
          onConfirm={handleReject}
          onCancel={() => { setModal(null); }}
          inFlight={inFlight}
          errorMessage={actionError}
        />
      )}
      {modal === "changes" && (
        <NoteModal
          title="Request changes on this layout?"
          description="Describe the revisions you need. The planner can re-open the layout, revise, and re-submit. Your note is preserved in the review history."
          confirmLabel="Send change request"
          confirmStyle={buttonWarning}
          onConfirm={handleRequestChanges}
          onCancel={() => { setModal(null); }}
          inFlight={inFlight}
          errorMessage={actionError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewsView — top-level list + detail router
// ---------------------------------------------------------------------------

export function ReviewsView(): React.ReactElement {
  const addToast = useToastStore((s) => s.addToast);
  const [entries, setEntries] = useState<PendingReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setLoading(true);
    setLoadError(null);
    void listPendingReviews()
      .then((list) => { setEntries([...list]); })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Pending reviews are unavailable.";
        setLoadError(message);
        addToast("Failed to load pending reviews", "error");
      })
      .finally(() => { setLoading(false); });
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStatusChange = (id: string, next: ConfigurationReviewStatus): void => {
    // If the entry transitioned out of the "pending" set, drop it from
    // the list. Otherwise keep it and update the status in place.
    const stillPending: ReadonlySet<ConfigurationReviewStatus> = new Set<ConfigurationReviewStatus>([
      "submitted", "under_review", "changes_requested",
    ]);
    setEntries((prev) => {
      if (!stillPending.has(next)) return prev.filter((e) => e.id !== id);
      return prev.map((e) => (e.id === id ? { ...e, reviewStatus: next } : e));
    });
    if (!stillPending.has(next)) {
      setSelectedId(null);
    }
  };

  const selected = entries.find((e) => e.id === selectedId);

  if (selected !== undefined) {
    return (
      <DetailView
        entry={selected}
        onBack={() => { setSelectedId(null); }}
        onStatusChange={handleStatusChange}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, color: "#fff7e8" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 24, color: "#fff7e8", fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: 0 }}>
          Pending Reviews {entries.length > 0 && (
            <span style={{ color: "rgba(246,241,232,0.56)", fontWeight: 400 }}>({String(entries.length)})</span>
          )}
        </h2>
        <button type="button" style={buttonSecondary} onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && entries.length === 0 && (
        <div role="status" aria-live="polite" style={{ ...panelStyle, padding: 40, textAlign: "center", color: "rgba(246,241,232,0.72)" }}>Loading reviews...</div>
      )}

      {loadError !== null && entries.length === 0 && (
        <div role="alert" data-testid="reviews-load-error" style={alertStyle}>
          <div style={{ marginBottom: 10 }}>Could not load pending reviews: {loadError}</div>
          <button type="button" style={buttonSecondary} onClick={refresh} disabled={loading}>
            Retry reviews
          </button>
        </div>
      )}

      {!loading && loadError === null && entries.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: "rgba(246,241,232,0.66)",
          background: "rgba(255,247,232,0.05)", borderRadius: 8, border: "1px dashed rgba(215,181,109,0.24)",
        }}>
          No pending reviews. Planners&rsquo; submissions will appear here.
        </div>
      )}

      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-label={`Open review for ${entry.name}`}
          style={cardStyle}
          onClick={() => { setSelectedId(entry.id); }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff7e8" }}>{entry.name}</div>
            <ReviewStatusBadge status={entry.reviewStatus} />
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "rgba(246,241,232,0.66)" }}>
            <span>Guests: {String(entry.guestCount)}</span>
            {entry.submittedAt !== null && (
              <span>Submitted: {new Date(entry.submittedAt).toLocaleString()}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
