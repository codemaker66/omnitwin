import { useId, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../../lib/use-focus-trap.js";

export function InventoryActionDialog({ title, children, busy, onClose }: {
  readonly title: string; readonly children: ReactNode; readonly busy: boolean; readonly onClose: () => void;
}): ReactElement {
  const headingId = useId();
  const trap = useFocusTrap<HTMLDivElement>();
  const heading = useRef<HTMLHeadingElement>(null);
  const prior = useRef({ title, busy });
  useLayoutEffect(() => {
    const changed = prior.current.title !== title || prior.current.busy !== busy;
    prior.current = { title, busy };
    if (changed && trap.current?.contains(document.activeElement) !== true) heading.current?.focus();
  }, [title, busy, trap]);
  return createPortal(<div className="inventory-overlay">
    <div ref={trap} className="inventory-editor inventory-action-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); if (!busy) onClose(); } }}>
      <header className="inventory-editor-header"><h2 id={headingId} ref={heading} tabIndex={-1}>{title}</h2>
        <button type="button" className="inventory-icon-button" aria-label="Close review dialog" disabled={busy} onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </div>
  </div>, document.body);
}
