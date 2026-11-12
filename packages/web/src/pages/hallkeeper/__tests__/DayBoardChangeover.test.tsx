import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Changeover, ChangeoverItem } from "@omnitwin/types";
import { ChangeoverList } from "../DayBoardChangeover.js";

// ---------------------------------------------------------------------------
// The move list a crew works a changeover from: what goes back to store,
// what comes from it (and where it goes), what stays, what the plan says
// moves within the room, and the dressing each booking lays for itself.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

function item(name: string, before: number, after: number, overrides: Partial<ChangeoverItem> = {}): ChangeoverItem {
  return { name, category: "table", phase: "furniture", isAccessory: false, before, after, zones: [], ...overrides };
}

const PLAN: NonNullable<Changeover["plan"]> = {
  staysPut: 12, moved: [{ name: "6ft Round Table", category: "table", count: 1 }],
  fromStore: [], toStore: [], movedIds: [], fromStoreIds: [], toStoreFootprints: [],
};

function changeover(items: readonly ChangeoverItem[], plan: Changeover["plan"] = PLAN, hasPlan = { from: plan !== null, to: plan !== null }): Changeover {
  return {
    from: { configId: "00000000-0000-4000-8000-0000000000c1", name: "Wedding", guests: 180, hasPlan: hasPlan.from },
    to: { configId: "00000000-0000-4000-8000-0000000000c2", name: "Conference", guests: 200, hasPlan: hasPlan.to },
    items: [...items],
    plan,
  };
}

function list(value: Changeover): void {
  render(<ChangeoverList changeover={value} fromTitle="Anderson wedding" toTitle="Chamber conference" />);
}

function group(heading: string): string[] {
  const box = screen.getByRole("heading", { name: heading }).parentElement;
  if (box === null) throw new Error(`no ${heading} group`);
  return within(box).getAllByRole("listitem").map((entry) => entry.textContent ?? "");
}

describe("ChangeoverList", () => {
  it("lists what goes back to store, what comes from it and where, and what stays", () => {
    list(changeover([
      item("6ft Round Table", 18, 12),
      item("Lectern", 0, 1, { category: "av", zones: [{ zone: "North wall", before: 0, after: 1 }] }),
      // Spread over more than two parts, the plan says where better than a list.
      item("Banquet Chair", 0, 30, { category: "chair", zones: [
        { zone: "Centre", before: 0, after: 10 }, { zone: "Perimeter", before: 0, after: 10 }, { zone: "East wall", before: 0, after: 10 },
      ] }),
    ]));
    expect(group("Back to store")).toEqual(["6 × 6ft Round Table"]);
    expect(group("Bring from store")).toEqual(["1 × Lectern · North wall", "30 × Banquet Chair"]);
    expect(group("Stays")).toEqual(["12 × 6ft Round Table"]);
    expect(screen.getByText("On the plan: 12 pieces stay where they are; 1 × 6ft Round Table moves within the room.")).toBeTruthy();
  });

  it("never lists a cloth as staying: the room's is cleared and the next booking's laid", () => {
    list(changeover([
      item("6ft Round Table", 18, 18),
      item("Black Round Table Linen", 18, 12, { category: "decor", isAccessory: true, phase: "dress" }),
      item("Black Poseur Table Linen", 0, 6, { category: "decor", isAccessory: true, phase: "dress" }),
    ], { ...PLAN, staysPut: 18, moved: [] }));
    expect(group("Linen and dressing")).toEqual(["Black Round Table Linen: clear 18, lay 12", "Black Poseur Table Linen: lay 6"]);
    expect(screen.getByText("The furniture stays as it is.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Stays" })).toBeNull();
  });

  it("says nothing moves when the room is already set as the next booking needs it", () => {
    list(changeover([item("Theatre chair", 200, 200)], { ...PLAN, staysPut: 200, moved: [] }));
    expect(screen.getByText("Nothing moves: the room is already set as the next booking needs it.")).toBeTruthy();
  });

  it("without a plan, says which parts of the room change rather than that nothing moves, and why it can say no more", () => {
    list(changeover([
      item("6ft Round Table", 18, 18, { zones: [{ zone: "North wall", before: 0, after: 9 }, { zone: "Centre", before: 18, after: 9 }] }),
    ], null, { from: false, to: true }));
    expect(screen.queryByText(/^Nothing moves/u)).toBeNull();
    expect(group("To another part of the room")).toEqual(["9 × 6ft Round Table · North wall"]);
    expect(screen.getByText("The sheet for Anderson wedding has no plan, so moves within each part of the room aren’t shown.")).toBeTruthy();
  });

  it("without a plan or any change, claims only what the counts can show", () => {
    list(changeover([item("6ft Round Table", 18, 18)], null, { from: false, to: false }));
    expect(screen.getByText("Nothing goes to or from store, and nothing changes part of the room.")).toBeTruthy();
    expect(screen.getByText("Neither sheet has a plan, so moves within each part of the room aren’t shown.")).toBeTruthy();
  });

  it("counts only the pieces that change part beyond what comes from store", () => {
    list(changeover([
      item("6ft Round Table", 10, 12, { zones: [{ zone: "Centre", before: 10, after: 0 }, { zone: "Perimeter", before: 0, after: 12 }] }),
    ], null, { from: true, to: false }));
    expect(group("Bring from store")).toEqual(["2 × 6ft Round Table · Perimeter"]);
    expect(group("To another part of the room")).toEqual(["10 × 6ft Round Table · Perimeter"]);
    expect(screen.getByText("The sheet for Chamber conference has no plan, so moves within each part of the room aren’t shown.")).toBeTruthy();
  });
});
