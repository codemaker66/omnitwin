import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useVisibilityStore } from "../../../stores/visibility-store.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";

// Decision 4 (Blake, 4 Nov): only an Alt-click takes one wall down, and a
// finger's tap never does (SelectionSystem.wall-click.test.tsx). A keyboard
// and a phone hide walls with the Walls control: Cut hands the walls to the
// camera, which lowers the ones facing it; Full stands every wall up.

const media = vi.hoisted(() => ({ narrow: false, coarse: false }));
vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const initialVisibility = useVisibilityStore.getState();

function renderToolbox(): void {
  render(<MemoryRouter><VerticalToolbox /></MemoryRouter>);
}

function wallMode(): string {
  return useVisibilityStore.getState().mode;
}

beforeEach(() => {
  media.narrow = false;
  media.coarse = false;
  window.localStorage.clear();
  window.localStorage.setItem("omnitwin_onboarding_seen", "1");
  useVisibilityStore.setState(initialVisibility, true);
  setPlannerFeaturesForTesting({ wallClickAlt: true });
});

afterEach(() => {
  cleanup();
  useVisibilityStore.setState(initialVisibility, true);
  setPlannerFeaturesForTesting(null);
});

describe("hiding walls without Alt (decision 4)", () => {
  it("gives the keyboard the toolbar's Walls button, a native button in the tab order that switches Full and Cut", () => {
    renderToolbox();
    const walls = screen.getByRole("button", { name: "Show All Walls" });
    // Enter and Space press a native button; nothing takes this one out of the tab order.
    expect(walls.tagName).toBe("BUTTON");
    expect(walls.tabIndex).toBe(0);
    expect(walls.hasAttribute("disabled")).toBe(false);
    walls.focus();
    expect(document.activeElement).toBe(walls);

    expect(wallMode()).toBe("auto-3");
    fireEvent.click(walls);
    expect(wallMode()).toBe("manual");
    expect(walls.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(walls);
    expect(wallMode()).toBe("auto-3");
    expect(walls.getAttribute("aria-pressed")).toBe("false");
  });

  it("gives a phone the Walls button in More's tools, which a tap presses", () => {
    media.narrow = true;
    renderToolbox();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const walls = within(screen.getByTestId("mobile-more-sheet")).getByRole("button", { name: "Walls" });
    expect(walls.tagName).toBe("BUTTON");

    expect(wallMode()).toBe("auto-3");
    fireEvent.click(walls);
    expect(wallMode()).toBe("manual");
  });
});
