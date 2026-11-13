import type { ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { canApplyTableLinenToItem, isDiningTableItem } from "../../lib/furniture-semantics.js";
import { piecesLabel } from "../../lib/pieces-label.js";
import type { PlacedItem } from "../../lib/placement.js";
import { asOneUndoStep, changeSeatsAtSelectedTables, duplicateSelection, removeSelection, turnSelection } from "../../lib/planner-keymap.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { MinusGlyph, PlusGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The chosen piece's verbs (DOCTRINE.md, "letterbox"). When something is
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

/** The verbs for what is chosen, in the cards' place; nothing while nothing is. */
export function PieceVerbs({ chosen }: { readonly chosen: Chosen }): ReactElement | null {
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  if (chosen.count === 0) return null;
  const { tableId, linen } = chosen;
  return (
    <section className="hud-piece" aria-labelledby={PIECE_TITLE_ID}>
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
        <div className="hud-swatches" role="radiogroup" aria-label="The cloth on this table">
          {LINENS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              className="hud-swatch"
              data-linen={option.id}
              aria-checked={linen === option.id}
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
