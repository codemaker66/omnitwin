import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PLANNER_DRAFT_AGE_MS,
  anonymousPlannerDraftKey,
  countPlannerDraftsOf,
  purgePlannerDraftsOf,
  signedInPlannerDraftKey,
  signedOutOwnerFrom,
  sweepExpiredPlannerDrafts,
} from "../planner-draft-storage.js";

// ---------------------------------------------------------------------------
// Unsaved planner work kept on this device never outlives its purpose: past
// its age it goes at start-up for everyone (guests too), whether or not its
// layout is ever opened again, and one person's goes when they sign out.
// ---------------------------------------------------------------------------

const NOW = 1_761_300_000_000;

function keep(key: string, updatedAtMs: number): void {
  localStorage.setItem(key, JSON.stringify({ version: 1, updatedAtMs, hasUnsavedLocalChanges: true }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("the start-up sweep", () => {
  it("forgets drafts past their age, and unreadable ones, for everyone, and nothing else", () => {
    keep(anonymousPlannerDraftKey("cfg-guest-old"), NOW - MAX_PLANNER_DRAFT_AGE_MS - 1);
    keep(signedInPlannerDraftKey("user-a", "cfg-old"), NOW - MAX_PLANNER_DRAFT_AGE_MS - 1);
    keep(signedInPlannerDraftKey("user-b", "cfg-fresh"), NOW - 1_000);
    keep(anonymousPlannerDraftKey("cfg-guest-fresh"), NOW - MAX_PLANNER_DRAFT_AGE_MS);
    localStorage.setItem(signedInPlannerDraftKey("user-a", "cfg-broken"), "{not json");
    localStorage.setItem("omnitwin_my_configs", "[]");

    expect(sweepExpiredPlannerDrafts(NOW)).toBe(3);
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-guest-old"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-old"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-broken"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-b", "cfg-fresh"))).not.toBeNull();
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-guest-fresh"))).not.toBeNull();
    expect(localStorage.getItem("omnitwin_my_configs")).toBe("[]");
  });

  it("never throws when the browser refuses its storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(sweepExpiredPlannerDrafts(NOW)).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("signing out", () => {
  it("counts and forgets only that person's kept work", () => {
    keep(signedInPlannerDraftKey("user-a", "cfg-1"), Date.now());
    keep(signedInPlannerDraftKey("user-a", "cfg-2"), Date.now());
    keep(signedInPlannerDraftKey("user-ab", "cfg-3"), Date.now());
    keep(anonymousPlannerDraftKey("cfg-4"), Date.now());

    expect(countPlannerDraftsOf("user-a")).toBe(2);
    expect(purgePlannerDraftsOf("user-a")).toBe(2);
    expect(countPlannerDraftsOf("user-a")).toBe(0);
    expect(localStorage.getItem(signedInPlannerDraftKey("user-ab", "cfg-3"))).not.toBeNull();
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-4"))).not.toBeNull();
  });

  it("tells other tabs who is signing out before the drafts go, and leaves no notice behind", () => {
    // Every write in order, as other tabs would hear them as storage events.
    const entries = new Map<string, string>();
    const heard: { key: string; newValue: string | null }[] = [];
    const recording: Storage = {
      get length() { return entries.size; },
      key: (index) => [...entries.keys()][index] ?? null,
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => { entries.set(key, value); heard.push({ key, newValue: value }); },
      removeItem: (key) => { entries.delete(key); heard.push({ key, newValue: null }); },
      clear: () => { entries.clear(); },
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(recording);
    try {
      recording.setItem(signedInPlannerDraftKey("user-a", "cfg-1"), JSON.stringify({ updatedAtMs: Date.now() }));
      heard.length = 0;
      expect(purgePlannerDraftsOf("user-a")).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
    const [notice, draftGone, noticeGone] = heard;
    expect(notice === undefined ? null : signedOutOwnerFrom(notice)).toBe("user-a");
    expect(draftGone).toEqual({ key: signedInPlannerDraftKey("user-a", "cfg-1"), newValue: null });
    expect(noticeGone).toEqual({ key: notice?.key, newValue: null });
    expect(entries.size).toBe(0);
    expect(signedOutOwnerFrom({ key: signedInPlannerDraftKey("user-a", "cfg-1"), newValue: "{}" })).toBeNull();
  });
});
