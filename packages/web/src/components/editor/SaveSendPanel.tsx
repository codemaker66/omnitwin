import { useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { AuthModal } from "./AuthModal.js";

// ---------------------------------------------------------------------------
// SaveSendPanel — floating CTA panel at bottom-right
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed", top: 16, right: 72, zIndex: 60,
  display: "flex", flexDirection: "row", gap: 10,
  fontFamily: "'Inter', sans-serif",
};

const saveBtn: React.CSSProperties = {
  padding: "9px 20px", fontSize: 13, fontWeight: 500, letterSpacing: 0.3,
  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
  cursor: "pointer", transition: "all 0.2s",
  background: "rgba(26,26,30,0.75)", color: "rgba(255,255,255,0.85)",
  backdropFilter: "blur(12px)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
};

const sendBtn: React.CSSProperties = {
  padding: "9px 20px", fontSize: 13, fontWeight: 500, letterSpacing: 0.3,
  border: "1px solid rgba(201,168,76,0.3)", borderRadius: 6,
  cursor: "pointer", transition: "all 0.2s",
  background: "linear-gradient(135deg, #c9a84c 0%, #a8893e 100%)",
  color: "#1a1a1a", boxShadow: "0 2px 12px rgba(201,168,76,0.2)",
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
