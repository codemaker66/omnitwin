import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorObject } from "../../stores/editor-store.js";
import {
  anonymousPlannerDraftKey,
  discardPlannerDraft,
  persistAnonymousPlannerDraft,
  plannerDraftBaseObjects,
  plannerDraftWithUnreadNotes,
  readAnonymousPlannerDraft,
  signedInPlannerDraftKey,
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
  clothed: true, clothStyle: "black", tableSetting: null, chairStyle: null, centerpiece: null,
  groupId: "group-1",
  label: "Top Table",
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
      configRevision: 1,
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    const draft = readAnonymousPlannerDraft("cfg-1", {
      spaceId: "space-1",
      venueId: "venue-1",
      baseRevision: 1,
    });

    expect(draft?.objects).toEqual([objectFixture]);
    expect(draft?.baseRevision).toBe(1);
    expect(draft?.hasUnsavedLocalChanges).toBe(true);
  });

  it("removes the draft once public-preview changes are clean", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      configRevision: 1,
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      configRevision: 1,
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
      configRevision: 1,
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
      configRevision: 1,
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    expect(readAnonymousPlannerDraft("cfg-1", {
      spaceId: "other-space",
      venueId: "venue-1",
      baseRevision: 1,
    })).toBeNull();

    persistAnonymousPlannerDraft({
      configId: "cfg-2",
      spaceId: "space-1",
      venueId: "venue-1",
      configRevision: 1,
      isPublicPreview: true,
      objects: [objectFixture],
      isDirty: true,
    });

    vi.setSystemTime(new Date("2026-06-06T10:00:00.000Z"));

    expect(readAnonymousPlannerDraft("cfg-2", {
      spaceId: "space-1",
      venueId: "venue-1",
      baseRevision: 1,
    })).toBeNull();
  });

  it("rejects a draft from an older server revision that cannot say what it was based on", () => {
    // The shape written before drafts carried their base: nothing to diff
    // the newer server copy against, so it cannot meet the conflict honestly.
    localStorage.setItem(anonymousPlannerDraftKey("cfg-1"), JSON.stringify({
      version: 1, configId: "cfg-1", spaceId: "space-1", venueId: "venue-1", baseRevision: 1,
      updatedAtMs: Date.now(), hasUnsavedLocalChanges: true, objects: [objectFixture],
    }));

    expect(readAnonymousPlannerDraft("cfg-1", {
      spaceId: "space-1",
      venueId: "venue-1",
      baseRevision: 2,
    })).toBeNull();
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
  });

  it("keeps a draft from an older server revision that carries its base, to meet the conflict", () => {
    const base = [serverTable("t1", 1), serverTable("t2", 2), serverTable("t3", 3)];
    const mine = [serverTable("t1", 1), serverTable("t2", 20), { ...objectFixture, id: "local-9" }];
    persistAnonymousPlannerDraft({ ...signedIn, objects: mine, baseObjects: base, isDirty: true });

    const draft = readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 5, ownerUserId: "user-a" });
    expect(draft?.baseRevision).toBe(1);
    expect(draft?.objects).toEqual(mine);
    // The base comes back exactly: t2 as the server had it, t3 (deleted here)
    // restored, the new local placement absent.
    const rebuilt = draft === null ? null : plannerDraftBaseObjects(draft);
    expect(rebuilt === null ? null : [...rebuilt].sort((a, b) => a.id.localeCompare(b.id))).toEqual(base);
    // Only what differs is stored for the base, never a second whole layout.
    expect(draft?.base?.changed.map((object) => object.id).sort()).toEqual(["t2", "t3"]);
    expect(draft?.base?.addedIds).toEqual(["local-9"]);
  });
});

const signedIn = {
  configId: "cfg-1",
  spaceId: "space-1",
  venueId: "venue-1",
  configRevision: 1,
  isPublicPreview: false,
  ownerUserId: "user-a",
} as const;

function serverTable(id: string, positionX: number): EditorObject {
  return { ...objectFixture, id, positionX, label: `Table ${id}` };
}

describe("signed-in layouts kept on this device", () => {
  it("stores a signed-in person's unsaved layout under their own key and says so", () => {
    expect(persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true })).toBe(true);
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).not.toBeNull();
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
    expect(readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1, ownerUserId: "user-a" })?.objects)
      .toEqual([objectFixture]);
  });

  it("never hands one person's draft to another person or to a guest", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true });
    expect(readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1, ownerUserId: "user-b" })).toBeNull();
    expect(readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1 })).toBeNull();
    // A copied value under someone else's key is refused and removed.
    localStorage.setItem(signedInPlannerDraftKey("user-b", "cfg-1"), localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1")) ?? "");
    expect(readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1, ownerUserId: "user-b" })).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-b", "cfg-1"))).toBeNull();
  });

  it("removes the stored copy once the work is saved, and reports nothing kept", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true });
    expect(persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: false })).toBe(false);
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).toBeNull();
  });

  it("reports nothing kept when the browser refuses the write", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      expect(persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it("does not keep a layout over the size cap, and drops an older copy that would restore less", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true });
    const huge = Array.from({ length: 1_001 }, (_, index) => ({ ...objectFixture, id: `local-${String(index)}` }));
    expect(persistAnonymousPlannerDraft({ ...signedIn, objects: huge, isDirty: true })).toBe(false);
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).toBeNull();
  });

  it("drops the guest copy once the layout is claimed", () => {
    persistAnonymousPlannerDraft({ ...signedIn, isPublicPreview: true, ownerUserId: null, objects: [objectFixture], isDirty: true });
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).not.toBeNull();
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true });
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).not.toBeNull();
  });

  it("lets a signed-in person's copy of a guest preview take over from the guest copy", () => {
    persistAnonymousPlannerDraft({ ...signedIn, isPublicPreview: true, ownerUserId: null, objects: [objectFixture], isDirty: true });
    persistAnonymousPlannerDraft({ ...signedIn, isPublicPreview: true, objects: [objectFixture], isDirty: true });
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).not.toBeNull();
  });

  it("discards every copy of a layout's work on this device when asked", () => {
    persistAnonymousPlannerDraft({ ...signedIn, isPublicPreview: true, objects: [objectFixture], isDirty: true });
    persistAnonymousPlannerDraft({ ...signedIn, isPublicPreview: true, ownerUserId: null, objects: [objectFixture], isDirty: true });
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).not.toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).not.toBeNull();
    discardPlannerDraft("cfg-1", "user-a");
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
    expect(localStorage.getItem(signedInPlannerDraftKey("user-a", "cfg-1"))).toBeNull();
  });
});

describe("tabs share the key: each draft names the page that wrote it", () => {
  const key = signedInPlannerDraftKey("user-a", "cfg-1");

  it("records the writer and reads it back", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true, writerPageId: "page-a" });
    expect(readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1, ownerUserId: "user-a" })?.writerPageId)
      .toBe("page-a");
  });

  it("never lets a page with nothing unsaved remove another page's work", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true, writerPageId: "page-a" });
    persistAnonymousPlannerDraft({ ...signedIn, objects: [], isDirty: false, writerPageId: "page-b" });
    expect(localStorage.getItem(key)).not.toBeNull();
    // Its own copy it removes as before.
    persistAnonymousPlannerDraft({ ...signedIn, objects: [], isDirty: false, writerPageId: "page-a" });
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("lets the last page with unsaved work hold the device copy", () => {
    persistAnonymousPlannerDraft({ ...signedIn, objects: [objectFixture], isDirty: true, writerPageId: "page-a" });
    persistAnonymousPlannerDraft({ ...signedIn, objects: [{ ...objectFixture, positionX: 9 }], isDirty: true, writerPageId: "page-b" });
    const draft = readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 1, ownerUserId: "user-a" });
    expect(draft?.writerPageId).toBe("page-b");
    expect(draft?.objects[0]?.positionX).toBe(9);
  });
});

describe("anonymous planner draft persistence (continued)", () => {
  it("rejects and removes a draft with a non-positive furniture scale", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1",
      spaceId: "space-1",
      venueId: "venue-1",
      configRevision: 1,
      isPublicPreview: true,
      objects: [{ ...objectFixture, scale: 0 }],
      isDirty: true,
    });

    expect(readAnonymousPlannerDraft("cfg-1", {
      spaceId: "space-1",
      venueId: "venue-1",
      baseRevision: 1,
    })).toBeNull();
    expect(localStorage.getItem(anonymousPlannerDraftKey("cfg-1"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A guest plan's notes go only to the browser that made the plan, so the same
// plan at the same revision is read two ways: with its notes, or without. A
// draft kept from a read without them holds pieces with no note, and restoring
// that over a read with them would clear every note (review of #375, major 1).
// So a draft says whether it was read with the notes, and one that was not
// takes the notes it never read from the server's copy.
// ---------------------------------------------------------------------------

describe("a draft and the plan's notes", () => {
  const HELD = "TEST ONLY nut allergy, seat by the door";
  const A = "11111111-1111-4111-8111-11111111111a";
  const B = "11111111-1111-4111-8111-11111111111b";
  const C = "11111111-1111-4111-8111-11111111111c";

  function piece(id: string, notes: string, positionX = 1): EditorObject {
    return { ...objectFixture, id, notes, positionX };
  }

  function keep(objects: readonly EditorObject[], baseObjects: readonly EditorObject[], notesIncluded?: boolean): void {
    persistAnonymousPlannerDraft({
      configId: "cfg-1", spaceId: "space-1", venueId: "venue-1", configRevision: 4, isPublicPreview: true,
      objects, baseObjects, isDirty: true, ...(notesIncluded === undefined ? {} : { notesIncluded }),
    });
  }

  function kept(): NonNullable<ReturnType<typeof readAnonymousPlannerDraft>> {
    const draft = readAnonymousPlannerDraft("cfg-1", { spaceId: "space-1", venueId: "venue-1", baseRevision: 4 });
    if (draft === null) throw new Error("No draft kept");
    return draft;
  }

  function notesOf(objects: readonly EditorObject[]): Record<string, string> {
    return Object.fromEntries(objects.map((object) => [object.id, object.notes]));
  }

  it("records that the plan was read with its notes, and a draft that does not say was not", () => {
    keep([piece(A, HELD, 5)], [piece(A, HELD)], true);
    expect(kept().notesIncluded).toBe(true);

    keep([piece(A, "", 5)], [piece(A, "")], false);
    expect(kept().notesIncluded).not.toBe(true);

    // A page from before drafts said so, or one that was never told.
    keep([piece(A, "", 5)], [piece(A, "")]);
    expect(kept().notesIncluded).not.toBe(true);
  });

  it("takes each note it never read from the server's copy: the pieces it moved, the ones it left, and its own base", () => {
    // Read without notes: A (moved since) and B (left alone) came without
    // theirs, each marked as holding one.
    const marked = (object: EditorObject): EditorObject => ({ ...object, noteHeld: true });
    keep([marked(piece(A, "", 5)), marked(piece(B, ""))], [marked(piece(A, "")), marked(piece(B, ""))]);
    expect(kept().objects.map((object) => object.noteHeld)).toEqual([true, true]);
    const restored = plannerDraftWithUnreadNotes(kept(), [piece(A, HELD), piece(B, "TEST ONLY top table")]);

    expect(notesOf(restored.objects)).toEqual({ [A]: HELD, [B]: "TEST ONLY top table" });
    // Shown their notes now, the pieces are no longer marked as holding one unseen.
    expect(restored.objects.some((object) => "noteHeld" in object)).toBe(false);
    expect((plannerDraftBaseObjects(restored) ?? []).some((object) => "noteHeld" in object)).toBe(false);
    // The move is still the draft's.
    expect(restored.objects.find((object) => object.id === A)?.positionX).toBe(5);
    // Its base holds the notes too, so the restore counts one moved piece, not two cleared notes.
    expect(notesOf(plannerDraftBaseObjects(restored) ?? [])).toEqual({ [A]: HELD, [B]: "TEST ONLY top table" });
  });

  it("keeps a note the draft wrote on a bare piece, and every note of a draft whose base held them", () => {
    // Read without notes; the person wrote on C, which the server has bare.
    keep([piece(A, ""), piece(C, "TEST ONLY typed here")], [piece(A, ""), piece(C, "")]);
    const added = plannerDraftWithUnreadNotes(kept(), [piece(A, HELD), piece(C, "")]);
    expect(notesOf(added.objects)).toEqual({ [A]: HELD, [C]: "TEST ONLY typed here" });

    // A draft whose base held the notes read them: a note it changed stays
    // changed, and one it cleared stays cleared.
    keep([piece(A, "TEST ONLY corrected"), piece(B, "")], [piece(A, HELD), piece(B, "TEST ONLY top table")]);
    const informed = plannerDraftWithUnreadNotes(kept(), [piece(A, HELD), piece(B, "TEST ONLY top table")]);
    expect(notesOf(informed.objects)).toEqual({ [A]: "TEST ONLY corrected", [B]: "" });
  });

  it("keeps both notes when it wrote on a piece whose note it had never read, the stored one first", () => {
    // Shown A as bare, the page wrote on it; A held a note all along. Neither
    // is put in place of the other, as Replace keeps both when it carries a
    // note to a table that has one.
    keep([piece(A, "TEST ONLY typed here")], [piece(A, "")]);
    const restored = plannerDraftWithUnreadNotes(kept(), [piece(A, HELD)]);
    expect(notesOf(restored.objects)).toEqual({ [A]: `${HELD}\nTEST ONLY typed here` });
    expect(notesOf(plannerDraftBaseObjects(restored) ?? [])).toEqual({ [A]: HELD });

    // Having written exactly the stored note (a save that landed unheard) is no second note.
    keep([piece(A, HELD, 5)], [piece(A, "")]);
    expect(notesOf(plannerDraftWithUnreadNotes(kept(), [piece(A, HELD)]).objects)).toEqual({ [A]: HELD });
  });

  it("without a base to say what it read, takes the server's note wherever it holds none", () => {
    persistAnonymousPlannerDraft({
      configId: "cfg-1", spaceId: "space-1", venueId: "venue-1", configRevision: 4, isPublicPreview: true,
      objects: [piece(A, "", 5), piece(C, "TEST ONLY typed here")], isDirty: true,
    });
    const draft = kept();
    expect(draft.base).toBeUndefined();
    expect(notesOf(plannerDraftWithUnreadNotes(draft, [piece(A, HELD), piece(C, "")]).objects))
      .toEqual({ [A]: HELD, [C]: "TEST ONLY typed here" });
  });
});
