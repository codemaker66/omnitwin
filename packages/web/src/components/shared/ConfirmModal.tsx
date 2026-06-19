import { useState } from "react";
import { useFocusTrap } from "../../lib/use-focus-trap.js";

// ---------------------------------------------------------------------------
// ConfirmModal — reusable confirmation dialog
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 300, fontFamily: "'Inter', sans-serif", backdropFilter: "blur(14px)",
};

const modalStyle: React.CSSProperties = {
  background: "linear-gradient(150deg, rgba(22,19,15,0.98), rgba(10,10,9,0.95))",
  border: "1px solid rgba(215,181,109,0.28)",
  borderRadius: 12,
  padding: 24,
  width: 400,
  maxWidth: "90vw",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  color: "#fff7e8",
};

const btnBase: React.CSSProperties = {
  padding: "8px 16px", fontSize: 14, fontWeight: 600, border: "none",
  borderRadius: 6, cursor: "pointer",
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
  title, message, confirmLabel = "Confirm", confirmColor = "#dc2626",
  showNoteField = false, inFlight = false, errorMessage = null, onConfirm, onCancel,
}: ConfirmModalProps): React.ReactElement {
  const [note, setNote] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>();

  return (
    <div
      style={overlayStyle}
      onClick={() => { if (!inFlight) onCancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !inFlight) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      tabIndex={-1}
    >
      <div ref={trapRef} style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h3 id="confirm-modal-title" style={{ fontSize: 16, fontWeight: 700, color: "#fff7e8", marginBottom: 8 }}>{title}</h3>
        <p id="confirm-modal-message" style={{ fontSize: 14, color: "rgba(246,241,232,0.72)", marginBottom: 16 }}>{message}</p>
        {errorMessage !== null && (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              marginBottom: 12,
              borderRadius: 8,
              color: "#ffd89a",
              background: "rgba(255, 181, 82, 0.09)",
              border: "1px solid rgba(255, 181, 82, 0.38)",
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
            style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid rgba(215,181,109,0.28)", borderRadius: 6, marginBottom: 12, boxSizing: "border-box", resize: "vertical", color: "#fff7e8", background: "rgba(255,247,232,0.08)" }}
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => { setNote(e.target.value); }}
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...btnBase, background: "rgba(255,247,232,0.08)", color: "#fff7e8", border: "1px solid rgba(215,181,109,0.24)" }}
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{ ...btnBase, background: confirmColor, color: "#fff", opacity: inFlight ? 0.7 : 1 }}
            disabled={inFlight}
            onClick={() => { onConfirm(showNoteField ? note : undefined); }}
          >
            {inFlight ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
