import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
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
  type ReviewNotificationPolicy,
} from "../../api/configuration-reviews.js";
import { useToastStore } from "../../stores/toast-store.js";
import { useReviewViewers } from "../../hooks/use-review-viewers.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";

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
  submitted:         { label: "Submitted",          background: "rgba(201, 138, 91, 0.14)", color: "#dca475" },
  under_review:      { label: "Under Review",       background: "rgba(104, 216, 210, 0.13)", color: "#68d8d2" },
  approved:          { label: "Approved",           background: "rgba(143, 209, 158, 0.13)", color: "#9ff2cb" },
  rejected:          { label: "Rejected",           background: "rgba(255, 91, 71, 0.13)", color: "#ffb59a" },
  changes_requested: { label: "Changes Requested",  background: "rgba(242, 179, 94, 0.14)", color: "#f2b35e" },
  withdrawn:         { label: "Withdrawn",          background: "rgba(246, 241, 232, 0.07)", color: "rgba(246, 241, 232, 0.58)" },
  archived:          { label: "Archived",           background: "rgba(246, 241, 232, 0.07)", color: "rgba(246, 241, 232, 0.58)" },
};

// Where a review stands, as words for a sentence.
const STATUS_IN_WORDS: Readonly<Record<ConfigurationReviewStatus, string>> = {
  draft: "back with the planner as a draft",
  submitted: "waiting for a reviewer",
  under_review: "under review",
  approved: "approved",
  rejected: "rejected",
  changes_requested: "back with the planner for changes",
  withdrawn: "withdrawn",
  archived: "archived",
};

// The API's 409 codes for a review that moved on before a decision reached
// it: someone else decided, or the planner withdrew it.
const REVIEW_MOVED_CODES: ReadonlySet<string> = new Set([
  "INVALID_TRANSITION", "SNAPSHOT_CONFLICT", "SNAPSHOT_ALREADY_APPROVED",
]);

function reviewMovedOn(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && REVIEW_MOVED_CODES.has(error.code);
}

// Who a decision emails (routes/configuration-reviews.ts): approval emails
// the layout's planner and every hallkeeper account at the venue; a
// rejection or change request emails the planner. A layout with no planner
// account has nobody to email on that side.
function approvalConsequence(hasPlanner: boolean, emails: boolean): string {
  if (!emails) return "Approving records the decision. Nobody is emailed.";
  return hasPlanner
    ? "Approving emails the planner and your venue's hallkeepers."
    : "Approving emails your venue's hallkeepers. This layout has no planner account to email.";
}

function approvalToast(policy: ReviewNotificationPolicy | undefined, hasPlanner: boolean): string {
  if (policy === "suppressed_demo") return "Layout approved. Nobody was emailed.";
  return hasPlanner
    ? "Layout approved. The planner and your hallkeepers are being emailed."
    : "Layout approved. Your hallkeepers are being emailed.";
}

function noteConsequence(hasPlanner: boolean): string {
  return hasPlanner
    ? "Your note is emailed to the planner and kept in this review's timeline."
    : "This layout has no planner account, so nobody is emailed. Your note is kept in this review's timeline.";
}

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  borderRadius: 8, padding: 16, marginBottom: 8,
  border: "1px solid rgba(201, 138, 91, 0.22)", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
  textAlign: "left", width: "100%", fontFamily: "inherit",
};

const buttonPrimary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "linear-gradient(135deg, #c98a5b, #dca475)", backgroundColor: "#c98a5b", color: "#0b0d0d", border: "1px solid rgba(255,224,154,0.52)", borderRadius: 8, cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 13, fontWeight: 600,
  background: "rgba(255,247,232,0.07)", color: "#fff7e8", border: "1px solid rgba(201, 138, 91,0.25)", borderRadius: 8, cursor: "pointer",
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
  border: "1px solid rgba(201, 138, 91, 0.24)",
  color: "var(--house-text-1, #f6f1e8)",
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
      // A stray click beside the dialog closes it only while nothing is
      // written; Cancel and Escape still close it on purpose.
      onClick={() => { if (!props.inFlight && trimmed.length === 0) props.onCancel(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !props.inFlight) props.onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 40%, rgba(104,216,210,0.08), transparent 34%), radial-gradient(circle at 78% 18%, rgba(201, 138, 91,0.1), transparent 28%), rgba(0,0,0,0.82)",
        contain: "paint",
      }}
    >
      <div ref={trapRef} onClick={(event) => { event.stopPropagation(); }} style={{
        background: "linear-gradient(150deg, rgba(22,19,15,0.98), rgba(10,10,9,0.95))",
        border: "1px solid rgba(201, 138, 91,0.28)",
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
            border: "1px solid rgba(201, 138, 91,0.28)", borderRadius: 8, resize: "vertical",
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
            {props.inFlight && <ActivityIndicator size={16} />} {props.inFlight ? "Submitting…" : props.confirmLabel}
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
  /** `notice`, when given, is said on the list if the review leaves it. */
  readonly onStatusChange: (id: string, next: ConfigurationReviewStatus, notice?: string) => void;
}

function DetailView({ entry, onBack, onStatusChange }: DetailViewProps): React.ReactElement {
  const addToast = useToastStore((s) => s.addToast);
  const contextRequest = useRef(0);
  const actionOperation = useRef(0);
  const [demoEligible, setDemoEligible] = useState(false);
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<readonly ConfigurationReviewStatus[]>([]);
  const [contextState, setContextState] = useState<ReviewContextState>({ status: "loading" });
  const [inFlight, setInFlight] = useState(false);
  const [modal, setModal] = useState<null | "reject" | "changes">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Withdrawing ends the review for good, so it is asked, not done.
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  // Said when a decision met a review that had moved on. It outlives the
  // context reload that follows, and the next decision clears it.
  const [movedNotice, setMovedNotice] = useState<string | null>(null);
  const withdrawQuestionId = useId();
  const rehearsalHintId = useId();
  const hasPlanner = entry.userId !== null;
  // Presence — who else is viewing this same review. Heartbeats + polls
  // while mounted; fires an explicit leave on unmount so other viewers
  // drop the badge within a couple of seconds.
  const { viewers } = useReviewViewers(entry.id);

  useEffect(() => () => { actionOperation.current += 1; }, [entry.id]);

  const loadContext = useCallback((): void => {
    const request = ++contextRequest.current;
    setContextState({ status: "loading" });
    setDemoEligible(false);
    setNotifyTeam(true);
    setActionError(null);
    setConfirmingWithdraw(false);
    void (async () => {
      try {
        const [hist, trans] = await Promise.all([
          getReviewHistory(entry.id),
          getAvailableTransitions(entry.id),
        ]);
        if (contextRequest.current !== request) return;
        setHistory([...hist]);
        setAvailableTransitions(trans.availableTransitions);
        setDemoEligible(trans.internalDemoReviewEligible);
        setContextState({ status: "ready" });
      } catch (error: unknown) {
        if (contextRequest.current !== request) return;
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
    return () => { contextRequest.current += 1; };
  }, [loadContext, entry.reviewStatus]);

  const can = (status: ConfigurationReviewStatus): boolean =>
    availableTransitions.includes(status);

  const beginDecision = (): number => {
    const operation = ++actionOperation.current;
    setInFlight(true);
    setActionError(null);
    setMovedNotice(null);
    return operation;
  };

  // A decision met a review that had moved on. Read where it stands and say
  // so: "did not save" would invite a retry that cannot work.
  const reportMovedOn = async (operation: number): Promise<void> => {
    setModal(null);
    setConfirmingWithdraw(false);
    try {
      const now = await getAvailableTransitions(entry.id);
      if (actionOperation.current !== operation) return;
      if (now.currentStatus === entry.reviewStatus) {
        setMovedNotice("This review changed while it was open here, so your decision was not recorded. It has been read again; look it over before deciding.");
        loadContext();
        return;
      }
      const notice = `${entry.name} changed while it was open here. It is now ${STATUS_IN_WORDS[now.currentStatus]}, so your decision was not recorded.`;
      setMovedNotice(notice);
      onStatusChange(entry.id, now.currentStatus, notice);
    } catch {
      if (actionOperation.current !== operation) return;
      setActionError("This review changed while it was open here, so your decision was not recorded. Go back to the list and open it again.");
    }
  };

  const handleStartReview = (): void => {
    const operation = beginDecision();
    void (async () => {
      try {
        const next = await startReview(entry.id);
        if (actionOperation.current !== operation) return;
        addToast("Review started", "success");
        onStatusChange(entry.id, next);
      } catch (error: unknown) {
        if (actionOperation.current !== operation) return;
        if (reviewMovedOn(error)) { await reportMovedOn(operation); return; }
        setActionError("Could not start this review. Check your role and retry before making a decision.");
        addToast("Failed to start review", "error");
      } finally {
        if (actionOperation.current === operation) setInFlight(false);
      }
    })();
  };

  const handleApprove = (): void => {
    const operation = beginDecision();
    void (async () => {
      try {
        const { reviewStatus, notificationPolicy } = demoEligible
          ? await approveLayout(entry.id, undefined, notifyTeam) : await approveLayout(entry.id);
        if (actionOperation.current !== operation) return;
        addToast(approvalToast(notificationPolicy, hasPlanner), "success");
        onStatusChange(entry.id, reviewStatus);
      } catch (error: unknown) {
        if (actionOperation.current !== operation) return;
        if (reviewMovedOn(error)) { await reportMovedOn(operation); return; }
        setActionError("Approval did not save. The layout has not been approved.");
        addToast("Failed to approve", "error");
      } finally {
        if (actionOperation.current === operation) setInFlight(false);
      }
    })();
  };

  const handleReject = (note: string): void => {
    const operation = beginDecision();
    void (async () => {
      try {
        const next = await rejectLayout(entry.id, note);
        if (actionOperation.current !== operation) return;
        addToast(hasPlanner ? "Rejection sent to the planner" : "Rejection recorded. There is no planner account to email.", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch (error: unknown) {
        if (actionOperation.current !== operation) return;
        if (reviewMovedOn(error)) { await reportMovedOn(operation); return; }
        setActionError("Rejection did not save. The planner has not been notified.");
        addToast("Failed to reject", "error");
      } finally {
        if (actionOperation.current === operation) setInFlight(false);
      }
    })();
  };

  const handleRequestChanges = (note: string): void => {
    const operation = beginDecision();
    void (async () => {
      try {
        const next = await requestChanges(entry.id, note);
        if (actionOperation.current !== operation) return;
        addToast(hasPlanner ? "Change request sent to the planner" : "Change request recorded. There is no planner account to email.", "success");
        setModal(null);
        onStatusChange(entry.id, next);
      } catch (error: unknown) {
        if (actionOperation.current !== operation) return;
        if (reviewMovedOn(error)) { await reportMovedOn(operation); return; }
        setActionError("Change request did not save. The planner has not been notified.");
        addToast("Failed to request changes", "error");
      } finally {
        if (actionOperation.current === operation) setInFlight(false);
      }
    })();
  };

  const handleWithdraw = (): void => {
    const operation = beginDecision();
    void (async () => {
      try {
        const next = await withdrawReview(entry.id);
        if (actionOperation.current !== operation) return;
        setConfirmingWithdraw(false);
        addToast("Review withdrawn", "success");
        onStatusChange(entry.id, next);
      } catch (error: unknown) {
        if (actionOperation.current !== operation) return;
        if (reviewMovedOn(error)) { await reportMovedOn(operation); return; }
        setActionError("Withdraw did not save. This review is still active.");
        addToast("Failed to withdraw", "error");
      } finally {
        if (actionOperation.current === operation) setInFlight(false);
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

        <div style={{ borderTop: "1px solid rgba(201, 138, 91,0.16)", paddingTop: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#dca475", margin: "0 0 8px" }}>Actions</h3>
          {inFlight && modal === null && <ActivityStatus>Recording the review decision…</ActivityStatus>}
          {contextState.status === "loading" && (
            <div role="status" aria-live="polite" style={{ ...alertStyle, color: "rgba(246,241,232,0.72)" }}>
              <ActivityIndicator size={16} /> Loading review gates, transitions, and decision history…
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
          {movedNotice !== null && (
            <div role="alert" data-testid="review-moved-on" style={{ ...alertStyle, marginBottom: 10 }}>
              {movedNotice}
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
              <div style={{ flexBasis: "100%", display: "grid", gap: 6, fontSize: 13, lineHeight: 1.45, color: "rgba(246,241,232,0.78)" }}>
                {demoEligible && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={notifyTeam} disabled={inFlight} aria-describedby={rehearsalHintId}
                      style={{ width: 16, height: 16, margin: 0, accentColor: "#c98a5b" }}
                      onChange={event => { setNotifyTeam(event.target.checked); }} />
                    {hasPlanner ? "Email the planner and hallkeepers" : "Email your venue's hallkeepers"}
                  </label>
                )}
                {demoEligible && (
                  <p id={rehearsalHintId} style={{ margin: 0, color: "rgba(246,241,232,0.62)" }}>
                    This is a rehearsal plan, so it can be approved without emailing anyone.
                  </p>
                )}
                <p data-testid="approve-consequence" style={{ margin: 0 }}>
                  {approvalConsequence(hasPlanner, !demoEligible || notifyTeam)}
                </p>
              </div>
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
              <button type="button" style={buttonSecondary} disabled={inFlight}
                aria-expanded={confirmingWithdraw}
                onClick={() => { setConfirmingWithdraw((open) => !open); }}>
                Withdraw…
              </button>
            )}
            {can("withdrawn") && confirmingWithdraw && (
              <div role="group" aria-labelledby={withdrawQuestionId} data-testid="review-withdraw-confirm"
                style={{ flexBasis: "100%", display: "grid", gap: 10, padding: 12, borderRadius: 8, border: "1px solid rgba(255, 125, 91, 0.36)" }}>
                <p id={withdrawQuestionId} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: "#fff7e8" }}>
                  Withdraw this layout from review? The review ends here and cannot be reopened. Nobody is emailed.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button type="button" style={buttonDanger} onClick={handleWithdraw} disabled={inFlight}>
                    Withdraw
                  </button>
                  <button type="button" style={buttonSecondary} onClick={() => { setConfirmingWithdraw(false); }} disabled={inFlight}>
                    Keep it in review
                  </button>
                </div>
              </div>
            )}
            {availableTransitions.length === 0 && (
              <span style={{ fontSize: 12, color: "rgba(246,241,232,0.58)" }}>
                Your role has no decision to make while this review is {STATUS_IN_WORDS[entry.reviewStatus]}.
              </span>
            )}
          </div>
          )}
        </div>

        {contextState.status === "ready" && history.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(201, 138, 91,0.16)", paddingTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#dca475", margin: "0 0 8px" }}>Timeline</h3>
            {history.map((h) => (
              <div key={h.id} style={{
                fontSize: 12, color: "rgba(246,241,232,0.66)", padding: "6px 0",
                borderLeft: "2px solid rgba(201, 138, 91,0.22)", paddingLeft: 12, marginLeft: 4,
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
          description={noteConsequence(hasPlanner)}
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
          description={`Describe the revisions needed. ${noteConsequence(hasPlanner)}`}
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

export interface ReviewsViewProps {
  /** Configuration id from the reviewer email's deep link
   *  (/dashboard?view=reviews&config=:id). Selected once the list has loaded,
   *  and only if it is actually in the reviewer's pending set — a link to a
   *  review that has since been actioned lands on the list, not on an error. */
  readonly initialSelectedId?: string | null;
}

export function ReviewsView({ initialSelectedId = null }: ReviewsViewProps = {}): React.ReactElement {
  const addToast = useToastStore((s) => s.addToast);
  const [entries, setEntries] = useState<PendingReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Why a review left the list while it was open, when it was not this
  // reviewer's own decision.
  const [listNotice, setListNotice] = useState<string | null>(null);
  // Honoured once per deep link, so a reviewer who clicks Back to the list is
  // not dragged into the detail again by the next render.
  const appliedDeepLink = useRef<string | null>(null);

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

  useEffect(() => {
    if (initialSelectedId === null) return;
    if (appliedDeepLink.current === initialSelectedId) return;
    if (!entries.some((entry) => entry.id === initialSelectedId)) return;
    appliedDeepLink.current = initialSelectedId;
    setSelectedId(initialSelectedId);
  }, [entries, initialSelectedId]);

  const handleStatusChange = (id: string, next: ConfigurationReviewStatus, notice?: string): void => {
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
      setListNotice(notice ?? null);
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
        <h2 style={{ margin: 0, fontSize: 24, color: "#fff7e8", fontFamily: "var(--house-serif)", lineHeight: 1.2, letterSpacing: 0 }}>
          Pending reviews {entries.length > 0 && (
            <span style={{ color: "rgba(246,241,232,0.56)", fontWeight: 400 }}>({String(entries.length)})</span>
          )}
        </h2>
        <button type="button" style={buttonSecondary} onClick={refresh} disabled={loading}>
          {loading && <ActivityIndicator size={16} />} {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {listNotice !== null && (
        <div role="status" data-testid="reviews-list-notice" style={alertStyle}>{listNotice}</div>
      )}

      {loading && entries.length === 0 && (
        <ActivityStatus variant="panel" style={{ ...panelStyle, padding: 40, textAlign: "center", color: "rgba(246,241,232,0.72)" }}>Loading reviews…</ActivityStatus>
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
          background: "rgba(255,247,232,0.05)", borderRadius: 8, border: "1px dashed rgba(201, 138, 91,0.24)",
        }}>
          No pending reviews.
        </div>
      )}

      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-label={`Open review for ${entry.name}`}
          style={cardStyle}
          onClick={() => { setListNotice(null); setSelectedId(entry.id); }}
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
