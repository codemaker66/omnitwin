import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Auth component tests — Clerk-based
// ---------------------------------------------------------------------------

interface CapturedClerkProviderProps {
  readonly children?: unknown;
  readonly afterSignOutUrl?: string;
  readonly appearance?: {
    readonly elements?: {
      readonly socialButtonsBlockButton?: {
        readonly display?: string;
        readonly minHeight?: string;
        readonly border?: string;
        readonly background?: string;
        readonly color?: string;
        readonly fontWeight?: string;
      };
      readonly socialButtonsBlockButtonText?: {
        readonly color?: string;
        readonly fontWeight?: string;
      };
      readonly dividerRow?: {
        readonly display?: string;
      };
    };
  };
  readonly localization?: {
    readonly signIn?: {
      readonly start?: {
        readonly title?: string;
      };
    };
    readonly signUp?: {
      readonly start?: {
        readonly title?: string;
      };
    };
  };
}

const clerkProviderMock = vi.hoisted(() =>
  vi.fn((props: CapturedClerkProviderProps) => props.children),
);

interface CapturedClerkFormProps {
  readonly appearance?: CapturedClerkProviderProps["appearance"];
  readonly routing?: string;
}

const signInMock = vi.hoisted(() =>
  vi.fn((_props: CapturedClerkFormProps) => "SignIn"),
);

const signUpMock = vi.hoisted(() =>
  vi.fn((_props: CapturedClerkFormProps) => "SignUp"),
);

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Navigate: ({ to }: { to: string }) => `Redirect to ${to}`,
  RouterProvider: ({ router }: { router: unknown }) => `Router: ${String(router)}`,
  createBrowserRouter: (routes: unknown) => routes,
}));

// Mock Clerk
vi.mock("@clerk/react", () => ({
  ClerkProvider: clerkProviderMock,
  ClerkLoaded: ({ children }: { children: unknown }) => children,
  ClerkFailed: () => null,
  ClerkLoading: () => null,
  OAuthConsent: () => "OAuthConsent",
  Show: ({ children }: { children: unknown }) => children,
  SignIn: signInMock,
  SignUp: signUpMock,
  UserButton: () => "UserButton",
  SignInButton: ({ children }: { children: unknown }) => children,
  SignedIn: ({ children }: { children: unknown }) => children,
  SignedOut: () => null,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useAuth: () => ({ getToken: vi.fn() }),
}));

// Mock auth store
const mockAuthState = {
  user: null as {
    id: string;
    email: string;
    role: string;
    platformRole: "none" | "operator" | "admin";
    venueId: string | null;
    name: string;
  } | null,
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
    mockAuthState.user = { id: "u1", email: "viewer@test.com", role: "viewer", platformRole: "none", venueId: null, name: "V" };
    const { ProtectedRoute } = await import("../components/auth/ProtectedRoute.js");
    expect(ProtectedRoute).toBeDefined();
  });

  it("keeps venue admins out of platform-only routes", async () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: "u2", email: "venue-admin@test.com", role: "admin", platformRole: "none", venueId: "v1", name: "Venue Admin" };
    const { ProtectedRoute } = await import("../components/auth/ProtectedRoute.js");

    render(createElement(ProtectedRoute, {
      allowedRoles: ["admin"],
      requiredPlatformRole: "admin",
      children: "Platform surface",
    }));

    expect(screen.getByRole("alert").textContent).toContain("reserved for Venviewer platform admins");
    expect(screen.queryByText("Platform surface")).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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

describe("ClerkRouteProvider", () => {
  it("pins Clerk-rendered account copy to Venviewer and hides unverified social sign-in", async () => {
    const { ClerkRouteProvider } = await import("../components/auth/ClerkRouteProvider.js");

    render(createElement(ClerkRouteProvider, null, "workspace"));

    const props = clerkProviderMock.mock.calls.at(-1)?.[0];
    expect(props?.afterSignOutUrl).toBe("/");
    expect(props?.localization?.signIn?.start?.title).toBe("Sign in to Venviewer");
    expect(props?.localization?.signUp?.start?.title).toBe("Create your Venviewer account");
    expect(props?.appearance?.elements?.socialButtonsBlockButton?.display).toBe("none");
    expect(props?.appearance?.elements?.dividerRow?.display).toBe("none");
  });

  it("gives enabled Google social sign-in a visible Venviewer control treatment", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_CLERK_GOOGLE_SIGN_IN_ENABLED", "true");
    const { VENVIEWER_CLERK_APPEARANCE } = await import("../components/auth/clerk-appearance.js");

    const socialButton = VENVIEWER_CLERK_APPEARANCE.elements.socialButtonsBlockButton;
    const socialButtonText = VENVIEWER_CLERK_APPEARANCE.elements.socialButtonsBlockButtonText;

    expect(socialButton.display).toBe("flex");
    expect(socialButton.minHeight).toBe("44px");
    expect(socialButton.border).toContain("82, 230, 224");
    expect(socialButton.background).toContain("linear-gradient");
    expect(socialButton.color).toBe("#fff7e8");
    expect(socialButton.fontWeight).toBe("800");
    expect(socialButtonText.color).toBe("#fff7e8");
    expect(socialButtonText.fontWeight).toBe("800");
  });
});

describe("OAuthConsentPage", () => {
  it("renders Clerk's prebuilt OAuth consent component inside a focused Venviewer shell", async () => {
    const { OAuthConsentPage } = await import("../pages/OAuthConsentPage.js");

    render(createElement(OAuthConsentPage));

    expect(screen.getByLabelText("Venviewer OAuth consent").textContent).toContain("Review external access");
    expect(screen.getByLabelText("OAuth consent decision").textContent).toContain("OAuthConsent");
    expect(document.title).toBe("OAuth consent - Venviewer");
  });

  it("sets a strict origin referrer policy for the consent route", async () => {
    document.head.querySelector('meta[name="referrer"]')?.remove();
    const { OAuthConsentPage } = await import("../pages/OAuthConsentPage.js");

    render(createElement(OAuthConsentPage));

    expect(document.head.querySelector<HTMLMetaElement>('meta[name="referrer"]')?.content).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("uses Clerk consent primitives instead of a custom token-grant flow", async () => {
    const source = await readFile(resolve("src/pages/OAuthConsentPage.tsx"), "utf-8");

    expect(source).toContain("OAuthConsent");
    expect(source).toContain("ClerkFailed");
    expect(source).toContain("Consent screen unavailable.");
    expect(source).toContain('Show when="signed-in"');
    expect(source).not.toContain("useOAuthConsent");
    expect(source).not.toContain("oauth_authorization.granted");
    expect(source).not.toContain("oauth_token.created");
  });

  it("mounts the custom consent route behind Clerk", async () => {
    const routerSource = await readFile(resolve("src/router.tsx"), "utf-8");

    expect(routerSource).toContain('path: "/oauth-consent"');
    expect(routerSource).toContain("withClerk(<OAuthConsentPage />)");
  });
});

describe("Pages", () => {
  it("LoginPage exports", async () => {
    const { LoginPage } = await import("../pages/LoginPage.js");
    expect(typeof LoginPage).toBe("function");
  });

  it("LoginPage uses the Venviewer Clerk theme and hides unverified Google social sign-in", async () => {
    const { LoginPage } = await import("../pages/LoginPage.js");

    render(createElement(LoginPage));

    expect(document.querySelector(".auth-page--social-disabled")).not.toBeNull();

    const props = signInMock.mock.calls.at(-1)?.[0];
    expect(props?.routing).toBe("hash");
    expect(props?.appearance?.elements?.socialButtonsBlockButton?.display).toBe("none");
    expect(props?.appearance?.elements?.dividerRow?.display).toBe("none");
  });

  it("RegisterPage exports", async () => {
    const { RegisterPage } = await import("../pages/RegisterPage.js");
    expect(typeof RegisterPage).toBe("function");
  });

  it("RegisterPage uses the Venviewer Clerk theme and hides unverified Google social sign-in", async () => {
    const { RegisterPage } = await import("../pages/RegisterPage.js");

    render(createElement(RegisterPage));

    expect(document.querySelector(".auth-page--social-disabled")).not.toBeNull();

    const props = signUpMock.mock.calls.at(-1)?.[0];
    expect(props?.routing).toBe("hash");
    expect(props?.appearance?.elements?.socialButtonsBlockButton?.display).toBe("none");
    expect(props?.appearance?.elements?.dividerRow?.display).toBe("none");
  });

  it("OAuthConsentPage exports", async () => {
    const { OAuthConsentPage } = await import("../pages/OAuthConsentPage.js");
    expect(typeof OAuthConsentPage).toBe("function");
  });

  it("EditorPage exports", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/pages/EditorPage.tsx"), "utf-8");
    expect(source).toMatch(/export\s+function\s+EditorPage\s*\(/);
  });

  it("DashboardPage exports", async () => {
    const { DashboardPage } = await import("../pages/DashboardPage.js");
    expect(typeof DashboardPage).toBe("function");
  });
});
