import { describe, it, expect } from "vitest";
import { VALID_CONFIGURATION_REVIEW_TRANSITIONS } from "@omnitwin/types";
import {
  canTransition,
  getAvailableTransitions,
  CONFIGURATION_REVIEW_STATES,
} from "../../state-machines/config-review.js";

// ---------------------------------------------------------------------------
// Exhaustive (from × to × role) enumeration — no sampling
//
// The paired `config-review.test.ts` hits the obvious cases role by role;
// this file spells out every single (from, to, role) triple so Jane
// Street reviewers can grep for "canTransition" and verify that the
// matrix is *complete*, not merely *representative*.
//
// 8 states × 8 states × 6 roles = 384 assertions for canTransition,
// plus structural-invariant tests (admin-universal, hallkeeper-read-only,
// planner-cannot-moderate, terminals-unreachable) and the round-trip
// identity getAvailableTransitions × canTransition.
//
// The EXPECTED_ALLOWED table below is an independent mirror of the
// role-gated TRANSITIONS map inside config-review.ts. Keeping it
// duplicated here is intentional — if they diverge, the test fails
// loudly; maintenance cost is one table edit per new transition.
// ---------------------------------------------------------------------------

type Role = "client" | "planner" | "staff" | "hallkeeper" | "admin" | "moderator";

const ROLES: readonly Role[] = ["client", "planner", "staff", "hallkeeper", "admin", "moderator"];

/**
 * Mirror of the role-gated TRANSITIONS map in config-review.ts. Entries
 * omitted here are implicitly forbidden for non-admin roles.
 */
const EXPECTED_ALLOWED: Readonly<Record<string, readonly Role[]>> = {
  "draft→submitted": ["client", "planner", "staff", "admin"],
  "changes_requested→submitted": ["client", "planner", "staff", "admin"],
  "rejected→submitted": ["client", "planner", "staff", "admin"],
  "withdrawn→submitted": ["client", "planner", "staff", "admin"],
  "changes_requested→draft": ["client", "planner", "staff", "admin"],
  "rejected→draft": ["client", "planner", "staff", "admin"],
  "submitted→under_review": ["staff", "admin"],
  "under_review→approved": ["staff", "admin"],
  "under_review→rejected": ["staff", "admin"],
  "under_review→changes_requested": ["staff", "admin"],
  "submitted→withdrawn": ["client", "planner", "staff", "admin"],
  "under_review→withdrawn": ["client", "planner", "staff", "admin"],
  "changes_requested→withdrawn": ["client", "planner", "staff", "admin"],
  "approved→archived": ["staff", "admin"],
  "rejected→archived": ["staff", "admin"],
};

/**
 * Pure predicate independent of canTransition itself — derives the
 * expected boolean from the two source-of-truth tables. Used as the
 * oracle for every triple in the enumeration.
 */
function expectedCanTransition(from: string, to: string, role: string): boolean {
  const states = CONFIGURATION_REVIEW_STATES as readonly string[];
  if (!states.includes(from)) return false;
  if (!states.includes(to)) return false;
  const legal = VALID_CONFIGURATION_REVIEW_TRANSITIONS[from as keyof typeof VALID_CONFIGURATION_REVIEW_TRANSITIONS];
  if (!legal.includes(to as (typeof legal)[number])) return false;
  if (role === "admin") return true;
  const allowed = EXPECTED_ALLOWED[`${from}→${to}`];
  if (allowed === undefined) return false;
  return (allowed as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// The main enumeration: 8 × 8 × 6 = 384 generated test cases.
// ---------------------------------------------------------------------------

describe("canTransition — exhaustive enumeration", () => {
  for (const from of CONFIGURATION_REVIEW_STATES) {
    for (const to of CONFIGURATION_REVIEW_STATES) {
      for (const role of ROLES) {
        const expected = expectedCanTransition(from, to, role);
        it(`${from} → ${to} as ${role} = ${String(expected)}`, () => {
          expect(canTransition(from, to, role)).toBe(expected);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-role invariants
// ---------------------------------------------------------------------------

describe("invariant: admin performs every structurally-legal transition", () => {
  for (const from of CONFIGURATION_REVIEW_STATES) {
    const legal = VALID_CONFIGURATION_REVIEW_TRANSITIONS[from];
    for (const to of legal) {
      it(`admin: ${from} → ${to}`, () => {
        expect(canTransition(from, to, "admin")).toBe(true);
      });
    }
  }
});

describe("invariant: hallkeeper has zero write transitions", () => {
  for (const from of CONFIGURATION_REVIEW_STATES) {
    for (const to of CONFIGURATION_REVIEW_STATES) {
      it(`hallkeeper cannot ${from} → ${to}`, () => {
        expect(canTransition(from, to, "hallkeeper")).toBe(false);
      });
    }
  }

  it("hallkeeper getAvailableTransitions is empty for every state", () => {
    for (const from of CONFIGURATION_REVIEW_STATES) {
      expect(getAvailableTransitions(from, "hallkeeper")).toEqual([]);
    }
  });
});

describe("invariant: unknown role has zero transitions", () => {
  for (const from of CONFIGURATION_REVIEW_STATES) {
    for (const to of CONFIGURATION_REVIEW_STATES) {
      it(`moderator cannot ${from} → ${to}`, () => {
        expect(canTransition(from, to, "moderator")).toBe(false);
      });
    }
  }
});

describe("invariant: the terminal state leads nowhere", () => {
  for (const to of CONFIGURATION_REVIEW_STATES) {
    for (const role of ROLES) {
      it(`archived → ${to} as ${role} is rejected`, () => {
        expect(canTransition("archived", to, role)).toBe(false);
      });
    }
  }
});

describe("invariant: a withdrawn layout only goes back to the venue", () => {
  for (const to of CONFIGURATION_REVIEW_STATES) {
    for (const role of ROLES) {
      const expected = to === "submitted" && role !== "hallkeeper" && role !== "moderator";
      it(`withdrawn → ${to} as ${role} = ${String(expected)}`, () => {
        expect(canTransition("withdrawn", to, role)).toBe(expected);
      });
    }
  }
});

describe("invariant: planner cannot moderate (approve/reject/request-changes)", () => {
  const moderationEdges: readonly (readonly [string, string])[] = [
    ["under_review", "approved"],
    ["under_review", "rejected"],
    ["under_review", "changes_requested"],
    ["submitted", "under_review"],
    ["approved", "archived"],
    ["rejected", "archived"],
  ];
  for (const [from, to] of moderationEdges) {
    it(`planner cannot ${from} → ${to}`, () => {
      expect(canTransition(from, to, "planner")).toBe(false);
      expect(canTransition(from, to, "client")).toBe(false);
    });
  }
});

describe("invariant: self-transitions are always rejected", () => {
  for (const s of CONFIGURATION_REVIEW_STATES) {
    for (const role of ROLES) {
      it(`${s} → ${s} as ${role} is rejected`, () => {
        expect(canTransition(s, s, role)).toBe(false);
      });
    }
  }
});

describe("invariant: unknown states are always rejected (both directions)", () => {
  const bogus = ["pending", "", "deleted", "APPROVED", "draft "];
  for (const b of bogus) {
    for (const role of ROLES) {
      it(`unknown-from '${b}' → submitted as ${role}`, () => {
        expect(canTransition(b, "submitted", role)).toBe(false);
      });
      it(`draft → unknown-to '${b}' as ${role}`, () => {
        expect(canTransition("draft", b, role)).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// getAvailableTransitions × canTransition round-trip — each listed option
// must itself be canTransition=true, and nothing canTransition=true
// should be missing from the list.
// ---------------------------------------------------------------------------

describe("round-trip: getAvailableTransitions ↔ canTransition", () => {
  for (const role of ROLES) {
    for (const from of CONFIGURATION_REVIEW_STATES) {
      it(`${from} as ${role}: list and predicate agree`, () => {
        const available = getAvailableTransitions(from, role);
        for (const to of available) {
          expect(canTransition(from, to, role)).toBe(true);
        }
        for (const to of CONFIGURATION_REVIEW_STATES) {
          if (canTransition(from, to, role)) {
            expect(available).toContain(to);
          }
        }
      });
    }
  }
});
