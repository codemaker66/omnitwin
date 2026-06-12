import {
  PROPOSAL_STATUSES,
  QUOTE_STATUSES,
  VALID_PROPOSAL_TRANSITIONS,
  VALID_QUOTE_TRANSITIONS,
  type ProposalStatus,
  type QuoteStatus,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Proposal / quote state machines — pure functions, no side effects.
//
// The STRUCTURAL matrices (which transitions exist at all) live in
// @omnitwin/types proposal.ts as the single source of truth. This module
// layers the ROLE policy on top, mirroring state-machines/enquiry.ts:
// staff/admin drive the sales lifecycle; client/planner may only perform the
// client-side responses (accept / decline / request changes). Admin override
// follows the enquiry house rule: any transition, any state.
// ---------------------------------------------------------------------------

export const PROPOSAL_STATES = PROPOSAL_STATUSES;
export const QUOTE_STATES = QUOTE_STATUSES;

/** "planner" and "client" are the customer-facing roles (see enquiry.ts). */
type TransitionRole = "client" | "planner" | "staff" | "hallkeeper" | "admin";

const PROPOSAL_TRANSITION_ROLES: Record<string, readonly TransitionRole[]> = {
  "draft→sent": ["staff", "admin"],
  "draft→withdrawn": ["staff", "admin"],
  "sent→accepted": ["client", "planner", "staff", "admin"],
  "sent→declined": ["client", "planner", "staff", "admin"],
  "sent→changes_requested": ["client", "planner", "staff", "admin"],
  "sent→expired": ["staff", "admin"],
  "sent→withdrawn": ["staff", "admin"],
  "changes_requested→sent": ["staff", "admin"],
  "changes_requested→withdrawn": ["staff", "admin"],
  "accepted→archived": ["staff", "admin"],
  "declined→archived": ["staff", "admin"],
  "expired→archived": ["staff", "admin"],
  "withdrawn→archived": ["staff", "admin"],
};

const QUOTE_TRANSITION_ROLES: Record<string, readonly TransitionRole[]> = {
  "draft→issued": ["staff", "admin"],
  "issued→accepted": ["client", "planner", "staff", "admin"],
  "issued→declined": ["client", "planner", "staff", "admin"],
  "issued→superseded": ["staff", "admin"],
  "issued→expired": ["staff", "admin"],
};

/** Every role-policy key must be a structurally legal transition. Exported so
 *  tests can drift-guard the two layers against each other. */
export function proposalRolePolicyKeys(): readonly string[] {
  return Object.keys(PROPOSAL_TRANSITION_ROLES);
}

export function quoteRolePolicyKeys(): readonly string[] {
  return Object.keys(QUOTE_TRANSITION_ROLES);
}

/** True when `role` may move a proposal from `currentState` to `nextState`.
 *  Admin can perform ANY transition (house override rule). */
export function canTransitionProposal(
  currentState: string,
  nextState: string,
  role: string,
): boolean {
  if (role === "admin") return true;
  const allowed = PROPOSAL_TRANSITION_ROLES[`${currentState}→${nextState}`];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/** True when `role` may move a quote from `currentState` to `nextState`. */
export function canTransitionQuote(
  currentState: string,
  nextState: string,
  role: string,
): boolean {
  if (role === "admin") return true;
  const allowed = QUOTE_TRANSITION_ROLES[`${currentState}→${nextState}`];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/** All proposal statuses `role` can reach from `currentState`. */
export function getAvailableProposalTransitions(
  currentState: string,
  role: string,
): readonly ProposalStatus[] {
  if (role === "admin") {
    return PROPOSAL_STATES.filter((s) => s !== currentState);
  }
  const result: ProposalStatus[] = [];
  for (const key of Object.keys(PROPOSAL_TRANSITION_ROLES)) {
    const [from, to] = key.split("→");
    if (from !== currentState || to === undefined) continue;
    const allowed = PROPOSAL_TRANSITION_ROLES[key];
    if (allowed !== undefined && allowed.includes(role as TransitionRole)) {
      result.push(to as ProposalStatus);
    }
  }
  return result;
}

/** All quote statuses `role` can reach from `currentState`. */
export function getAvailableQuoteTransitions(
  currentState: string,
  role: string,
): readonly QuoteStatus[] {
  if (role === "admin") {
    return QUOTE_STATES.filter((s) => s !== currentState);
  }
  const result: QuoteStatus[] = [];
  for (const key of Object.keys(QUOTE_TRANSITION_ROLES)) {
    const [from, to] = key.split("→");
    if (from !== currentState || to === undefined) continue;
    const allowed = QUOTE_TRANSITION_ROLES[key];
    if (allowed !== undefined && allowed.includes(role as TransitionRole)) {
      result.push(to as QuoteStatus);
    }
  }
  return result;
}

/** Structural validity re-exported for handlers that need both layers. */
export function isStructuralProposalTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return VALID_PROPOSAL_TRANSITIONS[from].includes(to);
}

export function isStructuralQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return VALID_QUOTE_TRANSITIONS[from].includes(to);
}
