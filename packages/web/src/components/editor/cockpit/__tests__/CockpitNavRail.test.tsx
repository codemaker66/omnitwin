import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitNavRail } from "../CockpitNavRail.js";

// The venue team's rail: every lens (Blake's decision 5). Each role's own
// rail is CockpitNavRail.lenses.test.tsx's.
const STAFF = { id: "staff-1", email: "floor@example.com", name: "Floor Staff", role: "staff", platformRole: "none", venueId: "venue-1" } as const;

beforeEach(() => { useAuthStore.setState({ user: STAFF, isAuthenticated: true, isLoading: false }); });
afterEach(() => {
  cleanup();
  useCockpitStore.getState().reset();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true });
});

describe("CockpitNavRail", () => {
  it("renders eleven lens buttons with Design pressed by default", () => {
    render(<CockpitNavRail />);
    const buttons = screen.getAllByRole("button", { name: /design|guests|flow|evidence|lighting|power|rigging|av|ops|costs|share/i });
    expect(buttons.length).toBeGreaterThanOrEqual(11);
    expect(screen.getByRole("button", { name: /design/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the active lens in the store on click", () => {
    render(<CockpitNavRail />);
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(useCockpitStore.getState().activeMode).toBe("flow");
    expect(screen.getByRole("button", { name: /flow/i }).getAttribute("aria-pressed")).toBe("true");
  });
});
