import { describe, expect, it } from "vitest";
import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
} from "../editor-save-status.js";

describe("editor save status", () => {
  it("reports saving before every other state", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: true,
      saveError: "Network failed",
      lastSavedAt: new Date(),
    })).toBe("saving");
  });

  it("does not report saved when the last save failed", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: "Network failed",
      lastSavedAt: new Date(),
    })).toBe("failed");
  });

  it("reports failed before offline so a known failed save stays visible", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: "Network failed",
      lastSavedAt: new Date(),
      isOnline: false,
    })).toBe("failed");
  });

  it("reports offline when transport is down and no save failure is known", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: null,
      lastSavedAt: new Date(),
      isOnline: false,
    })).toBe("offline");
  });

  it("keeps unsaved distinct from idle", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: null,
      lastSavedAt: null,
    })).toBe("unsaved");
  });

  it("reports unsaved when a previously saved layout has new dirty changes", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: null,
      lastSavedAt: new Date(),
    })).toBe("unsaved");
  });

  // A refused clear of a note leaves nothing unsaved (isDirty false) while its
  // notice stands, and a save that lands since sets lastSavedAt: the status is
  // still not saved (ruling R1(b) on #388; delta review at 33a8e0ad, T3).
  it("reports unsaved, not saved, while a refused clear's notice stands over a layout with nothing left unsaved", () => {
    expect(deriveEditorSaveStatus({
      configId: "TEST ONLY layout",
      isDirty: false,
      isSaving: false,
      saveError: "Table 7's note was not removed: it was changed somewhere else, and that note cannot be shown here.",
      refusedForHeldNote: true,
      lastSavedAt: new Date(),
      isOnline: true,
    })).toBe("unsaved");
  });

  it("does not imply autosave before a real save has happened", () => {
    const copy = copyForEditorSaveStatus("idle");
    expect(copy.label).toBe("Save Layout");
    expect(copy.label).not.toMatch(/auto/i);
    expect(copy.description).not.toMatch(/instantly/i);
  });

  it("recognises a clean server configuration even if a legacy response omitted its timestamp", () => {
    expect(deriveEditorSaveStatus({ configId: "existing", isDirty: false, isSaving: false, saveError: null, lastSavedAt: null })).toBe("saved");
    expect(deriveEditorSaveStatus({ configId: null, isDirty: false, isSaving: false, saveError: null, lastSavedAt: null })).toBe("idle");
    expect(deriveEditorSaveStatus({ configId: "existing", isDirty: true, isSaving: false, saveError: null, lastSavedAt: null })).toBe("unsaved");
  });

  it("uses an age-neutral saved label for both newly saved and reopened layouts", () => {
    expect(copyForEditorSaveStatus("saved").label).toBe("Layout saved");
  });

  it("does not claim offline changes are server-saved", () => {
    const copy = copyForEditorSaveStatus("offline");
    expect(copy.label).toBe("Offline - changes local");
    expect(copy.description).toMatch(/browser session/i);
    expect(copy.description).not.toMatch(/server/i);
  });
});
