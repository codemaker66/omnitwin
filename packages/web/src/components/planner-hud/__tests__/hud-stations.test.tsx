import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grandHallExits } from "../../../lib/auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../../lib/door-clear-spaces.js";
import {
  deviceAsksEventKind,
  deviceEventKind,
  openLayoutEventKind,
  rememberDeviceEventKind,
  resetEventKindQuestionForTesting,
  useEventKindQuestion,
  type OpenedLayout,
} from "../../../lib/event-kind-record.js";
import { DEFAULT_PLANNER_ROUND_TABLE_SLUG } from "../../../lib/furniture-defaults.js";
import { doorBlockers } from "../../../lib/keep-doors-clear.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../../lib/placement.js";
import { plannerFeatureEnabled, setPlannerChromeFeatures, setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { cardParamsFor, pieceCardId, stampSetup, type CardId, type CardParamsRequest } from "../../../lib/setup-cards.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import { usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { HUD_SENT_STORAGE_KEY, usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { resetEventAnswerForTesting } from "../event-answer.js";
import { HudFrame } from "../HudFrame.js";
import { HudSheets } from "../HudSheets.js";

// ---------------------------------------------------------------------------
// The HUD over the real stores (the HUD's design note): the top bar's
// steps, the shelf's seat line and status line, the hand, the one primary
// key, the chosen piece's verbs, the sheets and the first screen. Nothing here
// mocks a store; the keys are pressed as a browser sends them, to the one
// listener on the window (lib/planner-keys.ts).
// ---------------------------------------------------------------------------

let sequence = 0;
function newId(): string {
  sequence += 1;
  return `hud-piece-${String(sequence)}`;
}

function stamp(id: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(id, asked);
  if (params === null) throw new Error(`no card ${id}`);
  return stampSetup(params, { x, z }, 0, newId);
}

/**
 * Rounds in two rows down the middle of the hall, clear of one another. The
 * round card's own colourway is white: a table whose cloth is its own. "bare"
 * asks for the plain table that takes a cloth laid on it.
 */
function rounds(count: number, seats = 10, colourway: "white" | "bare" = "white"): readonly PlacedItem[] {
  const pieces: PlacedItem[] = [];
  for (let index = 0; index < count; index += 1) {
    pieces.push(...stamp("round", -6.75 + (index % 4) * 4.5, -2.25 + Math.floor(index / 4) * 4.5, { seats, colourway }));
  }
  return pieces;
}

/** A round of ten standing in the middle of the Grand Hall's first recorded door. */
function roundInADoor(): readonly PlacedItem[] {
  const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
  if (door === undefined) throw new Error("the Grand Hall has recorded doors");
  return stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
}

/** Two rounds a hand's breadth apart: the narrowest aisle wants a look. */
function twoRoundsClose(): readonly PlacedItem[] {
  return [...stamp("round", 0, 0), ...stamp("round", 2.3, 0)];
}

function setPlaced(items: readonly PlacedItem[]): void {
  act(() => { usePlacementStore.setState({ placedItems: items }); });
}

function setGuests(count: number | null): void {
  act(() => { useCockpitStore.getState().setPlannedGuestCount(count); });
}

function recordDoors(): void {
  act(() => { useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES); });
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

function chairs(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair");
}

function renderHud(props: { readonly eventGuests?: number | null } = {}): void {
  render(<HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={props.eventGuests ?? null} sheets={<HudSheets />} />);
}

/** A key as a browser sends it, to the window; the event, to ask whether the planner took it. */
function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const key = code.startsWith("Digit") ? code.slice("Digit".length) : code;
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(event); });
  return event;
}

function cardKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-card="${id}"]`);
  if (found === null) throw new Error(`no ${id} card in the hand`);
  return found;
}

/** The cards in the hand, as they sit, left to right. */
function handIds(): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-card]"), (card) => card.dataset["card"] ?? "");
}

function stepKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-step="${id}"]`);
  if (found === null) throw new Error(`no ${id} step`);
  return found;
}

/** The shelf: the one surface under the room. */
function shelf(): HTMLElement {
  return screen.getByRole("region", { name: "Furniture and the next steps" });
}

/** The shelf's one status line. */
function statusLine(): HTMLElement {
  return within(shelf()).getByRole("status", { name: "The room as it stands" });
}

/** The one primary key, whatever it says now. */
function primaryKey(): HTMLElement {
  const found = shelf().querySelector<HTMLElement>(".hud-shelf__act .hud-act");
  if (found === null) throw new Error("no primary key on the shelf");
  return found;
}

function armed(): string | null {
  return useCatalogueStore.getState().armedCardId;
}

function chosenIds(): readonly string[] {
  return [...useSelectionStore.getState().selectedIds];
}

/** Where a device keeps its answers to the event's question: lib/event-kind-record's own key, which it does not export. */
const EVENT_KIND_STORAGE_KEY = "venviewer.planner.eventKind";
/** A layout's review state as the editor starts with it, put back after a test that locks one. */
const REVIEW_STATUS_AT_REST = useEditorStore.getState().reviewStatus;

beforeEach(() => {
  sequence = 0;
  resetPlacedIdCounter();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  // The first screen is asked for in its own tests below; elsewhere it has been answered.
  usePlannerHudStore.setState({ firstOpenDone: true });
});

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useCatalogueStore.getState().clearSelection();
  useSelectionStore.getState().clearSelection();
  useCockpitStore.getState().setPlannedGuestCount(null);
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementNoticeStore.getState().dismiss();
  usePlannerHudStore.setState({ sheet: null, sentLayoutIds: [] });
  window.localStorage.removeItem(HUD_SENT_STORAGE_KEY);
  useEditorStore.setState({ configId: null });
  usePlannerEventStore.getState().setEventKind(null);
  resetEventAnswerForTesting();
  resetEventKindQuestionForTesting();
  window.localStorage.removeItem(EVENT_KIND_STORAGE_KEY);
  useEditorStore.setState({ reviewStatus: REVIEW_STATUS_AT_REST });
  setPlannerFeaturesForTesting(null);
  setPlannerChromeFeatures({});
});

/** The test page lays nothing out, so every measure is nought: stand in the top bar's height, and leave the rest. */
function measureBarAs(height: number): () => void {
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measured(this: HTMLElement): DOMRect {
    const tall = this.classList.contains("hud-bar") ? height : 0;
    return { x: 0, y: 0, width: 0, height: tall, top: 0, right: 0, bottom: tall, left: 0, toJSON: () => ({}) };
  });
  return () => { measure.mockRestore(); };
}

describe("the frame", () => {
  it("asks for the hall as a stage with the bar's one line kept dark, and takes the request back as it leaves", () => {
    renderHud();
    expect(useHallViewStore.getState().stage).toEqual({ skyPx: 48 });
    cleanup();
    expect(useHallViewStore.getState().stage).toBeNull();
  });

  it("tells the stage how tall the top bar is, where its steps have a line of their own", () => {
    const restore = measureBarAs(88);
    try {
      renderHud();
      expect(useHallViewStore.getState().stage).toEqual({ skyPx: 88 });
    } finally {
      restore();
    }
  });

  it("keeps the bar's own height where React runs every effect twice (development's strict mode)", () => {
    const restore = measureBarAs(88);
    try {
      render(<StrictMode><HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={null} sheets={<HudSheets />} /></StrictMode>);
      expect(useHallViewStore.getState().stage).toEqual({ skyPx: 88 });
    } finally {
      restore();
    }
  });

  it("turns the card switches on while it is on screen and off again when it leaves", () => {
    const names = ["setupCards", "seatsOnTheCard", "tableSets", "tableNumbers", "editingKeys", "fillKeepOuts"] as const;
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} before`).toBe(false);
    renderHud();
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} while mounted`).toBe(true);
    cleanup();
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} after`).toBe(false);
  });

  it("holds the room as its main landmark, and the plaque at the top bar's left", () => {
    render(<HudFrame room={<div data-testid="the-room" />} plaque={<p>The plaque</p>} eventGuests={null} />);
    expect(screen.getByRole("main").contains(screen.getByTestId("the-room"))).toBe(true);
    expect(document.querySelector(".hud-bar .hud-bar__plaque")?.textContent).toBe("The plaque");
  });

  it("is two bars over the room: no column of seals and no side panel", () => {
    renderHud();
    const layers = Array.from(screen.getByTestId("planner-hud").children, (child) => child.className);
    expect(layers).toEqual(["hud-room", "hud-bar", "hud-shelf"]);
    expect(document.querySelector("[data-seal]")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Your room" })).toBeNull();
  });
});

describe("the hand's cards", () => {
  it("deals eight cards and More, with Lay out for me, Undo and Redo beside them, and one primary key", () => {
    renderHud();
    expect(handIds()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "More furniture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lay out for me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    // The separate Send key is gone: the one primary key says the next move, whatever it is.
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
    expect(shelf().querySelectorAll(".hud-act:not([hidden])")).toHaveLength(1);
  });

  it("takes a card on a click, and puts it back on a second click", () => {
    renderHud();
    const round = cardKey("round");
    expect(round.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(round);
    expect(armed()).toBe("round");
    expect(round.getAttribute("aria-pressed")).toBe("true");
    expect(shelf().getAttribute("data-in-hand")).toBe("true");

    fireEvent.click(round);
    expect(armed()).toBeNull();
    expect(round.getAttribute("aria-pressed")).toBe("false");
    expect(shelf().getAttribute("data-in-hand")).toBeNull();
  });

  it("hands over to another card when a second is taken, one in hand at a time", () => {
    renderHud();
    fireEvent.click(cardKey("round"));
    fireEvent.click(cardKey("long-table"));
    expect(armed()).toBe("long-table");
    expect(cardKey("round").getAttribute("aria-pressed")).toBe("false");
    expect(cardKey("long-table").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll('[data-card][data-armed="true"]')).toHaveLength(1);
  });

  it("closes an open sheet when a card is taken, so the floor is clear to set it on", () => {
    renderHud();
    act(() => { usePlannerHudStore.getState().openSheet("finishing"); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(cardKey("round"));
    expect(usePlannerHudStore.getState().sheet).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(armed()).toBe("round");
  });

  it("opens the whole catalogue from More, and the same key shuts it", () => {
    renderHud();
    const more = screen.getByRole("button", { name: "More furniture" });
    fireEvent.click(more);
    expect(usePlannerHudStore.getState().sheet).toBe("more");
    expect(screen.getByRole("dialog", { name: "Everything the hall has" })).toBeTruthy();
    fireEvent.click(more);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("counts what is in the room beside the name on the card that sets it down", () => {
    renderHud();
    setPlaced(rounds(2));
    const count = within(cardKey("round")).getByText("×2");
    expect(count.closest(".hud-card__name")?.textContent).toBe("Round of 10 ×2");
    expect(cardKey("round").getAttribute("aria-label")).toMatch(/, 2 in the room$/u);
  });
});

describe("the digit keys", () => {
  it("has eight cards for the digits to take", () => {
    renderHud();
    expect(handIds()).toHaveLength(8);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("takes the card in place %i", (digit) => {
    renderHud();
    const ids = handIds();
    const event = press(`Digit${String(digit)}`);
    expect(armed()).toBe(ids[digit - 1]);
    expect(event.defaultPrevented).toBe(true);
    expect(cardKey(ids[digit - 1] ?? "").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the card back when its digit is pressed again", () => {
    renderHud();
    press("Digit1");
    expect(armed()).not.toBeNull();
    press("Digit1");
    expect(armed()).toBeNull();
  });

  it("swaps to the next card when another digit is pressed", () => {
    renderHud();
    const ids = handIds();
    press("Digit1");
    press("Digit3");
    expect(armed()).toBe(ids[2]);
  });

  it("leaves 9 and 0 alone: there is no ninth card", () => {
    renderHud();
    expect(press("Digit9").defaultPrevented).toBe(false);
    expect(press("Digit0").defaultPrevented).toBe(false);
    expect(armed()).toBeNull();
  });

  it("leaves Shift and Ctrl with a digit to the browser", () => {
    renderHud();
    press("Digit1", { shiftKey: true, key: "!" });
    press("Digit1", { ctrlKey: true });
    expect(armed()).toBeNull();
  });

  it("does nothing while a sheet is open, so typing a guest count is never a card", () => {
    renderHud();
    act(() => { usePlannerHudStore.getState().openSheet("event"); });
    press("Digit1");
    expect(armed()).toBeNull();
    const guests = screen.getByRole("spinbutton", { name: "Guests" });
    expect(press("Digit2").defaultPrevented).toBe(false);
    expect(guests).toBeTruthy();
    expect(armed()).toBeNull();
  });

  it("follows the hand when the kind of event changes the cards", () => {
    renderHud();
    act(() => { usePlannerEventStore.getState().setEventKind("corporate"); });
    const ids = handIds();
    expect(ids).toHaveLength(8);
    expect(ids).toContain("piece:lectern");
    press("Digit4");
    expect(armed()).toBe(ids[3]);
  });
});

describe("the status line", () => {
  it("counts the seats placed when no guest count is known", () => {
    renderHud();
    setPlaced(rounds(1));
    expect(statusLine().textContent).toContain("10 seats placed");
  });

  it('reads "N of M seated" once a guest count is set and a round is stamped, and says it once', () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(3));
    const line = statusLine();
    expect(line.textContent).toContain("30 of 120 seated");
    // Derived restatements are gone: the shelf's edge carries how far there is to go.
    expect(line.textContent).not.toContain("to go");
    expect(line.textContent).not.toContain("seats placed");
  });

  it("reads N of N when every guest has a seat", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    expect(statusLine().textContent).toContain("30 of 30 seated");
  });

  it("takes the linked event's guest count, and a count given in the planner comes first", () => {
    renderHud({ eventGuests: 40 });
    setPlaced(rounds(2));
    expect(statusLine().textContent).toContain("20 of 40 seated");
    setGuests(60);
    expect(statusLine().textContent).toContain("20 of 60 seated");
  });

  it("updates as seats are added and taken away", () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(1));
    expect(statusLine().textContent).toContain("10 of 120 seated");
    setPlaced(rounds(2));
    expect(statusLine().textContent).toContain("20 of 120 seated");
    setPlaced([]);
    expect(statusLine().textContent).toContain("0 of 120 seated");
  });

  it("says the doors are clear once the room's doors are recorded, and nothing of them before", () => {
    renderHud();
    setPlaced(rounds(1));
    expect(statusLine().textContent).not.toContain("Doors");
    recordDoors();
    expect(statusLine().textContent).toContain("Doors clear");
    expect(within(statusLine()).queryByRole("button")).toBeNull();
  });

  it("makes a blocked door something to look at, and a press chooses the table in front of it", () => {
    renderHud();
    recordDoors();
    setGuests(10);
    setPlaced(roundInADoor());
    const door = within(statusLine()).getByRole("button", { name: /^1 door blocked\. .+ is in front of/u });
    expect(door.textContent).toBe("1 door blocked");
    fireEvent.click(door);
    const table = tables()[0];
    expect(table).toBeDefined();
    expect(chosenIds()).toContain(table?.id);
    // The cards give way to its verbs, and its name takes the seats' place.
    expect(document.querySelector(".hud-piece")).not.toBeNull();
    expect(within(statusLine()).getByRole("heading", { name: /Round of 10/u })).toBeTruthy();
  });

  it("makes a tight aisle something to look at, and a press chooses the two pieces", () => {
    renderHud();
    setGuests(20);
    setPlaced(twoRoundsClose());
    const aisle = within(statusLine()).getByRole("button", { name: /^Narrowest aisle \d+\.\d m\. The narrowest gap is/u });
    fireEvent.click(aisle);
    expect(chosenIds()).toHaveLength(2);
    expect(tables().every((table) => chosenIds().includes(table.id))).toBe(true);
  });

  it("gives a receipt its place while it shows, with Undo, and takes the place back when it clears", () => {
    renderHud();
    setGuests(120);
    act(() => { usePlacementNoticeStore.getState().post("Laid 12 tables of ten", { undo: true }); });
    const region = screen.getByTestId("hud-notice-region");
    expect(shelf().contains(region)).toBe(true);
    expect(within(region).getByText("Laid 12 tables of ten")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(within(shelf()).queryByRole("status", { name: "The room as it stands" })).toBeNull();

    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    expect(within(region).queryByText("Laid 12 tables of ten")).toBeNull();
    expect(statusLine().textContent).toContain("0 of 120 seated");
  });
});

// A receipt leaves the page as its Undo is pressed, with the keyboard on it, and a browser then leaves the keyboard on
// the bare page. It goes on to the shelf's own Undo; to Redo where nothing is left to undo; never to the bare page.
describe("a receipt and the keyboard", () => {
  /** One step in the editor's history, for an Undo to take back. */
  function recordAStep(): void {
    const lectern = getCatalogueItemBySlug("lectern");
    if (lectern === undefined) throw new Error("the catalogue has a lectern");
    act(() => { useEditorStore.getState().addObject(lectern.id, 0, 0, 0); });
  }

  function receiptUndo(): HTMLElement {
    act(() => { usePlacementNoticeStore.getState().post("Laid 12 tables of ten", { undo: true }); });
    return within(screen.getByTestId("hud-notice-region")).getByRole("button", { name: "Undo" });
  }

  function shelfWord(name: "undo" | "redo"): HTMLElement {
    const found = shelf().querySelector<HTMLElement>(`.hud-shelf__${name}`);
    if (found === null) throw new Error(`no ${name} word on the shelf`);
    return found;
  }

  afterEach(() => {
    act(() => { useEditorStore.getState().reset(); });
  });

  it("goes from the receipt's Undo to the shelf's own while there is more to undo", async () => {
    renderHud();
    recordAStep();
    recordAStep();
    const undo = receiptUndo();
    undo.focus();
    fireEvent.click(undo);
    expect(undo.isConnected).toBe(false);
    await waitFor(() => { expect(document.activeElement).toBe(shelfWord("undo")); });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("goes to Redo, which takes the press back, once nothing is left to undo", async () => {
    renderHud();
    recordAStep();
    const undo = receiptUndo();
    undo.focus();
    fireEvent.click(undo);
    expect(shelfWord("undo").hasAttribute("disabled")).toBe(true);
    await waitFor(() => { expect(document.activeElement).toBe(shelfWord("redo")); });
  });

  it("goes on the same way when the line clears itself with the keyboard on its Undo", async () => {
    renderHud();
    recordAStep();
    const undo = receiptUndo();
    undo.focus();
    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    expect(undo.isConnected).toBe(false);
    await waitFor(() => { expect(document.activeElement).toBe(shelfWord("undo")); });
  });

  it("is left where it is when the line clears with the keyboard elsewhere", async () => {
    renderHud();
    recordAStep();
    receiptUndo();
    const layOut = screen.getByRole("button", { name: "Lay out for me" });
    layOut.focus();
    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(layOut);
  });
});

describe("the one primary key", () => {
  it("asks how many guests while no count is known, opens Your event, and steps aside while it is open", () => {
    renderHud();
    expect(primaryKey().textContent).toBe("Say how many guests");
    fireEvent.click(screen.getByRole("button", { name: "Say how many guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(screen.queryByRole("button", { name: "Say how many guests" })).toBeNull();
  });

  it("lays the room out for the guests on an empty floor, through Lay out", () => {
    renderHud();
    setGuests(120);
    fireEvent.click(screen.getByRole("button", { name: "Lay out the room for 120 guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });

  it("asks to seat the guests still without a seat", () => {
    renderHud();
    setGuests(50);
    setPlaced(rounds(2));
    fireEvent.click(screen.getByRole("button", { name: "Seat 30 more guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });

  it("moves a table clear of the door it stands in front of, in one press", () => {
    renderHud();
    recordDoors();
    setGuests(10);
    setPlaced(roundInADoor());
    expect(primaryKey().textContent).toMatch(/^Move .+ clear of the door$/u);
    fireEvent.click(primaryKey());
    expect(doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("opens up the narrowest gap by choosing the two pieces either side of it", () => {
    renderHud();
    setGuests(20);
    setPlaced(twoRoundsClose());
    fireEvent.click(screen.getByRole("button", { name: "Open up the narrowest gap" }));
    expect(chosenIds()).toHaveLength(2);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  // Seen on the live site on 20 November: Lay out for 80 set eight rounds at the planner's own spacing, and the one
  // key then read "Open up the narrowest gap". What the planner has just laid is ready to send.
  it("offers Send once the planner has laid the room itself, and says its spacing as a plain figure", () => {
    renderHud();
    recordDoors();
    setGuests(80);
    const round = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
    if (round === undefined) throw new Error("the planner's round table is in the catalogue");
    act(() => { usePlacementStore.getState().autoArrangeBanquet(round.id, 80, 10, grandHallExits()); });
    expect(tables()).toHaveLength(8);
    // The receipt for what was laid stands where the status line does, until it has had its moment.
    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    expect(statusLine().textContent).toContain("80 of 80 seated");
    expect(statusLine().textContent).toContain("Doors clear");
    expect(statusLine().textContent).toContain("Narrowest aisle 0.6 m");
    expect(within(statusLine()).queryByRole("button", { name: /Narrowest aisle/u })).toBeNull();
    expect(primaryKey().textContent).toBe("Send to the events team");
  });

  it("sends to the events team once every guest has a seat", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    expect(primaryKey().getAttribute("data-move")).toBe("send");
    fireEvent.click(screen.getByRole("button", { name: "Send to the events team" }));
    expect(screen.getByRole("dialog", { name: "Send to the events team" })).toBeTruthy();
  });

  it("says, quietly, that the plan has gone, and opens Send again on a press", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    act(() => {
      useEditorStore.setState({ configId: "layout-a" });
      usePlannerHudStore.getState().markSent("layout-a");
    });
    expect(primaryKey().textContent).toBe("Sent to the events team");
    expect(primaryKey().getAttribute("data-move")).toBe("sent");
    fireEvent.click(primaryKey());
    expect(usePlannerHudStore.getState().sheet).toBe("send");
  });

  it("does not call another layout sent because one was", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    act(() => {
      useEditorStore.setState({ configId: "layout-a" });
      usePlannerHudStore.getState().markSent("layout-a");
    });
    expect(stepKey("send").getAttribute("data-state")).toBe("done");
    // Another layout is opened on the same page (the planner asks a new layout its guests afresh): it has gone nowhere.
    act(() => { useEditorStore.setState({ configId: "layout-b" }); });
    setGuests(30);
    expect(primaryKey().getAttribute("data-move")).toBe("send");
    expect(stepKey("send").getAttribute("data-state")).toBe("current");
    // And the one that went is still the one that went.
    act(() => { useEditorStore.setState({ configId: "layout-a" }); });
    setGuests(30);
    expect(primaryKey().getAttribute("data-move")).toBe("sent");
  });
});

describe("the journey and its sheets", () => {
  it("shows four steps with the first current", () => {
    renderHud();
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"), (step) => [step.dataset["step"], step.dataset["state"]]);
    expect(steps).toEqual([["event", "current"], ["layout", "ahead"], ["finishing", "ahead"], ["send", "ahead"]]);
    expect(stepKey("event").getAttribute("aria-current")).toBe("step");
  });

  it("moves its current step on as the room fills and the tables are dressed", async () => {
    renderHud();
    setGuests(30);
    expect(stepKey("event").getAttribute("data-state")).toBe("done");
    expect(stepKey("layout").getAttribute("data-state")).toBe("current");
    // Plain tables: every guest seated, but nothing dressed yet.
    setPlaced(rounds(3, 10, "bare"));
    expect(stepKey("layout").getAttribute("data-state")).toBe("done");
    expect(stepKey("finishing").getAttribute("data-state")).toBe("current");
    expect(stepKey("send").getAttribute("data-state")).toBe("ahead");
    // The same tables in their own white cloth. The pieces are the same in number, so the HUD
    // reads their new places once the hand rests (hud-facts.tsx), not on the instant.
    setPlaced(rounds(3));
    expect(stepKey("finishing").getAttribute("data-state")).toBe("current");
    await waitFor(() => { expect(stepKey("finishing").getAttribute("data-state")).toBe("done"); });
    expect(stepKey("send").getAttribute("data-state")).toBe("current");
    expect(screen.getByRole("button", { name: "Send to the events team" })).toBeTruthy();
  });

  it("opens a step's sheet when it is pressed, and Escape closes it", () => {
    renderHud();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(stepKey("event"));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Your event" })).toBeTruthy();

    const event = press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("false");
  });

  it("raises the sheet from the shelf, with the shelf still under it", () => {
    renderHud();
    fireEvent.click(stepKey("finishing"));
    const sheet = screen.getByRole("dialog", { name: "Finishing touches" });
    expect(shelf().contains(sheet)).toBe(true);
    expect(handIds()).toHaveLength(8);
  });

  it("closes the sheet when the same step is pressed again", () => {
    renderHud();
    fireEvent.click(stepKey("finishing"));
    expect(screen.getByRole("dialog", { name: "Finishing touches" })).toBeTruthy();
    fireEvent.click(stepKey("finishing"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds one sheet at a time: another step replaces the open one", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.click(stepKey("finishing"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Finishing touches" })).toBeTruthy();
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from its own Close key", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands the keyboard into a sheet as it opens, and back to what opened it when Escape shuts it", async () => {
    renderHud();
    const step = stepKey("event");
    step.focus();
    fireEvent.click(step);
    const sheet = screen.getByRole("dialog", { name: "Your event" });
    expect(document.activeElement).toBe(within(sheet).getByRole("heading", { name: "Your event" }));
    press("Escape");
    await waitFor(() => { expect(document.activeElement).toBe(step); });
  });

  it("hands the keyboard in and back the same way where React runs every effect twice (development's strict mode)", async () => {
    render(<StrictMode><HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={null} sheets={<HudSheets />} /></StrictMode>);
    const step = stepKey("event");
    step.focus();
    fireEvent.click(step);
    const title = within(screen.getByRole("dialog", { name: "Your event" })).getByRole("heading", { name: "Your event" });
    // The first run's clean-up asks for focus to go back a moment later: let that moment pass before looking.
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(title);
    press("Escape");
    await waitFor(() => { expect(document.activeElement).toBe(step); });
  });

  it("leaves the keyboard on the new sheet's title when a sheet is replaced from inside itself", async () => {
    renderHud();
    const step = stepKey("event");
    step.focus();
    fireEvent.click(step);
    // Focus is inside the first sheet (on its title) when another takes its place.
    act(() => { usePlannerHudStore.getState().openSheet("finishing"); });
    const title = within(screen.getByRole("dialog", { name: "Finishing touches" })).getByRole("heading", { name: "Finishing touches" });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(title);
  });

  it("leaves focus where it is when a sheet is shut from outside it", () => {
    renderHud();
    const step = stepKey("finishing");
    step.focus();
    fireEvent.click(step);
    expect(screen.getByRole("dialog", { name: "Finishing touches" })).toBeTruthy();
    // The same step again shuts it: the press put focus on the step, not in the sheet.
    step.focus();
    fireEvent.click(step);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(step);
  });

  // What opened a sheet can be gone by the time it shuts, or folded away: a phone's top bar shows only the current
  // step. Focus then goes to the sheet's own step, and failing that to the one primary key; never to the bare page.
  it("hands the keyboard to the sheet's own step when what opened it has gone", async () => {
    renderHud();
    const gone = document.createElement("button");
    document.body.append(gone);
    gone.focus();
    act(() => { usePlannerHudStore.getState().openSheet("finishing"); });
    gone.remove();
    press("Escape");
    await waitFor(() => { expect(document.activeElement).toBe(stepKey("finishing")); });
  });

  it("hands it to the one primary key where the step cannot be seen either", async () => {
    renderHud();
    const step = stepKey("event");
    step.focus();
    fireEvent.click(step);
    // As a phone's top bar folds a step away once it is no longer the current one.
    step.hidden = true;
    press("Escape");
    await waitFor(() => { expect(document.activeElement).toBe(primaryKey()); });
    expect(primaryKey().hidden).toBe(false);
  });

  it("closes the sheet as the screen leaves, so its next showing opens with the shelf down", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    cleanup();
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("lets Escape through to nothing when no sheet is open", () => {
    renderHud();
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("takes a guest count from the Your event sheet, which the status line then reads", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "80" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(80);
    expect(statusLine().textContent).toContain("0 of 80 seated");
    // The count given, the next move is the next step's, and the primary key says it.
    expect(screen.getByRole("button", { name: "Lay out the room for 80 guests" })).toBeTruthy();
  });

  it("sends Lay out for me to Your event until there is a guest count, then to Lay out", () => {
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Lay out for me" }));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    act(() => { usePlannerHudStore.getState().closeSheet(); });
    setGuests(50);
    fireEvent.click(screen.getByRole("button", { name: "Lay out for me" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });
});

describe("the piece's verbs", () => {
  function chooseTable(): string {
    const table = tables()[0];
    if (table === undefined) throw new Error("no table placed");
    act(() => { useSelectionStore.getState().selectMultiple([table.id]); });
    return table.id;
  }

  it("take the cards' place while something is chosen, and give it back when it is let go", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    const cards = shelf().querySelector<HTMLElement>(".hud-cards");
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(cards?.hidden).toBe(false);
    chooseTable();
    expect(document.querySelector(".hud-piece")).not.toBeNull();
    expect(cards?.hidden).toBe(true);
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(cards?.hidden).toBe(false);
  });

  it("name a chosen round by its seats where the status line's first words were", () => {
    renderHud();
    setGuests(40);
    setPlaced(rounds(1, 8));
    expect(statusLine().textContent).toContain("8 of 40 seated");
    chooseTable();
    expect(within(statusLine()).getByRole("heading", { name: /Round of 8/u })).toBeTruthy();
    expect(statusLine().textContent).not.toContain("seated");
    const stepper = screen.getByRole("group", { name: "Seats at this table" });
    expect(within(stepper).getByText("8 seats")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Round of 8/u }).contains(stepper)).toBe(true);
  });

  it("add a seat with the plus key and take one away with the minus key", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(chairs()).toHaveLength(8);
    const stepper = screen.getByRole("group", { name: "Seats at this table" });

    fireEvent.click(within(stepper).getByRole("button", { name: "One seat more" }));
    expect(chairs()).toHaveLength(9);
    expect(within(screen.getByRole("group", { name: "Seats at this table" })).getByText("9 seats")).toBeTruthy();

    fireEvent.click(within(stepper).getByRole("button", { name: "One seat fewer" }));
    fireEvent.click(within(stepper).getByRole("button", { name: "One seat fewer" }));
    expect(chairs()).toHaveLength(7);
    expect(within(screen.getByRole("group", { name: "Seats at this table" })).getByText("7 seats")).toBeTruthy();
  });

  it("offer no cloths for a table whose cloth is its own", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(screen.queryByRole("radiogroup", { name: "The cloth on this table" })).toBeNull();
  });

  it("dress the chosen table from its three cloths", () => {
    renderHud();
    setPlaced(rounds(1, 8, "bare"));
    chooseTable();
    const cloths = screen.getByRole("radiogroup", { name: "The cloth on this table" });
    expect(within(cloths).getAllByRole("radio")).toHaveLength(3);
    expect(within(cloths).getByRole("radio", { name: "No cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "Black cloth" }));
    expect(tables()[0]?.clothed).toBe(true);
    expect(tables()[0]?.clothStyle).toBe("black");
    expect(within(cloths).getByRole("radio", { name: "Black cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "No cloth" }));
    expect(tables()[0]?.clothed).toBe(false);
  });

  it("put the chosen table and its chairs back, and bring the cards back", () => {
    renderHud();
    setPlaced(rounds(2, 8));
    chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(tables()).toHaveLength(1);
    expect(chairs()).toHaveLength(8);
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(shelf().querySelector<HTMLElement>(".hud-cards")?.hidden).toBe(false);
  });

  it("copy the chosen table with its chairs and choose the copy", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    const original = chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(tables()).toHaveLength(2);
    expect(chairs()).toHaveLength(16);
    expect(useSelectionStore.getState().selectedIds.has(original)).toBe(false);
  });

  it("keep the cards on the shelf while a card is in hand, so the card can be seen", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    press("Digit1");
    expect(armed()).not.toBeNull();
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(shelf().querySelector<HTMLElement>(".hud-cards")?.hidden).toBe(false);
  });

  // The verbs leave the page when the piece is put back or let go, and whoever pressed from the keyboard is in
  // them. The keyboard goes on into the cards that come back in their place: never to the bare page.
  it("hand the keyboard to the card a piece went back to, when Put back is pressed from the keyboard", async () => {
    renderHud();
    setPlaced(rounds(2, 8));
    chooseTable();
    const putBack = screen.getByRole("button", { name: "Put back" });
    putBack.focus();
    fireEvent.click(putBack);
    expect(putBack.isConnected).toBe(false);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey("round")); });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("hand it to More where the hand has no card for the piece", async () => {
    renderHud();
    // A wedding's hand, dealt while nobody has said what the day is, has no lectern.
    setPlaced(stamp(pieceCardId("lectern"), 0, 0));
    act(() => { useSelectionStore.getState().selectMultiple([nth(placed(), 0).id]); });
    const putBack = screen.getByRole("button", { name: "Put back" });
    putBack.focus();
    fireEvent.click(putBack);
    expect(placed()).toHaveLength(0);
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "More furniture" })); });
  });

  it("hand it to the one primary key where no card can take it", async () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    const putBack = screen.getByRole("button", { name: "Put back" });
    putBack.focus();
    // As where the cards cannot be seen.
    for (const card of document.querySelectorAll<HTMLElement>(".hud-card")) card.hidden = true;
    fireEvent.click(putBack);
    await waitFor(() => { expect(document.activeElement).toBe(primaryKey()); });
  });

  it("hand it to the piece's card when the piece is let go with the keyboard in the verbs", async () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    const turn = screen.getByRole("button", { name: "Turn" });
    turn.focus();
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(tables()).toHaveLength(1);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey("round")); });
  });

  it("hand it to the card in hand when a digit takes a card with the keyboard in the verbs", async () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    const copy = screen.getByRole("button", { name: "Copy" });
    copy.focus();
    press("Digit2");
    const second = nth(handIds(), 1);
    expect(armed()).toBe(second);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey(second)); });
  });

  it("leave the keyboard where it is when the verbs go with the keyboard elsewhere, or stay", async () => {
    renderHud();
    setPlaced(rounds(1, 8, "bare"));
    chooseTable();
    // A press that changes the piece and keeps the verbs: the keyboard stays on the key pressed.
    const more = screen.getByRole("button", { name: "One seat more" });
    more.focus();
    fireEvent.click(more);
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(more);
    // The piece let go while the keyboard is on the shelf's own words: it stays there.
    const layOut = screen.getByRole("button", { name: "Lay out for me" });
    layOut.focus();
    act(() => { useSelectionStore.getState().clearSelection(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(layOut);
  });
});

describe("the first screen", () => {
  function ask(): void {
    act(() => { usePlannerHudStore.setState({ firstOpenDone: false }); });
  }

  it("asks what you are planning on an empty floor, on the shelf risen, with three photographs", () => {
    ask();
    renderHud();
    const root = screen.getByTestId("planner-hud");
    expect(root.getAttribute("data-first-open")).toBe("true");
    const first = screen.getByTestId("hud-first-open");
    expect(shelf().contains(first)).toBe(true);
    expect(within(first).getByRole("heading", { name: "What are you planning?" })).toBeTruthy();
    // Three plain keys under the question. An answer is an act that moves on, not a setting that stays chosen, so
    // none of them says it is a radio button (a screen reader would announce "not checked", and wait for arrows).
    const answers = within(within(first).getByRole("group", { name: "What are you planning?" })).getAllByRole("button");
    expect(answers.map((answer) => answer.querySelector(".hud-first-open__name")?.textContent)).toEqual(["Wedding", "Corporate", "Something else"]);
    expect(answers.every((answer) => answer.querySelector("img") !== null)).toBe(true);
    // One family: the set-ups' own renders (one camera, one light, one ground), never a single piece's portrait.
    const photographs = answers.map((answer) => answer.querySelector("img")?.getAttribute("src") ?? "");
    expect(photographs.every((source) => source.startsWith("/models/furniture/setup-") && source.includes("/setup-v2/"))).toBe(true);
    expect(new Set(photographs).size).toBe(3);
    expect(within(first).queryAllByRole("radio")).toEqual([]);
    expect(within(first).queryByRole("radiogroup")).toBeNull();
    expect(answers.every((answer) => !answer.hasAttribute("aria-checked"))).toBe(true);
  });

  // The answer that opened the sheet is gone by the time the sheet is up (the first screen leaves with it), so
  // there is nothing to hand the keyboard back to. It goes to the sheet's own step, never to the bare page.
  it("hands the keyboard to the sheet's own step when its answer's sheet is shut", async () => {
    ask();
    renderHud();
    const answer = screen.getByRole("button", { name: /Wedding/u });
    answer.focus();
    fireEvent.click(answer);
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(answer.isConnected).toBe(false);
    press("Escape");
    await waitFor(() => { expect(document.activeElement).toBe(stepKey("event")); });
  });

  it("takes an answer as the kind of day, and opens Your event for the guest count", () => {
    ask();
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: /Corporate/u }));
    expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
    expect(screen.getByTestId("planner-hud").getAttribute("data-first-open")).toBeNull();
  });

  it("is put aside by Start with an empty hall, and is not asked again on this page", () => {
    ask();
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Start with an empty hall" }));
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
    expect(usePlannerHudStore.getState().firstOpenDone).toBe(true);
  });

  it("is put aside by Escape", () => {
    ask();
    renderHud();
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
  });

  // Put aside, the first screen leaves the page with the keyboard on the key that was pressed. It gives the shelf
  // back to someone who would rather begin with their own hands, so the keyboard goes into the hand: never to the
  // bare page.
  it("hands the keyboard to the hand's first card when Start with an empty hall is pressed from the keyboard", async () => {
    ask();
    renderHud();
    const aside = screen.getByRole("button", { name: "Start with an empty hall" });
    aside.focus();
    fireEvent.click(aside);
    expect(aside.isConnected).toBe(false);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey(nth(handIds(), 0))); });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("hands it on the same way when Escape puts the question aside with the keyboard on an answer", async () => {
    ask();
    renderHud();
    const answer = screen.getByRole("button", { name: /Wedding/u });
    answer.focus();
    press("Escape");
    expect(answer.isConnected).toBe(false);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey(nth(handIds(), 0))); });
  });

  it("hands it to the card taken, when a digit takes a card with the keyboard on the question", async () => {
    ask();
    renderHud();
    const answer = screen.getByRole("button", { name: /Corporate/u });
    answer.focus();
    press("Digit3");
    const third = nth(handIds(), 2);
    expect(armed()).toBe(third);
    await waitFor(() => { expect(document.activeElement).toBe(cardKey(third)); });
  });

  it("hands it to the current step where no card can take it, and to the one primary key failing that", async () => {
    ask();
    renderHud();
    // As where the cards cannot be seen.
    for (const card of document.querySelectorAll<HTMLElement>(".hud-card")) card.hidden = true;
    const aside = screen.getByRole("button", { name: "Start with an empty hall" });
    aside.focus();
    fireEvent.click(aside);
    await waitFor(() => { expect(document.activeElement).toBe(stepKey("event")); });
    expect(stepKey("event").getAttribute("aria-current")).toBe("step");

    // And as a phone's top bar that has folded the step away, too.
    cleanup();
    ask();
    renderHud();
    for (const card of document.querySelectorAll<HTMLElement>(".hud-card")) card.hidden = true;
    stepKey("event").hidden = true;
    const again = screen.getByRole("button", { name: "Start with an empty hall" });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => { expect(document.activeElement).toBe(primaryKey()); });
  });

  it("leaves the keyboard to the sheet an answer opens, which takes it to its own title", async () => {
    ask();
    renderHud();
    const answer = screen.getByRole("button", { name: /Corporate/u });
    answer.focus();
    fireEvent.click(answer);
    const title = within(screen.getByRole("dialog", { name: "Your event" })).getByRole("heading", { name: "Your event" });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(title);
  });

  it("is not asked once the guest count is known", () => {
    ask();
    renderHud({ eventGuests: 80 });
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
  });

  it("shows photographs the site serves", async () => {
    ask();
    renderHud();
    const sources = Array.from(screen.getByTestId("hud-first-open").querySelectorAll("img"), (img) => img.getAttribute("src") ?? "");
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      const file = await readFile(resolve("public", source.slice(1)));
      expect(file.byteLength).toBeGreaterThan(1024);
    }
  });

  // "What are you planning?" has one kept answer for a layout: the record the default planner's own question writes
  // (lib/event-kind-record). This screen tells the same record, so a reload does not ask again, and neither planner
  // asks a layout the other has asked.
  describe("and the layout's kept answer", () => {
    const NEW_DRAFT = { isPublicPreview: true, search: "", metadata: null, floorEmptyAtOpen: true } as const;

    /** A layout opens, as the editor's load opens it: a guest's new, empty draft unless said otherwise. */
    function open(configId: string, layout: Partial<OpenedLayout> = {}): void {
      act(() => {
        useEditorStore.setState({ configId });
        openLayoutEventKind({ configId, ...NEW_DRAFT, ...layout });
      });
    }

    it("keeps an answer with the layout: for a guest's draft, on this device", () => {
      open("draft-1");
      ask();
      renderHud();
      fireEvent.click(screen.getByRole("button", { name: /Wedding/u }));
      expect(usePlannerEventStore.getState().eventKind).toBe("wedding");
      expect(useEventKindQuestion.getState().answer).toBe("wedding");
      expect(deviceEventKind("draft-1")).toBe("wedding");
      // The default planner's receipt is not this screen's to show, and is not left waiting for that planner.
      expect(useEventKindQuestion.getState().receipt).toBeNull();
    });

    it("keeps Start with an empty hall as not sure yet, and does not ask that layout again when it next opens", () => {
      open("draft-2");
      ask();
      renderHud();
      fireEvent.click(screen.getByRole("button", { name: "Start with an empty hall" }));
      expect(useEventKindQuestion.getState().answer).toBeNull();
      expect(deviceEventKind("draft-2")).toBeNull();
      // The page opened again: the same draft, its answer read from this device.
      cleanup();
      act(() => { resetEventKindQuestionForTesting(); });
      open("draft-2");
      ask();
      renderHud();
      expect(screen.queryByTestId("hud-first-open")).toBeNull();
      expect(screen.getByTestId("planner-hud").getAttribute("data-first-open")).toBeNull();
    });

    it("keeps Escape the same way", () => {
      open("draft-escape");
      ask();
      renderHud();
      press("Escape");
      expect(deviceEventKind("draft-escape")).toBeNull();
    });

    it("does not ask a layout the default planner has already asked", () => {
      rememberDeviceEventKind("draft-3", null);
      open("draft-3");
      ask();
      renderHud();
      expect(screen.queryByTestId("hud-first-open")).toBeNull();
    });

    it("does not ask a layout that was not new as it opened, however empty its floor is now", () => {
      open("draft-4", { floorEmptyAtOpen: false });
      ask();
      renderHud();
      expect(screen.queryByTestId("hud-first-open")).toBeNull();
    });

    it("does not ask while the layout cannot be changed", () => {
      open("draft-locked");
      // Sent for review: the layout is locked for its planner until the venue answers.
      act(() => { useEditorStore.setState({ reviewStatus: "submitted" }); });
      expect(useEditorStore.getState().lockReason).toBe("in-review");
      ask();
      renderHud();
      expect(screen.queryByTestId("hud-first-open")).toBeNull();
    });

    it("does not ask on a device that has been told not to", () => {
      deviceAsksEventKind("?event-question=off");
      ask();
      renderHud();
      expect(screen.queryByTestId("hud-first-open")).toBeNull();
    });

    it("asks a new, empty layout nothing has answered", () => {
      open("draft-new");
      ask();
      renderHud();
      expect(screen.getByTestId("hud-first-open")).toBeTruthy();
    });

    // A slow connection: the question is on the screen before the layout has opened, and a quick hand answers it.
    it("keeps an answer given before the layout had opened, once it opens", async () => {
      ask();
      renderHud();
      fireEvent.click(screen.getByRole("button", { name: /Corporate/u }));
      expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
      open("draft-5");
      await act(async () => { await Promise.resolve(); });
      expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
      expect(useEventKindQuestion.getState().answer).toBe("corporate");
      expect(deviceEventKind("draft-5")).toBe("corporate");
      expect(useEventKindQuestion.getState().receipt).toBeNull();
    });

    it("lets a layout that opens with its own answer keep it over one given too early", async () => {
      rememberDeviceEventKind("draft-6", "wedding");
      ask();
      renderHud();
      fireEvent.click(screen.getByRole("button", { name: /Corporate/u }));
      open("draft-6");
      await act(async () => { await Promise.resolve(); });
      expect(usePlannerEventStore.getState().eventKind).toBe("wedding");
      expect(deviceEventKind("draft-6")).toBe("wedding");
    });

    it("takes a change of answer in Your event to the same record", () => {
      open("draft-7");
      renderHud();
      act(() => { usePlannerHudStore.getState().openSheet("event"); });
      fireEvent.click(screen.getByRole("radio", { name: /Wedding/u }));
      expect(deviceEventKind("draft-7")).toBe("wedding");
      fireEvent.click(screen.getByRole("radio", { name: /Something else/u }));
      expect(usePlannerEventStore.getState().eventKind).toBe("other");
      expect(deviceEventKind("draft-7")).toBe("other");
      expect(useEventKindQuestion.getState().receipt).toBeNull();
    });

    it("marks the layout as no longer new once something stands on its floor", () => {
      open("draft-8");
      renderHud();
      expect(useEventKindQuestion.getState().askable).toBe(true);
      setPlaced(rounds(1));
      expect(useEventKindQuestion.getState().askable).toBe(false);
    });
  });
});

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`nothing at ${String(index)} of ${String(list.length)}`);
  return item;
}

// A group that says it is a radio group works as one: a single stop in the Tab order, and the arrow keys go to the
// next choice and choose it (radio-keys.ts). The view's three are held to the same in view-station.test.tsx.
describe("a group of choices and the keyboard", () => {
  function choices(name: string): { readonly radios: readonly HTMLElement[]; readonly stops: () => readonly (string | null)[] } {
    const radios = within(screen.getByRole("radiogroup", { name })).getAllByRole("radio");
    return { radios, stops: () => radios.map((radio) => radio.getAttribute("tabindex")) };
  }

  it("is one stop in the Tab order: the chosen one, or the first while nothing is chosen", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    const kinds = choices("What are you planning?");
    expect(kinds.stops()).toEqual(["0", "-1", "-1"]);
    fireEvent.click(nth(kinds.radios, 1));
    expect(kinds.stops()).toEqual(["-1", "0", "-1"]);
  });

  it("goes to the next choice and chooses it on an arrow key, round both ends, and to the ends on Home and End", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    const kinds = choices("What are you planning?");
    const [wedding, corporate, other] = [nth(kinds.radios, 0), nth(kinds.radios, 1), nth(kinds.radios, 2)];
    const kind = (): string | null => usePlannerEventStore.getState().eventKind;
    wedding.focus();
    // The key is the group's own: the page does not scroll, and nothing else takes it.
    expect(fireEvent.keyDown(wedding, { key: "ArrowRight" })).toBe(false);
    expect(document.activeElement).toBe(corporate);
    expect(kind()).toBe("corporate");
    fireEvent.keyDown(corporate, { key: "ArrowDown" });
    expect(document.activeElement).toBe(other);
    expect(kind()).toBe("other");
    fireEvent.keyDown(other, { key: "ArrowRight" });
    expect(document.activeElement).toBe(wedding);
    expect(kind()).toBe("wedding");
    fireEvent.keyDown(wedding, { key: "ArrowUp" });
    expect(document.activeElement).toBe(other);
    expect(kind()).toBe("other");
    fireEvent.keyDown(other, { key: "Home" });
    expect(document.activeElement).toBe(wedding);
    expect(kind()).toBe("wedding");
    fireEvent.keyDown(wedding, { key: "End" });
    expect(document.activeElement).toBe(other);
    expect(kinds.stops()).toEqual(["-1", "-1", "0"]);
  });

  it("leaves every other key, and an arrow with Ctrl or Alt held, alone", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    const wedding = nth(choices("What are you planning?").radios, 0);
    wedding.focus();
    expect(fireEvent.keyDown(wedding, { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(wedding, { key: "ArrowRight", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(wedding, { key: "ArrowRight", altKey: true })).toBe(true);
    expect(document.activeElement).toBe(wedding);
    expect(usePlannerEventStore.getState().eventKind).toBeNull();
  });

  it("stops at a choice that cannot be taken now, so its reason can be read, and does not take it", () => {
    renderHud();
    setGuests(40);
    // Something stands on the floor, so rows of chairs cannot be laid.
    setPlaced(rounds(1));
    fireEvent.click(stepKey("layout"));
    const styles = choices("How to lay the room");
    const [banquet, theatre] = [nth(styles.radios, 0), nth(styles.radios, 1)];
    expect(theatre.getAttribute("aria-disabled")).toBe("true");
    expect(theatre.textContent).toContain("Needs an empty floor");
    banquet.focus();
    fireEvent.keyDown(banquet, { key: "ArrowRight" });
    expect(document.activeElement).toBe(theatre);
    expect(theatre.getAttribute("aria-checked")).toBe("false");
    expect(banquet.getAttribute("aria-checked")).toBe("true");
    expect(styles.stops()).toEqual(["0", "-1"]);
  });

  it("goes round a chosen table's three cloths the same way, dressing it as it goes", () => {
    renderHud();
    setPlaced(rounds(1, 8, "bare"));
    act(() => { useSelectionStore.getState().selectMultiple([nth(tables(), 0).id]); });
    const cloths = choices("The cloth on this table");
    // "No cloth" is what it wears, so that is the group's one stop.
    expect(cloths.stops()).toEqual(["-1", "-1", "0"]);
    const [ivory, , none] = [nth(cloths.radios, 0), nth(cloths.radios, 1), nth(cloths.radios, 2)];
    none.focus();
    fireEvent.keyDown(none, { key: "ArrowRight" });
    expect(document.activeElement).toBe(ivory);
    expect(tables()[0]?.clothed).toBe(true);
    expect(ivory.getAttribute("aria-checked")).toBe("true");
    expect(cloths.stops()).toEqual(["0", "-1", "-1"]);
    fireEvent.keyDown(ivory, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(none);
    expect(tables()[0]?.clothed).toBe(false);
  });
});

describe("the primary key and the sheets", () => {
  it("says of the More card whether its sheet is open", () => {
    renderHud();
    const more = screen.getByRole("button", { name: "More furniture" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    press("Escape");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("stands aside while the sheet that carries its move out is open", () => {
    renderHud();
    setGuests(40);
    expect(primaryKey().getAttribute("data-move")).toBe("lay-out");
    fireEvent.click(stepKey("layout"));
    expect(primaryKey().hidden).toBe(true);
  });

  // The Lay out sheet has no act that moves a piece clear of a door: the press itself does it. Hidden with that
  // sheet open, the move had no key at all.
  it("stays where its own press carries the move out, whatever sheet is open", () => {
    renderHud();
    recordDoors();
    setGuests(10);
    setPlaced(roundInADoor());
    expect(primaryKey().getAttribute("data-move")).toBe("clear-door");
    fireEvent.click(stepKey("layout"));
    expect(screen.getByRole("dialog", { name: "Lay out" })).toBeTruthy();
    expect(primaryKey().hidden).toBe(false);
    fireEvent.click(primaryKey());
    expect(doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
  });
});

interface WatchStandIn {
  /** What to call to tell each watcher of `target` that it has changed. */
  readonly watching: (target: Element) => (() => void)[];
  /** Which box of `target` each of its watchers was asked to watch; "content-box" is a watcher's own choice when not told. */
  readonly boxes: (target: Element) => ResizeObserverBoxOptions[];
  readonly restore: () => void;
}

/** Every ResizeObserver made while this stands in, with what each watches: a test's page lays nothing out, and calls none. */
function standInForResizeObserver(): WatchStandIn {
  const made: { readonly callback: () => void; readonly targets: Map<Element, ResizeObserverBoxOptions> }[] = [];
  class Watcher implements ResizeObserver {
    private readonly entry: { readonly callback: () => void; readonly targets: Map<Element, ResizeObserverBoxOptions> };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback: () => { callback([], this); }, targets: new Map() };
      made.push(this.entry);
    }
    observe(target: Element, options?: ResizeObserverOptions): void { this.entry.targets.set(target, options?.box ?? "content-box"); }
    unobserve(target: Element): void { this.entry.targets.delete(target); }
    disconnect(): void { this.entry.targets.clear(); }
  }
  vi.stubGlobal("ResizeObserver", Watcher);
  return {
    watching: (target) => made.filter((one) => one.targets.has(target)).map((one) => one.callback),
    boxes: (target) => made.flatMap((one) => { const box = one.targets.get(target); return box === undefined ? [] : [box]; }),
    restore: () => { vi.unstubAllGlobals(); },
  };
}

// The shelf grows with what it holds, and a sheet hangs from its real top. The screen says how tall the shelf
// stands, and the stylesheet sizes the sheets from that: from a fixed measure, a sheet rose over the top bar by as
// much as the shelf had grown (a phone's safe area, a status line on two lines).
describe("the shelf's own height", () => {
  function measureAs(heights: { readonly bar: number; shelf: number }): () => void {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measured(this: HTMLElement): DOMRect {
      const tall = this.classList.contains("hud-bar") ? heights.bar : this.classList.contains("hud-shelf") ? heights.shelf : 0;
      return { x: 0, y: 0, width: 0, height: tall, top: 0, right: 0, bottom: tall, left: 0, toJSON: () => ({}) };
    });
    return () => { measure.mockRestore(); };
  }

  it("is said to the stylesheet as the screen opens, rounded up, and again whenever the shelf changes", () => {
    const observers = standInForResizeObserver();
    const heights = { bar: 48, shelf: 237.4 };
    const restore = measureAs(heights);
    try {
      renderHud();
      const root = screen.getByTestId("planner-hud");
      expect(root.style.getPropertyValue("--hud-shelf-real")).toBe("238px");
      // The bar's own measure is unharmed.
      expect(useHallViewStore.getState().stage).toEqual({ skyPx: 48 });

      // A status line wraps to a second line: the shelf is taller, and says so.
      heights.shelf = 262;
      const told = observers.watching(shelf());
      expect(told.length).toBeGreaterThan(0);
      act(() => { for (const tell of told) tell(); });
      expect(root.style.getPropertyValue("--hud-shelf-real")).toBe("262px");

      // Both are watched by their outer edge, which is what is measured. A phone's safe area is padding: turned on
      // its side, the shelf changes height by its padding alone, and a watch on what is inside it is never told.
      const bar = root.querySelector(".hud-bar");
      expect(bar).not.toBeNull();
      expect(observers.boxes(shelf())).toEqual(["border-box"]);
      expect(bar === null ? [] : observers.boxes(bar)).toEqual(["border-box"]);
    } finally {
      restore();
      observers.restore();
    }
  });

  it("leaves the stylesheet its own measure where the shelf cannot be measured", () => {
    const restore = measureAs({ bar: 48, shelf: 0 });
    try {
      renderHud();
      expect(screen.getByTestId("planner-hud").style.getPropertyValue("--hud-shelf-real")).toBe("");
    } finally {
      restore();
    }
  });

  it("is what the stylesheet sizes every sheet from", async () => {
    const css = (await readFile(resolve("src/components/planner-hud/hud.css"), "utf-8")).replace(/\/\*[\s\S]*?\*\//g, "");
    // The measure the screen says, and the fixed one until it has.
    expect(css).toMatch(/--hud-shelf-now:\s*var\(--hud-shelf-real,\s*var\(--hud-shelf-h\)\);/);
    // A sheet's height, Lay out's, and how far the shelf may rise: all three from the shelf as it stands.
    expect(css).toMatch(/\.hud-sheet\s*\{[^}]*max-height:\s*calc\(var\(--hud-rise\) - var\(--hud-shelf-now\)\);/);
    expect(css).toMatch(/\.hud-sheet\[data-sheet="layout"\]\s*\{\s*max-height:\s*calc\(100dvh - var\(--hud-bar-all\) - var\(--hud-shelf-now\)\);/);
    expect(css).toMatch(/--hud-rise:\s*max\(60dvh,\s*min\(100dvh - var\(--hud-bar-all\),\s*var\(--hud-shelf-now\) \+ var\(--hud-sheet-need\)\)\);/);
    // And no sheet is sized from the fixed measure any more.
    expect(css).not.toMatch(/max-height:[^;]*var\(--hud-shelf-h\)/);
  });
});

// Lay out says more once a count is typed, and its act comes last. Where the sheet is too short to show all of it,
// it is slid to its end as it opens and whenever the prompt grows (HudSheets.tsx): the act is never under a scroll.
describe("the Lay out sheet in a short window", () => {
  /** The sheet's scroll measures, and the prompt's height: a test's page has none of its own. */
  function standInForLayout(sizes: { scrollHeight: number; clientHeight: number; prompt: number }): () => void {
    const own = (name: "scrollHeight" | "clientHeight"): void => {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement): number { return this.classList.contains("hud-sheet") ? sizes[name] : 0; },
      });
    };
    own("scrollHeight");
    own("clientHeight");
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measured(this: HTMLElement): DOMRect {
      const tall = this.classList.contains("hud-sheet__section") ? sizes.prompt : 0;
      return { x: 0, y: 0, width: 0, height: tall, top: 0, right: 0, bottom: tall, left: 0, toJSON: () => ({}) };
    });
    return () => {
      measure.mockRestore();
      // Back to the page's own (the prototype chain's) once the stand-ins are gone.
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    };
  }

  function openLayout(): { readonly sheet: HTMLElement; readonly prompt: HTMLElement } {
    renderHud();
    setGuests(60);
    fireEvent.click(stepKey("layout"));
    const sheet = screen.getByRole("dialog", { name: "Lay out" });
    const prompt = sheet.querySelector<HTMLElement>(".hud-sheet__section");
    if (prompt === null) throw new Error("the Lay out sheet has no prompt");
    return { sheet, prompt };
  }

  it("is slid to its end as it opens, and again each time its prompt grows", () => {
    const observers = standInForResizeObserver();
    const sizes = { scrollHeight: 546, clientHeight: 337, prompt: 180 };
    const restore = standInForLayout(sizes);
    try {
      const { sheet, prompt } = openLayout();
      expect(sheet.scrollTop).toBe(546);

      // Someone scrolls back up to read the title, then types a count: the prompt says more, and the act is brought back into sight.
      sheet.scrollTop = 0;
      sizes.prompt = 308;
      sizes.scrollHeight = 674;
      const told = observers.watching(prompt);
      expect(told).toHaveLength(1);
      act(() => { for (const tell of told) tell(); });
      expect(sheet.scrollTop).toBe(674);

      // The prompt shrinking again (the count cleared) moves nothing: they are reading where they are.
      sheet.scrollTop = 120;
      sizes.prompt = 180;
      act(() => { for (const tell of told) tell(); });
      expect(sheet.scrollTop).toBe(120);

      // And growing once more slides it again, from the height it shrank to.
      sizes.prompt = 250;
      act(() => { for (const tell of told) tell(); });
      expect(sheet.scrollTop).toBe(674);
    } finally {
      restore();
      observers.restore();
    }
  });

  it("is left where it is when all of it is in sight", () => {
    const observers = standInForResizeObserver();
    const sizes = { scrollHeight: 418, clientHeight: 420, prompt: 180 };
    const restore = standInForLayout(sizes);
    try {
      const { sheet, prompt } = openLayout();
      expect(sheet.scrollTop).toBe(0);
      sizes.prompt = 200;
      act(() => { for (const tell of observers.watching(prompt)) tell(); });
      expect(sheet.scrollTop).toBe(0);
    } finally {
      restore();
      observers.restore();
    }
  });

  it("stops watching its prompt as it shuts", () => {
    const observers = standInForResizeObserver();
    const restore = standInForLayout({ scrollHeight: 546, clientHeight: 337, prompt: 180 });
    try {
      const { prompt } = openLayout();
      expect(observers.watching(prompt)).toHaveLength(1);
      press("Escape");
      expect(observers.watching(prompt)).toHaveLength(0);
    } finally {
      restore();
      observers.restore();
    }
  });
});
