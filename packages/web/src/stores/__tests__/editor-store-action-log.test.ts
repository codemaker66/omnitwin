import { describe, it, expect, beforeEach, vi } from "vitest";
import { beginActionLogForConfig, useEditorStore } from "../editor-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useSelectionStore } from "../selection-store.js";

// ---------------------------------------------------------------------------
// editor-store × action-log integration (G4 Slice 1).
//
// The undo timeline's behaviour is pinned by editor-store-history.test.ts and
// must not change; THIS suite proves the side channel: every completed
// gesture lands in the append-only action log with the right intent, and
// undo/redo write their own history.* records.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", () => ({
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
  updatePublicThumbnail: vi.fn(),
  claimConfig: vi.fn(),
  patchConfigMetadata: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

const TABLE_ID = "round-table-6ft";

function store(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState();
}

function loggedIntents(): readonly string[] {
  return useActionLogStore.getState().entries.map((entry) => entry.intent);
}

beforeEach(() => {
  useEditorStore.setState({
    configId: "cfg-log-test",
    objects: [],
    history: { past: [], future: [] },
    selectedObjectId: null,
  });
  useSelectionStore.getState().clearSelection();
  useActionLogStore.getState().reset();
  // The real config boundary: opens the log AND resets the seal cursor
  // (gesture seqs restart at 1 on the fresh timeline set above).
  beginActionLogForConfig("cfg-log-test");
});

describe("editor-store action log emission", () => {
  it("logs one action per completed gesture and history.* records for undo/redo", () => {
    // Place a table: the gesture opens but is not sealed yet.
    store().addObject(TABLE_ID, 1, 0, 2);
    expect(loggedIntents()).toEqual([]);

    // A new gesture (separate epoch) seals the place.
    store().bumpHistoryEpoch();
    const placed = store().objects[0];
    if (placed === undefined) throw new Error("expected a placed object");
    store().updateObject(placed.id, { positionX: 5 });
    expect(loggedIntents()).toEqual(["object.place"]);

    // Undo seals the open move, then records the undo itself.
    store().undo();
    expect(loggedIntents()).toEqual(["object.place", "object.update", "history.undo"]);

    // Redo records its own entry without re-emitting the gesture.
    store().redo();
    expect(loggedIntents()).toEqual([
      "object.place",
      "object.update",
      "history.undo",
      "history.redo",
    ]);
  });

  it("stamps actions with the operator actor and planner surface", () => {
    store().addObject(TABLE_ID, 0, 0, 0);
    store().bumpHistoryEpoch();
    store().removeObject(store().objects[0]?.id ?? "");
    const first = useActionLogStore.getState().entries[0];
    expect(first?.actor.kind).toBe("operator");
    expect(first?.provenance.surface).toBe("planner");
    expect(first?.intent).toBe("object.place");
  });

  it("object notes ride the engine path — setObjectNotes lands as object.update (slice-2 audit correction)", () => {
    // The G4 programme audit listed object notes as API-direct; they are
    // not — setObjectNotes records through editor-history, so Slice 1
    // already covers them. This pins that coverage.
    store().addObject(TABLE_ID, 1, 0, 2);
    store().bumpHistoryEpoch();
    const placed = store().objects[0];
    if (placed === undefined) throw new Error("expected a placed object");
    store().setObjectNotes(placed.id, "VIP table — board seated here");
    store().undo(); // seals the open notes gesture, then logs the undo

    expect(loggedIntents()).toEqual(["object.place", "object.update", "history.undo"]);
    const notesAction = useActionLogStore.getState().entries[1];
    expect((notesAction?.payload as { label: string }).label).toBe("Edit note");
  });

  it("undo/redo behaviour itself is untouched (spot check alongside the pinned suite)", () => {
    store().addObject(TABLE_ID, 1, 0, 2);
    store().bumpHistoryEpoch();
    expect(store().objects).toHaveLength(1);
    store().undo();
    expect(store().objects).toHaveLength(0);
    store().redo();
    expect(store().objects).toHaveLength(1);
  });
});
