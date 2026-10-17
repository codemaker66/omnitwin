import { useEffect, useId, type ReactElement } from "react";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { useVisitorPlanPdf } from "../../hooks/use-visitor-plan-pdf.js";
import { useVisitorPlanLinks } from "../../hooks/use-visitor-plan-links.js";
import { VisitorPlanPdfActions } from "./VisitorPlanPdfActions.js";
import { VisitorPlanLinkActions } from "./VisitorPlanLinkActions.js";
import "./VisitorPlanPdfSheet.css";

// ---------------------------------------------------------------------------
// VisitorPlanPdfSheet — "Send your plan" on a phone (fix-first item 11).
//
// Phones have no cockpit dock, so the Share lens is out of reach there. The
// planner's top bar opens this sheet instead: one job, one sheet. It names
// what is sent and what is not (no prices; drawn by a visitor, not reviewed
// by the venue), then offers the plan two ways, as on the desktop Share lens:
// a PDF handed to the phone's own share sheet or saved, and a view-only link
// copied to paste into a message. Asking the venue stays where it was: Send.
// ---------------------------------------------------------------------------

interface VisitorPlanPdfSheetProps {
  readonly configId: string;
  readonly roomName: string;
  readonly onClose: () => void;
}

export function VisitorPlanPdfSheet({ configId, roomName, onClose }: VisitorPlanPdfSheetProps): ReactElement {
  const titleId = useId();
  const pdf = useVisitorPlanPdf(configId, roomName);
  const links = useVisitorPlanLinks(configId);
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
            <p className="visitor-pdf-sheet__room">{roomName} · a PDF or a view-only link</p>
          </div>
          <button type="button" className="visitor-pdf-sheet__close" onClick={onClose}>Close</button>
        </header>
        <p className="visitor-pdf-sheet__body">
          For anyone you are planning with. Both show the room and your layout to scale, with no prices,
          and say it was drawn by a visitor and not reviewed by the venue.
        </p>
        <VisitorPlanPdfActions pdf={pdf} tone="sheet" unavailableReason={null} />
        <h3 className="visitor-pdf-sheet__subhead">Or send a link</h3>
        <VisitorPlanLinkActions links={links} tone="sheet" unavailableReason={null} />
        <p className="visitor-pdf-sheet__venue">
          To have the events team look at this plan, close this and use Send.
        </p>
      </div>
    </div>
  );
}
