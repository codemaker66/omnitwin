import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { LayoutGrid } from "lucide-react";
import { placedCounts } from "../../lib/card-stock.js";
import { railName } from "../../lib/card-defaults.js";
import { cardParamsFor, type CardId } from "../../lib/setup-cards.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRailDropStore } from "../../stores/rail-drop-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { focusOwnsArrows, useEscapeLayer } from "../../lib/planner-keys.js";
import { placedCount, roomCounts } from "./card-counts.js";
import { armOrCancel, useCardKeys, useRailSlots } from "./card-keys.js";
import { Key } from "./Keys.js";
import { RailCard } from "./RailCard.js";
import { replacePreview } from "./replace-with.js";
import { storeFace, storeRefusalFor } from "./store-figures.js";
import "./chrome.css";
import "./cards.css";

// ---------------------------------------------------------------------------
// The rail (T-671 slice 12′; card-dock spec §2–4, §7.1; Q-13).
//
// Eight named mini-cards and More, joined to the dock's top edge, at rest on
// desktops and laptops (Blake's B1). A click arms a card and it stays armed;
// the card again, its digit or Esc cancels. Dragging a card off the rail
// (4 px with a mouse; 8 px and steeper than 45° with a finger) puts it in
// hand for one release: over the floor the ghost sets it down, over the rail
// it is put back silently. The rail publishes where it stands (C0), steps
// aside in Walk and while the layout is view only, and never opens anything
// on hover.
// ---------------------------------------------------------------------------

/** How long a refusal stays in the hint's place. */
const REFUSAL_MS = 4000;
const HINT_WORDS = ["Click", " the floor to set it down · ", "R", " turns · ", "Esc", " cancels"] as const;

interface PendingDrag {
  readonly card: CardId;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly touch: boolean;
  started: boolean;
}

/** Whether a press has travelled far enough, and steeply enough on a finger, to lift the card. */
function liftsCard(drag: PendingDrag, x: number, y: number): boolean {
  const dx = x - drag.x;
  const dy = y - drag.y;
  if (!drag.touch) return Math.hypot(dx, dy) >= 4;
  return Math.hypot(dx, dy) >= 8 && Math.abs(dy) > Math.abs(dx);
}

/** While replacing, notes which rail card the pointer or focus is on. */
function pointAt(target: EventTarget, slots: readonly CardId[]): void {
  if (useCardsStore.getState().replacing === null || !(target instanceof Element)) return;
  const named = target.closest<HTMLElement>("[data-card]")?.dataset["card"];
  // The rail's own slot, so only a card it holds is ever pointed at.
  const card = slots.find((slot) => slot === named);
  if (card !== undefined && card !== useCardsStore.getState().pointedCard) useCardsStore.getState().setPointedCard(card);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The rail's keys in order, its eight cards then More: one Tab stop between them. */
function railStops(rail: HTMLElement | null): HTMLElement[] {
  return rail === null ? [] : Array.from(rail.querySelectorAll<HTMLElement>(".pc-rail__cards > button, .pc-rail__more"));
}

export function Rail(): ReactElement | null {
  useCardKeys();
  const slots = useRailSlots();
  const style = useCardsStore((state) => state.style);
  const catalogueOpen = useCardsStore((state) => state.catalogueOpen);
  const inFlight = useCardsStore((state) => state.inFlight);
  const hintFor = useCardsStore((state) => state.hintFor);
  const stock = useCardsStore((state) => state.stock);
  const refusal = useCardsStore((state) => state.refusal);
  const replacing = useCardsStore((state) => state.replacing);
  const pointedCard = useCardsStore((state) => state.pointedCard);
  const remembered = useCatalogueStore((state) => state.rememberedSeats);
  const armed = useCatalogueStore((state) => state.armedCardId);
  const walking = useCockpitStore((state) => state.walkMode);
  const viewOnly = useEditorStore((state) => state.lockReason !== null);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const railRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<PendingDrag | null>(null);
  const swallowClick = useRef(false);
  // The one Tab stop among the eight cards and More (index; More is the last).
  const [stop, setStop] = useState(0);
  const hidden = walking || viewOnly;

  // The catalogue's own count (card-counts.ts), so a card says the same "×N" on the rail and in the catalogue.
  const inRoom = useMemo(() => roomCounts(placedItems), [placedItems]);

  const store = useMemo(() => {
    const counts = placedCounts(placedItems);
    return new Map(slots.map((card) => [card, storeFace(cardParamsFor(card, {}, remembered), stock, counts)] as const));
  }, [placedItems, slots, stock, remembered]);

  // Replace mode: Esc steps out of it before anything else it would close.
  useEscapeLayer("operation", { open: replacing !== null, onEscape: () => { useCardsStore.getState().stopReplacing(); } });
  // Replace mode is for the selection it was asked on: another selection, or none, ends it.
  useEffect(() => useSelectionStore.subscribe((state, previous) => {
    if (useCardsStore.getState().replacing !== null && !sameIds(state.selectedIds, previous.selectedIds)) useCardsStore.getState().stopReplacing();
  }), []);
  // What the pointed card would do, said before it does it (lane E's sentence, or why not).
  const preview = useMemo(
    () => (replacing !== null && pointedCard !== null ? replacePreview(pointedCard) : null),
    [replacing, pointedCard, placedItems],
  );

  // A refusal says why for a few seconds, then the rail is quiet again.
  useEffect(() => {
    if (refusal === null) return undefined;
    const timer = window.setTimeout(() => { useCardsStore.getState().setRefusal(null); }, REFUSAL_MS);
    return () => { window.clearTimeout(timer); };
  }, [refusal]);

  // Where the rail stands, for putting a piece back (C0).
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (hidden || rail === null) return;
    const publish = (): void => {
      const box = rail.getBoundingClientRect();
      useRailDropStore.getState().setRect({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
    };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(rail);
    window.addEventListener("resize", publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      useRailDropStore.getState().setRect(null);
    };
  }, [hidden]);

  // A card lifted off the rail follows the pointer over the rail as a token; over the floor the ghost takes it.
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const pending = drag.current;
      if (pending === null || event.pointerId !== pending.pointerId) return;
      if (!pending.started) {
        if (!liftsCard(pending, event.clientX, event.clientY)) return;
        const refused = storeRefusalFor(pending.card);
        if (refused !== null) {
          // None left in store: nothing lifts, and the hint says why.
          useCardsStore.getState().setRefusal({ card: pending.card, text: refused });
          drag.current = null;
          return;
        }
        pending.started = true;
        useCatalogueStore.getState().startCardDrag(pending.card);
        useCardsStore.getState().setInFlight(pending.card);
      }
      const token = tokenRef.current;
      const box = railRef.current?.getBoundingClientRect();
      if (token === null || box === undefined) return;
      const over = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      token.classList.toggle("is-shown", over);
      token.style.setProperty("--pc-token-x", `${String(Math.round(event.clientX - box.left))}px`);
      token.style.setProperty("--pc-token-y", `${String(Math.round(event.clientY - box.top))}px`);
    };
    const onUp = (event: PointerEvent): void => {
      const pending = drag.current;
      if (pending === null || event.pointerId !== pending.pointerId) return;
      drag.current = null;
      swallowClick.current = pending.started;
      tokenRef.current?.classList.remove("is-shown");
      useCardsStore.getState().setInFlight(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  if (hidden) return null;

  const onCardPointerDown = (card: CardId, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    drag.current = { card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === "touch", started: false };
  };

  const onCardPress = (card: CardId): void => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    armOrCancel(card);
  };

  // One Tab stop: ← → Home End move between the keys, as in the catalogue's row. A key pressed
  // with the pointer gives the arrows back to the room (focusOwnsArrows), as the dock's do.
  const tabStop = Math.min(stop, slots.length);
  const onRailKeys = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!focusOwnsArrows(event.target)) return;
    const stops = railStops(railRef.current);
    const index = stops.findIndex((element) => element === event.target);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? Math.min(stops.length - 1, index + 1)
      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? stops.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    stops[next]?.focus();
  };

  // One voice for the rail, there before its words, so whatever arrives in it is spoken.
  const line = refusal !== null ? (
    <><b>{refusal.text}</b><span> · {railName(refusal.card, style)}</span></>
  ) : replacing !== null ? (
    <>
      {preview === null ? <b>{replacing}</b> : preview.ok ? <span>{preview.text}</span> : <b>{preview.text}</b>}
      <span> · </span><b>Esc</b><span> cancels</span>
    </>
  ) : armed !== null && hintFor === armed ? (
    HINT_WORDS.map((words, index) => (index % 2 === 0 ? <b key={words}>{words}</b> : <span key={words}>{words}</span>))
  ) : null;
  const refusing = refusal !== null || (replacing !== null && preview?.ok === false);

  return (
    <div className="pc-rail-wrap">
      <p className={`pc-rail__hint${refusing ? " is-refusal" : ""}`} role="status">{line}</p>
      <div
        ref={railRef}
        className="pc-lacquer pc-rail"
        role="toolbar"
        aria-label="Furniture cards"
        data-testid="planner-rail"
        onKeyDown={onRailKeys}
        onFocus={(event) => {
          const index = railStops(railRef.current).findIndex((element) => element === event.target);
          if (index >= 0) setStop(index);
        }}
        onPointerUp={() => {
          // Released over the rail: a card in flight is put back, silently, before the floor can take it.
          if (drag.current?.started === true) useCatalogueStore.getState().endCardDrag();
        }}
      >
        <div
          className="pc-rail__cards"
          // Replace mode: the card under the pointer or focus is the one the hint speaks of.
          onPointerOver={(event) => { pointAt(event.target, slots); }}
          onFocus={(event) => { pointAt(event.target, slots); }}
          onPointerLeave={() => { if (useCardsStore.getState().replacing !== null) useCardsStore.getState().setPointedCard(null); }}
        >
          {slots.map((card, index) => (
            <RailCard
              key={card}
              card={card}
              slot={index + 1}
              armed={armed === card}
              inFlight={inFlight === card}
              placed={placedCount(card, inRoom)}
              store={store.get(card) ?? null}
              tabIndex={index === tabStop ? 0 : -1}
              onPress={onCardPress}
              onPointerDown={onCardPointerDown}
            />
          ))}
        </div>
        <Key
          label="More"
          icon={<LayoutGrid className="pc-icon" aria-hidden="true" />}
          small
          expanded={catalogueOpen}
          shortcut={["A"]}
          className="pc-rail__more"
          tabIndex={tabStop === slots.length ? 0 : -1}
          onPress={() => { useCardsStore.getState().toggleCatalogue(); }}
        />
        <span ref={tokenRef} className="pc-rail__token" aria-hidden="true" />
      </div>
    </div>
  );
}
