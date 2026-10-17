import { useEffect, useId, type ReactElement } from "react";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { useVisitorPlanPdf } from "../../hooks/use-visitor-plan-pdf.js";
import { VisitorPlanPdfActions } from "./VisitorPlanPdfActions.js";
import "./VisitorPlanPdfSheet.css";

// ---------------------------------------------------------------------------
// VisitorPlanPdfSheet — "Send your plan" on a phone (fix-first item 11).
//
// Phones have no cockpit dock, so the Share lens is out of reach there. The
// planner's top bar opens this sheet instead: one job, one sheet. It names
// what the file is and what it is not (no prices; drawn by a visitor, not
// reviewed by the venue), then hands the file to the phone's own share sheet
// or saves it. Asking the venue stays where it was: the Send button.
// ---------------------------------------------------------------------------

interface VisitorPlanPdfSheetProps {
  readonly configId: string;
  readonly roomName: string;
  readonly onClose: () => void;
}

export function VisitorPlanPdfSheet({ configId, roomName, onClose }: VisitorPlanPdfSheetProps): ReactElement {
  const titleId = useId();
  const pdf = useVisitorPlanPdf(configId, roomName);
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  return (
    <div
      className="visitor-pdf-sheet__backdrop"
      data-testid="visitor-pdf-sheet-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={trapRef}
        className="visitor-pdf-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="visitor-pdf-sheet"
      >
        <header className="visitor-pdf-sheet__head">
          <div>
            <h2 id={titleId} className="visitor-pdf-sheet__title">Send your plan</h2>
            <p className="visitor-pdf-sheet__room">{roomName} · a one-page PDF</p>
          </div>
          <button type="button" className="visitor-pdf-sheet__close" onClick={onClose}>Close</button>
        </header>
        <p className="visitor-pdf-sheet__body">
          For anyone you are planning with. It shows the room and your layout to scale, with no prices,
          and says it was drawn by a visitor and not reviewed by the venue.
        </p>
        <VisitorPlanPdfActions pdf={pdf} tone="sheet" unavailableReason={null} />
        <p className="visitor-pdf-sheet__venue">
          To have the events team look at this plan, close this and use Send.
        </p>
      </div>
    </div>
  );
}
