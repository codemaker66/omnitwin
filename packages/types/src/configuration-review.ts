import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// Configuration Review Status — mirrors the runtime state machine in
// packages/api/src/state-machines/config-review.ts.
//
// Review lifecycle is ORTHOGONAL to the existing `state` column
// (draft/published). A configuration can be:
//
//   state=draft,     review_status=approved      (approved but not yet
//                                                  visible to guests)
//   state=published, review_status=draft         (legacy row pre-dating
//                                                  reviews — migration
//                                                  default)
//   state=published, review_status=approved      (steady-state "live"
//                                                  event)
//
// Eight statuses:
//   draft              — planner is editing, no approval requested
//   submitted          — planner clicked "Submit for approval"; sheet
//                        has been extracted and snapshotted; staff
//                        notified by email
//   under_review       — a staff member has opened the review and is
//                        actively evaluating (claim-based)
//   approved           — signed off; hallkeeper sees the sheet;
//                        pre-rendered PDF in R2
//   rejected           — staff said no; planner gets rejection email
//                        with note; planner can clone to a new draft
//   changes_requested  — staff said "revise"; planner can re-submit
//                        without losing the original config history
//   withdrawn          — planner pulled their submission back (may be
//                        because they noticed an error themselves)
//   archived           — post-event terminal state
// ---------------------------------------------------------------------------

export const CONFIGURATION_REVIEW_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "changes_requested",
  "withdrawn",
  "archived",
] as const;

export const ConfigurationReviewStatusSchema = z.enum(
  CONFIGURATION_REVIEW_STATUSES,
);

export type ConfigurationReviewStatus = z.infer<
  typeof ConfigurationReviewStatusSchema
>;

// ---------------------------------------------------------------------------
// Valid transitions — mirrors the runtime state machine in
// packages/api/src/state-machines/config-review.ts. Keep these two in
// lockstep; the runtime layer adds role-based gating on top but must
// never accept a transition this table forbids.
// ---------------------------------------------------------------------------

export const VALID_CONFIGURATION_REVIEW_TRANSITIONS: Readonly<
  Record<ConfigurationReviewStatus, readonly ConfigurationReviewStatus[]>
> = {
  draft: ["submitted"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected", "changes_requested", "withdrawn"],
  changes_requested: ["draft", "withdrawn"],
  approved: ["archived"],
  rejected: ["draft", "archived"],
  withdrawn: [],
  archived: [],
};

/**
 * True if transitioning from `from` to `to` is a legal state change
 * regardless of role. Runtime callers must ALSO check role permission
 * via the state machine's `canTransition(from, to, role)`.
 */
export function isValidConfigurationReviewTransition(
  from: ConfigurationReviewStatus,
  to: ConfigurationReviewStatus,
): boolean {
  return VALID_CONFIGURATION_REVIEW_TRANSITIONS[from].includes(to);
}

/** True if the given status has no outgoing transitions. */
export function isTerminalReviewStatus(
  status: ConfigurationReviewStatus,
): boolean {
  return VALID_CONFIGURATION_REVIEW_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Editable-by-planner set — states in which the planner can still mutate
// the underlying configuration (placed-objects, metadata). Blocking
// edits in `submitted` / `under_review` / `approved` keeps the snapshot
// aligned with the hallkeeper's view until a re-submit handshake.
//
// Admins bypass this at the runtime layer (audit-logged).
// ---------------------------------------------------------------------------

const PLANNER_EDITABLE_STATUSES: ReadonlySet<ConfigurationReviewStatus> =
  new Set<ConfigurationReviewStatus>([
    "draft",
    "changes_requested",
    "rejected",
  ]);

/**
 * True if a planner may freely edit the configuration while it is in
 * this review state. Consumers of this function should pair the check
 * with a role check — staff and admin can edit in additional states.
 */
export function isPlannerEditable(
  status: ConfigurationReviewStatus,
): boolean {
  return PLANNER_EDITABLE_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Review history — per-row audit trail, shape-identical to
// enquiry_status_history so UI timeline components render both.
// ---------------------------------------------------------------------------

export const ReviewHistoryEntryIdSchema = z.string().uuid();
export type ReviewHistoryEntryId = z.infer<typeof ReviewHistoryEntryIdSchema>;

export const ReviewHistoryEntrySchema = z.object({
  id: ReviewHistoryEntryIdSchema,
  configurationId: ConfigurationIdSchema,
  fromStatus: ConfigurationReviewStatusSchema,
  toStatus: ConfigurationReviewStatusSchema,
  /**
   * Display name of the acting user (`displayName || name`), or null
   * for system-automatic transitions / when the user row has since
   * been deleted.
   *
   * We deliberately do NOT expose the raw user UUID here — earlier
   * versions of this type did, which let planners enumerate staff IDs
   * via the `/review/history` endpoint. The underlying DB column
   * `configuration_review_history.changed_by` still stores the UUID
   * for audit reconstruction; the API resolves it via a JOIN to
   * `users.displayName ?? users.name` before returning.
   */
  changedByName: z.string().nullable(),
  /** Free-text context — required for reject / changes_requested, optional elsewhere. */
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ReviewHistoryEntry = z.infer<typeof ReviewHistoryEntrySchema>;
