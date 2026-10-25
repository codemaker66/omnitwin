import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Catalogue, nothingFoundLine } from "../Catalogue.js";
import { cardChoices, placedCount } from "../CatalogueCard.js";
import { CARD_TABS, CATALOGUE_CARDS, searchCatalogue } from "../../../lib/card-defaults.js";
import { cardNeeds } from "../../../lib/card-stock.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { useEscapeLayer } from "../../../lib/planner-keys.js";
import { cardMainItem, cardParamsFor, pieceCardId } from "../../../lib/setup-cards.js";
import { useCardsStore } from "../../../stores/cards-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";

// ---------------------------------------------------------------------------
// The catalogue, "More" (T-671 slice 12′; card-dock spec §3, §4, §5, §12,
// §15): shut until something opens it; five tabs over the cards in their
// order; search across the tabs, Enter arming the first and an empty search
// saying so plainly; a card clicked is in hand while the catalogue stays
// open, the card again puts it down, a swatch puts that piece in hand; the
// placed pip and the seat chip; one tab stop moved by the arrows; and Esc,
// through the planner's one keyboard owner, closing it.
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  useCardsStore.getState().reset();
  useCatalogueStore.getState().disarm();
  usePlacementStore.getState().clearAll();
});
afterEach(cleanup);

function openCatalogue(): void {
  act(() => { useCardsStore.getState().openCatalogue(); });
}

function catalogue(): HTMLElement {
  return screen.getByRole("region", { name: "Catalogue" });
}

function row(): HTMLElement {
  return within(catalogue()).getByRole("toolbar");
}

/** The cards in the row, by their own buttons (a swatch is a button too, in its own group). */
function cardButtons(): HTMLElement[] {
  return Array.from(row().querySelectorAll<HTMLElement>(".pc-ccard__face"));
}

function cardNames(): (string | null)[] {
  return Array.from(row().querySelectorAll(".pc-ccard__name")).map((name) => name.textContent);
}

function cardNamed(name: string): HTMLElement {
  const card = cardButtons().find((button) => button.querySelector(".pc-ccard__name")?.textContent === name);
  if (card === undefined) throw new Error(`no card named ${name}`);
  return card;
}

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no catalogue piece ${slug}`);
  return item.id;
}

describe("shut and open", () => {
  it("draws nothing while shut", () => {
    render(<Catalogue />);
    expect(screen.queryByRole("region", { name: "Catalogue" })).toBeNull();
  });

  it("opens as a panel with the five tabs and the first tab's cards in their order", () => {
    render(<Catalogue />);
    openCatalogue();
    const tabs = within(catalogue()).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([...CARD_TABS]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(cardNames()).toEqual(CATALOGUE_CARDS.filter((card) => card.tab === "Tables").map((card) => card.name));
  });

  it("shows another tab's cards when that tab is chosen, by a click or by the arrows", () => {
    render(<Catalogue />);
    openCatalogue();
    fireEvent.click(within(catalogue()).getByRole("tab", { name: "AV" }));
    expect(useCardsStore.getState().tab).toBe("AV");
    expect(cardNames()).toEqual(CATALOGUE_CARDS.filter((card) => card.tab === "AV").map((card) => card.name));
    fireEvent.keyDown(within(catalogue()).getByRole("tab", { name: "AV" }), { key: "ArrowRight" });
    expect(useCardsStore.getState().tab).toBe("Other");
    expect(document.activeElement?.textContent).toBe("Other");
  });

  it("dims a card that cannot go down here, says why, and will not arm it", () => {
    render(<Catalogue disabledReasonFor={(card) => (card.name === "Dance floor" ? "The Saloon has no room for a 4.6 m floor" : undefined)} />);
    openCatalogue();
    fireEvent.click(within(catalogue()).getByRole("tab", { name: "Staging" }));
    const dance = cardNamed("Dance floor");
    expect(dance.getAttribute("aria-disabled")).toBe("true");
    expect(dance.getAttribute("aria-label")).toBe("Dance floor, 4.6 metres square: The Saloon has no room for a 4.6 m floor");
    fireEvent.click(dance);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });
});

describe("search", () => {
  it("finds cards across the tabs, and Enter arms the first", () => {
    render(<Catalogue />);
    openCatalogue();
    const search = within(catalogue()).getByRole("searchbox", { name: "Search the catalogue" });
    fireEvent.change(search, { target: { value: "mic" } });
    const expected = searchCatalogue("mic").map((card) => card.name);
    expect(expected.length).toBeGreaterThan(1);
    expect(cardNames()).toEqual(expected);
    // No tab is chosen while the row shows results.
    expect(within(catalogue()).getAllByRole("tab").every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(useCatalogueStore.getState().armedCardId).toBe(searchCatalogue("mic")[0]?.id);
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
  });

  it("says plainly when nothing is called that", () => {
    render(<Catalogue />);
    openCatalogue();
    fireEvent.change(within(catalogue()).getByRole("searchbox", { name: "Search the catalogue" }), { target: { value: "zzzz" } });
    expect(within(catalogue()).getByRole("status").textContent).toBe("Nothing called “zzzz” in the catalogue");
    expect(nothingFoundLine(" zzzz ")).toBe("Nothing called “zzzz” in the catalogue");
  });

  it("opens and searches on /, and a / typed in the search is only typing", () => {
    render(<Catalogue />);
    fireEvent.keyDown(window, { key: "/", code: "Slash" });
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    const search = within(catalogue()).getByRole("searchbox", { name: "Search the catalogue" });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "/", code: "Slash" });
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
  });
});

describe("arming", () => {
  it("arms a card on a click and stays open; the card again puts it down", () => {
    render(<Catalogue />);
    openCatalogue();
    const round = cardNamed("Round of 10");
    expect(round.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    expect(cardNamed("Round of 10").getAttribute("aria-pressed")).toBe("true");
    expect(useCardsStore.getState().arms.round).toBe(1);
    fireEvent.click(cardNamed("Round of 10"));
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(cardNamed("Round of 10").getAttribute("aria-pressed")).toBe("false");
  });

  it("arms the piece a swatch names, and the card then puts that piece down", () => {
    render(<Catalogue />);
    openCatalogue();
    fireEvent.click(within(catalogue()).getByRole("button", { name: "Trestle 6 ft, Black" }));
    expect(useCatalogueStore.getState().armedCardId).toBe(pieceCardId("trestle-6ft-black"));
    expect(cardNamed("Trestle 6 ft").getAttribute("aria-pressed")).toBe("true");
    expect(within(catalogue()).getByRole("button", { name: "Trestle 6 ft, Black" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(cardNamed("Trestle 6 ft"));
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });

  it("changes only the cloth of a setup in hand, keeping its seats", () => {
    render(<Catalogue />);
    openCatalogue();
    fireEvent.click(cardNamed("Round of 10"));
    act(() => { useCatalogueStore.getState().stepArmedCard(1); });
    fireEvent.click(within(catalogue()).getByRole("button", { name: "Round of 11, Black" }));
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ card: "round", seats: 11, colourway: "black" });
    expect(cardNamed("Round of 11").getAttribute("aria-pressed")).toBe("true");
  });

  it("finds every card's piece in the catalogue, so none is dimmed for want of it", () => {
    const unheld = CATALOGUE_CARDS.filter((card) => {
      const params = cardParamsFor(card.id, {}, {});
      return params === null || cardMainItem(params) === undefined;
    }).map((card) => card.name);
    expect(unheld).toEqual([]);
  });

  it("offers a card's sizes or its colours, never a mixture", () => {
    for (const card of CATALOGUE_CARDS) {
      const choices = cardChoices(card);
      expect(choices.every((option) => option.text === null) || choices.every((option) => option.text !== null)).toBe(true);
    }
    const stage = CATALOGUE_CARDS.find((card) => card.name === "Stage deck");
    expect(stage === undefined ? [] : cardChoices(stage).map((option) => option.text)).toEqual(["8×4", "6×4", "6×3", "Narrow"]);
  });
});

describe("what a card says", () => {
  it("shows the room's count of a card's pieces, its variants together, from one up", () => {
    render(<Catalogue />);
    openCatalogue();
    expect(cardNamed("Trestle 6 ft").querySelector(".pc-ccard__pip")).toBeNull();
    act(() => {
      const placement = usePlacementStore.getState();
      placement.placeItem(idOf("trestle-6ft-white"), 0, 0);
      placement.placeItem(idOf("trestle-6ft-black"), 4, 0);
      placement.placeItem(idOf("trestle-6ft-wooden"), 8, 0);
    });
    expect(usePlacementStore.getState().placedItems).toHaveLength(3);
    expect(cardNamed("Trestle 6 ft").querySelector(".pc-ccard__pip")?.textContent).toBe("×3");
    expect(cardNamed("Trestle 6 ft").getAttribute("aria-label")).toContain("3 in this room");
    expect(cardNamed("Trestle 4 ft").querySelector(".pc-ccard__pip")).toBeNull();
  });

  it("counts a setup by its main piece in any of its cloths", () => {
    const round = CATALOGUE_CARDS.find((card) => card.id === "round");
    if (round === undefined) throw new Error("no Round of 10 card");
    const counts = new Map([["round-table-6ft-white", 2], ["round-table-6ft-black", 1], ["trestle-6ft", 5]]);
    expect(placedCount(round, counts)).toBe(3);
  });

  it("carries a seat chip on seating pieces only", () => {
    render(<Catalogue />);
    openCatalogue();
    expect(cardNamed("Round of 10").querySelector(".pc-ccard__seats")?.textContent).toBe("10");
    expect(cardNamed("Round of 10").getAttribute("aria-label")).toBe("Round of 10, 1.8 metres round, 10 seats");
    expect(cardNamed("Cake table").querySelector(".pc-ccard__seats")).toBeNull();
    fireEvent.click(within(catalogue()).getByRole("tab", { name: "Chairs" }));
    expect(row().querySelector(".pc-ccard__seats")).toBeNull();
  });
});

describe("keys", () => {
  it("keeps one tab stop that ← → Home End move, and a press arms the card at it", () => {
    render(<Catalogue />);
    openCatalogue();
    const stops = (): HTMLElement[] => cardButtons().filter((button) => button.tabIndex === 0);
    expect(stops()).toEqual([cardButtons()[0]]);
    act(() => { cardButtons()[0]?.focus(); });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cardButtons()[1]);
    expect(stops()).toEqual([cardButtons()[1]]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    const last = cardButtons()[cardButtons().length - 1];
    expect(document.activeElement).toBe(last);
    expect(stops()).toEqual([last]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(cardButtons()[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cardButtons()[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    // Enter and Space press a button by the browser's own click; the planner's keys leave a focused button's Enter alone.
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(useCatalogueStore.getState().armedCardId).toBe(CATALOGUE_CARDS[1]?.id);
    expect(stops()).toHaveLength(1);
  });

  it("closes on Esc when nothing is in hand", () => {
    render(<Catalogue />);
    openCatalogue();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "Catalogue" })).toBeNull();
  });

  it("lets the card in hand take the first Esc, then closes on the next", () => {
    function HandLayer(): null {
      useEscapeLayer("operation", {
        open: () => useCatalogueStore.getState().armedCardId !== null,
        onEscape: () => { useCatalogueStore.getState().disarm(); },
      });
      return null;
    }
    render(<><HandLayer /><Catalogue /></>);
    openCatalogue();
    fireEvent.click(cardNamed("Round of 10"));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
  });
});

describe("the store (staff; Blake's B2, hard)", () => {
  function roundStock(whole: number): Map<string, number> {
    const params = cardParamsFor("round", {});
    if (params === null) throw new Error("no round card");
    return new Map([...cardNeeds(params)].map(([id, need]) => [id, need * whole]));
  }

  it("shows a card's store figure under its size, and says it", () => {
    useCardsStore.getState().setStock(roundStock(22));
    openCatalogue();
    render(<Catalogue />);
    const round = cardButtons().find((face) => face.getAttribute("aria-label")?.startsWith("Round of 10,") === true) as HTMLElement;
    expect(round.querySelector(".pc-ccard__store")?.textContent).toBe("×22 in store");
    expect(round.getAttribute("aria-label")).toContain("22 in store");
  });

  it("will not arm a card the store has none left of, and says why", () => {
    useCardsStore.getState().setStock(roundStock(0));
    openCatalogue();
    render(<Catalogue />);
    const round = cardButtons().find((face) => face.getAttribute("aria-label")?.startsWith("Round of 10,") === true) as HTMLElement;
    expect(round.querySelector(".pc-ccard__store")?.textContent).toBe("None left");
    expect(round.getAttribute("aria-label")).toContain("None left in store");
    expect(round.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });

  it("shows no figure to anyone without stock", () => {
    openCatalogue();
    render(<Catalogue />);
    expect(catalogue().textContent).not.toContain("in store");
  });
});

describe("the cards' pictures (Q-21)", () => {
  it("shows a setup card as its whole set, and a piece card as its piece", () => {
    openCatalogue();
    render(<Catalogue />);
    const art = (prefix: string): string => cardButtons().find((face) => face.getAttribute("aria-label")?.startsWith(prefix) === true)?.querySelector("img")?.getAttribute("src") ?? "";
    expect(art("Round of 10,")).toMatch(/^\/models\/furniture\/setup\/round\/setup-v1\/(white|black|bare)\.webp$/u);
    expect(art("Round 6 ft,")).not.toContain("/setup/");
  });
});
