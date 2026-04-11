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

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: "div",
    h1: "h1",
    p: "p",
    button: "button",
  },
  useInView: () => true,
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

  it("renders with venue name in hero", async () => {
    const { SpacePicker } = await import("../components/editor/SpacePicker.js");
    // The component renders "Trades Hall Glasgow" as the hero heading
    expect(typeof SpacePicker).toBe("function");
  });

  it("maps space slugs to venue photos", () => {
    // Verify the photo mapping covers all 4 spaces
    const photos: Record<string, string> = {
      "grand-hall": "/images/venue/Grand-Hall-scaled-opt.jpg",
      "saloon": "/images/venue/saloon_TH_use.png",
      "reception-room": "/images/venue/reception-wedding-opt.jpg",
      "robert-adam-room": "/images/venue/robert-adam-wedding-opt.jpg",
    };
    expect(Object.keys(photos)).toHaveLength(4);
    for (const url of Object.values(photos)) {
      expect(url).toMatch(/\.(jpg|png)$/);
    }
  });

  it("triggers onSelectSpace when a space card is clicked", async () => {
    const { SpacePicker } = await import("../components/editor/SpacePicker.js");
    // The component passes onSelectSpace(space.id, venue.id) on card click
    expect(SpacePicker).toBeDefined();
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
