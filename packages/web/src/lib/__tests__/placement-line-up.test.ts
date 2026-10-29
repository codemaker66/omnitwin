import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem } from "../catalogue.js";
import { createGhostWorld } from "../ghost-truth.js";
import { LINE_UP_NEEDS_TWO, planLineUp, planMove, selectionUnits, wholeSelection } from "../placement-edit.js";
import type { PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId } from "../setup-cards.js";
import { rearrangeTableGroup } from "../table-group.js";

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

let counter = 0;
function ids(): string {
  counter += 1;
  return `l-${String(counter)}`;
}

function round(x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0, ids);
}

/** A Top or Long table set (table sets on), `trestles` long. */
function set(card: CardId, trestles: number, x: number, z: number): readonly PlacedItem[] {
  setPlannerFeaturesForTesting({ tableSets: true });
  const params = cardParamsFor(card, { trestles });
  if (params === null) throw new Error(`no ${card}`);
  return stampSetup(params, { x, z }, 0, ids);
}

function trestlesOf(pieces: readonly PlacedItem[]): readonly PlacedItem[] {
  return pieces.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

/** A set whose first trestle's chairs have lost the set (a layout saved before sets were): only their group ties them in. */
function withLooseChairs(pieces: readonly PlacedItem[]): readonly PlacedItem[] {
  const first = trestlesOf(pieces)[0];
  return pieces.map((piece) => {
    if (piece === first || piece.groupId !== first?.groupId) return piece;
    const { setId: _setId, ...loose } = piece;
    return loose;
  });
}

function tableOf(pieces: readonly PlacedItem[], groupId: string | null): PlacedItem {
  const table = pieces.find((piece) => piece.groupId === groupId && getCatalogueItem(piece.catalogueItemId)?.category === "table");
  if (table === undefined) throw new Error("no table");
  return table;
}

function world(pieces: readonly PlacedItem[]): ReturnType<typeof createGhostWorld> {
  return createGhostWorld(pieces, GRAND_HALL_RENDER_DIMENSIONS);
}

describe("Line up", () => {
  it("puts four jittered rounds on one line, each with its chairs", () => {
    const rounds = [round(-7.5, 0.3), round(-2.5, -0.2), round(2.5, 0.1), round(7.5, -0.3)];
    const room = rounds.flat();
    const plan = planLineUp(new Set(rounds.map((r) => r[0]?.id ?? "")), world(room));
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.items).toHaveLength(44);
    const zs = rounds.map((r) => tableOf(plan.items, r[0]?.groupId ?? null).z);
    for (const z of zs) expect(z).toBeCloseTo(-0.025, 9);
    for (const r of rounds) {
      const before = r[1];
      const after = plan.items.find((piece) => piece.id === before?.id);
      const table = tableOf(plan.items, before?.groupId ?? null);
      const oldTable = r[0];
      if (before === undefined || after === undefined || oldTable === undefined) throw new Error("missing chair");
      expect(after.x - table.x).toBeCloseTo(before.x - oldTable.x, 9);
      expect(after.z - table.z).toBeCloseTo(before.z - oldTable.z, 9);
      expect(after.x).toBeCloseTo(before.x, 9);
    }
  });

  it("lines up along Z when the pieces spread that way", () => {
    const rounds = [round(0.2, -3), round(-0.2, 2)];
    const plan = planLineUp(new Set(rounds.map((r) => r[0]?.id ?? "")), world(rounds.flat()));
    if (!plan.ok) throw new Error(plan.reason);
    for (const r of rounds) expect(tableOf(plan.items, r[0]?.groupId ?? null).x).toBeCloseTo(0, 9);
  });

  it("is refused, with the reason, when the line would overlap", () => {
    const rounds = [round(-2, 0), round(2, 0), round(0, 3.4)];
    const plan = planLineUp(new Set(rounds.map((r) => r[0]?.id ?? "")), world(rounds.flat()));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/^Won't fit · would overlap the round/u);
  });

  it("needs two or more, and says so", () => {
    const one = round(0, 0);
    expect(planLineUp(new Set([one[0]?.id ?? ""]), world(one))).toEqual({ ok: false, obstacle: null, reason: LINE_UP_NEEDS_TWO });
  });

  it("moves a Top table set whole, with a round, as two", () => {
    const top = set("top-table", 4, -5, 2.2);
    const other = round(4, -0.4);
    const room = [...top, ...other];
    const plan = planLineUp(new Set([top[0]?.id ?? "", other[0]?.id ?? ""]), world(room));
    if (!plan.ok) throw new Error(plan.reason);
    const shifts = top.map((piece) => {
      const after = plan.items.find((moved) => moved.id === piece.id);
      if (after === undefined) throw new Error("set piece left behind");
      return [after.x - piece.x, after.z - piece.z];
    });
    for (const [dx, dz] of shifts) {
      expect(dx).toBeCloseTo(shifts[0]?.[0] ?? Number.NaN, 9);
      expect(dz).toBeCloseTo(shifts[0]?.[1] ?? Number.NaN, 9);
    }
  });

  it("keeps a set whole when some of its chairs carry only their trestle's group", () => {
    const long = withLooseChairs(set("long-table", 2, 0, 0));
    expect(selectionUnits(long)).toHaveLength(1);
    const anyLooseChair = long.find((piece) => piece.setId === undefined && getCatalogueItem(piece.catalogueItemId)?.category === "chair");
    expect(wholeSelection(new Set([anyLooseChair?.id ?? ""]), long)).toHaveLength(long.length);
    expect(planLineUp(new Set([long[0]?.id ?? ""]), world(long))).toMatchObject({ ok: false, reason: LINE_UP_NEEDS_TWO });
  });
});

describe("a trestle's chairs set again", () => {
  it("stay in its set, with ids from the plan's own source", () => {
    const long = set("long-table", 2, 0, 0);
    const first = trestlesOf(long)[0];
    if (first === undefined) throw new Error("no trestle");
    let next = 0;
    const fewer = rearrangeTableGroup(first.id, 4, long);
    const more = rearrangeTableGroup(first.id, 6, fewer, () => `fresh-${String((next += 1))}`);
    const chairs = more.filter((piece) => piece.groupId === first.groupId && piece.id !== first.id);
    expect(chairs).toHaveLength(6);
    for (const chair of chairs) expect(chair.setId).toBe(first.setId);
    expect(chairs.filter((chair) => chair.id.startsWith("fresh-")).map((chair) => chair.id).sort()).toEqual(["fresh-1", "fresh-2"]);
  });
});

describe("Move", () => {
  it("moves the selection, whole, to the floor point tapped", () => {
    const first = round(-5, 0);
    const plan = planMove(new Set([first[0]?.id ?? ""]), { x: 4, z: 1 }, world(first));
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.items).toHaveLength(11);
    expect(tableOf(plan.items, first[0]?.groupId ?? null).x).toBeCloseTo(4, 9);
    expect(tableOf(plan.items, first[0]?.groupId ?? null).z).toBeCloseTo(1, 9);
  });

  it("is refused onto another round, and pushes a piece back in from the wall", () => {
    const first = round(-5, 0);
    const second = round(5, 0);
    const room = [...first, ...second];
    const onto = planMove(new Set([first[0]?.id ?? ""]), { x: 5, z: 0.5 }, world(room));
    expect(onto.ok).toBe(false);
    if (!onto.ok) expect(onto.reason).toMatch(/^Won't fit · would overlap the round/u);
    const nearWall = GRAND_HALL_RENDER_DIMENSIONS.length / 2 - 1.5;
    const plan = planMove(new Set([first[0]?.id ?? ""]), { x: -5, z: nearWall }, world(room));
    if (!plan.ok) throw new Error(plan.reason);
    expect(tableOf(plan.items, first[0]?.groupId ?? null).z).toBeLessThan(nearWall);
  });

  it("carries the whole set from a tap on a chair that holds only its trestle's group", () => {
    const long = withLooseChairs(set("long-table", 2, 0, 0));
    const looseChair = long.find((piece) => piece.setId === undefined && getCatalogueItem(piece.catalogueItemId)?.category === "chair");
    const plan = planMove(new Set([looseChair?.id ?? ""]), { x: 0, z: 2.5 }, world(long));
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.items).toHaveLength(long.length);
  });
});
