import { ENQUIRY_STATUSES, type EnquiryStatus } from "@omnitwin/types";

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
type TransitionRole = "client" | "planner" | "staff" | "hallkeeper" | "admin";

// ---------------------------------------------------------------------------
// Transition rules — keyed by [fromState][toState] → allowed roles
//
// "planner" and "client" are treated identically — both represent the
// customer-facing role. The auth layer creates users as "planner" by
// default, but legacy data may still have "client".
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, readonly TransitionRole[]> = {
  "draft→submitted": ["client", "planner", "staff", "admin"],
  "submitted→under_review": ["staff", "hallkeeper", "admin"],
  "submitted→withdrawn": ["client", "planner", "staff", "admin"],
  "under_review→approved": ["staff", "hallkeeper", "admin"],
  "under_review→rejected": ["staff", "hallkeeper", "admin"],
  "under_review→withdrawn": ["client", "planner", "staff", "admin"],
  "approved→archived": ["staff", "hallkeeper", "admin"],
  "rejected→archived": ["staff", "hallkeeper", "admin"],
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
