import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryKeys, HistoryPanel } from "../HistoryPanel.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { restartHistoryClock } from "../../../lib/history-clock.js";
import { useEditorStore, type EditorObject } from "../../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// History in the left zone (T-674 slice 15; approved spec §6.9, §11 H): the
// steps named in the venue's words with their times, the current one marked
// and Redo's steps dimmed after it; choosing one returns the layout there in
// one go; H toggles it, Esc closes it, ↑ ↓ and Enter work the list.
// ---------------------------------------------------------------------------

const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "";
const CHAIR = getCatalogueItemBySlug("banquet-chair")?.id ?? "";

function piece(id: string, assetDefinitionId: string, over: Partial<EditorObject> = {}): EditorObject {
  return {
    id, assetDefinitionId,
    positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null, notes: "",
    ...over,
  };
}

const TABLE_8 = [
  piece("t8", ROUND, { groupId: "g8", label: "Table 8" }),
  piece("c1", CHAIR, { groupId: "g8" }),
  piece("c2", CHAIR, { groupId: "g8" }),
];

function open(): void {
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "cfg-1", spaceId: "space-1", venueId: "venue-1", objects: TABLE_8, baseObjects: TABLE_8 });
  restartHistoryClock();
}

/** Moves Table 8 with its chairs, as one step. */
function moveTable8(dx: number): void {
  const editor = useEditorStore.getState();
  editor.bumpHistoryEpoch();
  editor.moveObjectsByDelta(new Set(["t8", "c1", "c2"]), dx, 0);
  editor.bumpHistoryEpoch();
}

function clothTable8(): void {
  const editor = useEditorStore.getState();
  editor.bumpHistoryEpoch();
  editor.replaceObjectsFromScene(editor.objects.map((object) => (object.id === "t8" ? { ...object, clothed: true, clothStyle: "white" } : object)));
  editor.bumpHistoryEpoch();
}

function options(): HTMLElement[] {
  return within(screen.getByRole("listbox", { name: "Steps" })).getAllByRole("option");
}

function option(index: number): HTMLElement {
  const row = options()[index];
  if (row === undefined) throw new Error(`no row ${String(index)}`);
  return row;
}

beforeEach(() => {
  open();
  usePlannerChromeStore.getState().closeAll();
});
afterEach(() => {
  cleanup();
});

describe("History", () => {
  it("says there is nothing to undo yet, and that it starts when the layout opens", () => {
    render(<HistoryPanel />);
    const panel = screen.getByTestId("planner-history");
    expect(panel.textContent).toContain("Nothing to undo yet");
    expect(panel.textContent).toContain("History starts when you open the layout.");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("lists each step by name and time, the current one marked", () => {
    moveTable8(1);
    clothTable8();
    render(<HistoryPanel />);
    expect(options().map((row) => row.textContent?.replace(/\d\d:\d\d/u, "").trim())).toEqual([
      "As opened",
      "Move Table 8",
      "Cloth on Table 8, where the layout is now",
    ]);
    expect(option(2).getAttribute("aria-current")).toBe("step");
    expect(option(1).textContent).toMatch(/\d\d:\d\d/u);
    expect(screen.getByTestId("planner-history").textContent).toContain("2 steps");
  });

  it("returns to an earlier step in one go, and forward again, with Redo's steps dimmed", () => {
    moveTable8(1);
    moveTable8(1);
    clothTable8();
    render(<HistoryPanel />);
    fireEvent.click(option(1));
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useEditorStore.getState().objects.find((object) => object.id === "t8")?.positionX).toBe(1);
    expect(option(1).getAttribute("aria-current")).toBe("step");
    expect(option(2).className).toContain("is-undone");
    expect(option(3).textContent).toContain("undone");
    expect(screen.getByRole("status").textContent).toBe("Back to Move Table 8");
    expect(screen.getByTestId("planner-history").textContent).toContain("3 steps · 2 to redo");
    fireEvent.click(option(3));
    expect(useEditorStore.getState().history.past).toHaveLength(3);
    expect(useEditorStore.getState().history.future).toHaveLength(0);
  });

  it("returns to the layout as opened", () => {
    moveTable8(2);
    render(<HistoryPanel />);
    fireEvent.click(option(0));
    expect(useEditorStore.getState().history.past).toHaveLength(0);
    expect(useEditorStore.getState().objects.find((object) => object.id === "t8")?.positionX).toBe(0);
    expect(screen.getByRole("status").textContent).toBe("Back to the layout as opened");
  });

  it("takes focus to the list, where the arrows move and Enter returns there", () => {
    moveTable8(1);
    clothTable8();
    render(<HistoryPanel />);
    const list = screen.getByRole("listbox", { name: "Steps" });
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-activedescendant")).toBe(option(2).id);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(list.getAttribute("aria-activedescendant")).toBe(option(1).id);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    fireEvent.keyDown(list, { key: "Home" });
    expect(list.getAttribute("aria-activedescendant")).toBe(option(0).id);
  });

  it("follows an undo made elsewhere", () => {
    moveTable8(1);
    clothTable8();
    render(<HistoryPanel />);
    act(() => { useEditorStore.getState().undo(); });
    expect(option(1).getAttribute("aria-current")).toBe("step");
  });

  it("says plainly when the layout changed somewhere else", () => {
    moveTable8(1);
    useEditorStore.setState({
      saveConflict: { expectedRevision: 3, currentRevision: 4, message: "Changed", changedBy: null, changedAt: null, byYou: false, theirChange: null },
    });
    render(<HistoryPanel />);
    expect(screen.getByTestId("planner-history").textContent).toContain("showing the other version starts History again");
  });

  it("closes on Esc and on its close key", () => {
    usePlannerChromeStore.getState().open("left", "history");
    render(<HistoryPanel />);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(usePlannerChromeStore.getState().left).toBeNull();
    usePlannerChromeStore.getState().open("left", "history");
    fireEvent.click(screen.getByRole("button", { name: /^Close History/u }));
    expect(usePlannerChromeStore.getState().left).toBeNull();
  });
});

describe("History's key", () => {
  it("opens History with H and closes it with H again", () => {
    render(<HistoryKeys />);
    fireEvent.keyDown(window, { key: "h", code: "KeyH" });
    expect(usePlannerChromeStore.getState().left).toBe("history");
    fireEvent.keyDown(window, { key: "h", code: "KeyH" });
    expect(usePlannerChromeStore.getState().left).toBeNull();
  });

  it("replaces another panel in the left zone", () => {
    usePlannerChromeStore.getState().open("left", "add");
    render(<HistoryKeys />);
    fireEvent.keyDown(window, { key: "H", code: "KeyH" });
    expect(usePlannerChromeStore.getState().left).toBe("history");
  });
});
