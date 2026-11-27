import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useEditorStore, type EditorObject } from "../../../stores/editor-store.js";
import { flushAutoSave, scheduleAutoSave, watchReconnectAutosave } from "../EditorBridge.js";

// ---------------------------------------------------------------------------
// The autosave contract, tested by behaviour rather than by source text.
//
// Two defects, both of which get worse the moment a second writer exists:
//
// 1. scheduleAutoSave CONSUMED THE TICK. Its timer body was
//    `if (state.isDirty && !state.isSaving && ...)`. Firing while a save was
//    in flight matched nothing and rescheduled nothing, so the dirty state
//    sat there until the operator happened to make another gesture. If they
//    stopped editing — which is exactly what someone does when they have
//    finished — it was never saved at all.
//
// 2. flushAutoSave LIED. With a save in flight it fell through to
//    `return true`, whose documented meaning is "the server holds the latest
//    state". An in-flight save carries the objects as they were when it
//    started, so send-layout-flow and SubmitForReviewPanel could tell the
//    venue's enquiry and the hallkeeper review that the layout was flushed
//    while newer objects had never been pushed. That is not merely a bug:
//    reporting success over a stale layout is an unfounded claim.
//
// The existing coverage in save-send-panel.test.ts asserts on the SOURCE TEXT
// of this module (that the identifier appears, that clearTimeout follows it),
// which cannot catch a wrong return value. These are the behavioural tests.
// ---------------------------------------------------------------------------

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true }) },
}));

type EditorState = ReturnType<typeof useEditorStore.getState>;

function setStore(patch: Partial<EditorState>): void {
  useEditorStore.setState(patch);
}

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.setState({
    configId: "cfg-autosave",
    configRevision: 1,
    isDirty: false,
    isSaving: false,
    isOnline: true,
    saveConflict: null,
  });
});

describe("offline and back", () => {
  it("does not spend the autosave tick on a save that can only fail offline", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, isOnline: false, saveToServer });
    scheduleAutoSave(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveToServer).not.toHaveBeenCalled();
  });

  it("saves again when the browser comes back online with unsaved work", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, isOnline: false, saveToServer });
    const stop = watchReconnectAutosave(() => true);
    try {
      setStore({ isOnline: true });
      await vi.advanceTimersByTimeAsync(999);
      expect(saveToServer).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(saveToServer).toHaveBeenCalledTimes(1);
      expect(saveToServer).toHaveBeenCalledWith(true);
    } finally {
      stop();
    }
  });

  it("leaves a conflict for the person to decide, and has nothing to send when nothing is unsaved", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    const stop = watchReconnectAutosave(() => true);
    try {
      setStore({ isDirty: true, isOnline: false, saveToServer, saveConflict: {
        expectedRevision: 1, currentRevision: 2, message: "changed",
        changedBy: null, changedAt: null, byYou: false, theirChange: null,
      } });
      setStore({ isOnline: true });
      setStore({ isOnline: false, saveConflict: null, isDirty: false });
      setStore({ isOnline: true });
      await vi.advanceTimersByTimeAsync(5000);
      expect(saveToServer).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

describe("a conflict waiting for the person's choice", () => {
  it("spends no autosave tick on it, however many edits follow, and saves again once it is settled", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, saveToServer, saveConflict: {
      expectedRevision: 1, currentRevision: 2, message: "changed",
      changedBy: null, changedAt: null, byYou: false, theirChange: null,
    } });
    for (let edit = 0; edit < 3; edit += 1) {
      scheduleAutoSave(false);
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(saveToServer).not.toHaveBeenCalled();

    setStore({ saveConflict: null });
    scheduleAutoSave(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });
});

// Delta review of #388, D5. A save the API refused because the person's words
// stand over a note this browser is not shown (409 NOTE_HELD) is refused again
// until those words come off. Each edit used to send it anyway: a request per
// edit, the refusal raised each time, and a guest's save allowance spent on it.
describe("a save refused because the person's words stand over a note this browser is not shown", () => {
  const REFUSAL = "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece.";

  function piece(id: string, notes: string, noteHeld?: true): EditorObject {
    return {
      id, assetDefinitionId: "banquet-chair", positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
      notes, ...(noteHeld === true ? { noteHeld } : {}),
    };
  }

  afterEach(() => {
    setStore({ objects: [], baseObjects: [], saveError: null, saveErrorCode: null, isPublicPreview: false, notesIncluded: false });
  });

  it("spends no autosave tick while those words stand, however many edits follow, and saves once they are off", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({
      isDirty: true, saveToServer, isPublicPreview: true, notesIncluded: false,
      baseObjects: [piece("t3", "", true), piece("t4", "")],
      objects: [piece("t3", "TEST ONLY typed over"), piece("t4", "")],
      saveError: REFUSAL, saveErrorCode: "NOTE_HELD",
    });
    for (let edit = 0; edit < 3; edit += 1) {
      scheduleAutoSave(false);
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(saveToServer).not.toHaveBeenCalled();

    // Their words come off the piece: the save can land now, and goes at the next tick.
    setStore({ objects: [piece("t3", ""), piece("t4", "")] });
    scheduleAutoSave(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("goes on saving after such a refusal that no words of theirs explain", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({
      isDirty: true, saveToServer, isPublicPreview: true, notesIncluded: false,
      baseObjects: [piece("t3", "", true), piece("t4", "")],
      objects: [piece("t3", ""), piece("t4", "")],
      saveError: REFUSAL, saveErrorCode: "NOTE_HELD",
    });
    scheduleAutoSave(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduleAutoSave coalesces instead of dropping the tick", () => {
  it("saves once the in-flight save finishes, with no further gesture from the operator", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, isSaving: true, saveToServer });

    scheduleAutoSave(true);
    await vi.advanceTimersByTimeAsync(3000);
    // A save was in flight, so nothing should have been attempted yet...
    expect(saveToServer).not.toHaveBeenCalled();

    // ...and when it settles, the pending dirty state must still get saved
    // WITHOUT the operator touching anything.
    setStore({ isSaving: false });
    await vi.advanceTimersByTimeAsync(3000);

    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("still debounces normally when nothing is in flight", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, isSaving: false, saveToServer });

    scheduleAutoSave(true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(saveToServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });
});

describe("flushAutoSave reports only what is true", () => {
  it.each([false, true])("does not flush another session after its awaited save is superseded (return to original ID: %s)", async (returnToOriginal) => {
    setStore({ isSaving: true });
    const flushing = flushAutoSave();
    useEditorStore.getState().reset();
    const nextSave = vi.fn(() => Promise.resolve(true));
    setStore({ configId: "B", isDirty: true, isSaving: false, saveToServer: nextSave });
    if (returnToOriginal) {
      useEditorStore.getState().reset();
      setStore({ configId: "cfg-autosave", isDirty: true, isSaving: false });
    }
    await expect(flushing).resolves.toBe(false);
    expect(nextSave).not.toHaveBeenCalled();
  });

  it("waits for an in-flight save and then pushes what is still dirty", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: true, isSaving: true, saveToServer });

    const flushing = flushAutoSave();
    let settled = false;
    void flushing.then(() => { settled = true; });

    // It must NOT have resolved already — an in-flight save carries the
    // objects from when it started, not the ones on screen now.
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);

    setStore({ isSaving: false });
    await vi.advanceTimersByTimeAsync(50);

    await expect(flushing).resolves.toBe(true);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("returns true immediately when the server already holds the latest state", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    setStore({ isDirty: false, isSaving: false, saveToServer });

    await expect(flushAutoSave()).resolves.toBe(true);
    expect(saveToServer).not.toHaveBeenCalled();
  });

  it("reports failure when the save it waited for could not be pushed", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(false));
    setStore({ isDirty: true, isSaving: false, saveToServer });

    await expect(flushAutoSave()).resolves.toBe(false);
  });
});
