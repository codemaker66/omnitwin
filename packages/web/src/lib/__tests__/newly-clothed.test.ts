import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { newlyClothedIds } from "../newly-clothed.js";
import { createPlacedItem, type PlacedItem, type TableClothStyle } from "../placement.js";

function table(id: string, slug = "round-table-6ft"): PlacedItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`missing ${slug} fixture`);
  return createPlacedItem(item.id, 0, 0, 0, null, 0, id);
}

function clothed(item: PlacedItem, style: TableClothStyle = "black"): PlacedItem {
  return { ...item, clothed: true, clothStyle: style };
}

function bare(item: PlacedItem): PlacedItem {
  return { ...item, clothed: false, clothStyle: null };
}

describe("newlyClothedIds", () => {
  it("drapes a table clothed in place", () => {
    const layout = [table("t1"), table("t2"), table("t3")];
    const next = layout.map((item) => (item.id === "t2" ? clothed(item) : item));
    expect(newlyClothedIds(layout, next)).toEqual(["t2"]);
  });

  it("drapes a table clothed in place when the layout's order also changes", () => {
    const first = table("t1");
    const second = table("t2");
    expect(newlyClothedIds([first, second], [second, clothed(first, "white")])).toEqual(["t1"]);
  });

  it("does not drape a clothed table a save re-keys", () => {
    const saved = [clothed(table("local-7")), table("t2")];
    const rekeyed = saved.map((item) => (item.id === "local-7" ? { ...item, id: "srv-7" } : item));
    expect(newlyClothedIds(saved, rekeyed)).toEqual([]);
  });

  it("does not drape a clothed table an undo restores, under its old id or a healed one", () => {
    const before = [clothed(table("srv-1")), table("t2")];
    const afterDelete = before.slice(1);
    // EditorBridge rebuilds every item on undo: fresh objects throughout.
    const restored = before.map((item) => ({ ...item }));
    expect(newlyClothedIds(afterDelete, restored)).toEqual([]);
    const healed = restored.map((item) => (item.id === "srv-1" ? { ...item, id: "local-3" } : item));
    expect(newlyClothedIds(afterDelete, healed)).toEqual([]);
  });

  it("does not drape the clothed tables of a newly loaded layout", () => {
    const layoutA = [table("a1"), clothed(table("a2"))];
    const layoutB = [clothed(table("b1")), clothed(table("b2"), "white"), table("b3")];
    expect(newlyClothedIds(layoutA, layoutB)).toEqual([]);
  });

  it("drapes nothing on the first render", () => {
    expect(newlyClothedIds(null, [clothed(table("t1"))])).toEqual([]);
  });

  it("leaves a newly placed table whose variant carries its linen undraped, as before", () => {
    // round-table-6ft-white's cloth is part of its model, so no scene cloth
    // is applied and it never drapes: today's behaviour, kept.
    const layout = [table("t1")];
    const white = table("w1", "round-table-6ft-white");
    expect(newlyClothedIds(layout, [...layout, white])).toEqual([]);
    expect(newlyClothedIds(layout, [...layout, clothed(white, "white")])).toEqual([]);
    expect(newlyClothedIds([...layout, white], [...layout, clothed(white, "white")])).toEqual([]);
  });

  it("does not drape a piece that arrives already clothed, such as a copy", () => {
    const layout = [clothed(table("t1"))];
    expect(newlyClothedIds(layout, [...layout, clothed(table("copy-1"))])).toEqual([]);
  });

  it("does not replay when a cloth only changes colour, nor when it comes off", () => {
    const original = clothed(table("t1"));
    const other = clothed(table("t2"));
    expect(newlyClothedIds([original, other], [clothed(original, "white"), other])).toEqual([]);
    expect(newlyClothedIds([original, other], [bare(original), bare(other)])).toEqual([]);
  });

  it("returns nothing for an unchanged layout", () => {
    const layout = [table("t1"), clothed(table("t2"))];
    expect(newlyClothedIds(layout, layout)).toEqual([]);
    expect(newlyClothedIds(layout, [...layout])).toEqual([]);
  });
});
