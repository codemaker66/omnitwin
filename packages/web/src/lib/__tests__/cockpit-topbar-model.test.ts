import { describe, expect, it } from "vitest";
import { buildTopBarModel, initialsFromName } from "../cockpit-topbar-model.js";

const baseSave = { isDirty: false, isSaving: false, saveError: null, lastSavedAt: null };

describe("initialsFromName", () => {
  it("takes first + last initial", () => {
    expect(initialsFromName("Blake Faraway")).toBe("BF");
  });
  it("handles a single name and extra whitespace", () => {
    expect(initialsFromName("Blake")).toBe("B");
    expect(initialsFromName("  jane   doe  ")).toBe("JD");
  });
  it("returns null for empty or null", () => {
    expect(initialsFromName("")).toBeNull();
    expect(initialsFromName(null)).toBeNull();
  });
});

describe("buildTopBarModel", () => {
  it("labels venue + room when a venue name is present, room only otherwise", () => {
    expect(buildTopBarModel({
      spaceName: "Grand Hall", venueName: "Trades Hall Glasgow",
      isPublicPreview: false, objectCount: 0, userName: null, save: baseSave,
      runtimeAssetStatus: "Procedural layer / no signed capture",
    }).venueLabel).toBe("Trades Hall Glasgow / Grand Hall");

    expect(buildTopBarModel({
      spaceName: "Grand Hall", venueName: null,
      isPublicPreview: false, objectCount: 0, userName: null, save: baseSave,
      runtimeAssetStatus: "Procedural layer / no signed capture",
    }).venueLabel).toBe("Grand Hall");
  });

  it("derives the save status + label, brand subtitle, item summary, and SAFE badge", () => {
    const model = buildTopBarModel({
      spaceName: "Grand Hall", venueName: "Trades Hall Glasgow",
      isPublicPreview: true, objectCount: 1, userName: "Blake Faraway",
      save: { ...baseSave, isDirty: true },
      runtimeAssetStatus: "Captured visual layer loaded / not yet signed",
    });
    expect(model.brandSubtitle).toBe("Guest draft");
    expect(model.saveStatus).toBe("unsaved");
    expect(model.saveLabel).toBe("Unsaved changes");
    expect(model.summaryLabel).toBe("1 placed item");
    expect(model.userInitials).toBe("BF");
    expect(model.runtimeLabel).toBe("Captured visual layer loaded / not yet signed");
    expect(model.reviewBadge).toBe("Planning evidence / human review required");
  });

  it("pluralises the placed-item summary and falls back when no space is loaded", () => {
    const model = buildTopBarModel({
      spaceName: null, isPublicPreview: false, objectCount: 1200, userName: null,
      save: baseSave, runtimeAssetStatus: "Procedural layer / no signed capture",
    });
    expect(model.summaryLabel).toBe("1,200 placed items");
    expect(model.venueLabel).toBe("Opening layout");
    expect(model.brandSubtitle).toBe("Team layout");
  });
});
