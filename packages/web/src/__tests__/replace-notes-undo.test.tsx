import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Replace carries each old table's note to the new table nearest it in the
// same step as the tables (lib/note-seeds through the editor bridge), so one
// Undo takes back the tables and the notes together (card-dock Q-16).
// ---------------------------------------------------------------------------

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
  claimConfig: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
}));

const React = await import("react");
const { render, cleanup } = await import("@testing-library/react");
const { useEditorStore } = await import("../stores/editor-store.js");
const { usePlacementStore } = await import("../stores/placement-store.js");
const { useRoomDimensionsStore } = await import("../stores/room-dimensions-store.js");
const { useSelectionStore } = await import("../stores/selection-store.js");
const { EditorBridge, __resetEditorBridgeMountCountForTests } = await import("../components/editor/EditorBridge.js");
const { GRAND_HALL_RENDER_DIMENSIONS } = await import("../constants/scale.js");
const { getCatalogueItem } = await import("../lib/catalogue.js");
const { resetPlacedIdCounter } = await import("../lib/placement.js");
const { setPlannerFeaturesForTesting } = await import("../lib/planner-features.js");
const { replaceSelection } = await import("../lib/planner-keymap.js");
const { seededNote } = await import("../lib/note-seeds.js");
const { cardParamsFor, stampSetup } = await import("../lib/setup-cards.js");

function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function tableIds(): readonly string[] {
  return usePlacementStore.getState().placedItems
    .filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table")
    .map((piece) => piece.id);
}

function noteOf(id: string): string {
  return useEditorStore.getState().objects.find((object) => object.id === id)?.notes ?? "";
}

beforeEach(() => {
  localStorage.clear();
  resetPlacedIdCounter();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  __resetEditorBridgeMountCountForTests();
  setPlannerFeaturesForTesting({ tableSets: true, tableNumbers: true });
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
  cleanup();
});

describe("Replace and the tables' notes", () => {
  it("carries both rounds' notes to the long table in the one step, and one Undo takes back tables and notes", async () => {
    useEditorStore.setState({ configId: "cfg-replace-notes" });
    const { unmount } = render(React.createElement(EditorBridge));
    const round = cardParamsFor("round");
    const long = cardParamsFor("long-table");
    if (round === null || long === null) throw new Error("no cards");
    usePlacementStore.getState().placeSetup([...stampSetup(round, { x: -2.2, z: 0 }, 0), ...stampSetup(round, { x: 2.2, z: 0 }, 0)]);
    await tick();
    const [first, second] = tableIds();
    if (first === undefined || second === undefined) throw new Error("no rounds");
    useEditorStore.getState().setObjectNotes(first, "Vegan at seat 4");
    useEditorStore.getState().setObjectNotes(second, "Birthday cake here");
    const stepsBefore = useEditorStore.getState().history.past.length;

    useSelectionStore.getState().selectMultiple([first, second]);
    const result = replaceSelection(long);
    await tick();
    if (!result.ok) throw new Error(result.reason);
    expect(useEditorStore.getState().history.past).toHaveLength(stepsBefore + 1);
    const carried = tableIds().map(noteOf).filter((note) => note !== "").join("\n");
    expect(carried).toContain("Table 1: Vegan at seat 4");
    expect(carried).toContain("Table 2: Birthday cake here");
    // The seed closed with the write: nothing lingers for a later one.
    expect(tableIds().every((id) => seededNote(id) === undefined)).toBe(true);

    useEditorStore.getState().undo();
    await tick();
    expect(tableIds()).toEqual([first, second]);
    expect(noteOf(first)).toBe("Vegan at seat 4");
    expect(noteOf(second)).toBe("Birthday cake here");

    useEditorStore.getState().redo();
    await tick();
    expect(tableIds().map(noteOf).filter((note) => note !== "").join("\n")).toBe(carried);
    unmount();
  });
});
