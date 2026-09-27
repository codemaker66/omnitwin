import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import { BOARD_COPY } from "../board-copy.js";

// ---------------------------------------------------------------------------
// ViewMenu (roadmap N3, the reduced toolbar). What changes how the board is
// read, rather than where it looks, sits one step away: released and
// cancelled bookings, a refresh of the whole board, and how the Diary works.
//
// A disclosure, not an ARIA menu: its controls are an ordinary checkbox and
// buttons in tab order. A press or focus outside closes it, and so does
// Escape, which gives focus back to its button (the dashboard's More, the
// same way). A button that acts closes it first with focus on "View", so a
// dialog it opens returns focus there.
// ---------------------------------------------------------------------------

export interface ViewMenuProps {
  readonly showExited: boolean;
  readonly onShowExited: (show: boolean) => void;
  readonly onRefresh: () => void;
  readonly onHowItWorks: () => void;
}

export function ViewMenu({ showExited, onShowExited, onRefresh, onHowItWorks }: ViewMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const closeThen = (action: () => void): void => {
    setOpen(false);
    buttonRef.current?.focus();
    action();
  };

  return (
    <div ref={rootRef} className="diary-view-menu">
      <button
        ref={buttonRef}
        type="button"
        className="diary-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { setOpen((value) => !value); }}
      >
        {BOARD_COPY.viewMenu.open}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={panelId} className="diary-view-menu-panel" hidden={!open}>
        <label className="diary-view-menu-toggle">
          <input
            type="checkbox"
            checked={showExited}
            onChange={(event) => { onShowExited(event.target.checked); }}
          />
          {BOARD_COPY.showExited}
        </label>
        <button type="button" className="diary-view-menu-item" onClick={() => { closeThen(onRefresh); }}>
          {BOARD_COPY.refresh}
        </button>
        <button
          type="button"
          className="diary-view-menu-item"
          aria-keyshortcuts="?"
          onClick={() => { closeThen(onHowItWorks); }}
        >
          {BOARD_COPY.welcome.reopen}
          <kbd aria-hidden="true">?</kbd>
        </button>
      </div>
    </div>
  );
}
