import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Auth store tests — Clerk compatibility shim
// ---------------------------------------------------------------------------

const { useAuthStore } = await import("../stores/auth-store.js");

const mockUser = {
  id: "u1",
  email: "test@test.com",
  role: "planner",
  platformRole: "none" as const,
  venueId: null,
  name: "Test",
};

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    authSessionId: null,
    authContextRevision: 0,
  });
});

describe("setUser", () => {
  it("sets user and isAuthenticated to true", () => {
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("clears user and sets isAuthenticated to false when null", () => {
    useAuthStore.getState().setUser(mockUser);
    useAuthStore.getState().setUser(null);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("advances private-resource ownership when Clerk replaces a same-user session", () => {
    useAuthStore.getState().setUser(mockUser, "session-a");
    const firstRevision = useAuthStore.getState().authContextRevision;

    useAuthStore.getState().setUser(mockUser, "session-a");
    expect(useAuthStore.getState()).toMatchObject({
      authSessionId: "session-a",
      authContextRevision: firstRevision,
    });

    useAuthStore.getState().setUser(mockUser, "session-b");
    expect(useAuthStore.getState()).toMatchObject({
      authSessionId: "session-b",
      authContextRevision: firstRevision + 1,
    });
  });

  it("advances when an authoritative claims update reaches the same Clerk session", () => {
    useAuthStore.getState().setUser(mockUser, "session-a");
    const firstRevision = useAuthStore.getState().authContextRevision;

    useAuthStore.getState().setUser({ ...mockUser, role: "viewer" }, "session-a");
    expect(useAuthStore.getState()).toMatchObject({
      authSessionId: "session-a",
      authContextRevision: firstRevision + 1,
      user: expect.objectContaining({ role: "viewer" }),
    });
  });
});

describe("setLoading", () => {
  it("sets isLoading", () => {
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe("logout", () => {
  it("clears all state", () => {
    useAuthStore.getState().setUser(mockUser);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().authSessionId).toBeNull();
  });

  it("advances the private-resource generation across logout and same-user relogin", () => {
    useAuthStore.getState().setUser(mockUser);
    const firstSession = useAuthStore.getState().authContextRevision;
    useAuthStore.getState().logout();
    const loggedOut = useAuthStore.getState().authContextRevision;
    useAuthStore.getState().setUser(mockUser);
    expect(loggedOut).toBe(firstSession + 1);
    expect(useAuthStore.getState().authContextRevision).toBe(loggedOut + 1);
  });
});

describe("clearError", () => {
  it("clears error", () => {
    useAuthStore.setState({ error: "some error" });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});

describe("isAuthenticated", () => {
  it("is false by default", () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("is true after setUser", () => {
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("is false after logout", () => {
    useAuthStore.getState().setUser(mockUser);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe("AuthUser type", () => {
  it("includes name field", () => {
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().user?.name).toBe("Test");
  });

  it("supports null venueId", () => {
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().user?.venueId).toBeNull();
  });

  it("supports string venueId", () => {
    useAuthStore.getState().setUser({ ...mockUser, venueId: "v1" });
    expect(useAuthStore.getState().user?.venueId).toBe("v1");
  });

  it("includes platformRole field separate from venue role", () => {
    useAuthStore.getState().setUser({ ...mockUser, role: "admin", platformRole: "none" });
    expect(useAuthStore.getState().user?.role).toBe("admin");
    expect(useAuthStore.getState().user?.platformRole).toBe("none");
  });
});
