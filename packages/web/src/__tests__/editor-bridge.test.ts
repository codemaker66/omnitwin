import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Editor bridge + selection integration tests
// ---------------------------------------------------------------------------

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  claimConfig: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
}));

const { useEditorStore } = await import("../stores/editor-store.js");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
});

describe("selectedObjectId", () => {
  it("is null by default", () => {
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it("selectObject sets selectedObjectId", () => {
    useEditorStore.getState().selectObject("obj-1");
    expect(useEditorStore.getState().selectedObjectId).toBe("obj-1");
  });

  it("deselectObject clears selectedObjectId", () => {
    useEditorStore.getState().selectObject("obj-1");
    useEditorStore.getState().deselectObject();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it("removeObject deselects if removed object was selected", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";
    useEditorStore.getState().selectObject(id);
    expect(useEditorStore.getState().selectedObjectId).toBe(id);

    useEditorStore.getState().removeObject(id);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it("removeObject keeps selection if different object removed", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useEditorStore.getState().addObject("a2", 1, 0, 1);
    const [first, second] = useEditorStore.getState().objects;
    useEditorStore.getState().selectObject(second?.id ?? "");

    useEditorStore.getState().removeObject(first?.id ?? "");
    expect(useEditorStore.getState().selectedObjectId).toBe(second?.id);
  });
});

describe("rotation via updateObject", () => {
  it("rotates object by updating rotationY", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";

    useEditorStore.getState().updateObject(id, { rotationY: Math.PI / 4 });

    const obj = useEditorStore.getState().objects[0];
    expect(obj?.rotationY).toBeCloseTo(Math.PI / 4);
  });
});

describe("EditorBridge component", () => {
  it("exports EditorBridge", async () => {
    const { EditorBridge } = await import("../components/editor/EditorBridge.js");
    expect(typeof EditorBridge).toBe("function");
  });
});

describe("keyboard-driven actions", () => {
  it("delete selected: removeObject + deselect", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";
    useEditorStore.getState().selectObject(id);

    // Simulate Delete key action
    useEditorStore.getState().removeObject(id);

    expect(useEditorStore.getState().objects).toHaveLength(0);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it("R key rotates selected: updateObject with +45deg", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";
    useEditorStore.getState().selectObject(id);

    const current = useEditorStore.getState().objects[0]?.rotationY ?? 0;
    useEditorStore.getState().updateObject(id, { rotationY: current + Math.PI / 4 });

    expect(useEditorStore.getState().objects[0]?.rotationY).toBeCloseTo(Math.PI / 4);
  });
});
