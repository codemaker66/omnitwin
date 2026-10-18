import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  resolveProgressMutation,
  checkedStateAfter,
  progressEventFor,
  type ProgressMutation,
} from "../lib/hallkeeper-progress.js";

// ---------------------------------------------------------------------------
// Pure mutation resolution for PATCH /hallkeeper/:configId/progress.
//
// `checked` present  → idempotent SET-STATE (force desired state)
// `checked` absent   → legacy TOGGLE (flip current state)
//
// The set-state path is what lets the offline replay queue converge safely:
// re-issuing the same PATCH is a no-op, so a lost response or a concurrent
// device can never flip the row to the wrong value (closes the T-441 TOCTOU).
// ---------------------------------------------------------------------------

describe("resolveProgressMutation", () => {
  describe("legacy toggle (desired === undefined)", () => {
    it("inserts when the row does not exist", () => {
      expect(resolveProgressMutation(false, undefined)).toBe("insert");
    });
    it("deletes when the row exists", () => {
      expect(resolveProgressMutation(true, undefined)).toBe("delete");
    });
  });

  describe("idempotent set-state (desired provided)", () => {
    it("is a no-op when the server already matches the desired state", () => {
      expect(resolveProgressMutation(true, true)).toBe("noop");
      expect(resolveProgressMutation(false, false)).toBe("noop");
    });
    it("inserts when desired checked and the row is absent", () => {
      expect(resolveProgressMutation(false, true)).toBe("insert");
    });
    it("deletes when desired unchecked and the row is present", () => {
      expect(resolveProgressMutation(true, false)).toBe("delete");
    });
  });

  it("is idempotent — replaying a set-state request never flips back", () => {
    // Converge (insert), then a replay sees the converged state (noop).
    expect(resolveProgressMutation(false, true)).toBe("insert");
    expect(resolveProgressMutation(true, true)).toBe("noop");
    // Same for unchecking.
    expect(resolveProgressMutation(true, false)).toBe("delete");
    expect(resolveProgressMutation(false, false)).toBe("noop");
  });
});

describe("checkedStateAfter", () => {
  it("reports the resulting checked state for each mutation", () => {
    expect(checkedStateAfter("insert", false)).toBe(true);
    expect(checkedStateAfter("delete", true)).toBe(false);
    expect(checkedStateAfter("noop", true)).toBe(true);
    expect(checkedStateAfter("noop", false)).toBe(false);
  });

  it("composes with resolveProgressMutation to converge on the desired state", () => {
    const cases: { existing: boolean; desired: boolean }[] = [
      { existing: false, desired: true },
      { existing: true, desired: true },
      { existing: true, desired: false },
      { existing: false, desired: false },
    ];
    for (const { existing, desired } of cases) {
      const mutation: ProgressMutation = resolveProgressMutation(existing, desired);
      expect(checkedStateAfter(mutation, existing)).toBe(desired);
    }
  });
});

// A layout can serve more than one event. Ticks keyed on the layout alone
// meant a reused layout opened with the last event's ticks, and the Day Board
// could say "84 of 84" for a room nobody had set tonight.
describe("progressEventFor: which event a sheet's ticks belong to", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";

  it("is the event the hallkeeper arrived from, when the layout is linked to it", () => {
    expect(progressEventFor([A, B], B)).toBe(B);
    expect(progressEventFor([A], A)).toBe(A);
  });

  it("is the layout's only event when the sheet was opened without one", () => {
    expect(progressEventFor([A], null)).toBe(A);
  });

  it("falls back as the sheet's own times do when the event named is not linked", () => {
    expect(progressEventFor([A], B)).toBe(A);
    expect(progressEventFor([A, B], "00000000-0000-4000-8000-00000000000c")).toBeNull();
  });

  it("is no event when the layout has none, or several and none was named", () => {
    expect(progressEventFor([], null)).toBeNull();
    expect(progressEventFor([], A)).toBeNull();
    expect(progressEventFor([A, B], null)).toBeNull();
  });
});

describe("progress route implementation", () => {
  it("uses conflict-safe insert for idempotent checked=true replay, within the event's own ticks", async () => {
    const source = await readFile(resolve("src/routes/hallkeeper-sheet.ts"), "utf-8");

    expect(source).toContain("if (desired !== undefined)");
    expect(source).toContain(".onConflictDoNothing({");
    expect(source).toContain("target: [hallkeeperProgress.configId, hallkeeperProgress.eventId, hallkeeperProgress.rowKey]");
    expect(source).toContain("return { data: { configId, eventId, rowKey, checked: desired } }");
  });
});
