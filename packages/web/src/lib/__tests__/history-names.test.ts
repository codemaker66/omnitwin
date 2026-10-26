import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { diffObjects, emptyHistory, recordChange, type HistoryDelta } from "../editor-history.js";
import { nameHistoryStep, nameRedoStep, nameUndoStep } from "../history-names.js";
import type { EditorObject } from "../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// Steps named in the venue's words (approved spec §6.9; lens B-10): never
// "Move item" or "Rearrange items", always what happened to the room.
// ---------------------------------------------------------------------------

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no catalogue item ${slug}`);
  return item.id;
}

const ROUND = idOf("round-table-6ft-white");
const TRESTLE = idOf("trestle-6ft-white");
const CHAIR = idOf("banquet-chair");
const LECTERN = idOf("lectern");
const PANEL = idOf("dancefloor-panel");

let order = 0;
function piece(id: string, assetDefinitionId: string, over: Partial<EditorObject> = {}): EditorObject {
  return {
    id,
    assetDefinitionId,
    positionX: 0, positionY: 0, positionZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1,
    sortOrder: order++,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null,
    groupId: null,
    notes: "",
    ...over,
  };
}

/** A round with its chairs, numbered. */
function round(n: number, chairs = 10, over: Partial<EditorObject> = {}): EditorObject[] {
  const groupId = `g${String(n)}`;
  return [
    piece(`t${String(n)}`, ROUND, { groupId, label: `Table ${String(n)}`, ...over }),
    ...Array.from({ length: chairs }, (_, i) => piece(`t${String(n)}c${String(i)}`, CHAIR, { groupId })),
  ];
}

function first<T>(list: readonly T[]): T {
  const value = list[0];
  if (value === undefined) throw new Error("empty");
  return value;
}

function step(before: readonly EditorObject[], after: readonly EditorObject[], label = "Rearrange items"): HistoryDelta<EditorObject> & { readonly label: string } {
  const d = diffObjects(before, after);
  if (d === null) throw new Error("no change");
  return { ...d, label };
}

describe("naming a step from its delta", () => {
  it("names a moved table by its number, with its chairs as one piece", () => {
    const before = round(8);
    const after = before.map((object) => ({ ...object, positionX: object.positionX + 1.2 }));
    expect(nameHistoryStep(step(before, after, "Move 11 items"), { objects: after })).toBe("Move Table 8");
  });

  it("names several moved tables by count", () => {
    const before = [...round(1), ...round(2), ...round(3)];
    const after = before.map((object) => ({ ...object, positionZ: 2 }));
    expect(nameHistoryStep(step(before, after), { objects: after })).toBe("Move 3 tables");
  });

  it("names a turn as a turn, even when the chairs swing round the table", () => {
    const before = round(3);
    const after = before.map((object, i) => (i === 0 ? { ...object, rotationY: Math.PI / 2 } : { ...object, positionX: 1, rotationY: 1 }));
    expect(nameHistoryStep(step(before, after, "Move 11 items"), { objects: after })).toBe("Turn Table 3");
  });

  it("names a stamped round by its set, with the count of pieces", () => {
    const before = round(1);
    const after = [...before, ...round(9)];
    expect(nameHistoryStep(step(before, after, "Place 11 items"), { objects: after })).toBe("Add Round of 10 · 11 pieces");
  });

  it("names a lone piece put down by its card", () => {
    const after = [piece("l", LECTERN)];
    expect(nameHistoryStep(step([], after, "Place Lectern"), { objects: after })).toBe("Add Lectern");
  });

  it("calls a fill of an empty floor Lay out", () => {
    const after = Array.from({ length: 14 }, (_, i) => round(i + 1)).flat();
    expect(nameHistoryStep(step([], after, "Place 154 items"), { objects: after, floorEmptyBefore: true })).toBe("Lay out 14 tables");
    // The same tables added to a floor that held something are an add.
    expect(nameHistoryStep(step([], after, "Place 154 items"), { objects: after, floorEmptyBefore: false })).toBe("Add 14 rounds of 10 · 154 pieces");
  });

  it("names chairs taken from a table at that table", () => {
    const before = round(3);
    const after = before.slice(0, -2);
    expect(nameHistoryStep(step(before, after, "Delete 2 items"), { objects: after })).toBe("Remove 2 chairs at Table 3");
  });

  it("names loose chairs removed by count", () => {
    const before = [piece("a", CHAIR), piece("b", CHAIR)];
    expect(nameHistoryStep(step(before, []), { objects: [] })).toBe("Remove 2 chairs");
  });

  it("names a table removed with its chairs by its number", () => {
    const before = [...round(4), ...round(5)];
    const after = before.slice(11);
    expect(nameHistoryStep(step(before, after, "Delete 11 items"), { objects: after })).toBe("Remove Table 4 · 11 pieces");
  });

  it("names a seat added at a table, even when the other chairs close up", () => {
    const before = round(3, 9);
    const after = [...before.map((object, i) => (i > 0 ? { ...object, positionX: 0.1 } : object)), piece("new", CHAIR, { groupId: "g3" })];
    expect(nameHistoryStep(step(before, after), { objects: after })).toBe("Add a chair at Table 3");
  });

  it("names cloth on and off over many tables", () => {
    const before = Array.from({ length: 8 }, (_, i) => piece(`t${String(i)}`, ROUND, { label: `Table ${String(i + 1)}` }));
    const on = before.map((object) => ({ ...object, clothed: true, clothStyle: "white" as const }));
    expect(nameHistoryStep(step(before, on, "Change tablecloth"), { objects: on })).toBe("Cloth on 8 tables");
    expect(nameHistoryStep(step(on, before, "Change tablecloth"), { objects: before })).toBe("Cloth off 8 tables");
  });

  it("names a swap of sets as a replacement", () => {
    const before = [...round(1), ...round(2)];
    const groupId = "long";
    const after = [
      piece("tr1", TRESTLE, { groupId }),
      piece("tr2", TRESTLE, { groupId }),
      ...Array.from({ length: 12 }, (_, i) => piece(`lc${String(i)}`, CHAIR, { groupId })),
    ];
    expect(nameHistoryStep(step(before, after), { objects: after })).toBe("Replace 2 rounds of 10 with Long table");
  });

  it("names a top table by its one-sided seating", () => {
    const groupId = "top";
    const after = [piece("tr1", TRESTLE, { groupId }), piece("tr2", TRESTLE, { groupId }), ...Array.from({ length: 6 }, (_, i) => piece(`c${String(i)}`, CHAIR, { groupId }))];
    expect(nameHistoryStep(step([], after), { objects: after })).toBe("Add Top table · 8 pieces");
  });

  it("names a dance floor as one piece", () => {
    const groupId = "dance";
    const before = Array.from({ length: 4 }, (_, i) => piece(`p${String(i)}`, PANEL, { groupId }));
    const after = before.map((object) => ({ ...object, positionX: 3 }));
    expect(nameHistoryStep(step(before, after), { objects: after })).toBe("Move the dance floor");
  });

  it("names a renumbering and a note", () => {
    const table = piece("t", ROUND, { label: "Table 3" });
    const renamed = [{ ...table, label: "Top table" }];
    expect(nameHistoryStep(step([table], renamed, "Rename item"), { objects: renamed })).toBe("Rename Table 3 as Top table");
    const noted = [{ ...table, notes: "Needs a ramp" }];
    expect(nameHistoryStep(step([table], noted, "Edit note"), { objects: noted })).toBe("Note on Table 3");
  });

  it("keeps a command's own words", () => {
    const before = round(3);
    const after = before.map((object) => ({ ...object, positionX: 1 }));
    expect(nameHistoryStep(step(before, after, "Line up 4 tables"), { objects: after })).toBe("Line up 4 tables");
  });

  it("never says item, whatever the delta", () => {
    const lectern = piece("a", LECTERN);
    const after = [{ ...lectern, scale: 1.2 }];
    const name = nameHistoryStep(step([lectern], after, "Resize item"), { objects: after });
    expect(name).toBe("Resize Lectern");
    expect(name).not.toMatch(/\bitems?\b/u);
  });

  it("still reads as plain words when the piece is no longer in the layout", () => {
    const lectern = piece("a", LECTERN);
    expect(nameHistoryStep(step([lectern], [{ ...lectern, positionX: 4 }], "Move item"), { objects: [] })).toBe("Move a piece");
  });
});

describe("the dock's names for Undo and Redo", () => {
  it("names the step Undo takes back and the one Redo puts back", () => {
    const before = round(8);
    const after = before.map((object) => ({ ...object, positionX: 2 }));
    const history = recordChange(emptyHistory<EditorObject>(), {
      before, after, label: "Move 11 items", epoch: 1, selectionBefore: [], selectionAfter: [],
    });
    expect(nameUndoStep(history, after)).toBe("Move Table 8");
    expect(nameRedoStep(history, after)).toBeNull();
    expect(nameUndoStep(emptyHistory<EditorObject>(), [])).toBeNull();
    expect(nameRedoStep({ past: [], future: [first(history.past)] }, before)).toBe("Move Table 8");
  });
});
