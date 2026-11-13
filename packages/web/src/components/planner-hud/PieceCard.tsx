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
import { CopyGlyph, MinusGlyph, PlusGlyph, PutBackGlyph, TurnGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The piece card: what is chosen, and the few things to do with it (design
// spec, "The stations"). It stands in for the inspector of coordinates: a
// table's seats, its cloth, a turn, a copy, and back to the hand. It keeps
// one place on screen, so the hand that chose a table finds its card without
// looking for it.
// ---------------------------------------------------------------------------

/** One press of Turn: the planner's own step, a twelfth of a half turn. */
const TURN_STEP = Math.PI / 12;

type Linen = "bare" | "white" | "black";

interface Chosen {
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

export function PieceCard(): ReactElement | null {
  const selected = useSelectionStore((state) => state.selectedIds);
  const chosen = usePlacementStore(useShallow((state) => chosenFrom(state.placedItems, selected)));
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  if (chosen.count === 0) return null;
  const { tableId, linen } = chosen;
  return (
    <section className="hud-piece" aria-label={chosen.title}>
      <h2 className="hud-piece__title">{chosen.title}</h2>
      {tableId !== null && chosen.seats > 0 ? (
        <div className="hud-stepper" role="group" aria-label="Seats at this table">
          <button type="button" className="hud-stepper__key" aria-label="One seat fewer" disabled={locked} onClick={() => { changeSeatsAtSelectedTables(-1); }}>
            <MinusGlyph />
          </button>
          <span className="hud-stepper__value" aria-live="polite">{chosen.seats === 1 ? "1 seat" : `${String(chosen.seats)} seats`}</span>
          <button type="button" className="hud-stepper__key" aria-label="One seat more" disabled={locked} onClick={() => { changeSeatsAtSelectedTables(1); }}>
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
        <button type="button" className="hud-key hud-key--quiet" disabled={locked} title="Turn it (Q and E)" onClick={() => { turnSelection(TURN_STEP); }}>
          <TurnGlyph />
          <span>Turn</span>
        </button>
        <button type="button" className="hud-key hud-key--quiet" disabled={locked} title="Another like it, beside it (Ctrl D)" onClick={() => { duplicateSelection(); }}>
          <CopyGlyph />
          <span>Copy</span>
        </button>
        <button type="button" className="hud-key hud-key--quiet" disabled={locked} title="Take it off the floor (Delete)" onClick={() => { removeSelection(); }}>
          <PutBackGlyph />
          <span>Put back</span>
        </button>
      </div>
    </section>
  );
}
