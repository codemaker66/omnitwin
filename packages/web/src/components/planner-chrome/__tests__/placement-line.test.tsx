import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../../api/configurations.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../../../api/configurations.js";
import { GRAND_HALL_RENDER_DIMENSIONS, toRealWorld } from "../../../constants/scale.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { PLANNER_CHROME_STORAGE_KEY } from "../../../lib/planner-chrome-flag.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { replaceSelection } from "../../../lib/planner-edit-commands.js";
import { cardParamsFor } from "../../../lib/setup-cards.js";
import { createTableGroup } from "../../../lib/table-group.js";
import { EditorPage } from "../../../pages/EditorPage.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { __resetEditorBridgeMountCountForTests } from "../../editor/EditorBridge.js";
import { RECEIPT_MS } from "../Receipt.js";

// ---------------------------------------------------------------------------
// The engine's line in the new chrome (ruling C2 on #388, 12 November 2026,
// revised by the release lead's ruling on #388's merge with master, 22
// November 2026). The planner says why a change did not happen, or what
// stayed, in one line from the placement-notice store: "Nothing was undone:
// ...", "Nothing was replaced: ...". Today's chrome draws it near the floor
// (PlacementNotice, in the 3D view and the 2D view). The new chrome says it in
// its receipt above the dock (Receipt, #357's B-02), over the door line: one
// line at a time, in a status region that is always there and is the only
// live region that says it, gone after the receipt's time. A sentence that
// names its piece stays when another piece is chosen (accepted on 22 November
// 2026).
//
// The new chrome hosts neither the 3D view of today's chrome nor the 2D view
// (EditorPage gives it no 2D view), each of which mounts its own line: they
// are stood in for here by that line alone, so a second copy of the sentence
// would show. The real page, chrome, stores and commands; the room's 3D scene
// and the network are replaced.
// ---------------------------------------------------------------------------

vi.mock("../../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/configurations.js")>(),
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
}));
vi.mock("../../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));
vi.mock("../../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
vi.mock("../../editor/PlannerScene.js", () => ({ PlannerScene: () => <div data-testid="mock-planner-scene" /> }));
vi.mock("../../../App.js", async () => {
  const { PlacementNotice } = await import("../../editor/PlacementNotice.js");
  return { App: () => <PlacementNotice /> };
});
vi.mock("../../../pages/BlueprintPage.js", async () => {
  const { PlacementNotice } = await import("../../editor/PlacementNotice.js");
  return { BlueprintPage: () => <PlacementNotice /> };
});
vi.mock("../../editor/cockpit/PlannerCockpit.js", () => ({ PlannerCockpit: () => <div data-testid="planner-cockpit" /> }));
vi.mock("../../../hooks/use-media-query.js", () => ({ useIsCoarsePointer: () => false, useIsNarrowViewport: () => false }));
vi.mock("../../../hooks/use-planner-venue-identity.js", () => ({
  usePlannerVenueIdentity: () => ({ name: "Trades Hall", logoUrl: null, loading: false, known: true }),
}));

const PLAN = "0f0f0f0f-0000-4000-8000-0000000000a1";
const SPACE = "0f0f0f0f-0000-4000-8000-00000000005a";
const VENUE = "0f0f0f0f-0000-4000-8000-0000000000fe";
const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";

interface Round {
  readonly table: string;
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

function wire(piece: PlacedItem, metadata: ObjectMetadata): PlacedObject {
  const label = (piece.label ?? "").trim();
  return {
    id: piece.id, configurationId: PLAN, assetDefinitionId: piece.catalogueItemId,
    positionX: String(toRealWorld(piece.x)), positionY: String(piece.y), positionZ: String(toRealWorld(piece.z)),
    rotationX: "0", rotationY: String(piece.rotationY), rotationZ: "0", scale: "1", sortOrder: 0,
    metadata: { clothed: piece.clothed, clothStyle: piece.clothStyle, groupId: piece.groupId, ...(label === "" ? {} : { displayLabel: label }), ...metadata },
  };
}

/** Opens the guest plan as a browser its notes are kept from reads it: `noted` hold one. */
async function open(floor: readonly Round[], noted: readonly string[]): Promise<void> {
  const plan: Configuration = {
    id: PLAN, spaceId: SPACE, venueId: VENUE, userId: null, name: "TEST ONLY plan", isPublicPreview: true, revision: 4,
    objects: floor.flatMap((round) => round.pieces).map((piece) => wire(piece, noted.includes(piece.id) ? { noteHeld: true } : {})),
    notesIncluded: false,
  };
  vi.mocked(configApi.getPublicConfig).mockResolvedValue(plan);
  await act(async () => { await useEditorStore.getState().loadConfiguration(PLAN, false); });
  expect(useEditorStore.getState().error).toBeNull();
}

/** Saves, the server echoing what it was sent; `held` are rows its answer marks as holding a note this browser is not shown. */
async function saved(held: ReadonlySet<string> = new Set<string>()): Promise<void> {
  const revision = (useEditorStore.getState().configRevision ?? 4) + 1;
  vi.mocked(configApi.publicBatchSave).mockImplementationOnce((_id, batch: readonly BatchObjectInput[]) => Promise.resolve({
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
  let landed = false;
  await act(async () => { landed = await useEditorStore.getState().saveToServer(false); });
  expect(landed).toBe(true);
}

// The new chrome is a lazy chunk of EditorPage. Loaded here, before any test,
// a render waits only on React, never on a cold module transform, which under
// load outlasted waitFor's one second (delta review of #388 at 33a8e0ad, T9).
beforeAll(async () => {
  await import("../PlannerChromeV2.js");
});

async function openTheNewChrome(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/plan/${PLAN}?chrome=v2`]}>
      <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => { expect(screen.getByTestId("planner-chrome-v2")).toBeTruthy(); });
  // The chrome came in from its lazy chunk outside act, so its effects (the scene bridge's sync, the
  // receipt's hold on the engine's notices) can still be waiting for the scheduler: a change made now
  // would reach neither. Let them run first.
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

/** The zone above the dock, and the receipt's region in it (always there). */
function receiptRegion(): HTMLElement {
  const zone = document.querySelector<HTMLElement>("[data-pc-zone='above-dock']");
  if (zone === null) throw new Error("no zone above the dock");
  const region = zone.querySelector<HTMLElement>(".pc-receipt-region");
  if (region === null) throw new Error("no receipt region above the dock");
  return region;
}

/** The sentence is said once on the page, as the receipt's line inside that region, and by that region alone. */
function saidOnceInTheReceipt(line: string): void {
  const said = screen.getAllByText(line);
  expect(said).toHaveLength(1);
  const [only] = said;
  expect(only?.closest(".pc-receipt")).not.toBeNull();
  expect(receiptRegion().contains(only ?? null)).toBe(true);
  expect(document.querySelectorAll(".pc-receipt-region")).toHaveLength(1);
  // One live region says it, the one that was there before it: never a second one beside or inside it.
  const voices = [...document.querySelectorAll("[aria-live], [role='status'], [role='alert']")]
    .filter((element) => (element.textContent ?? "").includes(line));
  expect(voices).toEqual([receiptRegion()]);
  // A refusal is the line alone: nothing to take back.
  expect(within(receiptRegion()).queryByRole("button", { name: /^Undo/u })).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v2");
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  usePlacementNoticeStore.getState().dismiss();
  usePlannerChromeStore.getState().clearReceipt();
  useCatalogueStore.setState({ selectedItemId: null });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  __resetEditorBridgeMountCountForTests();
  setPlannerFeaturesForTesting({ tableSets: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setPlannerFeaturesForTesting(null);
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
});

describe("the engine's line in the new chrome, in its receipt (ruling C2 on #388, as revised on 22 November 2026)", () => {
  it("says a refused Undo once, in the receipt above the door line, and keeps it when another piece is chosen, as it names its pieces", async () => {
    const [first, second] = rounds(2);
    const firstChair = first?.chairs[2];
    const secondChair = second?.chairs[5];
    if (first === undefined || second === undefined || firstChair === undefined || secondChair === undefined) throw new Error("no rounds");
    await open([], []);
    await openTheNewChrome();

    // The region is there before any line, and quiet; it stands over the door line's.
    const region = receiptRegion();
    expect({ role: region.getAttribute("role"), words: region.textContent }).toEqual({ role: "status", words: "" });
    const doorRegion = screen.getByTestId("door-clear-notice-region");
    expect(region.compareDocumentPosition(doorRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Both rounds placed in one step and saved; the maker then writes a note on a chair at each.
    act(() => { usePlacementStore.getState().placeSetup([...first.pieces, ...second.pieces]); });
    await saved();
    await saved(new Set([firstChair, secondChair]));

    act(() => { useEditorStore.getState().undo(); });
    const line = "Nothing was undone: a chair at Table 1 and a chair at Table 2 have notes that cannot be shown here.";
    saidOnceInTheReceipt(line);

    // Choosing a piece to place does not take it away: the line says which pieces it is about.
    act(() => { useCatalogueStore.getState().selectItem(ROUND); });
    saidOnceInTheReceipt(line);
    expect(receiptRegion()).toBe(region);
  });

  it("says a refused Replace the same way, one line at a time, and the line goes after the receipt's time", async () => {
    const [first, second] = rounds(2);
    if (first === undefined || second === undefined) throw new Error("no rounds");
    await open([first, second], [first.table]);
    await openTheNewChrome();
    const card = cardParamsFor("long-table", {});
    if (card === null) throw new Error("no long table card");

    vi.useFakeTimers();
    act(() => { usePlacementNoticeStore.getState().post("TEST ONLY an earlier line"); });
    act(() => { useSelectionStore.getState().selectMultiple([first.table, second.table]); });
    act(() => { replaceSelection(card); });
    const line = "Nothing was replaced: Table 1 has a note that cannot be shown here.";
    saidOnceInTheReceipt(line);
    // One line at a time: the new one replaced the last.
    expect(screen.queryByText("TEST ONLY an earlier line")).toBeNull();

    act(() => { vi.advanceTimersByTime(RECEIPT_MS); });
    expect(screen.queryByText(line)).toBeNull();
    expect(receiptRegion().textContent).toBe("");
  });

  it("gives one notice one announcement and one visible line, in the region that was already there", async () => {
    const [first] = rounds(1);
    if (first === undefined) throw new Error("no rounds");
    await open([first], [first.table]);
    await openTheNewChrome();
    const region = receiptRegion();
    const receipts: string[] = [];
    const stopCounting = usePlannerChromeStore.subscribe((state, previous) => {
      if (state.receipt !== null && state.receipt !== previous.receipt) receipts.push(state.receipt.text);
    });

    act(() => { useEditorStore.getState().removeObject(first.table); });
    stopCounting();
    const line = "Nothing was removed: Table 1 has a note that cannot be shown here.";
    saidOnceInTheReceipt(line);
    expect(receiptRegion()).toBe(region);
    // The region's words were set once: one receipt for the one notice.
    expect(receipts).toEqual([line]);
    expect(usePlannerChromeStore.getState().receipt).toMatchObject({ text: line, undo: false });
  });
});
