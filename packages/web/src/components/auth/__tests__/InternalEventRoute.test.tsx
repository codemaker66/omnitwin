import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InternalEventRoute } from "../InternalEventRoute.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// In the app this guard always renders inside ClerkRouteProvider, which is
// what lets the denial screen offer "Use another account".
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn() }) }));

function seedUser(role: string, platformRole: "none" | "admin" = "none"): void {
  useAuthStore.getState().setUser({ id: "operator", role, platformRole, venueId: "venue", name: "Operator", email: "operator@example.test" });
}

function showRoute(): void {
  render(<MemoryRouter initialEntries={["/event-architect"]}><InternalEventRoute><div>Internal event tool</div></InternalEventRoute></MemoryRouter>);
}

afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("InternalEventRoute", () => {
  it.each(["staff", "admin", "hallkeeper"])("admits an authenticated %s", (role) => {
    seedUser(role);
    showRoute();
    expect(screen.getByText("Internal event tool")).toBeTruthy();
  });

  it.each(["client", "planner", "caterer"])("denies the %s role", (role) => {
    seedUser(role);
    showRoute();
    expect(screen.queryByText("Internal event tool")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Access needed");
  });

  it("admits a platform administrator with a customer base role", () => {
    seedUser("planner", "admin");
    showRoute();
    expect(screen.getByText("Internal event tool")).toBeTruthy();
  });

  it("waits for authentication even with a cached staff identity", () => {
    seedUser("staff");
    useAuthStore.getState().setLoading(true);
    showRoute();
    expect(screen.queryByText("Internal event tool")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Checking access");
  });

  it("does not mount internal tools for a signed-out or missing identity", () => {
    seedUser("staff");
    useAuthStore.setState({ isAuthenticated: false });
    showRoute();
    expect(screen.queryByText("Internal event tool")).toBeNull();
  });

  it("unmounts the internal tool synchronously after authority is removed", () => {
    seedUser("staff");
    showRoute();
    act(() => { seedUser("planner"); });
    expect(screen.queryByText("Internal event tool")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
