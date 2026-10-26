import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { lastAnnouncement } from "../planner-announcer.js";
import { PLANNER_CHROME_STORAGE_KEY } from "../planner-chrome-flag.js";
import { NO_TABLES_TO_WALK, resetEditingMemoryForTesting, selectionKeyBindings, usePlannerToolKeys } from "../planner-keymap.js";
import { registerKeyBindings } from "../planner-keys.js";
import { createPlacedItem, resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";
import { useCaptionFocusStore } from "../../stores/caption-focus-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// Walking the room by keyboard (approved spec §11; QoL B-X2) over the real
// stores and keymap, pressed as a browser sends the keys: ] and [ select one
// table by number, Shift walks every kind, the camera is asked to bring the
// table into view and the caption to take focus, and the table is named.
// ---------------------------------------------------------------------------

const CODES: Readonly<Record<string, string>> = { "]": "BracketRight", "}": "BracketRight", "[": "BracketLeft", "{": "BracketLeft", "+": "Equal" };

/** A press as a browser sends it (Shift with }, { and +), from `target`: the page, unless a field has focus. */
function press(key: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key, code: CODES[key] ?? key, shiftKey: key === "}" || key === "{" || key === "+", bubbles: true, cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function ToolKeys(): null {
  usePlannerToolKeys();
  return null;
}

const cleanups: (() => void)[] = [];
/** Whether the scene says a floor point is well in view (SelectionSystem's camera, in the planner). */
let inView: (x: number, z: number) => boolean = () => true;

function round(x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0);
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

function table(label: string): PlacedItem {
  const found = tables().find((piece) => piece.label === label);
  if (found === undefined) throw new Error(`no ${label}`);
  return found;
}

function chairsAt(label: string): number {
  const { groupId } = table(label);
  return placed().filter((piece) => piece.groupId === groupId && getCatalogueItem(piece.catalogueItemId)?.category === "chair").length;
}

function selected(): readonly string[] {
  return [...useSelectionStore.getState().selectedIds];
}

function lone(slug: string, x: number, z: number): PlacedItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return createPlacedItem(item.id, x, z, 0, null, 0, `${slug}-${String(x)}`);
}

/** Three Rounds of 10 across the room, numbered Table 1 to 3 as they are set down. */
function threeTables(): void {
  for (const x of [-6, 0, 6]) usePlacementStore.getState().placeSetup(round(x, 0));
}

beforeEach(() => {
  window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v2");
  resetPlacedIdCounter();
  resetEditingMemoryForTesting();
  inView = () => true;
  render(<ToolKeys />);
  cleanups.push(registerKeyBindings(selectionKeyBindings({
    invalidate: () => undefined,
    cancelGesture: () => undefined,
    screenUp: () => ({ x: 0, z: -1 }),
    inView: (x, z) => inView(x, z),
  })));
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useCockpitStore.getState().reset();
  useCaptionFocusStore.getState().clearCaptionFocus();
  document.getElementById("planner-announcer")?.remove();
  setPlannerFeaturesForTesting({ tableNumbers: true });
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  cleanup();
  setPlannerFeaturesForTesting(null);
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
});

describe("] and [", () => {
  it("walk ], ], +, Delete removes Table 2 in one undo step, and [ then reaches Table 1", () => {
    threeTables();
    press("]");
    expect(selected()).toEqual([table("Table 1").id]);
    expect(lastAnnouncement()).toBe("Table 1, Round of 10, 10 seats");
    press("]");
    expect(selected()).toEqual([table("Table 2").id]);
    expect(useCaptionFocusStore.getState().request?.pieceId).toBe(table("Table 2").id);
    expect(lastAnnouncement()).toBe("Table 2, Round of 10, 10 seats");

    press("+");
    expect(chairsAt("Table 2")).toBe(11);

    // EditorBridge mirrors each write of placedItems into the undo timeline: one write is one step.
    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    press("Delete");
    unsubscribe();
    expect(writes).toBe(1);
    expect(tables().map((piece) => piece.label)).toEqual(["Table 1", "Table 3"]);
    expect(placed()).toHaveLength(22);

    press("[");
    expect(selected()).toEqual([table("Table 1").id]);
    expect(lastAnnouncement()).toBe("Table 1, Round of 10, 10 seats");
  });

  it("selects Table 1 with ] and the last table with [ when nothing is selected, and wraps round at the ends", () => {
    threeTables();
    press("[");
    expect(selected()).toEqual([table("Table 3").id]);
    press("]");
    expect(selected()).toEqual([table("Table 1").id]);
    useSelectionStore.getState().clearSelection();
    press("]");
    expect(selected()).toEqual([table("Table 1").id]);
  });

  it("goes by position where tables have no numbers: rows front to back, each left to right", () => {
    setPlannerFeaturesForTesting({ tableNumbers: false });
    for (const [x, z] of [[6, 4], [-6, 4], [0, -4], [-6, -4]] as const) usePlacementStore.getState().placeSetup(round(x, z));
    expect(tables().every((piece) => piece.label === "")).toBe(true);
    const visited: (readonly [number, number])[] = [];
    for (let i = 0; i < 4; i += 1) {
      press("]");
      const at = tables().find((piece) => piece.id === selected()[0]);
      visited.push([at?.x ?? Number.NaN, at?.z ?? Number.NaN]);
    }
    expect(visited).toEqual([[-6, -4], [0, -4], [-6, 4], [6, 4]]);
    expect(lastAnnouncement()).toBe("Round of 10, 10 seats");
  });

  it("walks the selected piece's kind from a piece of another kind", () => {
    threeTables();
    usePlacementStore.setState({ placedItems: [...placed(), lone("poseur-table", -3, 6), lone("poseur-table", 3, 6)] });
    useSelectionStore.getState().select("poseur-table--3");
    press("]");
    expect(selected()).toEqual(["poseur-table-3"]);
    press("]");
    expect(selected()).toEqual(["poseur-table--3"]);
    expect(lastAnnouncement()).toBe("Poseur Table");
  });

  it("walks every kind, row by row, with Shift", () => {
    threeTables();
    usePlacementStore.setState({ placedItems: [...placed(), lone("lectern", 0, -6)] });
    press("}");
    expect(selected()).toEqual(["lectern-0"]);
    expect(lastAnnouncement()).toBe("Lectern");
    press("}");
    expect(selected()).toEqual([table("Table 1").id]);
    press("{");
    press("{");
    expect(selected()).toEqual([table("Table 3").id]);
  });

  it("says there are no tables, and selects nothing, in a room without them; Shift still reaches what there is", () => {
    usePlacementStore.setState({ placedItems: [lone("lectern", 0, 0)] });
    expect(press("]").defaultPrevented).toBe(false);
    expect(selected()).toEqual([]);
    expect(lastAnnouncement()).toBe(NO_TABLES_TO_WALK);
    press("}");
    expect(selected()).toEqual(["lectern-0"]);
  });

  it("asks the camera to bring a table not well in view into view, and leaves one in view where it is", () => {
    threeTables();
    inView = (x) => x < 3;
    press("]");
    press("]");
    expect(useCockpitStore.getState().focusRequest).toBeNull();
    press("]");
    expect(useCockpitStore.getState().focusRequest).toMatchObject({ x: table("Table 3").x, z: table("Table 3").z });

    // In Walk the camera is the person's: the walk selects, and leaves the view alone.
    useCockpitStore.getState().reset();
    useCockpitStore.getState().setWalkMode(true);
    inView = () => false;
    press("]");
    expect(selected()).toEqual([table("Table 1").id]);
    expect(useCockpitStore.getState().focusRequest).toBeNull();
  });

  it("leaves the keys to a field being typed in", () => {
    threeTables();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    try {
      expect(press("]", field).defaultPrevented).toBe(false);
      expect(selected()).toEqual([]);
    } finally {
      field.remove();
    }
  });

  it("leaves [ and ] to v1's timeline dock, and rests while a card is in hand", () => {
    threeTables();
    window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v1");
    press("]");
    expect(selected()).toEqual([]);
    window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v2");
    useCatalogueStore.getState().armCard("round");
    press("]");
    expect(selected()).toEqual([]);
  });
});
