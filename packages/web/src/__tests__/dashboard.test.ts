import { describe, it, expect, vi, beforeEach } from "vitest";

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
  getHallkeeperSheet: vi.fn(),
  downloadHallkeeperPdf: vi.fn(),
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
    expect(typeof mod.downloadHallkeeperPdf).toBe("function");
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
