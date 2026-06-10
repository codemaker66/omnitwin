import { describe, it, expect } from "vitest";
import {
  canRedo,
  canUndo,
  diffObjects,
  emptyHistory,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
  performRedo,
  performUndo,
  recordChange,
  redoLabel,
  remapHistoryIds,
  undoLabel,
  type EditorHistory,
  type HistoryDelta,
  type HistoryIdAdapter,
  type RecordChangeInput,
} from "../editor-history.js";

// ---------------------------------------------------------------------------
// editor-history — pure command-sourced undo/redo engine
//
// The planner records every document mutation as an invertible delta
// (added / removed / updated field patches) instead of snapshots. This
// suite pins the engine's contract: diffs capture exactly what changed,
// undo/redo round-trip the document precisely, drags coalesce into one
// entry, and IDs can be remapped across the whole timeline after a
// server save (or healed when undo resurrects a server-deleted row).
//
// The engine is generic over any flat object with a string `id` whose
// remaining fields are primitives — tests use a small shape; the store
// instantiates it with EditorObject.
// ---------------------------------------------------------------------------

interface Obj {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly notes: string;
  readonly groupId: string | null;
  readonly label?: string;
}

function obj(id: string, over: Partial<Obj> = {}): Obj {
  return { id, x: 0, z: 0, notes: "", groupId: null, ...over };
}

// ---------------------------------------------------------------------------
// diffObjects
// ---------------------------------------------------------------------------

describe("diffObjects", () => {
  it("returns null when nothing changed", () => {
    const doc = [obj("a"), obj("b")];
    expect(diffObjects(doc, [...doc])).toBeNull();
  });

  it("captures only the fields that changed in an update", () => {
    const before = [obj("a", { x: 1, notes: "keep" })];
    const after = [obj("a", { x: 2, notes: "keep" })];
    const delta = diffObjects(before, after);
    expect(delta).toEqual<HistoryDelta<Obj>>({
      added: [],
      removed: [],
      updated: [{ id: "a", before: { x: 1 }, after: { x: 2 } }],
    });
  });

  it("never includes id in a field patch", () => {
    const before = [obj("a", { x: 1 })];
    const after = [obj("a", { x: 5 })];
    const delta = diffObjects(before, after);
    expect(delta?.updated[0]?.before).not.toHaveProperty("id");
    expect(delta?.updated[0]?.after).not.toHaveProperty("id");
  });

  it("records an addition with the index it appeared at", () => {
    const before = [obj("a")];
    const added = obj("b", { x: 3 });
    const delta = diffObjects(before, [obj("a"), added]);
    expect(delta).toEqual({
      added: [{ object: added, index: 1 }],
      removed: [],
      updated: [],
    });
  });

  it("records a removal with the index it disappeared from", () => {
    const removed = obj("b", { x: 3 });
    const before = [obj("a"), removed, obj("c")];
    const delta = diffObjects(before, [obj("a"), obj("c")]);
    expect(delta).toEqual({
      added: [],
      removed: [{ object: removed, index: 1 }],
      updated: [],
    });
  });

  it("captures add, remove, and update together", () => {
    const before = [obj("a", { x: 1 }), obj("b")];
    const added = obj("c", { notes: "new" });
    const after = [obj("a", { x: 9 }), added];
    const delta = diffObjects(before, after);
    expect(delta).toEqual({
      added: [{ object: added, index: 1 }],
      removed: [{ object: obj("b"), index: 1 }],
      updated: [{ id: "a", before: { x: 1 }, after: { x: 9 } }],
    });
  });

  it("treats a field appearing as a change from undefined", () => {
    const before = [obj("a")];
    const after = [obj("a", { label: "Table 1" })];
    const delta = diffObjects(before, after);
    expect(delta?.updated).toEqual([
      { id: "a", before: { label: undefined }, after: { label: "Table 1" } },
    ]);
  });

  it("ignores pure reordering — order is not an undoable mutation", () => {
    const a = obj("a");
    const b = obj("b");
    expect(diffObjects([a, b], [b, a])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordChange — building the timeline
// ---------------------------------------------------------------------------

function change(
  before: readonly Obj[],
  after: readonly Obj[],
  over: Partial<RecordChangeInput<Obj>> = {},
): RecordChangeInput<Obj> {
  return {
    before,
    after,
    label: "Change",
    epoch: 0,
    selectionBefore: [],
    selectionAfter: [],
    ...over,
  };
}

describe("recordChange", () => {
  it("starts with nothing to undo or redo", () => {
    const history = emptyHistory<Obj>();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoLabel(history)).toBeNull();
    expect(redoLabel(history)).toBeNull();
  });

  it("records a change and enables undo with its label", () => {
    const history = recordChange(
      emptyHistory<Obj>(),
      change([], [obj("a")], { label: "Place chair" }),
    );
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);
    expect(undoLabel(history)).toBe("Place chair");
  });

  it("returns the same history instance when nothing changed", () => {
    const doc = [obj("a")];
    const history: EditorHistory<Obj> = recordChange(
      emptyHistory<Obj>(),
      change([], doc),
    );
    expect(recordChange(history, change(doc, [...doc]))).toBe(history);
  });

  it("stacks entries newest-last", () => {
    let history = emptyHistory<Obj>();
    history = recordChange(history, change([], [obj("a")], { label: "First" }));
    history = recordChange(
      history,
      change([obj("a")], [obj("a"), obj("b")], { label: "Second", epoch: 1 }),
    );
    expect(history.past.map((entry) => entry.label)).toEqual(["First", "Second"]);
    expect(undoLabel(history)).toBe("Second");
  });

  it("captures selection before and after on the entry", () => {
    const history = recordChange(
      emptyHistory<Obj>(),
      change([], [obj("a")], {
        selectionBefore: ["x"],
        selectionAfter: ["a"],
      }),
    );
    expect(history.past[0]?.selectionBefore).toEqual(["x"]);
    expect(history.past[0]?.selectionAfter).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// performUndo / performRedo — walking the timeline
// ---------------------------------------------------------------------------

/** All ids count as local — healing never triggers. */
const noHealIds: HistoryIdAdapter = {
  makeLocalId: () => {
    throw new Error("makeLocalId must not be called when no healing is needed");
  },
  isLocalId: () => true,
};

describe("performUndo / performRedo", () => {
  it("returns null when there is nothing to undo or redo", () => {
    const history = emptyHistory<Obj>();
    expect(performUndo(history, [], noHealIds)).toBeNull();
    expect(performRedo(history, [], noHealIds)).toBeNull();
  });

  it("undoes an addition and restores the prior selection", () => {
    const doc = [obj("a"), obj("b")];
    const history = recordChange(
      emptyHistory<Obj>(),
      change([obj("a")], doc, {
        label: "Place chair",
        selectionBefore: [],
        selectionAfter: ["b"],
      }),
    );
    const step = performUndo(history, doc, noHealIds);
    expect(step?.objects).toEqual([obj("a")]);
    expect(step?.selection).toEqual([]);
    expect(step?.label).toBe("Place chair");
    expect(canUndo(step!.history)).toBe(false);
    expect(canRedo(step!.history)).toBe(true);
    expect(redoLabel(step!.history)).toBe("Place chair");
  });

  it("redoes an undone addition and restores the after selection", () => {
    const doc = [obj("a"), obj("b")];
    const history = recordChange(
      emptyHistory<Obj>(),
      change([obj("a")], doc, { label: "Place chair", selectionAfter: ["b"] }),
    );
    const undone = performUndo(history, doc, noHealIds)!;
    const redone = performRedo(undone.history, undone.objects, noHealIds)!;
    expect(redone.objects).toEqual(doc);
    expect(redone.selection).toEqual(["b"]);
    expect(canUndo(redone.history)).toBe(true);
    expect(canRedo(redone.history)).toBe(false);
  });

  it("undoes a removal by re-inserting at the original index", () => {
    const before = [obj("a"), obj("b", { x: 4 }), obj("c")];
    const after = [obj("a"), obj("c")];
    const history = recordChange(emptyHistory<Obj>(), change(before, after));
    const step = performUndo(history, after, noHealIds);
    expect(step?.objects).toEqual(before);
  });

  it("undoes an update without touching unrelated fields", () => {
    const before = [obj("a", { x: 1, notes: "vip" })];
    const after = [obj("a", { x: 7, notes: "vip" })];
    const history = recordChange(emptyHistory<Obj>(), change(before, after));
    const step = performUndo(history, after, noHealIds);
    expect(step?.objects).toEqual(before);
  });

  it("round-trips a mixed add/remove/update entry exactly", () => {
    const before = [obj("a", { x: 1 }), obj("b"), obj("c")];
    const after = [obj("a", { x: 2 }), obj("c"), obj("d", { notes: "new" })];
    const history = recordChange(emptyHistory<Obj>(), change(before, after));
    const undone = performUndo(history, after, noHealIds)!;
    expect(undone.objects).toEqual(before);
    const redone = performRedo(undone.history, undone.objects, noHealIds)!;
    expect(redone.objects).toEqual(after);
  });

  it("walks multiple steps back and forward in order", () => {
    const v0: readonly Obj[] = [];
    const v1 = [obj("a")];
    const v2 = [obj("a"), obj("b")];
    const v3 = [obj("a", { x: 5 }), obj("b")];
    let history = emptyHistory<Obj>();
    history = recordChange(history, change(v0, v1, { epoch: 0 }));
    history = recordChange(history, change(v1, v2, { epoch: 1 }));
    history = recordChange(history, change(v2, v3, { epoch: 2 }));

    const u1 = performUndo(history, v3, noHealIds)!;
    expect(u1.objects).toEqual(v2);
    const u2 = performUndo(u1.history, u1.objects, noHealIds)!;
    expect(u2.objects).toEqual(v1);
    const u3 = performUndo(u2.history, u2.objects, noHealIds)!;
    expect(u3.objects).toEqual(v0);
    expect(performUndo(u3.history, u3.objects, noHealIds)).toBeNull();

    const r1 = performRedo(u3.history, u3.objects, noHealIds)!;
    expect(r1.objects).toEqual(v1);
    const r2 = performRedo(r1.history, r1.objects, noHealIds)!;
    expect(r2.objects).toEqual(v2);
    const r3 = performRedo(r2.history, r2.objects, noHealIds)!;
    expect(r3.objects).toEqual(v3);
    expect(performRedo(r3.history, r3.objects, noHealIds)).toBeNull();
  });

  it("discards the redo branch when a new change is recorded after undo", () => {
    const v1 = [obj("a")];
    const v2 = [obj("a"), obj("b")];
    let history = recordChange(emptyHistory<Obj>(), change([], v1));
    history = recordChange(history, change(v1, v2, { epoch: 1 }));
    const undone = performUndo(history, v2, noHealIds)!;
    expect(canRedo(undone.history)).toBe(true);
    const branched = recordChange(
      undone.history,
      change(v1, [obj("a"), obj("z")], { epoch: 2 }),
    );
    expect(canRedo(branched)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coalescing — a drag is one undo entry, not one per frame
//
// The bridge records every synced frame of a drag. Entries in the same
// interaction epoch that update the same objects' same fields merge into
// one, keeping the first `before` and the latest `after`.
// ---------------------------------------------------------------------------

describe("coalescing", () => {
  const s0 = [obj("a", { x: 0 })];
  const s1 = [obj("a", { x: 1 })];
  const s2 = [obj("a", { x: 2 })];

  it("merges same-epoch updates to the same fields into one entry", () => {
    let history = recordChange(
      emptyHistory<Obj>(),
      change(s0, s1, {
        epoch: 5,
        label: "Move",
        selectionBefore: ["start"],
        selectionAfter: ["mid"],
      }),
    );
    history = recordChange(
      history,
      change(s1, s2, {
        epoch: 5,
        label: "Move",
        selectionBefore: ["mid"],
        selectionAfter: ["end"],
      }),
    );
    expect(history.past).toHaveLength(1);
    expect(history.past[0]?.selectionBefore).toEqual(["start"]);
    expect(history.past[0]?.selectionAfter).toEqual(["end"]);
    const undone = performUndo(history, s2, noHealIds)!;
    expect(undone.objects).toEqual(s0);
  });

  it("coalesces group moves over the same id set", () => {
    const g0 = [obj("a", { x: 0 }), obj("b", { z: 0 })];
    const g1 = [obj("a", { x: 1 }), obj("b", { z: 1 })];
    const g2 = [obj("a", { x: 2 }), obj("b", { z: 2 })];
    let history = recordChange(emptyHistory<Obj>(), change(g0, g1, { epoch: 3 }));
    history = recordChange(history, change(g1, g2, { epoch: 3 }));
    expect(history.past).toHaveLength(1);
    expect(performUndo(history, g2, noHealIds)?.objects).toEqual(g0);
  });

  it("does not merge across epochs — two drags stay two entries", () => {
    let history = recordChange(emptyHistory<Obj>(), change(s0, s1, { epoch: 1 }));
    history = recordChange(history, change(s1, s2, { epoch: 2 }));
    expect(history.past).toHaveLength(2);
  });

  it("does not merge when the id sets differ", () => {
    const t1 = [obj("a", { x: 1 }), obj("b")];
    const t2 = [obj("a", { x: 1 }), obj("b", { z: 4 })];
    let history = recordChange(emptyHistory<Obj>(), change(s0.concat(obj("b")), t1, { epoch: 1 }));
    history = recordChange(history, change(t1, t2, { epoch: 1 }));
    expect(history.past).toHaveLength(2);
  });

  it("does not merge when the changed fields differ", () => {
    const noted = [obj("a", { x: 1, notes: "vip" })];
    let history = recordChange(emptyHistory<Obj>(), change(s0, s1, { epoch: 1 }));
    history = recordChange(history, change(s1, noted, { epoch: 1 }));
    expect(history.past).toHaveLength(2);
  });

  it("never merges entries that add or remove objects", () => {
    let history = recordChange(emptyHistory<Obj>(), change(s0, s1, { epoch: 1 }));
    history = recordChange(history, change(s1, [...s1, obj("b")], { epoch: 1 }));
    expect(history.past).toHaveLength(2);
  });

  it("drops the entry entirely when a drag returns to its exact start", () => {
    let history = recordChange(emptyHistory<Obj>(), change([], s0, { label: "Place" }));
    history = recordChange(history, change(s0, s1, { epoch: 7 }));
    history = recordChange(history, change(s1, s0, { epoch: 7 }));
    expect(history.past.map((entry) => entry.label)).toEqual(["Place"]);
  });

  it("does not merge into an entry the user just stepped past", () => {
    let history = recordChange(emptyHistory<Obj>(), change(s0, s1, { epoch: 0 }));
    history = recordChange(history, change(s1, s2, { epoch: 1 }));
    const undone = performUndo(history, s2, noHealIds)!;
    const recorded = recordChange(undone.history, change(s1, s2, { epoch: 0 }));
    expect(recorded.past).toHaveLength(2);
    expect(canRedo(recorded)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// remapHistoryIds — surviving a server save
//
// Saving zips local-* ids to server UUIDs. Every reference in the whole
// timeline must follow, or undo after save would resurrect dead ids.
// ---------------------------------------------------------------------------

describe("remapHistoryIds", () => {
  it("remaps object ids, patch ids, and selections across past and future", () => {
    const v1 = [obj("local-a")];
    const v2 = [obj("local-a", { x: 5 })];
    let history = recordChange(
      emptyHistory<Obj>(),
      change([], v1, { selectionAfter: ["local-a"] }),
    );
    history = recordChange(
      history,
      change(v1, v2, { epoch: 1, selectionBefore: ["local-a"] }),
    );
    const undone = performUndo(history, v2, noHealIds)!;

    const remapped = remapHistoryIds(
      undone.history,
      new Map([["local-a", "srv-1"]]),
    );
    expect(remapped.past[0]?.added[0]?.object.id).toBe("srv-1");
    expect(remapped.past[0]?.selectionAfter).toEqual(["srv-1"]);
    expect(remapped.future[0]?.updated[0]?.id).toBe("srv-1");
    expect(remapped.future[0]?.selectionBefore).toEqual(["srv-1"]);
  });

  it("never remaps field values — groupId shares no namespace with object ids", () => {
    const grouped = obj("local-a", { groupId: "local-a" });
    const history = recordChange(emptyHistory<Obj>(), change([], [grouped]));
    const remapped = remapHistoryIds(history, new Map([["local-a", "srv-1"]]));
    expect(remapped.past[0]?.added[0]?.object).toEqual({
      ...grouped,
      id: "srv-1",
    });
  });

  it("returns the same history instance for an empty map", () => {
    const history = recordChange(emptyHistory<Obj>(), change([], [obj("a")]));
    expect(remapHistoryIds(history, new Map())).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// Bounded memory — long sessions must not grow without limit
// ---------------------------------------------------------------------------

describe("history budgets", () => {
  it("caps the timeline at MAX_HISTORY_ENTRIES, dropping the oldest", () => {
    let history = emptyHistory<Obj>();
    const overflow = 5;
    for (let i = 0; i < MAX_HISTORY_ENTRIES + overflow; i++) {
      history = recordChange(
        history,
        change([obj("a", { x: i })], [obj("a", { x: i + 1 })], {
          epoch: i,
          label: `e${String(i)}`,
        }),
      );
    }
    expect(history.past).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.past[0]?.label).toBe(`e${String(overflow)}`);
    expect(undoLabel(history)).toBe(`e${String(MAX_HISTORY_ENTRIES + overflow - 1)}`);
  });

  it("evicts oldest entries when the byte budget is exceeded", () => {
    // ~0.7 MB per entry against a 2 MB budget → the third entry evicts
    // the first.
    const bigNote = (tag: string): string => tag + "x".repeat(350_000);
    let history = emptyHistory<Obj>();
    for (const tag of ["e0", "e1", "e2"]) {
      history = recordChange(
        history,
        change([obj(tag)], [obj(tag, { notes: bigNote(tag) })], {
          epoch: Number(tag.slice(1)),
          label: tag,
        }),
      );
    }
    expect(history.past.map((entry) => entry.label)).toEqual(["e1", "e2"]);
  });

  it("always keeps the most recent entry even when it alone busts the budget", () => {
    const huge = "x".repeat(MAX_HISTORY_BYTES);
    const history = recordChange(
      emptyHistory<Obj>(),
      change([obj("a")], [obj("a", { notes: huge })], { label: "Huge" }),
    );
    expect(history.past.map((entry) => entry.label)).toEqual(["Huge"]);
  });
});

// ---------------------------------------------------------------------------
// Healing — undo/redo must never resurrect a server-deleted row
//
// The batch route silently skips updates addressed to ids it no longer
// has. Any re-insertion of a server-persisted object therefore gets a
// fresh local id, remapped across the whole timeline so the chain of
// patches keeps pointing at the same logical object.
// ---------------------------------------------------------------------------

function sequentialIds(): HistoryIdAdapter {
  let n = 0;
  return {
    makeLocalId: () => `local-h${String(++n)}`,
    isLocalId: (id) => id.startsWith("local-"),
  };
}

describe("healing on re-insertion", () => {
  it("gives an undone removal of a server object a fresh local id everywhere", () => {
    const ids = sequentialIds();
    const v0 = [obj("srv-1", { x: 0 })];
    const v1 = [obj("srv-1", { x: 5 })];
    let history = recordChange(
      emptyHistory<Obj>(),
      change(v0, v1, { label: "Move", selectionBefore: ["srv-1"] }),
    );
    history = recordChange(
      history,
      change(v1, [], { label: "Delete", epoch: 1, selectionBefore: ["srv-1"] }),
    );

    const undone = performUndo(history, [], ids)!;
    expect(undone.objects).toEqual([obj("local-h1", { x: 5 })]);
    expect(undone.selection).toEqual(["local-h1"]);
    // The entry moved to future must target the healed id so redo
    // removes the resurrected object, not the dead server id.
    expect(undone.history.future[0]?.removed[0]?.object.id).toBe("local-h1");
    // Earlier entries follow too — the move patch now addresses local-h1.
    expect(undone.history.past[0]?.updated[0]?.id).toBe("local-h1");

    const undoneMove = performUndo(undone.history, undone.objects, ids)!;
    expect(undoneMove.objects).toEqual([obj("local-h1", { x: 0 })]);

    const redoneMove = performRedo(undoneMove.history, undoneMove.objects, ids)!;
    expect(redoneMove.objects).toEqual([obj("local-h1", { x: 5 })]);
    const redoneDelete = performRedo(redoneMove.history, redoneMove.objects, ids)!;
    expect(redoneDelete.objects).toEqual([]);
  });

  it("does not heal local-id re-insertions — their rows were never persisted", () => {
    const strictIds: HistoryIdAdapter = {
      makeLocalId: () => {
        throw new Error("must not mint an id for a local re-insertion");
      },
      isLocalId: (id) => id.startsWith("local-"),
    };
    const v1 = [obj("local-a")];
    const history = recordChange(emptyHistory<Obj>(), change(v1, []));
    const undone = performUndo(history, [], strictIds)!;
    expect(undone.objects).toEqual(v1);
  });

  it("converges — a healed object is never healed twice", () => {
    const ids = sequentialIds();
    const history = recordChange(
      emptyHistory<Obj>(),
      change([obj("srv-1")], [], { label: "Delete" }),
    );
    const undone = performUndo(history, [], ids)!;
    expect(undone.objects[0]?.id).toBe("local-h1");
    const redone = performRedo(undone.history, undone.objects, ids)!;
    const undoneAgain = performUndo(redone.history, redone.objects, ids)!;
    // Still local-h1: the second resurrection sees a local id and keeps it.
    expect(undoneAgain.objects[0]?.id).toBe("local-h1");
  });

  it("heals a redone addition whose id was persisted then deleted", () => {
    const ids = sequentialIds();
    const placed = obj("local-a", { notes: "vip" });
    let history = recordChange(
      emptyHistory<Obj>(),
      change([], [placed], { label: "Place", selectionAfter: ["local-a"] }),
    );
    // Save: local-a becomes srv-9 across the timeline.
    history = remapHistoryIds(history, new Map([["local-a", "srv-9"]]));
    // Undo the add (doc had srv-9), then the save deletes the row.
    const undone = performUndo(history, [obj("srv-9", { notes: "vip" })], ids)!;
    expect(undone.objects).toEqual([]);

    const redone = performRedo(undone.history, undone.objects, ids)!;
    expect(redone.objects).toEqual([obj("local-h1", { notes: "vip" })]);
    expect(redone.selection).toEqual(["local-h1"]);
    // Undo of the redone add must remove the healed object.
    expect(redone.history.past[0]?.added[0]?.object.id).toBe("local-h1");
    const undoneAgain = performUndo(redone.history, redone.objects, ids)!;
    expect(undoneAgain.objects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property tests — invertibility under random editing sessions
//
// A seeded PRNG drives random add/remove/update sequences (with drag-like
// repeated epochs so coalescing kicks in). Whatever happened: undoing
// everything restores the exact starting document, redoing everything
// restores the exact final document, and any single undo is exactly
// reversed by the following redo.
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  const index = Math.floor(rng() * values.length);
  const value = values[index];
  if (value === undefined) {
    throw new Error("pick called with an empty list");
  }
  return value;
}

interface RandomSession {
  readonly initial: readonly Obj[];
  readonly final: readonly Obj[];
  readonly history: EditorHistory<Obj>;
}

function randomMutation(rng: () => number, target: Obj): Obj {
  const field = pick(rng, ["x", "z", "notes", "groupId", "label"] as const);
  switch (field) {
    case "x":
      return { ...target, x: Math.floor(rng() * 40) };
    case "z":
      return { ...target, z: Math.floor(rng() * 40) };
    case "notes":
      return { ...target, notes: `note-${String(Math.floor(rng() * 6))}` };
    case "groupId":
      return { ...target, groupId: rng() < 0.4 ? null : `g${String(Math.floor(rng() * 3))}` };
    case "label":
      return { ...target, label: rng() < 0.3 ? undefined : `L${String(Math.floor(rng() * 4))}` };
  }
}

function buildRandomSession(seed: number, opCount: number): RandomSession {
  const rng = makeRng(seed);
  let doc: readonly Obj[] = [obj("local-seed-1", { x: 3 }), obj("local-seed-2")];
  const initial = doc;
  let history = emptyHistory<Obj>();
  let epoch = 0;
  let nextId = 0;
  let lastWasUpdate = false;

  for (let i = 0; i < opCount; i++) {
    const roll = rng();
    let after: readonly Obj[];
    let isUpdate = false;
    if (roll < 0.25 || doc.length === 0) {
      after = [...doc, obj(`local-p${String(++nextId)}`, { x: Math.floor(rng() * 40) })];
    } else if (roll < 0.4) {
      const index = Math.floor(rng() * doc.length);
      after = doc.filter((_, position) => position !== index);
    } else {
      const index = Math.floor(rng() * doc.length);
      const target = doc[index];
      if (target === undefined) {
        throw new Error("random index out of range");
      }
      const mutated = randomMutation(rng, target);
      after = doc.map((object, position) => (position === index ? mutated : object));
      isUpdate = true;
    }
    // Drag-like sessions: consecutive updates sometimes share an epoch.
    if (!(isUpdate && lastWasUpdate && rng() < 0.35)) {
      epoch++;
    }
    history = recordChange(history, change(doc, after, { epoch, label: `op${String(i)}` }));
    doc = after;
    lastWasUpdate = isUpdate;
  }
  return { initial, final: doc, history };
}

describe("property: random sessions are exactly invertible", () => {
  it("undo-all restores the initial document and redo-all the final one", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const session = buildRandomSession(seed, 60);
      let history = session.history;
      let doc = session.final;

      // Walk to the bottom; every step must be reversed exactly by redo.
      for (;;) {
        const beforeUndo = doc;
        const undone = performUndo(history, doc, noHealIds);
        if (undone === null) {
          break;
        }
        const redone = performRedo(undone.history, undone.objects, noHealIds);
        expect(redone?.objects).toEqual(beforeUndo);
        const undoneAgain = performUndo(redone!.history, redone!.objects, noHealIds);
        expect(undoneAgain?.objects).toEqual(undone.objects);
        history = undoneAgain!.history;
        doc = undoneAgain!.objects;
      }
      expect(doc).toEqual(session.initial);

      // Walk back to the top.
      for (;;) {
        const redone = performRedo(history, doc, noHealIds);
        if (redone === null) {
          break;
        }
        history = redone.history;
        doc = redone.objects;
      }
      expect(doc).toEqual(session.final);
    }
  });

  it("keeps the timeline within budget for long random sessions", () => {
    const session = buildRandomSession(99, 300);
    expect(session.history.past.length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES);
  });
});
