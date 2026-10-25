import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem } from "../catalogue.js";
import { createGhostWorld } from "../ghost-truth.js";
import { planLineUp, planMove } from "../placement-edit.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

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

  it("needs two or more", () => {
    const one = round(0, 0);
    expect(planLineUp(new Set([one[0]?.id ?? ""]), world(one)).ok).toBe(false);
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
    const nearWall = GRAND_HALL_RENDER_DIMENSIONS.length / 2 - 1.5;
    const plan = planMove(new Set([first[0]?.id ?? ""]), { x: -5, z: nearWall }, world(room));
    if (!plan.ok) throw new Error(plan.reason);
    expect(tableOf(plan.items, first[0]?.groupId ?? null).z).toBeLessThan(nearWall);
  });
});
