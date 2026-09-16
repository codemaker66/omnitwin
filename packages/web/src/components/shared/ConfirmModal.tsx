import { useState } from "react";
import { ActivityIndicator } from "./Activity.js";
import { useEscapeToClose, useFocusTrap } from "../../lib/use-focus-trap.js";

// ---------------------------------------------------------------------------
// ConfirmModal — reusable confirmation dialog
//
// T-615 (one register): the sheet was a near-black gradient with a brass
// hairline and a cyan bloom — three registers inside one dialog. It is now an
// ivory sheet with forest ink over a forest scrim, and the destructive confirm
// keeps its own oxblood so "delete" never reads as "continue".
//
// Escape now works from the moment the dialog mounts. It used to be a React
// onKeyDown on the overlay, which only fires once focus is already inside — so
// Escape did nothing in the frame before the trap had moved focus, and nothing
// at all if the opener kept it. It is refused while a write is in flight; the
// trap stays on either way, and unmounting returns focus to the opener
// (useFocusTrap's cleanup).
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(18, 34, 28, 0.62)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 300, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", contain: "paint",
};

const modalStyle: React.CSSProperties = {
  background: "var(--vv-ivory-3)",
  border: "1px solid var(--vv-rule)",
  borderRadius: 12,
  padding: 24,
  width: 400,
  maxWidth: "90vw",
  boxShadow: "0 24px 70px rgba(18, 34, 28, 0.32)",
  color: "var(--vv-forest)",
};

const btnBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  minHeight: 40,
  padding: "8px 16px", fontSize: 14, fontWeight: 600, border: "none",
  borderRadius: 8, cursor: "pointer",
};

interface ConfirmModalProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly confirmColor?: string;
  readonly showNoteField?: boolean;
  readonly inFlight?: boolean;
  readonly errorMessage?: string | null;
  readonly onConfirm: (note?: string) => void;
  readonly onCancel: () => void;
}

export function ConfirmModal({
  title, message, confirmLabel = "Confirm", confirmColor = "var(--vv-oxblood)",
  showNoteField = false, inFlight = false, errorMessage = null, onConfirm, onCancel,
}: ConfirmModalProps): React.ReactElement {
  const [note, setNote] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>();
  useEscapeToClose(onCancel, !inFlight);

  return (
    <div
      style={overlayStyle}
      onClick={() => { if (!inFlight) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      tabIndex={-1}
    >
      <div ref={trapRef} style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h3 id="confirm-modal-title" style={{ fontSize: 16, fontWeight: 700, color: "var(--vv-forest)", marginBottom: 8 }}>{title}</h3>
        <p id="confirm-modal-message" style={{ fontSize: 14, color: "var(--vv-forest-soft)", marginBottom: 16 }}>{message}</p>
        {errorMessage !== null && (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              marginBottom: 12,
              borderRadius: 8,
              color: "var(--vv-oxblood)",
              background: "var(--vv-oxblood-bg)",
              border: "1px solid color-mix(in srgb, var(--vv-oxblood) 38%, transparent)",
              fontSize: 13,
            }}
          >
            {errorMessage}
          </div>
        )}
        {showNoteField && (
          <textarea
            aria-label="Confirmation note"
            disabled={inFlight}
            style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid var(--vv-rule)", borderRadius: 8, marginBottom: 12, boxSizing: "border-box", resize: "vertical", color: "var(--vv-forest)", background: "var(--vv-ivory)" }}
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => { setNote(e.target.value); }}
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...btnBase, background: "var(--vv-ivory-2)", color: "var(--vv-forest)", border: "1px solid var(--vv-rule)" }}
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{ ...btnBase, background: confirmColor, color: "var(--vv-ivory-3)", opacity: inFlight ? 0.7 : 1 }}
            disabled={inFlight}
            onClick={() => { onConfirm(showNoteField ? note : undefined); }}
            aria-busy={inFlight}
          >
            {inFlight && <ActivityIndicator size={18} />}
            {inFlight ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
