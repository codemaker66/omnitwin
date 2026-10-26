import { type ReactElement } from "react";
import { Undo2 } from "lucide-react";
import { MARKUP_COLOR_VALUES, useMarkupStore, type MarkupColor } from "../../stores/markup-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { Segmented, type SegmentedOption } from "./Controls.js";
import { Key, KeySeparator } from "./Keys.js";
import "./chrome.css";
import "./draw-tray.css";

// ---------------------------------------------------------------------------
// The Draw tray (T-674, v2 slice 14; approved spec §6.8): a small lacquer
// tray above the dock while Draw is on, with the inks, two widths, Undo for
// the last stroke (Ctrl Z, the pen's own undo while drawing) and Clear.
//
// It shows only while the planner holds the pen: the dock's Draw key and D
// set the one tool store, and the tray reads it. It never turns Draw on or
// off itself. The strokes are the markup store's, kept by MarkupPersistence
// in this browser only, and the tray says so: they do not yet reach the
// layout, the venue or the function sheet (QoL lens C-09; the store and
// persistence requests are in the build's WIRING.md). The spec's six inks
// wait on the store's palette, which holds four.
// ---------------------------------------------------------------------------

/** The inks as a person reads them; the store's own words are its palette's. */
export const INK_NAMES: Readonly<Record<MarkupColor, string>> = {
  gold: "Gold",
  ivory: "Ivory",
  ruby: "Red",
  cyan: "Blue",
};

/** The two widths, in the store's metres: Fine is the pen's own default. */
export const DRAW_WIDTHS = { fine: 0.034, broad: 0.06 } as const;
type DrawWidth = keyof typeof DRAW_WIDTHS;

const WIDTH_OPTIONS: readonly SegmentedOption<DrawWidth>[] = [
  { value: "fine", label: "Fine" },
  { value: "broad", label: "Broad" },
];

const INK_OPTIONS: readonly SegmentedOption<MarkupColor>[] = MARKUP_COLOR_VALUES.map((color) => ({
  value: color,
  label: INK_NAMES[color],
  icon: <i className={`pc-draw-tray__swatch pc-draw-tray__swatch--${color}`} aria-hidden="true" />,
}));

/** The width nearest the pen's, so a width set elsewhere still shows as one of the two. */
export function nearestWidth(width: number): DrawWidth {
  return Math.abs(width - DRAW_WIDTHS.fine) <= Math.abs(width - DRAW_WIDTHS.broad) ? "fine" : "broad";
}

const NOTHING_DRAWN = "Nothing drawn yet";

export function DrawTray(): ReactElement | null {
  const drawing = useToolStore((state) => state.activeTool === "draw");
  const color = useMarkupStore((state) => state.selectedColor);
  const width = useMarkupStore((state) => state.selectedWidth);
  const strokes = useMarkupStore((state) => state.strokes.length);
  const canRestore = useMarkupStore((state) => state.strokes.length === 0 && state.clearedStrokes !== null);
  const drafting = useMarkupStore((state) => state.draftStroke !== null);
  if (!drawing) return null;

  const undoTip = canRestore ? "Bring back the drawing" : "Undo the last stroke";
  const nothingToUndo = strokes === 0 && !canRestore && !drafting;

  return (
    <div className="pc-lacquer pc-draw-tray" role="group" aria-label="Draw" data-testid="planner-draw-tray">
      <Segmented
        className="pc-draw-tray__inks"
        label="Ink"
        value={color}
        options={INK_OPTIONS}
        onChange={(next) => { useMarkupStore.getState().setColor(next); }}
      />
      <Segmented
        className="pc-draw-tray__widths"
        label="Width"
        value={nearestWidth(width)}
        options={WIDTH_OPTIONS}
        onChange={(next) => { useMarkupStore.getState().setWidth(DRAW_WIDTHS[next]); }}
      />
      <KeySeparator />
      <Key
        small
        iconOnly
        label={undoTip}
        icon={<Undo2 className="pc-icon" aria-hidden="true" />}
        shortcut={["Ctrl", "Z"]}
        disabledReason={nothingToUndo ? NOTHING_DRAWN : undefined}
        onPress={() => { useMarkupStore.getState().undoStroke(); }}
      />
      <Key
        small
        label="Clear"
        tip="Clear the drawing"
        disabledReason={strokes === 0 ? NOTHING_DRAWN : undefined}
        onPress={() => { useMarkupStore.getState().clearStrokes(); }}
      />
      <span className="pc-meta pc-draw-tray__kept">Kept on this device only</span>
    </div>
  );
}
