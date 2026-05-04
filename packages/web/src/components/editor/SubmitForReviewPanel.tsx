import { useEffect, useState } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import { useEditorStore } from "../../stores/editor-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { captureOrthographic } from "../../lib/ortho-capture.js";
import { updatePublicThumbnail } from "../../api/configurations.js";
import { flushAutoSave } from "./EditorBridge.js";
import {
  getAvailableTransitions,
  submitForReview,
  withdrawReview,
} from "../../api/configuration-reviews.js";

// ---------------------------------------------------------------------------
// SubmitForReviewPanel — editor-side review-state affordance.
//
// Renders a status-aware pill + primary CTA in the top-right of the 3D
// editor. Unlike the legacy SaveSendPanel (a single "Send to Events Team"
// button that always opened the enquiry modal), this panel reacts to the
// configuration's current `review_status` and shows:
//
//   draft / changes_requested / rejected     → "Submit for Approval"
//   submitted / under_review                  → locked banner + "Withdraw"
//   approved                                  → "Approved" read-only pill
//                                               (edits below still go through —
//                                               snapshot is frozen, editor
//                                               shows divergence banner)
//   withdrawn / archived                      → minimal closed pill
//
// Pre-submit validation guards:
//   1. At least one placed object
//   2. FRONTEND_URL or fallback base URL resolved (server-side concern —
//      we don't pre-check; the server surfaces a 409 if snapshot build fails)
//
// The diagram-thumbnail capture (existing #24 behaviour) runs right before
// the submit so the snapshot carries the freshest top-down view.
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed", top: 16, right: 72, zIndex: 60,
  display: "flex", flexDirection: "row", alignItems: "center", gap: 10,
  fontFamily: "'Inter', sans-serif",
};

const pill: React.CSSProperties = {
  padding: "6px 12px", fontSize: 11, fontWeight: 600,
  letterSpacing: 0.4, textTransform: "uppercase",
  borderRadius: 999, border: "1px solid transparent",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 20px", fontSize: 13, fontWeight: 500, letterSpacing: 0.3,
  border: "1px solid rgba(201,168,76,0.3)", borderRadius: 6,
  cursor: "pointer", transition: "all 0.2s",
  background: "linear-gradient(135deg, #c9a84c 0%, #a8893e 100%)",
  color: "#1a1a1a", boxShadow: "0 2px 12px rgba(201,168,76,0.2)",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px", fontSize: 12, fontWeight: 500,
  border: "1px solid #d0c8b0", borderRadius: 6,
  cursor: "pointer", background: "#fff", color: "#333",
};

// ---------------------------------------------------------------------------
// Status pill + label descriptors
// ---------------------------------------------------------------------------

interface StatusVisual {
  readonly label: string;
  readonly background: string;
  readonly color: string;
  readonly borderColor: string;
}

const STATUS_VISUALS: Readonly<Record<ConfigurationReviewStatus, StatusVisual>> = {
  draft:              { label: "Draft",              background: "#f7f5f0", color: "#666",    borderColor: "#e5e5e0" },
  submitted:          { label: "Awaiting Review",    background: "#fef9e6", color: "#8a6a00", borderColor: "#eddcb0" },
  under_review:       { label: "Under Review",       background: "#e6f1fd", color: "#1f4e9b", borderColor: "#bcd3ef" },
  approved:           { label: "Approved",           background: "#e8f7ec", color: "#0b6b2c", borderColor: "#a9dfb7" },
  rejected:           { label: "Rejected",           background: "#fdecec", color: "#a02020", borderColor: "#f0b7b7" },
  changes_requested:  { label: "Changes Requested",  background: "#fff4e0", color: "#8c5a00", borderColor: "#eec98f" },
  withdrawn:          { label: "Withdrawn",          background: "#f5f5f5", color: "#777",    borderColor: "#e0e0e0" },
  archived:           { label: "Archived",           background: "#eeeeee", color: "#666",    borderColor: "#d5d5d5" },
};

function pillStyle(visual: StatusVisual): React.CSSProperties {
  return {
    ...pill,
    background: visual.background,
    color: visual.color,
    borderColor: visual.borderColor,
  };
}

// ---------------------------------------------------------------------------
// Planner-editable classification — mirrors isPlannerEditable in types
// package. Duplicated as a literal for synchronous UI rendering; the
// import-based helper would work too but this keeps the component
// SSR-friendly and avoids an extra re-render round trip.
// ---------------------------------------------------------------------------

const PLANNER_EDITABLE: ReadonlySet<ConfigurationReviewStatus> =
  new Set<ConfigurationReviewStatus>([
    "draft",
    "changes_requested",
    "rejected",
  ]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubmitForReviewPanel(): React.ReactElement | null {
  const objects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);
  // Public-preview configs belong to the guest-enquiry flow (SaveSendPanel).
  // The review workflow is authenticated-only: skip rendering + skip the
  // auth-gated available-transitions call so we don't generate 401 noise
  // for anonymous visitors.
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);

  const [reviewStatus, setReviewStatus] = useState<ConfigurationReviewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch review status on mount + when configId changes. We read the
  // available-transitions endpoint because it returns both the current
  // status AND the transitions the role can perform — lets us render
  // the right CTA without a second request.
  useEffect(() => {
    if (configId === null || isPublicPreview) {
      setReviewStatus(null);
      return;
    }
    // Typed explicitly as `boolean` (not the literal `false`) so the
    // post-mount mutation in the cleanup closure is visible to the
    // `!cancelled` narrowing below — otherwise @typescript-eslint's
    // no-unnecessary-condition flags every guard as dead.
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { currentStatus } = await getAvailableTransitions(configId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setReviewStatus(currentStatus);
      } catch {
        // Silent — the panel degrades to "not available" state instead
        // of blocking the editor on a transient network hiccup. User can
        // still save (auto-save is independent); refresh re-tries.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setReviewStatus(null);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [configId, isPublicPreview]);

  if (
    configId === null
    || isPublicPreview
    || objects.length === 0
    || loading
    || reviewStatus === null
  ) {
    return null;
  }

  const visual = STATUS_VISUALS[reviewStatus];
  const isEditable = PLANNER_EDITABLE.has(reviewStatus);
  const isLocked = reviewStatus === "submitted" || reviewStatus === "under_review";

  // -------------------------------------------------------------------------
  // Submit handler — flush auto-save, capture diagram, call submit API
  // -------------------------------------------------------------------------

  const handleSubmit = (): void => {
    setInFlight(true);
    setError(null);
    void (async () => {
      try {
        const saved = await flushAutoSave();
        if (!saved) {
          throw new Error("Save failed. Retry before submitting the layout.");
        }

        // Best-effort floor-plan capture. Same pattern as SaveSendPanel —
        // if the capture fails the submit still proceeds (sheet renders
        // a placeholder for missing diagramUrl).
        try {
          const { scene, space, isPublicPreview } = useEditorStore.getState();
          if (scene !== null && space !== null && isPublicPreview) {
            const { width: w, length: l } = useRoomDimensionsStore.getState().dimensions;
            const dataUrl = captureOrthographic(scene, w, l, { width: 800, height: 533 });
            if (dataUrl !== null) {
              await updatePublicThumbnail(configId, dataUrl);
            }
          }
        } catch {
          // Non-blocking.
        }

        const result = await submitForReview(configId);
        setReviewStatus(result.reviewStatus);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit for review");
      } finally {
        setInFlight(false);
      }
    })();
  };

  const handleWithdraw = (): void => {
    setInFlight(true);
    setError(null);
    void (async () => {
      try {
        const next = await withdrawReview(configId);
        setReviewStatus(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to withdraw");
      } finally {
        setInFlight(false);
      }
    })();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={panelStyle} data-testid="submit-for-review-panel" data-status={reviewStatus}>
      <span style={pillStyle(visual)}>{visual.label}</span>

      {isEditable && (
        <button
          type="button"
          style={{ ...primaryBtn, opacity: inFlight ? 0.6 : 1 }}
          onClick={handleSubmit}
          disabled={inFlight}
          data-testid="submit-for-review-button"
        >
          {inFlight ? "Submitting…" : "Submit for Approval"}
        </button>
      )}

      {isLocked && (
        <button
          type="button"
          style={{ ...secondaryBtn, opacity: inFlight ? 0.6 : 1 }}
          onClick={handleWithdraw}
          disabled={inFlight}
          data-testid="withdraw-review-button"
          title="Withdraw your submission to edit the layout"
        >
          {inFlight ? "Withdrawing…" : "Withdraw"}
        </button>
      )}

      {error !== null && (
        <div
          role="alert"
          style={{
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: 6,
            background: "#fdecec",
            color: "#a02020",
            border: "1px solid #f0b7b7",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
