import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";

// web-auth-routing-5: "Your Account" in the planner sent every signed-in
// person to /dashboard. That route admits the venue's own roles only, so a
// client (or a caterer) opening their plan met "Access needed", told to ask
// the venue's admin, with signing out as the first button. The account
// control now leads each person to a place that admits them: the venue's desk
// for those it admits, as before, and otherwise their own home, the place the
// app sends them after signing in (lib/role-routing.ts getDefaultRoute).

const media = vi.hoisted(() => ({ narrow: false, coarse: false }));
vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const PLAN = "/plan/11111111-1111-4111-8111-111111111111";

function signIn(role: string): void {
  const user: AuthUser = { id: "u1", email: "person@example.test", role, platformRole: "none", venueId: null, name: "Person" };
  useAuthStore.getState().setUser(user);
}

/** Where the router stands once the control has been pressed. */
function Where(): ReactElement {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

/** The toolbox as the live planner renders it, on a plan's own address. */
function renderPlannerToolbox(): void {
  render(
    <MemoryRouter initialEntries={[PLAN]}>
      <Routes>
        <Route path="*" element={<><VerticalToolbox compactDesktop /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Opens the desktop's folded tools and presses Your Account. */
function pressDesktopAccount(): void {
  fireEvent.click(screen.getByRole("button", { name: "More planner tools" }));
  fireEvent.click(within(screen.getByTestId("planner-toolbar")).getByRole("button", { name: "Your Account" }));
}

/** Opens the touch dock's More sheet and presses Account. */
function pressPhoneAccount(): void {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(within(screen.getByTestId("mobile-more-sheet")).getByRole("button", { name: "Account" }));
}

beforeEach(() => {
  media.narrow = false;
  media.coarse = false;
  window.localStorage.clear();
  window.localStorage.setItem("omnitwin_onboarding_seen", "1");
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
});

describe("the planner's account control", () => {
  it.each([
    { role: "client", home: "/events" },
    { role: "caterer", home: "/plan" },
  ])("takes a signed-in $role to their own home, never to the venue's desk", ({ role, home }) => {
    signIn(role);
    renderPlannerToolbox();
    pressDesktopAccount();
    expect(screen.getByTestId("where").textContent).toBe(home);
  });

  it("takes a client on a phone to their own home too", () => {
    media.narrow = true;
    media.coarse = true;
    signIn("client");
    renderPlannerToolbox();
    pressPhoneAccount();
    expect(screen.getByTestId("where").textContent).toBe("/events");
  });

  it.each(["admin", "manager", "staff", "sales", "hallkeeper", "planner"])(
    "still takes %s, whom the venue's desk admits, to /dashboard",
    (role) => {
      signIn(role);
      renderPlannerToolbox();
      pressDesktopAccount();
      expect(screen.getByTestId("where").textContent).toBe("/dashboard");
    },
  );
});
