import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import type { BatchObjectInput, PlacedObject } from "../../api/configurations.js";
import { editorHistoryTravels, useEditorStore, type EditorObject } from "../editor-store.js";

// ---------------------------------------------------------------------------
// The timeline's travels (T-700, R87). The set-down sound must never voice a
// landing whose gesture an undo, a redo, a reset or a load left behind, and
// must voice every other one, a drag that snaps back to where it began
// included (that gesture's step is dropped from the timeline, but nothing
// travelled). So the store counts its travels itself, and nothing else moves
// the count.
// ---------------------------------------------------------------------------

vi.mock("../../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
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
vi.mock("../../api/spaces.js", () => ({ getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))) }));
vi.mock("../../api/action-log.js", () => ({ postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })) }));

const LAYOUT = "00000000-0000-4000-8000-00000000c0f1";
const SPACE = "00000000-0000-4000-8000-000000000051";
const VENUE = "00000000-0000-4000-8000-0000000000a1";

function chair(id: string, positionX: number): EditorObject {
  return {
    id, assetDefinitionId: "chiavari-chair", positionX, positionY: 0, positionZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null, notes: "",
  };
}

function wire(id: string, positionX: number): PlacedObject {
  return { id, configurationId: LAYOUT, assetDefinitionId: "chiavari-chair", positionX: positionX.toFixed(3), positionY: "0.000", positionZ: "1.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0, metadata: null };
}

function seed(objects: readonly EditorObject[]): void {
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: LAYOUT, spaceId: SPACE, venueId: VENUE, configRevision: 1, isPublicPreview: true, objects, baseObjects: objects });
}

/** How many travels `step` makes. */
async function travelsOf(step: () => unknown): Promise<number> {
  const before = editorHistoryTravels();
  await step();
  return editorHistoryTravels() - before;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(configApi.getPublicConfig).mockReset();
  vi.mocked(configApi.publicBatchSave).mockReset();
  seed([chair("local-1", 2)]);
});

afterEach(() => {
  useEditorStore.getState().reset();
  localStorage.clear();
});

describe("the timeline's travels (R87)", () => {
  it("counts each undo, redo, reset and load once", async () => {
    useEditorStore.getState().updateObject("local-1", { positionX: 4 });
    expect(await travelsOf(() => { useEditorStore.getState().undo(); })).toBe(1);
    expect(await travelsOf(() => { useEditorStore.getState().redo(); })).toBe(1);
    expect(await travelsOf(() => { useEditorStore.getState().reset(); })).toBe(1);
    vi.mocked(configApi.getPublicConfig).mockResolvedValue({
      id: LAYOUT, spaceId: SPACE, venueId: VENUE, userId: null, name: "Burns supper", isPublicPreview: true,
      revision: 3, objects: [wire("00000000-0000-4000-8000-000000000001", 2)], updatedAt: "2026-11-22T10:00:00.000Z",
    });
    expect(await travelsOf(() => useEditorStore.getState().loadConfiguration(LAYOUT, false))).toBe(1);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it("never goes back: a reset keeps counting from where it was", () => {
    const before = editorHistoryTravels();
    useEditorStore.getState().reset();
    useEditorStore.getState().reset();
    expect(editorHistoryTravels()).toBe(before + 2);
  });

  it("does not count an undo or redo with nothing to step, nor a load the server refuses", async () => {
    expect(await travelsOf(() => { useEditorStore.getState().undo(); })).toBe(0);
    expect(await travelsOf(() => { useEditorStore.getState().redo(); })).toBe(0);
    vi.mocked(configApi.getPublicConfig).mockRejectedValue(new Error("offline"));
    expect(await travelsOf(() => useEditorStore.getState().loadConfiguration(LAYOUT, false))).toBe(0);
  });

  it("does not count new changes, gestures, a gesture that ends where it began, or the epoch the key edits move", () => {
    const before = editorHistoryTravels();
    const store = useEditorStore.getState();
    store.addObject("chiavari-chair", 5, 0, 5);
    store.updateObject("local-1", { positionX: 3 });
    // A drag away and back in one gesture: its step is dropped from the timeline, and nothing travelled.
    const token = store.beginHistoryGesture();
    const start = useEditorStore.getState().objects;
    store.replaceObjectsFromScene(start.map((object) => object.id === "local-1" ? { ...object, positionX: 3.3 } : object));
    store.replaceObjectsFromScene(start);
    if (token !== null) store.endHistoryGesture(token);
    store.bumpHistoryEpoch();
    store.removeObject("local-1");
    expect(useEditorStore.getState().history.past.length).toBeGreaterThan(0);
    expect(editorHistoryTravels()).toBe(before);
  });

  it("does not count a save that gives placed pieces the server's ids", async () => {
    useEditorStore.getState().addObject("chiavari-chair", 5, 0, 5);
    vi.mocked(configApi.publicBatchSave).mockImplementation((_id, batch: readonly BatchObjectInput[]) => Promise.resolve({
      revision: 2,
      objects: batch.map((item, index) => wire(item.id ?? `00000000-0000-4000-8000-00000000000${String(index + 2)}`, item.positionX)),
    }));
    expect(await travelsOf(() => useEditorStore.getState().saveToServer(false))).toBe(0);
    expect(vi.mocked(configApi.publicBatchSave)).toHaveBeenCalled();
  });
});
