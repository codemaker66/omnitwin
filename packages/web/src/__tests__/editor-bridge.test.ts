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

  // -------------------------------------------------------------------------
  // Mount uniqueness: a second concurrent EditorBridge logs a console.error
  // so a future refactor that accidentally double-mounts the bridge surfaces
  // the regression in any console (browser, CI, server) without taking the
  // user offline. We don't throw because a sync-flag mistake shouldn't
  // white-screen the editor — loud warning is the right runtime behaviour.
  // -------------------------------------------------------------------------
  it("logs an error if a second EditorBridge mounts concurrently", async () => {
    const React = await import("react");
    const { render, cleanup } = await import("@testing-library/react");
    const { EditorBridge, __resetEditorBridgeMountCountForTests } = await import("../components/editor/EditorBridge.js");

    __resetEditorBridgeMountCountForTests();
    useEditorStore.setState({ configId: "cfg-uniq" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });

    const { unmount: unmount1 } = render(React.createElement(EditorBridge));
    const { unmount: unmount2 } = render(React.createElement(EditorBridge));

    const warned = errSpy.mock.calls.some((call) => {
      const msg = call[0];
      return typeof msg === "string" && msg.includes("EditorBridge mounted more than once");
    });
    expect(warned).toBe(true);

    errSpy.mockRestore();
    unmount2();
    unmount1();
    cleanup();
    __resetEditorBridgeMountCountForTests();
  });

  // -------------------------------------------------------------------------
  // Sync-flag pin: a placement-store update should round-trip into the
  // editor-store EXACTLY ONCE per change. Without the `syncing` ref, the
  // editor→placement effect would re-fire on the placement→editor write,
  // bouncing forever. We mount the bridge, push a placement, and assert
  // that React's effects settled inside one tick (no infinite loop), and
  // that the editor-store has the new item but didn't accumulate
  // duplicates from a self-echo.
  // -------------------------------------------------------------------------
  it("placement-store update flows into editor-store exactly once (no self-echo)", async () => {
    const React = await import("react");
    const { render, cleanup } = await import("@testing-library/react");
    const { EditorBridge, __resetEditorBridgeMountCountForTests } = await import("../components/editor/EditorBridge.js");
    const { usePlacementStore } = await import("../stores/placement-store.js");

    // Reset the singleton counter from the previous test run.
    __resetEditorBridgeMountCountForTests();
    // Seed a configId so the placement→editor effect is enabled
    useEditorStore.setState({ configId: "cfg-test" });
    usePlacementStore.setState({ placedItems: [] });

    const { unmount } = render(React.createElement(EditorBridge));

    // Push directly into placement-store to simulate a user interaction.
    usePlacementStore.setState({
      placedItems: [
        { id: "p1", catalogueItemId: "round-table", x: 1, y: 0, z: 2, rotationY: 0, clothed: false, groupId: null },
      ],
    });

    // Yield to React for the subscription effect to flush.
    await new Promise((r) => { setTimeout(r, 0); });

    const editorObjects = useEditorStore.getState().objects;
    expect(editorObjects).toHaveLength(1);
    expect(editorObjects[0]?.id).toBe("p1");

    // The placement store should still have exactly one item — if the
    // sync-flag had failed, the editor→placement effect would have
    // re-fired on its own write and we'd see a thrash signature here.
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);

    unmount();
    cleanup();
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
