import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { BOARD_COPY } from "../board-copy.js";

// ---------------------------------------------------------------------------
// The board's finding palette (C1) — Ctrl/Cmd-K. Searches what the board
// already holds in memory (rooms, the visible range's bookings, open
// enquiries); the empty state says so honestly rather than pretending to
// search the whole diary. Presentation only: the page owns the matching.
// ---------------------------------------------------------------------------

export interface PaletteResult {
  readonly kind: "room" | "booking" | "enquiry";
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface BoardPaletteProps {
  readonly query: string;
  readonly results: readonly PaletteResult[];
  readonly onQueryChange: (query: string) => void;
  readonly onPick: (result: PaletteResult) => void;
  readonly onClose: () => void;
}

export function BoardPalette({
  query,
  results,
  onQueryChange,
  onPick,
  onClose,
}: BoardPaletteProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
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
            onQueryChange(event.target.value);
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
