import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { BOARD_COPY } from "../board-copy.js";
import {
  findPaletteResults,
  type PaletteCalendar,
  type PaletteEnquiry,
  type PaletteResult,
} from "../lib/board-palette.js";

export type { PaletteResult } from "../lib/board-palette.js";
import { useEscapeToClose, useFocusTrap } from "../../../lib/use-focus-trap.js";

// ---------------------------------------------------------------------------
// The board's finding palette (C1) — Ctrl/Cmd-K. Searches what the board
// already holds in memory (rooms, the visible range's bookings, open
// enquiries); the empty state says so honestly rather than pretending to
// search the whole diary. The query lives here rather than in the page, so a
// keystroke re-renders the palette alone, never the board behind it; closing
// unmounts the palette, so every opening starts from an empty query.
// ---------------------------------------------------------------------------

export interface BoardPaletteProps {
  /** The loaded calendar; null while it is still loading (no results yet). */
  readonly data: PaletteCalendar | null;
  readonly enquiries: readonly PaletteEnquiry[];
  readonly onPick: (result: PaletteResult) => void;
  readonly onClose: () => void;
}

export function BoardPalette({
  data,
  enquiries,
  onPick,
  onClose,
}: BoardPaletteProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => findPaletteResults(query, data, enquiries), [query, data, enquiries]);
  // T-615: the palette announced aria-modal but neither trapped Tab nor
  // answered Escape unless the caret happened to be in the input — Tab walked
  // straight out onto the board behind it. The trap also returns focus to
  // whatever opened the palette when it unmounts. The explicit input focus
  // below still wins: useFocusTrap only moves focus if the container does not
  // already hold it.
  const dialogRef = useFocusTrap<HTMLDivElement>();
  useEscapeToClose(onClose);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="diary-palette-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="diary-palette"
        role="dialog"
        aria-modal="true"
        aria-label={BOARD_COPY.palette.title}
      >
        <input
          ref={inputRef}
          className="diary-palette-input"
          type="text"
          value={query}
          placeholder={BOARD_COPY.palette.placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === "Enter" && results.length > 0 && results[0] !== undefined) {
              event.preventDefault();
              onPick(results[0]);
            }
          }}
        />
        {results.length === 0 ? (
          <p className="diary-palette-empty">{BOARD_COPY.palette.empty}</p>
        ) : (
          <ul className="diary-palette-results">
            {results.map((result) => (
              <li key={`${result.kind}:${result.id}`}>
                <button
                  type="button"
                  className="diary-palette-result"
                  onClick={() => {
                    onPick(result);
                  }}
                >
                  <span className={`diary-palette-kind is-${result.kind}`}>
                    {BOARD_COPY.palette.kinds[result.kind]}
                  </span>
                  <span className="diary-palette-label">{result.label}</span>
                  <span className="diary-palette-detail">{result.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
