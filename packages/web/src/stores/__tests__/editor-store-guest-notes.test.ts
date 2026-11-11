import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../../api/configurations.js";
import { editorToPlacedItem, placedItemToEditor } from "../../components/editor/EditorBridge.js";
import { persistAnonymousPlannerDraft, readAnonymousPlannerDraft } from "../../lib/anonymous-planner-draft.js";
import { noteHeldOn } from "../../lib/guest-plan-notes.js";
import { useAuthStore } from "../auth-store.js";
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
  useAuthStore.getState().setUser(null);
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

describe("a guest plan read without its notes, in a browser that is signed in", () => {
  // The planner opens a plan before the sign-in has resolved, so venue staff
  // read a guest plan through the public route like anyone with the link:
  // without its notes. The signed-in save stores a piece's details as sent,
  // so their first nudge of a chair would erase every note on the plan.
  //
  // The person here is one of the plan's own venue staff: the signed-in
  // routes answer nobody else for a guest plan (editor-store-preview-routes).
  beforeEach(() => {
    useAuthStore.getState().setUser({
      id: "user-staff", email: "staff@example.test", role: "staff", platformRole: "none", venueId: VENUE, name: "Staff",
    });
  });

  it("is never saved through the signed-in route, which would store its pieces without their notes", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().updateObject(B, { positionX: 3 });

    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { noteHeld: true }), placed(B, {}, 3)], revision: 5 });
    expect(await store().saveToServer(true)).toBe(true);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(saveSent(0).args).toBe(3);
  });

  it("is saved through the signed-in route once it has been read through it, notes and all", async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue(plan([placed(A, { notes: ALLERGY }), placed(B)], true));
    await store().loadConfiguration(PLAN, true);
    expect(store().notesIncluded).toBe(true);
    store().updateObject(B, { positionX: 3 });

    vi.mocked(configApi.authBatchSave).mockResolvedValue({ objects: [placed(A, { notes: ALLERGY }), placed(B, {}, 3)], revision: 5 });
    expect(await store().saveToServer(true)).toBe(true);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
    expect(vi.mocked(configApi.authBatchSave).mock.calls[0]?.[1].find((piece) => piece.id === A)?.metadata?.notes).toBe(ALLERGY);
  });

  it("takes the notes it never read when its kept work is restored over a signed-in read", async () => {
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "", 5)], baseObjects: [kept(A)], isDirty: true,
    });
    vi.mocked(configApi.getConfig).mockResolvedValue(plan([placed(A, { notes: ALLERGY })], true));
    await store().loadConfiguration(PLAN, true);
    expect(noteOn(A)).toBe(ALLERGY);

    // Restored work that did not say it was read with the notes goes through
    // the route that settles them, not the one that stores them as sent.
    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { notes: ALLERGY }, 5)], revision: 5 });
    expect(await store().saveToServer(true)).toBe(true);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(sentPiece(0, A).metadata?.notes).toBe(ALLERGY);
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

  it("keeps both notes when the kept copy wrote on a piece whose note it had never been shown", async () => {
    // A page that was shown the piece as bare wrote "TEST ONLY by the stage"
    // on it. The piece held a note all along. Restoring the copy must not put
    // the new words in place of words nobody on that page ever saw.
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "TEST ONLY by the stage")], baseObjects: [kept(A)], isDirty: true,
    });
    await open(plan([placed(A, { notes: ALLERGY })], true));
    expect(noteOn(A)).toBe(`${ALLERGY}\nTEST ONLY by the stage`);

    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(A, { notes: `${ALLERGY}\nTEST ONLY by the stage` })], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    // The save names the note it adds to, which this browser has now read.
    expect(sentPiece(0, A)).toMatchObject({ replacesNote: ALLERGY, metadata: { notes: `${ALLERGY}\nTEST ONLY by the stage` } });
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

  // A fresh read without the secret hides every note, the ones this browser
  // wrote included, so taking it as the new base forgot which notes the server
  // had confirmed here: the person's next words on their own note were then
  // refused, and the whole layout stopped saving.
  it("goes on writing its own note after choosing to keep its version over a newer one", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY VIP ta");
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({
      objects: [placed(A, { noteHeld: true }), placed(B, { notes: "TEST ONLY VIP ta" })], revision: 5,
    });
    expect(await store().saveToServer(false)).toBe(true);

    // The maker saves a move; this browser's next save meets the newer version.
    store().setObjectNotes(B, "TEST ONLY VIP table");
    vi.mocked(configApi.publicBatchSave).mockRejectedValueOnce(
      new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", { expectedRevision: 5, currentRevision: 6 }),
    );
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({
      ...plan([placed(A, { noteHeld: true }, 2), placed(B, { noteHeld: true })], false), revision: 6,
    });
    expect(await store().saveToServer(false)).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(6);

    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({
      objects: [placed(A, { noteHeld: true }), placed(B, { notes: "TEST ONLY VIP table" })], revision: 7,
    });
    expect(await store().keepMine(false)).toBe(true);
    expect(sentPiece(2, B)).toMatchObject({ replacesNote: "TEST ONLY VIP ta", metadata: { notes: "TEST ONLY VIP table" } });
    expect(noteOn(B)).toBe("TEST ONLY VIP table");
  });

  it("goes on writing, or takes off, its own note when work kept here is restored after a reload", async () => {
    // The copy's own base records the note the server had confirmed here.
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(B, "TEST ONLY VIP table")], baseObjects: [kept(B, "TEST ONLY VIP ta")], isDirty: true,
    });
    await open(plan([placed(B, { noteHeld: true })], false));
    expect(noteOn(B)).toBe("TEST ONLY VIP table");
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({ objects: [placed(B, { notes: "TEST ONLY VIP table" })], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(0, B)).toMatchObject({ replacesNote: "TEST ONLY VIP ta", metadata: { notes: "TEST ONLY VIP table" } });

    // Taking it off just before the page closed is restored as that, too.
    store().reset();
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(B)], baseObjects: [kept(B, "TEST ONLY VIP ta")], isDirty: true,
    });
    await open(plan([placed(B, { noteHeld: true })], false));
    expect(store().restoredFromDevice?.changes).toBe(1);
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({ objects: [placed(B)], revision: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(1, B).replacesNote).toBe("TEST ONLY VIP ta");
    expect(sentPiece(1, B).metadata?.notes).toBeUndefined();
  });

  it("marks nothing held in a plan read with its notes, or in a layout that is not a guest plan", async () => {
    await open(plan([placed(A, { notes: ALLERGY, noteHeld: true })], true));
    expect(noteHeldOn(store(), A)).toBe(false);

    useEditorStore.setState({ isPublicPreview: false, notesIncluded: false });
    expect(noteHeldOn(store(), A)).toBe(false);
  });

  it("keeps the mark through the scene's rebuild of the pieces, so a move is recorded as that move alone", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));

    // Whenever a piece changes, the scene bridge rebuilds every piece from
    // what is drawn. The undo history compares every field, so a mark dropped
    // there would be recorded as a change to a piece nobody touched.
    store().replaceObjectsFromScene(store().objects.map((object) => placedItemToEditor(
      { ...editorToPlacedItem(object), ...(object.id === B ? { x: 3 } : {}) },
      object,
    )));

    expect(store().history.past.at(-1)?.updated.map((patch) => patch.id)).toEqual([B]);
    expect(store().objects.find((object) => object.id === A)?.noteHeld).toBe(true);
    // The copy kept on this device carries it too, so restored work is not
    // recorded as taking the mark off either.
    expect(draftOnDevice()?.objects.find((object) => object.id === A)?.noteHeld).toBe(true);
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
