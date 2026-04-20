import { useEffect, useState } from "react";
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
  draft:             { label: "Draft",              background: "#f7f5f0", color: "#666" },
  submitted:         { label: "Submitted",          background: "#fef9e6", color: "#8a6a00" },
  under_review:      { label: "Under Review",       background: "#e6f1fd", color: "#1f4e9b" },
  approved:          { label: "Approved",           background: "#e8f7ec", color: "#0b6b2c" },
  rejected:          { label: "Rejected",           background: "#fdecec", color: "#a02020" },
  changes_requested: { label: "Changes Requested",  background: "#fff4e0", color: "#8c5a00" },
  withdrawn:         { label: "Withdrawn",          background: "#f5f5f5", color: "#777" },
  archived:          { label: "Archived",           background: "#eeeeee", color: "#666" },
};

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 16, marginBottom: 8,
  border: "1px solid #e5e7eb", cursor: "pointer", transition: "box-shadow 0.15s",
};

const buttonPrimary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "#0b6b2c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "#fff", color: "#333", border: "1px solid #d0c8b0", borderRadius: 6, cursor: "pointer",
};

const buttonDanger: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "#a02020", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

const buttonWarning: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "#8c5a00", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

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
        background: "#e6f1fd",
        borderRadius: 999,
        border: "1px solid #bcd3ef",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#3b82f6",
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
}

function NoteModal(props: NoteModalProps): React.ReactElement {
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  const canConfirm = trimmed.length > 0 && !props.inFlight;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div style={{
        background: "#fff", borderRadius: 8, padding: 24, maxWidth: 520, width: "90%",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#1a1a2e" }}>{props.title}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          {props.description}
        </p>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); }}
          placeholder="Explain what needs to change…"
          rows={5}
          maxLength={2000}
          style={{
            width: "100%", padding: 10, fontSize: 14, fontFamily: "inherit",
            border: "1px solid #d0d0d0", borderRadius: 6, resize: "vertical",
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
  const [inFlight, setInFlight] = useState(false);
  const [modal, setModal] = useState<null | "reject" | "changes">(null);
  // Presence — who else is viewing this same review. Heartbeats + polls
  // while mounted; fires an explicit leave on unmount so other viewers
  // drop the badge within a couple of seconds.
  const { viewers } = useReviewViewers(entry.id);

  useEffect(() => {
    // Typed explicitly so the lint rule doesn't flag post-cleanup mutation
    // checks as dead branches.
    let cancelled: boolean = false;
    void (async () => {
      try {
        const [hist, trans] = await Promise.all([
          getReviewHistory(entry.id),
          getAvailableTransitions(entry.id),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) {
          setHistory([...hist]);
          setAvailableTransitions(trans.availableTransitions);
        }
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) addToast("Failed to load review context", "error");
      }
    })();
    return () => { cancelled = true; };
  }, [entry.id, addToast]);

  const can = (status: ConfigurationReviewStatus): boolean =>
    availableTransitions.includes(status);

  const handleStartReview = (): void => {
    setInFlight(true);
    void (async () => {
      try {
        const next = await startReview(entry.id);
        addToast("Review started", "success");
        onStatusChange(entry.id, next);
      } catch {
        addToast("Failed to start review", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleApprove = (): void => {
    setInFlight(true);
    void (async () => {
      try {
        const { reviewStatus } = await approveLayout(entry.id);
        addToast("Layout approved — planner + hallkeepers notified", "success");
        onStatusChange(entry.id, reviewStatus);
      } catch {
        addToast("Failed to approve", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleReject = (note: string): void => {
    setInFlight(true);
    void (async () => {
      try {
        const next = await rejectLayout(entry.id, note);
        addToast("Rejection sent to planner", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch {
        addToast("Failed to reject", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleRequestChanges = (note: string): void => {
    setInFlight(true);
    void (async () => {
      try {
        const next = await requestChanges(entry.id, note);
        addToast("Change request sent to planner", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch {
        addToast("Failed to request changes", "error");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleWithdraw = (): void => {
    setInFlight(true);
    void (async () => {
      try {
        const next = await withdrawReview(entry.id);
        addToast("Review withdrawn", "success");
        onStatusChange(entry.id, next);
      } catch {
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
          background: "none", border: "none", color: "#3b82f6",
          cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0,
        }}
      >
        &larr; Back to pending reviews
      </button>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{entry.name}</h2>
          <ReviewStatusBadge status={entry.reviewStatus} />
          {viewers.length > 0 && <PresenceBadge viewers={viewers} />}
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
          fontSize: 13, color: "#666", marginBottom: 20,
        }}>
          <div>Guests: {String(entry.guestCount)}</div>
          {entry.submittedAt !== null && (
            <div>Submitted: {new Date(entry.submittedAt).toLocaleString()}</div>
          )}
          <div>Last updated: {new Date(entry.updatedAt).toLocaleString()}</div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          <a href={`/editor/${entry.id}`} target="_blank" rel="noreferrer"
            style={{ ...buttonSecondary, textDecoration: "none", display: "inline-block" }}>
            Open Layout
          </a>
          <a href={`/hallkeeper/${entry.id}`} target="_blank" rel="noreferrer"
            style={{ ...buttonSecondary, textDecoration: "none", display: "inline-block" }}>
            Preview Sheet
          </a>
        </div>

        <div style={{ borderTop: "1px solid #eee", paddingTop: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#444", margin: "0 0 8px" }}>Actions</h3>
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
              <span style={{ fontSize: 12, color: "#999" }}>
                No actions available for your role in state &lsquo;{entry.reviewStatus}&rsquo;.
              </span>
            )}
          </div>
        </div>

        {history.length > 0 && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#444", margin: "0 0 8px" }}>Timeline</h3>
            {history.map((h) => (
              <div key={h.id} style={{
                fontSize: 12, color: "#666", padding: "6px 0",
                borderLeft: "2px solid #e5e7eb", paddingLeft: 12, marginLeft: 4,
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
                    fontSize: 12, color: "#333", marginTop: 4,
                    padding: "6px 10px", background: "#f9f9f6", borderRadius: 4,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = (): void => {
    setLoading(true);
    void listPendingReviews()
      .then((list) => { setEntries([...list]); })
      .catch(() => { addToast("Failed to load pending reviews", "error"); })
      .finally(() => { setLoading(false); });
  };

  useEffect(() => {
    refresh();
    // `refresh` is declared inline per render and reads only setters
    // (stable references), so running it once on mount is correct.
    // Intentionally empty dep array.
  }, []);

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
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#1a1a2e" }}>
          Pending Reviews {entries.length > 0 && (
            <span style={{ color: "#999", fontWeight: 400 }}>({String(entries.length)})</span>
          )}
        </h2>
        <button type="button" style={buttonSecondary} onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && entries.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Loading…</div>
      )}

      {!loading && entries.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: "#999",
          background: "#fff", borderRadius: 8, border: "1px dashed #e5e7eb",
        }}>
          No pending reviews. Planners&rsquo; submissions will appear here.
        </div>
      )}

      {entries.map((entry) => (
        <div
          key={entry.id}
          role="button"
          tabIndex={0}
          style={cardStyle}
          onClick={() => { setSelectedId(entry.id); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedId(entry.id); }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e" }}>{entry.name}</div>
            <ReviewStatusBadge status={entry.reviewStatus} />
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#666" }}>
            <span>Guests: {String(entry.guestCount)}</span>
            {entry.submittedAt !== null && (
              <span>Submitted: {new Date(entry.submittedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
