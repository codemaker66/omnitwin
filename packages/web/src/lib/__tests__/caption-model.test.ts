import { describe, expect, it } from "vitest";
import { seatsFor } from "@omnitwin/types";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { captionModel, type CaptionVerb } from "../caption-model.js";
import type { PlacedItem } from "../placement.js";
import type { PlannerFeature } from "../planner-features.js";

// ---------------------------------------------------------------------------
// What the caption says about a selection (T-671 slice 11′; approved spec
// §6.6, card-dock spec §8 and §11): the eyebrow (the table's number in
// capitals), the name (the catalogue card's own), its size, the seat stepper
// (the only place the caption shows seats), and which verbs it offers. A
// table with its chairs is one piece; several alike read "2 Round 6 ft".
// ---------------------------------------------------------------------------

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug} in the catalogue`);
  return item.id;
}

function piece(id: string, slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { id, catalogueItemId: idOf(slug), x, y: 0, z, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null, ...extra };
}

/** A round with `chairs` chairs in its group, labelled. */
function round(name: string, x: number, chairs: number): PlacedItem[] {
  const group = `g-${name}`;
  return [
    piece(name, "round-table-6ft", x, 0, { groupId: group, label: name.replace("t", "Table ") }),
    ...Array.from({ length: chairs }, (_, n) => piece(`${name}-c${String(n)}`, "banquet-chair", x + 0.9 * Math.cos(n), 0.9 * Math.sin(n), { groupId: group })),
  ];
}

const none = (): boolean => false;
const all = (): boolean => true;
const only = (...on: PlannerFeature[]) => (feature: PlannerFeature): boolean => on.includes(feature);

describe("one piece", () => {
  const room = [...round("t8", 2, 10), ...round("t4", 6, 10)];

  it("says the table's number, its card's name and its size, and steps its seats", () => {
    const model = captionModel(new Set(["t8"]), room, none);
    const range = seatsFor({ slug: "round-table-6ft" });
    expect(model).toMatchObject({ count: 1, eyebrow: "TABLE 8", name: "Round 6 ft", size: "1.8 m round", primaryId: "t8" });
    expect(model?.seats).toEqual({ now: 10, min: range?.min, max: range?.max });
  });

  it("takes a chair's click as its table's", () => {
    expect(captionModel(new Set(["t8-c3"]), room, none)).toMatchObject({ count: 1, eyebrow: "TABLE 8", primaryId: "t8" });
  });

  it("offers Turn, Cloth and Remove, Duplicate and Move behind their switches (Details is P1)", () => {
    const verbs = (on: (feature: PlannerFeature) => boolean): readonly CaptionVerb[] => captionModel(new Set(["t8"]), room, on)?.verbs ?? [];
    expect(verbs(none)).toEqual(["seats", "turn", "cloth", "remove"]);
    expect(verbs(only("moveVerb"))).toEqual(["seats", "turn", "cloth", "move", "remove"]);
    expect(verbs(only("editingKeys"))).toEqual(["seats", "turn", "duplicate", "cloth", "remove"]);
    expect(verbs(all)).not.toContain("lineUp"); // Line up needs several
  });

  it("anchors above the piece's middle, at table height", () => {
    const xs = room.filter((item) => item.groupId === "g-t8").map((item) => item.x);
    const anchor = captionModel(new Set(["t8"]), room, none)?.anchor;
    expect(anchor?.[0]).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 1);
    expect(anchor?.[1]).toBeGreaterThan(0.7);
  });

  it("has no seat stepper for a piece that seats no one, and no cloth for one that is not a table", () => {
    const stage = [piece("s1", "platform", 0, 0)];
    const model = captionModel(new Set(["s1"]), stage, none);
    expect(model).toMatchObject({ eyebrow: null, name: "Stage deck", seats: null });
    expect(model?.verbs).toEqual(["turn", "remove"]);
  });
  it("offers no Cloth for a table whose model already wears its linen", () => {
    const white = [piece("w1", "round-table-6ft-white", 0, 0, { groupId: "gw", label: "Table 1" })];
    expect(captionModel(new Set(["w1"]), white, none)?.verbs).not.toContain("cloth");
  });
});

describe("several pieces", () => {
  it("counts a table with its chairs as one, and names alike pieces together", () => {
    const room = [...round("t8", 2, 10), ...round("t4", 6, 10)];
    const model = captionModel(new Set(["t8", "t4-c1"]), room, none);
    expect(model).toMatchObject({ count: 2, eyebrow: null, name: "2 Round 6 ft", size: null, seats: null });
  });

  it("reads \"N pieces\" when they differ, and offers Line up behind its switch", () => {
    const room = [...round("t8", 2, 10), piece("p1", "poseur-table", 5, 3)];
    expect(captionModel(new Set(["t8", "p1"]), room, none)).toMatchObject({ count: 2, name: "2 pieces" });
    expect(captionModel(new Set(["t8", "p1"]), room, only("lineUp"))?.verbs).toEqual(["lineUp", "remove"]);
  });

  it("offers Cloth when every piece is a table", () => {
    const room = [...round("t8", 2, 10), ...round("t4", 6, 10)];
    expect(captionModel(new Set(["t8", "t4"]), room, none)?.verbs).toEqual(["cloth", "remove"]);
  });
});

describe("nothing", () => {
  it("is nothing when nothing, or nothing that exists, is selected", () => {
    expect(captionModel(new Set(), [], none)).toBeNull();
    expect(captionModel(new Set(["gone"]), round("t8", 2, 4), none)).toBeNull();
  });
});
