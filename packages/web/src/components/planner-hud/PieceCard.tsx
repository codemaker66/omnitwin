import { useLayoutEffect, useRef, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { canApplyTableLinenToItem, isDiningTableItem } from "../../lib/furniture-semantics.js";
import { handCardCounting, handCardIds } from "../../lib/hud/hand-cards.js";
import { piecesLabel } from "../../lib/pieces-label.js";
import type { PlacedItem } from "../../lib/placement.js";
import { asOneUndoStep, changeSeatsAtSelectedTables, duplicateSelection, removeSelection, turnSelection } from "../../lib/planner-keymap.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { MinusGlyph, PlusGlyph } from "./glyphs.js";
import { handKeyboardOn, screenWithKeyboardIn } from "./keyboard-hand-off.js";
import { onRadioGroupKeyDown, radioTabIndex } from "./radio-keys.js";

// ---------------------------------------------------------------------------
// The chosen piece's verbs (the HUD's design note). When something is
// chosen the cards give way, in the same shelf, to the few things to do with
// it: a table's seats, its cloth, a turn, a copy, and back off the floor. The
// piece's name stands where the status line's first words were (Hand.tsx);
// letting it go brings the cards back. The piece itself is marked in the hall,
// not here.
// ---------------------------------------------------------------------------

/** One press of Turn: the planner's own step, a twelfth of a half turn. */
const TURN_STEP = Math.PI / 12;

/** The name's element: the verbs are labelled by it, from the status line. */
export const PIECE_TITLE_ID = "hud-piece-title";

type Linen = "bare" | "white" | "black";

export interface Chosen {
  readonly count: number;
  /** The one dining table chosen (with or without its chairs), or null. */
  readonly tableId: string | null;
  readonly title: string;
  readonly seats: number;
  /** The cloth on that table, or null where its cloth is its own and cannot change. */
  readonly linen: Linen | null;
}

const NOTHING: Chosen = { count: 0, tableId: null, title: "", seats: 0, linen: null };

function chosenFrom(items: readonly PlacedItem[], selected: ReadonlySet<string>): Chosen {
  if (selected.size === 0) return NOTHING;
  const pieces = items.filter((item) => selected.has(item.id));
  if (pieces.length === 0) return NOTHING;
  const tables = pieces.filter((piece) => {
    const catalogue = getCatalogueItem(piece.catalogueItemId);
    return catalogue !== undefined && isDiningTableItem(catalogue);
  });
  const table = tables.length === 1 ? tables[0] : undefined;
  if (table === undefined) return { count: pieces.length, tableId: null, title: piecesLabel(pieces), seats: 0, linen: null };
  const catalogue = getCatalogueItem(table.catalogueItemId);
  const seats = table.groupId === null ? 0 : items.filter((item) => item.groupId === table.groupId && item.id !== table.id
    && getCatalogueItem(item.catalogueItemId)?.category === "chair").length;
  const label = table.label?.trim() ?? "";
  const kind = catalogue === undefined ? "Table" : catalogue.tableShape === "round" && seats > 0 ? `Round of ${String(seats)}` : catalogue.name;
  const linen: Linen | null = catalogue === undefined || !canApplyTableLinenToItem(catalogue) ? null
    : !table.clothed ? "bare" : table.clothStyle === "black" ? "black" : "white";
  return { count: pieces.length, tableId: table.id, title: label === "" ? kind : `${label} · ${kind}`, seats, linen };
}

/** What is chosen in the room now, named the way the shelf names it. */
export function useChosenPiece(): Chosen {
  const selected = useSelectionStore((state) => state.selectedIds);
  return usePlacementStore(useShallow((state) => chosenFrom(state.placedItems, selected)));
}

function wearLinen(tableId: string, current: Linen, next: Linen): void {
  if (current === next) return;
  const placement = usePlacementStore.getState();
  asOneUndoStep(() => {
    if (next === "bare") placement.toggleCloth(tableId);
    else placement.applyTableCloth(new Set([tableId]), next);
  });
}

const LINENS: readonly { readonly id: Linen; readonly label: string }[] = [
  { id: "white", label: "Ivory cloth" },
  { id: "black", label: "Black cloth" },
  { id: "bare", label: "No cloth" },
];

/**
 * Where the keyboard goes when the verbs leave with the keyboard in them: into
 * the cards that come back in their place. A card in hand first (its digit
 * was pressed), then the card that counted the piece, which is where a piece
 * put back has gone; More where the hand has no card for it; and failing those
 * the one primary key.
 */
function afterTheVerbs(screen: HTMLElement, items: readonly PlacedItem[], pieces: ReadonlySet<string>): readonly (HTMLElement | null)[] {
  const counted = handCardCounting(handCardIds(usePlannerEventStore.getState().eventKind), items, pieces);
  const cards = Array.from(screen.querySelectorAll<HTMLElement>(".hud-card"));
  return [
    cards.find((card) => card.dataset["armed"] === "true") ?? null,
    counted === null ? null : cards.find((card) => card.dataset["card"] === counted) ?? null,
    cards.find((card) => card.classList.contains("hud-card--more")) ?? null,
    screen.querySelector<HTMLElement>(".hud-shelf__act .hud-act"),
  ];
}

/** The verbs for what is chosen, in the cards' place; nothing while nothing is. */
export function PieceVerbs({ chosen }: { readonly chosen: Chosen }): ReactElement | null {
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  // The verbs leave when the piece is put back or let go, and whoever pressed Put back from the keyboard is in them.
  const partRef = useRef<HTMLElement>(null);
  const pieces = useSelectionStore((state) => state.selectedIds);
  useLayoutEffect(() => {
    const part = partRef.current;
    if (part === null) return undefined;
    // The room as it stood with these pieces in it, kept from when they were chosen or last changed: once a piece has
    // been put back, nothing says which card counted it. Only read if the verbs leave with the keyboard in them.
    const items = usePlacementStore.getState().placedItems;
    return () => {
      // Read before the verbs leave the page: this runs while they are still on it.
      const screen = screenWithKeyboardIn(part);
      if (screen !== null) handKeyboardOn(() => afterTheVerbs(screen, items, pieces));
    };
  }, [chosen, pieces]);
  if (chosen.count === 0) return null;
  const { tableId, linen } = chosen;
  return (
    <section ref={partRef} className="hud-piece" aria-labelledby={PIECE_TITLE_ID}>
      {tableId !== null && chosen.seats > 0 ? (
        <div className="hud-stepper" role="group" aria-label="Seats at this table">
          <button type="button" className="hud-round" aria-label="One seat fewer" disabled={locked} onClick={() => { changeSeatsAtSelectedTables(-1); }}>
            <MinusGlyph />
          </button>
          <span className="hud-stepper__value" aria-live="polite">{chosen.seats === 1 ? "1 seat" : `${String(chosen.seats)} seats`}</span>
          <button type="button" className="hud-round" aria-label="One seat more" disabled={locked} onClick={() => { changeSeatsAtSelectedTables(1); }}>
            <PlusGlyph />
          </button>
        </div>
      ) : null}
      {tableId !== null && linen !== null ? (
        <div className="hud-swatches" role="radiogroup" aria-label="The cloth on this table" onKeyDown={onRadioGroupKeyDown}>
          {LINENS.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              className="hud-swatch"
              data-linen={option.id}
              aria-checked={linen === option.id}
              tabIndex={radioTabIndex(linen === option.id, index === 0, LINENS.some((one) => one.id === linen))}
              aria-label={option.label}
              title={option.label}
              disabled={locked}
              onClick={() => { wearLinen(tableId, linen, option.id); }}
            />
          ))}
        </div>
      ) : null}
      <div className="hud-piece__keys">
        <button type="button" className="hud-word" disabled={locked} title="Turn it (Q and E)" onClick={() => { turnSelection(TURN_STEP); }}>Turn</button>
        <button type="button" className="hud-word" disabled={locked} title="Another like it, beside it (Ctrl D)" onClick={() => { duplicateSelection(); }}>Copy</button>
        <button type="button" className="hud-word" disabled={locked} title="Take it off the floor (Delete)" onClick={() => { removeSelection(); }}>Put back</button>
      </div>
    </section>
  );
}
