import { describe, expect, it } from "vitest";
import { extendedDecisionMs } from "../extend-decision.js";

// Wednesday 16 September 2026, 09:00 BST.
const NOW = Date.parse("2026-09-16T08:00:00.000Z");
const FAR_EVENT = "2026-12-12T17:00:00.000Z";

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe("extendedDecisionMs", () => {
  it("gives a week more from the decision date, at its own time", () => {
    // Monday 21 September 12:00 BST → Monday 28 September 12:00 BST.
    expect(iso(extendedDecisionMs("2026-09-21T11:00:00.000Z", FAR_EVENT, NOW))).toBe("2026-09-28T11:00:00.000Z");
  });

  it("counts the week from today when the decision date has passed", () => {
    // Due Tuesday 15 September 12:00 BST; today is the 16th → Wednesday 23rd at 12:00.
    expect(iso(extendedDecisionMs("2026-09-15T11:00:00.000Z", FAR_EVENT, NOW))).toBe("2026-09-23T11:00:00.000Z");
  });

  it("keeps the wall time across the clock change", () => {
    // Thursday 22 October 12:00 BST → Thursday 29 October 12:00 GMT.
    expect(iso(extendedDecisionMs("2026-10-22T11:00:00.000Z", FAR_EVENT, NOW))).toBe("2026-10-29T12:00:00.000Z");
  });

  it("stops at the day before the event", () => {
    // The event is Friday 25 September: the decision can move to Thursday 24th, not the 28th.
    expect(iso(extendedDecisionMs("2026-09-21T11:00:00.000Z", "2026-09-25T17:00:00.000Z", NOW))).toBe("2026-09-24T11:00:00.000Z");
  });

  it("offers nothing when there is no later day before the event", () => {
    expect(extendedDecisionMs("2026-09-24T11:00:00.000Z", "2026-09-25T17:00:00.000Z", NOW)).toBeNull();
    // An event tomorrow, with the decision already due today.
    expect(extendedDecisionMs("2026-09-16T11:00:00.000Z", "2026-09-17T17:00:00.000Z", Date.parse("2026-09-16T12:00:00.000Z"))).toBeNull();
    expect(extendedDecisionMs("not a date", FAR_EVENT, NOW)).toBeNull();
  });
});
