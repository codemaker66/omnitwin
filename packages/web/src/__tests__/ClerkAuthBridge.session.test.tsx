import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../stores/auth-store.js";

const clerkState = vi.hoisted(() => ({
  sessionId: "session-a",
  getToken: vi.fn(() => Promise.resolve("token")),
  user: {
    id: "planner-1",
    primaryEmailAddress: { emailAddress: "planner@example.test" },
    publicMetadata: {
      role: "planner",
      platformRole: "none",
      venueId: "33333333-3333-4333-8333-333333333333",
    },
    fullName: "Planner One",
    firstName: "Planner",
  },
}));

const getCurrentAuthUserMock = vi.hoisted(() => vi.fn());
const setTokenGetterMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: clerkState.user }),
  useAuth: () => ({ getToken: clerkState.getToken, sessionId: clerkState.sessionId }),
}));

vi.mock("../api/auth-bridge.js", () => ({ setTokenGetter: setTokenGetterMock }));

vi.mock("../api/auth.js", () => ({
  PlatformRoleSchema: {
    safeParse: (value: unknown) => value === "none" || value === "operator" || value === "admin"
      ? { success: true, data: value }
      : { success: false },
  },
  getCurrentAuthUser: getCurrentAuthUserMock,
}));

const authoritativeUser = {
  id: "planner-1",
  email: "planner@example.test",
  role: "planner",
  platformRole: "none" as const,
  venueId: "33333333-3333-4333-8333-333333333333",
  name: "Planner One",
};

beforeEach(() => {
  vi.clearAllMocks();
  clerkState.sessionId = "session-a";
  getCurrentAuthUserMock.mockResolvedValue(authoritativeUser);
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    authSessionId: null,
    authContextRevision: 0,
  });
});

describe("ClerkAuthBridge private-resource lifecycle", () => {
  it("advances the real auth store when Clerk replaces a same-user session", async () => {
    const { ClerkAuthBridge } = await import("../components/auth/ClerkAuthBridge.js");
    const rendered = render(createElement(ClerkAuthBridge));

    await waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        user: authoritativeUser,
        authSessionId: "session-a",
        authContextRevision: 1,
      });
    });

    clerkState.sessionId = "session-b";
    rendered.rerender(createElement(ClerkAuthBridge));

    await waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        user: authoritativeUser,
        authSessionId: "session-b",
        authContextRevision: 2,
      });
    });
    rendered.unmount();
  });
});
