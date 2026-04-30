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

  it("keeps unsaved distinct from idle", () => {
    expect(deriveEditorSaveStatus({
      isDirty: true,
      isSaving: false,
      saveError: null,
      lastSavedAt: null,
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
});
