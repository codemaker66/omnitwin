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
});
