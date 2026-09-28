import { describe, it, expect } from "vitest";
import {
  canTransition,
  enquiryKind,
  getAvailableTransitions,
  isCustomerMove,
  ENQUIRY_STATES,
} from "../state-machines/enquiry.js";

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------

describe("canTransition", () => {
  // --- Planner (client) transitions ---
  it("client: draft → submitted ✓", () => {
    expect(canTransition("draft", "submitted", "client")).toBe(true);
  });

  it("client: submitted → withdrawn ✓", () => {
    expect(canTransition("submitted", "withdrawn", "client")).toBe(true);
  });

  it("client: under_review → withdrawn ✓", () => {
    expect(canTransition("under_review", "withdrawn", "client")).toBe(true);
  });

  it("client: submitted → under_review ✗", () => {
    expect(canTransition("submitted", "under_review", "client")).toBe(false);
  });

  it("client: under_review → approved ✗", () => {
    expect(canTransition("under_review", "approved", "client")).toBe(false);
  });

  it("client: under_review → rejected ✗", () => {
    expect(canTransition("under_review", "rejected", "client")).toBe(false);
  });

  // --- Hallkeeper/staff transitions ---
  it("staff: submitted → under_review ✓", () => {
    expect(canTransition("submitted", "under_review", "staff")).toBe(true);
  });

  it("hallkeeper: submitted → under_review ✓", () => {
    expect(canTransition("submitted", "under_review", "hallkeeper")).toBe(true);
  });

  it("staff: under_review → approved ✓", () => {
    expect(canTransition("under_review", "approved", "staff")).toBe(true);
  });

  it("staff: under_review → rejected ✓", () => {
    expect(canTransition("under_review", "rejected", "staff")).toBe(true);
  });

  it("staff: draft → submitted ✓", () => {
    expect(canTransition("draft", "submitted", "staff")).toBe(true);
  });

  // --- Admin override ---
  it("admin: any transition is allowed", () => {
    expect(canTransition("draft", "archived", "admin")).toBe(true);
    expect(canTransition("approved", "draft", "admin")).toBe(true);
    expect(canTransition("rejected", "submitted", "admin")).toBe(true);
    expect(canTransition("withdrawn", "under_review", "admin")).toBe(true);
  });

  // --- Invalid transitions ---
  it("approved → submitted is invalid for non-admin", () => {
    expect(canTransition("approved", "submitted", "client")).toBe(false);
    expect(canTransition("approved", "submitted", "staff")).toBe(false);
  });

  it("rejected → approved is invalid for non-admin", () => {
    expect(canTransition("rejected", "approved", "client")).toBe(false);
    expect(canTransition("rejected", "approved", "staff")).toBe(false);
  });

  it("same state → same state is invalid for non-admin", () => {
    expect(canTransition("draft", "draft", "client")).toBe(false);
  });

  it("unknown state is invalid", () => {
    expect(canTransition("unknown", "draft", "client")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAvailableTransitions
// ---------------------------------------------------------------------------

describe("getAvailableTransitions", () => {
  it("client in draft can only submit", () => {
    const transitions = getAvailableTransitions("draft", "client");
    expect(transitions).toContain("submitted");
    expect(transitions).toHaveLength(1);
  });

  it("client in submitted can only withdraw", () => {
    const transitions = getAvailableTransitions("submitted", "client");
    expect(transitions).toContain("withdrawn");
    expect(transitions).toHaveLength(1);
  });

  it("client in under_review can only withdraw", () => {
    const transitions = getAvailableTransitions("under_review", "client");
    expect(transitions).toContain("withdrawn");
    expect(transitions).toHaveLength(1);
  });

  it("staff in submitted can review or withdraw", () => {
    const transitions = getAvailableTransitions("submitted", "staff");
    expect(transitions).toContain("under_review");
    expect(transitions).toContain("withdrawn");
  });

  it("staff in under_review can approve, reject, or withdraw", () => {
    const transitions = getAvailableTransitions("under_review", "staff");
    expect(transitions).toContain("approved");
    expect(transitions).toContain("rejected");
    expect(transitions).toContain("withdrawn");
  });

  it("admin in any state can go to all other states", () => {
    const transitions = getAvailableTransitions("draft", "admin");
    // Should be all states except "draft" itself
    expect(transitions).toHaveLength(ENQUIRY_STATES.length - 1);
    expect(transitions).not.toContain("draft");
  });

  it("client in approved has no transitions", () => {
    const transitions = getAvailableTransitions("approved", "client");
    expect(transitions).toHaveLength(0);
  });

  it("client in withdrawn has no transitions", () => {
    const transitions = getAvailableTransitions("withdrawn", "client");
    expect(transitions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Requests — an access request, or an enquiry about Venviewer itself
// ---------------------------------------------------------------------------

describe("requests", () => {
  it("tells a request from a booking by its type", () => {
    expect(enquiryKind("venue-access")).toBe("request");
    expect(enquiryKind(" venue-enquiry ")).toBe("request");
    expect(enquiryKind("Wedding")).toBe("booking");
    expect(enquiryKind(null)).toBe("booking");
  });

  it("never takes a booking decision, whoever asks", () => {
    for (const role of ["client", "planner", "staff", "hallkeeper", "manager", "sales", "admin"]) {
      for (const from of ["submitted", "under_review"]) {
        expect(canTransition(from, "approved", role, "request"), `${role} ${from} approve`).toBe(false);
        expect(canTransition(from, "rejected", role, "request"), `${role} ${from} decline`).toBe(false);
      }
    }
    expect(getAvailableTransitions("under_review", "admin", "request")).not.toContain("approved");
    expect(getAvailableTransitions("under_review", "admin", "request")).not.toContain("rejected");
  });

  it("is marked done and reopened by the venue's triage roles only", () => {
    for (const role of ["staff", "hallkeeper", "manager", "sales"]) {
      expect(canTransition("submitted", "archived", role, "request"), role).toBe(true);
      expect(canTransition("under_review", "archived", role, "request"), role).toBe(true);
      expect(canTransition("archived", "submitted", role, "request"), role).toBe(true);
    }
    for (const role of ["client", "planner", "caterer"]) {
      expect(canTransition("submitted", "archived", role, "request"), role).toBe(false);
      expect(canTransition("archived", "submitted", role, "request"), role).toBe(false);
    }
    // The sender can still withdraw what they sent.
    expect(canTransition("submitted", "withdrawn", "planner", "request")).toBe(true);
    expect(getAvailableTransitions("submitted", "staff", "request")).toEqual(["withdrawn", "archived"]);
  });

  it("leaves a booking's own path unchanged", () => {
    expect(canTransition("submitted", "archived", "staff")).toBe(false);
    expect(canTransition("archived", "submitted", "staff")).toBe(false);
    expect(canTransition("under_review", "approved", "staff", "booking")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCustomerMove — the owner's own moves, as against the venue's
// ---------------------------------------------------------------------------

describe("isCustomerMove", () => {
  it("is the customer's submitting and withdrawing, for a booking and for a request", () => {
    for (const kind of ["booking", "request"] as const) {
      expect(isCustomerMove("draft", "submitted", kind), kind).toBe(true);
      expect(isCustomerMove("submitted", "withdrawn", kind), kind).toBe(true);
      expect(isCustomerMove("under_review", "withdrawn", kind), kind).toBe(true);
    }
  });

  it("is never the venue's review, decision, filing or reopening, nor a move outside the tables", () => {
    for (const [from, to] of [["submitted", "under_review"], ["under_review", "approved"], ["under_review", "rejected"],
      ["approved", "archived"], ["rejected", "archived"], ["approved", "draft"]] as const) {
      expect(isCustomerMove(from, to), `${from}→${to}`).toBe(false);
    }
    for (const [from, to] of [["submitted", "archived"], ["under_review", "archived"], ["archived", "submitted"]] as const) {
      expect(isCustomerMove(from, to, "request"), `${from}→${to}`).toBe(false);
    }
  });
});
