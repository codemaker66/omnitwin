import {
  BOOKING_STATES,
  VALID_BOOKING_TRANSITIONS,
  type BookingState,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Booking state machine — role policy layer (T-488; Canon §1/§3).
//
// Pure functions, no side effects. The STRUCTURAL matrix (which lifecycle
// moves exist at all) lives in @omnitwin/types booking.ts as the single
// source of truth; this module layers WHO may perform each move, mirroring
// state-machines/proposal.ts. Staff/admin drive the diary. Hallkeeper is a
// read-facing ops role here. Client/planner never touch bookings directly —
// they act through enquiry/proposal/portal surfaces. Admin override follows
// the enquiry house rule: any transition, any state.
//
// The one move this table cannot fully grant is hold→ink / prospect→ink under
// contention: the database exclusion constraint (bookings_ink_no_overlap,
// migration 0050) is the final arbiter of the joint-first race. Role policy
// says "may attempt"; Postgres 23P01 says who actually won.
// ---------------------------------------------------------------------------

export const BOOKING_MACHINE_STATES = BOOKING_STATES;

/** "planner" and "client" are the customer-facing roles (see enquiry.ts). */
type TransitionRole = "client" | "planner" | "staff" | "hallkeeper" | "admin";

const BOOKING_TRANSITION_ROLES: Record<string, readonly TransitionRole[]> = {
  "prospect→hold": ["staff", "admin"],
  "prospect→ink": ["staff", "admin"],
  "prospect→lost": ["staff", "admin"],
  "hold→ink": ["staff", "admin"],
  "hold→released": ["staff", "admin"],
  "hold→expired": ["staff", "admin"],
  "hold→lost": ["staff", "admin"],
  "ink→cancelled": ["staff", "admin"],
  "internal_block→released": ["staff", "admin"],
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
