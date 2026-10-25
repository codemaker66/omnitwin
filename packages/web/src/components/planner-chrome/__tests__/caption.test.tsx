import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Caption } from "../Caption.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { projectScreenAnchors, screenAnchorCount } from "../../../lib/screen-anchors.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// The caption (T-671 slice 11′; approved spec §6.6): beside the selected
// piece, its number, name and size, the seat stepper and its verbs; each verb
// is the same command as its key; it follows its piece through the screen
// anchors and steps aside for a card in hand, Walk, or no selection.
// ---------------------------------------------------------------------------

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}

function piece(id: string, slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { id, catalogueItemId: idOf(slug), x, y: 0, z, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null, ...extra };
}

function tableEight(): PlacedItem[] {
  return [
    piece("t8", "round-table-6ft", 3, 3, { groupId: "g8", label: "Table 8" }),
    ...Array.from({ length: 10 }, (_, n) => piece(`c${String(n)}`, "banquet-chair", 3 + 0.95 * Math.cos(n * 0.628), 3 + 0.95 * Math.sin(n * 0.628), { groupId: "g8" })),
  ];
}

function chairsAround(): number {
  return usePlacementStore.getState().placedItems.filter((item) => item.groupId === "g8" && item.id !== "t8").length;
}

beforeEach(() => {
  usePlacementStore.setState({ placedItems: tableEight() });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().disarm();
  useCockpitStore.getState().setWalkMode(false);
});
afterEach(cleanup);

function caption(): HTMLElement {
  return screen.getByRole("group", { name: /^Table 8/u });
}

describe("what it says", () => {
  it("is nothing until a piece is selected", () => {
    render(<Caption />);
    expect(screen.queryByRole("group", { name: /^Table 8/u })).toBeNull();
    expect(screenAnchorCount()).toBe(0);
  });

  it("names the table, its card and its size, and steps its seats", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    expect(within(caption()).getByText("TABLE 8")).toBeTruthy();
    expect(within(caption()).getByText("Round 6 ft")).toBeTruthy();
    expect(within(caption()).getByText("1.8 m round")).toBeTruthy();
    expect(within(caption()).getByRole("slider", { name: "Seats at Table 8" }).getAttribute("aria-valuenow")).toBe("10");
  });
});

describe("its verbs are the keys' commands", () => {
  it("turns the table with its chairs, a quarter turn as R does", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    fireEvent.click(within(caption()).getByRole("button", { name: /^Turn/u }));
    const table = usePlacementStore.getState().placedItems.find((item) => item.id === "t8");
    expect(Math.abs(table?.rotationY ?? 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("takes a seat away", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    fireEvent.click(within(caption()).getByRole("button", { name: /^Fewer seats/u }));
    expect(chairsAround()).toBe(9);
  });

  it("puts a cloth on", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    fireEvent.click(within(caption()).getByRole("button", { name: /^Cloth/u }));
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === "t8")?.clothed).toBe(true);
  });

  it("removes the table and its chairs, and then is gone", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    fireEvent.click(within(caption()).getByRole("button", { name: /^Remove/u }));
    expect(usePlacementStore.getState().placedItems).toEqual([]);
    expect(screen.queryByRole("group", { name: /^Table 8/u })).toBeNull();
  });
});

describe("where it is", () => {
  it("follows its piece: the projector's point places it beside the pin", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    expect(screenAnchorCount()).toBe(1);
    // Not placed yet, so not seen: a caption never waits in the corner.
    expect(caption().closest<HTMLElement>(".pc-caption")?.hasAttribute("data-placed")).toBe(false);
    act(() => { projectScreenAnchors(() => ({ x: 400, y: 300, visible: true })); });
    expect(caption().closest<HTMLElement>(".pc-caption")?.dataset["side"]).toBe("right");
    expect(caption().closest<HTMLElement>(".pc-caption")?.style.transform).toContain("translate(");
    expect(caption().closest<HTMLElement>(".pc-caption")?.hasAttribute("data-placed")).toBe(true);
  });

  it("steps aside for a card in hand and for Walk", () => {
    render(<Caption />);
    act(() => { useSelectionStore.getState().select("t8"); });
    act(() => { useCatalogueStore.getState().armCard("round"); });
    expect(screen.queryByRole("group", { name: /^Table 8/u })).toBeNull();
    act(() => { useCatalogueStore.getState().disarm(); useSelectionStore.getState().select("t8"); useCockpitStore.getState().setWalkMode(true); });
    expect(screen.queryByRole("group", { name: /^Table 8/u })).toBeNull();
    expect(screenAnchorCount()).toBe(0);
  });
});
