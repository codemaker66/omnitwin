import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../../api/configurations.js";
import { persistAnonymousPlannerDraft, readAnonymousPlannerDraft } from "../../lib/anonymous-planner-draft.js";
import { noteHeldOn } from "../../lib/guest-plan-notes.js";
import { useEditorStore, type EditorObject } from "../editor-store.js";
import { useSelectionStore } from "../selection-store.js";

// ---------------------------------------------------------------------------
// A guest plan's notes, in the planner (review of #375).
//
// The API gives a guest plan's notes only to the browser that made the plan,
// so one plan is read two ways: with its notes, or without. Which browser is
// saving says nothing about which of those the copy being saved came from.
// The read's own word therefore stays with the document: on the loaded plan,
// in the copy kept on this device, and in what a save declares.
//
//   1. A copy kept by a page that read the plan without its notes, restored
//      where the plan is read with them, clears none of them.
//   2. A save declares its notes complete only for a plan read with them.
//   3. In a browser that is not shown the notes, a note the person types is
//      still on screen after its save, they can go on writing it, and a piece
//      that holds a note they cannot see says so.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", () => ({
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
  updatePublicThumbnail: vi.fn(),
  claimConfig: vi.fn(),
  patchConfigMetadata: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const configApi = await import("../../api/configurations.js");

const PLAN = "0f0f0f0f-0000-4000-8000-000000000001";
const SPACE = "0f0f0f0f-0000-4000-8000-00000000005a";
const VENUE = "0f0f0f0f-0000-4000-8000-0000000000fe";
const A = "0a0a0a0a-0000-4000-8000-00000000000a";
const B = "0a0a0a0a-0000-4000-8000-00000000000b";
const CHAIR = "banquet-chair";
const ALLERGY = "TEST ONLY nut allergy, seat by the door";

function store(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState();
}

/** A piece as the API returns it, standing at `x`. */
function placed(id: string, metadata: ObjectMetadata = {}, x = 0): PlacedObject {
  return {
    id, configurationId: PLAN, assetDefinitionId: CHAIR,
    positionX: x.toFixed(3), positionY: "0.000", positionZ: "0.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0,
    metadata: { clothed: false, groupId: null, ...metadata },
  };
}

/** The same piece as a page keeps it on the device. */
function kept(id: string, notes = "", x = 0): EditorObject {
  return {
    id, assetDefinitionId: CHAIR, positionX: x, positionY: 0, positionZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null, notes,
  };
}

function plan(objects: readonly PlacedObject[], notesIncluded?: boolean): Configuration {
  return {
    id: PLAN, spaceId: SPACE, venueId: VENUE, userId: null, name: "TEST ONLY plan", isPublicPreview: true, revision: 4,
    objects: [...objects], ...(notesIncluded === undefined ? {} : { notesIncluded }),
  };
}

async function open(read: Configuration): Promise<void> {
  vi.mocked(configApi.getPublicConfig).mockResolvedValue(read);
  await store().loadConfiguration(PLAN, false);
  expect(store().error).toBeNull();
}

function noteOn(id: string): string | undefined {
  return store().objects.find((object) => object.id === id)?.notes;
}

/** The batch of the nth save, and what that save declared. */
function saveSent(n: number): { readonly batch: readonly BatchObjectInput[]; readonly declared: unknown; readonly args: number } {
  const call = vi.mocked(configApi.publicBatchSave).mock.calls[n];
  if (call === undefined) throw new Error(`No save number ${String(n)}`);
  return { batch: call[1], declared: call[3], args: call.length };
}

function sentPiece(n: number, id: string): BatchObjectInput {
  const piece = saveSent(n).batch.find((candidate) => candidate.id === id);
  if (piece === undefined) throw new Error(`Save ${String(n)} did not send ${id}`);
  return piece;
}

function draftOnDevice(): ReturnType<typeof readAnonymousPlannerDraft> {
  return readAnonymousPlannerDraft(PLAN, { spaceId: SPACE, venueId: VENUE, baseRevision: store().configRevision ?? 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  store().reset();
  useSelectionStore.getState().clearSelection();
});

describe("the loaded plan keeps the read's word on its notes", () => {
  it("is read with its notes only when the read says so", async () => {
    await open(plan([placed(A, { notes: ALLERGY })], true));
    expect(store().notesIncluded).toBe(true);

    await open(plan([placed(A, { noteHeld: true })], false));
    expect(store().notesIncluded).toBe(false);

    // An API from before this change says nothing.
    await open(plan([placed(A)]));
    expect(store().notesIncluded).toBe(false);

    await open(plan([placed(A, { notes: ALLERGY })], true));
    store().reset();
    expect(store().notesIncluded).toBe(false);
  });

  it("starts a plan made here with all of its notes, as its creating answer says", async () => {
    vi.mocked(configApi.createPublicConfig).mockResolvedValue({ ...plan([], true), claimSecret: "made-here-secret-0123456789abcdefghijklmnop" });
    await store().createPublicConfig(SPACE);
    expect(store().notesIncluded).toBe(true);

    vi.mocked(configApi.createPublicConfig).mockResolvedValue({ ...plan([]), id: "0f0f0f0f-0000-4000-8000-000000000002" });
    await store().createPublicConfig(SPACE);
    expect(store().notesIncluded).toBe(false);
  });
});

describe("a save says its notes are complete only for a plan read with them", () => {
  it("declares it for a plan read with its notes, and keeps that word in the copy on this device", async () => {
    await open(plan([placed(A, { notes: ALLERGY })], true));
    store().setObjectNotes(A, "TEST ONLY corrected");
    expect(draftOnDevice()?.notesIncluded).toBe(true);

    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { notes: "TEST ONLY corrected" })], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(saveSent(0).declared).toEqual({ notesIncluded: true });
    expect(sentPiece(0, A).metadata?.notes).toBe("TEST ONLY corrected");
  });

  it("declares nothing for a plan opened from a link, and its device copy does not say it was read with notes", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().updateObject(B, { positionX: 3 });
    expect(draftOnDevice()).not.toBeNull();
    expect(draftOnDevice()?.notesIncluded).not.toBe(true);

    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { noteHeld: true }), placed(B, {}, 3)], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    // Exactly the three arguments a save always had: no declaration.
    expect(saveSent(0).args).toBe(3);
  });
});

describe("work kept on this device, restored where the plan is read with its notes", () => {
  it("clears no note when the page that kept it had read the plan without them", async () => {
    // A page that read the plan without its notes (a tab from before the API
    // kept them back, or any read without the plan's secret) moved a chair and
    // kept that here. Its pieces hold no note, because it was shown none.
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "", 5), kept(B)], baseObjects: [kept(A), kept(B)], isDirty: true,
    });

    // The maker's browser opens the plan and is given its notes.
    await open(plan([placed(A, { notes: ALLERGY }), placed(B)], true));

    // The move is restored; the note it never saw is still on its piece.
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(5);
    expect(noteOn(A)).toBe(ALLERGY);
    expect(store().restoredFromDevice?.changes).toBe(1);
    expect(store().isDirty).toBe(true);
    // A copy that did not say it was read with the notes is not the whole
    // truth about them, whatever the browser restoring it holds.
    expect(store().notesIncluded).toBe(false);

    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { notes: ALLERGY }, 5), placed(B)], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(0, A).metadata?.notes).toBe(ALLERGY);
    expect(saveSent(0).args).toBe(3);
    expect(saveSent(0).batch.every((piece) => piece.replacesNote === undefined)).toBe(true);
    expect(noteOn(A)).toBe(ALLERGY);
  });

  it("stays the whole truth when the copy itself was read with the notes", async () => {
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "", 5)], baseObjects: [kept(A, ALLERGY)], isDirty: true, notesIncluded: true,
    });
    await open(plan([placed(A, { notes: ALLERGY })], true));

    // The maker cleared the note, having read it: it stays cleared.
    expect(noteOn(A)).toBe("");
    expect(store().notesIncluded).toBe(true);
    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, {}, 5)], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(saveSent(0).declared).toEqual({ notesIncluded: true });
    expect(sentPiece(0, A).metadata?.notes).toBeUndefined();
  });

  it("is not taken as read with the notes when this read was not, whatever the copy says", async () => {
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, ALLERGY, 5)], baseObjects: [kept(A, ALLERGY)], isDirty: true, notesIncluded: true,
    });
    await open(plan([placed(A, { noteHeld: true })], false));
    expect(store().notesIncluded).toBe(false);
  });
});

describe("a browser that is not shown the plan's notes", () => {
  it("keeps a note the person types on screen after its save, lets them go on writing it, and marks the piece that holds one", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    expect(noteHeldOn(store(), A)).toBe(true);
    expect(noteHeldOn(store(), B)).toBe(false);

    // The planner saves three seconds after a pause, so the note is stored
    // half-typed. The answer returns it, as this save sent it.
    store().setObjectNotes(B, "TEST ONLY VIP ta");
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({
      objects: [placed(A, { noteHeld: true }), placed(B, { notes: "TEST ONLY VIP ta" })], revision: 5,
    });
    expect(await store().saveToServer(false)).toBe(true);
    expect(noteOn(B)).toBe("TEST ONLY VIP ta");
    expect(store().isDirty).toBe(false);
    expect(noteHeldOn(store(), A)).toBe(true);
    expect(noteHeldOn(store(), B)).toBe(false);
    // Nothing was confirmed to this browser yet, so the first save names no note.
    expect(saveSent(0).batch.every((piece) => piece.replacesNote === undefined)).toBe(true);

    // Going on: the save names the note it replaces, which the server
    // confirmed to this browser, so the API takes the new one.
    store().setObjectNotes(B, "TEST ONLY VIP table by the door");
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({
      objects: [placed(A, { noteHeld: true }), placed(B, { notes: "TEST ONLY VIP table by the door" })], revision: 6,
    });
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(1, B)).toMatchObject({ replacesNote: "TEST ONLY VIP ta", metadata: { notes: "TEST ONLY VIP table by the door" } });
    expect(sentPiece(1, A).replacesNote).toBeUndefined();
    expect(noteOn(B)).toBe("TEST ONLY VIP table by the door");

    // And taking it off again names it too: a piece sent with no note and no
    // name is how a browser sends a piece whose note it never saw.
    store().setObjectNotes(B, "");
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({ objects: [placed(A, { noteHeld: true }), placed(B)], revision: 7 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(2, B).replacesNote).toBe("TEST ONLY VIP table by the door");
    expect(sentPiece(2, B).metadata?.notes).toBeUndefined();
    // Never a declaration: this browser was not shown the plan's notes.
    expect([saveSent(0).args, saveSent(1).args, saveSent(2).args]).toEqual([3, 3, 3]);
  });

  it("marks nothing held in a plan read with its notes, or in a layout that is not a guest plan", async () => {
    await open(plan([placed(A, { notes: ALLERGY, noteHeld: true })], true));
    expect(noteHeldOn(store(), A)).toBe(false);

    useEditorStore.setState({ isPublicPreview: false, notesIncluded: false });
    expect(noteHeldOn(store(), A)).toBe(false);
  });

  it("shows the person their own note on a piece the server says holds one, so they can take it off", async () => {
    // Work kept here wrote on a piece that, as now read, holds a note this
    // browser is not shown: the save will be refused until theirs comes off.
    await open(plan([placed(A, { noteHeld: true })], false));
    store().setObjectNotes(A, "TEST ONLY typed over");
    expect(noteHeldOn(store(), A)).toBe(false);
    store().setObjectNotes(A, "");
    expect(noteHeldOn(store(), A)).toBe(true);
  });
});
