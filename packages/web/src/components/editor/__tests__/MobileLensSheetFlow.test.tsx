import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { LensSheet } from "../cockpit/LensSheet.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";

// The planner's first ten seconds on a phone: More → a lens → the lens is on
// screen. Before the sheet, choosing a lens set it and showed nothing.

const media = vi.hoisted(() => ({ narrow: true, coarse: false }));
vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

// The sheet hosts whatever the registry gives it; these stand-ins carry the
// visitor's way forward without the real panels' venue reads.
vi.mock("../cockpit/CockpitRightDock.js", () => {
  const panels = new Map<string, () => ReactElement>();
  return {
    panelForMode: (mode: string) => {
      if (mode === "design") return null;
      let panel = panels.get(mode);
      if (panel === undefined) {
        panel = () => (
          <aside className="lens-panel" aria-label={`${mode} lens`}>
            <header className="lens-panel__head"><span>Published capacity</span></header>
            <a href="mailto:events@example.test">Ask us for a quote</a>
          </aside>
        );
        panels.set(mode, panel);
      }
      return panel;
    },
  };
});

function reduceMotion(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function Planner(): ReactElement {
  return <MemoryRouter><VerticalToolbox /><LensSheet /></MemoryRouter>;
}

/** The lens buttons a group in the More sheet offers, in order. */
function lensesIn(group: string): string[] {
  return within(screen.getByRole("group", { name: group })).getAllByRole("button").map((button) => button.textContent);
}

beforeEach(() => {
  media.narrow = true;
  media.coarse = false;
  window.localStorage.clear();
  window.localStorage.setItem("omnitwin_onboarding_seen", "1");
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useCatalogueStore.getState().clearSelection();
  useSelectionStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [] });
  reduceMotion();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setPlannerFeaturesForTesting(null);
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
});

describe("the More sheet offers this viewer's lenses (Blake's decision 5)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isLoading: false, isAuthenticated: false, user: null });
  });

  it("lists all eleven, as today, with both keys off", () => {
    render(<Planner />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(lensesIn("Planner lenses")).toHaveLength(11);
    expect(screen.queryByRole("group", { name: "Venue tools" })).toBeNull();
  });

  it("offers an anonymous visitor only the client four under lensesByRole", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true });
    render(<Planner />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(lensesIn("Planner lenses")).toEqual(["Design", "Guests", "Costs", "Share"]);
  });

  it("puts the technical seven under a titled Venue tools group under lensesDivider", () => {
    setPlannerFeaturesForTesting({ lensesDivider: true });
    render(<Planner />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(lensesIn("Planner lenses")).toEqual(["Design", "Guests", "Costs", "Share"]);
    expect(lensesIn("Venue tools")).toEqual(["Flow", "Evidence", "Lighting", "Power", "Rigging", "AV", "Ops"]);
    expect(within(screen.getByTestId("mobile-more-sheet")).getByText("Venue tools")).toBeTruthy();
  });
});

describe("a lens chosen from More on a phone or tablet", () => {
  it.each([
    { label: "narrow phone", narrow: true, coarse: false },
    { label: "wide coarse-pointer tablet", narrow: false, coarse: true },
  ])("opens as a sheet and gives focus back to More when closed ($label)", async ({ narrow, coarse }) => {
    media.narrow = narrow;
    media.coarse = coarse;
    render(<Planner />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.click(within(screen.getByRole("group", { name: "Planner lenses" })).getByRole("button", { name: "Guests" }));

    const sheet = screen.getByRole("dialog", { name: "Guests" });
    expect(within(sheet).getByText("Published capacity")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Ask us for a quote" })).toBeTruthy();
    expect(screen.queryByTestId("mobile-more-sheet")).toBeNull();
    const close = within(sheet).getByRole("button", { name: "Close Guests" });
    await waitFor(() => { expect(document.activeElement).toBe(close); });

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(document.activeElement).toBe(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens no sheet for Design, which is the planner itself", () => {
    render(<Planner />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Planner lenses" })).getByRole("button", { name: "Design" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCockpitStore.getState().activeMode).toBe("design");
  });

  it("leaves the plan untouched when a lens is opened and closed", () => {
    render(<Planner />);
    const placements = usePlacementStore.getState().placedItems;
    const objects = useEditorStore.getState().objects;
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Costs" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Costs" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(usePlacementStore.getState().placedItems).toBe(placements);
    expect(useEditorStore.getState().objects).toBe(objects);
  });
});
