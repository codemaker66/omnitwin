import { describe, expect, it } from "vitest";
import { decisionAge } from "../decision-age.js";

// Wednesday 16 September 2026, 21:00 BST: late in the venue's day.
const NOW = Date.parse("2026-09-16T20:00:00.000Z");

describe("decisionAge", () => {
  it("counts the venue's calendar days, not hours", () => {
    // 09:00 BST tomorrow is tomorrow, though only 12 hours away.
    expect(decisionAge("2026-09-17T08:00:00.000Z", NOW)).toBe("Decides tomorrow");
    expect(decisionAge("2026-09-16T22:00:00.000Z", NOW)).toBe("Decides today");
    expect(decisionAge("2026-09-19T11:00:00.000Z", NOW)).toBe("Decides in 3 days");
    expect(decisionAge("2026-09-23T11:00:00.000Z", NOW)).toBe("Decides in 7 days");
  });

  it("says a decision whose time has passed is overdue", () => {
    expect(decisionAge("2026-09-16T11:00:00.000Z", NOW)).toBe("Decision overdue");
    expect(decisionAge("2026-09-01T11:00:00.000Z", NOW)).toBe("Decision overdue");
  });

  it("says nothing more than a week out, or without a decision date", () => {
    expect(decisionAge("2026-09-24T11:00:00.000Z", NOW)).toBeNull();
    expect(decisionAge(null, NOW)).toBeNull();
    expect(decisionAge("not a date", NOW)).toBeNull();
  });
});
