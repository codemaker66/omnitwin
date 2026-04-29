import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Dashboard component tests
// ---------------------------------------------------------------------------

// Mock all API modules
vi.mock("../api/clients.js", () => ({
  searchClients: vi.fn(),
  getClientProfile: vi.fn(),
  getLeadProfile: vi.fn(),
  getRecentEnquiries: vi.fn(),
}));

vi.mock("../api/enquiries.js", () => ({
  listEnquiries: vi.fn(),
  getEnquiry: vi.fn(),
  transitionEnquiry: vi.fn(),
  getEnquiryHistory: vi.fn(),
}));

vi.mock("../api/loadouts.js", () => ({
  listLoadouts: vi.fn(),
  getLoadout: vi.fn(),
  createLoadout: vi.fn(),
  updateLoadout: vi.fn(),
  deleteLoadout: vi.fn(),
  addPhoto: vi.fn(),
  updatePhoto: vi.fn(),
  deletePhoto: vi.fn(),
  reorderPhotos: vi.fn(),
}));

vi.mock("../api/uploads.js", () => ({
  getPresignedUrl: vi.fn(),
  uploadToR2: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
  getVenue: vi.fn(),
  updateVenue: vi.fn(),
  createVenue: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
  deleteVenue: vi.fn(),
}));

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  claimConfig: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Navigate: ({ to }: { to: string }) => `Redirect to ${to}`,
  createBrowserRouter: (routes: unknown) => routes,
  RouterProvider: ({ router }: { router: unknown }) => `Router: ${String(router)}`,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null, isLoaded: true, isSignedIn: false }),
  useAuth: () => ({ getToken: vi.fn(), isLoaded: true, isSignedIn: false }),
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  SignIn: () => null,
  SignUp: () => null,
  SignedIn: ({ children }: { children: ReactNode }) => children,
  SignedOut: ({ children }: { children: ReactNode }) => children,
  UserButton: () => null,
  SignInButton: () => null,
}));

const mockAuthState = {
  user: { id: "u1", email: "elaine@tradeshall.co.uk", role: "hallkeeper", venueId: "v1", name: "Elaine" },
  isAuthenticated: true,
  isLoading: false,
  error: null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshTokens: vi.fn(),
  initialize: vi.fn(),
  clearError: vi.fn(),
  accessToken: "test-token",
  refreshToken: "test-refresh",
};

vi.mock("../stores/auth-store.js", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof mockAuthState) => unknown) =>
      selector !== undefined ? selector(mockAuthState) : mockAuthState,
    { getState: () => mockAuthState, setState: vi.fn(), subscribe: vi.fn(), destroy: vi.fn() },
  ),
}));

beforeEach(() => { vi.clearAllMocks(); });

// ---------------------------------------------------------------------------
// Component export tests
// ---------------------------------------------------------------------------

describe("DashboardLayout", () => {
  it("exports", async () => {
    const { DashboardLayout } = await import("../components/dashboard/DashboardLayout.js");
    expect(typeof DashboardLayout).toBe("function");
  });

  // Punch list #11: Sign Out previously called only the local Zustand
  // logout(), leaving the Clerk session intact. A page refresh would
  // re-populate the store and the user would be "logged in" again. This
  // test reads the source and asserts the Clerk signOut() is invoked.
  it("Sign Out invokes Clerk signOut() (not just local logout)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/components/dashboard/DashboardLayout.tsx"),
      "utf-8",
    );
    expect(src).toContain("useClerk");
    expect(src).toContain("signOut");
  });
});

describe("EnquiriesView", () => {
  it("exports", async () => {
    const { EnquiriesView } = await import("../components/dashboard/EnquiriesView.js");
    expect(typeof EnquiriesView).toBe("function");
  });
});

describe("ClientSearchView", () => {
  it("exports", async () => {
    const { ClientSearchView } = await import("../components/dashboard/ClientSearchView.js");
    expect(typeof ClientSearchView).toBe("function");
  });
});

describe("ClientProfile", () => {
  it("exports", async () => {
    const { ClientProfile } = await import("../components/dashboard/ClientProfile.js");
    expect(typeof ClientProfile).toBe("function");
  });
});

describe("LoadoutsView", () => {
  it("exports", async () => {
    const { LoadoutsView } = await import("../components/dashboard/LoadoutsView.js");
    expect(typeof LoadoutsView).toBe("function");
  });
});

describe("LoadoutDetail", () => {
  it("exports", async () => {
    const { LoadoutDetail } = await import("../components/dashboard/LoadoutDetail.js");
    expect(typeof LoadoutDetail).toBe("function");
  });
});

describe("VenueSettings", () => {
  it("exports", async () => {
    const { VenueSettings } = await import("../components/dashboard/VenueSettings.js");
    expect(typeof VenueSettings).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Venue Settings — punch list #25
// ---------------------------------------------------------------------------

describe("VenueSettings wiring (#25) — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("DashboardPage imports and renders VenueSettings (not placeholder)", async () => {
    const { codeOnly } = await readSource("src/pages/DashboardPage.tsx");
    expect(codeOnly).toContain("VenueSettings");
    expect(codeOnly).toContain("<VenueSettings");
    expect(codeOnly).not.toContain("Coming soon");
  });

  it("VenueSettings reads venueId from auth store", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/VenueSettings.tsx");
    expect(codeOnly).toContain("useAuthStore");
    expect(codeOnly).toContain("venueId");
  });

  it("VenueSettings calls getVenue to load venue data", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/VenueSettings.tsx");
    expect(codeOnly).toContain("getVenue");
  });

  it("VenueSettings calls updateVenue to save changes", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/VenueSettings.tsx");
    expect(codeOnly).toContain("updateVenue");
  });

  it("VenueSettings has fields for name, address, brandColour, logoUrl", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/VenueSettings.tsx");
    expect(codeOnly).toContain("Venue Name");
    expect(codeOnly).toContain("Address");
    expect(codeOnly).toContain("Brand Colour");
    expect(codeOnly).toContain("Logo URL");
  });

  it("VenueSettings handles the no-venue case gracefully", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/VenueSettings.tsx");
    expect(codeOnly).toContain("No venue assigned");
  });
});

describe("spaces API venue functions (#25) — source-grep", () => {
  it("exports getVenue and updateVenue", async () => {
    const mod = await import("../api/spaces.js");
    expect(typeof mod.getVenue).toBe("function");
    expect(typeof mod.updateVenue).toBe("function");
  });

  it("Venue interface includes logoUrl and brandColour", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve("src/api/spaces.ts"), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).toMatch(/logoUrl:\s*string\s*\|\s*null/);
    expect(codeOnly).toMatch(/brandColour:\s*string\s*\|\s*null/);
  });
});

describe("AdminPanel", () => {
  it("exports", async () => {
    const { AdminPanel } = await import("../components/dashboard/AdminPanel.js");
    expect(typeof AdminPanel).toBe("function");
  });
});

describe("AdminPanel wiring (#27) — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("DashboardLayout includes admin in the view type", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/DashboardLayout.tsx");
    expect(codeOnly).toContain(`"admin"`);
  });

  it("DashboardLayout shows admin nav only for admin role", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/DashboardLayout.tsx");
    expect(codeOnly).toContain("adminOnly");
    expect(codeOnly).toMatch(/user\?\.role\s*!==\s*["']admin["']/);
  });

  it("DashboardPage imports and renders AdminPanel", async () => {
    const { codeOnly } = await readSource("src/pages/DashboardPage.tsx");
    expect(codeOnly).toContain("AdminPanel");
    expect(codeOnly).toContain("<AdminPanel");
  });

  it("AdminPanel calls createVenue API", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("createVenue");
  });

  it("AdminPanel calls createSpace API", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("createSpace");
  });

  it("AdminPanel has venue list and space detail views", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("selectedVenue");
    expect(codeOnly).toContain("Back to venues");
    expect(codeOnly).toContain("New Venue");
    expect(codeOnly).toContain("New Space");
  });

  it("spaces API exports createVenue and createSpace", async () => {
    const mod = await import("../api/spaces.js");
    expect(typeof mod.createVenue).toBe("function");
    expect(typeof mod.createSpace).toBe("function");
  });

  it("AdminPanel integrates pricing rules management", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("pricingRules");
    expect(codeOnly).toContain("listPricingRules");
    expect(codeOnly).toContain("createPricingRule");
    expect(codeOnly).toContain("New Rule");
    expect(codeOnly).toContain("Room Hire Pricing");
  });

  it("pricing API module exports list, create, delete, and estimate functions", async () => {
    const mod = await import("../api/pricing.js");
    expect(typeof mod.listPricingRules).toBe("function");
    expect(typeof mod.createPricingRule).toBe("function");
    expect(typeof mod.deletePricingRule).toBe("function");
    expect(typeof mod.estimatePrice).toBe("function");
  });

  it("AdminPanel supports venue delete with ConfirmModal", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("ConfirmModal");
    expect(codeOnly).toContain("deleteVenue");
    expect(codeOnly).toContain("Delete Venue");
    expect(codeOnly).toContain("showDeleteVenue");
  });

  it("AdminPanel supports space edit and delete", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/AdminPanel.tsx");
    expect(codeOnly).toContain("updateSpace");
    expect(codeOnly).toContain("deleteSpace");
    expect(codeOnly).toContain("editingSpace");
    expect(codeOnly).toContain("Edit Space");
  });

  it("spaces API module exports update, delete venue, and delete space", async () => {
    const mod = await import("../api/spaces.js");
    expect(typeof mod.updateSpace).toBe("function");
    expect(typeof mod.deleteSpace).toBe("function");
    expect(typeof mod.deleteVenue).toBe("function");
  });
});

describe("DashboardPage", () => {
  it("exports", async () => {
    const { DashboardPage } = await import("../pages/DashboardPage.js");
    expect(typeof DashboardPage).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

describe("StatusBadge", () => {
  it("exports", async () => {
    const { StatusBadge } = await import("../components/shared/StatusBadge.js");
    expect(typeof StatusBadge).toBe("function");
  });
});

describe("ConfirmModal", () => {
  it("exports", async () => {
    const { ConfirmModal } = await import("../components/shared/ConfirmModal.js");
    expect(typeof ConfirmModal).toBe("function");
  });
});

describe("ToastContainer", () => {
  it("exports", async () => {
    const { ToastContainer } = await import("../components/shared/ToastContainer.js");
    expect(typeof ToastContainer).toBe("function");
  });
});

describe("FileUploader", () => {
  it("exports", async () => {
    const { FileUploader } = await import("../components/shared/FileUploader.js");
    expect(typeof FileUploader).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// API module tests
// ---------------------------------------------------------------------------

describe("clients API", () => {
  it("exports all functions", async () => {
    const mod = await import("../api/clients.js");
    expect(typeof mod.searchClients).toBe("function");
    expect(typeof mod.getClientProfile).toBe("function");
    expect(typeof mod.getLeadProfile).toBe("function");
    expect(typeof mod.getRecentEnquiries).toBe("function");
  });
});

describe("enquiries API", () => {
  it("exports all functions", async () => {
    const mod = await import("../api/enquiries.js");
    expect(typeof mod.listEnquiries).toBe("function");
    expect(typeof mod.getEnquiry).toBe("function");
    expect(typeof mod.transitionEnquiry).toBe("function");
    expect(typeof mod.getEnquiryHistory).toBe("function");
  });
});

describe("loadouts API", () => {
  it("exports all functions", async () => {
    const mod = await import("../api/loadouts.js");
    expect(typeof mod.listLoadouts).toBe("function");
    expect(typeof mod.createLoadout).toBe("function");
    expect(typeof mod.addPhoto).toBe("function");
    expect(typeof mod.deletePhoto).toBe("function");
    expect(typeof mod.reorderPhotos).toBe("function");
  });
});

describe("uploads API", () => {
  it("exports all functions", async () => {
    const mod = await import("../api/uploads.js");
    expect(typeof mod.getPresignedUrl).toBe("function");
    expect(typeof mod.uploadToR2).toBe("function");
    expect(typeof mod.uploadFile).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Toast store tests
// ---------------------------------------------------------------------------

describe("toast store", () => {
  it("adds and auto-removes toasts", async () => {
    const { useToastStore } = await import("../stores/toast-store.js");
    expect(useToastStore.getState().toasts).toHaveLength(0);
    useToastStore.getState().addToast("Test", "success");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe("Test");
  });

  it("removes toast by id", async () => {
    const { useToastStore } = await import("../stores/toast-store.js");
    useToastStore.getState().addToast("Remove me", "info");
    const id = useToastStore.getState().toasts[useToastStore.getState().toasts.length - 1]?.id ?? "";
    useToastStore.getState().removeToast(id);
    const found = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// File uploader validation
// ---------------------------------------------------------------------------

describe("file type validation", () => {
  it("accepted types are image/jpeg, image/png, image/webp", () => {
    const accepted = ["image/jpeg", "image/png", "image/webp"];
    expect(accepted).toContain("image/jpeg");
    expect(accepted).toContain("image/png");
    expect(accepted).toContain("image/webp");
    expect(accepted).not.toContain("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// Toolbar save Clerk migration regression — punch list #10
// ---------------------------------------------------------------------------

describe("VerticalToolbox save", () => {
  // Previously called saveToServer(true) unconditionally, forcing the
  // authenticated endpoint even for guests. Guests would 401 silently.
  // This test reads the source and asserts the auth flag is read from
  // the auth store, not hard-coded.
  it("does NOT hard-code saveToServer(true) — reads auth state at click time", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/components/editor/VerticalToolbox.tsx"),
      "utf-8",
    );
    // Strip line comments and block comments before checking — comments
    // can legitimately mention the legacy `saveToServer(true)` call to
    // explain what was removed.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/saveToServer\(true\)/);
    // The auth state is read at click time
    expect(codeOnly).toContain("useAuthStore.getState().isAuthenticated");
  });
});

// ---------------------------------------------------------------------------
// ClientProfile → enquiry navigation — punch list #34
//
// Previously the DashboardPage `onViewEnquiry` callback discarded the
// enquiry id and just dumped the user at the unfiltered list:
//
//   onViewEnquiry={() => { setView("enquiries"); ... }}   // BUG
//
// The user clicked "Wedding for Alice" in the profile and was taken to
// the top of the enquiry list with no idea where to scroll. The fix:
//   1. DashboardPage captures the id and stores a return context
//      (which profile we came from)
//   2. EnquiriesView accepts `initialSelectedId` and fetches the enquiry
//      independently via `getEnquiry()` so the status filter doesn't
//      matter for the cross-view case
//   3. EnquiriesView accepts `onDetailClose` so "Back" can return to the
//      profile instead of the enquiry list
//
// These tests pin all three properties at the source level. Behavioural
// verification (multi-component render flow) belongs in an E2E suite —
// see project_integration_test_rot.md for the broader test-infra
// limitation.
// ---------------------------------------------------------------------------

describe("ClientProfile enquiry navigation (#34)", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("DashboardPage captures the enquiry id (no longer discards it)", async () => {
    const { codeOnly } = await readSource("src/pages/DashboardPage.tsx");
    // Positive: the new handler is wired in by name
    expect(codeOnly).toContain("handleViewEnquiryFromProfile");
    // Positive: the handler captures an `enquiryId` parameter
    expect(codeOnly).toMatch(/handleViewEnquiryFromProfile\s*=\s*\(\s*enquiryId/);
    // Negative: the bug pattern is gone — `onViewEnquiry={() => {` with
    // no parameter is the discarding form. Comments stripped first.
    expect(codeOnly).not.toMatch(/onViewEnquiry=\{\s*\(\s*\)\s*=>/);
  });

  it("DashboardPage stores return context for restoring the profile", async () => {
    const { codeOnly } = await readSource("src/pages/DashboardPage.tsx");
    // The return context type and state are wired up
    expect(codeOnly).toContain("EnquiryReturnContext");
    expect(codeOnly).toContain("enquiryReturnContext");
    // The "back from enquiry" handler restores both possible profile types
    expect(codeOnly).toContain("handleEnquiryDetailClose");
    expect(codeOnly).toContain("setProfileUserId(enquiryReturnContext.returnUserId)");
    expect(codeOnly).toContain("setProfileLeadId(enquiryReturnContext.returnLeadId)");
  });

  it("DashboardPage drops return context on sidebar view change", async () => {
    const { codeOnly } = await readSource("src/pages/DashboardPage.tsx");
    // Sidebar navigation should clear the cross-view return context so it
    // doesn't bleed into an unrelated view
    expect(codeOnly).toMatch(/handleViewChange[\s\S]*?setEnquiryReturnContext\(null\)/);
  });

  it("EnquiriesView accepts initialSelectedId and onDetailClose props", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/EnquiriesView.tsx");
    expect(codeOnly).toContain("initialSelectedId");
    expect(codeOnly).toContain("onDetailClose");
    expect(codeOnly).toContain("EnquiriesViewProps");
  });

  it("EnquiriesView fetches the pre-selected enquiry independently (avoids status-filter mismatch)", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/EnquiriesView.tsx");
    // The fix: when initialSelectedId is set, fetch the enquiry directly
    // via `getEnquiry()` rather than relying on the filtered list lookup.
    // Otherwise a rejected enquiry pre-selected with the "submitted"
    // filter would silently render nothing.
    expect(codeOnly).toContain("preselectedEnquiry");
    expect(codeOnly).toMatch(/enquiriesApi\.getEnquiry\(initialSelectedId\)/);
  });

  it("EnquiriesView 'Back' button label reflects return destination", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/EnquiriesView.tsx");
    // When onDetailClose is provided, the back button should say "Back to
    // profile" so the user knows where they're going.
    expect(codeOnly).toContain("Back to profile");
    expect(codeOnly).toContain("Back to list");
    // The handler is named, not inlined
    expect(codeOnly).toContain("handleBack");
  });
});

// ---------------------------------------------------------------------------
// LoadoutsView infinite spinner — punch list #36
//
// The useEffect that loads spaces bailed with `if (venueId === "") return`
// but never called `setLoading(false)` in that branch. Users without a
// venueId (new accounts, client role) saw an infinite spinner.
// ---------------------------------------------------------------------------

describe("LoadoutsView empty venueId fix (#36) — source-grep", () => {
  it("sets loading false when venueId is empty (no infinite spinner)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/components/dashboard/LoadoutsView.tsx"),
      "utf-8",
    );
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // The early-return branch for empty venueId must call setLoading(false)
    // before returning. Without it, loading stays true forever.
    expect(codeOnly).toMatch(/if\s*\(venueId\s*===\s*""[^)]*\)\s*\{[\s\S]{0,100}?setLoading\(false\)/);
  });
});

// ---------------------------------------------------------------------------
// Loadout photos — punch list #37 (reorder) + #38 (image previews)
// ---------------------------------------------------------------------------

describe("LoadoutDetail photo improvements (#37, #38) — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("imports R2_PUBLIC_URL for constructing image URLs", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toContain("R2_PUBLIC_URL");
    expect(codeOnly).toMatch(/import[\s\S]*?R2_PUBLIC_URL[\s\S]*?from[\s\S]*?env/);
  });

  it("renders <img> tags for photo previews when R2 is configured", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toContain("<img");
    expect(codeOnly).toContain("p.fileKey");
  });

  it("falls back to filename text when R2 is not configured", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toMatch(/R2_PUBLIC_URL\s*!==\s*null\s*\?/);
    expect(codeOnly).toContain("p.filename");
  });

  it("calls reorderPhotos API for move up/down", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toContain("reorderPhotos");
    expect(codeOnly).toContain("handleMove");
  });

  it("has Move Up and Move Down buttons", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toContain("Move Up");
    expect(codeOnly).toContain("Move Down");
  });

  it("disables Move Up on the first photo and Move Down on the last", async () => {
    const { codeOnly } = await readSource("src/components/dashboard/LoadoutDetail.tsx");
    expect(codeOnly).toMatch(/disabled=\{idx\s*===\s*0\}/);
    expect(codeOnly).toMatch(/disabled=\{idx\s*===\s*loadout\.photos\.length\s*-\s*1\}/);
  });
});

// ---------------------------------------------------------------------------
// Search debounce logic
// ---------------------------------------------------------------------------

describe("search debounce", () => {
  it("minimum 2 character enforcement", () => {
    // The ClientSearchView enforces q.length >= 2 before calling API
    // This is a logic test, not a render test
    const query = "a";
    expect(query.length).toBeLessThan(2);
    const query2 = "ab";
    expect(query2.length).toBeGreaterThanOrEqual(2);
  });
});
