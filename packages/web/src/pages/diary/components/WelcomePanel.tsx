import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { BOARD_COPY } from "../board-copy.js";
import { useEscapeToClose, useFocusTrap } from "../../../lib/use-focus-trap.js";

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
  // T-615: the hand-rolled single-control trap and Escape handler were a
  // React onKeyDown on the panel, so both depended on focus already being
  // inside, and neither returned focus to the control that opened the panel.
  // The shared hooks do all three, and the trap degrades to the same
  // keep-Tab-here behaviour when there is exactly one focusable control.
  const dialogRef = useFocusTrap<HTMLDivElement>();
  useEscapeToClose(onDismiss);

  // Focus the single control WITHOUT scrolling — a plain autoFocus scrolls
  // the panel to the button and clips the title on smaller viewports. This
  // runs before the trap's rAF, which then leaves the focus where it is.
  useEffect(() => {
    dismissRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="diary-welcome-overlay">
      <div
        ref={dialogRef}
        className="diary-welcome"
        role="dialog"
        aria-modal="true"
        aria-label={BOARD_COPY.welcome.title}
        aria-describedby="diary-welcome-intro"
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
