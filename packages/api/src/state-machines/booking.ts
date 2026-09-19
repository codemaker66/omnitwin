import {
  BOOKING_STATES,
  VALID_BOOKING_TRANSITIONS,
  type BookingState,
  type UserRole,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Booking state machine — role policy layer (T-488; Canon §1/§3).
//
// Pure functions, no side effects. The STRUCTURAL matrix (which lifecycle
// moves exist at all) lives in @omnitwin/types booking.ts as the single
// source of truth; this module layers WHO may perform each move, mirroring
// state-machines/proposal.ts. The diary is driven by the venue team and the
// people who sell it: staff, manager and sales, with admin overriding.
// Hallkeeper is a read-facing ops role here. Client, planner and caterer
// never touch bookings directly — they act through enquiry/proposal/portal
// surfaces. Admin override follows the enquiry house rule: any transition,
// any state.
//
// This list must stay in step with DIARY_WRITE_ROLES in
// services/booking-mutations.ts: the REST gate says "may attempt", this table
// says "may perform", and a role admitted by one and refused by the other is
// a half-granted write. booking.test.ts drift-guards the pair.
//
// The one move this table cannot fully grant is hold→ink / prospect→ink under
// contention: the database exclusion constraint (bookings_ink_no_overlap,
// migration 0050) is the final arbiter of the joint-first race. Role policy
// says "may attempt"; Postgres 23P01 says who actually won.
// ---------------------------------------------------------------------------

export const BOOKING_MACHINE_STATES = BOOKING_STATES;

/** "planner" and "client" are the customer-facing roles (see enquiry.ts). */
type TransitionRole = UserRole;

/** Who may move the diary. Named once so a transition cannot drift from it. */
const DIARY_TRANSITION_ROLES: readonly TransitionRole[] = ["staff", "manager", "sales", "admin"];

const BOOKING_TRANSITION_ROLES: Record<string, readonly TransitionRole[]> = {
  "prospect→hold": DIARY_TRANSITION_ROLES,
  "prospect→ink": DIARY_TRANSITION_ROLES,
  "prospect→lost": DIARY_TRANSITION_ROLES,
  "hold→ink": DIARY_TRANSITION_ROLES,
  "hold→released": DIARY_TRANSITION_ROLES,
  "hold→expired": DIARY_TRANSITION_ROLES,
  "hold→lost": DIARY_TRANSITION_ROLES,
  "ink→cancelled": DIARY_TRANSITION_ROLES,
  "internal_block→released": DIARY_TRANSITION_ROLES,
};

/** Every role-policy key must be a structurally legal transition. Exported so
 *  tests can drift-guard the two layers against each other. */
export function bookingRolePolicyKeys(): readonly string[] {
  return Object.keys(BOOKING_TRANSITION_ROLES);
}

/** True when `role` may move a booking from `currentState` to `nextState`.
 *  Admin can perform ANY transition (house override rule). */
export function canTransitionBooking(
  currentState: string,
  nextState: string,
  role: string,
): boolean {
  if (role === "admin") return true;
  const allowed = BOOKING_TRANSITION_ROLES[`${currentState}→${nextState}`];
  if (allowed === undefined) return false;
  return allowed.includes(role as TransitionRole);
}

/** All booking states `role` can reach from `currentState`. */
export function getAvailableBookingTransitions(
  currentState: string,
  role: string,
): readonly BookingState[] {
  if (role === "admin") {
    return BOOKING_MACHINE_STATES.filter((state) => state !== currentState);
  }
  const result: BookingState[] = [];
  for (const key of Object.keys(BOOKING_TRANSITION_ROLES)) {
    const [from, to] = key.split("→");
    if (from !== currentState || to === undefined) continue;
    const allowed = BOOKING_TRANSITION_ROLES[key];
    if (allowed !== undefined && allowed.includes(role as TransitionRole)) {
      result.push(to as BookingState);
    }
  }
  return result;
}

/** Structural validity re-exported for handlers that need both layers. */
export function isStructuralBookingTransition(from: BookingState, to: BookingState): boolean {
  return VALID_BOOKING_TRANSITIONS[from].includes(to);
}
