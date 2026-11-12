import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as configApi from "../api/configurations.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../api/configurations.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests } from "../components/editor/EditorBridge.js";
import { PlannerCommandDeck } from "../components/editor/PlannerCommandDeck.js";
import { VerticalToolbox } from "../components/editor/VerticalToolbox.js";
import { SelectedFurnitureInspector } from "../components/editor/cockpit/SelectedFurnitureInspector.js";
import { GRAND_HALL_RENDER_DIMENSIONS, toRealWorld } from "../constants/scale.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { plannerChairSlug } from "../lib/furniture-defaults.js";
import type { PlacedItem } from "../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../lib/planner-features.js";
import { changeSeatsAtSelectedTables, removeSelection, replaceSelection, selectionKeyBindings } from "../lib/planner-keymap.js";
import { registerKeyBindings } from "../lib/planner-keys.js";
import { cardParamsFor, stampSetup } from "../lib/setup-cards.js";
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
// The rule these hold: someone who cannot see a note never destroys it. In a
// browser the notes are kept from, a piece holding one does not leave the
// floor, whatever was asked for. The real commands run, through the real
// stores and the scene bridge; only the network is replaced.
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

/** A dance floor of five panels by five, as the server holds it. */
function danceFloor(): Round {
  const params = cardParamsFor("dance-floor", { cols: 5, rows: 5 });
  if (params === null) throw new Error("no dance floor card");
  const pieces = stampSetup(params, { x: 0, z: 0 }, 0).map((piece, p): PlacedItem => ({
    ...piece,
    id: `0d0d0d0d-0000-4000-8000-${String(p).padStart(12, "0")}`,
    groupId: "0e0e0e0e-0000-4000-8000-000000000000",
  }));
  const [first, ...rest] = pieces;
  if (first === undefined) throw new Error("no panels");
  return { table: first.id, chairs: rest.map((panel) => panel.id), pieces };
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
async function open(floor: readonly Round[], noted: readonly string[], read: Read, guestPlan = true): Promise<void> {
  const says: ObjectMetadata = read === "without its notes" ? { noteHeld: true } : { notes: ALLERGY };
  const plan: Configuration = {
    id: PLAN, spaceId: SPACE, venueId: VENUE, userId: null, name: "TEST ONLY plan", isPublicPreview: guestPlan, revision: 4,
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

/**
 * Saves, the server echoing what it was sent, and returns the batch that went.
 * `held` are the rows that hold a note this browser is not shown: the answer
 * marks them again, as the API's does.
 */
async function savedBatch(held: ReadonlySet<string> = new Set<string>()): Promise<readonly BatchObjectInput[]> {
  const revision = (useEditorStore.getState().configRevision ?? 4) + 1;
  vi.mocked(configApi.publicBatchSave).mockImplementationOnce((_id, batch) => Promise.resolve({
    revision,
    objects: batch.map((piece, index): PlacedObject => ({
      id: piece.id ?? `0c0c0c0c-0000-4000-8000-${String(revision).padStart(6, "0")}${String(index).padStart(6, "0")}`,
      configurationId: PLAN, assetDefinitionId: piece.assetDefinitionId,
      positionX: String(piece.positionX), positionY: String(piece.positionY), positionZ: String(piece.positionZ),
      rotationX: String(piece.rotationX), rotationY: String(piece.rotationY), rotationZ: String(piece.rotationZ),
      scale: String(piece.scale), sortOrder: piece.sortOrder,
      metadata: piece.id !== undefined && held.has(piece.id) ? { ...piece.metadata, noteHeld: true } : piece.metadata ?? null,
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
    expect(notice()).toBe("Nothing was replaced: a chair at Table 2 has a note that cannot be shown here.");
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
    expect(notice()).toBe("No seat was removed: a chair at Table 1 has a note that cannot be shown here.");
  });

  /** The chairs standing round a round's table now. */
  function chairsAt(round: Round): number {
    const group = round.pieces[0]?.groupId ?? null;
    return usePlacementStore.getState().placedItems.filter((piece) => piece.groupId === group && piece.id !== round.table).length;
  }

  it("takes a seat from the other selected tables, and says which kept its seat, not that none was removed (D2)", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const last = first?.chairs[9];
    if (first === undefined || second === undefined || last === undefined) throw new Error("no rounds");
    await open(floor, [last], "without its notes");
    const stepsBefore = steps();

    useSelectionStore.getState().selectMultiple([first.table, second.table]);
    act(() => { changeSeatsAtSelectedTables(-1); });

    expect(chairsAt(first)).toBe(10);
    expect(placedIds()).toContain(last);
    expect(chairsAt(second)).toBe(9);
    expect(notice()).toBe("A chair at Table 1 stayed where it is, because it has a note that cannot be shown here.");
    // One change, one undo step, which gives Table 2 its seat back.
    expect(steps()).toBe(stepsBefore + 1);
    act(() => { useEditorStore.getState().undo(); });
    expect(chairsAt(second)).toBe(10);
  });

  it("names every table that kept its seat in one sentence when none lost one", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const firstLast = first?.chairs[9];
    const secondLast = second?.chairs[9];
    if (first === undefined || second === undefined || firstLast === undefined || secondLast === undefined) throw new Error("no rounds");
    await open(floor, [firstLast, secondLast], "without its notes");
    const before = placedIds();

    useSelectionStore.getState().selectMultiple([first.table, second.table]);
    act(() => { changeSeatsAtSelectedTables(-1); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("A chair at Tables 1 and 2 stayed where they are, because each has a note that cannot be shown here.");
  });
});

describe("a dance floor made smaller, when a panel that would go holds a note this browser is not shown", () => {
  it("is not resized, and says why", async () => {
    const floor = danceFloor();
    await open([floor], floor.pieces.map((piece) => piece.id), "without its notes");
    const before = placedIds();
    const groupId = floor.pieces[0]?.groupId ?? "";

    let resized = true;
    act(() => { resized = usePlacementStore.getState().resizeArea(groupId, 3, 3); });

    expect(resized).toBe(false);
    expect(placedIds()).toEqual(before);
    expect(notice()).toMatch(/^The dance floor was not resized: .+ has a note that cannot be shown here\.$/u);
  });
});

describe("clearing the floor, when a piece on it holds a note this browser is not shown", () => {
  it("clears nothing, and says which piece", async () => {
    const floor = rounds(2);
    const held = floor[1];
    if (held === undefined) throw new Error("no rounds");
    await open(floor, [held.table], "without its notes");
    const before = placedIds();

    act(() => { usePlacementStore.getState().clearAll(); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was cleared: Table 2 has a note that cannot be shown here.");
  });
});

// ---------------------------------------------------------------------------
// Removing the piece itself. Someone who cannot see a note never destroys it
// (the release lead, 11 November 2026): not by Replace or a fill, and not by
// asking for the piece to go. Each way a person removes pieces today runs
// here as they use it: the key, and the three buttons on screen. (The
// catalogue drawer's bin calls the same store action; nothing mounts it.)
// ---------------------------------------------------------------------------

interface WayToRemove {
  readonly name: string;
  /** Puts the control on screen, or the key in the keymap. */
  readonly mount: () => void;
  readonly use: () => void;
}

const keymapCleanups: (() => void)[] = [];

const WAYS_TO_REMOVE: readonly WayToRemove[] = [
  {
    name: "the Delete key",
    mount: () => {
      keymapCleanups.push(registerKeyBindings(selectionKeyBindings({
        invalidate: () => undefined, cancelGesture: () => undefined, screenUp: () => ({ x: 0, z: -1 }),
      })));
    },
    use: () => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", key: "Delete", bubbles: true, cancelable: true })); },
  },
  {
    name: "the command deck's Delete",
    mount: () => { render(<PlannerCommandDeck />); },
    use: () => { fireEvent.click(screen.getByTestId("planner-command-action-delete")); },
  },
  {
    name: "the toolbox's Delete",
    mount: () => { render(<MemoryRouter><VerticalToolbox /></MemoryRouter>); },
    use: () => { fireEvent.click(screen.getByRole("button", { name: /^Delete/u })); },
  },
  {
    name: "the inspector's Remove",
    mount: () => { render(<SelectedFurnitureInspector />); },
    use: () => { fireEvent.click(screen.getByRole("button", { name: /^Remove /u })); },
  },
];

describe.each(WAYS_TO_REMOVE)("removing with $name", (way) => {
  afterEach(() => {
    while (keymapCleanups.length > 0) keymapCleanups.pop()?.();
  });

  /** Selects, puts the control on screen and uses it. */
  function remove(ids: readonly string[]): void {
    act(() => { useSelectionStore.getState().selectMultiple(ids); });
    act(() => { way.mount(); });
    act(() => { way.use(); });
  }

  it("removes nothing when the piece holds a note this browser is not shown, and says which", async () => {
    const floor = rounds(2);
    const [first] = floor;
    if (first === undefined) throw new Error("no rounds");
    await open(floor, [first.table], "without its notes");
    const before = placedIds();
    const stepsBefore = steps();

    remove([first.table]);

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was removed: Table 1 has a note that cannot be shown here.");
    // Nothing was written, so there is nothing for Undo to take back.
    expect(steps()).toBe(stepsBefore);
    expect(useEditorStore.getState().isDirty).toBe(false);
    act(() => { useEditorStore.getState().undo(); });
    expect(placedIds()).toEqual(before);
  });

  it("keeps that piece, with its chairs, and removes the others selected with it", async () => {
    const floor = rounds(3);
    const [first, second, third] = floor;
    if (first === undefined || second === undefined || third === undefined) throw new Error("no rounds");
    await open(floor, [second.table], "without its notes");
    const stepsBefore = steps();

    remove([first.table, second.table, third.table]);

    expect(placedIds()).toEqual(second.pieces.map((piece) => piece.id));
    expect(notice()).toBe("Table 2 stayed where it is, because it has a note that cannot be shown here.");
    expect(steps()).toBe(stepsBefore + 1);

    // What the server acts on is the batch, not the scene (it removes every row a batch leaves out): Table 2 and
    // its chairs go as their own rows, and say nothing of a note, which keeps the one the table holds.
    const rows = second.pieces.map((piece) => piece.id);
    const says = (batch: readonly BatchObjectInput[]): boolean => batch.some((piece) => piece.metadata?.notes !== undefined || piece.replacesNote !== undefined);
    const afterRemoval = await savedBatch(new Set([second.table]));
    expect(afterRemoval.map((piece) => piece.id)).toEqual(rows);
    expect(says(afterRemoval)).toBe(false);

    // One Undo brings the two that went back; Redo takes them again. Table 2 is the server's own row throughout.
    act(() => { useEditorStore.getState().undo(); });
    expect(tableNames()).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(placedIds()).toEqual(expect.arrayContaining(rows));
    act(() => { useEditorStore.getState().redo(); });
    expect(tableNames()).toEqual(["Table 2"]);
    expect(placedIds()).toEqual(rows);
    const afterRedo = await savedBatch(new Set([second.table]));
    expect(afterRedo.map((piece) => piece.id)).toEqual(rows);
    expect(says(afterRedo)).toBe(false);
  });

  it.each<Read>(["with its notes", "by today's API"])("removes the piece as it always did in a plan read %s", async (read) => {
    const floor = rounds(2);
    const [first, second] = floor;
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open(floor, [first.table], read);

    remove([first.table]);

    expect(placedIds()).toEqual(second.pieces.map((piece) => piece.id));
    expect(notice()).toBeNull();
    act(() => { useEditorStore.getState().undo(); });
    expect(tableNames()).toEqual(["Table 1", "Table 2"]);
  });
});

describe("removing pieces, several of which hold a note this browser is not shown", () => {
  it("says which stayed in one sentence, and removes the rest", async () => {
    const floor = rounds(4);
    const [first, second, third, fourth] = floor;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) throw new Error("no rounds");
    await open(floor, [first.table, third.table], "without its notes");

    useSelectionStore.getState().selectMultiple(floor.map((round) => round.table));
    act(() => { removeSelection(); });

    expect(tableNames()).toEqual(["Table 1", "Table 3"]);
    expect(notice()).toBe("Tables 1 and 3 stayed where they are, because each has a note that cannot be shown here.");
  });

  it("lists three or more by their numbers, and removes nothing when every one of them holds a note", async () => {
    const floor = rounds(3);
    await open(floor, floor.map((round) => round.table), "without its notes");
    const before = placedIds();
    const stepsBefore = steps();

    useSelectionStore.getState().selectMultiple(floor.map((round) => round.table));
    act(() => { removeSelection(); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Tables 1, 2 and 3 stayed where they are, because each has a note that cannot be shown here.");
    expect(steps()).toBe(stepsBefore);
  });

  it("keeps a table whose chair holds the note, and says the chair is at that table", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const chair = first?.chairs[4];
    if (first === undefined || second === undefined || chair === undefined) throw new Error("no rounds");
    await open(floor, [chair], "without its notes");
    const before = placedIds();

    useSelectionStore.getState().selectMultiple([first.table]);
    act(() => { removeSelection(); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was removed: a chair at Table 1 has a note that cannot be shown here.");
  });

  it("finds a held chair by the nearest table of an old group that holds several", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const chair = second?.chairs[4];
    if (first === undefined || second === undefined || chair === undefined) throw new Error("no rounds");
    // Both rounds in one group, as old plans grouped them: the chair stands at Table 2.
    const oldGroup = first.pieces[0]?.groupId ?? null;
    const together = floor.map((round): Round => ({ ...round, pieces: round.pieces.map((piece) => ({ ...piece, groupId: oldGroup })) }));
    await open(together, [chair], "without its notes");
    const before = placedIds();

    useSelectionStore.getState().selectMultiple([first.table]);
    act(() => { removeSelection(); });

    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was removed: a chair at Table 2 has a note that cannot be shown here.");
  });

  it("keeps the held ones, with their chairs, when everything is selected with Ctrl A and then deleted", async () => {
    setPlannerFeaturesForTesting({ tableSets: true, editingKeys: true });
    const floor = rounds(4);
    const [, second, , fourth] = floor;
    const chair = fourth?.chairs[2];
    if (second === undefined || fourth === undefined || chair === undefined) throw new Error("no rounds");
    // Table 2 holds a note on the table, Table 4 on one of its chairs; Tables 1 and 3 hold none.
    await open(floor, [second.table, chair], "without its notes");
    const unbind = registerKeyBindings(selectionKeyBindings({
      invalidate: () => undefined, cancelGesture: () => undefined, screenUp: () => ({ x: 0, z: -1 }),
    }));
    try {
      act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", key: "a", ctrlKey: true, bubbles: true, cancelable: true })); });
      expect(useSelectionStore.getState().selectedIds.size).toBeGreaterThan(0);
      act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", key: "Delete", bubbles: true, cancelable: true })); });
    } finally {
      unbind();
    }

    expect(placedIds()).toEqual([...second.pieces, ...fourth.pieces].map((piece) => piece.id));
    expect(notice()).toBe("Table 2 and a chair at Table 4 stayed where they are, because each has a note that cannot be shown here.");
  });

  // Delta review of #388, D7, as ruled on 12 November. Between "Keep mine" and the save that confirms it, a note of the
  // person's own is carried with its mark: the piece is kept, but they can read the note, so it is not one that "cannot be shown".
  it("says a note of the person's own that no save has confirmed yet is still being saved, for one piece and for several", async () => {
    const floor = rounds(3);
    const [first, second, third] = floor;
    if (first === undefined || second === undefined || third === undefined) throw new Error("no rounds");
    await open(floor, [], "without its notes");
    const before = placedIds();
    // The document as Keep mine leaves it until its save lands: their notes on Tables 1 and 3, carried, each with its mark.
    const theirs = new Set([first.table, third.table]);
    act(() => {
      useEditorStore.setState((state) => ({
        baseObjects: state.baseObjects.map((object) => (theirs.has(object.id) ? { ...object, notes: "TEST ONLY by the window", noteHeld: true } : object)),
        objects: state.objects.map((object) => (theirs.has(object.id) ? { ...object, notes: "TEST ONLY by the window" } : object)),
      }));
    });

    useSelectionStore.getState().selectMultiple([first.table]);
    act(() => { removeSelection(); });
    expect(notice()).toBe("Nothing was removed: the note on Table 1 is still being saved. Try again once it has saved.");
    expect(placedIds()).toEqual(before);

    useSelectionStore.getState().selectMultiple([first.table, third.table]);
    act(() => { removeSelection(); });
    expect(notice()).toBe("Nothing was removed: the notes on Tables 1 and 3 are still being saved. Try again once they have saved.");
    expect(placedIds()).toEqual(before);

    // With a piece that can go, it goes, and the one that stays is said in the sentence ruled for that.
    useSelectionStore.getState().selectMultiple([first.table, second.table]);
    act(() => { removeSelection(); });
    expect(notice()).toBe("Table 1 stayed where it is, because it has a note that cannot be shown here.");
    expect(tableNames()).toEqual(["Table 1", "Table 3"]);
  });

  it("removes a marked piece as ever from a layout that is not a guest plan, where the mark means nothing", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open(floor, [first.table], "without its notes", false);

    useSelectionStore.getState().selectMultiple([first.table]);
    act(() => { removeSelection(); });

    expect(placedIds()).toEqual(second.pieces.map((piece) => piece.id));
    expect(notice()).toBeNull();
  });

  it("removes one piece by its id only when it holds no such note", async () => {
    const floor = rounds(2);
    const [first, second] = floor;
    const chair = second?.chairs[0];
    if (first === undefined || second === undefined || chair === undefined) throw new Error("no rounds");
    await open(floor, [first.table], "without its notes");
    const before = placedIds();

    act(() => { usePlacementStore.getState().removeItem(first.table); });
    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was removed: Table 1 has a note that cannot be shown here.");

    // Nor a chair of that table: a group holding such a piece stays whole.
    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    act(() => { usePlacementStore.getState().removeItem(first.chairs[0] ?? "no chair"); });
    expect(placedIds()).toEqual(before);
    expect(notice()).toBe("Nothing was removed: Table 1 has a note that cannot be shown here.");

    act(() => { usePlacementStore.getState().removeItem(chair); });
    expect(placedIds()).toEqual(before.filter((id) => id !== chair));
  });
});
