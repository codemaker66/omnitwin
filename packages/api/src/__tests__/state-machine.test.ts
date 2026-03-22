import { describe, it, expect } from "vitest";
import {
  canTransition,
  getAvailableTransitions,
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
