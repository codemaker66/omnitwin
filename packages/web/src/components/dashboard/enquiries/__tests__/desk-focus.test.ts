import { describe, expect, it } from "vitest";
import { pendingFocusReady } from "../desk-focus.js";

describe("pendingFocusReady", () => {
  it("waits for the render that shows the enquiry being opened", () => {
    const pending = { kind: "panel", id: "enq-55" } as const;
    // The race: an earlier commit's effect runs after j has asked for 55,
    // while that render still shows 56. It must not spend the request.
    expect(pendingFocusReady(pending, { shownId: "enq-56", confirming: null })).toBe(false);
    expect(pendingFocusReady(pending, { shownId: null, confirming: null })).toBe(false);
    expect(pendingFocusReady(pending, { shownId: "enq-55", confirming: null })).toBe(true);
  });

  it("returns to a row only once the panel has closed", () => {
    const pending = { kind: "row", id: "enq-56" } as const;
    expect(pendingFocusReady(pending, { shownId: "enq-56", confirming: null })).toBe(false);
    expect(pendingFocusReady(pending, { shownId: null, confirming: null })).toBe(true);
  });

  it("returns to the asking control only once the confirmation has gone", () => {
    const pending = { kind: "action", to: "approved" } as const;
    expect(pendingFocusReady(pending, { shownId: "enq-56", confirming: "approved" })).toBe(false);
    expect(pendingFocusReady(pending, { shownId: "enq-56", confirming: null })).toBe(true);
  });
});
