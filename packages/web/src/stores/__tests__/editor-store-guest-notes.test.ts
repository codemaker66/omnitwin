import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../../api/configurations.js";
import { editorToPlacedItem, flushAutoSave, placedItemToEditor } from "../../components/editor/EditorBridge.js";
import { prepareLayoutForGuestEnquiry } from "../../components/editor/send-layout-flow.js";
import { persistAnonymousPlannerDraft, readAnonymousPlannerDraft } from "../../lib/anonymous-planner-draft.js";
import { deriveEditorSaveStatus, leftBehindWords, slateSaveState, type EditorSaveStatus, type SlateSaveKind } from "../../lib/editor-save-status.js";
import { heldNoteIds, noteHeldOn, ownWordsOverHeldNotes, pieceNamedForRefusedSave, refusedOverHeldNote } from "../../lib/guest-plan-notes.js";
import { NOTE_HELD_MESSAGE, OMITTED_MESSAGE, serveNotesAsTheApiDoes as serveTheApi, type PlanOnServer } from "../../test/guest-plan-api.js";
import { useAuthStore } from "../auth-store.js";
import { saveBeforeLayoutChange, setEditorAutosaveRequester, useEditorStore, type EditorObject } from "../editor-store.js";
import { usePlacementNoticeStore } from "../placement-notice-store.js";
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

/**
 * What the planner says of saving, from the store as it stands: the status
 * every surface but the slate derives (header, toolbox, phone bar, 2D view),
 * and the slate's kind as signed-in staff see it (a guest's slate says Draft
 * whatever happens). Ruling R1(b) on #388: neither says saved while a refused
 * clear's notice stands (delta review at 33a8e0ad, T3 and S4).
 */
function saveStatusesNow(): { readonly status: EditorSaveStatus; readonly slate: SlateSaveKind } {
  const s = store();
  const refusedForHeldNote = refusedOverHeldNote(s.saveErrorCode) && s.saveConflict === null;
  return {
    status: deriveEditorSaveStatus({ ...s, refusedForHeldNote }),
    slate: slateSaveState({
      hasLayout: s.configId !== null, guest: false, isSaving: s.isSaving, isDirty: s.isDirty,
      pendingChanges: s.pendingChanges, savingChanges: s.savingChanges, isOnline: s.isOnline, keptOnDevice: s.keptOnDevice,
      saveError: s.saveError, refusedForHeldNote, refusedClear: s.noteClearsRefused.length > 0,
      conflict: null, lockReason: s.lockReason, lastSavedAt: s.lastSavedAt,
    }).kind,
  };
}

/** A refused clear's notice stands: said, nothing left unsaved, and nothing says saved. Then the person dismisses it, and both say saved. */
function refusedClearStandsUntilDismissed(sentence: string | RegExp, cleared: readonly string[]): void {
  expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", isDirty: false, noteClearsRefused: cleared });
  if (typeof sentence === "string") expect(store().saveError).toBe(sentence);
  else expect(store().saveError).toMatch(sentence);
  expect(store().lastSavedAt).not.toBeNull();
  expect(saveStatusesNow()).toEqual({ status: "unsaved", slate: "not-saved" });
  store().dismissRefusedClears();
  expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, noteClearsRefused: [] });
  expect(saveStatusesNow()).toEqual({ status: "saved", slate: "saved" });
}

function draftOnDevice(): ReturnType<typeof readAnonymousPlannerDraft> {
  return readAnonymousPlannerDraft(PLAN, { spaceId: SPACE, venueId: VENUE, baseRevision: store().configRevision ?? 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  store().reset();
  useSelectionStore.getState().clearSelection();
  usePlacementNoticeStore.getState().dismiss();
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

// ---------------------------------------------------------------------------
// A save refused for a held note (409 NOTE_HELD), and "Keep mine" (review of
// #388). "Keep mine" carries the notes the server confirmed to this browser
// onto the newer version it keeps its work over, so the person can go on with
// theirs. The newer version may hold other words on such a piece (the maker
// rewrote the note), and it hides them. Every save then named, or resent, a
// note the piece no longer held, and each was refused whole: nothing the
// person could do saved the layout again.
//
// The network here is the API's own rule for a browser it does not show the
// notes to (packages/api routes/public-configs.ts in #389: settledNotes, and
// withoutUnsentNotes for the answer), over the notes `stored` holds.
// ---------------------------------------------------------------------------

/** The API of #389 as a browser without the plan's secret meets it (src/test/guest-plan-api.ts), over this file's pieces. */
function serveNotesAsTheApiDoes(server: PlanOnServer): void {
  serveTheApi(server, placed);
}

/** How many saves have been sent. */
function savesSent(): number {
  return vi.mocked(configApi.publicBatchSave).mock.calls.length;
}

describe("a save refused for a held note, after keeping this version over a newer one", () => {
  const MINE = "TEST ONLY by the window";
  const THEIRS = "TEST ONLY nut allergy, table by the door";

  /**
   * This browser, shown no notes, writes MINE on B and the server confirms it.
   * The maker then rewrites B's note, and this browser's next save meets that
   * newer version, which says only that B holds a note.
   */
  async function meetTheirRewrite(server: PlanOnServer, before: () => void): Promise<void> {
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(B)).toBe(MINE);

    server.notes.set(B, THEIRS);
    server.revision += 1;
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({ ...plan([placed(A), placed(B, { noteHeld: true })], false), revision: server.revision });
    before();
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(server.revision);
  }

  it("saves, taking this browser's out-of-date copy of the note off the piece: nothing is left for the person to clear", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await meetTheirRewrite(server, () => undefined);
    const sentBefore = savesSent();

    // Their version holds other words on B. The save that sent this browser's copy is refused; the next leaves B's note alone.
    expect(await store().keepMine(false)).toBe(true);
    expect(savesSent()).toBe(sentBefore + 2);
    expect(sentPiece(sentBefore, B).metadata?.notes).toBe(MINE);
    expect(sentPiece(sentBefore + 1, B).metadata?.notes).toBeUndefined();
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, saveConflict: null, isDirty: false, configRevision: server.revision });
    // Their note is as they wrote it; the move this browser kept is saved; B says only that it holds a note.
    expect(server.notes.get(B)).toBe(THEIRS);
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
    expect(noteOn(B)).toBe("");
    expect(noteHeldOn(store(), B)).toBe(true);
  });

  it("keeps words the person had put in that note's place on the piece, the one piece the refusal can name", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await meetTheirRewrite(server, () => { store().setObjectNotes(B, `${MINE}, please`); });

    // The rest of their version is saved. Their words for B are not, and the API's refusal is shown for them at once.
    expect(await store().keepMine(false)).toBe(false);
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE, saveConflict: null, isDirty: true, configRevision: server.revision });
    expect(server.notes.get(B)).toBe(THEIRS);
    expect(noteOn(B)).toBe(`${MINE}, please`);
    expect(noteHeldOn(store(), B)).toBe(false);
    expect(ownWordsOverHeldNotes(store()).map((object) => object.id)).toEqual([B]);

    // A reload is no way back into the trap: the work kept on this device is
    // restored onto the same truth, their words over a note the piece holds.
    expect(draftOnDevice()?.base?.changed.find((object) => object.id === B)).toMatchObject({ notes: "", noteHeld: true });
    store().reset();
    await open({ ...plan([placed(A), placed(B, { noteHeld: true })], false), revision: server.revision });
    expect(noteOn(B)).toBe(`${MINE}, please`);
    expect(ownWordsOverHeldNotes(store()).map((object) => object.id)).toEqual([B]);
    store().setObjectNotes(B, "");
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(B)).toBe(THEIRS);
  });

  it("refuses the person's clear of their note once the maker has rewritten it: the rest is saved, the clear is not said to be", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await meetTheirRewrite(server, () => { store().setObjectNotes(B, ""); });
    const sentBefore = savesSent();

    // The note they cleared is not the one B holds now: that clear was not made (delta review at 713dc3f1, R1).
    expect(await store().keepMine(false)).toBe(false);
    // One save named the note this browser last knew and was refused; the next sent the piece as one whose note it never saw.
    expect(savesSent()).toBe(sentBefore + 2);
    expect(sentPiece(sentBefore, B).replacesNote).toBe(MINE);
    expect(sentPiece(sentBefore + 1, B).replacesNote).toBeUndefined();
    expect(sentPiece(sentBefore + 1, B).metadata?.notes).toBeUndefined();
    // Refused, and nothing left unsaved: B is as the server has it, holding the note it is shown to hold (ruling R1(b)).
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveConflict: null, isDirty: false, noteClearsRefused: [B] });
    // Said in its own sentence, which names the piece (ruling C3), not in the API's, which would ask them to clear it.
    expect(store().saveError).toMatch(/^A .+'s note was not removed: it was changed somewhere else, and that note cannot be shown here\.$/u);
    expect(pieceNamedForRefusedSave(store())).toBeNull();
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
    expect(server.notes.get(B)).toBe(THEIRS);
    expect(noteHeldOn(store(), B)).toBe(true);

    // The notice stands through the next save that lands; nothing says saved until the person dismisses it.
    expect(saveStatusesNow()).toEqual({ status: "unsaved", slate: "not-saved" });
    store().updateObject(A, { positionX: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    refusedClearStandsUntilDismissed(/^A .+'s note was not removed: it was changed somewhere else, and that note cannot be shown here\.$/u, [B]);
    expect(server.notes.get(B)).toBe(THEIRS);
  });

  it("goes on with a note nobody else touched, in one save", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);

    // The maker moves a chair: a newer version, B's note untouched.
    server.revision += 1;
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({ ...plan([placed(A, {}, 2), placed(B, { noteHeld: true })], false), revision: server.revision });
    store().setObjectNotes(B, `${MINE}, please`);
    expect(await store().saveToServer(false)).toBe(false);
    const sentBefore = savesSent();

    expect(await store().keepMine(false)).toBe(true);
    expect(savesSent()).toBe(sentBefore + 1);
    expect(sentPiece(sentBefore, B)).toMatchObject({ replacesNote: MINE, metadata: { notes: `${MINE}, please` } });
    expect(server.notes.get(B)).toBe(`${MINE}, please`);
    expect(noteOn(B)).toBe(`${MINE}, please`);
  });
});

describe("a save refused for a held note the person wrote over", () => {
  it("keeps what this browser knows of its other notes, and does not send the save again", async () => {
    // A holds a note this browser is not shown. Work kept here wrote on A; B's note is this browser's own.
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY VIP ta");
    expect(await store().saveToServer(false)).toBe(true);

    store().setObjectNotes(A, "TEST ONLY typed over");
    store().setObjectNotes(B, "TEST ONLY VIP table");
    const sentBefore = savesSent();
    expect(await store().saveToServer(false)).toBe(false);
    expect(savesSent()).toBe(sentBefore + 1);
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE, isDirty: true });
    expect(ownWordsOverHeldNotes(store()).map((object) => object.id)).toEqual([A]);
    expect(store().baseObjects.find((object) => object.id === B)?.notes).toBe("TEST ONLY VIP ta");

    // Their words come off A; B's change still names the note it replaces.
    store().setObjectNotes(A, "");
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(sentBefore + 1, B)).toMatchObject({ replacesNote: "TEST ONLY VIP ta", metadata: { notes: "TEST ONLY VIP table" } });
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(server.notes.get(B)).toBe("TEST ONLY VIP table");
  });
});

// ---------------------------------------------------------------------------
// The release lead's final review of #388 and the rulings after it (R-A to
// R-E; findings F2 to F5, R2, R3, R6). The API does not refuse a save that
// leaves out a piece holding a note, so someone who cannot see a note never
// destroys it by any path a document takes to its save: the save takes such a
// piece back before it goes, and each path that could have dropped one refuses
// or keeps it in its own words.
// ---------------------------------------------------------------------------

const C = "0a0a0a0a-0000-4000-8000-00000000000c";
const D = "0a0a0a0a-0000-4000-8000-00000000000d";
const THEIR_NOTE = "TEST ONLY nut allergy, table by the door";

function notice(): string | null {
  return usePlacementNoticeStore.getState().notice?.text ?? null;
}

function pieceIds(): readonly string[] {
  return store().objects.map((object) => object.id);
}

/** The newer version as any browser without the plan's secret reads it. */
function theyNowHave(server: PlanOnServer, pieces: readonly PlacedObject[]): void {
  server.revision += 1;
  vi.mocked(configApi.getPublicConfig).mockResolvedValue({ ...plan(pieces, false), revision: server.revision });
}

describe("a save of a document that has lost a piece holding a note this browser is not shown", () => {
  it("takes the piece back as the server sent it, says it stayed, and only then is sent", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true, displayLabel: "Table 3" }, 5), placed(B)], false));
    // The scene's funnel into the document: no guard of the planner's stands on this writer.
    store().replaceObjectsFromScene(store().objects.filter((object) => object.id !== A));

    expect(await store().saveToServer(false)).toBe(true);
    expect(notice()).toBe("Table 3 stayed where it is, because it has a note that cannot be shown here.");
    // The one save that went carried the piece: its row, where it stood, and no word about its note.
    expect(savesSent()).toBe(1);
    expect(sentPiece(0, A).positionX).toBeCloseTo(5, 3);
    expect(sentPiece(0, A).metadata).toMatchObject({ displayLabel: "Table 3" });
    expect(sentPiece(0, A).metadata?.notes).toBeUndefined();
    expect(sentPiece(0, A).replacesNote).toBeUndefined();
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(noteHeldOn(store(), A)).toBe(true);
    // No step of the timeline takes it away again, or returns it a second time.
    store().undo();
    expect(pieceIds().filter((id) => id === A)).toHaveLength(1);
    store().redo();
    expect(pieceIds().filter((id) => id === A)).toHaveLength(1);
  });

  it("takes back the rest of its group with it, as a table keeps its chairs, and names several in one sentence", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY], [B, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([
      placed(A, { noteHeld: true, displayLabel: "Table 3", groupId: "group-3" }), placed(D, { groupId: "group-3" }),
      placed(B, { noteHeld: true, displayLabel: "Table 5" }), placed(C),
    ], false));
    store().replaceObjectsFromScene(store().objects.filter((object) => object.id === C));

    expect(await store().saveToServer(false)).toBe(true);
    expect(notice()).toBe("Tables 3 and 5 stayed where they are, because each has a note that cannot be shown here.");
    expect([...saveSent(0).batch.map((piece) => piece.id)].sort()).toEqual([A, B, C, D].sort());
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(server.notes.get(B)).toBe(ALLERGY);
  });

  it("does not let the piece be removed from the document by its id, nor a piece of its group", async () => {
    await open(plan([placed(A, { noteHeld: true, displayLabel: "Table 3", groupId: "group-3" }), placed(D, { groupId: "group-3" }), placed(B)], false));

    store().removeObject(A);
    expect(notice()).toBe("Nothing was removed: Table 3 has a note that cannot be shown here.");
    store().removeObject(D);
    expect(pieceIds()).toEqual([A, D, B]);
    expect(store().isDirty).toBe(false);
    store().removeObject(B);
    expect(pieceIds()).toEqual([A, D]);
  });

  it.each([true, undefined])("saves a removal as ever in a plan read with its notes, or by an API that marks nothing (notesIncluded %s)", async (notesIncluded) => {
    await open(plan([placed(A, { notes: ALLERGY }), placed(B)], notesIncluded));
    store().removeObject(A);
    vi.mocked(configApi.publicBatchSave).mockResolvedValue({ objects: [placed(B)], revision: 5 });

    expect(await store().saveToServer(false)).toBe(true);
    expect(saveSent(savesSent() - 1).batch.map((piece) => piece.id)).toEqual([B]);
    expect(notice()).toBeNull();
  });
});

describe("removing a piece whose only note is the person's own, in a browser the plan's notes are kept from", () => {
  const MINE = "TEST ONLY by the window";

  /** A holds a note this browser is not shown; the person writes MINE on B and it is saved. */
  async function withOwnNoteOnB(server: PlanOnServer): Promise<void> {
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B), placed(C)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(B)).toBe(MINE);
  }

  it("clears their note by name first and then removes the piece: nothing is refused, and nothing else is touched", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    const sentBefore = savesSent();

    store().removeObject(B);
    expect(notice()).toBeNull();
    // Every state the document passes through while it saves: B must never come back on screen.
    const backOnScreen: boolean[] = [];
    const stopWatching = useEditorStore.subscribe((state) => { backOnScreen.push(state.objects.some((object) => object.id === B)); });
    expect(await store().saveToServer(false)).toBe(true);
    stopWatching();
    expect(backOnScreen.length).toBeGreaterThan(0);
    expect(backOnScreen).not.toContain(true);

    // The API cannot tell their note from one kept from them, and would refuse a save that only left B out.
    expect(savesSent()).toBe(sentBefore + 2);
    // The removing save is sent on the revision the clearing save made.
    const revisionSent = (n: number): unknown => vi.mocked(configApi.publicBatchSave).mock.calls[n]?.[2];
    expect(revisionSent(sentBefore + 1)).toBe(Number(revisionSent(sentBefore)) + 1);
    expect(saveSent(sentBefore).batch.map((piece) => piece.id)).toEqual([A, B, C]);
    expect(sentPiece(sentBefore, B).replacesNote).toBe(MINE);
    expect(sentPiece(sentBefore, B).metadata?.notes).toBeUndefined();
    expect(sentPiece(sentBefore, A).replacesNote).toBeUndefined();
    expect(sentPiece(sentBefore, A).metadata?.notes).toBeUndefined();
    expect(saveSent(sentBefore + 1).batch.map((piece) => piece.id)).toEqual([A, C]);
    expect(server.notes.has(B)).toBe(false);
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(pieceIds()).toEqual([A, C]);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: false, isSaving: false, configRevision: server.revision });
  });

  it("does the same when the piece goes by a step back past its placing, and keeps the person's other note theirs", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().setObjectNotes(B, MINE);
    store().replaceObjectsFromScene([...store().objects, { ...kept("local-placed-own", "", 2), label: "Table 7" }]);
    expect(await store().saveToServer(false)).toBe(true);
    const own = pieceIds().find((id) => id !== A && id !== B);
    if (own === undefined) throw new Error("nothing placed");
    store().setObjectNotes(own, "TEST ONLY wheelchair space");
    expect(await store().saveToServer(false)).toBe(true);

    // Back past the note and the placing: the table goes, with the note they wrote on it.
    store().undo();
    store().undo();
    expect(pieceIds()).toEqual([A, B]);
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.has(own)).toBe(false);
    expect(server.notes.get(B)).toBe(MINE);
    expect(noteOn(B)).toBe(MINE);
    expect(heldNoteIds(store()).has(B)).toBe(false);
    expect(server.notes.get(A)).toBe(ALLERGY);
  });

  it("sends neither save as the page goes, and leaves the work on this device for the next open to send", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    const sentBefore = savesSent();

    store().removeObject(B);
    // A request sent as the page hides or closes: the second of two could not be counted on to follow the first.
    expect(await store().saveToServer(false, { keepalive: true })).toBe(false);
    expect(savesSent()).toBe(sentBefore);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isSaving: false, isDirty: true });
    expect(server.notes.get(B)).toBe(MINE);
    expect(draftOnDevice()?.objects.map((object) => object.id)).toEqual([A, C]);

    // The next open restores that work, with the note the server had confirmed here, and its save goes in the two steps.
    store().reset();
    await open({ ...plan([placed(A, { noteHeld: true }), placed(B, { noteHeld: true }), placed(C)], false), revision: server.revision });
    expect(pieceIds()).toEqual([A, C]);
    expect(await store().saveToServer(false)).toBe(true);
    expect(savesSent()).toBe(sentBefore + 2);
    expect(sentPiece(sentBefore, B).replacesNote).toBe(MINE);
    expect(server.notes.has(B)).toBe(false);
    expect(server.notes.get(A)).toBe(ALLERGY);
  });

  it("leaves a refusal on screen as the page goes, and asks for the save it could not send again (delta review R9)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    // A refusal stands: the person's words over A's note, which they cannot see.
    store().setObjectNotes(A, "TEST ONLY typed over");
    expect(await store().saveToServer(false)).toBe(false);
    expect(store().saveErrorCode).toBe("NOTE_HELD");
    store().removeObject(B);
    const sentBefore = savesSent();
    const asked = vi.fn();
    setEditorAutosaveRequester(asked);
    asked.mockClear();
    try {
      // The page hides: the flush cancels the waiting autosave, and the removal's two saves cannot go now.
      expect(await flushAutoSave({ keepalive: true })).toBe(false);
      expect(savesSent()).toBe(sentBefore);
      expect({ saveErrorCode: store().saveErrorCode, saveError: store().saveError, asked: asked.mock.calls.length })
        .toEqual({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE, asked: 1 });
      expect(store()).toMatchObject({ isDirty: true, isSaving: false });
      expect(server.notes.get(B)).toBe(MINE);
    } finally {
      setEditorAutosaveRequester(null);
    }
  });

  it("meets a newer version at the clearing save as any save does: the usual choice is offered, and nothing is lost", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    // The maker moves C before this browser's removal is saved.
    theyNowHave(server, [placed(A, { noteHeld: true }), placed(B, { noteHeld: true }), placed(C, {}, 6)]);
    const sentBefore = savesSent();
    store().removeObject(B);

    // The clearing save is sent on the revision the confirmed document was read at, and that is no longer the server's.
    expect(await store().saveToServer(false)).toBe(false);
    expect(savesSent()).toBe(sentBefore + 1);
    expect(sentPiece(sentBefore, B).replacesNote).toBe(MINE);
    expect(store()).toMatchObject({ saveErrorCode: "REVISION_CONFLICT", isDirty: true, isSaving: false });
    expect(store().saveConflict?.currentRevision).toBe(server.revision);
    // Nothing went: the note is on the server, and this version is as the person left it.
    expect(server.notes.get(B)).toBe(MINE);
    expect(pieceIds()).toEqual([A, C]);

    // Keeping this version: B's note can no longer be vouched for across the versions, so B stays, with its note.
    // The person can read that note: it is still being saved, not one that cannot be shown here (delta review R4).
    expect(await store().keepMine(false)).toBe(true);
    expect(store()).toMatchObject({ saveConflict: null, saveError: null, isDirty: false });
    expect(pieceIds()).toContain(B);
    expect(notice()).toMatch(/^Nothing was removed: the note on .+ is still being saved\. Try again once it has saved\.$/u);
    expect(server.notes.get(B)).toBe(MINE);
    expect(server.notes.get(A)).toBe(ALLERGY);
  });

  it("takes back a piece the clearing save's answer says has come to hold a note before the removing save goes (delta review R2)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B), placed(C, { displayLabel: "Table 9" }, 6)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);
    const sentBefore = savesSent();
    // The person removes B, with their own note on it, and C, which holds none.
    store().removeObject(B);
    store().removeObject(C);
    // Before that is saved, staff write a note on C through the single-piece route: no new revision.
    server.notes.set(C, THEIR_NOTE);

    // The clearing save's answer says C holds a note: C is taken back, said to have stayed, and sent with the removal.
    const saved = await store().saveToServer(false);
    expect({ saved, saveErrorCode: store().saveErrorCode }).toEqual({ saved: true, saveErrorCode: null });
    expect(savesSent()).toBe(sentBefore + 2);
    expect(saveSent(sentBefore + 1).batch.map((piece) => piece.id)).toEqual([A, C]);
    expect(sentPiece(sentBefore + 1, C).metadata?.notes).toBeUndefined();
    expect(notice()).toBe("Table 9 stayed where it is, because it has a note that cannot be shown here.");
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
    expect(server.notes.has(B)).toBe(false);
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(pieceIds()).toEqual([A, C]);
    expect(noteHeldOn(store(), C)).toBe(true);
    expect(store()).toMatchObject({ saveError: null, isDirty: false, isSaving: false });
  });

  /** A holds a note this browser is not shown; the person writes MINE on B, Table 5, and it is saved. */
  async function withOwnNoteOnTableFive(server: PlanOnServer): Promise<void> {
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B, { displayLabel: "Table 5" }), placed(C)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);
  }

  it("gives up the removal when the clearing save is refused because the note is not theirs any more, and saves the rest (delta review R3)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnTableFive(server);
    const sentBefore = savesSent();
    // Staff change B's note through the single-piece route: no new revision, and this browser is not told.
    server.notes.set(B, THEIR_NOTE);
    store().removeObject(B);
    store().updateObject(C, { positionX: 4 });

    const saved = await store().saveToServer(false);
    expect({ saved, saveErrorCode: store().saveErrorCode }).toEqual({ saved: true, saveErrorCode: null });
    // The clearing save was refused; B is back, said to have stayed, and goes with the work, its note left to the server.
    expect(savesSent()).toBe(sentBefore + 2);
    expect(sentPiece(sentBefore, B).replacesNote).toBe(MINE);
    expect(saveSent(sentBefore + 1).batch.map((piece) => piece.id)).toEqual([A, C, B]);
    expect(sentPiece(sentBefore + 1, B).metadata?.notes).toBeUndefined();
    expect(sentPiece(sentBefore + 1, B).replacesNote).toBeUndefined();
    expect(notice()).toBe("Table 5 stayed where it is, because it has a note that cannot be shown here.");
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(noteHeldOn(store(), B)).toBe(true);
    expect(store().objects.find((object) => object.id === C)?.positionX).toBe(4);
    expect(store()).toMatchObject({ saveError: null, isDirty: false, isSaving: false });

    // Nothing of the removal is left pending: the next save is the one save.
    const after = savesSent();
    store().updateObject(C, { positionX: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    expect(savesSent()).toBe(after + 1);
  });

  it("gives up the removal when the clearing save is refused for the confirmed document itself (422), keeps their note theirs, and saves the rest (delta review A6)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnTableFive(server);
    const sentBefore = savesSent();
    // The clearing save is the confirmed document as it stands, and the API refuses it whole.
    vi.mocked(configApi.publicBatchSave).mockImplementationOnce(() => Promise.reject(new ApiError(
      422, "One or more placements fall outside the space's floor plan.", "PLACEMENT_OUT_OF_BOUNDS",
    )));
    store().removeObject(B);
    store().updateObject(C, { positionX: 4 });

    const saved = await store().saveToServer(false);
    expect({ saved, saveErrorCode: store().saveErrorCode }).toEqual({ saved: true, saveErrorCode: null });
    // B is back with their own note on it, and the work goes with it: that save confirms the note.
    expect(savesSent()).toBe(sentBefore + 2);
    expect(saveSent(sentBefore + 1).batch.map((piece) => piece.id)).toEqual([A, C, B]);
    expect(sentPiece(sentBefore + 1, B).metadata?.notes).toBe(MINE);
    // Their note, carried until that save confirms it: still being saved (delta review R4).
    expect(notice()).toBe("Nothing was removed: the note on Table 5 is still being saved. Try again once it has saved.");
    expect(server.notes.get(B)).toBe(MINE);
    expect(noteOn(B)).toBe(MINE);
    expect(heldNoteIds(store()).has(B)).toBe(false);
    expect(store().objects.find((object) => object.id === C)?.positionX).toBe(4);
    expect(store()).toMatchObject({ saveError: null, isDirty: false, isSaving: false });

    // Asked again, the removal goes in its two saves.
    usePlacementNoticeStore.getState().dismiss();
    store().removeObject(B);
    expect(notice()).toBeNull();
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.has(B)).toBe(false);
    expect(pieceIds()).toEqual([A, C]);
  });

  it("says the note is still being saved when Keep mine takes back the person's own removed piece, whose note they can read (delta review R4)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnTableFive(server);
    // Another device moves C before this browser's removal of Table 5 is saved.
    theyNowHave(server, [placed(A, { noteHeld: true }), placed(B, { noteHeld: true, displayLabel: "Table 5" }), placed(C, {}, 6)]);
    store().removeObject(B);
    expect(await store().saveToServer(false)).toBe(false);
    usePlacementNoticeStore.getState().dismiss();

    expect(await store().keepMine(false)).toBe(true);
    expect(pieceIds()).toContain(B);
    expect(notice()).toBe("Nothing was removed: the note on Table 5 is still being saved. Try again once it has saved.");
    // Its panel shows their words, and the save that kept their version has confirmed them.
    expect(noteOn(B)).toBe(MINE);
    expect(noteHeldOn(store(), B)).toBe(false);
    expect(server.notes.get(B)).toBe(MINE);
  });

  it("sends the one save for a piece that carries no note", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    const sentBefore = savesSent();

    store().removeObject(C);
    expect(await store().saveToServer(false)).toBe(true);
    expect(savesSent()).toBe(sentBefore + 1);
    expect(saveSent(sentBefore).batch.map((piece) => piece.id)).toEqual([A, B]);
    expect(server.notes.get(B)).toBe(MINE);
  });

  it("leaves the piece with its note cleared if the removing save fails, and removes it at the next save without putting it back", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    await withOwnNoteOnB(server);
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    const sentBefore = savesSent();
    // The clearing save lands; the removing save, the second sent from here on, does not.
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => (savesSent() === sentBefore + 2
      ? Promise.reject(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"))
      : api(...sent)));

    store().removeObject(B);
    expect(await store().saveToServer(false)).toBe(false);
    // The person is told the save failed, as for any failed save.
    expect(store()).toMatchObject({
      saveError: "Too many requests — please slow down.", saveErrorCode: "RATE_LIMITED", isDirty: true, isSaving: false, configRevision: server.revision,
    });
    // What the person asked for, as far as it got: the piece is still the server's, its note gone.
    expect(server.notes.has(B)).toBe(false);
    expect(store().baseObjects.find((object) => object.id === B)).toMatchObject({ notes: "" });
    expect(heldNoteIds(store()).has(B)).toBe(false);
    expect(pieceIds()).toEqual([A, C]);

    // The confirmed document no longer says B holds a note, so the next save does not take it back: it removes it.
    expect(await store().saveToServer(false)).toBe(true);
    expect(savesSent()).toBe(sentBefore + 3);
    expect(saveSent(sentBefore + 2).batch.map((piece) => piece.id)).toEqual([A, C]);
    expect(notice()).toBeNull();
    expect(pieceIds()).toEqual([A, C]);
    expect(server.notes.get(A)).toBe(ALLERGY);
  });

  it("refuses the removal once that note is hidden from them too, after a reload, and sends nothing", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true }), placed(B, { displayLabel: "Table 5" }), placed(C)], false));
    store().setObjectNotes(B, MINE);
    expect(await store().saveToServer(false)).toBe(true);
    // A reload: the read keeps every note from this browser, the one it wrote included.
    store().reset();
    await open({ ...plan([placed(A, { noteHeld: true }), placed(B, { noteHeld: true, displayLabel: "Table 5" }), placed(C)], false), revision: server.revision });
    expect(noteHeldOn(store(), B)).toBe(true);
    const sentBefore = savesSent();

    store().removeObject(B);
    expect(notice()).toBe("Nothing was removed: Table 5 has a note that cannot be shown here.");
    expect(pieceIds()).toEqual([A, B, C]);
    expect(store().isDirty).toBe(false);
    expect(savesSent()).toBe(sentBefore);
    expect(server.notes.get(B)).toBe(MINE);
  });
});

describe("a save the API refuses because it leaves out a piece holding a note this browser is not shown", () => {
  it("is said in the API's own words under its own code, and is not sent again", async () => {
    await open(plan([placed(A, { noteHeld: true }), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY by the window");
    store().updateObject(B, { positionX: 3 });
    vi.mocked(configApi.publicBatchSave).mockRejectedValue(new ApiError(409, OMITTED_MESSAGE, "HELD_PIECE_OMITTED"));

    expect(await store().saveToServer(false)).toBe(false);
    expect(savesSent()).toBe(1);
    expect(store()).toMatchObject({ saveError: OMITTED_MESSAGE, saveErrorCode: "HELD_PIECE_OMITTED", saveConflict: null, isDirty: true, isSaving: false });
    expect(refusedOverHeldNote(store().saveErrorCode)).toBe(true);
    expect(refusedOverHeldNote("NOTE_HELD")).toBe(true);
    expect(refusedOverHeldNote("RATE_LIMITED")).toBe(false);
    expect(refusedOverHeldNote(null)).toBe(false);
  });

  it("is answered by a reload, as its sentence says: the work this page kept takes the piece back as it opens, and then saves", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    // A page that was never told A holds a note (one loaded before the API marked such pieces, say) removes it.
    await open(plan([placed(A, { displayLabel: "Table 3" }, 5), placed(B)], false));
    store().removeObject(A);
    store().updateObject(B, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    expect(store()).toMatchObject({ saveError: OMITTED_MESSAGE, saveErrorCode: "HELD_PIECE_OMITTED", isDirty: true });
    expect(savesSent()).toBe(1);
    expect(draftOnDevice()?.objects.map((object) => object.id)).toEqual([B]);

    // The reload the sentence asks for: the read now says A holds a note, and the work this page kept is restored.
    store().reset();
    await open(plan([placed(A, { noteHeld: true, displayLabel: "Table 3" }, 5), placed(B)], false));
    expect(pieceIds()).toEqual([B, A]);
    expect(notice()).toBe("Table 3 stayed where it is, because it has a note that cannot be shown here.");
    expect(store().objects.find((object) => object.id === B)?.positionX).toBe(3);

    expect(await store().saveToServer(false)).toBe(true);
    expect(savesSent()).toBe(2);
    expect(sentPiece(1, A).positionX).toBeCloseTo(5, 3);
    expect(sentPiece(1, A).metadata?.notes).toBeUndefined();
    expect(server.notes.get(A)).toBe(ALLERGY);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: false });
  });
});

describe("Undo and Redo of a step that would take a piece which has come to hold a note this browser is not shown", () => {
  /**
   * The person places `count` pieces in one step and saves. The maker writes a
   * note on each. The person's next save meets that version and they keep
   * theirs: the pieces they placed now hold notes they are not shown.
   */
  async function placeThenTheyNoteThem(server: PlanOnServer, labels: readonly string[]): Promise<readonly string[]> {
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().replaceObjectsFromScene([
      ...store().objects,
      ...labels.map((label, index) => ({ ...kept(`local-placed-${String(index)}`, "", 2 + index), ...(label === "" ? {} : { label }) })),
    ]);
    expect(await store().saveToServer(false)).toBe(true);
    const theirs = pieceIds().filter((id) => id !== A && id !== B);
    expect(theirs).toHaveLength(labels.length);
    for (const id of theirs) server.notes.set(id, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B), ...theirs.map((id, index) => placed(id, { noteHeld: true }, 2 + index))]);
    store().updateObject(B, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    expect(await store().keepMine(false)).toBe(true);
    expect(theirs.every((id) => heldNoteIds(store()).has(id))).toBe(true);
    return theirs;
  }

  it("refuses the whole step, says which piece, and leaves the document and the history as they were", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const [placedPiece] = await placeThenTheyNoteThem(server, ["Table 3"]);
    if (placedPiece === undefined) throw new Error("nothing placed");

    // The move of B is theirs to take back: nothing held goes with it.
    store().undo();
    expect(store().objects.find((object) => object.id === B)?.positionX).toBe(0);
    const { past, future } = store().history;
    const before = store().objects;

    store().undo();
    expect(pieceIds()).toContain(placedPiece);
    expect(store().objects).toBe(before);
    expect(notice()).toBe("Nothing was undone: Table 3 has a note that cannot be shown here.");
    expect(store().history.past).toBe(past);
    expect(store().history.future).toBe(future);

    // What is saved next still holds the row, and the note it never saw.
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(placedPiece)).toBe(THEIR_NOTE);
  });

  it("refuses a step that placed several, though only some of them hold a note, and lists those", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const theirs = await placeThenTheyNoteThem(server, ["Table 3", "Table 5", "Table 8"]);

    store().undo();
    store().undo();
    expect(pieceIds()).toEqual(expect.arrayContaining([...theirs]));
    expect(notice()).toBe("Nothing was undone: Tables 3, 5 and 8 have notes that cannot be shown here.");
  });

  it("counts pieces nobody named", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await placeThenTheyNoteThem(server, ["", ""]);

    store().undo();
    store().undo();
    expect(notice()).toMatch(/^Nothing was undone: 2 \S.* have notes that cannot be shown here\.$/u);
  });
});

describe("Undo of a removal the server has not had", () => {
  it("returns the piece as the row it was, so a save keeps the row and whatever note it holds", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY by the window");
    expect(await store().saveToServer(false)).toBe(true);
    // B's note is this browser's own, so it may take B away; the server has not heard of that yet.
    store().removeObject(B);
    store().undo();

    expect(pieceIds()).toEqual([A, B]);
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(1, B).id).toBe(B);
    expect(server.notes.get(B)).toBe("TEST ONLY by the window");
  });

  it("returns it as a new piece once the server has removed the row, as before", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().removeObject(B);
    expect(await store().saveToServer(false)).toBe(true);
    store().undo();

    expect(pieceIds()).toHaveLength(2);
    expect(pieceIds()).not.toContain(B);
    expect(await store().saveToServer(false)).toBe(true);
    expect(saveSent(1).batch.map((piece) => piece.id)).toEqual([A, undefined]);
  });

  it("returns a piece holding a note this browser is not shown as itself, before any save has had to take it back", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true, displayLabel: "Table 3" }), placed(B)], false));
    store().replaceObjectsFromScene(store().objects.filter((object) => object.id !== A));

    store().undo();
    expect(pieceIds()).toEqual([A, B]);
    expect(noteHeldOn(store(), A)).toBe(true);
    expect(await store().saveToServer(false)).toBe(true);
    expect(notice()).toBeNull();
    expect(server.notes.get(A)).toBe(ALLERGY);
  });

  it("leaves Redo of that removal refused once the piece has come to hold a note this browser is not shown", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B, { displayLabel: "Table 5" })], false));
    store().removeObject(B);
    store().undo();
    // The maker writes on B before this browser's next save arrives. That save meets their version, which holds
    // nothing this browser's does not, so it is taken as saved: B is the same row, now holding a note not shown here.
    server.notes.set(B, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B, { noteHeld: true, displayLabel: "Table 5" })]);
    expect(await store().saveToServer(false)).toBe(true);
    expect(heldNoteIds(store()).has(B)).toBe(true);
    const { past, future } = store().history;

    store().redo();
    expect(pieceIds()).toEqual([A, B]);
    expect(notice()).toBe("Nothing was redone: Table 5 has a note that cannot be shown here.");
    expect(store().history.past).toBe(past);
    expect(store().history.future).toBe(future);
  });
});

describe("Keep mine, when the newer version has a piece holding a note this browser is not shown that this version lacks", () => {
  it("keeps that piece where they put it, says so, and saves this version round it", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    // The maker adds Table 9 with a note; this browser's save meets that version.
    server.notes.set(C, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B), placed(C, { noteHeld: true, displayLabel: "Table 9" }, 7)]);
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);

    const sentBefore = savesSent();
    expect(await store().keepMine(false)).toBe(true);
    expect(notice()).toBe("Table 9 stayed where it is, because it has a note that cannot be shown here.");
    expect(pieceIds()).toEqual([A, B, C]);
    // It went with its own row, where they stood it, under their name for it, and with no word about its note.
    expect(sentPiece(sentBefore, C).positionX).toBeCloseTo(7, 3);
    expect(sentPiece(sentBefore, C).metadata).toMatchObject({ displayLabel: "Table 9" });
    expect(sentPiece(sentBefore, C).metadata?.notes).toBeUndefined();
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), C)).toBe(true);
    // Undo takes back the person's own move, and never the piece that stayed.
    store().undo();
    expect(pieceIds()).toEqual([A, B, C]);
  });

  it("keeps it with the rest of its group, and keeps a piece this version had removed that has come to hold one", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B, { displayLabel: "Table 5" })], false));
    // This browser removes B, which holds no note. Before that is saved the maker writes on B, and adds Table 9 with a chair.
    store().removeObject(B);
    server.notes.set(B, THEIR_NOTE);
    server.notes.set(C, THEIR_NOTE);
    theyNowHave(server, [
      placed(A), placed(B, { noteHeld: true, displayLabel: "Table 5" }),
      placed(C, { noteHeld: true, displayLabel: "Table 9", groupId: "group-9" }), placed(D, { groupId: "group-9" }),
    ]);
    expect(await store().saveToServer(false)).toBe(false);

    expect(await store().keepMine(false)).toBe(true);
    expect(notice()).toBe("Tables 5 and 9 stayed where they are, because each has a note that cannot be shown here.");
    expect([...pieceIds()].sort()).toEqual([A, B, C, D].sort());
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
    // The removal the person made is no longer a step to redo or undo: B stays whichever way they go.
    store().undo();
    store().redo();
    expect(pieceIds().filter((id) => id === B)).toHaveLength(1);
  });

  it("keeps a piece the person brought back with Undo while a save was in flight once, as itself (delta review R7)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B), placed(C, { displayLabel: "Table 9" }, 6)], false));
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    // The save of the removal is answered only once the person has acted.
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => { answer = resolve; });
    vi.mocked(configApi.publicBatchSave).mockImplementationOnce(async (...sent) => {
      await answered;
      return api(...sent);
    });

    store().removeObject(C);
    const saving = store().saveToServer(false);
    // Within that round trip the maker writes a note on C, and the person's Undo brings C back.
    server.notes.set(C, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B), placed(C, { noteHeld: true, displayLabel: "Table 9" }, 6)]);
    store().undo();
    expect(pieceIds()).toHaveLength(3);
    answer();
    expect(await saving).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(server.revision);

    const sentBefore = savesSent();
    expect(await store().keepMine(false)).toBe(true);
    // C stands once, under its own id: no copy of it goes as a new piece.
    expect({ pieces: [...pieceIds()].sort(), sent: saveSent(sentBefore).batch.map((piece) => piece.id ?? "a new piece").sort() })
      .toEqual({ pieces: [A, B, C].sort(), sent: [A, B, C].sort() });
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), C)).toBe(true);
  });

  it("keeps it when the choice came from work kept on this device against an older version", async () => {
    const server: PlanOnServer = { revision: 6, notes: new Map([[C, THEIR_NOTE]]) };
    serveNotesAsTheApiDoes(server);
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "", 3), kept(B)], baseObjects: [kept(A), kept(B)], isDirty: true,
    });
    await open({ ...plan([placed(A), placed(B), placed(C, { noteHeld: true, displayLabel: "Table 9" }, 7)], false), revision: 6 });
    expect(store().saveConflict?.currentRevision).toBe(6);

    expect(await store().keepMine(false)).toBe(true);
    expect(pieceIds()).toEqual([A, B, C]);
    expect(notice()).toBe("Table 9 stayed where it is, because it has a note that cannot be shown here.");
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
  });
});

describe("the notes Keep mine carries onto the newer version, before any save has confirmed them", () => {
  it("count as notes this browser is not shown, so nothing takes those pieces meanwhile", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY by the window");
    expect(await store().saveToServer(false)).toBe(true);
    expect(heldNoteIds(store()).has(B)).toBe(false);
    // The maker rewrites B's note. Keep mine's own save then fails for another reason.
    server.notes.set(B, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B, { noteHeld: true })]);
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    vi.mocked(configApi.publicBatchSave).mockRejectedValueOnce(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"));
    expect(await store().keepMine(false)).toBe(false);

    // B may hold other words now: it is guarded, though the person still sees and can change their own.
    expect(heldNoteIds(store()).has(B)).toBe(true);
    expect(noteOn(B)).toBe("TEST ONLY by the window");
    expect(noteHeldOn(store(), B)).toBe(false);
    expect(ownWordsOverHeldNotes(store())).toEqual([]);
    // The copy kept on this device says the same after a reload.
    store().reset();
    await open({ ...plan([placed(A), placed(B, { noteHeld: true })], false), revision: server.revision });
    expect(heldNoteIds(store()).has(B)).toBe(true);
    expect(noteOn(B)).toBe("TEST ONLY by the window");
  });

  it("are said to be still saving when the person asks for such a piece to go: they can read that note", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[A, ALLERGY]]) };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A, { noteHeld: true, displayLabel: "Table 3" }), placed(B, { displayLabel: "Table 5" })], false));
    store().setObjectNotes(B, "TEST ONLY by the window");
    expect(await store().saveToServer(false)).toBe(true);
    theyNowHave(server, [placed(A, { noteHeld: true, displayLabel: "Table 3" }, 2), placed(B, { noteHeld: true, displayLabel: "Table 5" })]);
    store().updateObject(B, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    vi.mocked(configApi.publicBatchSave).mockRejectedValueOnce(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"));
    expect(await store().keepMine(false)).toBe(false);

    store().removeObject(B);
    expect(notice()).toBe("Nothing was removed: the note on Table 5 is still being saved. Try again once it has saved.");
    expect(pieceIds()).toContain(B);
    // A note that is kept from this browser is said as it always was.
    usePlacementNoticeStore.getState().dismiss();
    store().removeObject(A);
    expect(notice()).toBe("Nothing was removed: Table 3 has a note that cannot be shown here.");
    expect(pieceIds()).toContain(A);
  });

  it("are confirmed, and unguarded again, by the save that lands them", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B)], false));
    store().setObjectNotes(B, "TEST ONLY by the window");
    expect(await store().saveToServer(false)).toBe(true);
    theyNowHave(server, [placed(A, {}, 2), placed(B, { noteHeld: true })]);
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);

    expect(await store().keepMine(false)).toBe(true);
    expect(heldNoteIds(store()).has(B)).toBe(false);
    expect(noteOn(B)).toBe("TEST ONLY by the window");
  });
});

describe("Keep mine refused for a note the maker rewrote, with other notes of the person's own in the same save", () => {
  const MINE_B = "TEST ONLY by the window";
  const MINE_C = "TEST ONLY wheelchair space";

  /** The person's own notes on B and C are confirmed; the maker rewrites B; `change` is what the person does before their next save meets it. */
  async function theyRewriteB(server: PlanOnServer, change: () => void): Promise<void> {
    serveNotesAsTheApiDoes(server);
    await open(plan([placed(A), placed(B), placed(C)], false));
    store().setObjectNotes(B, MINE_B);
    store().setObjectNotes(C, MINE_C);
    expect(await store().saveToServer(false)).toBe(true);
    server.notes.set(B, THEIR_NOTE);
    theyNowHave(server, [placed(A), placed(B, { noteHeld: true }), placed(C, { noteHeld: true })]);
    change();
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
  }

  it("still clears the note the person cleared, and drops only its out-of-date copy of the rewritten one", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewriteB(server, () => { store().setObjectNotes(C, ""); });

    expect(await store().keepMine(false)).toBe(true);
    expect(server.notes.has(C)).toBe(false);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), B)).toBe(true);
    expect(noteHeldOn(store(), C)).toBe(false);
    expect(store()).toMatchObject({ saveError: null, saveConflict: null, isDirty: false });
  });

  it("clears it when the person had cleared both, and refuses their clear of the rewritten one", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewriteB(server, () => { store().setObjectNotes(B, ""); store().setObjectNotes(C, ""); });

    expect(await store().keepMine(false)).toBe(false);
    expect(server.notes.has(C)).toBe(false);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), B)).toBe(true);
    // Nothing is left unsaved: the refused clear is said, in its own sentence, not waiting to be sent (rulings R1(b), C3).
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveConflict: null, isDirty: false, noteClearsRefused: [B] });
    expect(store().saveError).toMatch(/'s note was not removed: it was changed somewhere else, and that note cannot be shown here\.$/u);

    // The notice stands through the next save that lands; nothing says saved until the person dismisses it.
    expect(saveStatusesNow()).toEqual({ status: "unsaved", slate: "not-saved" });
    store().updateObject(A, { positionX: 5 });
    expect(await store().saveToServer(false)).toBe(true);
    refusedClearStandsUntilDismissed(/'s note was not removed: it was changed somewhere else, and that note cannot be shown here\.$/u, [B]);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
  });

  it("saves a change the person was making to their other note, and keeps that note theirs to go on with", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewriteB(server, () => { store().setObjectNotes(C, `${MINE_C}, please`); });

    expect(await store().keepMine(false)).toBe(true);
    expect(server.notes.get(C)).toBe(`${MINE_C}, please`);
    expect(noteOn(C)).toBe(`${MINE_C}, please`);
    expect(heldNoteIds(store()).has(C)).toBe(false);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
  });

  it("keeps the person's new words for the rewritten note on their piece, refused and named, for them to take off", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewriteB(server, () => { store().setObjectNotes(B, `${MINE_B}, please`); });

    // Everything else of theirs is saved, their other note with it; the words they cannot put over the maker's are
    // still theirs to see, and the refusal is about that one piece.
    expect(await store().keepMine(false)).toBe(false);
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE, saveConflict: null, isDirty: true, configRevision: server.revision });
    expect(server.notes.get(C)).toBe(MINE_C);
    expect(heldNoteIds(store()).has(C)).toBe(false);
    expect(noteOn(B)).toBe(`${MINE_B}, please`);
    expect(ownWordsOverHeldNotes(store()).map((object) => object.id)).toEqual([B]);
    expect(await store().saveToServer(false)).toBe(false);
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE });
    store().setObjectNotes(B, "");
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
  });

  it("leaves every note it cannot vouch for to the server when the maker rewrote more than one, and still saves", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewriteB(server, () => { server.notes.set(C, THEIR_NOTE); });

    expect(await store().keepMine(false)).toBe(true);
    expect(server.notes.get(B)).toBe(THEIR_NOTE);
    expect(server.notes.get(C)).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), B)).toBe(true);
    expect(noteHeldOn(store(), C)).toBe(true);
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
  });

  it("tells a caller that was waiting on the save the truth: it landed", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    // The first save is refused for the rewritten note; the saves after it find it, and the last lands.
    await theyRewriteB(server, () => undefined);
    // Answers arrive a moment later, as over a network, so the caller's turn comes while a later save is in flight.
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => new Promise((resolve, reject) => {
      setTimeout(() => { api(...sent).then(resolve, reject); }, 0);
    }));
    const sentBefore = savesSent();

    const keeping = store().keepMine(false);
    const flushed = flushAutoSave();
    expect(await keeping).toBe(true);
    // Refused; every recorded note left (lands); B sent and C left (refused: B is out of date); C sent and B left (lands).
    expect(savesSent()).toBe(sentBefore + 4);
    // The caller waited through them all, sent nothing of its own, and is not told the layout failed to save.
    expect(await flushed).toBe(true);
    expect(savesSent()).toBe(sentBefore + 4);
    expect(server.notes.get(C)).toBe(MINE_C);
  });
});

// ---------------------------------------------------------------------------
// Delta review of #388 at 713dc3f1, R1 and A1 (major). A save refused for an
// out-of-date note was tried without each recorded note in turn only while
// there were at most 8 of them, and then without them all. With 9 or more on
// record, or 2 or more rewritten, every recorded note was left to the server:
// a note the person had cleared stayed there, each of their notes was hidden
// from them, and the save said it had landed. The out-of-date notes are now
// found by halving the recorded ones, and a note left to the server that the
// person had cleared or changed is refused, never said to be saved.
// ---------------------------------------------------------------------------

/** The id of table `index` (Table index + 1) in these plans. */
function tableId(index: number): string {
  return `0b0b0b0b-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** A refused clear of Table 7's note, said (ruling C3 on #388). */
const TABLE_7_NOT_REMOVED = "Table 7's note was not removed: it was changed somewhere else, and that note cannot be shown here.";

/** What the person wrote on table `index`; Table 4's is a health note. */
function ownNote(index: number): string {
  return index === 3 ? ALLERGY : `TEST ONLY own note for Table ${String(index + 1)}`;
}

describe("Keep mine refused for notes the maker rewrote, among many notes of the person's own", () => {
  /**
   * A chair A, and `count` tables on each of which the person writes a note of
   * their own; the server confirms them all. The maker then rewrites the notes
   * on the tables at `rewritten`. `change` is what the person does before their
   * next save, a move of A included, meets that version, which says only that
   * every table holds a note.
   */
  async function theyRewrite(server: PlanOnServer, count: number, rewritten: readonly number[], change: () => void): Promise<readonly string[]> {
    const tables = Array.from({ length: count }, (_, index) => tableId(index));
    const shown = (marks: ObjectMetadata): PlacedObject[] => [
      placed(A), ...tables.map((id, index) => placed(id, { displayLabel: `Table ${String(index + 1)}`, ...marks }, index + 1)),
    ];
    serveNotesAsTheApiDoes(server);
    await open(plan(shown({}), false));
    tables.forEach((id, index) => { store().setObjectNotes(id, ownNote(index)); });
    expect(await store().saveToServer(false)).toBe(true);
    for (const index of rewritten) server.notes.set(tableId(index), THEIR_NOTE);
    theyNowHave(server, shown({ noteHeld: true }));
    change();
    store().updateObject(A, { positionX: 3 });
    expect(await store().saveToServer(false)).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(server.revision);
    return tables;
  }

  /** Every table but those at `except` still holds the person's own note, on the server and on screen, and it is theirs. */
  function ownNotesKept(tables: readonly string[], server: PlanOnServer, except: readonly number[]): void {
    tables.forEach((id, index) => {
      if (except.includes(index)) return;
      expect({ table: index + 1, onServer: server.notes.get(id), onScreen: noteOn(id), guarded: heldNoteIds(store()).has(id) })
        .toEqual({ table: index + 1, onServer: ownNote(index), onScreen: ownNote(index), guarded: false });
    });
  }

  it("clears the note the person cleared, keeps their other notes theirs, and leaves only the rewritten one to the server (9 notes, 1 rewritten)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(3), ""); });
    const sentBefore = savesSent();

    const saved = await store().keepMine(false);
    // The clear on Table 4 is made, and only then is the save said to have landed.
    expect({ saved, tableFourOnServer: server.notes.get(tableId(3)) }).toEqual({ saved: true, tableFourOnServer: undefined });
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, saveConflict: null, isDirty: false, configRevision: server.revision });
    expect(noteOn(tableId(3))).toBe("");
    expect(noteHeldOn(store(), tableId(3))).toBe(false);
    // The maker's words on Table 7 stand, and Table 7 says it holds a note this browser is not shown.
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), tableId(6))).toBe(true);
    ownNotesKept(tables, server, [3, 6]);
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
    // Found by halving, not one save per note: the refused save, the save that leaves every recorded note
    // (it lands, so the rest of the work is saved at once), three halvings, and the save of all but Table 7.
    expect(savesSent() - sentBefore).toBe(6);
  });

  it("refuses the clear of a note the maker rewrote: the save is not said to have landed, the piece is named, and the refusal stands through the next save", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(6), ""); });

    const saved = await store().keepMine(false);
    // Nothing is left unsaved (the clear cannot be made from here), and the refusal is said (ruling R1(b)).
    expect({ saved, isDirty: store().isDirty, saveErrorCode: store().saveErrorCode }).toEqual({ saved: false, isDirty: false, saveErrorCode: "NOTE_HELD" });
    // The piece is named in the clear's own sentence (ruling C3), not before the API's.
    expect(store()).toMatchObject({ saveError: TABLE_7_NOT_REMOVED, saveConflict: null, isSaving: false, configRevision: server.revision });
    expect(pieceNamedForRefusedSave(store())).toBeNull();
    // Nothing of the maker's is touched; every other note of the person's is still theirs; the move is saved.
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), tableId(6))).toBe(true);
    ownNotesKept(tables, server, [6]);
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);

    expect(saveStatusesNow()).toEqual({ status: "unsaved", slate: "not-saved" });

    // The note on Table 7 is not theirs to clear, so the next save leaves it to the server, as the piece now shows.
    const sentBefore = savesSent();
    expect(await store().saveToServer(false)).toBe(true);
    expect(sentPiece(sentBefore, tableId(6)).metadata?.notes).toBeUndefined();
    expect(sentPiece(sentBefore, tableId(6)).replacesNote).toBeUndefined();
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    // That save does not put the refusal away, and nothing says saved while it stands: the person puts it away (ruling R1(b) on #388).
    refusedClearStandsUntilDismissed(TABLE_7_NOT_REMOVED, [tableId(6)]);
    expect(noteHeldOn(store(), tableId(6))).toBe(true);
  });

  it("keeps words the person put on a rewritten note among nine refused and named, and saves the rest", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(6), "TEST ONLY by the stage"); });

    expect(await store().keepMine(false)).toBe(false);
    expect(store()).toMatchObject({ saveErrorCode: "NOTE_HELD", saveError: NOTE_HELD_MESSAGE, isDirty: true, saveConflict: null });
    expect(pieceNamedForRefusedSave(store())).toBe("Table 7");
    expect(noteOn(tableId(6))).toBe("TEST ONLY by the stage");
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    ownNotesKept(tables, server, [6]);
  });

  it.each([
    [0, 7], [1, 7], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 5],
  ])("finds the one rewritten note among nine by halving (the table at index %i rewritten: %i saves)", async (rewritten, saves) => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [rewritten], () => undefined);
    const sentBefore = savesSent();

    expect(await store().keepMine(false)).toBe(true);
    expect(server.notes.get(tableId(rewritten))).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), tableId(rewritten))).toBe(true);
    ownNotesKept(tables, server, [rewritten]);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: false });
    expect(savesSent() - sentBefore).toBe(saves);
    // At most k (ceil(log2 n) + 1) + 2 for k rewritten among n: never one save per note.
    expect(saves).toBeLessThanOrEqual(1 * (Math.ceil(Math.log2(9)) + 1) + 2);
  });

  it.each([
    [0, 1, 12], [1, 2, 12], [0, 15, 10], [3, 12, 11], [6, 9, 11], [14, 15, 7],
  ])("finds two rewritten notes among sixteen by halving (the tables at indexes %i and %i rewritten: %i saves)", async (first, second, saves) => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 16, [first, second], () => undefined);
    const sentBefore = savesSent();

    expect(await store().keepMine(false)).toBe(true);
    for (const index of [first, second]) {
      expect(server.notes.get(tableId(index))).toBe(THEIR_NOTE);
      expect(noteHeldOn(store(), tableId(index))).toBe(true);
    }
    ownNotesKept(tables, server, [first, second]);
    expect(savesSent() - sentBefore).toBe(saves);
    expect(saves).toBeLessThanOrEqual(2 * (Math.ceil(Math.log2(16)) + 1) + 2);
  });

  it("keeps every note it has not yet vouched for on record if the halving is cut short, and the next save finishes it", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(3), ""); });
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    const sentBefore = savesSent();
    // The refused save, then the save that leaves every recorded note (it lands); the first halving is turned away.
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => (savesSent() === sentBefore + 3
      ? Promise.reject(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"))
      : api(...sent)));

    expect(await store().keepMine(false)).toBe(false);
    // What landed is this page's: its revision, the move. The failure is said as any failed save's is.
    expect(store()).toMatchObject({
      saveError: "Too many requests — please slow down.", saveErrorCode: "RATE_LIMITED", saveConflict: null,
      isDirty: true, isSaving: false, configRevision: server.revision,
    });
    expect(store().objects.find((object) => object.id === A)?.positionX).toBe(3);
    // No note of the person's was given up on: each is still theirs to read and change, and guarded until a save confirms it.
    tables.forEach((id, index) => {
      expect(noteOn(id)).toBe(index === 3 ? "" : ownNote(index));
      expect(noteHeldOn(store(), id)).toBe(false);
      expect(heldNoteIds(store()).has(id)).toBe(true);
    });

    vi.mocked(configApi.publicBatchSave).mockImplementation(api);
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.has(tableId(3))).toBe(false);
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    expect(noteHeldOn(store(), tableId(6))).toBe(true);
    ownNotesKept(tables, server, [3, 6]);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: false });
  });

  // Delta review of #388 at 33a8e0ad, S6. Send flushes the work first; when
  // that flush's own save proved a clear refused, the save landed everything
  // else, yet Send stopped on the first press and went on only on a second.
  // It goes on beside the standing notice, which it does not put away.
  it("lets Send go on, on its first press, when its own save proves a clear refused, and leaves the notice standing", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewrite(server, 9, [6], () => undefined);
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    // Keep mine is cut short after the save leaving every note lands: every note stays carried, Table 7's not yet found out of date.
    const sentBefore = savesSent();
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => (savesSent() === sentBefore + 3
      ? Promise.reject(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"))
      : api(...sent)));
    expect(await store().keepMine(false)).toBe(false);
    vi.mocked(configApi.publicBatchSave).mockImplementation(api);

    // The person clears their note on Table 7, which the maker has rewritten, and presses Send.
    store().setObjectNotes(tableId(6), "");
    expect(await prepareLayoutForGuestEnquiry(PLAN)).toBe(true);
    expect(store()).toMatchObject({ isDirty: false, noteClearsRefused: [tableId(6)], saveError: TABLE_7_NOT_REMOVED, saveErrorCode: "NOTE_HELD" });
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
    expect(saveStatusesNow()).toEqual({ status: "unsaved", slate: "not-saved" });
    // The flush left nothing for a second press to send.
    const sentAfter = savesSent();
    expect(await prepareLayoutForGuestEnquiry(PLAN)).toBe(true);
    expect(savesSent()).toBe(sentAfter);
    expect(store().noteClearsRefused).toEqual([tableId(6)]);
  });

  // Delta review of #388 at 33a8e0ad, S1. A layout switch waits for the open
  // layout's work, and answered "saved" when nothing was left unsaved, though
  // a clear it refused still stood: the next layout's load then wiped the
  // notice before anyone had seen it. Ruled: never "saved" while a refused
  // clear stands; the switch goes ahead, and the clear's sentence goes with
  // it, in the note the next layout shows, until the person dismisses it.
  const OTHER_PLAN = "0f0f0f0f-0000-4000-8000-000000000002";

  async function openAnotherLayout(): Promise<void> {
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({ ...plan([placed(D)], false), id: OTHER_PLAN, revision: 1 });
    await store().loadConfiguration(OTHER_PLAN, false);
    expect(store().configId).toBe(OTHER_PLAN);
  }

  it("never says a switch saved the work over a clear Keep mine refused, and the next layout says it (probe P3)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(6), ""); });

    // Keep mine, and in the same moment another layout is asked for: the switch waits for Keep mine's saves.
    const keeping = store().keepMine(false);
    const leaving = saveBeforeLayoutChange();
    expect(await keeping).toBe(false);
    expect(await leaving).toBe("clear-refused");
    expect(store()).toMatchObject({ isDirty: false, noteClearsRefused: [tableId(6)], saveError: TABLE_7_NOT_REMOVED });
    // The status never reads saved while the clear's notice stands (ruling R1(b)).
    expect(deriveEditorSaveStatus({ ...store(), refusedForHeldNote: refusedOverHeldNote(store().saveErrorCode) })).not.toBe("saved");

    // The switch goes ahead; the next layout carries the clear's sentence, and nothing else.
    await openAnotherLayout();
    expect(store().leftBehind).toMatchObject({ configId: PLAN, kept: null, notRemoved: TABLE_7_NOT_REMOVED });
    const note = store().leftBehind;
    expect(note === null ? null : leftBehindWords(note)).toBe(TABLE_7_NOT_REMOVED);
    // The person's next change there does not put it away: they do (ruling R1(b)).
    store().updateObject(D, { positionX: 2 });
    expect(store().leftBehind).toMatchObject({ notRemoved: TABLE_7_NOT_REMOVED });
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
  });

  it("carries a refused clear that already stands into the next layout's note when another layout opens", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(6), ""); });
    expect(await store().keepMine(false)).toBe(false);
    expect(store()).toMatchObject({ isDirty: false, noteClearsRefused: [tableId(6)] });

    // Nothing is unsaved, but the notice stands: a switch is not "saved".
    expect(await saveBeforeLayoutChange()).toBe("clear-refused");
    await openAnotherLayout();
    expect(store()).toMatchObject({ noteClearsRefused: [], saveError: null });
    expect(store().leftBehind).toMatchObject({ configId: PLAN, notRemoved: TABLE_7_NOT_REMOVED });
  });

  it("lets Show their version put a standing refused clear away: the person chose the other version (a decision on record)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    const tables = await theyRewrite(server, 9, [6], () => { store().setObjectNotes(tableId(6), ""); });
    expect(await store().keepMine(false)).toBe(false);
    expect(store().noteClearsRefused).toEqual([tableId(6)]);

    // Someone saves again; the person's next save meets their version, and they take it.
    theyNowHave(server, [placed(A), ...tables.map((id, index) => placed(id, { displayLabel: `Table ${String(index + 1)}`, noteHeld: true }, index + 1))]);
    store().updateObject(A, { positionX: 4 });
    expect(await store().saveToServer(false)).toBe(false);
    expect(store().saveConflict).not.toBeNull();
    await store().showTheirVersion(false);
    expect(store()).toMatchObject({ noteClearsRefused: [], saveError: null, saveConflict: null, leftBehind: null });
    expect(server.notes.get(tableId(6))).toBe(THEIR_NOTE);
  });
});

// ---------------------------------------------------------------------------
// Delta review of #388 at 33a8e0ad, S2 (major). The maker's browser presents
// the plan's claim secret, so #389 answers its saves with the rows as stored,
// every note in them (public-configs.ts: `madeHere ? saveResult.objects :
// withoutUnsentNotes(...)`). Restoring work this device kept before a save
// said what its notes were read with, it saves a copy that is not the whole
// truth about them (notesIncluded false), whose base holds the notes as read.
// When a note then changes with no new revision (the single-piece route), the
// halving leaves it to the server and the answer carries the new words. The
// piece was blanked on screen while the base held those words, so the next
// save named them as the note it replaced and cleared them. Ruled: a piece
// left to the server takes the answer's note when it carries one, and a note
// the base holds is never blanked. Put the other way round: after a save that
// left a piece's note to the server, this browser never names, as the note a
// piece's note replaces, words it did not show on that piece.
// ---------------------------------------------------------------------------

describe("the maker's browser, when a note it saved without the notes' word is changed with no new revision", () => {
  const OLD = "TEST ONLY by the window";
  const STAFF = "TEST ONLY staff rewrite";
  const OLD_C = "TEST ONLY wheelchair space";

  /**
   * The maker's browser restores work kept on this device before #388 (no
   * word on its notes): it reads the plan with its notes, B's included, and
   * saves the restored copy as one that is not the whole truth about them.
   * Staff then rewrite `rewritten`'s note through the single-piece route,
   * which makes no new revision. Every note on record is in the base, unmarked.
   */
  async function staffRewriteUnderTheMaker(server: PlanOnServer, rewritten: string): Promise<void> {
    persistAnonymousPlannerDraft({
      configId: PLAN, spaceId: SPACE, venueId: VENUE, configRevision: 4, isPublicPreview: true,
      objects: [kept(A, "", 5), kept(B, OLD), kept(C, OLD_C)], baseObjects: [kept(A), kept(B, OLD), kept(C, OLD_C)], isDirty: true,
    });
    serveTheApi(server, placed, { madeHere: true });
    await open(plan([placed(A), placed(B, { notes: OLD }), placed(C, { notes: OLD_C })], true));
    expect(store()).toMatchObject({ notesIncluded: false, isDirty: true });
    expect(heldNoteIds(store()).size).toBe(0);
    server.notes.set(rewritten, STAFF);
  }

  /** The words the person sees on a piece: its note, or none when it shows a note it holds that cannot be shown here. */
  function shownOn(id: string): string | null {
    return noteHeldOn(store(), id) ? null : noteOn(id) ?? null;
  }

  /** Every save from now on, with the words on `id` on screen as it went. */
  function watchSaves(id: string): { readonly shownAtSend: (string | null)[]; readonly firstSave: number } {
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    const shownAtSend: (string | null)[] = [];
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => {
      shownAtSend.push(shownOn(id));
      return api(...sent);
    });
    return { shownAtSend, firstSave: savesSent() };
  }

  it("keeps the note the server holds when it leaves it to the server, and no later save names it (probe P4)", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[B, OLD], [C, OLD_C]]) };
    await staffRewriteUnderTheMaker(server, B);

    // Refused for B's note, then saved leaving it to the server: the answer carries the staff's words.
    expect(await store().saveToServer(false)).toBe(true);
    expect(server.notes.get(B)).toBe(STAFF);
    // The maker's browser is shown that note, so B shows it: never an empty note over a note the base holds.
    expect(store().baseObjects.find((object) => object.id === B)?.notes).toBe(STAFF);
    expect({ onScreen: noteOn(B), isDirty: store().isDirty, saveError: store().saveError }).toEqual({ onScreen: STAFF, isDirty: false, saveError: null });

    // Two more saves of other work: neither names B's note, and the staff's words stand after both.
    for (const x of [6, 7]) {
      const sentBefore = savesSent();
      store().updateObject(A, { positionX: x });
      expect(await store().saveToServer(false)).toBe(true);
      expect(sentPiece(sentBefore, B).replacesNote).toBeUndefined();
      expect(server.notes.get(B)).toBe(STAFF);
    }
    expect(server.notes.get(C)).toBe(OLD_C);
  });

  it.each([
    ["leaves B's note as it was", (): void => undefined],
    ["clears B's note", (): void => { store().setObjectNotes(B, ""); }],
    ["writes their own words on B", (): void => { store().setObjectNotes(B, "TEST ONLY by the stage"); }],
  ])("never names words it did not show on a piece whose note it left to the server, when the person %s", async (_what, change) => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[B, OLD], [C, OLD_C]]) };
    await staffRewriteUnderTheMaker(server, B);
    change();
    const saves = watchSaves(B);

    await store().saveToServer(false);
    // Refused; every recorded note left (lands); B sent (refused: out of date); C sent and B left (lands).
    expect({ sent: savesSent() - saves.firstSave, revision: server.revision }).toEqual({ sent: 4, revision: 6 });
    expect(server.notes.get(B)).toBe(STAFF);
    const shownSince = new Set<string | null>([shownOn(B)]);
    const leftAt = savesSent();
    for (const x of [6, 7]) {
      store().updateObject(A, { positionX: x });
      await store().saveToServer(false);
      shownSince.add(shownOn(B));
    }
    for (let n = leftAt; n < savesSent(); n += 1) shownSince.add(saves.shownAtSend[n - saves.firstSave] ?? null);
    for (let n = leftAt; n < savesSent(); n += 1) {
      const named = sentPiece(n, B).replacesNote;
      expect(named === undefined || shownSince.has(named), `save ${String(n)} names "${String(named)}", never shown on B`).toBe(true);
    }
    expect(server.notes.get(B)).toBe(STAFF);
  });

  it("carries the notes a cut-short halving left unsettled, and no later save names words it did not show", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map([[B, OLD], [C, OLD_C]]) };
    await staffRewriteUnderTheMaker(server, C);
    const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
    if (api === undefined) throw new Error("no API model");
    // The refused save, then the save leaving every recorded note (it lands); the first halving is turned away.
    vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => (savesSent() === 3
      ? Promise.reject(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"))
      : api(...sent)));
    expect(await store().saveToServer(false)).toBe(false);
    expect(store()).toMatchObject({ saveErrorCode: "RATE_LIMITED", isDirty: true, configRevision: server.revision });
    expect({ b: noteOn(B), c: noteOn(C) }).toEqual({ b: OLD, c: OLD_C });

    vi.mocked(configApi.publicBatchSave).mockImplementation(api);
    const saves = watchSaves(C);
    for (const x of [6, 7]) {
      store().updateObject(A, { positionX: x });
      await store().saveToServer(false);
    }
    for (let n = saves.firstSave; n < savesSent(); n += 1) {
      const named = sentPiece(n, C).replacesNote;
      const shown = saves.shownAtSend[n - saves.firstSave];
      expect(named === undefined || named === shown, `save ${String(n)} names "${String(named)}" while C shows "${String(shown)}"`).toBe(true);
    }
    expect(server.notes.get(C)).toBe(STAFF);
    expect(server.notes.get(B)).toBe(OLD);
  });
});
