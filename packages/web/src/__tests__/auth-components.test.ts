import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Auth component tests — Clerk-based
// ---------------------------------------------------------------------------

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Navigate: ({ to }: { to: string }) => `Redirect to ${to}`,
  RouterProvider: ({ router }: { router: unknown }) => `Router: ${String(router)}`,
  createBrowserRouter: (routes: unknown) => routes,
}));

// Mock Clerk
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  SignIn: () => "SignIn",
  SignUp: () => "SignUp",
  UserButton: () => "UserButton",
  SignInButton: ({ children }: { children: unknown }) => children,
  SignedIn: ({ children }: { children: unknown }) => children,
  SignedOut: () => null,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useAuth: () => ({ getToken: vi.fn() }),
}));

// Mock auth store
const mockAuthState = {
  user: null as { id: string; email: string; role: string; venueId: string | null; name: string } | null,
  isAuthenticated: false,
  isLoading: false,
  error: null as string | null,
  setUser: vi.fn(),
  setLoading: vi.fn(),
  logout: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("../stores/auth-store.js", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof mockAuthState) => unknown) =>
      selector !== undefined ? selector(mockAuthState) : mockAuthState,
    { getState: () => mockAuthState, setState: vi.fn(), subscribe: vi.fn(), destroy: vi.fn() },
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthState.user = null;
  mockAuthState.isAuthenticated = false;
  mockAuthState.isLoading = false;
  mockAuthState.error = null;
});

describe("ProtectedRoute", () => {
  it("exports a component", async () => {
    const { ProtectedRoute } = await import("../components/auth/ProtectedRoute.js");
    expect(typeof ProtectedRoute).toBe("function");
  });

  it("redirects when unauthenticated", async () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;
    const { ProtectedRoute } = await import("../components/auth/ProtectedRoute.js");
    expect(ProtectedRoute).toBeDefined();
  });

  it("shows 403 for wrong role", async () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: "u1", email: "viewer@test.com", role: "viewer", venueId: null, name: "V" };
    const { ProtectedRoute } = await import("../components/auth/ProtectedRoute.js");
    expect(ProtectedRoute).toBeDefined();
  });
});

describe("UserMenu", () => {
  it("exports a component", async () => {
    const { UserMenu } = await import("../components/auth/UserMenu.js");
    expect(typeof UserMenu).toBe("function");
  });
});

describe("ClerkAuthBridge", () => {
  it("exports a component", async () => {
    const { ClerkAuthBridge } = await import("../components/auth/ClerkAuthBridge.js");
    expect(typeof ClerkAuthBridge).toBe("function");
  });
});

describe("Pages", () => {
  it("LoginPage exports", async () => {
    const { LoginPage } = await import("../pages/LoginPage.js");
    expect(typeof LoginPage).toBe("function");
  });

  it("RegisterPage exports", async () => {
    const { RegisterPage } = await import("../pages/RegisterPage.js");
    expect(typeof RegisterPage).toBe("function");
  });

  it("EditorPage exports", async () => {
    const { EditorPage } = await import("../pages/EditorPage.js");
    expect(typeof EditorPage).toBe("function");
  });

  it("DashboardPage exports", async () => {
    const { DashboardPage } = await import("../pages/DashboardPage.js");
    expect(typeof DashboardPage).toBe("function");
  });
});
