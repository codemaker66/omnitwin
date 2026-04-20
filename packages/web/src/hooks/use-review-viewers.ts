import { useEffect, useState } from "react";
import {
  endReviewViewerSession,
  heartbeatReviewViewers,
  listReviewViewers,
  type ActiveReviewer,
} from "../api/configuration-reviews.js";

// ---------------------------------------------------------------------------
// useReviewViewers — presence hook for the review detail
//
// Powers the "Catherine is viewing this review" badge in ReviewsView.
// When mounted, starts two interval loops:
//
//   - heartbeat (every HEARTBEAT_MS): tells the server "I am here".
//   - poll      (every POLL_MS):      asks "who else is here?".
//
// On unmount, fires an explicit /self DELETE so other viewers drop
// this caller from their badge immediately rather than waiting for
// the 30s active-window to expire.
//
// Errors during heartbeat / poll are deliberately swallowed — the
// presence UX gracefully degrades to "nobody is viewing" when the
// network is flaky. Nothing about the approval flow depends on it.
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 10_000;
const POLL_MS = 5_000;

export interface UseReviewViewersResult {
  readonly viewers: readonly ActiveReviewer[];
  readonly loading: boolean;
}

export function useReviewViewers(
  configId: string | null,
): UseReviewViewersResult {
  const [viewers, setViewers] = useState<readonly ActiveReviewer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (configId === null) {
      setViewers([]);
      setLoading(false);
      return;
    }

    // Typed explicitly so `!cancelled` narrowing inside the cleanup
    // works against a widened boolean (matches the SubmitForReviewPanel
    // pattern that the linter accepts).
    let cancelled: boolean = false;

    const tick = async (): Promise<void> => {
      try {
        await heartbeatReviewViewers(configId);
        const current = await listReviewViewers(configId);
        if (!cancelled) {
          setViewers(current);
          setLoading(false);
        }
      } catch {
        // Swallow — presence UX degrades gracefully on transient
        // network failures.
        if (!cancelled) setLoading(false);
      }
    };

    // Fire immediately on mount so the badge appears without waiting
    // a full poll interval.
    void tick();

    const heartbeatTimer = window.setInterval(() => {
      void heartbeatReviewViewers(configId).catch(() => {
        /* swallow — next tick will retry */
      });
    }, HEARTBEAT_MS);

    const pollTimer = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatTimer);
      window.clearInterval(pollTimer);
      // Fire the explicit leave. We don't await — the interval is
      // already torn down and the component is unmounting.
      void endReviewViewerSession(configId).catch(() => {
        /* swallow */
      });
    };
  }, [configId]);

  return { viewers, loading };
}
