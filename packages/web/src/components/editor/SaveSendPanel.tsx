import { useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { AuthModal } from "./AuthModal.js";

// ---------------------------------------------------------------------------
// SaveSendPanel — floating CTA panel at bottom-right
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed", top: 20, right: 80, zIndex: 60,
  background: "rgba(255,255,255,0.95)", borderRadius: 12,
  padding: 12, display: "flex", flexDirection: "row", gap: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e5e5e5",
  fontFamily: "'Inter', sans-serif", backdropFilter: "blur(8px)",
};

const btnBase: React.CSSProperties = {
  padding: "10px 20px", fontSize: 14, fontWeight: 600, border: "none",
  borderRadius: 8, cursor: "pointer", transition: "background 0.2s",
};

const saveBtn: React.CSSProperties = {
  ...btnBase, background: "#1a1a2e", color: "#fff",
};

const sendBtn: React.CSSProperties = {
  ...btnBase, background: "#2563eb", color: "#fff",
};

export function SaveSendPanel(): React.ReactElement | null {
  const objects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const saveToServer = useEditorStore((s) => s.saveToServer);
  const isSaving = useEditorStore((s) => s.isSaving);

  const [showEnquiry, setShowEnquiry] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState(false);

  if (objects.length === 0 || configId === null) return null;

  const handleSave = (): void => {
    if (isAuthenticated) {
      void saveToServer(true).then(() => {
        setSaveConfirm(true);
        setTimeout(() => { setSaveConfirm(false); }, 2000);
      });
    } else {
      setShowAuth(true);
    }
  };

  return (
    <>
      <div style={panelStyle} data-testid="save-send-panel">
        <button
          type="button"
          style={{ ...saveBtn, opacity: isSaving ? 0.7 : 1 }}
          onClick={handleSave}
          disabled={isSaving}
        >
          {saveConfirm ? "Saved!" : isSaving ? "Saving..." : "Save to My Account"}
        </button>
        <button
          type="button"
          style={sendBtn}
          onClick={() => { setShowEnquiry(true); }}
        >
          Send to Events Team
        </button>
      </div>

      {showEnquiry && (
        <GuestEnquiryModal
          configId={configId}
          onClose={() => { setShowEnquiry(false); }}
        />
      )}

      {showAuth && (
        <AuthModal onClose={() => { setShowAuth(false); }} />
      )}
    </>
  );
}
