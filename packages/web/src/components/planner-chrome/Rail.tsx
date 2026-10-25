import { useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { LayoutGrid } from "lucide-react";
import { placedCounts } from "../../lib/card-stock.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { CATALOGUE_CARDS, RAIL_SLOTS, railName } from "../../lib/card-defaults.js";
import { cardMainSlug, cardParamsFor, pieceCardSlug, type CardId } from "../../lib/setup-cards.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRailDropStore } from "../../stores/rail-drop-store.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { armOrCancel, useCardKeys } from "./card-keys.js";
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

/** Every catalogue slug a card stands for: its variants, or a setup's main piece. */
function slugsOf(card: CardId): readonly string[] {
  const slug = pieceCardSlug(card);
  if (slug === null) {
    const params = cardParamsFor(card, {}, {});
    return params === null ? [] : [cardMainSlug(params)];
  }
  const group = CATALOGUE_CARDS.find((entry) => entry.variants.some((variant) => variant.slug === slug));
  return group === undefined ? [slug] : group.variants.map((variant) => variant.slug);
}

/** While replacing, notes which rail card the pointer or focus is on. */
function pointAt(target: EventTarget): void {
  if (useCardsStore.getState().replacing === null || !(target instanceof Element)) return;
  const named = target.closest<HTMLElement>("[data-card]")?.dataset["card"];
  // The rail's own slot, so only a card it holds is ever pointed at.
  const card = RAIL_SLOTS[useCardsStore.getState().style].find((slot) => slot === named);
  if (card !== undefined && card !== useCardsStore.getState().pointedCard) useCardsStore.getState().setPointedCard(card);
}

export function Rail(): ReactElement | null {
  useCardKeys();
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
  const slots = RAIL_SLOTS[style];
  const hidden = walking || viewOnly;

  const placed = useMemo(() => {
    const bySlug = new Map<string, number>();
    for (const item of placedItems) {
      const slug = getCatalogueItem(item.catalogueItemId)?.slug;
      if (slug !== undefined) bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
    }
    return new Map(slots.map((card) => [card, slugsOf(card).reduce((sum, slug) => sum + (bySlug.get(slug) ?? 0), 0)] as const));
  }, [placedItems, slots]);

  const store = useMemo(() => {
    const counts = placedCounts(placedItems);
    return new Map(slots.map((card) => [card, storeFace(cardParamsFor(card, {}, remembered), stock, counts)] as const));
  }, [placedItems, slots, stock, remembered]);

  // Replace mode: Esc steps out of it before anything else it would close.
  useEscapeLayer("operation", { open: replacing !== null, onEscape: () => { useCardsStore.getState().stopReplacing(); } });
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

  return (
    <div className="pc-rail-wrap">
      {refusal !== null ? (
        <p className="pc-rail__hint is-refusal" role="status">
          <b>{refusal.text}</b><span> · {railName(refusal.card)}</span>
        </p>
      ) : replacing !== null ? (
        <p className={`pc-rail__hint${preview?.ok === false ? " is-refusal" : ""}`} role="status">
          {preview === null ? <b>{replacing}</b> : preview.ok ? <span>{preview.text}</span> : <b>{preview.text}</b>}
          <span> · </span><b>Esc</b><span> cancels</span>
        </p>
      ) : armed !== null && hintFor === armed ? (
        <p className="pc-rail__hint" role="status">
          {HINT_WORDS.map((words, index) => (index % 2 === 0 ? <b key={words}>{words}</b> : <span key={words}>{words}</span>))}
        </p>
      ) : null}
      <div
        ref={railRef}
        className="pc-lacquer pc-rail"
        role="toolbar"
        aria-label="Furniture cards"
        data-testid="planner-rail"
        onPointerUp={() => {
          // Released over the rail: a card in flight is put back, silently, before the floor can take it.
          if (drag.current?.started === true) useCatalogueStore.getState().endCardDrag();
        }}
      >
        <div
          className="pc-rail__cards"
          // Replace mode: the card under the pointer or focus is the one the hint speaks of.
          onPointerOver={(event) => { pointAt(event.target); }}
          onFocus={(event) => { pointAt(event.target); }}
          onPointerLeave={() => { if (useCardsStore.getState().replacing !== null) useCardsStore.getState().setPointedCard(null); }}
        >
          {slots.map((card, index) => (
            <RailCard
              key={card}
              card={card}
              slot={index + 1}
              armed={armed === card}
              inFlight={inFlight === card}
              placed={placed.get(card) ?? 0}
              store={store.get(card) ?? null}
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
          onPress={() => { useCardsStore.getState().toggleCatalogue(); }}
        />
        <span ref={tokenRef} className="pc-rail__token" aria-hidden="true" />
      </div>
    </div>
  );
}
