import type { ReactElement } from "react";
import { Check } from "lucide-react";
import type { ConfigurationReviewStatus, SheetApproval } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The sheet's review state (roadmap N4). A layout that is not approved says
// so in a band under the heading, in words, before any of its work; an
// approved one carries a single quiet stamp. They replace three separate
// mentions of the sheet's version on the screen. Whether a rejected sheet's
// rows may still be ticked is Blake's call (Q-E3); the rows are unchanged.
// ---------------------------------------------------------------------------

type BandTone = "brick" | "amber" | "slate";

const BANDS: Readonly<Record<Exclude<ConfigurationReviewStatus, "approved">, { readonly tone: BandTone; readonly label: string; readonly detail: string }>> = {
  rejected: { tone: "brick", label: "Rejected", detail: "Do not prepare the room from this sheet. The venue rejected this layout." },
  changes_requested: { tone: "amber", label: "Changes requested", detail: "The venue asked the planner for changes. A new version will replace this one." },
  submitted: { tone: "amber", label: "Awaiting approval", detail: "Preview only: the venue has not signed this layout off yet." },
  under_review: { tone: "amber", label: "Under review", detail: "Preview only: the venue is reviewing this layout." },
  withdrawn: { tone: "slate", label: "Withdrawn", detail: "The planner withdrew this layout. Wait for a new version." },
  draft: { tone: "slate", label: "Draft", detail: "This layout has not been sent for approval, so do not rely on it." },
  archived: { tone: "slate", label: "Archived", detail: "A closed record, kept for reference." },
};

/** Any state but approved, as a band; nothing while the state is unread. A
 *  rejection interrupts a screen reader; the others wait their turn. */
export function ApprovalBand({ status }: { readonly status: ConfigurationReviewStatus | null }): ReactElement | null {
  if (status === null || status === "approved") return null;
  const band = BANDS[status];
  return <div className={`hkf-approval-band is-${band.tone}`} role={status === "rejected" ? "alert" : "status"}>
    <strong>{band.label}</strong><span>{band.detail}</span>
  </div>;
}

/** An approved sheet's one mention of its version: when, on the venue's
 *  clock, and by whom. */
export function ApprovalStamp({ approval, timeZone }: { readonly approval: SheetApproval; readonly timeZone: string }): ReactElement {
  const when = new Date(approval.approvedAt).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone,
  });
  return <span className="hkf-approval-stamp"><Check size={14} aria-hidden="true" />{`Approved v${String(approval.version)} · ${when} · ${approval.approverName}`}</span>;
}
