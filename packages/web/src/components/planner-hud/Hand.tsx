import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from "react";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../lib/editor-history.js";
import { plannerChairSlug } from "../../lib/furniture-defaults.js";
import { handCardsFromCounts, type HandCard } from "../../lib/hud/hand-cards.js";
import { KEY_PRIORITY, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringCssVariable } from "../../lib/use-spring-value.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";
import { usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useHudFacts } from "./hud-facts.js";
import { MoreGlyph, RedoGlyph, SunburstGlyph, UndoGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The hand: the cards along the bottom (design spec, "The stations").
//
// One verb: take a card and set it down. A click takes the card (the card
// again, or Escape, puts it back) and a click on the floor sets it down; or
// the card is dragged straight into the room. Either way the planner's own
// ghost shows the whole set where it will stand and refuses, with its reason,
// before anything lands (components/GhostSet.tsx, lib/place-in-hand.ts).
// ---------------------------------------------------------------------------

/** How far a press must travel before it is a drag and not a click. */
const DRAG_THRESHOLD_PX = 7;

function endCardDrag(cardId: string): void {
  const hand = useCatalogueStore.getState();
  if (!hand.dragActive || hand.armedCardId !== cardId) return;
  hand.endCardDrag();
  usePlacementStore.getState().clearGhost();
  useSelectionStore.getState().setActiveGuides([]);
}

function takeCard(card: HandCard): void {
  useToolStore.getState().setTool("select");
  usePlannerHudStore.getState().closeSheet();
  useCatalogueStore.getState().toggleCard(card.id);
}

interface CardKeyProps {
  readonly card: HandCard;
  readonly index: number;
  readonly armed: boolean;
  readonly locked: boolean;
  readonly previewRef: RefObject<HTMLDivElement | null>;
  readonly onDragChange: (card: HandCard | null) => void;
}

function CardKey({ card, index, armed, locked, previewRef, onDragChange }: CardKeyProps): ReactElement {
  const suppressClick = useRef(false);
  const stopSession = useRef<(() => void) | null>(null);
  useEffect(() => () => { stopSession.current?.(); }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    // A finger takes a card with a tap and sets it down with a tap; a drag from the hand is the mouse's and the pen's.
    if (event.button !== 0 || event.pointerType === "touch" || locked) return;
    stopSession.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const follow = (x: number, y: number): void => {
      const preview = previewRef.current;
      if (preview !== null) preview.style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0)`;
    };
    const finish = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("hud-dragging-card");
      onDragChange(null);
      stopSession.current = null;
    };
    function onMove(move: PointerEvent): void {
      if (move.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) >= DRAG_THRESHOLD_PX) {
        dragging = true;
        suppressClick.current = true;
        document.body.classList.add("hud-dragging-card");
        useToolStore.getState().setTool("select");
        usePlannerHudStore.getState().closeSheet();
        useCatalogueStore.getState().startCardDrag(card.id);
        onDragChange(card);
      }
      if (dragging) {
        move.preventDefault();
        follow(move.clientX, move.clientY);
      }
    }
    function onUp(up: PointerEvent): void {
      if (up.pointerId !== pointerId) return;
      finish();
      if (!dragging) return;
      // The ghost's own release has placed it (or not) by now; nothing stays in hand after a drag.
      window.setTimeout(() => {
        endCardDrag(card.id);
        suppressClick.current = false;
      }, 0);
    }
    function onCancel(cancel: PointerEvent): void {
      if (cancel.pointerId !== pointerId) return;
      finish();
      if (dragging) endCardDrag(card.id);
      suppressClick.current = false;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    stopSession.current = finish;
  }, [card, locked, onDragChange, previewRef]);

  const onClick = useCallback((): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!locked) takeCard(card);
  }, [card, locked]);

  const inRoom = card.placed > 0 ? `, ${String(card.placed)} in the room` : "";
  return (
    <li className="hud-card-slot">
      <button
        type="button"
        className="hud-card"
        data-card={card.id}
        data-armed={armed ? "true" : undefined}
        aria-pressed={armed}
        aria-disabled={locked || undefined}
        aria-label={`${card.name}, ${card.detail}${inRoom}`}
        aria-keyshortcuts={String(index + 1)}
        title={locked ? "Leave the preview to change the room" : `${card.name}: click, then click the floor, or drag it into the room (${String(index + 1)})`}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        <span className="hud-card__art">
          {card.art !== null ? <img src={card.art} alt="" draggable={false} decoding="async" /> : null}
        </span>
        {card.placed > 0 ? <span className="hud-card__count" aria-hidden="true">×{card.placed}</span> : null}
        <span className="hud-card__name">{card.name}</span>
        <span className="hud-card__detail">{card.detail}</span>
      </button>
    </li>
  );
}

function SeatLine(): ReactElement {
  const { plane } = useHudFacts();
  const fillRef = useRef<HTMLSpanElement>(null);
  const guests = plane.guests !== null && plane.guests > 0 ? plane.guests : null;
  const fraction = guests === null ? 0 : Math.min(1, plane.seats / guests);
  useSpringCssVariable(fillRef, "--hud-seat-fill", fraction, SPRING_PRESETS.dialGlide, { unit: "" });
  const lead = guests === null
    ? plane.seats === 1 ? "1 seat placed" : `${String(plane.seats)} seats placed`
    : `${String(plane.seats)} of ${String(guests)} seated`;
  const tail = guests === null ? "" : plane.short > 0 ? `${String(plane.short)} to go` : "Every guest seated";
  return (
    <div className="hud-seatline" data-standing={plane.standing} role="status">
      <span className="hud-seatline__lead">{lead}</span>
      <span className="hud-seatline__track" aria-hidden="true"><span ref={fillRef} className="hud-seatline__fill" /></span>
      <span className="hud-seatline__tail">{tail}</span>
    </div>
  );
}

export function Hand(): ReactElement {
  const facts = useHudFacts();
  const kind = usePlannerEventStore((state) => state.eventKind);
  const armedCardId = useCatalogueStore((state) => state.armedCardId);
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const undoable = useEditorStore((state) => canUndo(state.history));
  const redoable = useEditorStore((state) => canRedo(state.history));
  const undoWords = useEditorStore((state) => undoLabel(state.history));
  const redoWords = useEditorStore((state) => redoLabel(state.history));
  const previewRef = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<HandCard | null>(null);

  const cards = useMemo(() => handCardsFromCounts(kind, facts.counts, plannerChairSlug(kind)), [kind, facts.counts]);

  // The digits take the cards, as they sit: 1 is the first.
  const digitBindings = useMemo((): KeyBinding[] => cards.map((card, index) => ({
    keys: [{ code: `Digit${String(index + 1)}`, shift: false }],
    priority: KEY_PRIORITY.planner,
    when: () => usePlannerHudStore.getState().sheet === null && useLayoutTimelinePreviewStore.getState().mode === "inactive",
    run: () => { takeCard(card); },
  })), [cards]);
  usePlannerKeyBindings(digitBindings);

  const guestsKnown = facts.plane.guests !== null && facts.plane.guests > 0;
  const layOut = (): void => { usePlannerHudStore.getState().openSheet(guestsKnown ? "layout" : "event"); };

  return (
    <section className="hud-hand" aria-label="Furniture and the next steps" data-in-hand={armedCardId !== null ? "true" : undefined}>
      <SeatLine />
      <div className="hud-hand__row">
        <div className="hud-hand__make">
          <button type="button" className="hud-key hud-key--make" onClick={layOut} disabled={locked}>
            <SunburstGlyph />
            <span>Lay out for me</span>
          </button>
          <div className="hud-hand__history">
            <button
              type="button"
              className="hud-key hud-key--quiet"
              onClick={() => { useEditorStore.getState().undo(); }}
              disabled={!undoable || locked}
              aria-label={undoWords === null ? "Undo" : `Undo ${undoWords}`}
              title={undoWords === null ? "Nothing to undo" : `Undo ${undoWords} (Ctrl Z)`}
            >
              <UndoGlyph />
              <span>Undo</span>
            </button>
            <button
              type="button"
              className="hud-key hud-key--quiet"
              onClick={() => { useEditorStore.getState().redo(); }}
              disabled={!redoable || locked}
              aria-label={redoWords === null ? "Redo" : `Redo ${redoWords}`}
              title={redoWords === null ? "Nothing to redo" : `Redo ${redoWords} (Ctrl Shift Z)`}
            >
              <RedoGlyph />
              <span>Redo</span>
            </button>
          </div>
        </div>

        <ul className="hud-hand__cards" role="list">
          {cards.map((card, index) => (
            <CardKey
              key={card.id}
              card={card}
              index={index}
              armed={armedCardId === card.id}
              locked={locked}
              previewRef={previewRef}
              onDragChange={setDragged}
            />
          ))}
          <li className="hud-card-slot hud-card-slot--more">
            <button
              type="button"
              className="hud-card hud-card--more"
              onClick={() => { usePlannerHudStore.getState().toggleSheet("more"); }}
              aria-label="More furniture"
              title="Everything the hall has, by kind"
            >
              <MoreGlyph />
              <span className="hud-card__name">More</span>
            </button>
          </li>
        </ul>

        <div className="hud-hand__finish">
          <button type="button" className="hud-key hud-key--primary" onClick={() => { usePlannerHudStore.getState().toggleSheet("send"); }}>
            Send to Events Team
          </button>
        </div>
      </div>

      {/* What is carried from the hand until the pointer is over the floor, where the room's own ghost takes over. */}
      <div ref={previewRef} className="hud-card-carry" hidden={dragged === null} aria-hidden="true">
        {dragged !== null ? (
          <span className="hud-card-carry__card">
            {dragged.art !== null ? <img src={dragged.art} alt="" draggable={false} /> : null}
            <span>{dragged.name}</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
