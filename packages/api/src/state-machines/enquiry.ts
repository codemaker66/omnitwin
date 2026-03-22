// ---------------------------------------------------------------------------
// Enquiry state machine — pure functions, no side effects
// ---------------------------------------------------------------------------

/** All valid enquiry states. */
export const ENQUIRY_STATES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
  "archived",
] as const;

export type EnquiryState = (typeof ENQUIRY_STATES)[number];

/** Roles relevant to enquiry transitions. */
type TransitionRole = "client" | "staff" | "hallkeeper" | "admin";

// ---------------------------------------------------------------------------
// Transition rules — keyed by [fromState][toState] → allowed roles
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, readonly TransitionRole[]> = {
  "draft→submitted": ["client", "staff", "admin"],
  "submitted→under_review": ["staff", "hallkeeper", "admin"],
  "submitted→withdrawn": ["client", "staff", "admin"],
  "under_review→approved": ["staff", "hallkeeper", "admin"],
  "under_review→rejected": ["staff", "hallkeeper", "admin"],
  "under_review→withdrawn": ["client", "staff", "admin"],
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
