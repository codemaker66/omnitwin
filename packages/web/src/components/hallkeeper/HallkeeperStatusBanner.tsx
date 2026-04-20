import { useEffect, useState } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import {
  getAvailableTransitions,
  getLatestSnapshot,
  type SnapshotEnvelope,
} from "../../api/configuration-reviews.js";

// ---------------------------------------------------------------------------
// HallkeeperStatusBanner
//
// Compact banner that tells the hallkeeper, at a glance:
//   - Is this sheet approved? (source-of-truth) or awaiting approval?
//   - Which snapshot version are they looking at?
//   - When was it approved + by whom (surfaced as a terse "v3 · approved
//     Sat 14:42" summary)
//
// This sits ABOVE the existing header so it's the first thing the
// hallkeeper sees on page load. A red ribbon for "awaiting" statuses
// signals "do not rely on this yet"; a green ribbon for approved means
// "trust this".
//
// The banner gracefully no-ops when:
//   - The configId hasn't been submitted at all (snapshot fetch 404s)
//   - The user lacks permission to read the snapshot (401/403)
//
// In both cases it falls back to the legacy "no banner" UX so the page
// never regresses for a config that pre-dates the review workflow.
// ---------------------------------------------------------------------------

interface StatusMeta {
  readonly label: string;
  readonly detail: string;
  readonly background: string;
  readonly borderColor: string;
  readonly color: string;
  readonly critical: boolean;
}

function describeStatus(
  status: ConfigurationReviewStatus,
  snapshot: SnapshotEnvelope | null,
): StatusMeta {
  const version = snapshot !== null ? ` · v${String(snapshot.version)}` : "";
  const approvedAt = snapshot?.approvedAt ?? null;

  switch (status) {
    case "approved": {
      const approvedStamp = approvedAt === null
        ? ""
        : ` · approved ${new Date(approvedAt).toLocaleString(undefined, {
            weekday: "short", day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit",
          })}`;
      return {
        label: "Approved — source of truth",
        detail: `Sheet${version}${approvedStamp}`,
        background: "#e8f7ec",
        borderColor: "#0b6b2c",
        color: "#0b6b2c",
        critical: false,
      };
    }
    case "submitted":
      return {
        label: "Awaiting approval",
        detail: `Preview only${version} — the venue hasn't signed off yet.`,
        background: "#fef9e6",
        borderColor: "#8a6a00",
        color: "#8a6a00",
        critical: true,
      };
    case "under_review":
      return {
        label: "Under review",
        detail: `Preview only${version} — the venue is actively evaluating this layout.`,
        background: "#e6f1fd",
        borderColor: "#1f4e9b",
        color: "#1f4e9b",
        critical: true,
      };
    case "changes_requested":
      return {
        label: "Changes requested",
        detail: "The venue asked the planner for revisions. A new version will replace this draft.",
        background: "#fff4e0",
        borderColor: "#8c5a00",
        color: "#8c5a00",
        critical: true,
      };
    case "rejected":
      return {
        label: "Rejected",
        detail: "The venue rejected this layout. Do not prepare the room from this sheet.",
        background: "#fdecec",
        borderColor: "#a02020",
        color: "#a02020",
        critical: true,
      };
    case "withdrawn":
      return {
        label: "Withdrawn",
        detail: "The planner withdrew this submission. Await a new version.",
        background: "#f5f5f5",
        borderColor: "#777",
        color: "#555",
        critical: true,
      };
    case "archived":
      return {
        label: "Archived",
        detail: `Closed out${version}. Historical record only.`,
        background: "#eeeeee",
        borderColor: "#666",
        color: "#555",
        critical: false,
      };
    case "draft":
      return {
        label: "Draft",
        detail: "This layout has never been submitted. Hallkeepers should not rely on it.",
        background: "#f7f5f0",
        borderColor: "#999",
        color: "#666",
        critical: true,
      };
  }
}

interface HallkeeperStatusBannerProps {
  readonly configId: string;
}

export function HallkeeperStatusBanner(
  { configId }: HallkeeperStatusBannerProps,
): React.ReactElement | null {
  const [status, setStatus] = useState<ConfigurationReviewStatus | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotEnvelope | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Typed as `boolean` not the literal `false` so the lint rule doesn't
    // flag !cancelled guards as dead branches (mutated in cleanup).
    let cancelled: boolean = false;
    void (async () => {
      try {
        const { currentStatus } = await getAvailableTransitions(configId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setStatus(currentStatus);
      } catch {
        // Not authenticated or config not found — skip the banner entirely.
      }
      try {
        const snap = await getLatestSnapshot(configId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setSnapshot(snap);
      } catch {
        // No snapshot yet — that's fine, banner still renders from status.
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [configId]);

  if (!loaded || status === null) return null;

  const meta = describeStatus(status, snapshot);

  return (
    <div
      role={meta.critical ? "alert" : "status"}
      aria-live={meta.critical ? "assertive" : "polite"}
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        borderLeft: `4px solid ${meta.borderColor}`,
        background: meta.background,
        color: meta.color,
        borderRadius: "0 6px 6px 0",
        fontFamily: "inherit",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.85 }}>
        {meta.label}
      </div>
      <div style={{ marginTop: 2 }}>{meta.detail}</div>
    </div>
  );
}
