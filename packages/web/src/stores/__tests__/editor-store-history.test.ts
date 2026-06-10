import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useEditorStore,
  setEditorAutosaveRequester,
  type EditorObject,
} from "../editor-store.js";
import { useSelectionStore } from "../selection-store.js";
import { canUndo, canRedo, undoLabel } from "../../lib/editor-history.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import * as configApi from "../../api/configurations.js";
import type { BatchObjectInput, PlacedObject } from "../../api/configurations.js";

// ---------------------------------------------------------------------------
// editor-store × editor-history integration
//
// The store owns the single undo/redo timeline for the whole planner:
// every mutating action records an invertible delta, drags coalesce by
// interaction epoch, the timeline survives a server save via whole-
// history ID remapping, and undoing a delete of a server-persisted row
// resurrects it under a fresh local id (the batch route silently skips
// updates addressed to deleted rows — a dead id would lose the object).
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

vi.mock("../../lib/anonymous-planner-draft.js", () => ({
  persistAnonymousPlannerDraft: vi.fn(),
  readAnonymousPlannerDraft: vi.fn(() => null),
}));

const TABLE_ID = "round-table-6ft";
const TABLE_NAME = getCatalogueItem(TABLE_ID)?.name ?? "item";

let objSeq = 0;

function editorObj(id: string, over: Partial<EditorObject> = {}): EditorObject {
  return {
    id,
    assetDefinitionId: TABLE_ID,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 1,
    sortOrder: objSeq++,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
    notes: "",
    ...over,
  };
}

function seedEditor(objects: readonly EditorObject[] = []): void {
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: "cfg-1",
    spaceId: "space-1",
    venueId: "venue-1",
    configRevision: 1,
    isPublicPreview: true,
    objects,
  });
}

function store() {
  return useEditorStore.getState();
}

function objectIds(): readonly string[] {
  return store().objects.map((o) => o.id);
}

// Echo fake for the batch-save contract: response carries updates in
// input order first, then inserts in input order with fresh server ids —
// exactly what the real route returns.
let serverIdSeq = 0;

function toPlaced(o: BatchObjectInput, id: string): PlacedObject {
  return {
    id,
    configurationId: "cfg-1",
    assetDefinitionId: o.assetDefinitionId,
    positionX: String(o.positionX),
    positionY: String(o.positionY),
    positionZ: String(o.positionZ),
    rotationX: String(o.rotationX),
    rotationY: String(o.rotationY),
    rotationZ: String(o.rotationZ),
    scale: String(o.scale),
    sortOrder: o.sortOrder,
    metadata: o.metadata ?? null,
  };
}

function installEchoSave(): void {
  vi.mocked(configApi.publicBatchSave).mockImplementation(
    (_configId, batch, expectedRevision) => {
      const updates = batch.filter(
        (o): o is BatchObjectInput & { id: string } => o.id !== undefined,
      );
      const inserts = batch.filter((o) => o.id === undefined);
      return Promise.resolve({
        objects: [
          ...updates.map((o) => toPlaced(o, o.id)),
          ...inserts.map((o) => toPlaced(o, `srv-${String(++serverIdSeq)}`)),
        ],
        revision: expectedRevision + 1,
      });
    },
  );
}

let now = 0;

beforeEach(() => {
  vi.clearAllMocks();
  objSeq = 0;
  serverIdSeq = 0;
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  useSelectionStore.getState().clearSelection();
  setEditorAutosaveRequester(null);
  seedEditor();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Recording and labels
// ---------------------------------------------------------------------------

describe("history recording", () => {
  it("records a Place entry labelled with the catalogue name", () => {
    store().addObject(TABLE_ID, 1, 0, 2);
    expect(canUndo(store().history)).toBe(true);
    expect(undoLabel(store().history)).toBe(`Place ${TABLE_NAME}`);
  });

  it("records a Move entry for a position-only updateObject", () => {
    seedEditor([editorObj("a")]);
    store().updateObject("a", { positionX: 3 });
    expect(undoLabel(store().history)).toBe("Move item");
  });

  it("records a Rotate entry for a rotation-only updateObject", () => {
    seedEditor([editorObj("a")]);
    store().updateObject("a", { rotationY: Math.PI / 2 });
    expect(undoLabel(store().history)).toBe("Rotate item");
  });

  it("records one group entry for moveObjectsByDelta", () => {
    seedEditor([editorObj("a"), editorObj("b")]);
    store().moveObjectsByDelta(new Set(["a", "b"]), 1, -1);
    expect(store().history.past).toHaveLength(1);
    expect(undoLabel(store().history)).toBe("Move 2 items");
  });

  it("records an Edit note entry for setObjectNotes", () => {
    seedEditor([editorObj("a")]);
    store().setObjectNotes("a", "VIP table");
    expect(undoLabel(store().history)).toBe("Edit note");
  });

  it("records a Delete entry labelled with the catalogue name", () => {
    seedEditor([editorObj("a")]);
    store().removeObject("a");
    expect(undoLabel(store().history)).toBe(`Delete ${TABLE_NAME}`);
  });

  it("derives a Move label for a scene-funnel replacement", () => {
    seedEditor([editorObj("a"), editorObj("b")]);
    const moved = store().objects.map((o) =>
      o.id === "a" ? { ...o, positionX: 2 } : o,
    );
    store().replaceObjectsFromScene(moved);
    expect(undoLabel(store().history)).toBe("Move item");
    expect(store().isDirty).toBe(true);
  });

  it("derives a Place label when the scene funnel adds an object", () => {
    seedEditor([editorObj("a")]);
    store().replaceObjectsFromScene([...store().objects, editorObj("b")]);
    expect(undoLabel(store().history)).toBe(`Place ${TABLE_NAME}`);
  });

  it("records nothing when the scene funnel delivers identical content", () => {
    const objects = [editorObj("a")];
    seedEditor(objects);
    store().replaceObjectsFromScene(objects.map((o) => ({ ...o })));
    expect(canUndo(store().history)).toBe(false);
    expect(store().isDirty).toBe(false);
  });

  it("clears the redo future when a new entry is recorded", () => {
    seedEditor([editorObj("a")]);
    store().updateObject("a", { positionX: 1 });
    store().undo();
    expect(canRedo(store().history)).toBe(true);
    store().addObject(TABLE_ID, 0, 0, 0);
    expect(canRedo(store().history)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

describe("undo and redo", () => {
  it("undoes a placement and redoes it with the same local id", () => {
    store().addObject(TABLE_ID, 1, 0, 2);
    const placedId = objectIds()[0];
    expect(placedId).toBeDefined();

    store().undo();
    expect(store().objects).toHaveLength(0);

    store().redo();
    expect(objectIds()).toEqual([placedId]);
    expect(store().objects[0]?.positionX).toBe(1);
  });

  it("restores the previous transform when undoing an update", () => {
    seedEditor([editorObj("a", { positionX: 5, rotationY: 1 })]);
    store().updateObject("a", { positionX: 9, rotationY: 2 });
    store().undo();
    expect(store().objects[0]?.positionX).toBe(5);
    expect(store().objects[0]?.rotationY).toBe(1);
  });

  it("re-inserts a removed object at its original index", () => {
    // Unsaved (local-) ids are never healed, so identity is preserved and
    // this isolates pure index restoration. Deletes of server-persisted
    // rows are pinned by the dead-id healing suite below.
    seedEditor([editorObj("local-a"), editorObj("local-b"), editorObj("local-c")]);
    store().removeObject("local-b");
    expect(objectIds()).toEqual(["local-a", "local-c"]);
    store().undo();
    expect(objectIds()).toEqual(["local-a", "local-b", "local-c"]);
  });

  it("is a no-op when there is nothing to undo or redo", () => {
    seedEditor([editorObj("a")]);
    const before = store().objects;
    store().undo();
    store().redo();
    expect(store().objects).toBe(before);
    expect(store().isDirty).toBe(false);
  });

  it("restores the selection captured before the change", () => {
    seedEditor([editorObj("a"), editorObj("b")]);
    useSelectionStore.getState().selectMultiple(["a", "b"]);
    store().moveObjectsByDelta(new Set(["a", "b"]), 2, 0);
    useSelectionStore.getState().clearSelection();
    store().deselectObject();

    store().undo();
    expect([...useSelectionStore.getState().selectedIds].sort()).toEqual(["a", "b"]);
    expect(store().selectedObjectId).toBe("a");
  });

  it("falls back to selectedObjectId when the selection store is empty", () => {
    seedEditor([editorObj("a")]);
    store().selectObject("a");
    store().updateObject("a", { positionX: 4 });
    store().deselectObject();

    store().undo();
    expect([...useSelectionStore.getState().selectedIds]).toEqual(["a"]);
    expect(store().selectedObjectId).toBe("a");
  });

  it("marks the document dirty and requests an autosave", () => {
    const requester = vi.fn();
    setEditorAutosaveRequester(requester);
    store().addObject(TABLE_ID, 0, 0, 0);
    useEditorStore.setState({ isDirty: false });

    store().undo();
    expect(store().isDirty).toBe(true);
    expect(requester).toHaveBeenCalledTimes(1);

    store().redo();
    expect(requester).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Coalescing and interaction epochs
// ---------------------------------------------------------------------------

describe("coalescing", () => {
  it("coalesces rapid moves of the same items into one entry", () => {
    seedEditor([editorObj("a")]);
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);
    now += 16;
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);
    now += 16;
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);

    expect(store().history.past).toHaveLength(1);
    store().undo();
    expect(store().objects[0]?.positionX).toBe(0);
    expect(canUndo(store().history)).toBe(false);
  });

  it("fences coalescing when bumpHistoryEpoch is called between moves", () => {
    seedEditor([editorObj("a")]);
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);
    store().bumpHistoryEpoch();
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);

    expect(store().history.past).toHaveLength(2);
    store().undo();
    expect(store().objects[0]?.positionX).toBe(1);
  });

  it("fences coalescing after a pause longer than the coalesce window", () => {
    seedEditor([editorObj("a")]);
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);
    now += 5_000;
    store().moveObjectsByDelta(new Set(["a"]), 1, 0);

    expect(store().history.past).toHaveLength(2);
  });

  it("leaves no entry when a coalesced drag returns to its start", () => {
    seedEditor([editorObj("a")]);
    store().moveObjectsByDelta(new Set(["a"]), 1.5, 0);
    now += 16;
    store().moveObjectsByDelta(new Set(["a"]), -1.5, 0);

    expect(canUndo(store().history)).toBe(false);
  });

  it("coalesces scene-funnel drag frames within one epoch", () => {
    seedEditor([editorObj("a"), editorObj("b")]);
    const frame = (x: number): readonly EditorObject[] =>
      store().objects.map((o) => (o.id === "a" ? { ...o, positionX: x } : o));
    store().replaceObjectsFromScene(frame(1));
    now += 16;
    store().replaceObjectsFromScene(frame(2));
    now += 16;
    store().replaceObjectsFromScene(frame(3));

    expect(store().history.past).toHaveLength(1);
    store().undo();
    expect(store().objects[0]?.positionX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Server save — whole-history id remapping
// ---------------------------------------------------------------------------

describe("save remap", () => {
  it("remaps local ids across the timeline so undo targets server rows", async () => {
    store().addObject(TABLE_ID, 1, 0, 1);
    store().addObject(TABLE_ID, 2, 0, 2);
    installEchoSave();

    await store().saveToServer();
    expect(objectIds()).toEqual(["srv-1", "srv-2"]);

    store().undo();
    expect(objectIds()).toEqual(["srv-1"]);
    store().undo();
    expect(store().objects).toHaveLength(0);
  });

  it("zips only inserted rows, skipping updated server rows", async () => {
    seedEditor([editorObj("srv-existing", { positionX: 1 })]);
    store().moveObjectsByDelta(new Set(["srv-existing"]), 2, 0);
    store().addObject(TABLE_ID, 5, 0, 5);
    installEchoSave();

    await store().saveToServer();
    const ids = objectIds();
    expect(ids[0]).toBe("srv-existing");
    expect(ids[1]).toMatch(/^srv-/);

    store().undo();
    expect(objectIds()).toEqual(["srv-existing"]);
    store().undo();
    expect(store().objects[0]?.positionX).toBe(1);
  });

  it("remaps live selection ids after a save", async () => {
    store().addObject(TABLE_ID, 1, 0, 1);
    const localId = objectIds()[0] ?? "";
    useSelectionStore.getState().selectMultiple([localId]);
    store().selectObject(localId);
    installEchoSave();

    await store().saveToServer();
    expect([...useSelectionStore.getState().selectedIds]).toEqual(["srv-1"]);
    expect(store().selectedObjectId).toBe("srv-1");
  });

  it("clears the history when the echo's insert count cannot be aligned", async () => {
    store().addObject(TABLE_ID, 1, 0, 1);
    vi.mocked(configApi.publicBatchSave).mockResolvedValue({
      objects: [],
      revision: 2,
    });

    const ok = await store().saveToServer();
    expect(ok).toBe(true);
    expect(canUndo(store().history)).toBe(false);
    expect(canRedo(store().history)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dead-id healing — resurrection must never reuse a server id
// ---------------------------------------------------------------------------

describe("dead-id healing", () => {
  it("redo of a placement after save re-inserts under a fresh local id", async () => {
    store().addObject(TABLE_ID, 1, 0, 1);
    installEchoSave();
    await store().saveToServer();
    expect(objectIds()).toEqual(["srv-1"]);

    store().undo();
    expect(store().objects).toHaveLength(0);

    store().redo();
    const resurrected = store().objects[0];
    expect(resurrected?.id).toMatch(/^local-/);
    expect(resurrected?.positionX).toBe(1);
  });

  it("undo of a delete after save resurrects under a fresh local id", async () => {
    store().addObject(TABLE_ID, 3, 0, 3);
    installEchoSave();
    await store().saveToServer();

    store().removeObject("srv-1");
    store().undo();

    const resurrected = store().objects[0];
    expect(resurrected?.id).toMatch(/^local-/);
    expect(resurrected?.id).not.toBe("srv-1");
    expect(resurrected?.positionX).toBe(3);
  });

  it("healing remaps the rest of the timeline so deeper undos still work", async () => {
    store().addObject(TABLE_ID, 3, 0, 3);
    installEchoSave();
    await store().saveToServer();

    store().removeObject("srv-1");
    store().undo();
    store().undo();

    expect(store().objects).toHaveLength(0);
    expect(canUndo(store().history)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — loading a document starts a fresh timeline
// ---------------------------------------------------------------------------

describe("lifecycle clears", () => {
  it("loadConfiguration starts a fresh history", async () => {
    store().addObject(TABLE_ID, 0, 0, 0);
    expect(canUndo(store().history)).toBe(true);
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({
      id: "cfg-2",
      spaceId: "space-1",
      venueId: "venue-1",
      userId: null,
      name: "Layout",
      isPublicPreview: true,
      revision: 1,
      objects: [],
    });

    await store().loadConfiguration("cfg-2");
    expect(canUndo(store().history)).toBe(false);
  });

  it("createPublicConfig starts a fresh history", async () => {
    store().addObject(TABLE_ID, 0, 0, 0);
    vi.mocked(configApi.createPublicConfig).mockResolvedValue({
      id: "cfg-3",
      spaceId: "space-1",
      venueId: "venue-1",
      userId: null,
      name: "Layout",
      isPublicPreview: true,
      revision: 1,
      objects: [],
    });

    await store().createPublicConfig("space-1");
    expect(canUndo(store().history)).toBe(false);
  });

  it("reset clears the history", () => {
    store().addObject(TABLE_ID, 0, 0, 0);
    store().reset();
    expect(canUndo(store().history)).toBe(false);
  });
});
