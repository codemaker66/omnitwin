import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useAuthStore, type AuthUser } from "../stores/auth-store.js";

// react-router-dom's Navigate calls into the router context. For unit
// tests we want a tiny stub that just renders the target as text so we
// can assert "where would the user end up" without booting a full
// router. The actual navigation behaviour is covered by Playwright e2e.
vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) =>
    `Navigate->${to}${replace === true ? "(replace)" : ""}`,
}));

const { RoleAwareRedirect } = await import("../components/auth/RoleAwareRedirect.js");

function setAuth(state: { isAuthenticated: boolean; isLoading: boolean; user: AuthUser | null }): void {
  useAuthStore.setState({
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: null,
  });
}

describe("RoleAwareRedirect", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the loading fallback while auth is still resolving", () => {
    setAuth({ isAuthenticated: false, isLoading: true, user: null });
    const { container } = render(<RoleAwareRedirect />);
    // Loading shows "Loading..." text and no Navigate stub.
    expect(container.textContent).toContain("Loading...");
    expect(container.textContent).not.toContain("Navigate->");
  });

  it("redirects an unauthenticated visitor to /plan", () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/plan(replace)");
  });

  it("redirects an admin straight to /dashboard (no /plan bounce)", () => {
    setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u1", email: "a@x.com", role: "admin", venueId: "v1", name: "Admin" },
    });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/dashboard(replace)");
  });

  it("redirects a hallkeeper straight to /dashboard", () => {
    setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u2", email: "h@x.com", role: "hallkeeper", venueId: "v1", name: "Halle" },
    });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/dashboard(replace)");
  });

  it("redirects a planner straight to /dashboard", () => {
    setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u3", email: "p@x.com", role: "planner", venueId: "v1", name: "Plan" },
    });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/dashboard(replace)");
  });

  it("sends a logged-in client to /plan (their working surface)", () => {
    setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u4", email: "c@x.com", role: "client", venueId: null, name: "Client" },
    });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/plan(replace)");
  });

  it("treats isAuthenticated=true with user=null defensively (anon path)", () => {
    setAuth({ isAuthenticated: true, isLoading: false, user: null });
    const { container } = render(<RoleAwareRedirect />);
    expect(container.textContent).toBe("Navigate->/plan(replace)");
  });
});
