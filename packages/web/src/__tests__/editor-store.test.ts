import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Editor store tests — mock API modules
// ---------------------------------------------------------------------------

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
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

const configMock = vi.mocked(await import("../api/configurations.js"));

const { useEditorStore, editorToBatch } = await import("../stores/editor-store.js");
const { getCatalogueItemBySlug } = await import("../lib/catalogue.js");

const CHAIR_ID = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair-id";
const ROUND_TABLE_ID = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-round-table-id";

const mockConfig = {
  id: "cfg-1",
  spaceId: "s-1",
  venueId: "v-1",
  userId: null,
  name: "Test Layout",
  isPublicPreview: true,
  objects: [
    {
      id: "obj-1", configurationId: "cfg-1", assetDefinitionId: "a-1",
      positionX: "1.0", positionY: "0.0", positionZ: "2.0",
      rotationX: "0.0", rotationY: "0.0", rotationZ: "0.0",
      scale: "1.0", sortOrder: 0, metadata: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
});

describe("loadConfiguration", () => {
  it("populates state from API", async () => {
    configMock.getPublicConfig.mockResolvedValue(mockConfig);

    await useEditorStore.getState().loadConfiguration("cfg-1");

    const s = useEditorStore.getState();
    expect(s.configId).toBe("cfg-1");
    expect(s.spaceId).toBe("s-1");
    expect(s.isPublicPreview).toBe(true);
    expect(s.objects).toHaveLength(1);
    expect(s.objects[0]?.positionX).toBe(1.0);
    expect(s.isDirty).toBe(false);
    expect(s.isLoading).toBe(false);
  });

  it("sets error on failure", async () => {
    configMock.getPublicConfig.mockRejectedValue(new Error("Not found"));

    await useEditorStore.getState().loadConfiguration("bad");

    expect(useEditorStore.getState().error).toBe("Not found");
    expect(useEditorStore.getState().isLoading).toBe(false);
  });

  // Punch list #2 / #33: load path must branch on auth state.
  // The previous version always called getPublicConfig, which silently
  // depended on the backend's permissive no-filter behavior.
  it("uses public endpoint when called without auth flag", async () => {
    configMock.getPublicConfig.mockResolvedValue(mockConfig);
    configMock.getConfig.mockResolvedValue(mockConfig);

    await useEditorStore.getState().loadConfiguration("cfg-1");

    expect(configMock.getPublicConfig).toHaveBeenCalledWith("cfg-1");
    expect(configMock.getConfig).not.toHaveBeenCalled();
  });

  it("uses public endpoint when isAuthenticated is false", async () => {
    configMock.getPublicConfig.mockResolvedValue(mockConfig);
    configMock.getConfig.mockResolvedValue(mockConfig);

    await useEditorStore.getState().loadConfiguration("cfg-1", false);

    expect(configMock.getPublicConfig).toHaveBeenCalledWith("cfg-1");
    expect(configMock.getConfig).not.toHaveBeenCalled();
  });

  it("uses authenticated endpoint when isAuthenticated is true", async () => {
    configMock.getPublicConfig.mockResolvedValue(mockConfig);
    configMock.getConfig.mockResolvedValue(mockConfig);

    await useEditorStore.getState().loadConfiguration("cfg-1", true);

    expect(configMock.getConfig).toHaveBeenCalledWith("cfg-1");
    expect(configMock.getPublicConfig).not.toHaveBeenCalled();
  });
});

describe("addObject", () => {
  it("adds object and marks dirty", () => {
    useEditorStore.getState().addObject("asset-1", 5, 0, 3);

    const s = useEditorStore.getState();
    expect(s.objects).toHaveLength(1);
    expect(s.objects[0]?.assetDefinitionId).toBe("asset-1");
    expect(s.objects[0]?.positionX).toBe(5);
    expect(s.isDirty).toBe(true);
  });

  it("assigns local ID prefix", () => {
    useEditorStore.getState().addObject("asset-1", 0, 0, 0);
    expect(useEditorStore.getState().objects[0]?.id).toMatch(/^local-/);
  });
});

describe("editorToBatch", () => {
  it("omits local scene IDs so new objects insert on save", () => {
    const batch = editorToBatch({
      id: "local-550e8400-e29b-41d4-a716-446655440000",
      assetDefinitionId: CHAIR_ID,
      positionX: 1,
      positionY: 0,
      positionZ: 2,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scale: 1,
      sortOrder: 0,
      clothed: false,
      groupId: null,
      notes: "",
    });

    expect(batch.id).toBeUndefined();
    expect(batch.assetDefinitionId).toBe(CHAIR_ID);
  });

  it("canonicalizes legacy catalogue slugs before sending the save payload", () => {
    const batch = editorToBatch({
      id: "local-550e8400-e29b-41d4-a716-446655440001",
      assetDefinitionId: "banquet-chair",
      positionX: 1,
      positionY: 0,
      positionZ: 2,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scale: 1,
      sortOrder: 0,
      clothed: false,
      groupId: null,
      notes: "",
    });

    expect(batch.id).toBeUndefined();
    expect(batch.assetDefinitionId).toBe(CHAIR_ID);
  });

  it("preserves persisted IDs for existing rows", () => {
    const persistedId = "550e8400-e29b-41d4-a716-446655440002";
    const batch = editorToBatch({
      id: persistedId,
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: 1,
      positionY: 0,
      positionZ: 2,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scale: 1,
      sortOrder: 0,
      clothed: true,
      groupId: "group-1",
      notes: "",
    });

    expect(batch.id).toBe(persistedId);
    expect(batch.assetDefinitionId).toBe(ROUND_TABLE_ID);
  });
});

describe("updateObject", () => {
  it("updates transform and marks dirty", () => {
    useEditorStore.getState().addObject("asset-1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";

    useEditorStore.getState().updateObject(id, { positionX: 10, positionZ: 5 });

    const obj = useEditorStore.getState().objects[0];
    expect(obj?.positionX).toBe(10);
    expect(obj?.positionZ).toBe(5);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });
});

describe("setObjectNotes", () => {
  it("attaches a planner note to a placed object and marks dirty", () => {
    useEditorStore.getState().addObject("asset-1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";

    useEditorStore.getState().setObjectNotes(id, "VIP table — reserved for bride's family");

    const obj = useEditorStore.getState().objects[0];
    expect(obj?.notes).toBe("VIP table — reserved for bride's family");
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("clears the note when passed an empty string", () => {
    useEditorStore.getState().addObject("asset-1", 0, 0, 0);
    const id = useEditorStore.getState().objects[0]?.id ?? "";

    useEditorStore.getState().setObjectNotes(id, "VIP");
    useEditorStore.getState().setObjectNotes(id, "");

    expect(useEditorStore.getState().objects[0]?.notes).toBe("");
  });

  it("is a no-op for unknown object ids (defensive)", () => {
    useEditorStore.getState().addObject("asset-1", 0, 0, 0);
    const initialObjects = useEditorStore.getState().objects;

    useEditorStore.getState().setObjectNotes("not-a-real-id", "should not appear");

    expect(useEditorStore.getState().objects[0]?.notes).toBe("");
    expect(useEditorStore.getState().objects).toHaveLength(initialObjects.length);
  });
});

describe("removeObject", () => {
  it("removes object and marks dirty", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useEditorStore.getState().addObject("a2", 1, 0, 1);
    const id = useEditorStore.getState().objects[0]?.id ?? "";

    useEditorStore.getState().removeObject(id);

    expect(useEditorStore.getState().objects).toHaveLength(1);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });
});

describe("saveToServer", () => {
  it("calls public endpoint for public preview configs", async () => {
    configMock.publicBatchSave.mockResolvedValue([
      { id: "srv-1", configurationId: "cfg-1", assetDefinitionId: "a1",
        positionX: "0", positionY: "0", positionZ: "0",
        rotationX: "0", rotationY: "0", rotationZ: "0",
        scale: "1", sortOrder: 0, metadata: null },
    ]);

    useEditorStore.setState({ configId: "cfg-1", isDirty: true, isPublicPreview: true });
    useEditorStore.getState().addObject("a1", 0, 0, 0);

    const saved = await useEditorStore.getState().saveToServer(false);

    expect(configMock.publicBatchSave).toHaveBeenCalled();
    expect(saved).toBe(true);
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().lastSavedAt).not.toBeNull();
  });

  it("calls authenticated endpoint when logged in", async () => {
    configMock.authBatchSave.mockResolvedValue([]);

    useEditorStore.setState({ configId: "cfg-1", isDirty: true, objects: [] });

    await useEditorStore.getState().saveToServer(true);

    expect(configMock.authBatchSave).toHaveBeenCalled();
  });

  it("does nothing when configId is null", async () => {
    const saved = await useEditorStore.getState().saveToServer(false);
    expect(saved).toBe(false);
    expect(configMock.publicBatchSave).not.toHaveBeenCalled();
  });

  it("returns false and keeps dirty state when the save request fails", async () => {
    configMock.publicBatchSave.mockRejectedValue(new Error("Network failed"));

    useEditorStore.setState({ configId: "cfg-1", isDirty: true, isPublicPreview: true });
    useEditorStore.getState().addObject("a1", 0, 0, 0);

    const saved = await useEditorStore.getState().saveToServer(false);

    expect(saved).toBe(false);
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().saveError).toBe("Network failed");
    expect(useEditorStore.getState().lastSavedAt).toBeNull();
  });
});

describe("createPublicConfig", () => {
  it("creates config and stores in localStorage", async () => {
    configMock.createPublicConfig.mockResolvedValue({
      id: "new-cfg", spaceId: "s-1", venueId: "v-1", userId: null, name: "New Layout", isPublicPreview: true,
    });

    const id = await useEditorStore.getState().createPublicConfig("s-1");

    expect(id).toBe("new-cfg");
    expect(useEditorStore.getState().configId).toBe("new-cfg");
    const stored = JSON.parse(localStorage.getItem("omnitwin_my_configs") ?? "[]") as { configId: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.configId).toBe("new-cfg");
  });
});

describe("reset", () => {
  it("clears all state", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useEditorStore.setState({ configId: "cfg-1" });

    useEditorStore.getState().reset();

    expect(useEditorStore.getState().configId).toBeNull();
    expect(useEditorStore.getState().objects).toHaveLength(0);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scene ref — punch list #24 (part 2/3)
// ---------------------------------------------------------------------------

describe("scene ref", () => {
  it("starts as null", () => {
    expect(useEditorStore.getState().scene).toBeNull();
  });

  it("can be set via setState (SceneProvider writes it)", () => {
    const fakeScene = { type: "Scene" } as import("three").Scene;
    useEditorStore.setState({ scene: fakeScene });
    expect(useEditorStore.getState().scene).toBe(fakeScene);
    // Cleanup
    useEditorStore.setState({ scene: null });
  });

  it("reset() preserves the scene ref (Canvas is still alive)", () => {
    const fakeScene = { type: "Scene" } as import("three").Scene;
    useEditorStore.setState({ scene: fakeScene, configId: "cfg-1" });

    useEditorStore.getState().reset();

    // configId is cleared, but scene survives
    expect(useEditorStore.getState().configId).toBeNull();
    expect(useEditorStore.getState().scene).toBe(fakeScene);
    // Cleanup
    useEditorStore.setState({ scene: null });
  });
});

// ---------------------------------------------------------------------------
// moveObjectsByDelta — group-aware translation primitive used by 2D drag.
// Without this, dragging a table in 2D moved only the table; grouped
// chairs stayed at their old positions when the user toggled back to 3D.
// ---------------------------------------------------------------------------

function fixtureObj(
  id: string,
  positionX: number,
  positionZ: number,
  groupId: string | null = null,
): import("../stores/editor-store.js").EditorObject {
  return {
    id,
    assetDefinitionId: "asset-x",
    positionX,
    positionY: 0,
    positionZ,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 1,
    sortOrder: 0,
    clothed: false,
    groupId,
    notes: "",
  };
}

describe("moveObjectsByDelta", () => {
  it("translates only objects in the set by (dx, dz)", () => {
    useEditorStore.setState({
      objects: [
        fixtureObj("a", 1, 2, "g1"),
        fixtureObj("b", 3, 4, "g1"),
        fixtureObj("c", 5, 6, null),
      ],
      isDirty: false,
    });

    useEditorStore.getState().moveObjectsByDelta(new Set(["a", "b"]), 0.5, -0.25);

    const objs = useEditorStore.getState().objects;
    expect(objs.find((o) => o.id === "a")?.positionX).toBe(1.5);
    expect(objs.find((o) => o.id === "a")?.positionZ).toBe(1.75);
    expect(objs.find((o) => o.id === "b")?.positionX).toBe(3.5);
    expect(objs.find((o) => o.id === "b")?.positionZ).toBe(3.75);
    expect(objs.find((o) => o.id === "c")?.positionX).toBe(5);
    expect(objs.find((o) => o.id === "c")?.positionZ).toBe(6);
  });

  it("does not touch positionY (vertical axis is not a 2D concern)", () => {
    useEditorStore.setState({
      objects: [{ ...fixtureObj("a", 0, 0), positionY: 1.2 }],
      isDirty: false,
    });
    useEditorStore.getState().moveObjectsByDelta(new Set(["a"]), 1, 1);
    expect(useEditorStore.getState().objects[0]?.positionY).toBe(1.2);
  });

  it("noop on empty set (does not flip isDirty)", () => {
    useEditorStore.setState({
      objects: [fixtureObj("a", 0, 0)],
      isDirty: false,
    });
    useEditorStore.getState().moveObjectsByDelta(new Set(), 1, 1);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("noop on zero delta (does not flip isDirty)", () => {
    useEditorStore.setState({
      objects: [fixtureObj("a", 0, 0)],
      isDirty: false,
    });
    useEditorStore.getState().moveObjectsByDelta(new Set(["a"]), 0, 0);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("sets isDirty=true after a real move", () => {
    useEditorStore.setState({
      objects: [fixtureObj("a", 0, 0)],
      isDirty: false,
    });
    useEditorStore.getState().moveObjectsByDelta(new Set(["a"]), 1, 0);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });
});
