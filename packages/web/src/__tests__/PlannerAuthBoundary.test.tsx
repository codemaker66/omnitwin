import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../stores/auth-store.js";

const sessionHint = vi.hoisted(() => vi.fn(() => false));
vi.mock("../lib/clerk-session-hint.js", () => ({ hasLikelyClerkSession: sessionHint }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  createBrowserRouter: vi.fn(() => ({})),
}));
vi.mock("../components/auth/ClerkRouteProvider.js", () => ({
  ClerkRouteProvider: ({ children }: { readonly children: ReactNode }) => <div data-testid="clerk-provider">{children}</div>,
}));
import { PlannerAuthBoundary } from "../router.js";

function renderBoundary(): void {
  render(<Suspense fallback={<div>Loading provider</div>}><PlannerAuthBoundary><div>Planner</div></PlannerAuthBoundary></Suspense>);
}

describe("PlannerAuthBoundary", () => {
  beforeEach(() => {
    sessionHint.mockReturnValue(false);
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, error: null, accessStatus: "signed_out", accessEmail: null });
  });
  afterEach(cleanup);

  it("settles the initially loading guest without mounting Clerk", () => {
    renderBoundary();
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.queryByTestId("clerk-provider")).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("leaves a cookie-bearing session loading for Clerk to verify", async () => {
    sessionHint.mockReturnValue(true);
    renderBoundary();
    await waitFor(() => expect(screen.getByTestId("clerk-provider")).toBeTruthy());
    expect(useAuthStore.getState().isLoading).toBe(true);
  });

  it("preserves an already hydrated session even without a cookie hint", async () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: true });
    renderBoundary();
    await waitFor(() => expect(screen.getByTestId("clerk-provider")).toBeTruthy());
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
  });

  it("keeps Clerk mounted while a hydrated session verifies workspace access", async () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: true });
    renderBoundary();
    await waitFor(() => expect(screen.getByTestId("clerk-provider")).toBeTruthy());
    act(() => { useAuthStore.getState().beginAccessCheck("presenter@example.test"); });
    expect(screen.getByTestId("clerk-provider")).toBeTruthy();
    expect(useAuthStore.getState().isLoading).toBe(true);
    act(() => { useAuthStore.getState().failAccessCheck("Invitation pending", true); });
    expect(screen.getByTestId("clerk-provider")).toBeTruthy();
  });
});
