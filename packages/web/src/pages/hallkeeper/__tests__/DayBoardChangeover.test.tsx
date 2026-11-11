import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Changeover, ChangeoverItem } from "@omnitwin/types";
import { ChangeoverList } from "../DayBoardChangeover.js";

// ---------------------------------------------------------------------------
// The move list a crew works a changeover from: what goes back to store,
// what comes from it (and where it goes), what stays, and what the plan says
// moves within the room.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

function item(name: string, before: number, after: number, overrides: Partial<ChangeoverItem> = {}): ChangeoverItem {
  return { name, category: "table", phase: "furniture", isAccessory: false, before, after, zones: [], ...overrides };
}

function changeover(items: readonly ChangeoverItem[], plan: Changeover["plan"] = null): Changeover {
  return {
    from: { configId: "00000000-0000-4000-8000-0000000000c1", name: "Wedding", guests: 180 },
    to: { configId: "00000000-0000-4000-8000-0000000000c2", name: "Conference", guests: 200 },
    items: [...items],
    plan,
  };
}

describe("ChangeoverList", () => {
  it("lists what goes back to store, what comes from it and where, and what stays", () => {
    render(<ChangeoverList changeover={changeover([
      item("6ft Round Table", 18, 12),
      item("Lectern", 0, 1, { category: "av", zones: [{ zone: "North wall", before: 0, after: 1 }] }),
      item("White cloth", 18, 12, { category: "linen", isAccessory: true, phase: "dress" }),
    ], {
      staysPut: 12, moved: [{ name: "6ft Round Table", category: "table", count: 1 }],
      fromStore: [], toStore: [], movedIds: [], fromStoreIds: [], toStoreFootprints: [],
    })} />);
    const group = (heading: string): string[] => {
      const box = screen.getByRole("heading", { name: heading }).parentElement;
      if (box === null) throw new Error(`no ${heading} group`);
      return within(box).getAllByRole("listitem").map((entry) => entry.textContent ?? "");
    };
    expect(group("Back to store")).toEqual(["6 × 6ft Round Table", "6 × White cloth"]);
    expect(group("Bring from store")).toEqual(["1 × Lectern · North wall"]);
    expect(group("Stays")).toEqual(["12 × 6ft Round Table", "12 × White cloth"]);
    expect(screen.getByText("On the plan: 12 pieces stay where they are; 1 × 6ft Round Table moves within the room.")).toBeTruthy();
  });

  it("says nothing moves when the room is already set as the next booking needs it", () => {
    render(<ChangeoverList changeover={changeover([item("Theatre chair", 200, 200)])} />);
    expect(screen.getByText("Nothing moves: the room is already set as the next booking needs it.")).toBeTruthy();
  });
});
