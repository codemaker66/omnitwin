import { useEffect } from "react";
import { SignIn } from "@clerk/clerk-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { claimConfig } from "../../api/configurations.js";

// ---------------------------------------------------------------------------
// AuthModal — Clerk sign-in in a modal for mid-flow authentication
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 200, fontFamily: "'Inter', sans-serif",
};

const modalStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 32, width: 420,
  maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};

interface AuthModalProps {
  readonly onClose: () => void;
}

export function AuthModal({ onClose }: AuthModalProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);

  // When auth succeeds via Clerk, claim the config and close
  useEffect(() => {
    if (isAuthenticated && configId !== null && isPublicPreview) {
      void claimConfig(configId).then(() => {
        useEditorStore.setState({ isPublicPreview: false });
        void useEditorStore.getState().saveToServer(true);
      }).finally(() => {
        onClose();
      });
    } else if (isAuthenticated) {
      onClose();
    }
  }, [isAuthenticated, configId, isPublicPreview, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" tabIndex={-1}>
      <div style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", marginBottom: 16 }}>
          Sign In to Save
        </h2>
        <SignIn routing="hash" />
      </div>
    </div>
  );
}
