import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Auto-fill and the one-tap seat fix are placements like any other: each is
// one step on the editor's history, and one Undo takes it back (the bridge
// mirrors placement-store writes into editor-store's timeline).
// ---------------------------------------------------------------------------

vi.mock("../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
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
const { getCatalogueItemBySlug } = await import("../lib/catalogue.js");
const { createTableGroup } = await import("../lib/table-group.js");
const { seatingCountsFromPlacedItems } = await import("../lib/seating-counts.js");
const { setPlannerFeaturesForTesting } = await import("../lib/planner-features.js");
const { grandHallExits } = await import("../lib/auto-fill.js");

const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";

function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function chairs(): number {
  return seatingCountsFromPlacedItems(usePlacementStore.getState().placedItems).chairs;
}

beforeEach(() => {
  localStorage.clear();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useRoomDimensionsStore.setState({ dimensions: { width: 21, length: 10.5, height: 7 } });
  __resetEditorBridgeMountCountForTests();
  setPlannerFeaturesForTesting(null);
});

describe("undo after auto-fill and the seat fix", () => {
  it("takes back the 16 chairs added at the tables in one step", async () => {
    useEditorStore.setState({ configId: "cfg-seat-fix" });
    const { unmount } = render(React.createElement(EditorBridge));

    const positions = [-6.435, -2.145, 2.145, 6.435].flatMap((x) => [[x, -2.145], [x, 2.145]] as const);
    usePlacementStore.setState({ placedItems: positions.flatMap(([x, z]) => [...createTableGroup(ROUND, x, z, 0, 8)]) });
    await tick();
    const stepsBefore = useEditorStore.getState().history.past.length;
    expect(chairs()).toBe(64);

    const fix = usePlacementStore.getState().fillSeatShortfall(80);
    await tick();
    expect(fix?.offer.kind).toBe("chairs");
    expect(chairs()).toBe(80);
    expect(useEditorStore.getState().history.past).toHaveLength(stepsBefore + 1);

    useEditorStore.getState().undo();
    await tick();
    expect(chairs()).toBe(64);
    expect(useEditorStore.getState().objects).toHaveLength(72);

    useEditorStore.getState().redo();
    await tick();
    expect(chairs()).toBe(80);

    unmount();
    cleanup();
  });

  it("takes back a whole auto-fill in one step", async () => {
    useEditorStore.setState({ configId: "cfg-auto-fill" });
    const { unmount } = render(React.createElement(EditorBridge));

    usePlacementStore.getState().autoArrangeBanquet(ROUND, 220, 10);
    await tick();
    expect(useEditorStore.getState().objects).toHaveLength(154);
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    await tick();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);

    unmount();
    cleanup();
  });

  it("lays a fill over the rounds in one step that one Undo takes back, sizes set back staying set back (planner-qol C-02, C-X6)", async () => {
    setPlannerFeaturesForTesting({ fillKeepOuts: true });
    useEditorStore.setState({ configId: "cfg-fill-over" });
    const { unmount } = render(React.createElement(EditorBridge));

    // Fourteen numbered rounds of 10; Table 2 resized to 120% in the inspector (table and chairs).
    const positions = [-9, -6, -3, 0, 3, 6, 9].flatMap((x) => [[x, -2.5], [x, 2.5]] as const);
    const rounds = positions.map(([x, z], i) => {
      const [table, ...seats] = createTableGroup(ROUND, x, z, 0, 10);
      if (table === undefined) throw new Error("no table");
      const scale = i === 1 ? { scale: 1.2 } : {};
      return [{ ...table, ...scale, label: `Table ${String(i + 1)}` }, ...seats.map((seat) => ({ ...seat, ...scale }))];
    });
    usePlacementStore.setState({ placedItems: rounds.flat() });
    await tick();
    const table2 = rounds[1]?.[0];
    const table12 = rounds[11]?.[0];
    if (table2 === undefined || table12 === undefined) throw new Error("no rounds");
    useEditorStore.getState().setObjectNotes(table12.id, "Top table's family");
    await tick();
    const stepsBefore = useEditorStore.getState().history.past.length;

    usePlacementStore.getState().autoArrangeBanquet(ROUND, 80, 10, grandHallExits());
    await tick();
    expect(useEditorStore.getState().history.past).toHaveLength(stepsBefore + 1);
    expect(useEditorStore.getState().objects.some((object) => object.id === table12.id)).toBe(false);
    // The bridge has had its turn: the round set back to the standard size stays there on both sides.
    const placed2 = usePlacementStore.getState().placedItems.filter((piece) => piece.groupId === table2.groupId);
    expect(placed2).toHaveLength(11);
    expect(placed2.map((piece) => piece.scale ?? 1)).toEqual(Array.from({ length: 11 }, () => 1));
    expect(useEditorStore.getState().objects.filter((object) => object.groupId === table2.groupId).map((object) => object.scale))
      .toEqual(Array.from({ length: 11 }, () => 1));

    useEditorStore.getState().undo();
    await tick();
    const back = useEditorStore.getState().objects;
    expect(back).toHaveLength(154);
    expect(back.find((object) => object.id === table12.id)?.notes).toBe("Top table's family");
    expect(back.find((object) => object.id === table2.id)).toMatchObject({ label: "Table 2", scale: 1.2 });
    expect(usePlacementStore.getState().placedItems.find((piece) => piece.id === table2.id)?.scale).toBe(1.2);

    unmount();
    cleanup();
  });
});
