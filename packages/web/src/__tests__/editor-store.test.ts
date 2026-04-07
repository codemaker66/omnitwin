import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Editor store tests — mock API modules
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

const configMock = (await import("../api/configurations.js")) as unknown as {
  getPublicConfig: ReturnType<typeof vi.fn>;
  createPublicConfig: ReturnType<typeof vi.fn>;
  publicBatchSave: ReturnType<typeof vi.fn>;
  authBatchSave: ReturnType<typeof vi.fn>;
};

const { useEditorStore } = await import("../stores/editor-store.js");

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

    await useEditorStore.getState().saveToServer(false);

    expect(configMock.publicBatchSave).toHaveBeenCalled();
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
    await useEditorStore.getState().saveToServer(false);
    expect(configMock.publicBatchSave).not.toHaveBeenCalled();
  });
});

describe("createPublicConfig", () => {
  it("creates config and stores in localStorage", async () => {
    configMock.createPublicConfig.mockResolvedValue({
      id: "new-cfg", spaceId: "s-1", venueId: "v-1", isPublicPreview: true,
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
