// ---------------------------------------------------------------------------
// Moving round the overview from the keyboard (roadmap N3: "Arrow keys move
// around the grid with a roving tab stop"). The overview is one Tab stop;
// inside it the arrow keys move as the eye does. Row 0 is the day headings,
// then one row per room; a place's column is its day, and its stack is its
// order within the room-day square (the bookings, then Add).
//
// Left and right keep to the row and step over days with nothing to land on;
// down and up walk a square's stack before crossing to the next room, and
// step over rooms with nothing that day. Home and End go to the row's ends,
// or with Ctrl to the grid's. Pure: the overview hands in every place it
// shows, and tests hand in cases.
// ---------------------------------------------------------------------------

export interface NavPlace {
  readonly row: number;
  readonly col: number;
  readonly stack: number;
}

export const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/** Where `key` moves from `from`, or null when it goes nowhere. */
export function overviewMove(places: readonly NavPlace[], from: NavPlace, key: string, ctrl = false): NavPlace | null {
  // How many places each square holds, by row then column.
  const squares = new Map<number, Map<number, number>>();
  for (const place of places) {
    const row = squares.get(place.row) ?? new Map<number, number>();
    row.set(place.col, Math.max(row.get(place.col) ?? 0, place.stack + 1));
    squares.set(place.row, row);
  }
  const height = (row: number, col: number): number => squares.get(row)?.get(col) ?? 0;
  const rows = [...squares.keys()].sort((a, b) => a - b);
  const cols = (row: number): number[] => [...(squares.get(row)?.keys() ?? [])].sort((a, b) => a - b);

  switch (key) {
    case "ArrowRight":
    case "ArrowLeft": {
      const onward = cols(from.row).filter((col) => (key === "ArrowRight" ? col > from.col : col < from.col));
      const col = key === "ArrowRight" ? onward[0] : onward[onward.length - 1];
      return col === undefined ? null : { row: from.row, col, stack: Math.min(from.stack, height(from.row, col) - 1) };
    }
    case "ArrowDown": {
      if (from.stack + 1 < height(from.row, from.col)) return { ...from, stack: from.stack + 1 };
      const row = rows.find((candidate) => candidate > from.row && height(candidate, from.col) > 0);
      return row === undefined ? null : { row, col: from.col, stack: 0 };
    }
    case "ArrowUp": {
      if (from.stack > 0) return { ...from, stack: from.stack - 1 };
      const row = rows.filter((candidate) => candidate < from.row && height(candidate, from.col) > 0).pop();
      return row === undefined ? null : { row, col: from.col, stack: height(row, from.col) - 1 };
    }
    case "Home": {
      const row = ctrl ? rows[0] : from.row;
      const col = row === undefined ? undefined : cols(row)[0];
      return row === undefined || col === undefined ? null : { row, col, stack: 0 };
    }
    case "End": {
      const row = ctrl ? rows[rows.length - 1] : from.row;
      const col = row === undefined ? undefined : cols(row).pop();
      return row === undefined || col === undefined ? null : { row, col, stack: height(row, col) - 1 };
    }
    default:
      return null;
  }
}
