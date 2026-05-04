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

  it("does not imply autosave before a real save has happened", () => {
    const copy = copyForEditorSaveStatus("idle");
    expect(copy.label).toBe("Save Layout");
    expect(copy.label).not.toMatch(/auto/i);
    expect(copy.description).not.toMatch(/instantly/i);
  });

  it("uses an honest post-save label", () => {
    expect(copyForEditorSaveStatus("saved").label).toBe("Saved just now");
  });

  it("does not claim offline changes are server-saved", () => {
    const copy = copyForEditorSaveStatus("offline");
    expect(copy.label).toBe("Offline - changes local");
    expect(copy.description).toMatch(/browser session/i);
    expect(copy.description).not.toMatch(/server/i);
  });
});
