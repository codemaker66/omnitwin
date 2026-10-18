import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { ClientEventPage } from "../ClientEventPage.js";

// The event page's way back (fix-first 12): the client's side returns to
// their own events, where they landed; anyone else to the front door.

vi.mock("../../hooks/use-client-event-schedule.js", () => ({
  useClientEventSchedule: () => ({ status: "loading", data: null, refresh: () => undefined }),
}));

function as(role: string): void {
  const user: AuthUser = { id: "00000000-0000-4000-8000-0000000000aa", name: "Fixture", email: "fixture@example.test", role, platformRole: "none", venueId: null };
  useAuthStore.setState({ user, isAuthenticated: true, isLoading: false });
}

function show(): void {
  render(<MemoryRouter initialEntries={["/events/00000000-0000-4000-8000-0000000000e1"]}>
    <Routes><Route path="/events/:eventId" element={<ClientEventPage />} /></Routes>
  </MemoryRouter>);
}

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});

describe("the client event page's way back", () => {
  it.each(["client", "planner"])("takes a %s back to their own events", (role) => {
    as(role);
    show();
    expect(screen.getByRole("link", { name: "All your events" }).getAttribute("href")).toBe("/events");
    expect(screen.queryByRole("link", { name: "Venviewer home" })).toBeNull();
  });

  it("takes the venue's team to the front door, as before", () => {
    as("staff");
    show();
    expect(screen.getByRole("link", { name: "Venviewer home" }).getAttribute("href")).toBe("/");
  });
});
