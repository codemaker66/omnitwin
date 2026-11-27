import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Lay out numbers its tables in the same write as the tables (Q-46), so the
// editor's history takes one step for both and one Undo takes back the tables
// and their numbers together (planner-qol CR-E, "numbering floods the undo
// history"). A planner who renames each table afterwards takes a step per
// rename, as any rename does.
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
const { EditorBridge, __resetEditorBridgeMountCountForTests } = await import("../components/editor/EditorBridge.js");
const { GRAND_HALL_RENDER_DIMENSIONS } = await import("../constants/scale.js");
const { getCatalogueItem, getCatalogueItemBySlug } = await import("../lib/catalogue.js");
const { resetPlacedIdCounter } = await import("../lib/placement.js");
const { setPlannerFeaturesForTesting } = await import("../lib/planner-features.js");

function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

/** The editor's tables' labels, in the editor's order. */
function tableLabels(): readonly string[] {
  return useEditorStore.getState().objects
    .filter((object) => getCatalogueItem(object.assetDefinitionId)?.category === "table")
    .map((object) => object.label ?? "");
}

beforeEach(() => {
  localStorage.clear();
  resetPlacedIdCounter();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  __resetEditorBridgeMountCountForTests();
  setPlannerFeaturesForTesting({ tableNumbers: true });
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
  cleanup();
});

describe("Lay out and the tables' numbers", () => {
  it("numbers the tables in Lay out's own step, and one Undo takes back tables and numbers", async () => {
    useEditorStore.setState({ configId: "cfg-lay-out-numbers" });
    const { unmount } = render(React.createElement(EditorBridge));
    const round = getCatalogueItemBySlug("round-table-6ft-white");
    if (round === undefined) throw new Error("no round");
    const stepsBefore = useEditorStore.getState().history.past.length;

    const plan = usePlacementStore.getState().autoArrangeBanquet(round.id, 80, 10);
    await tick();
    if (plan === null) throw new Error("no plan");
    const labels = tableLabels();
    expect(labels).toHaveLength(8);
    expect([...labels].sort((a, b) => a.localeCompare(b, "en", { numeric: true })))
      .toEqual(Array.from({ length: 8 }, (_, i) => `Table ${String(i + 1)}`));
    expect(useEditorStore.getState().history.past).toHaveLength(stepsBefore + 1);

    useEditorStore.getState().undo();
    await tick();
    expect(tableLabels()).toEqual([]);
    expect(usePlacementStore.getState().placedItems).toEqual([]);
    unmount();
  });
});
