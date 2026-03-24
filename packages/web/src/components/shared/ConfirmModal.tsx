import { useState } from "react";

// ---------------------------------------------------------------------------
// ConfirmModal — reusable confirmation dialog
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 300, fontFamily: "'Inter', sans-serif",
};

const modalStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 24, width: 400,
  maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
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
  readonly onConfirm: (note?: string) => void;
  readonly onCancel: () => void;
}

export function ConfirmModal({
  title, message, confirmLabel = "Confirm", confirmColor = "#dc2626",
  showNoteField = false, onConfirm, onCancel,
}: ConfirmModalProps): React.ReactElement {
  const [note, setNote] = useState("");

  return (
    <div style={overlayStyle} onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} role="dialog" tabIndex={-1}>
      <div style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>{message}</p>
        {showNoteField && (
          <textarea
            style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #ddd", borderRadius: 6, marginBottom: 12, boxSizing: "border-box", resize: "vertical" }}
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => { setNote(e.target.value); }}
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={{ ...btnBase, background: "#f3f4f6", color: "#333" }} onClick={onCancel}>Cancel</button>
          <button type="button" style={{ ...btnBase, background: confirmColor, color: "#fff" }} onClick={() => { onConfirm(showNoteField ? note : undefined); }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
