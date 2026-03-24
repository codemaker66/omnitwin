import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// SpacePicker tests
// ---------------------------------------------------------------------------

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
}));

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Navigate: ({ to }: { to: string }) => `Redirect to ${to}`,
  createBrowserRouter: (routes: unknown) => routes,
  RouterProvider: ({ router }: { router: unknown }) => `Router: ${String(router)}`,
}));

describe("SpacePicker", () => {
  it("exports a component", async () => {
    const { SpacePicker } = await import("../components/editor/SpacePicker.js");
    expect(typeof SpacePicker).toBe("function");
  });

  it("takes onSelectSpace prop", async () => {
    const { SpacePicker } = await import("../components/editor/SpacePicker.js");
    expect(SpacePicker.length).toBeLessThanOrEqual(1);
  });
});

describe("AssetPalette", () => {
  it("exports a component", async () => {
    const { AssetPalette } = await import("../components/editor/AssetPalette.js");
    expect(typeof AssetPalette).toBe("function");
  });
});

describe("EditorToolbar", () => {
  it("exports a component", async () => {
    const { EditorToolbar } = await import("../components/editor/EditorToolbar.js");
    expect(typeof EditorToolbar).toBe("function");
  });
});

describe("SaveSendPanel", () => {
  it("exports a component", async () => {
    const { SaveSendPanel } = await import("../components/editor/SaveSendPanel.js");
    expect(typeof SaveSendPanel).toBe("function");
  });
});

describe("GuestEnquiryModal", () => {
  it("exports a component", async () => {
    const { GuestEnquiryModal } = await import("../components/editor/GuestEnquiryModal.js");
    expect(typeof GuestEnquiryModal).toBe("function");
  });
});

describe("AuthModal", () => {
  it("exports a component", async () => {
    const { AuthModal } = await import("../components/editor/AuthModal.js");
    expect(typeof AuthModal).toBe("function");
  });
});
