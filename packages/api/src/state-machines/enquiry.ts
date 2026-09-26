import { ENQUIRY_STATUSES, isBookingEnquiry, type EnquiryStatus, type UserRole } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Enquiry state machine — pure functions, no side effects
// ---------------------------------------------------------------------------

/** All valid enquiry states — imported from @omnitwin/types (single source of truth). */
export const ENQUIRY_STATES = ENQUIRY_STATUSES;

/** Re-export the canonical type from @omnitwin/types rather than re-deriving. */
export type EnquiryState = EnquiryStatus;

/** Roles relevant to enquiry transitions.
 *
 * "planner" is the default role assigned to users created via Clerk
 * (see auth.ts on-the-fly creation and webhooks.ts). It has the same
 * permissions as "client" for backward compatibility with any code that
 * still references "client".
 */
type TransitionRole = UserRole;

/** The venue side of the enquiry inbox: who may triage what arrives. Matches
 *  the roles routes/enquiries.ts admits to the venue inbox, so a role that can
 *  read an enquiry can also move it. */
const VENUE_TRIAGE_ROLES: readonly TransitionRole[] = ["staff", "hallkeeper", "manager", "sales", "admin"];

/** The customer's own submit/withdraw, plus the venue side acting for them. */
const CUSTOMER_ENQUIRY_ROLES: readonly TransitionRole[] = ["client", "planner", "staff", "manager", "sales", "admin"];

// ---------------------------------------------------------------------------
// Transition rules — keyed by [fromState][toState] → allowed roles
//
// "planner" and "client" are treated identically — both represent the
// customer-facing role. The auth layer creates users as "planner" by
// default, but legacy data may still have "client".
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, readonly TransitionRole[]> = {
  "draft→submitted": CUSTOMER_ENQUIRY_ROLES,
  "submitted→under_review": VENUE_TRIAGE_ROLES,
  "submitted→withdrawn": CUSTOMER_ENQUIRY_ROLES,
  "under_review→approved": VENUE_TRIAGE_ROLES,
  "under_review→rejected": VENUE_TRIAGE_ROLES,
  "under_review→withdrawn": CUSTOMER_ENQUIRY_ROLES,
  "approved→archived": VENUE_TRIAGE_ROLES,
  "rejected→archived": VENUE_TRIAGE_ROLES,
};

// ---------------------------------------------------------------------------
// Requests — an access request or an enquiry about Venviewer itself
//
// They reach the venue's inbox by the enquiry route but ask to book nothing,
// so they never take a decision: approving or declining emails the sender a
// booking outcome. Staff answer them from their own email and mark them done
// (stored as "archived"), and can reopen one marked done by mistake.
// ---------------------------------------------------------------------------

/** A booking asks for the venue's rooms and ends in a decision; a request is
 *  answered and marked done. */
export type EnquiryKind = "booking" | "request";

export function enquiryKind(eventType: string | null | undefined): EnquiryKind {
  return isBookingEnquiry(eventType) ? "booking" : "request";
}

const REQUEST_TRANSITIONS: Record<string, readonly TransitionRole[]> = {
  "draft→submitted": CUSTOMER_ENQUIRY_ROLES,
  "submitted→archived": VENUE_TRIAGE_ROLES,
  "under_review→archived": VENUE_TRIAGE_ROLES,
  "archived→submitted": VENUE_TRIAGE_ROLES,
  "submitted→withdrawn": CUSTOMER_ENQUIRY_ROLES,
  "under_review→withdrawn": CUSTOMER_ENQUIRY_ROLES,
};

/** The two states that email the sender a booking outcome. */
const BOOKING_DECISIONS: readonly string[] = ["approved", "rejected"];

/**
 * Returns true if the given role can perform a transition from
 * currentState to nextState on an enquiry of this kind.
 *
 * Admin can perform ANY transition (override), except a booking decision on
 * a request: no role may email a booking outcome for something that never
 * asked to book.
 */
export function canTransition(
  currentState: string,
  nextState: string,
  role: string,
  kind: EnquiryKind = "booking",
): boolean {
  if (kind === "request" && BOOKING_DECISIONS.includes(nextState)) return false;
  if (role === "admin") return true;

  const key = `${currentState}→${nextState}`;
  const allowed = (kind === "request" ? REQUEST_TRANSITIONS : TRANSITIONS)[key];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/**
 * Returns all states the given role can transition TO from the current state.
 */
export function getAvailableTransitions(
  currentState: string,
  role: string,
  kind: EnquiryKind = "booking",
): readonly EnquiryState[] {
  return ENQUIRY_STATES.filter((state) => state !== currentState && canTransition(currentState, state, role, kind));
}
