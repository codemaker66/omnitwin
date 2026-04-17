import { describe, it, expect } from "vitest";
import { emptyEventInstructions } from "@omnitwin/types";
import type { EventInstructions } from "@omnitwin/types";
import {
  computeSaveBlocked,
  normalizeForSave,
  fromDateTimeLocal,
} from "../EventDetailsPanel.js";

// ---------------------------------------------------------------------------
// Pure-helper tests for EventDetailsPanel.
//
// These cover the invariants that earned review findings (bugs 005, 012,
// 026, merged_bug_001). Each invariant, if it broke, would silently
// corrupt planner-authored event data — the exact failure mode the
// reviewers flagged. The helpers are pure so we can exercise them
// without React / jsdom / store plumbing.
// ---------------------------------------------------------------------------

describe("computeSaveBlocked", () => {
  const base: EventInstructions = emptyEventInstructions();
  const inputs = {
    saving: false,
    loading: false,
    configId: "cfg-1",
    state: base,
  } as const;

  it("allows save on a fully hydrated clean state", () => {
    expect(computeSaveBlocked(inputs)).toBe(false);
  });

  it("blocks save while an earlier save is in flight", () => {
    expect(computeSaveBlocked({ ...inputs, saving: true })).toBe(true);
  });

  it("blocks save while the GET is still hydrating (bug_026)", () => {
    // Before the fix the button was enabled during loading, letting a
    // click PATCH emptyEventInstructions on top of the server's real
    // saved blob. Must block until hydrated.
    expect(computeSaveBlocked({ ...inputs, loading: true })).toBe(true);
  });

  it("blocks save when there is no config id to target", () => {
    expect(computeSaveBlocked({ ...inputs, configId: null })).toBe(true);
  });

  it("blocks save before state has been hydrated", () => {
    expect(computeSaveBlocked({ ...inputs, state: null })).toBe(true);
  });

  it("blocks save when day-of contact has an empty name (bug_012)", () => {
    const withEmptyContact: EventInstructions = {
      ...base,
      dayOfContact: { name: "", role: "", phone: "", email: "" },
    };
    expect(computeSaveBlocked({ ...inputs, state: withEmptyContact })).toBe(true);
  });

  it("blocks save when day-of contact name is whitespace only", () => {
    const withBlankName: EventInstructions = {
      ...base,
      dayOfContact: { name: "   ", role: "", phone: "", email: "" },
    };
    expect(computeSaveBlocked({ ...inputs, state: withBlankName })).toBe(true);
  });

  it("allows save with a valid named contact", () => {
    const withValidContact: EventInstructions = {
      ...base,
      dayOfContact: { name: "Sarah", role: "", phone: "", email: "" },
    };
    expect(computeSaveBlocked({ ...inputs, state: withValidContact })).toBe(false);
  });
});

describe("normalizeForSave", () => {
  it("strips a contact with an empty name so the server schema accepts the payload", () => {
    const input: EventInstructions = {
      ...emptyEventInstructions(),
      specialInstructions: "Fire exits clear.",
      dayOfContact: { name: "", role: "Planner", phone: "", email: "" },
    };
    const out = normalizeForSave(input);
    expect(out.dayOfContact).toBeNull();
    // Unrelated edits must survive the scrub.
    expect(out.specialInstructions).toBe("Fire exits clear.");
  });

  it("preserves a contact with a real name", () => {
    const contact = { name: "Sarah", role: "Planner", phone: "+44", email: "s@e.com" };
    const input: EventInstructions = { ...emptyEventInstructions(), dayOfContact: contact };
    const out = normalizeForSave(input);
    expect(out.dayOfContact).toEqual(contact);
  });

  it("passes through null contact unchanged", () => {
    const input: EventInstructions = { ...emptyEventInstructions(), dayOfContact: null };
    expect(normalizeForSave(input).dayOfContact).toBeNull();
  });
});

describe("fromDateTimeLocal (bug_005)", () => {
  const fallback = "2026-06-15T14:30:00.000Z";

  it("returns the fallback unchanged when input is empty", () => {
    expect(fromDateTimeLocal("", fallback)).toBe(fallback);
  });

  it("returns the fallback unchanged when input is unparseable", () => {
    expect(fromDateTimeLocal("not-a-date", fallback)).toBe(fallback);
  });

  it("converts a valid local datetime to ISO UTC", () => {
    const result = fromDateTimeLocal("2026-06-15T10:00", fallback);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result).not.toBe(fallback);
  });

  it("is idempotent on empty input — never coerces to an advancing `now` sentinel", () => {
    // Regression guard for the original bug: new Date().toISOString()
    // would advance across successive calls, silently rewriting the
    // deadline on every keystroke. Fallback path must be stable.
    const a = fromDateTimeLocal("", fallback);
    const b = fromDateTimeLocal("", fallback);
    expect(a).toBe(b);
    expect(a).toBe(fallback);
  });
});
