import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useVisibilityStore } from "../../../stores/visibility-store.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";

// Decision 4 (Blake, 4 Nov): only an Alt-click takes one wall down, and a
// finger's tap never does (SelectionSystem.wall-click.test.tsx). A keyboard
// and a touch screen hide walls with the Walls control: Cut hands the walls to
// the camera, which lowers the ones facing it; Full stands every wall up.
// The planner renders the toolbox compactDesktop, so a desktop reaches Walls
// through "More planner tools" (as editor.spec.ts does), and every touch
// screen, phone or tablet, gets the touch dock instead.

const media = vi.hoisted(() => ({ narrow: false, coarse: false }));
vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const initialVisibility = useVisibilityStore.getState();

/** The toolbox as the live planner renders it. */
function renderPlannerToolbox(): void {
  render(<MemoryRouter><VerticalToolbox compactDesktop /></MemoryRouter>);
}

function wallMode(): string {
  return useVisibilityStore.getState().mode;
}

/** Presses Walls twice, Cut to Full and back, its pressed state saying which each time. */
function expectWallsSwitch(walls: HTMLElement): void {
  expect(wallMode()).toBe("auto-3");
  expect(walls.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(walls);
  expect(wallMode()).toBe("manual");
  expect(walls.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(walls);
  expect(wallMode()).toBe("auto-3");
  expect(walls.getAttribute("aria-pressed")).toBe("false");
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
  it("gives the keyboard the Walls button behind More planner tools, each a native button in the tab order", () => {
    renderPlannerToolbox();
    // The desktop planner keeps its tools folded until asked.
    expect(screen.queryByRole("button", { name: "Show All Walls" })).toBeNull();
    const more = screen.getByRole("button", { name: "More planner tools" });
    // Enter and Space press a native button. happy-dom doesn't turn a key into a click, so the test clicks.
    expect(more.tagName).toBe("BUTTON");
    expect(more.tabIndex).toBe(0);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");

    const walls = within(screen.getByTestId("planner-toolbar")).getByRole("button", { name: "Show All Walls" });
    expect(walls.tagName).toBe("BUTTON");
    expect(walls.tabIndex).toBe(0);
    expect(walls.hasAttribute("disabled")).toBe(false);
    walls.focus();
    expect(document.activeElement).toBe(walls);
    expectWallsSwitch(walls);
  });

  it.each([
    { device: "a phone", narrow: true },
    { device: "a tablet, whose wide screen still takes touch", narrow: false },
  ])("gives $device the touch dock's Walls switch under More, which says when it is off", ({ narrow }) => {
    media.narrow = narrow;
    media.coarse = true;
    renderPlannerToolbox();
    // A touch screen gets no desktop toolbar: the dock's More opens its sheet.
    expect(screen.queryByRole("button", { name: "More planner tools" })).toBeNull();
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");

    const sheet = within(screen.getByTestId("mobile-more-sheet"));
    expectWallsSwitch(sheet.getByRole("button", { name: "Walls" }));
    // Snap is the same kind of switch; Undo is a one-off action and stays a plain button.
    expect(sheet.getByRole("button", { name: "Snap" }).getAttribute("aria-pressed")).not.toBeNull();
    expect(sheet.getByRole("button", { name: "Undo" }).hasAttribute("aria-pressed")).toBe(false);
  });
});
