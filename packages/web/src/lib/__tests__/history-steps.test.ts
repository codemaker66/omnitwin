import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { emptyHistory, MAX_HISTORY_ENTRIES, performUndo, recordChange, type EditorHistory } from "../editor-history.js";
import { advanceClock, startClock, type ClockReading, type HistoryClock } from "../history-clock.js";
import { historyView, SITTING_GAP_MS, stepsToReach } from "../history-steps.js";
import type { EditorObject } from "../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// History's clock and list (approved spec §6.9; T-674 slice 15): each step
// timed from when it was first seen, saves as bookmarks, the current
// position marked, Redo's steps after it, sittings split by a long pause,
// and the 100-step cap said plainly once the oldest have dropped off.
// ---------------------------------------------------------------------------

const LECTERN = getCatalogueItemBySlug("lectern")?.id ?? "";
const T0 = Date.UTC(2026, 9, 26, 21, 2);
const MIN = 60 * 1000;
const IDS = { makeLocalId: () => "local-x", isLocalId: () => true };

function lectern(x: number): EditorObject {
  return {
    id: "l1", assetDefinitionId: LECTERN,
    positionX: x, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null, notes: "",
  };
}

function reading(history: EditorHistory<EditorObject>, over: Partial<ClockReading> = {}): ClockReading {
  return { configId: "cfg-1", history, objectCount: 1, isSaving: false, lastSavedAt: null, ...over };
}

/** A lectern moved step by step, a minute apart: each step its own epoch. */
function moves(count: number): { history: EditorHistory<EditorObject>; clock: HistoryClock; at: (i: number) => number } {
  let history = emptyHistory<EditorObject>();
  let clock = startClock(reading(history), T0);
  const at = (i: number): number => T0 + (i + 1) * MIN;
  for (let i = 0; i < count; i += 1) {
    const next = recordChange(history, { before: [lectern(i)], after: [lectern(i + 1)], label: "Move item", epoch: i, selectionBefore: [], selectionAfter: [] });
    clock = advanceClock(clock, reading(history), reading(next), at(i));
    history = next;
  }
  return { history, clock, at };
}

function rowsOf(history: EditorHistory<EditorObject>, clock: HistoryClock, objects: readonly EditorObject[]) {
  return historyView(history, clock, objects).sittings.flatMap((sitting) => sitting.rows);
}

describe("the history clock", () => {
  it("times each step from when it was first seen, and keeps that time through undo", () => {
    const { history, clock, at } = moves(3);
    expect([...clock.steps.values()].map((facts) => facts.at)).toEqual([at(0), at(1), at(2)]);
    const step = performUndo(history, [lectern(3)], IDS);
    if (step === null) throw new Error("no undo");
    const after = advanceClock(clock, reading(history), reading(step.history), at(9));
    expect(after.steps.get(3)?.at).toBe(at(2));
  });

  it("returns the same clock for a change it does not keep, so drag frames cost nothing", () => {
    const { history, clock } = moves(1);
    expect(advanceClock(clock, reading(history, { objectCount: 1 }), reading(history, { objectCount: 2 }), T0 + 99 * MIN)).toBe(clock);
  });

  it("notes when a step fell on an empty floor", () => {
    const history = emptyHistory<EditorObject>();
    const clock = startClock(reading(history, { objectCount: 0 }), T0);
    const next = recordChange(history, { before: [], after: [lectern(0)], label: "Place Lectern", epoch: 1, selectionBefore: [], selectionAfter: [] });
    expect(advanceClock(clock, reading(history, { objectCount: 0 }), reading(next), T0 + MIN).steps.get(1)?.floorEmptyBefore).toBe(true);
  });

  it("marks a save this browser completed at the step it saved", () => {
    const { history, clock } = moves(2);
    const savedAt = new Date(T0 + 10 * MIN);
    const after = advanceClock(clock, reading(history, { isSaving: true }), reading(history, { lastSavedAt: savedAt }), T0 + 10 * MIN);
    expect(after.saves).toEqual([{ seq: 2, at: savedAt.getTime() }]);
  });

  it("does not mark someone else's save, which arrives without one of ours in flight", () => {
    const { history, clock } = moves(1);
    expect(advanceClock(clock, reading(history), reading(history, { lastSavedAt: new Date(T0 + 5 * MIN) }), T0 + 5 * MIN).saves).toEqual([]);
  });

  it("starts again when the layout is opened again or the store empties the timeline", () => {
    const { history, clock } = moves(2);
    const reopened = advanceClock(clock, reading(history), reading(emptyHistory<EditorObject>()), T0 + 40 * MIN);
    expect(reopened.steps.size).toBe(0);
    expect(reopened.startedAt).toBe(T0 + 40 * MIN);
    expect(reopened.began).toBe("opened");
    const other = advanceClock(clock, reading(history), reading(history, { configId: "cfg-2" }), T0 + 41 * MIN);
    expect(other.configId).toBe("cfg-2");
    // A save the server could not line up empties the timeline: History starts again, as saved.
    const savedAt = new Date(T0 + 42 * MIN);
    const resaved = advanceClock(clock, reading(history, { isSaving: true }), reading(emptyHistory<EditorObject>(), { lastSavedAt: savedAt }), T0 + 42 * MIN);
    expect(resaved.began).toBe("saved");
    expect(resaved.saves).toEqual([{ seq: 0, at: savedAt.getTime() }]);
  });

  it("counts the steps that fell off the oldest end at the cap", () => {
    const { clock } = moves(MAX_HISTORY_ENTRIES + 3);
    expect(clock.dropped).toBe(3);
    expect(clock.steps.size).toBe(MAX_HISTORY_ENTRIES);
  });
});

describe("History's list", () => {
  it("lists where it began, then each step oldest first, the current one marked", () => {
    const { history, clock } = moves(3);
    const rows = rowsOf(history, clock, [lectern(3)]);
    expect(rows.map((row) => [row.kind, row.name, row.state])).toEqual([
      ["origin", "As opened", "done"],
      ["step", "Move Lectern", "done"],
      ["step", "Move Lectern", "done"],
      ["step", "Move Lectern", "current"],
    ]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
  });

  it("puts the steps Redo would put back after the current one, undone", () => {
    const { history, clock } = moves(3);
    const once = performUndo(history, [lectern(3)], IDS);
    const twice = once === null ? null : performUndo(once.history, once.objects, IDS);
    if (twice === null) throw new Error("no undo");
    const rows = rowsOf(twice.history, clock, twice.objects);
    expect(rows.map((row) => row.state)).toEqual(["done", "current", "undone", "undone"]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
  });

  it("shows a save as a bookmark after the step it saved", () => {
    const { history, clock } = moves(2);
    const saved = { ...clock, saves: [{ seq: 1, at: Date.UTC(2026, 9, 26, 21, 41) }] };
    const rows = rowsOf(history, saved, [lectern(2)]);
    expect(rows.map((row) => row.name)).toEqual(["As opened", "Move Lectern", "Saved 21:41", "Move Lectern"]);
    expect(rows[2]?.position).toBe(1);
  });

  it("starts a new sitting after a long pause", () => {
    const { history, clock } = moves(2);
    const next = recordChange(history, { before: [lectern(2)], after: [lectern(3)], label: "Move item", epoch: 99, selectionBefore: [], selectionAfter: [] });
    const later = advanceClock(clock, reading(history), reading(next), T0 + 2 * MIN + SITTING_GAP_MS);
    expect(historyView(next, later, [lectern(3)]).sittings.map((sitting) => sitting.rows.length)).toEqual([3, 1]);
  });

  it("names the beginning plainly once the oldest steps have dropped off", () => {
    const { history, clock } = moves(MAX_HISTORY_ENTRIES + 1);
    const view = historyView(history, clock, [lectern(MAX_HISTORY_ENTRIES + 1)]);
    expect(view.dropped).toBe(1);
    expect(view.sittings[0]?.rows[0]?.name).toBe("Before these steps");
    expect(view.steps).toBe(MAX_HISTORY_ENTRIES);
  });

  it("is empty with nothing to undo or redo", () => {
    const history = emptyHistory<EditorObject>();
    expect(historyView(history, startClock(reading(history), T0), []).empty).toBe(true);
  });
});

describe("returning to a step", () => {
  it("undoes back to an earlier one and redoes forward to a later one", () => {
    expect(stepsToReach(5, 2)).toEqual({ undo: 3, redo: 0 });
    expect(stepsToReach(2, 5)).toEqual({ undo: 0, redo: 3 });
    expect(stepsToReach(3, 3)).toEqual({ undo: 0, redo: 0 });
  });
});
