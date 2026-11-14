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
const EVENT_PLAN = `${PLAN}?eventId=22222222-2222-4222-8222-222222222222`;

function signIn(role: string): void {
  const user: AuthUser = { id: "u1", email: "person@example.test", role, platformRole: "none", venueId: null, name: "Person" };
  useAuthStore.getState().setUser(user);
}

/** Where the router stands once the control has been pressed. */
function Where(): ReactElement {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

/** The toolbox as the live planner renders it, on a plan's own address. */
function renderPlannerToolbox(address: string = PLAN): void {
  render(
    <MemoryRouter initialEntries={[address]}>
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
  it("takes a signed-in client to their own home, never to the venue's desk", () => {
    signIn("client");
    renderPlannerToolbox();
    pressDesktopAccount();
    expect(screen.getByTestId("where").textContent).toBe("/events");
  });

  // #418 C2: a caterer's own home is the planner, where they already are.
  // Going to /plan would drop the plan's code and its ?eventId, and a reload
  // or a copied link would then open a fresh draft instead of this plan.
  it.each([
    { device: "desktop", narrow: false, press: pressDesktopAccount },
    { device: "phone", narrow: true, press: pressPhoneAccount },
  ])("keeps a caterer, whose own home is the planner, on the plan's address ($device)", ({ narrow, press }) => {
    media.narrow = narrow;
    media.coarse = narrow;
    signIn("caterer");
    renderPlannerToolbox(EVENT_PLAN);
    press();
    expect(screen.getByTestId("where").textContent).toBe(EVENT_PLAN);
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
