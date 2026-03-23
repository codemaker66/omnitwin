import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Auth store tests — mock the auth API
// ---------------------------------------------------------------------------

vi.mock("../api/auth.js", () => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
}));

const authApiMock = await import("../api/auth.js") as {
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
};

const { useAuthStore } = await import("../stores/auth-store.js");

const mockUser = { id: "u1", email: "test@test.com", role: "planner", venueId: null, name: "Test" };
const mockTokens = { user: mockUser, accessToken: "access-123", refreshToken: "refresh-456" };

// JWT with exp 1 hour from now
function makeJwt(expOffsetSec: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  const b64 = btoa(JSON.stringify(payload));
  return `header.${b64}.signature`;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    user: null, accessToken: null, refreshToken: null,
    isAuthenticated: false, isLoading: false, error: null,
  });
  vi.clearAllMocks();
});

describe("login", () => {
  it("stores user + tokens on success", async () => {
    authApiMock.login.mockResolvedValue(mockTokens);

    await useAuthStore.getState().login("test@test.com", "password");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(state.accessToken).toBe("access-123");
    expect(localStorage.getItem("omnitwin_access_token")).toBe("access-123");
    expect(localStorage.getItem("omnitwin_refresh_token")).toBe("refresh-456");
  });

  it("sets error on failure", async () => {
    authApiMock.login.mockRejectedValue(new Error("Invalid credentials"));

    await expect(useAuthStore.getState().login("bad@test.com", "wrong")).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe("Invalid credentials");
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe("register", () => {
  it("stores user + tokens on success", async () => {
    authApiMock.register.mockResolvedValue(mockTokens);

    await useAuthStore.getState().register("test@test.com", "password123", "Test");

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("sets error on failure", async () => {
    authApiMock.register.mockRejectedValue(new Error("Email taken"));

    await expect(useAuthStore.getState().register("dup@test.com", "pass1234", "Dup")).rejects.toThrow();
    expect(useAuthStore.getState().error).toBe("Email taken");
  });
});

describe("logout", () => {
  it("clears state and localStorage", () => {
    // Set up authenticated state
    useAuthStore.setState({
      user: mockUser, accessToken: "a", refreshToken: "r", isAuthenticated: true,
    });
    localStorage.setItem("omnitwin_access_token", "a");
    localStorage.setItem("omnitwin_refresh_token", "r");
    localStorage.setItem("omnitwin_user", JSON.stringify(mockUser));

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem("omnitwin_access_token")).toBeNull();
    expect(localStorage.getItem("omnitwin_refresh_token")).toBeNull();
  });
});

describe("initialize", () => {
  it("restores from localStorage with valid token", async () => {
    const validJwt = makeJwt(3600); // expires in 1 hour
    localStorage.setItem("omnitwin_access_token", validJwt);
    localStorage.setItem("omnitwin_refresh_token", "refresh-token");
    localStorage.setItem("omnitwin_user", JSON.stringify(mockUser));

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("clears expired tokens when refresh fails", async () => {
    const expiredJwt = makeJwt(-60); // expired 60s ago
    localStorage.setItem("omnitwin_access_token", expiredJwt);
    localStorage.setItem("omnitwin_refresh_token", "bad-refresh");
    localStorage.setItem("omnitwin_user", JSON.stringify(mockUser));
    authApiMock.refresh.mockRejectedValue(new Error("Invalid refresh"));

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem("omnitwin_access_token")).toBeNull();
  });

  it("does nothing when no tokens stored", async () => {
    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("refreshes expired token successfully", async () => {
    const expiredJwt = makeJwt(-60);
    localStorage.setItem("omnitwin_access_token", expiredJwt);
    localStorage.setItem("omnitwin_refresh_token", "valid-refresh");
    localStorage.setItem("omnitwin_user", JSON.stringify(mockUser));
    authApiMock.refresh.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe("new-access");
  });
});

describe("isAuthenticated", () => {
  it("is false by default", () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("is true after login", async () => {
    authApiMock.login.mockResolvedValue(mockTokens);
    await useAuthStore.getState().login("a@b.com", "pass");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("is false after logout", async () => {
    authApiMock.login.mockResolvedValue(mockTokens);
    await useAuthStore.getState().login("a@b.com", "pass");
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe("clearError", () => {
  it("clears error", () => {
    useAuthStore.setState({ error: "some error" });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});
