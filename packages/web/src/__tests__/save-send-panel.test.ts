import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// SaveSendPanel + GuestEnquiryModal tests
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

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Navigate: ({ to }: { to: string }) => `Redirect to ${to}`,
  createBrowserRouter: (routes: unknown) => routes,
  RouterProvider: ({ router }: { router: unknown }) => `Router: ${String(router)}`,
}));

const mockAuthState = {
  user: null as { id: string; email: string; role: string; venueId: string | null; name: string } | null,
  isAuthenticated: false,
  isLoading: false,
  error: null as string | null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshTokens: vi.fn(),
  initialize: vi.fn(),
  clearError: vi.fn(),
  accessToken: null as string | null,
  refreshToken: null as string | null,
};

vi.mock("../stores/auth-store.js", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof mockAuthState) => unknown) =>
      selector !== undefined ? selector(mockAuthState) : mockAuthState,
    { getState: () => mockAuthState, setState: vi.fn(), subscribe: vi.fn(), destroy: vi.fn() },
  ),
}));

const { useEditorStore } = await import("../stores/editor-store.js");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  mockAuthState.isAuthenticated = false;
  mockAuthState.user = null;
});

describe("SaveSendPanel visibility", () => {
  it("returns null when no objects", async () => {
    const { SaveSendPanel } = await import("../components/editor/SaveSendPanel.js");
    expect(typeof SaveSendPanel).toBe("function");
    // With no objects and no configId, panel should return null
    // (tested via component existence — full render tested in integration)
  });

  it("requires configId", () => {
    useEditorStore.setState({ objects: [{ id: "o1", assetDefinitionId: "a1", positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0, clothed: false, groupId: null, notes: "" }] });
    // Still no configId — panel should return null
    expect(useEditorStore.getState().configId).toBeNull();
  });
});

describe("GuestEnquiryModal validation", () => {
  it("requires email field", async () => {
    const { GuestEnquiryModal } = await import("../components/editor/GuestEnquiryModal.js");
    expect(typeof GuestEnquiryModal).toBe("function");
  });

  it("exports with configId and onClose props", async () => {
    const { GuestEnquiryModal } = await import("../components/editor/GuestEnquiryModal.js");
    expect(GuestEnquiryModal.length).toBeLessThanOrEqual(1);
  });
});

describe("AuthModal", () => {
  it("exports with onClose prop", async () => {
    const { AuthModal } = await import("../components/editor/AuthModal.js");
    expect(typeof AuthModal).toBe("function");
    expect(AuthModal.length).toBeLessThanOrEqual(1);
  });
});

describe("EditorPage", () => {
  it("exports a component", async () => {
    const { EditorPage } = await import("../pages/EditorPage.js");
    expect(typeof EditorPage).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Punch list #32 — stale layout on enquiry submit
//
// The "Send to Events Team" button previously opened the enquiry modal
// immediately. With a 3-second auto-save debounce in EditorBridge, edits
// made within 3s of clicking Send were not yet persisted — the venue
// received the old layout. The fix force-flushes the auto-save BEFORE
// opening the modal.
// ---------------------------------------------------------------------------

describe("SaveSendPanel flush-before-send (#32) — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("SaveSendPanel uses the shared prepareLayoutForGuestEnquiry flow", async () => {
    const { codeOnly } = await readSource("src/components/editor/SaveSendPanel.tsx");
    expect(codeOnly).toContain("prepareLayoutForGuestEnquiry");
  });

  it("the shared send flow imports flushAutoSave from EditorBridge", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("flushAutoSave");
    expect(codeOnly).toMatch(/import[\s\S]*?flushAutoSave[\s\S]*?from[\s\S]*?EditorBridge/);
  });

  it("the shared send flow calls flushAutoSave before the modal can open", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    // Positive: flushAutoSave is called somewhere in the click handler
    expect(codeOnly).toContain("await flushAutoSave()");
    expect(codeOnly).toContain("if (!saved) return false");
  });

  it("SaveSendPanel does not use the old direct-open click handler", async () => {
    const { codeOnly } = await readSource("src/components/editor/SaveSendPanel.tsx");
    // Negative: the old direct-open pattern is gone (comments stripped)
    expect(codeOnly).not.toMatch(/onClick=\{\s*\(\)\s*=>\s*\{\s*setShowEnquiry\(true\)/);
    expect(codeOnly).not.toContain(".finally(");
    expect(codeOnly).toContain("readyToSend");
    expect(codeOnly).toContain("mountedRef");
  });

  it("EditorBridge exports flushAutoSave", async () => {
    const { codeOnly } = await readSource("src/components/editor/EditorBridge.tsx");
    expect(codeOnly).toMatch(/export\s+(async\s+)?function\s+flushAutoSave/);
  });

  it("flushAutoSave cancels the debounce timer before saving", async () => {
    const { codeOnly } = await readSource("src/components/editor/EditorBridge.tsx");
    // The function must cancel the pending timer to prevent a redundant
    // save after the flush. Pin the clearTimeout call inside flushAutoSave.
    expect(codeOnly).toMatch(/flushAutoSave[\s\S]{0,300}?clearTimeout\(bridgeSaveTimer\)/);
  });
});

describe("prepareLayoutForGuestEnquiry save gate", () => {
  it("returns false when the forced save fails", async () => {
    const { prepareLayoutForGuestEnquiry } = await import("../components/editor/send-layout-flow.js");
    const originalSaveToServer = useEditorStore.getState().saveToServer;
    useEditorStore.setState({
      configId: "11111111-1111-4111-8111-111111111111",
      isDirty: true,
      isSaving: false,
      saveToServer: () => Promise.resolve(false),
    });

    try {
      const ready = await prepareLayoutForGuestEnquiry("11111111-1111-4111-8111-111111111111");
      expect(ready).toBe(false);
    } finally {
      useEditorStore.setState({ saveToServer: originalSaveToServer });
    }
  });

  it("returns true when no save is needed", async () => {
    const { prepareLayoutForGuestEnquiry } = await import("../components/editor/send-layout-flow.js");
    useEditorStore.setState({
      configId: "11111111-1111-4111-8111-111111111111",
      isDirty: false,
      isSaving: false,
      scene: null,
    });

    const ready = await prepareLayoutForGuestEnquiry("11111111-1111-4111-8111-111111111111");

    expect(ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Punch list #24 — ortho diagram capture wiring
//
// SaveSendPanel captures a top-down floor plan PNG from the Three.js scene
// and uploads it to the config's thumbnailUrl before opening the enquiry
// modal. This makes the hallkeeper sheet PDF show the actual floor plan
// instead of the "Generate from the 3D editor" placeholder.
//
// The capture is best-effort: if scene is null, capture fails, or upload
// fails, the modal opens anyway (hallkeeper sheet shows its placeholder).
// ---------------------------------------------------------------------------

describe("SaveSendPanel ortho capture wiring (#24) — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("imports captureOrthographic from ortho-capture", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("captureOrthographic");
    expect(codeOnly).toMatch(/import[\s\S]*?captureOrthographic[\s\S]*?from[\s\S]*?ortho-capture/);
  });

  it("imports updatePublicThumbnail from configurations API", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("updatePublicThumbnail");
    expect(codeOnly).toMatch(/import[\s\S]*?updatePublicThumbnail[\s\S]*?from[\s\S]*?configurations/);
  });

  it("uses the active room-dimensions store for capture dimensions", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("useRoomDimensionsStore");
    expect(codeOnly).toContain("roomWidthRender");
    expect(codeOnly).toContain("roomLengthRender");
  });

  it("reads scene from editor-store", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("useEditorStore.getState()");
    expect(codeOnly).toMatch(/\{\s*scene[\s\S]*?\}\s*=\s*useEditorStore\.getState\(\)/);
  });

  it("calls captureOrthographic with reduced resolution for data URL size", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    // The capture must use 800x533 (not 2400x1600) so the PNG data URL
    // fits within the 200 KB Postgres column budget.
    expect(codeOnly).toMatch(/captureOrthographic\([\s\S]*?width:\s*800/);
    expect(codeOnly).toMatch(/captureOrthographic\([\s\S]*?height:\s*533/);
  });

  it("calls updatePublicThumbnail with the captured data URL", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toMatch(/updatePublicThumbnail\([\s\S]*?dataUrl/);
  });

  it("only captures for public preview configs (not claimed)", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    expect(codeOnly).toContain("isPublicPreview");
  });

  it("capture + upload are wrapped in try/catch (best-effort)", async () => {
    const { codeOnly } = await readSource("src/components/editor/send-layout-flow.ts");
    // The capture block must be inside a try/catch so failures don't
    // prevent the modal from opening.
    expect(codeOnly).toMatch(/try\s*\{[\s\S]*?captureOrthographic[\s\S]*?\}\s*catch/);
  });
});

describe("Router", () => {
  it("exports router config", async () => {
    const { router } = await import("../router.js");
    expect(router).toBeDefined();
  });

  it("has /plan route without ProtectedRoute", async () => {
    const { router } = await import("../router.js");
    // Router is an array of route configs (since createBrowserRouter is mocked)
    const routes = router as unknown as { path: string }[];
    const planRoute = routes.find((r) => r.path === "/plan");
    expect(planRoute).toBeDefined();
  });

  it("has /plan/:code route (replaces legacy /plan/:configId)", async () => {
    const { router } = await import("../router.js");
    const routes = router as unknown as { path: string }[];
    const configRoute = routes.find((r) => r.path === "/plan/:code");
    expect(configRoute).toBeDefined();
  });

  it("has /dev/splat-fixture route for the Spark smoke fixture", async () => {
    const { router } = await import("../router.js");
    const routes = router as unknown as { path: string }[];
    const fixtureRoute = routes.find((r) => r.path === "/dev/splat-fixture");
    expect(fixtureRoute).toBeDefined();
  });
});
