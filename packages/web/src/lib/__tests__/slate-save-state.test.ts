import { describe, expect, it } from "vitest";
import { describeLayoutChange, slateSaveState, type SlateSaveInput } from "../editor-save-status.js";

// ---------------------------------------------------------------------------
// The slate's honest save states (T-671 slice 7; spec 6.1, sheet 17, frame
// 08). Each state's exact words, said plainly: what happened and what is safe.
// "Save layout" never appears (F-43); no revision number ever does (F-44).
// ---------------------------------------------------------------------------

const AT_2158 = new Date("2026-11-28T21:58:00Z");

const steady: SlateSaveInput = {
  hasLayout: true,
  guest: false,
  isSaving: false,
  isDirty: false,
  pendingChanges: 0,
  savingChanges: null,
  isOnline: true,
  keptOnDevice: false,
  saveError: null,
  conflict: null,
  lockReason: null,
  lastSavedAt: new Date("2026-11-28T21:41:00Z"),
};

const nothing = { moved: [], added: [], removed: [], restyled: [] };

describe("the slate's save states", () => {
  it("Saved, with its time on hover", () => {
    expect(slateSaveState(steady)).toMatchObject({ kind: "saved", status: "Saved", detail: null, mark: "saved", title: "Saved 21:41", notice: null });
  });

  it("Saving, with how many changes are on their way", () => {
    expect(slateSaveState({ ...steady, isSaving: true, savingChanges: 2, pendingChanges: 3 })).toMatchObject({
      kind: "saving", status: "Saving", detail: "2 changes", mark: "working",
    });
    expect(slateSaveState({ ...steady, isDirty: true, pendingChanges: 1 })).toMatchObject({ kind: "saving", detail: "1 change" });
    expect(slateSaveState({ ...steady, isSaving: true, savingChanges: 0 })).toMatchObject({ kind: "saving", detail: null });
  });

  it("Offline, with the changes kept on this device and sending waiting (frame 08)", () => {
    const offline = slateSaveState({ ...steady, isOnline: false, isDirty: true, pendingChanges: 3, keptOnDevice: true });
    expect(offline).toMatchObject({ kind: "offline", status: "Offline", detail: "3 changes kept on this device", mark: "offline", sendWaits: true });
    expect(offline.notice).toEqual({
      heading: "The connection to Venviewer has dropped.",
      body: "You can keep working. Your changes save as soon as it is back; sending waits until then.",
      actions: [],
    });
  });

  it("never claims the device keeps what only this tab holds", () => {
    expect(slateSaveState({ ...steady, isOnline: false, isDirty: true, pendingChanges: 2, keptOnDevice: false })).toMatchObject({ detail: "2 changes kept in this tab" });
    expect(slateSaveState({ ...steady, isOnline: false })).toMatchObject({ kind: "offline", detail: "everything is saved" });
  });

  it("Not saved, with what is safe and one way forward", () => {
    const failed = slateSaveState({ ...steady, isDirty: true, pendingChanges: 2, keptOnDevice: true, saveError: "Network request failed" });
    expect(failed).toMatchObject({ kind: "not-saved", status: "Not saved", detail: "kept on this device", mark: "problem" });
    expect(failed.notice).toEqual({
      heading: "The last save did not reach Venviewer.",
      body: "Your changes are kept on this device.",
      actions: [{ id: "try-again", label: "Try again" }],
    });
    const tabOnly = slateSaveState({ ...steady, isDirty: true, pendingChanges: 2, keptOnDevice: false, saveError: "Network request failed" });
    expect(tabOnly).toMatchObject({ kind: "not-saved", detail: "kept in this tab" });
    expect(tabOnly.notice?.body).toBe("Your changes are kept in this tab until it closes.");
  });

  it("Changed elsewhere names the person, the change and the time, never a revision number", () => {
    const conflict = slateSaveState({
      ...steady,
      isDirty: true,
      pendingChanges: 1,
      saveError: "This layout changed in another tab. Reload the server copy before saving again.",
      conflict: {
        changedByName: "Elaine",
        byYou: false,
        changedAt: AT_2158,
        theirChange: { ...nothing, moved: [{ noun: "table", label: "Table 3" }, { noun: "table", label: "Table 4" }], added: [{ noun: "lectern", label: null }] },
      },
    });
    expect(conflict).toMatchObject({ kind: "changed-elsewhere", status: "Not saved", detail: "changed elsewhere", mark: "problem" });
    expect(conflict.notice).toEqual({
      heading: "Elaine changed this layout at 21:58.",
      body: "Elaine moved Tables 3 and 4 and added a lectern. Whichever you keep, the other stays in History.",
      actions: [{ id: "show-theirs", label: "Show Elaine's version" }, { id: "keep-mine", label: "Keep mine" }],
    });
    expect(JSON.stringify(conflict)).not.toMatch(/revision|\d+ is newer/iu);
  });

  it("says when the other change was this person's own, in another tab", () => {
    const own = slateSaveState({ ...steady, saveError: "x", conflict: { changedByName: "Blake", byYou: true, changedAt: AT_2158, theirChange: { ...nothing, removed: [{ noun: "table", label: null }] } } });
    expect(own.notice).toEqual({
      heading: "You changed this layout in another tab at 21:58.",
      body: "That tab removed a table. Whichever you keep, the other stays in History.",
      actions: [{ id: "show-theirs", label: "Show that version" }, { id: "keep-mine", label: "Keep this one" }],
    });
  });

  it("speaks plainly when it cannot say who, or what", () => {
    const unknown = slateSaveState({ ...steady, saveError: "x", conflict: { changedByName: null, byYou: false, changedAt: null, theirChange: null } });
    expect(unknown.notice).toEqual({
      heading: "This layout was changed elsewhere.",
      body: "Whichever you keep, the other stays in History.",
      actions: [{ id: "show-theirs", label: "Show the newer version" }, { id: "keep-mine", label: "Keep mine" }],
    });
  });

  it("Draft for a guest, with the way to keep it", () => {
    expect(slateSaveState({ ...steady, guest: true, isDirty: true, pendingChanges: 4, keptOnDevice: true })).toMatchObject({
      kind: "draft", status: "Draft", detail: "kept on this device", mark: "draft", lineAction: { id: "sign-in", label: "Sign in to keep it" },
    });
    // Only what the device actually holds is said to be kept there.
    expect(slateSaveState({ ...steady, guest: true, isDirty: true, pendingChanges: 4, keptOnDevice: false })).toMatchObject({ kind: "draft", detail: "kept in this tab" });
    expect(slateSaveState({ ...steady, guest: true })).toMatchObject({ kind: "draft", detail: null });
  });

  it("names the time in the venue's own zone", () => {
    const summer = { ...steady, lastSavedAt: new Date("2026-07-04T20:41:00Z") };
    expect(slateSaveState(summer).title).toBe("Saved 21:41");
    expect(slateSaveState({ ...summer, timeZone: "UTC" }).title).toBe("Saved 20:41");
  });

  it("View only, with its reason, above everything else", () => {
    expect(slateSaveState({ ...steady, lockReason: "phase-preview", isOnline: false })).toMatchObject({ kind: "view-only", status: "View only", detail: "previewing an act's layout", mark: "none" });
    expect(slateSaveState({ ...steady, lockReason: "in-review" })).toMatchObject({ kind: "view-only", detail: "sent for approval" });
  });

  it("never says Save layout, whatever the state", () => {
    const states: SlateSaveInput[] = [
      steady,
      { ...steady, hasLayout: false, lastSavedAt: null },
      { ...steady, isDirty: true },
      { ...steady, isSaving: true },
      { ...steady, guest: true },
      { ...steady, isOnline: false },
      { ...steady, saveError: "x" },
    ];
    for (const state of states) expect(JSON.stringify(slateSaveState(state))).not.toMatch(/save layout/iu);
  });
});

describe("describing someone else's change", () => {
  it("names pieces by their labels, gathered, and counts the rest", () => {
    expect(describeLayoutChange({ ...nothing, moved: [{ noun: "table", label: "Table 3" }, { noun: "table", label: "Table 4" }] })).toBe("moved Tables 3 and 4");
    expect(describeLayoutChange({ ...nothing, moved: [{ noun: "table", label: null }, { noun: "table", label: null }, { noun: "chair", label: null }] })).toBe("moved 2 tables and a chair");
    expect(describeLayoutChange({ ...nothing, added: [{ noun: "lectern", label: null }], removed: [{ noun: "table", label: "Table 8" }], restyled: [{ noun: "table", label: null }] }))
      .toBe("added a lectern, removed Table 8 and changed a table");
    expect(describeLayoutChange({ ...nothing, moved: [{ noun: "table", label: "Table 10" }, { noun: "table", label: "Table 4" }, { noun: "table", label: "Table 3" }] })).toBe("moved Tables 3, 4 and 10");
    expect(describeLayoutChange(nothing)).toBeNull();
  });
});
