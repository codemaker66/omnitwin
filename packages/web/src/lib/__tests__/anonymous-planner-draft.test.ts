import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorObject } from "../../stores/editor-store.js";
import {
  anonymousPlannerDraftKey,
  persistAnonymousPlannerDraft,
  readAnonymousPlannerDraft,
} from "../anonymous-planner-draft.js";

const objectFixture: EditorObject = {
  id: "local-1",
  assetDefinitionId: "round-table-6ft",
  positionX: 1,
  positionY: 0,
  positionZ: 2,
  rotationX: 0,
  rotationY: 0.25,
  rotationZ: 0,
  scale: 1,
  sortOrder: 0,
  clothed: true,
  groupId: "group-1",
  notes: "VIP table",
};

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("anonymous planner draft persistence", () => {
  it("persists dirty public-preview scene objects", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    const draft = readAnonymousPlannerDraft("cfg-1", {
      spaceId: "space-1",
      venueId: "venue-1",
    });

    expect(draft?.objects).toEqual([objectFixture]);
    expect(draft?.hasUnsavedLocalChanges).toBe(true);
  });

  it("removes the draft once public-preview changes are clean", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: false,
    });

    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
  });

  it("does not store claimed/private configuration scene data", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: false,
      objects: [objectFixture],
      isDirty: true,
    });

    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
  });

  it("rejects stale or mismatched drafts", () => {
    vi.setSystemTime(new Date("2026-05-05T10:00:00.000Z"));
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    expect(readAnonymousPlannerDraft("cfg-1", {
      spaceId: "other-space",
      venueId: "venue-1",
    })).toBeNull();

    persistAnonymousPlannerDraft({
      configId: "cfg-2",
      spaceId: "space-1",
      venueId: "venue-1",
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    vi.setSystemTime(new Date("2026-06-06T10:00:00.000Z"));

    expect(readAnonymousPlannerDraft("cfg-2", {
      spaceId: "space-1",
      venueId: "venue-1",
    })).toBeNull();
  });
});
