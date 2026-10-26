import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  type RefObject,
  type WheelEvent,
} from "react";
import { Search } from "lucide-react";
import { CARD_TABS, CATALOGUE_CARDS, searchCatalogue, type CardTab, type CatalogueCard } from "../../lib/card-defaults.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { KEY_PRIORITY, lastInputWasKeys, useEscapeLayer, usePlannerKeyBindings } from "../../lib/planner-keys.js";
import { cardMainItem, cardParamsFor, pieceCardId, type CardId } from "../../lib/setup-cards.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringValue } from "../../lib/use-spring-value.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { cardFaceNow, FullCard, isCardArmed, placedCount, type CardChoice } from "./CatalogueCard.js";
import { Kbd } from "./Kbd.js";
import { Key } from "./Keys.js";
import "./chrome.css";
import "./catalogue.css";

// ---------------------------------------------------------------------------
// The catalogue, "More" (card-dock spec §2, §3, §5, §12, §15; T-671 slice 12′).
//
// It rises 8 px above the rail when More, Add, A or / opens it, never on
// hover and never by itself: tabs (Tables · Chairs · Staging · AV · Other),
// "Search the catalogue" (/), and one row of full cards that scrolls. A card
// clicked is in hand and the catalogue stays open while it is; the card again
// puts it down. ← → Home End move between the cards (one tab stop), Enter or
// Space arms. It is a panel in the planner's one Escape order, under the card
// in hand: Esc puts the card down first, then closes the catalogue.
// ---------------------------------------------------------------------------

/** How far the sheet sits below its place before it rises: its own height. */
const CLOSED_OFFSET_PX = 192;
/** If no frame ever comes (a hidden tab), the sinking sheet still goes. */
const LEAVE_FALLBACK_MS = 600;

/**
 * The most cards any tab holds. The sheet is as wide as that row needs (spec
 * §2), so it keeps one width from tab to tab and nothing moves under the
 * pointer; narrower than that, the row scrolls.
 */
const WIDEST_TAB_CARDS = Math.max(...CARD_TABS.map((name) => CATALOGUE_CARDS.filter((card) => card.tab === name).length));

/** Why a card cannot be armed at all: its main piece is not in this catalogue. */
const UNHELD_REASON = "Not in this venue's catalogue";

const UNHELD: ReadonlySet<CardId> = new Set(
  CATALOGUE_CARDS.filter((card) => {
    const params = cardParamsFor(card.id, {}, {});
    return params === null || cardMainItem(params) === undefined;
  }).map((card) => card.id),
);

/** What an empty search says: plainly, with the words typed. */
export function nothingFoundLine(query: string): string {
  return `Nothing called “${query.trim()}” in the catalogue`;
}

/** The pieces in the room, counted by slug. */
function countBySlug(placed: readonly { readonly catalogueItemId: string }[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of placed) {
    const slug = getCatalogueItem(item.catalogueItemId)?.slug;
    if (slug !== undefined) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}

/** Puts a card in hand, or down again; counts the arm for the rail's first-arms hint. */
function pressCard(card: CatalogueCard): void {
  const store = useCatalogueStore.getState();
  // The card in hand again puts it down, whichever of its pieces is in hand.
  const target = isCardArmed(card, store.armedCardId) && store.armedCardId !== null ? store.armedCardId : card.id;
  if (store.toggleCard(target)) useCardsStore.getState().noteArm(target);
}

/** A swatch or a size: that piece in hand. A setup in hand keeps its seats and changes only its cloth. */
function chooseOnCard(card: CatalogueCard, choice: CardChoice): void {
  const store = useCatalogueStore.getState();
  if (choice.kind === "colourway") {
    if (store.armedCardId === card.id && store.setCardParams({ colourway: choice.colourway })) return;
    if (store.armCard(card.id, { colourway: choice.colourway })) useCardsStore.getState().noteArm(card.id);
    return;
  }
  const id = pieceCardId(choice.slug);
  if (store.armedCardId === id) return;
  if (store.armCard(id)) useCardsStore.getState().noteArm(id);
}

export interface CatalogueProps {
  /**
   * Why a card cannot go down in this room now ("The Saloon has no room for a
   * 4.6 m floor"), or undefined when it can. The card is dimmed and says why.
   */
  readonly disabledReasonFor?: (card: CatalogueCard) => string | undefined;
  /** The key that opened the catalogue (More), which takes focus back when Esc closes it. */
  readonly returnFocusTo?: () => HTMLElement | null;
  readonly className?: string;
}

/**
 * The catalogue panel. It holds `/` (search the catalogue, opening it if it is
 * shut) and its place in the Escape order; it draws nothing while shut.
 */
export function Catalogue({ disabledReasonFor, returnFocusTo, className }: CatalogueProps): ReactElement | null {
  const open = useCardsStore((state) => state.catalogueOpen);
  const [leaving, setLeaving] = useState(false);
  const wasOpen = useRef(open);
  const searchRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const wantsSearch = useRef(false);
  const openedFrom = useRef<HTMLElement | null>(null);

  // Closing lets the sheet sink before it goes; opening again cancels the sink.
  useLayoutEffect(() => {
    if (wasOpen.current && !open) setLeaving(true);
    if (open) {
      setLeaving(false);
      const active = document.activeElement;
      if (!wasOpen.current) openedFrom.current = active instanceof HTMLElement ? active : null;
    }
    wasOpen.current = open;
  }, [open]);

  useEscapeLayer("panel", {
    open: () => useCardsStore.getState().catalogueOpen,
    onEscape: () => { useCardsStore.getState().closeCatalogue(); },
    returnFocusTo: () => {
      const sheet = sheetRef.current;
      // Focus goes back only from inside the catalogue; elsewhere it stays put.
      if (sheet === null || !sheet.contains(document.activeElement)) return null;
      return returnFocusTo?.() ?? openedFrom.current;
    },
  });

  usePlannerKeyBindings([
    {
      keys: [{ key: "/" }],
      priority: KEY_PRIORITY.planner,
      run: () => {
        const cards = useCardsStore.getState();
        if (!cards.catalogueOpen) {
          wantsSearch.current = true;
          cards.openCatalogue();
          return true;
        }
        searchRef.current?.focus();
        searchRef.current?.select();
        return true;
      },
    },
  ]);

  if (!open && !leaving) return null;
  return (
    <CatalogueSheet
      sheetRef={sheetRef}
      open={open}
      searchRef={searchRef}
      wantsSearch={wantsSearch}
      disabledReasonFor={disabledReasonFor}
      className={className}
      onLeft={() => { setLeaving(false); }}
    />
  );
}

interface CatalogueSheetProps {
  readonly sheetRef: RefObject<HTMLElement>;
  /** False while it sinks away. */
  readonly open: boolean;
  readonly searchRef: RefObject<HTMLInputElement>;
  readonly wantsSearch: MutableRefObject<boolean>;
  readonly disabledReasonFor?: (card: CatalogueCard) => string | undefined;
  readonly className?: string;
  readonly onLeft: () => void;
}

function CatalogueSheet({ sheetRef, open, searchRef, wantsSearch, disabledReasonFor, className, onLeft }: CatalogueSheetProps): ReactElement {
  const tab = useCardsStore((state) => state.tab);
  const query = useCardsStore((state) => state.query);
  const armedCardId = useCatalogueStore((state) => state.armedCardId);
  const cardParams = useCatalogueStore((state) => state.cardParams);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const placedBySlug = useMemo(() => countBySlug(placedItems), [placedItems]);
  const ids = useId();
  const tabsRef = useRef(new Map<CardTab, HTMLButtonElement>());
  const cardsRef = useRef(new Map<CardId, HTMLButtonElement>());
  const [rovingId, setRovingId] = useState<CardId | null>(null);
  const [risen, setRisen] = useState(false);

  const searching = query.trim().length > 0;
  const cards = useMemo(
    () => (searching ? searchCatalogue(query) : CATALOGUE_CARDS.filter((card) => card.tab === tab)),
    [query, searching, tab],
  );
  const armedHere = cards.find((card) => isCardArmed(card, armedCardId))?.id;
  // The one tab stop: the card last focused, else the card in hand, else the first.
  const stop = rovingId !== null && cards.some((card) => card.id === rovingId) ? rovingId : (armedHere ?? cards[0]?.id ?? null);

  // Rises on sheetSettle from the rail's edge (a clip, so nothing stretches); sinks the same way, then goes.
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const latestLeft = useRef(onLeft);
  latestLeft.current = onLeft;
  useSpringValue(open && risen ? 0 : CLOSED_OFFSET_PX, SPRING_PRESETS.sheetSettle, (value) => {
    sheetRef.current?.style.setProperty("--pc-catalogue-rise", `${String(Math.round(value * 100) / 100)}px`);
    if (!latestOpen.current && value >= CLOSED_OFFSET_PX) latestLeft.current();
  });
  useLayoutEffect(() => {
    sheetRef.current?.style.setProperty("--pc-catalogue-cards", String(WIDEST_TAB_CARDS));
  }, [sheetRef]);
  useEffect(() => { setRisen(true); }, []);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    // Sinking, it takes no clicks and no focus.
    if (open) {
      sheet.removeAttribute("inert");
      return;
    }
    sheet.setAttribute("inert", "");
    const timer = window.setTimeout(() => { latestLeft.current(); }, LEAVE_FALLBACK_MS);
    return () => { window.clearTimeout(timer); };
  }, [open, sheetRef]);

  // Opened by /, the search has focus; opened from the keys otherwise, the card stop does.
  const firstStop = useRef(stop);
  useEffect(() => {
    if (wantsSearch.current) {
      wantsSearch.current = false;
      searchRef.current?.focus();
      return;
    }
    const first = firstStop.current;
    if (lastInputWasKeys() && first !== null) cardsRef.current.get(first)?.focus();
  }, [searchRef, wantsSearch]);

  const focusCard = (id: CardId): void => {
    setRovingId(id);
    const button = cardsRef.current.get(id);
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onCardsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = cards.findIndex((card) => card.id === stop);
    let next: CatalogueCard | undefined;
    if (event.key === "ArrowRight") next = cards[Math.min(cards.length - 1, index + 1)];
    else if (event.key === "ArrowLeft") next = cards[Math.max(0, index - 1)];
    else if (event.key === "Home") next = cards[0];
    else if (event.key === "End") next = cards[cards.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    focusCard(next.id);
  };

  // A plain wheel scrolls the row sideways: the row is all there is to scroll.
  const onCardsWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const rowElement = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (rowElement.scrollWidth <= rowElement.clientWidth) return;
    rowElement.scrollLeft += event.deltaY;
  };

  const chooseTab = (next: CardTab): void => {
    const store = useCardsStore.getState();
    if (store.query !== "") store.setQuery("");
    store.setTab(next);
    tabsRef.current.get(next)?.focus();
  };

  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = CARD_TABS.indexOf(tab);
    let next: CardTab | undefined;
    if (event.key === "ArrowRight") next = CARD_TABS[(index + 1) % CARD_TABS.length];
    else if (event.key === "ArrowLeft") next = CARD_TABS[(index - 1 + CARD_TABS.length) % CARD_TABS.length];
    else if (event.key === "Home") next = CARD_TABS[0];
    else if (event.key === "End") next = CARD_TABS[CARD_TABS.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    chooseTab(next);
  };

  const reasonFor = (card: CatalogueCard): string | undefined =>
    UNHELD.has(card.id) ? UNHELD_REASON : disabledReasonFor?.(card);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = cards[0];
      // Enter arms the first result; it never puts down a card already in hand.
      if (first === undefined || reasonFor(first) !== undefined) return;
      if (!isCardArmed(first, useCatalogueStore.getState().armedCardId)) pressCard(first);
      return;
    }
    if (event.key === "ArrowDown" && stop !== null) {
      event.preventDefault();
      focusCard(stop);
    }
  };

  const panelId = `${ids}-cards`;
  const tabId = (name: CardTab): string => `${ids}-tab-${name}`;
  const rowLabel = searching ? `Results for “${query.trim()}”` : `${tab} cards`;

  return (
    <section
      ref={sheetRef}
      className={["pc-lacquer", "pc-lacquer--raised", "pc-catalogue", className ?? ""].filter(Boolean).join(" ")}
      role="region"
      aria-label="Catalogue"
      aria-hidden={open ? undefined : true}
      data-testid="planner-catalogue"
    >
      <div className="pc-catalogue__head">
        <div className="pc-catalogue__tabs" role="tablist" aria-label="Kinds of furniture" onKeyDown={onTabsKeyDown}>
          {CARD_TABS.map((name) => {
            const selected = !searching && name === tab;
            return (
              <Key
                key={name}
                ref={(button) => {
                  if (button === null) tabsRef.current.delete(name);
                  else tabsRef.current.set(name, button);
                }}
                id={tabId(name)}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={name === tab ? 0 : -1}
                label={name}
                small
                on={selected}
                marked
                className="pc-catalogue__tab"
                onPress={() => { chooseTab(name); }}
              />
            );
          })}
        </div>
        <label className="pc-catalogue__search">
          <Search className="pc-icon pc-catalogue__search-icon" aria-hidden="true" />
          <input
            ref={searchRef}
            className="pc-catalogue__input"
            type="search"
            aria-label="Search the catalogue"
            aria-keyshortcuts="/"
            aria-controls={panelId}
            placeholder="Search the catalogue"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => { useCardsStore.getState().setQuery(event.target.value); }}
            onKeyDown={onSearchKeyDown}
          />
          {query === "" ? <span className="pc-catalogue__key" aria-hidden="true"><Kbd>/</Kbd></span> : null}
        </label>
      </div>
      <div
        id={panelId}
        className="pc-catalogue__panel"
        role={searching ? "group" : "tabpanel"}
        aria-labelledby={searching ? undefined : tabId(tab)}
        aria-label={searching ? rowLabel : undefined}
      >
        {cards.length === 0 ? (
          <p className="pc-meta pc-catalogue__empty" role="status">{nothingFoundLine(query)}</p>
        ) : (
          <div
            className="pc-catalogue__cards"
            role="toolbar"
            aria-label={rowLabel}
            aria-orientation="horizontal"
            onKeyDown={onCardsKeyDown}
            onWheel={onCardsWheel}
          >
            {cards.map((card) => {
              const armed = isCardArmed(card, armedCardId);
              return (
                <FullCard
                  key={card.id}
                  ref={(button) => {
                    if (button === null) cardsRef.current.delete(card.id);
                    else cardsRef.current.set(card.id, button);
                  }}
                  card={card}
                  face={cardFaceNow(card, armedCardId, armed ? cardParams : null)}
                  armed={armed}
                  placed={placedCount(card, placedBySlug)}
                  tabIndex={card.id === stop ? 0 : -1}
                  disabledReason={reasonFor(card)}
                  onPress={() => { pressCard(card); }}
                  onChoose={(choice) => { chooseOnCard(card, choice); }}
                  onFocusCard={() => { setRovingId(card.id); }}
                />
              );
            })}
          </div>
        )}
        {searching && cards.length > 0 ? (
          <span className="vv-sr-only" role="status">{`${String(cards.length)} in the catalogue`}</span>
        ) : null}
      </div>
    </section>
  );
}
