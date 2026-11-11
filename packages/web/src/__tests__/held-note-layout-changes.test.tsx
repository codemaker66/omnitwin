import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as configApi from "../api/configurations.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../api/configurations.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests } from "../components/editor/EditorBridge.js";
import { GRAND_HALL_RENDER_DIMENSIONS, toRealWorld } from "../constants/scale.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { plannerChairSlug } from "../lib/furniture-defaults.js";
import type { PlacedItem } from "../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../lib/planner-features.js";
import { changeSeatsAtSelectedTables, removeSelection, replaceSelection } from "../lib/planner-keymap.js";
import { cardParamsFor } from "../lib/setup-cards.js";
import { createTableGroup } from "../lib/table-group.js";
import { useEditorStore } from "../stores/editor-store.js";
import { usePlacementNoticeStore } from "../stores/placement-notice-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { useSelectionStore } from "../stores/selection-store.js";

// ---------------------------------------------------------------------------
// A piece holding a note this browser is not shown, and the changes that would
// take it away (review of #388).
//
// A guest plan's notes go only to the browser that made the plan. Any other
// browser is told which pieces hold one (the mark, noteHeld) and nothing of
// what it says. A piece left out of a save is removed with its note, so a
// change that drops such a piece destroys words the person never saw. Replace
// and the fills did exactly that: they read the piece's working note, which is
// empty for a note that is held.
//
// The rule these hold: a piece holding a held note leaves the floor only when
// the person removes that piece themselves. The real commands run, through the
// real stores and the scene bridge; only the network is replaced.
// ---------------------------------------------------------------------------

vi.mock("../api/configurations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/configurations.js")>();
  return {
    ...actual,
    getConfig: vi.fn(),
    getPublicConfig: vi.fn(),
    createPublicConfig: vi.fn(),
    authBatchSave: vi.fn(),
    publicBatchSave: vi.fn(),
  };
});

vi.mock("../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

vi.mock("../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const PLAN = "0f0f0f0f-0000-4000-8000-0000000000a1";
const SPACE = "0f0f0f0f-0000-4000-8000-00000000005a";
const VENUE = "0f0f0f0f-0000-4000-8000-0000000000fe";
const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";
const ALLERGY = "TEST ONLY nut allergy, seat by the door";

/** How the plan was read: by a browser the notes are kept from, by the one that made it, or from the API live today. */
type Read = "without its notes" | "with its notes" | "by today's API";

interface Round {
  /** The table's row id. */
  readonly table: string;
  /** Its chairs' row ids, in the order the table rings them. */
  readonly chairs: readonly string[];
  readonly pieces: readonly PlacedItem[];
}

/** Rounds of ten in a row across the hall, as the server holds them: named Table 1 up, every piece with a row id. */
function rounds(count: number): readonly Round[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1);
    const pieces = createTableGroup(ROUND, (i - (count - 1) / 2) * 3.2, 0, 0, 10).map((piece, p): PlacedItem => ({
      ...piece,
      id: `0a0a0a0${n}-0000-4000-8000-${String(p).padStart(12, "0")}`,
      groupId: `0b0b0b0${n}-0000-4000-8000-000000000000`,
      ...(p === 0 ? { label: `Table ${n}` } : {}),
    }));
    const [table, ...chairs] = pieces;
    if (table === undefined) throw new Error("no table");
    return { table: table.id, chairs: chairs.map((chair) => chair.id), pieces };
  });
}

/** A piece as the API returns it. */
function wire(piece: PlacedItem, metadata: ObjectMetadata): PlacedObject {
  const label = (piece.label ?? "").trim();
  return {
    id: piece.id, configurationId: PLAN, assetDefinitionId: piece.catalogueItemId,
    positionX: String(toRealWorld(piece.x)), positionY: String(piece.y), positionZ: String(toRealWorld(piece.z)),
    rotationX: "0", rotationY: String(piece.rotationY), rotationZ: "0", scale: "1", sortOrder: 0,
    metadata: { clothed: piece.clothed, clothStyle: piece.clothStyle, groupId: piece.groupId, ...(label === "" ? {} : { displayLabel: label }), ...metadata },
  };
}

/**
 * Opens the plan through the real load. `noted` are the pieces that hold a
 * note: a read without the notes marks each as holding one, a read with them
 * (and today's API, which keeps nothing back) returns the note itself.
 */
async function open(floor: readonly Round[], noted: readonly string[], read: Read): Promise<void> {
  const says: ObjectMetadata = read === "without its notes" ? { noteHeld: true } : { notes: ALLERGY };
  const plan: Configuration = {
    id: PLAN, spaceId: SPACE, venueId: VENUE, userId: null, name: "TEST ONLY plan", isPublicPreview: true, revision: 4,
    objects: floor.flatMap((round) => round.pieces).map((piece) => wire(piece, noted.includes(piece.id) ? says : {})),
    ...(read === "by today's API" ? {} : { notesIncluded: read === "with its notes" }),
  };
  vi.mocked(configApi.getPublicConfig).mockResolvedValue(plan);
  await act(async () => { await useEditorStore.getState().loadConfiguration(PLAN, false); });
  expect(useEditorStore.getState().error).toBeNull();
  expect(placedIds()).toEqual(floor.flatMap((round) => round.pieces).map((piece) => piece.id));
}

function placedIds(): readonly string[] {
  return usePlacementStore.getState().placedItems.map((piece) => piece.id);
}

function placedAt(id: string): { readonly x: number; readonly z: number } | undefined {
  const piece = usePlacementStore.getState().placedItems.find((candidate) => candidate.id === id);
  return piece === undefined ? undefined : { x: piece.x, z: piece.z };
}

/** The names of the tables on the floor, in order. */
function tableNames(): readonly string[] {
  return usePlacementStore.getState().placedItems.map((piece) => piece.label ?? "").filter((name) => name !== "").sort();
}

function notice(): string | null {
  return usePlacementNoticeStore.getState().notice?.text ?? null;
}

function steps(): number {
  return useEditorStore.getState().history.past.length;
}

/** Saves, the server echoing what it was sent, and returns the batch that went. */
async function savedBatch(): Promise<readonly BatchObjectInput[]> {
  vi.mocked(configApi.publicBatchSave).mockImplementationOnce((_id, batch) => Promise.resolve({
    revision: 5,
    objects: batch.map((piece, index): PlacedObject => ({
      id: piece.id ?? `0c0c0c0c-0000-4000-8000-${String(index).padStart(12, "0")}`,
      configurationId: PLAN, assetDefinitionId: piece.assetDefinitionId,
      positionX: String(piece.positionX), positionY: String(piece.positionY), positionZ: String(piece.positionZ),
      rotationX: String(piece.rotationX), rotationY: String(piece.rotationY), rotationZ: String(piece.rotationZ),
      scale: String(piece.scale), sortOrder: piece.sortOrder, metadata: piece.metadata ?? null,
    })),
  }));
  let saved = false;
  await act(async () => { saved = await useEditorStore.getState().saveToServer(false); });
  expect(saved).toBe(true);
  const call = vi.mocked(configApi.publicBatchSave).mock.calls.at(-1);
  if (call === undefined) throw new Error("no save was sent");
  return call[1];
}

function card(name: "round" | "long-table", request: Parameters<typeof cardParamsFor>[1] = {}): NonNullable<ReturnType<typeof cardParamsFor>> {
  const params = cardParamsFor(name, request);
  if (params === null) throw new Error(`no ${name} card`);
  return params;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  usePlacementNoticeStore.getState().dismiss();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  __resetEditorBridgeMountCountForTests();
  setPlannerFeaturesForTesting({ tableSets: true });
  render(<EditorBridge />);
});

afterEach(() => {
  cleanup();
  setPlannerFeaturesForTesting(null);
});

describe("Replace, on a selection with a piece that holds a note this browser is not shown", () => {
  it("replaces nothing, says which piece, and leaves the plan as it was", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open(floor, [first.table], "without its notes");
    const before = placedIds();
    const stepsBefore = steps();

    useSelectionStore.getState().selectMultiple([first.table, second.table]);
    let result: ReturnType<typeof replaceSelection> | null = null;
    act(() => { result = replaceSelection(card("long-table")); });
    const refused = result as ReturnType<typeof replaceSelection> | null;

    expect(refused?.ok).toBe(false);
    expect(refused !== null && !refused.ok ? refused.reason : null).toBe("Nothing was replaced: Table 1 has a note that cannot be shown here.");
    expect(notice()).toBe("Nothing was replaced: Table 1 has a note that cannot be shown here.");
    expect(placedIds()).toEqual(before);
    expect(useEditorStore.getState().objects.map((object) => object.id)).toEqual(before);
    expect(steps()).toBe(stepsBefore);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("refuses a swap in place too, and for a held note on one of the table's chairs", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const chair = second?.chairs[3];
    if (first === undefined || second === undefined || chair === undefined) throw new Error("no rounds");
    await open(floor, [first.table, chair], "without its notes");
    const before = placedIds();

    // The same round, set for eight: the table would keep its id.
    useSelectionStore.getState().selectMultiple([first.table]);
    let swap: ReturnType<typeof replaceSelection> | null = null;
    act(() => { swap = replaceSelection(card("round", { seats: 8 })); });
    expect((swap as ReturnType<typeof replaceSelection> | null)?.ok).toBe(false);
    expect(notice()).toBe("Nothing was replaced: Table 1 has a note that cannot be shown here.");

    // Table 2 itself holds none; one of its chairs does, and would go with it.
    useSelectionStore.getState().selectMultiple([second.table]);
    let long: ReturnType<typeof replaceSelection> | null = null;
    act(() => { long = replaceSelection(card("long-table")); });
    expect((long as ReturnType<typeof replaceSelection> | null)?.ok).toBe(false);
    expect(notice()).toMatch(/^Nothing was replaced: .+ has a note that cannot be shown here\.$/u);
    expect(placedIds()).toEqual(before);
  });

  it.each<Read>(["with its notes", "by today's API"])("replaces as it always did in a plan read %s, carrying the note it can see", async (read) => {
    const floor = rounds(2);
    const [first, second] = floor;
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open(floor, [first.table], read);

    useSelectionStore.getState().selectMultiple([first.table, second.table]);
    let result: ReturnType<typeof replaceSelection> | null = null;
    act(() => { result = replaceSelection(card("long-table")); });

    expect((result as ReturnType<typeof replaceSelection> | null)?.ok).toBe(true);
    expect(placedIds()).not.toContain(first.table);
    expect(useEditorStore.getState().objects.map((object) => object.notes).filter((note) => note !== "")).toEqual([`Table 1: ${ALLERGY}`]);
  });
});

describe("Fill over the layout, with a round that holds a note this browser is not shown", () => {
  beforeEach(() => { setPlannerFeaturesForTesting({ fillKeepOuts: true }); });

  it("leaves that round and its chairs exactly where they stand, and lays the others round it", async () => {
    const floor = rounds(5);
    const held = floor[4];
    if (held === undefined) throw new Error("no rounds");
    // Table 5 is the last a smaller fill would keep: twenty guests take two tables.
    await open(floor, [held.table], "without its notes");
    const stood = held.pieces.map((piece) => ({ id: piece.id, at: placedAt(piece.id) }));

    let plan: ReturnType<ReturnType<typeof usePlacementStore.getState>["autoArrangeBanquet"]> = null;
    act(() => { plan = usePlacementStore.getState().autoArrangeBanquet(ROUND, 20, 10); });

    expect(plan).not.toBeNull();
    expect(placedIds()).toEqual(expect.arrayContaining(held.pieces.map((piece) => piece.id)));
    expect(held.pieces.map((piece) => ({ id: piece.id, at: placedAt(piece.id) }))).toEqual(stood);
    // The fill still did its work on the rounds that were its to set.
    expect(tableNames()).toEqual(["Table 1", "Table 2", "Table 5"]);

    // What is saved keeps the piece, and sends it as a browser sends a piece
    // whose note it never saw: no note and no name for one, which the API
    // (#389, settledNotes) answers by keeping the note it holds.
    const batch = await savedBatch();
    const sent = batch.find((piece) => piece.id === held.table);
    expect(sent).toBeDefined();
    expect(sent?.metadata?.notes).toBeUndefined();
    expect(sent?.replacesNote).toBeUndefined();
  });

  it("keeps it through Undo and Redo of that fill", async () => {
    const floor = rounds(5);
    const held = floor[4];
    if (held === undefined) throw new Error("no rounds");
    await open(floor, [held.table], "without its notes");
    const heldIds = held.pieces.map((piece) => piece.id);

    act(() => { usePlacementStore.getState().autoArrangeBanquet(ROUND, 20, 10); });
    // Undo returns a piece that was taken away as a new piece (lib/editor-history
    // heals its id), which is why a held note could never come back with one:
    // the round is still the server's own row only because the fill left it.
    act(() => { useEditorStore.getState().undo(); });
    expect(tableNames()).toEqual(["Table 1", "Table 2", "Table 3", "Table 4", "Table 5"]);
    expect(placedIds()).toEqual(expect.arrayContaining(heldIds));
    act(() => { useEditorStore.getState().redo(); });
    expect(tableNames()).toEqual(["Table 1", "Table 2", "Table 5"]);
    expect(placedIds()).toEqual(expect.arrayContaining(heldIds));
  });

  it("keeps the whole round for a held note on one of its chairs", async () => {
    const floor = rounds(5);
    const held = floor[4];
    const chair = held?.chairs[9];
    if (held === undefined || chair === undefined) throw new Error("no rounds");
    await open(floor, [chair], "without its notes");

    act(() => { usePlacementStore.getState().autoArrangeBanquet(ROUND, 20, 10); });

    expect(placedIds()).toEqual(expect.arrayContaining(held.pieces.map((piece) => piece.id)));
  });
});

describe("a fill that replaces the whole floor, with a piece that holds a note this browser is not shown", () => {
  it("fills nothing with banquet rounds, and says which piece", async () => {
    const floor = rounds(2);
    const held = floor[1];
    if (held === undefined) throw new Error("no rounds");
    await open(floor, [held.table], "without its notes");
    const before = placedIds();

    let plan: ReturnType<ReturnType<typeof usePlacementStore.getState>["autoArrangeBanquet"]> = null;
    act(() => { plan = usePlacementStore.getState().autoArrangeBanquet(ROUND, 60, 10); });

    expect(plan).toBeNull();
    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was filled: Table 2 has a note that cannot be shown here.");
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("fills nothing with theatre rows, and says which piece", async () => {
    const floor = rounds(2);
    const held = floor[1];
    const chair = getCatalogueItemBySlug(plannerChairSlug());
    if (held === undefined || chair === undefined) throw new Error("no rounds");
    await open(floor, [held.table], "without its notes");
    const before = placedIds();

    let plan: ReturnType<ReturnType<typeof usePlacementStore.getState>["autoArrangeTheatre"]> = null;
    act(() => { plan = usePlacementStore.getState().autoArrangeTheatre(chair.id, 60); });

    expect(plan).toBeNull();
    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was filled: Table 2 has a note that cannot be shown here.");
  });

  it.each<Read>(["with its notes", "by today's API"])("fills as it always did in a plan read %s", async (read) => {
    const floor = rounds(2);
    const noted = floor[1];
    if (noted === undefined) throw new Error("no rounds");
    await open(floor, [noted.table], read);

    let plan: ReturnType<ReturnType<typeof usePlacementStore.getState>["autoArrangeBanquet"]> = null;
    act(() => { plan = usePlacementStore.getState().autoArrangeBanquet(ROUND, 60, 10); });

    expect(plan).not.toBeNull();
    expect(placedIds()).not.toContain(noted.table);
  });
});

describe("a seat taken from a table, when the chair that would go holds a note this browser is not shown", () => {
  it("takes no chair away, and says why", async () => {
    const floor = rounds(1);
    const [round] = floor;
    const last = round?.chairs[9];
    if (round === undefined || last === undefined) throw new Error("no round");
    await open(floor, [last], "without its notes");
    const before = placedIds();

    useSelectionStore.getState().selectMultiple([round.table]);
    act(() => { changeSeatsAtSelectedTables(-1); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("This piece has a note that cannot be shown or changed here.");
  });
});

describe("removing the piece itself", () => {
  it("still takes it, as it does for anyone who holds the plan's link", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open(floor, [first.table], "without its notes");

    useSelectionStore.getState().selectMultiple([first.table]);
    act(() => { removeSelection(); });

    expect(placedIds()).toEqual(second.pieces.map((piece) => piece.id));
  });
});
