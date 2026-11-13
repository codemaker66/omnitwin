import { describe, expect, it } from "vitest";
import type { EditorObject } from "../../stores/editor-store.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { changedBetween } from "../layout-live/live-document.js";
import { nounFor, summariseLayoutChange } from "../layout-change-summary.js";

const TABLE = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-table";
const CHAIR = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair";
const LECTERN = getCatalogueItemBySlug("lectern")?.id ?? "missing-lectern";

function piece(id: string, assetDefinitionId: string, over: Partial<EditorObject> = {}): EditorObject {
  return {
    id, assetDefinitionId,
    positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null,
    chairStyle: null, centerpiece: null, groupId: null, notes: "",
    ...over,
  };
}

const before: readonly EditorObject[] = [
  piece("t3", TABLE, { label: "Table 3", positionX: 3 }),
  piece("t4", TABLE, { label: "Table 4", positionX: 4 }),
  piece("t5", TABLE, { label: "Table 5", positionX: 5 }),
  piece("c1", CHAIR, { positionX: 6 }),
  piece("c2", CHAIR, { positionX: 7 }),
];

describe("summariseLayoutChange", () => {
  it("says what someone else did in nouns and labels: moved Tables 3 and 4 and added a lectern", () => {
    const after = [
      piece("t3", TABLE, { label: "Table 3", positionX: 3.5 }),
      piece("t4", TABLE, { label: "Table 4", positionX: 4, rotationY: Math.PI / 2 }),
      before[2] as EditorObject,
      before[3] as EditorObject,
      before[4] as EditorObject,
      piece("l1", LECTERN, { positionZ: 9 }),
    ];
    expect(summariseLayoutChange(before, after)).toEqual({
      moved: [{ noun: "table", label: "Table 3" }, { noun: "table", label: "Table 4" }],
      added: [{ noun: "lectern", label: null }],
      removed: [],
      restyled: [],
    });
  });

  it("files every changed object once, and no unchanged one", () => {
    const after = [
      piece("t3", TABLE, { label: "Table 3", positionX: 3, clothed: true, clothStyle: "white" }),
      piece("t4", TABLE, { label: "Table 4", positionX: 9, notes: "VIP" }),
      before[2] as EditorObject,
      piece("c9", CHAIR),
    ];
    const summary = summariseLayoutChange(before, after);
    expect(summary.restyled).toEqual([{ noun: "table", label: "Table 3" }]);
    // Moved and re-noted: one change, filed under the move.
    expect(summary.moved).toEqual([{ noun: "table", label: "Table 4" }]);
    expect(summary.added).toEqual([{ noun: "banquet chair", label: null }]);
    expect(summary.removed).toEqual([{ noun: "banquet chair", label: null }, { noun: "banquet chair", label: null }]);
    const total = summary.moved.length + summary.added.length + summary.removed.length + summary.restyled.length;
    expect(total).toBe(changedBetween(before, after).size);
  });

  it("ignores float noise from the metres to render-space round trip", () => {
    const after = before.map((object) => ({ ...object, positionX: object.positionX + 1e-9, rotationY: 1e-9 }));
    expect(summariseLayoutChange(before, after)).toEqual({ moved: [], added: [], removed: [], restyled: [] });
  });

  it("names a removed object by the label it had, and a renamed one by its new label", () => {
    const after = [
      piece("t3", TABLE, { label: "Top Table", positionX: 3 }),
      ...before.slice(2),
    ];
    const summary = summariseLayoutChange(before, after);
    expect(summary.removed).toEqual([{ noun: "table", label: "Table 4" }]);
    expect(summary.restyled).toEqual([{ noun: "table", label: "Top Table" }]);
  });

  it("treats a blank label as no label", () => {
    const summary = summariseLayoutChange([], [piece("t9", TABLE, { label: "   " })]);
    expect(summary.added).toEqual([{ noun: "table", label: null }]);
  });

  it("calls a piece the catalogue does not know an item", () => {
    expect(nounFor(piece("x", "retired-asset"))).toBe("item");
    expect(nounFor(undefined)).toBe("item");
    expect(nounFor(piece("t", TABLE))).toBe("table");
    expect(nounFor(piece("l", LECTERN))).toBe("lectern");
  });
});
