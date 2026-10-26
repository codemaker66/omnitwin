import { describe, expect, it } from "vitest";
import { actNameProblem, actOverlaps, durationProblem, runningOrder, type ActFacts } from "../event-details-acts.js";

const dinner: ActFacts = { id: "dinner", name: "Dinner", startsAt: "2026-11-28T19:00:00.000Z", durationMinutes: 120, sortOrder: 0 };
const ceilidh: ActFacts = { id: "ceilidh", name: "Ceilidh", startsAt: "2026-11-28T21:30:00.000Z", durationMinutes: 150, sortOrder: 1 };
const arrival: ActFacts = { id: "arrival", name: "Arrival", startsAt: "2026-11-28T18:30:00.000Z", durationMinutes: 30, sortOrder: 2 };
const untimed: ActFacts = { id: "toasts", name: "Toasts", startsAt: null, durationMinutes: 20, sortOrder: 3 };

describe("the running order", () => {
  it("is in time order whatever order the event lists its acts, with untimed acts last", () => {
    const ordered = runningOrder([untimed, ceilidh, dinner, arrival]);
    expect(ordered.map((act) => act.id)).toEqual(["arrival", "dinner", "ceilidh", "toasts"]);
    expect(ordered[1]?.endsAt).toBe("2026-11-28T21:00:00.000Z");
    expect(ordered[3]?.endsAt).toBeNull();
  });

  it("says nothing when the acts follow one another", () => {
    expect(actOverlaps(runningOrder([arrival, dinner, ceilidh]))).toEqual([]);
  });

  it("says plainly, in Glasgow time, when one act runs past the next one's start", () => {
    const late = { ...dinner, durationMinutes: 165 };
    expect(actOverlaps(runningOrder([late, ceilidh]))).toEqual([
      { earlierId: "dinner", laterId: "ceilidh", line: "Dinner runs to 21:45, past the start of Ceilidh at 21:30." },
    ]);
  });

  it("keeps the event's rules for a name and a duration", () => {
    expect(actNameProblem("  ")).toBe("Name the act to save it");
    expect(actNameProblem("x".repeat(101))).toBe("Up to 100 characters");
    expect(actNameProblem("Ceilidh")).toBeNull();
    expect(durationProblem(-1)).toBe("Type whole minutes");
    expect(durationProblem(1.5)).toBe("Type whole minutes");
    expect(durationProblem(24 * 60 + 1)).toBe("Up to 24 hours");
    expect(durationProblem(90)).toBeNull();
  });
});
