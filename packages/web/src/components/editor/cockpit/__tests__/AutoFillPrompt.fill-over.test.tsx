// The Fill prompt over a layout (card-dock Q-10; fillKeepOuts): it states the figure the gangway
// design reaches in the room it is in, beside the venue's published one, and the spacing in the
// trade's words, from the same plan the store will lay.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../../constants/scale.js";
import type { PublishedCapacityAnswer } from "../../../../lib/planner-truth.js";
import { setPlannerFeaturesForTesting } from "../../../../lib/planner-features.js";
import type { PlacedItem } from "../../../../lib/placement.js";
import { cardParamsFor, stampSetup } from "../../../../lib/setup-cards.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../../stores/room-dimensions-store.js";
import { placedItemToEditor } from "../../EditorBridge.js";
import { AutoFillPrompt } from "../AutoFillPrompt.js";
import { openRoom, plannerRoom } from "./planner-truth-fixtures.js";

const PUBLISHED: PublishedCapacityAnswer = {
  kind: "published",
  capacity: { theatre: 250, classroom: 120, dinner: 180, reception: 300 },
  source: "Trades Hall's published capacities",
};

function askFor(guests: number): void {
  fireEvent.change(screen.getByTestId("auto-fill-guests"), { target: { value: String(guests) } });
}

beforeEach(() => {
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useEditorStore.setState({ isPublicPreview: false, notesIncluded: false, baseObjects: [] });
  openRoom(plannerRoom("grand-hall", "Grand Hall"));
  setPlannerFeaturesForTesting({ fillKeepOuts: true });
});

afterEach(() => {
  cleanup();
  openRoom(null);
  setPlannerFeaturesForTesting(null);
});

describe("Fill's prompt over a layout", () => {
  it("states 110 seats with rounds of 10 beside the 180 the venue publishes, with the gangways in the trade's words", () => {
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={vi.fn()} onCancel={vi.fn()} />);
    askFor(180);
    expect(screen.getByTestId("auto-fill-short").textContent).toBe("Room for 110 at this spacing; the venue publishes 180 for a seated dinner.");
    expect(screen.getByTestId("auto-fill-basis").textContent).toBe("Rounds of 10, with 1.1 m gangways to the doors and 0.6 m clear behind every other chair, after Scottish fire safety guidance.");
  });

  it("places what its button says, as one write", () => {
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(80);
    const label = screen.getByTestId("auto-fill-place").textContent ?? "";
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    const tables = new Set(usePlacementStore.getState().placedItems.map((piece) => piece.groupId)).size;
    expect(label).toBe(`Place ${String(tables)} tables and ${String(usePlacementStore.getState().placedItems.length - tables)} chairs`);
    expect(onPlaced).toHaveBeenCalledTimes(1);
  });

  it("says what it does to the rounds already laid before it lays, and seats rather than places (C-02)", () => {
    const laid = fiveRounds();
    usePlacementStore.setState({ placedItems: laid });
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={vi.fn()} onCancel={vi.fn()} />);
    askFor(30);
    expect(screen.getByTestId("auto-fill-consequence").textContent).toBe("Moves 3 rounds and takes away 2.");
    expect(screen.getByTestId("auto-fill-place").textContent).toBe("Seat 30 at 3 tables");
    // Nothing moves until the button is pressed.
    expect(usePlacementStore.getState().placedItems).toBe(laid);
  });

  it("lays what it said it would, and tells the lens what it did (C-02)", () => {
    usePlacementStore.setState({ placedItems: fiveRounds() });
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(30);
    expect(screen.getByTestId("auto-fill-consequence").textContent).toBe("Moves 3 rounds and takes away 2.");
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    // Three rounds stay, keeping the first three names; Table 4 and Table 5 are taken away.
    // A chair is created with an empty label (createPlacedItem), so only the tables' names count.
    const names = usePlacementStore.getState().placedItems.map((piece) => piece.label ?? "").filter((name) => name !== "");
    expect([...names].sort()).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(onPlaced).toHaveBeenCalledWith(expect.objectContaining({ tableCount: 3 }), "Seated 30 at 3 tables: moved 3 rounds and took away 2.");
  });

  it("leaves a round whose note this browser is not shown where it stands, and tells the lens why", () => {
    const laid = fiveRounds();
    const table5 = laid.find((piece) => piece.label === "Table 5");
    if (table5 === undefined) throw new Error("no Table 5");
    usePlacementStore.setState({ placedItems: laid });
    // A guest plan read without its notes: the server says Table 5 holds one.
    useEditorStore.setState({
      isPublicPreview: true,
      notesIncluded: false,
      baseObjects: laid.map((piece) => ({ ...placedItemToEditor(piece, undefined), ...(piece.id === table5.id ? { noteHeld: true } : {}) })),
    });
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(20);
    // Two of the other four rounds seat the twenty; Table 5 is not the fill's to take away.
    expect(screen.getByTestId("auto-fill-consequence").textContent).toBe("Moves 2 rounds and takes away 2.");
    fireEvent.click(screen.getByTestId("auto-fill-place"));

    const after = usePlacementStore.getState().placedItems;
    expect(after.map((piece) => piece.label ?? "").filter((name) => name !== "").sort()).toEqual(["Table 1", "Table 2", "Table 5"]);
    expect(after.find((piece) => piece.id === table5.id)).toMatchObject({ x: table5.x, z: table5.z, rotationY: table5.rotationY });
    expect(after.filter((piece) => piece.groupId === table5.groupId)).toHaveLength(11);
    expect(onPlaced).toHaveBeenCalledWith(
      expect.objectContaining({ tableCount: 2 }),
      "Seated 20 at 2 tables: moved 2 rounds and took away 2. Table 5 stayed where it is, because it has a note that cannot be shown here.",
    );
  });

  it("lists several such rounds in one sentence", () => {
    const laid = fiveRounds();
    const held = new Set(laid.filter((piece) => ["Table 1", "Table 2", "Table 3"].includes(piece.label ?? "")).map((piece) => piece.id));
    usePlacementStore.setState({ placedItems: laid });
    useEditorStore.setState({
      isPublicPreview: true,
      notesIncluded: false,
      baseObjects: laid.map((piece) => ({ ...placedItemToEditor(piece, undefined), ...(held.has(piece.id) ? { noteHeld: true } : {}) })),
    });
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(10);
    fireEvent.click(screen.getByTestId("auto-fill-place"));

    const names = usePlacementStore.getState().placedItems.map((piece) => piece.label ?? "").filter((name) => name !== "");
    expect(names).toEqual(expect.arrayContaining(["Table 1", "Table 2", "Table 3"]));
    const said: unknown = onPlaced.mock.calls[0]?.[1];
    expect(typeof said === "string" ? said.slice(said.indexOf("Tables")) : said)
      .toBe("Tables 1, 2 and 3 stayed where they are, because each has a note that cannot be shown here.");
  });

  it("says which rounds stay for their notes when they leave it no room, not only that the room has none (KG2)", () => {
    // Three rounds in a row across the middle: unmarked, the fill sets two of them anew for twenty.
    const laid = roundsAt([-6, 0, 6]);
    const tables = new Set(laid.filter((piece) => (piece.label ?? "") !== "").map((piece) => piece.id));
    usePlacementStore.setState({ placedItems: laid });
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={vi.fn()} onCancel={vi.fn()} />);
    askFor(20);
    expect(screen.queryByTestId("auto-fill-no-room")).toBeNull();

    // Held where they stand for their notes, the same three leave the gangways no room.
    act(() => {
      useEditorStore.setState({
        isPublicPreview: true,
        notesIncluded: false,
        baseObjects: laid.map((piece) => ({ ...placedItemToEditor(piece, undefined), ...(tables.has(piece.id) ? { noteHeld: true } : {}) })),
      });
    });
    expect(screen.getByTestId("auto-fill-no-room").textContent).toBe("There is no room for this layout at this spacing.");
    expect(screen.getByTestId("auto-fill-kept-for-notes").textContent)
      .toBe("Tables 1, 2 and 3 stayed where they are, because each has a note that cannot be shown here.");
    expect(screen.getByTestId("auto-fill-place")).toHaveProperty("disabled", true);
    expect(usePlacementStore.getState().placedItems).toBe(laid);
  });
});

/** Five rounds of 10 in a row across the hall, named Table 1 to Table 5. */
function fiveRounds(): readonly PlacedItem[] {
  return roundsAt([-6, -3, 0, 3, 6]);
}

/** Rounds of 10 at these points along the hall's middle, named Table 1 onwards. */
function roundsAt(xs: readonly number[]): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return xs.flatMap((x, i) => stampSetup(params, { x, z: 0 }, 0)
    .map((piece, p) => (p === 0 ? { ...piece, label: `Table ${String(i + 1)}` } : piece)));
}
