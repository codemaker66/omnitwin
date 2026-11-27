import type { EventArchitectOpsReviewerAuthority } from "./event-architect.js";
import type { UserRole } from "./user.js";

// ---------------------------------------------------------------------------
// Who records an Event Architect Ops review, and under which authority
//
// A review is the human sign-off that lets a generated layout's guest-flow
// evidence through to the Ops Compiler, and each one is stored under the
// authority its reviewer held (event_architect_ops_reviews.reviewer_authority,
// whose CHECK names the same values: migrations 0048 and 0107). The API's gate
// (requireOpsReviewAuthority, routes/event-architect.ts) answers from this map
// and the web offers the form from it (OPS_REVIEW_ROLES,
// lib/role-capabilities.ts), so neither admits a role the other refuses.
// Managers record reviews too (Blake, 11 November 2026: "Yes, managers too").
//
// Type imports only: the web's role capabilities read this module without
// pulling in the Event Architect schemas.
// ---------------------------------------------------------------------------

/**
 * Each venue role that records a review at its own venue, and the authority
 * the review is stored under. A platform administrator records one as
 * `platform_admin` at any venue; every other role is refused.
 */
export const EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE = {
  staff: "venue_staff",
  hallkeeper: "venue_hallkeeper",
  manager: "venue_manager",
  admin: "venue_admin",
} as const satisfies Partial<Record<UserRole, EventArchitectOpsReviewerAuthority>>;

export type EventArchitectOpsReviewRole = keyof typeof EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE;

/** The venue roles that record a review: the keys of the map above. */
export const EVENT_ARCHITECT_OPS_REVIEW_ROLES = [
  "admin",
  "hallkeeper",
  "manager",
  "staff",
] as const satisfies readonly EventArchitectOpsReviewRole[];

/**
 * The authority a person in `role` records a review under at their own venue,
 * or null where the role records none. The venue match and the platform
 * administrator are the caller's to check.
 */
export function eventArchitectOpsReviewerAuthorityFor(role: string): EventArchitectOpsReviewerAuthority | null {
  const reviewer = EVENT_ARCHITECT_OPS_REVIEW_ROLES.find((candidate) => candidate === role);
  return reviewer === undefined ? null : EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE[reviewer];
}
