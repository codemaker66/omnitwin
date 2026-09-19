import { describe, expect, it } from "vitest";
import {
  BOOKING_STATES,
  USER_ROLES,
  VALID_BOOKING_TRANSITIONS,
  isValidBookingTransition,
  type BookingState,
} from "@omnitwin/types";
import {
  bookingRolePolicyKeys,
  canTransitionBooking,
  getAvailableBookingTransitions,
} from "../../state-machines/booking.js";
import { canWriteBookings } from "../../services/booking-mutations.js";
import { canTransitionProposal, canTransitionQuote } from "../../state-machines/proposal.js";
import { canTransition } from "../../state-machines/enquiry.js";
import { canManageCommercial } from "../../utils/query.js";

const VENUE = "00000000-0000-0000-0000-0000000000a0";

// ---------------------------------------------------------------------------
// Booking state machine — role policy layer (T-488; Canon §1/§3).
//
// The STRUCTURAL matrix lives in @omnitwin/types booking.ts; this layer adds
// WHO may perform each move, mirroring state-machines/proposal.ts. Staff,
// manager, sales and admin drive the diary; hallkeeper is read-facing;
// client, planner and caterer act through enquiry/proposal/portal surfaces,
// never directly on bookings.
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
  it("every role that may ink the diary may perform every structural transition", () => {
    for (const [from, to] of ALL_VALID_PAIRS) {
      for (const role of ["staff", "manager", "sales", "admin"] as const) {
        expect(canTransitionBooking(from, to, role), `${role} ${from}→${to}`).toBe(true);
      }
    }
  });

  it("hallkeeper, client, planner and caterer may perform none", () => {
    for (const [from, to] of ALL_VALID_PAIRS) {
      for (const role of ["hallkeeper", "client", "planner", "caterer"] as const) {
        expect(canTransitionBooking(from, to, role), `${role} ${from}→${to}`).toBe(false);
      }
    }
  });

  // A role admitted by the REST gate and refused by this table is a
  // half-granted write: the request passes authorisation and then dies in the
  // state machine. The two lists are maintained apart, so pin them together.
  it("admits exactly the roles the REST diary-write gate admits", () => {
    for (const role of USER_ROLES) {
      const gate = canWriteBookings({ id: "u1", role, venueId: VENUE, platformRole: "none" }, VENUE);
      const machine = canTransitionBooking("prospect", "hold", role);
      expect(machine, `${role}: REST gate ${String(gate)}, state machine ${String(machine)}`).toBe(gate);
    }
  });

  // The same seam exists on the commercial artefacts: routes/proposals.ts and
  // routes/quotes.ts gate on canManageCommercial, and a role that may create a
  // proposal but not send it has been granted nothing useful.
  it("admits exactly the roles the commercial REST gate admits, for proposals and quotes", () => {
    for (const role of USER_ROLES) {
      const gate = canManageCommercial({ role, venueId: VENUE, platformRole: "none" }, VENUE);
      expect(canTransitionProposal("draft", "sent", role),
        `${role}: proposal draft→sent should follow the REST gate ${String(gate)}`).toBe(gate);
      expect(canTransitionQuote("draft", "issued", role),
        `${role}: quote draft→issued should follow the REST gate ${String(gate)}`).toBe(gate);
    }
  });

  // The enquiry inbox reads and its triage moves must agree too: a role that
  // can see an enquiry in the venue inbox can move it through triage.
  it("lets every venue-inbox role triage an enquiry, and no customer role", () => {
    for (const role of ["staff", "hallkeeper", "manager", "sales", "admin"] as const) {
      expect(canTransition("submitted", "under_review", role), `${role} triage`).toBe(true);
    }
    for (const role of ["client", "planner", "caterer"] as const) {
      expect(canTransition("submitted", "under_review", role), `${role} triage`).toBe(false);
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
