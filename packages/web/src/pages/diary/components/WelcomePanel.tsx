import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { BOARD_COPY } from "../board-copy.js";

// ---------------------------------------------------------------------------
// WelcomePanel (T-520) — the Board's first-run teaching moment. One screen,
// one button: the four commitments, the tray, the two keyboard verbs, and
// the live channel, in the Diary's own vocabulary. Shown automatically on a
// coordinator's first visit (lib/welcome.ts) and re-openable any time from
// the header's "How the Diary works" button.
//
// Modal deliberately (unlike the non-modal drawer): this is a reading
// moment, not a working one. Escape and the single button both dismiss;
// focus is held on the button (single-control trap, InkConfirm's pattern).
// ---------------------------------------------------------------------------

export interface WelcomePanelProps {
  readonly onDismiss: () => void;
}

export function WelcomePanel({ onDismiss }: WelcomePanelProps): ReactElement {
  const dismissRef = useRef<HTMLButtonElement | null>(null);

  // Focus the single control WITHOUT scrolling — a plain autoFocus scrolls
  // the panel to the button and clips the title on smaller viewports.
  useEffect(() => {
    dismissRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }
    // Single focusable control — keep Tab on it while the panel is open.
    if (event.key === "Tab") {
      event.preventDefault();
      dismissRef.current?.focus();
    }
  };

  return (
    <div className="diary-welcome-overlay">
      <div
        className="diary-welcome"
        role="dialog"
        aria-modal="true"
        aria-label={BOARD_COPY.welcome.title}
        aria-describedby="diary-welcome-intro"
        onKeyDown={onKeyDown}
      >
        <div className="diary-welcome-body">
          <h2 className="diary-welcome-title">{BOARD_COPY.welcome.title}</h2>
          <p id="diary-welcome-intro" className="diary-welcome-intro">
            {BOARD_COPY.welcome.intro}
          </p>
          <dl className="diary-welcome-entries">
            {BOARD_COPY.welcome.entries.map((entry) => (
              <div key={entry.term} className="diary-welcome-entry">
                <dt>{entry.term}</dt>
                <dd>{entry.detail}</dd>
              </div>
            ))}
          </dl>
          <p className="diary-welcome-disclosure">{BOARD_COPY.disclosure}</p>
        </div>
        <button
          type="button"
          className="diary-button is-primary"
          onClick={onDismiss}
          ref={dismissRef}
        >
          {BOARD_COPY.welcome.dismiss}
        </button>
      </div>
    </div>
  );
}
