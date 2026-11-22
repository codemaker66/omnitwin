import { describe, expect, it } from "vitest";
import {
  DECISION_ACTION_CLASSES,
  DECISION_APPROVER_ROLES,
  DecideDecisionSchema,
  PrepareBookingTimeMoveSchema,
  canApproveDecision,
} from "../decision.js";

// The narrow approval capability (goal 09 M1; people-matrix.md §4): who
// approves each class of decision, at their own venue only.
describe("approving a decision", () => {
  const VENUE = "00000000-0000-4000-8000-0000000000d1";
  const OTHER = "00000000-0000-4000-8000-0000000000d2";

  it("lets the venue's staff and admin approve a time, and only its admin the rest", () => {
    expect(canApproveDecision({ role: "staff", venueId: VENUE }, VENUE, "booking_time_move")).toBe(true);
    expect(canApproveDecision({ role: "admin", venueId: VENUE }, VENUE, "booking_time_move")).toBe(true);
    for (const actionClass of ["guest_count_change", "stock_shortage", "service_request"] as const) {
      expect(canApproveDecision({ role: "staff", venueId: VENUE }, VENUE, actionClass)).toBe(false);
      expect(canApproveDecision({ role: "admin", venueId: VENUE }, VENUE, actionClass)).toBe(true);
    }
  });

  it("never at another venue, and never for a role outside the class's list", () => {
    for (const actionClass of DECISION_ACTION_CLASSES) {
      expect(canApproveDecision({ role: "admin", venueId: OTHER }, VENUE, actionClass)).toBe(false);
      expect(canApproveDecision({ role: "admin", venueId: null }, VENUE, actionClass)).toBe(false);
      for (const role of ["sales", "hallkeeper", "planner", "client", "caterer"]) {
        expect(canApproveDecision({ role, venueId: VENUE }, VENUE, actionClass), `${role} ${actionClass}`).toBe(false);
      }
    }
    // The manager waits on Blake (people-matrix.md §4).
    expect(Object.values(DECISION_APPROVER_ROLES).flat()).not.toContain("manager");
  });

  it("asks for a move with an end after its start, and a decision by its option and the basis shown", () => {
    const booking = "00000000-0000-4000-8000-0000000000d3";
    expect(PrepareBookingTimeMoveSchema.safeParse({ bookingId: booking, startsAt: "2030-03-10T15:00:00.000Z", endsAt: "2030-03-10T14:00:00.000Z" }).success).toBe(false);
    expect(PrepareBookingTimeMoveSchema.safeParse({ bookingId: booking, startsAt: "2030-03-10T15:00:00.000Z", endsAt: "2030-03-10T19:00:00.000Z" }).success).toBe(true);
    expect(DecideDecisionSchema.safeParse({ optionId: "move", decisionDigest: "a".repeat(64) }).success).toBe(true);
    expect(DecideDecisionSchema.safeParse({ optionId: "move", decisionDigest: "nope" }).success).toBe(false);
    // Release review: a year the database's window either side cannot reach failed with a 500.
    for (const year of ["0001", "1999", "2200", "9999"]) {
      expect(PrepareBookingTimeMoveSchema.safeParse({ bookingId: booking, startsAt: `${year}-03-10T15:00:00.000Z`, endsAt: `${year}-03-10T19:00:00.000Z` }).success, year).toBe(false);
    }
  });
});
