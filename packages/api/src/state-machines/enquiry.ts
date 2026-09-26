import { ENQUIRY_STATUSES, type EnquiryStatus, type UserRole } from "@omnitwin/types";

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

/**
 * Returns true if the given role can perform a transition from
 * currentState to nextState.
 *
 * Admin can perform ANY transition (override).
 */
export function canTransition(
  currentState: string,
  nextState: string,
  role: string,
): boolean {
  if (role === "admin") return true;

  const key = `${currentState}→${nextState}`;
  const allowed = TRANSITIONS[key];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/**
 * Returns all states the given role can transition TO from the current state.
 */
export function getAvailableTransitions(
  currentState: string,
  role: string,
): readonly EnquiryState[] {
  if (role === "admin") {
    // Admin can go to any state from any state
    return ENQUIRY_STATES.filter((s) => s !== currentState);
  }

  const result: EnquiryState[] = [];
  for (const key of Object.keys(TRANSITIONS)) {
    const [from, to] = key.split("→");
    if (from !== currentState || to === undefined) continue;
    const allowed = TRANSITIONS[key];
    if (allowed !== undefined && allowed.includes(role as TransitionRole)) {
      result.push(to as EnquiryState);
    }
  }
  return result;
}
