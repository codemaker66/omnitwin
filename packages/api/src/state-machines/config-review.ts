import {
  CONFIGURATION_REVIEW_STATUSES,
  VALID_CONFIGURATION_REVIEW_TRANSITIONS,
  type ConfigurationReviewStatus,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Configuration review state machine — pure functions, no side effects.
//
// Shape parallels packages/api/src/state-machines/enquiry.ts so both
// entities can share UI primitives (status pills, history timelines).
// The purely-structural transition matrix lives in @omnitwin/types
// (VALID_CONFIGURATION_REVIEW_TRANSITIONS); this module adds ROLE-based
// gating on top — defining not just "is this transition legal" but
// "is THIS ROLE allowed to perform this transition".
//
// Roles (matches TransitionRole in enquiry state machine):
//   - "client" / "planner"  — event booker, interchangeable names
//                              (legacy "client" rows coexist with the
//                              Clerk-default "planner")
//   - "staff"               — venue approver
//   - "hallkeeper"          — onsite consumer — READ-ONLY for reviews
//                              (the hallkeeper never approves; approvals
//                              are staff/admin)
//   - "admin"               — bypass — can perform any structurally-legal
//                              transition (audit-logged at the route layer)
// ---------------------------------------------------------------------------

export const CONFIGURATION_REVIEW_STATES = CONFIGURATION_REVIEW_STATUSES;

export type ConfigurationReviewState = ConfigurationReviewStatus;

type TransitionRole = "client" | "planner" | "staff" | "hallkeeper" | "admin";

/**
 * Runtime type guard — narrows an unknown string into the review-state
 * union so subsequent record lookups are typed without a blind cast.
 * Avoids the `@typescript-eslint/no-unnecessary-condition` trap where
 * an `as ConfigurationReviewState` cast tricks the compiler into
 * declaring the record lookup always-defined.
 */
function isReviewState(s: string): s is ConfigurationReviewState {
  return (CONFIGURATION_REVIEW_STATUSES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Role-gated transitions. Every key MUST correspond to a legal structural
// transition in VALID_CONFIGURATION_REVIEW_TRANSITIONS — the invariant is
// asserted at module load so a divergence between this file and the
// types package fails fast rather than in production.
//
// Planner path:
//   - submit own draft (draft → submitted)
//   - re-open after changes_requested or rejected (→ draft)
//   - withdraw their own submission (submitted/under_review/
//     changes_requested → withdrawn)
//
// Staff path:
//   - start a review (submitted → under_review) — claim semantics
//   - approve, reject, request changes (from under_review)
//   - archive (approved/rejected → archived) after the event
//
// Hallkeeper has no write transitions — reads only.
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, readonly TransitionRole[]> = {
  // Planner submit path
  "draft→submitted": ["client", "planner", "staff", "admin"],
  "changes_requested→draft": ["client", "planner", "staff", "admin"],
  "rejected→draft": ["client", "planner", "staff", "admin"],

  // Staff review path
  "submitted→under_review": ["staff", "admin"],
  "under_review→approved": ["staff", "admin"],
  "under_review→rejected": ["staff", "admin"],
  "under_review→changes_requested": ["staff", "admin"],

  // Withdraw — planner yanks their submission at any active review state
  "submitted→withdrawn": ["client", "planner", "staff", "admin"],
  "under_review→withdrawn": ["client", "planner", "staff", "admin"],
  "changes_requested→withdrawn": ["client", "planner", "staff", "admin"],

  // Archive — staff closes out after the event completes
  "approved→archived": ["staff", "admin"],
  "rejected→archived": ["staff", "admin"],
};

// ---------------------------------------------------------------------------
// Self-check — enforce at module load that every role-gated transition
// is a structurally-legal one. A divergence means the types-package
// matrix (which is the source of truth for schemas and Zod) has drifted
// from this role matrix; fail fast and loud in dev and test.
// ---------------------------------------------------------------------------

for (const key of Object.keys(TRANSITIONS)) {
  const separatorIndex = key.indexOf("→");
  if (separatorIndex === -1) {
    throw new Error(`Invalid transition key shape: ${key}`);
  }
  const from = key.slice(0, separatorIndex) as ConfigurationReviewState;
  const to = key.slice(separatorIndex + 1) as ConfigurationReviewState;
  const legal = VALID_CONFIGURATION_REVIEW_TRANSITIONS[from];
  if (!legal.includes(to)) {
    throw new Error(
      `Role-gated transition ${from}→${to} is not in VALID_CONFIGURATION_REVIEW_TRANSITIONS — types and state-machine have drifted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * True if the given role can perform a transition from `currentState` to
 * `nextState`. Admin bypasses all role gates.
 *
 * NOTE: this is the role-gated check. Structural legality (is this edge
 * in the state machine at all?) is ALSO enforced — a structurally-illegal
 * transition returns false regardless of role, including for admin.
 */
export function canTransition(
  currentState: string,
  nextState: string,
  role: string,
): boolean {
  // Structural check first — even admin can't traverse a non-existent edge.
  if (!isReviewState(currentState)) return false;
  if (!isReviewState(nextState)) return false;
  const legalEdges = VALID_CONFIGURATION_REVIEW_TRANSITIONS[currentState];
  if (!legalEdges.includes(nextState)) {
    return false;
  }

  if (role === "admin") return true;

  const key = `${currentState}→${nextState}`;
  const allowed = TRANSITIONS[key];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/**
 * Returns the set of states the given role can transition TO from the
 * current state. Admin gets every structurally-legal outgoing edge; other
 * roles get only edges for which their role is listed in TRANSITIONS.
 */
export function getAvailableTransitions(
  currentState: string,
  role: string,
): readonly ConfigurationReviewState[] {
  if (!isReviewState(currentState)) return [];
  const legalEdges = VALID_CONFIGURATION_REVIEW_TRANSITIONS[currentState];

  if (role === "admin") {
    return legalEdges;
  }

  const result: ConfigurationReviewState[] = [];
  for (const to of legalEdges) {
    const key = `${currentState}→${to}`;
    const allowed = TRANSITIONS[key];
    if (allowed !== undefined && allowed.includes(role as TransitionRole)) {
      result.push(to);
    }
  }
  return result;
}
