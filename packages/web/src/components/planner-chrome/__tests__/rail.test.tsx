import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rail } from "../Rail.js";
import { armOrCancel } from "../card-keys.js";
import { cardNeeds, type UsableStock } from "../../../lib/card-stock.js";
import { SETUP_PREVIEW_VERSION } from "../../../lib/crafted-furniture.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { cardParamsFor, stampSetup } from "../../../lib/setup-cards.js";
import { placedCount, roomCounts } from "../card-counts.js";
import { useCardsStore } from "../../../stores/cards-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRailDropStore } from "../../../stores/rail-drop-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";

// ---------------------------------------------------------------------------
// The rail (T-671 slice 12′; card-dock spec §3, §4, §7.1, §12; Q-13): eight
// named mini-cards and More at rest, armed by a click or by keys 1–8, the
// card again (or its digit) cancelling; never opening anything on hover; the
// hint on a card's first three arms; hidden in Walk; and its place published
// for putting a piece back.
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  useCardsStore.getState().reset();
  useCatalogueStore.getState().disarm();
  useCockpitStore.getState().setWalkMode(false);
  usePlacementStore.getState().clearAll();
  useRailDropStore.getState().reset();
  useSelectionStore.getState().clearSelection();
});
afterEach(() => {
  cleanup();
  setPlannerFeaturesForTesting(null);
});

function rail(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Furniture cards" });
}

describe("at rest", () => {
  it("shows the eight cards with their names and seats, and More", () => {
    render(<Rail />);
    const cards = within(rail()).getAllByRole("button", { pressed: false });
    expect(cards.map((card) => card.querySelector(".pc-railcard__name")?.textContent)).toEqual([
      "Round of 10", "Top table", "Long table", "Dance floor", "Stage", "Bar", "Poseur", "Cake table",
    ]);
    expect(cards[0]?.textContent).toContain("10 seats");
    expect(within(rail()).getByRole("button", { name: /^More/u })).toBeTruthy();
  });

  it("opens nothing on hover", () => {
    render(<Rail />);
    fireEvent.pointerEnter(within(rail()).getAllByRole("button")[0] as HTMLElement, { pointerType: "mouse" });
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });
});

describe("arming", () => {
  it("arms on a click, says so, shows the hint for the first arms, and cancels on the card again", () => {
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
    expect(round.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Click the floor to set it down");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });

  it("arms on keys 1 to 8, the same digit cancelling", () => {
    render(<Rail />);
    fireEvent.keyDown(window, { key: "4", code: "Digit4" });
    expect(useCatalogueStore.getState().armedCardId).toBe("dance-floor");
    fireEvent.keyDown(window, { key: "4", code: "Digit4" });
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
  });

  it("opens the catalogue from More, and More again closes it", () => {
    render(<Rail />);
    const more = within(rail()).getByRole("button", { name: /^More/u });
    fireEvent.click(more);
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(more);
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
  });
});

describe("the ×N in the room (#357 V4: the rail counts as the catalogue does)", () => {
  function pip(name: RegExp): string | null {
    return within(rail()).getByRole("button", { name }).querySelector(".pc-railcard__pip")?.textContent ?? null;
  }

  it("counts rounds in any cloth: twenty black rounds read ×20", () => {
    const black = getCatalogueItemBySlug("round-table-6ft-black")?.id ?? "";
    usePlacementStore.setState({ placedItems: Array.from({ length: 20 }, (_, n) => createPlacedItem(black, n * 3, 0, 0, null)) });
    render(<Rail />);
    expect(pip(/^Round of 10/u)).toBe("×20");
    expect(within(rail()).getByRole("button", { name: /^Round of 10/u }).getAttribute("aria-label")).toContain("20 in the room");
    expect(placedCount("round", roomCounts(usePlacementStore.getState().placedItems))).toBe(20);
  });

  it("tells a Top table from a Long table, and counts sets, not trestles", () => {
    // Sets of four trestles each (Q-08b), bound by their setId.
    setPlannerFeaturesForTesting({ tableSets: true });
    const top = cardParamsFor("top-table", { colourway: "white" });
    const long = cardParamsFor("long-table", { colourway: "white" });
    if (top === null || long === null) throw new Error("no trestle cards");
    usePlacementStore.setState({ placedItems: [
      ...stampSetup(top, { x: 0, z: -8 }, 0),
      ...stampSetup(long, { x: 0, z: 0 }, 0),
      ...stampSetup(long, { x: 0, z: 8 }, 0),
    ] });
    render(<Rail />);
    expect(pip(/^Top table/u)).toBe("×1");
    expect(pip(/^Long table/u)).toBe("×2");
  });

  it("counts a lone trestle with no chairs as neither", () => {
    const trestle = getCatalogueItemBySlug("trestle-6ft-white")?.id ?? "";
    usePlacementStore.setState({ placedItems: [createPlacedItem(trestle, 0, 0, 0, null)] });
    render(<Rail />);
    expect(pip(/^Top table/u)).toBeNull();
    expect(pip(/^Long table/u)).toBeNull();
  });
});

describe("its voice and its keys (#357 V7)", () => {
  it("keeps one status line, empty at rest, that a refusal's words arrive in", () => {
    const params = cardParamsFor("round", {});
    if (params === null) throw new Error("no round card");
    useCardsStore.getState().setStock(new Map([...cardNeeds(params)].map(([id]) => [id, 0])));
    render(<Rail />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe("");
    fireEvent.click(within(rail()).getByRole("button", { name: /^Round of 10/u }));
    expect(screen.getByRole("status")).toBe(line);
    expect(line.textContent).toContain("None left in store");
  });

  it("is one Tab stop, the arrows, Home and End moving between its cards and More", () => {
    render(<Rail />);
    const keys = (): HTMLElement[] => Array.from(rail().querySelectorAll<HTMLElement>(".pc-rail__cards > button, .pc-rail__more"));
    expect(keys()).toHaveLength(9);
    expect(keys().filter((key) => key.tabIndex === 0)).toEqual([keys()[0]]);
    act(() => { keys()[0]?.focus(); });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight", code: "ArrowRight" });
    expect(document.activeElement).toBe(keys()[1]);
    expect(keys().filter((key) => key.tabIndex === 0)).toEqual([keys()[1]]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End", code: "End" });
    expect(document.activeElement).toBe(keys()[8]);
    expect(document.activeElement?.classList.contains("pc-rail__more")).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight", code: "ArrowRight" });
    expect(document.activeElement).toBe(keys()[8]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home", code: "Home" });
    expect(document.activeElement).toBe(keys()[0]);
  });
});

describe("where it shows", () => {
  it("steps aside in Walk", () => {
    render(<Rail />);
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    expect(screen.queryByRole("toolbar", { name: "Furniture cards" })).toBeNull();
  });

  it("publishes its place for putting a piece back, and forgets it when it goes", () => {
    const { unmount } = render(<Rail />);
    expect(useRailDropStore.getState().rect).not.toBeNull();
    unmount();
    expect(useRailDropStore.getState().rect).toBeNull();
  });
});

describe("a card in flight", () => {
  it("is put down silently when released over the rail", () => {
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    fireEvent.pointerDown(round, { pointerId: 1, button: 0, clientX: 300, clientY: 900, pointerType: "mouse" });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 900, pointerType: "mouse" });
    expect(useCatalogueStore.getState().dragActive).toBe(true);
    expect(useCardsStore.getState().inFlight).toBe("round");
    fireEvent.pointerUp(rail(), { pointerId: 1, button: 0, clientX: 320, clientY: 900, pointerType: "mouse" });
    expect(useCatalogueStore.getState().dragActive).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(useCardsStore.getState().inFlight).toBeNull();
  });
});

describe("the store (staff; Blake's B2, hard)", () => {
  function stockOf(card: "round" | "dance-floor", whole: number): UsableStock {
    const params = cardParamsFor(card, {});
    if (params === null) throw new Error(`no ${card} card`);
    return new Map([...cardNeeds(params)].map(([id, need]) => [id, need * whole]));
  }

  it("shows nothing to anyone without stock", () => {
    render(<Rail />);
    expect(rail().textContent).not.toContain("in store");
  });

  it("puts \"×22 in store\" under a card's seats, and says it", () => {
    useCardsStore.getState().setStock(stockOf("round", 22));
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    expect(round.querySelector(".pc-railcard__store")?.textContent).toBe("×22 in store");
    expect(round.getAttribute("aria-label")).toContain("22 in store");
  });

  it("will not arm a card the store has none left of, by click or digit, and says why", () => {
    useCardsStore.getState().setStock(stockOf("round", 0));
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    expect(round.classList.contains("is-empty")).toBe(true);
    expect(round.querySelector(".pc-railcard__store")?.textContent).toBe("None left");
    expect(round.getAttribute("aria-label")).toContain("none left in store");
    expect(round.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("None left in store");
    expect(armOrCancel("round")).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });
});

describe("replace mode (the caption's Replace…)", () => {
  function selectARound(): void {
    const id = getCatalogueItemBySlug("round-table-6ft")?.id ?? "";
    usePlacementStore.setState({ placedItems: [{ id: "t8", catalogueItemId: id, x: 0, y: 0, z: 0, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: "g8", label: "Table 8" }] });
    useSelectionStore.getState().select("t8");
  }

  it("says what it is doing, says what a pointed card would do, and Esc leaves it", () => {
    selectARound();
    render(<Rail />);
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    expect(screen.getByRole("status").textContent).toContain("Replace Table 8 with…");
    fireEvent.pointerOver(within(rail()).getByRole("button", { name: /^Long table/u }));
    expect(useCardsStore.getState().pointedCard).toBe("long-table");
    expect(screen.getByRole("status").textContent).toMatch(/^Replace /u);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useCardsStore.getState().replacing).toBeNull();
  });

  // #357 V5: it outlived its selection, and the next press replaced whatever was selected then.
  it("ends when another piece is selected, so the next press arms instead of replacing it", () => {
    selectARound();
    const bar = createPlacedItem(getCatalogueItemBySlug("bar-counter")?.id ?? "", 6, 0, 0, null);
    usePlacementStore.setState({ placedItems: [...usePlacementStore.getState().placedItems, bar] });
    render(<Rail />);
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    act(() => { useSelectionStore.getState().select(bar.id); });
    expect(useCardsStore.getState().replacing).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("Replace Table 8");
    fireEvent.keyDown(window, { key: "3", code: "Digit3" });
    expect(useCatalogueStore.getState().armedCardId).toBe("long-table");
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === bar.id)).toBe(true);
  });

  it("ends when the selection is cleared, and keeps going while it is the same", () => {
    selectARound();
    render(<Rail />);
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    act(() => { useSelectionStore.getState().select("t8"); });
    expect(useCardsStore.getState().replacing).toBe("Replace Table 8 with…");
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(useCardsStore.getState().replacing).toBeNull();
  });
});

describe("the cards' pictures (Q-21)", () => {
  it("shows a setup card as its whole set, and a piece as itself", () => {
    render(<Rail />);
    const art = (name: RegExp): string => within(rail()).getByRole("button", { name }).querySelector("img")?.getAttribute("src") ?? "";
    const round = art(/^Round of 10/u);
    expect(round).toMatch(new RegExp(`^/models/furniture/setup-round/${SETUP_PREVIEW_VERSION}/(white|black|bare)-(turini|chiavari)\\.webp$`, "u"));
    expect(art(/^Dance floor/u)).toBe(`/models/furniture/setup-dance-floor/${SETUP_PREVIEW_VERSION}/floor.webp`);
    const top = art(/^Top table/u);
    expect(top).toMatch(new RegExp(`^/models/furniture/setup-top-table/${SETUP_PREVIEW_VERSION}/[a-z]+-(one|set)-(turini|chiavari)\\.webp$`, "u"));
    expect(art(/^Stage/u)).not.toContain("/setup-");
    // Every picture a card shows is one the release ships.
    for (const src of [round, top]) expect(existsSync(resolve("public", `.${src}`)), src).toBe(true);
  });

  it("follows the look in hand: a black Round of 10 shows black", () => {
    render(<Rail />);
    act(() => { useCatalogueStore.getState().armCard("round", { colourway: "black" }); });
    const src = within(rail()).getByRole("button", { name: /^Round of 10/u }).querySelector("img")?.getAttribute("src") ?? "";
    // The event's chair is the Turini unless it is a wedding (plannerChairSlug).
    expect(src).toBe(`/models/furniture/setup-round/${SETUP_PREVIEW_VERSION}/black-turini.webp`);
    expect(existsSync(resolve("public", `.${src}`))).toBe(true);
  });
});
