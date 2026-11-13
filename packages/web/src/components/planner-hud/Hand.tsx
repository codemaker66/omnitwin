import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../lib/editor-history.js";
import { plannerChairSlug } from "../../lib/furniture-defaults.js";
import { handCardsFromCounts, type HandCard } from "../../lib/hud/hand-cards.js";
import { roomStatus, seatLine, type RoomStatus } from "../../lib/hud/room-seals.js";
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
import { HudNotices, useReceiptShowing } from "./HudNotices.js";
import { NextMoveKey } from "./Journey.js";
import { PIECE_TITLE_ID, PieceVerbs, useChosenPiece, type Chosen } from "./PieceCard.js";

// ---------------------------------------------------------------------------
// The shelf: the one surface under the hall (the HUD's design note).
//
// Its top edge is the seat line, a hairline that fills left to right as
// guests are seated. Under it one status line: the seats, then only what needs
// saying (the doors, the narrowest aisle); something to look at is pressable.
// Then the quiet words (Lay out for me, Undo, Redo), the hand of eight cards
// and More, and the one primary key, whose words are the next best move.
// When a piece is chosen the cards give way to its verbs. A sheet, or the
// first screen, is this surface grown upward.
//
// The hand's one verb: take a card and set it down. A click takes the card
// (the card again, or Escape, puts it back) and a click on the floor sets it
// down; or the card is dragged straight into the room. Either way the
// planner's own ghost shows the whole set where it will stand and refuses,
// with its reason, before anything lands (components/GhostSet.tsx,
// lib/place-in-hand.ts).
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
    <li className="hud-cards__slot">
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
        <span className="hud-card__name">
          {card.name}
          {card.placed > 0 ? <>{" "}<span className="hud-card__count" aria-hidden="true">×{card.placed}</span></> : null}
        </span>
        <span className="hud-card__detail">{card.detail}</span>
      </button>
    </li>
  );
}

/** The shelf's top edge: one hairline, filled as far as the guests are seated. */
function SeatEdge(): ReactElement {
  const { plane } = useHudFacts();
  const fillRef = useRef<HTMLSpanElement>(null);
  const guests = plane.guests !== null && plane.guests > 0 ? plane.guests : null;
  const fraction = guests === null ? 0 : Math.min(1, plane.seats / guests);
  useSpringCssVariable(fillRef, "--hud-seat-fill", fraction, SPRING_PRESETS.dialGlide, { unit: "" });
  return (
    <span className="hud-shelf__edge" aria-hidden="true">
      <span ref={fillRef} className="hud-shelf__fill" />
    </span>
  );
}

/** Something on the status line to look at: the pieces concerned are chosen. */
function lookAt(status: RoomStatus, facts: ReturnType<typeof useHudFacts>): void {
  if (status.id === "doors") {
    const first = facts.doors?.blockers[0];
    if (first !== undefined) useSelectionStore.getState().selectMultiple([...first.ids]);
    return;
  }
  const pair = facts.aisles.tightestPair;
  if (pair !== null) useSelectionStore.getState().selectMultiple([pair.aId, pair.bId]);
}

/**
 * The one status line: the seats (or the chosen piece's name in their place),
 * then the doors and the narrowest aisle. A receipt takes its place while it shows.
 */
function StatusLine({ chosen, hidden }: { readonly chosen: Chosen | null; readonly hidden: boolean }): ReactElement {
  const facts = useHudFacts();
  const seats = seatLine(facts.plane);
  const said = useMemo(() => roomStatus(facts), [facts]);
  return (
    <div className="hud-status" role="status" aria-label="The room as it stands" hidden={hidden}>
      {chosen !== null ? (
        <h2 className="hud-status__lead" id={PIECE_TITLE_ID}>{chosen.title}</h2>
      ) : seats.attention && seats.detail !== null ? (
        <button
          type="button"
          className="hud-status__lead hud-status__look"
          aria-label={`${seats.text}. ${seats.detail}`}
          title={seats.detail}
          onClick={() => { usePlannerHudStore.getState().openSheet("send"); }}
        >
          {seats.text}
        </button>
      ) : (
        <span className="hud-status__lead">{seats.text}</span>
      )}
      {said.map((status) => (status.attention ? (
        <button
          key={status.id}
          type="button"
          className="hud-status__item hud-status__look"
          data-status={status.id}
          aria-label={`${status.text}. ${status.detail}`}
          title={status.detail}
          onClick={() => { lookAt(status, facts); }}
        >
          {status.text}
        </button>
      ) : (
        <span key={status.id} className="hud-status__item" data-status={status.id} title={status.detail}>{status.text}</span>
      )))}
    </div>
  );
}

export function Hand({ children }: { readonly children?: ReactNode }): ReactElement {
  const facts = useHudFacts();
  const kind = usePlannerEventStore((state) => state.eventKind);
  const armedCardId = useCatalogueStore((state) => state.armedCardId);
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const undoable = useEditorStore((state) => canUndo(state.history));
  const redoable = useEditorStore((state) => canRedo(state.history));
  const undoWords = useEditorStore((state) => undoLabel(state.history));
  const redoWords = useEditorStore((state) => redoLabel(state.history));
  const chosen = useChosenPiece();
  const receipt = useReceiptShowing();
  const previewRef = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<HandCard | null>(null);

  const cards = useMemo(() => handCardsFromCounts(kind, facts.counts, plannerChairSlug(kind)), [kind, facts.counts]);
  // A card in hand keeps the cards on the shelf, so the card can be seen in hand.
  const verbs = chosen.count > 0 && armedCardId === null;

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
    <section
      className="hud-shelf"
      aria-label="Furniture and the next steps"
      data-in-hand={armedCardId !== null ? "true" : undefined}
      data-chosen={verbs ? "true" : undefined}
    >
      <SeatEdge />

      <div className="hud-shelf__status">
        <HudNotices />
        <StatusLine chosen={verbs ? chosen : null} hidden={receipt} />
      </div>

      <div className="hud-shelf__words">
        <button type="button" className="hud-word hud-shelf__lay-out" onClick={layOut} disabled={locked}>Lay out for me</button>
        <button
          type="button"
          className="hud-word"
          onClick={() => { useEditorStore.getState().undo(); }}
          disabled={!undoable || locked}
          aria-label={undoWords === null ? "Undo" : `Undo ${undoWords}`}
          title={undoWords === null ? "Nothing to undo" : `Undo ${undoWords} (Ctrl Z)`}
        >
          Undo
        </button>
        <button
          type="button"
          className="hud-word"
          onClick={() => { useEditorStore.getState().redo(); }}
          disabled={!redoable || locked}
          aria-label={redoWords === null ? "Redo" : `Redo ${redoWords}`}
          title={redoWords === null ? "Nothing to redo" : `Redo ${redoWords} (Ctrl Shift Z)`}
        >
          Redo
        </button>
      </div>

      <ul className="hud-cards" role="list" hidden={verbs}>
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
        <li className="hud-cards__slot">
          <button
            type="button"
            className="hud-card hud-card--more"
            onClick={() => { usePlannerHudStore.getState().toggleSheet("more"); }}
            aria-label="More furniture"
            title="Everything the hall has, by kind"
          >
            <span className="hud-card__art" aria-hidden="true" />
            <span className="hud-card__name">More</span>
          </button>
        </li>
      </ul>
      {verbs ? <PieceVerbs chosen={chosen} /> : null}

      <div className="hud-shelf__act"><NextMoveKey /></div>

      {/* What is carried from the hand until the pointer is over the floor, where the room's own ghost takes over. */}
      <div ref={previewRef} className="hud-card-carry" hidden={dragged === null} aria-hidden="true">
        {dragged !== null && dragged.art !== null ? (
          <span className="hud-card-carry__art"><img src={dragged.art} alt="" draggable={false} /></span>
        ) : null}
      </div>

      {children}
    </section>
  );
}
