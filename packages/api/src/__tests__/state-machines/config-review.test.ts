import { describe, it, expect } from "vitest";
import {
  canTransition,
  getAvailableTransitions,
  CONFIGURATION_REVIEW_STATES,
  type ConfigurationReviewState,
} from "../../state-machines/config-review.js";

// ---------------------------------------------------------------------------
// canTransition — role-gated + structural
// ---------------------------------------------------------------------------

describe("canTransition — planner path", () => {
  it("planner can submit their own draft", () => {
    expect(canTransition("draft", "submitted", "planner")).toBe(true);
  });

  it("client (legacy role) can also submit — treated as planner", () => {
    expect(canTransition("draft", "submitted", "client")).toBe(true);
  });

  it("planner can re-open after changes_requested", () => {
    expect(canTransition("changes_requested", "draft", "planner")).toBe(true);
  });

  it("planner can re-open after rejection", () => {
    expect(canTransition("rejected", "draft", "planner")).toBe(true);
  });

  it("planner CANNOT approve their own submission", () => {
    expect(canTransition("under_review", "approved", "planner")).toBe(false);
  });

  it("planner CANNOT reject their own submission", () => {
    expect(canTransition("under_review", "rejected", "planner")).toBe(false);
  });

  it("planner CANNOT start a review (that's a staff claim action)", () => {
    expect(canTransition("submitted", "under_review", "planner")).toBe(false);
  });
});

describe("canTransition — withdraw", () => {
  it("planner can withdraw a submitted config", () => {
    expect(canTransition("submitted", "withdrawn", "planner")).toBe(true);
  });

  it("planner can withdraw an under-review config", () => {
    expect(canTransition("under_review", "withdrawn", "planner")).toBe(true);
  });

  it("planner can withdraw a changes_requested config", () => {
    expect(canTransition("changes_requested", "withdrawn", "planner")).toBe(true);
  });
});

describe("canTransition — staff path", () => {
  it("staff can start a review (submitted → under_review)", () => {
    expect(canTransition("submitted", "under_review", "staff")).toBe(true);
  });

  it("staff can approve", () => {
    expect(canTransition("under_review", "approved", "staff")).toBe(true);
  });

  it("staff can reject", () => {
    expect(canTransition("under_review", "rejected", "staff")).toBe(true);
  });

  it("staff can request changes", () => {
    expect(canTransition("under_review", "changes_requested", "staff")).toBe(true);
  });

  it("staff can archive an approved config", () => {
    expect(canTransition("approved", "archived", "staff")).toBe(true);
  });

  it("staff can archive a rejected config", () => {
    expect(canTransition("rejected", "archived", "staff")).toBe(true);
  });

  it("staff can withdraw on behalf of planner", () => {
    expect(canTransition("submitted", "withdrawn", "staff")).toBe(true);
  });
});

describe("canTransition — hallkeeper is read-only", () => {
  it("hallkeeper cannot submit", () => {
    expect(canTransition("draft", "submitted", "hallkeeper")).toBe(false);
  });

  it("hallkeeper cannot approve", () => {
    expect(canTransition("under_review", "approved", "hallkeeper")).toBe(false);
  });

  it("hallkeeper cannot reject", () => {
    expect(canTransition("under_review", "rejected", "hallkeeper")).toBe(false);
  });

  it("hallkeeper cannot archive", () => {
    expect(canTransition("approved", "archived", "hallkeeper")).toBe(false);
  });
});

describe("canTransition — admin override", () => {
  it("admin can perform any structurally-legal transition", () => {
    expect(canTransition("draft", "submitted", "admin")).toBe(true);
    expect(canTransition("submitted", "under_review", "admin")).toBe(true);
    expect(canTransition("under_review", "approved", "admin")).toBe(true);
    expect(canTransition("approved", "archived", "admin")).toBe(true);
  });

  it("admin CANNOT bypass structural impossibility (approved → draft)", () => {
    expect(canTransition("approved", "draft", "admin")).toBe(false);
  });

  it("admin CANNOT transition from terminal states", () => {
    expect(canTransition("withdrawn", "draft", "admin")).toBe(false);
    expect(canTransition("archived", "draft", "admin")).toBe(false);
  });

  it("admin CANNOT skip steps (draft → approved)", () => {
    expect(canTransition("draft", "approved", "admin")).toBe(false);
  });
});

describe("canTransition — unknown roles and states", () => {
  it("unknown role cannot transition", () => {
    expect(canTransition("draft", "submitted", "moderator")).toBe(false);
  });

  it("unknown current state cannot transition", () => {
    expect(canTransition("pending", "submitted", "staff")).toBe(false);
  });

  it("unknown next state cannot transition", () => {
    expect(canTransition("draft", "pending", "staff")).toBe(false);
  });

  it("self-transition always rejected", () => {
    for (const s of CONFIGURATION_REVIEW_STATES) {
      expect(canTransition(s, s, "admin")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getAvailableTransitions
// ---------------------------------------------------------------------------

describe("getAvailableTransitions", () => {
  it("returns planner's options from draft", () => {
    expect(getAvailableTransitions("draft", "planner")).toEqual(["submitted"]);
  });

  it("returns planner's options from submitted (withdraw only)", () => {
    expect(getAvailableTransitions("submitted", "planner")).toEqual(["withdrawn"]);
  });

  it("returns planner's options from under_review (withdraw only)", () => {
    expect(getAvailableTransitions("under_review", "planner")).toEqual(["withdrawn"]);
  });

  it("returns planner's options from changes_requested (draft + withdraw)", () => {
    const result = getAvailableTransitions("changes_requested", "planner");
    expect(result).toEqual(expect.arrayContaining(["draft", "withdrawn"]));
    expect(result).toHaveLength(2);
  });

  it("returns staff's full review options from under_review", () => {
    const result = getAvailableTransitions("under_review", "staff");
    expect(result).toEqual(
      expect.arrayContaining(["approved", "rejected", "changes_requested", "withdrawn"]),
    );
    expect(result).toHaveLength(4);
  });

  it("returns staff's archive option from approved", () => {
    expect(getAvailableTransitions("approved", "staff")).toEqual(["archived"]);
  });

  it("returns no options for hallkeeper in any state", () => {
    for (const s of CONFIGURATION_REVIEW_STATES) {
      expect(getAvailableTransitions(s, "hallkeeper")).toEqual([]);
    }
  });

  it("returns no options for terminal states, any role", () => {
    for (const role of ["planner", "staff", "admin", "hallkeeper"]) {
      expect(getAvailableTransitions("withdrawn", role)).toEqual([]);
      expect(getAvailableTransitions("archived", role)).toEqual([]);
    }
  });

  it("returns all structurally-legal outgoing edges for admin from under_review", () => {
    const result = getAvailableTransitions("under_review", "admin");
    expect(result).toEqual(
      expect.arrayContaining(["approved", "rejected", "changes_requested", "withdrawn"]),
    );
    expect(result).toHaveLength(4);
  });

  it("returns [] for unknown starting state", () => {
    expect(getAvailableTransitions("pending", "staff")).toEqual([]);
  });

  it("every returned transition round-trips to canTransition=true", () => {
    const roles = ["planner", "staff", "admin", "hallkeeper"];
    for (const role of roles) {
      for (const from of CONFIGURATION_REVIEW_STATES) {
        const available = getAvailableTransitions(from, role);
        for (const to of available) {
          expect(canTransition(from, to, role)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CONFIGURATION_REVIEW_STATES — re-exported constant
// ---------------------------------------------------------------------------

describe("CONFIGURATION_REVIEW_STATES", () => {
  it("has the 8 canonical states", () => {
    const expected: ConfigurationReviewState[] = [
      "draft", "submitted", "under_review",
      "approved", "rejected", "changes_requested",
      "withdrawn", "archived",
    ];
    expect([...CONFIGURATION_REVIEW_STATES]).toEqual(expected);
  });
});
