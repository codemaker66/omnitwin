import { describe, expect, it } from "vitest";
import {
  BOOKING_STATES,
  VALID_BOOKING_TRANSITIONS,
  isValidBookingTransition,
  type BookingState,
} from "@omnitwin/types";
import {
  bookingRolePolicyKeys,
  canTransitionBooking,
  getAvailableBookingTransitions,
} from "../../state-machines/booking.js";

// ---------------------------------------------------------------------------
// Booking state machine — role policy layer (T-488; Canon §1/§3).
//
// The STRUCTURAL matrix lives in @omnitwin/types booking.ts; this layer adds
// WHO may perform each move, mirroring state-machines/proposal.ts. Staff and
// admin drive the diary; hallkeeper is read-facing; client/planner act
// through enquiry/proposal/portal surfaces, never directly on bookings.
// ---------------------------------------------------------------------------

const ALL_VALID_PAIRS: ReadonlyArray<readonly [BookingState, BookingState]> =
  BOOKING_STATES.flatMap((from) =>
    VALID_BOOKING_TRANSITIONS[from].map((to) => [from, to] as const),
  );

describe("booking role policy ↔ structural matrix drift guard", () => {
  it("every role-policy key is a structurally legal transition", () => {
    for (const key of bookingRolePolicyKeys()) {
      const [from, to] = key.split("→") as [BookingState, BookingState];
      expect(isValidBookingTransition(from, to), key).toBe(true);
    }
  });

  it("every structural transition carries a role policy (no orphan moves)", () => {
    const keys = new Set(bookingRolePolicyKeys());
    for (const [from, to] of ALL_VALID_PAIRS) {
      expect(keys.has(`${from}→${to}`), `${from}→${to}`).toBe(true);
    }
  });
});

describe("canTransitionBooking", () => {
  it("staff and admin may perform every structural transition", () => {
    for (const [from, to] of ALL_VALID_PAIRS) {
      expect(canTransitionBooking(from, to, "staff"), `staff ${from}→${to}`).toBe(true);
      expect(canTransitionBooking(from, to, "admin"), `admin ${from}→${to}`).toBe(true);
    }
  });

  it("hallkeeper, client, and planner may perform none", () => {
    for (const [from, to] of ALL_VALID_PAIRS) {
      for (const role of ["hallkeeper", "client", "planner"] as const) {
        expect(canTransitionBooking(from, to, role), `${role} ${from}→${to}`).toBe(false);
      }
    }
  });

  it("structurally invalid moves are refused for staff even when roles allow the vocabulary", () => {
    expect(canTransitionBooking("ink", "hold", "staff")).toBe(false);
    expect(canTransitionBooking("ink", "released", "staff")).toBe(false);
    expect(canTransitionBooking("released", "hold", "staff")).toBe(false);
    expect(canTransitionBooking("cancelled", "ink", "staff")).toBe(false);
  });

  it("admin override permits any transition (house rule)", () => {
    expect(canTransitionBooking("released", "ink", "admin")).toBe(true);
    expect(canTransitionBooking("cancelled", "hold", "admin")).toBe(true);
  });

  it("unknown roles are refused", () => {
    expect(canTransitionBooking("prospect", "hold", "supplier")).toBe(false);
    expect(canTransitionBooking("prospect", "hold", "")).toBe(false);
  });
});

describe("getAvailableBookingTransitions", () => {
  it("staff from hold sees the full hold lifecycle", () => {
    expect([...getAvailableBookingTransitions("hold", "staff")].sort()).toEqual(
      ["expired", "ink", "lost", "released"].sort(),
    );
  });

  it("hallkeeper sees no transitions from any state", () => {
    for (const state of BOOKING_STATES) {
      expect(getAvailableBookingTransitions(state, "hallkeeper")).toEqual([]);
    }
  });

  it("exits offer nothing to staff (terminal states)", () => {
    for (const state of ["released", "expired", "cancelled", "lost"] as const) {
      expect(getAvailableBookingTransitions(state, "staff")).toEqual([]);
    }
  });

  it("admin from any state can reach every other state (override)", () => {
    const fromInk = getAvailableBookingTransitions("ink", "admin");
    expect(fromInk).toHaveLength(BOOKING_STATES.length - 1);
    expect(fromInk).not.toContain("ink");
  });
});
