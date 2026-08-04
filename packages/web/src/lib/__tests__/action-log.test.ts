import { describe, expect, it } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import {
  MAX_HISTORY_ENTRIES,
  emptyHistory,
  recordChange,
  remapHistoryIds,
  type EditorHistory,
  type HistoryObject,
} from "../editor-history.js";
import { actionFromHistoryEntry, createActionEmitter } from "../action-log.js";

// G4 Slice 1: history entries become Actions; the emitter seals one Action
// per completed gesture (append seals the previous top; undo seals the top;
// flush seals the open gesture). Driven through the REAL history engine.

interface Obj extends HistoryObject {
  readonly id: string;
  readonly x: number;
  readonly kind: string;
}

const A: Obj = { id: "a", x: 0, kind: "table-round" };

function record(
  history: EditorHistory<Obj>,
  before: readonly Obj[],
  after: readonly Obj[],
  epoch: number,
  label = "test",
): EditorHistory<Obj> {
  const next = recordChange(history, {
    before,
    after,
    label,
    epoch,
    selectionBefore: [],
    selectionAfter: [],
  });
  if (next === null) throw new Error("expected a recorded change");
  return next;
}

const CTX = {
  actor: { kind: "operator" as const },
  surface: "planner_3d",
  makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  now: () => "2026-07-16T19:00:00.000Z",
};

describe("actionFromHistoryEntry", () => {
  it("derives namespaced intents from the delta shape", () => {
    const placed = record(emptyHistory<Obj>(), [], [A], 1);
    const placedEntry = placed.past.at(-1);
    if (placedEntry === undefined) throw new Error("no entry");
    expect(actionFromHistoryEntry(placedEntry, CTX).intent).toBe("object.place");

    const moved = record(placed, [A], [{ ...A, x: 5 }], 2);
    const movedEntry = moved.past.at(-1);
    if (movedEntry === undefined) throw new Error("no entry");
    expect(actionFromHistoryEntry(movedEntry, CTX).intent).toBe("object.update");

    const removed = record(moved, [{ ...A, x: 5 }], [], 3);
    const removedEntry = removed.past.at(-1);
    if (removedEntry === undefined) throw new Error("no entry");
    expect(actionFromHistoryEntry(removedEntry, CTX).intent).toBe("object.remove");
  });

  it("materializes the inverse (added↔removed, patches flipped) and validates against the schema", () => {
    const placed = record(emptyHistory<Obj>(), [], [A], 1);
    const entry = placed.past.at(-1);
    if (entry === undefined) throw new Error("no entry");
    const action = actionFromHistoryEntry(entry, CTX);

    // The full envelope satisfies the shared schema (serializable contract).
    expect(ActionSchema.safeParse(action).success).toBe(true);
    const inverse = action.inverse as { added: unknown[]; removed: { object: { id: string } }[] };
    expect(inverse.added).toEqual([]);
    expect(inverse.removed[0]?.object.id).toBe("a");
  });
});

describe("createActionEmitter", () => {
  it("emits one action per completed gesture: append seals the previous top", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    let history = emptyHistory<Obj>();
    const afterPlace = record(history, [], [A], 1);
    emitter.afterRecord(history, afterPlace);
    // The place gesture is still open — nothing sealed yet.
    expect(emitted).toEqual([]);

    // Drag frames coalesce into the same top entry — still open, no emission.
    history = afterPlace;
    const drag1 = record(history, [A], [{ ...A, x: 1 }], 2);
    emitter.afterRecord(history, drag1);
    const drag2 = record(drag1, [{ ...A, x: 1 }], [{ ...A, x: 2 }], 2);
    emitter.afterRecord(drag1, drag2);
    expect(emitted).toEqual(["object.place"]); // the place sealed when the drag appended

    // A new gesture seals the drag.
    const del = record(drag2, [{ ...A, x: 2 }], [], 3);
    emitter.afterRecord(drag2, del);
    expect(emitted).toEqual(["object.place", "object.update"]);
  });

  it("undo seals the open gesture, then records history.undo; nothing is emitted twice", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    const h0 = emptyHistory<Obj>();
    const h1 = record(h0, [], [A], 1);
    emitter.afterRecord(h0, h1);
    emitter.afterUndo(h1);
    expect(emitted).toEqual(["object.place", "history.undo"]);

    // Redo of the same entry must not re-emit the gesture.
    emitter.afterRedo(h1);
    expect(emitted).toEqual(["object.place", "history.undo", "history.redo"]);
  });

  it("flush seals the open gesture exactly once (save/config boundaries)", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    const h0 = emptyHistory<Obj>();
    const h1 = record(h0, [], [A], 1);
    emitter.afterRecord(h0, h1);
    emitter.flush(h1);
    emitter.flush(h1);
    expect(emitted).toEqual(["object.place"]);
  });

  it("survives save-time id remapping without duplicating sealed gestures (reviewer CRITICAL 1)", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    // place → move (seals the place) → SAVE (flush seals the move, then the
    // server echo remaps EVERY entry's identity) → keep editing.
    const h0 = emptyHistory<Obj>();
    const h1 = record(h0, [], [A], 1);
    emitter.afterRecord(h0, h1);
    const h2 = record(h1, [A], [{ ...A, x: 3 }], 2);
    emitter.afterRecord(h1, h2);
    emitter.flush(h2); // the save boundary seals the move
    expect(emitted).toEqual(["object.place", "object.update"]);

    const remapped = remapHistoryIds(h2, new Map([["a", "srv-1"]]));

    // The post-save edit must NOT replay the already-sealed move just
    // because remapping gave its entry a fresh object identity.
    const h3 = record(remapped, [{ ...A, id: "srv-1", x: 3 }], [], 3);
    emitter.afterRecord(remapped, h3);
    emitter.flush(h3);
    expect(emitted).toEqual(["object.place", "object.update", "object.remove"]);
  });

  it("reset() starts a new timeline generation — a fresh config's seq-1 gestures seal again", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    // First configuration: two gestures, both sealed.
    const a1 = record(emptyHistory<Obj>(), [], [A], 1);
    emitter.afterRecord(emptyHistory<Obj>(), a1);
    emitter.flush(a1);
    expect(emitted).toEqual(["object.place"]);

    // Config boundary WITHOUT reset would leave the cursor high and skip the
    // new timeline's seq-1 gestures; reset() must restore sealing.
    emitter.reset();
    const b1 = record(emptyHistory<Obj>(), [], [A], 1);
    emitter.afterRecord(emptyHistory<Obj>(), b1);
    emitter.flush(b1);
    expect(emitted).toEqual(["object.place", "object.place"]);
  });

  it("keeps sealing at the history cap, where append+evict holds length constant (reviewer CRITICAL 2)", () => {
    const emitted: string[] = [];
    const emitter = createActionEmitter<Obj>({
      emit: (action) => { emitted.push(action.intent); },
      context: () => CTX,
    });

    // Fill the timeline to its cap with distinct place/remove gestures.
    let history = emptyHistory<Obj>();
    let doc: readonly Obj[] = [];
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 10; index += 1) {
      const nextDoc: readonly Obj[] = doc.length === 0
        ? [{ id: `o${String(index)}`, x: index, kind: "table-round" }]
        : [];
      const next = record(history, doc, nextDoc, index + 1);
      emitter.afterRecord(history, next);
      history = next;
      doc = nextDoc;
    }
    emitter.flush(history);

    // Every completed gesture must have been sealed exactly once — the cap
    // must not silently stop the log.
    expect(emitted).toHaveLength(MAX_HISTORY_ENTRIES + 10);
  });
});
