import { useEffect } from "react";
import { createPortal } from "react-dom";
import { SignIn } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { claimConfig } from "../../api/configurations.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";

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
  const trapRef = useFocusTrap<HTMLDivElement>();

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

  // Portal to <body>: the planner shell declares `isolation: isolate`, which
  // traps any descendant z-index inside its stacking context — the overlay's
  // zIndex 200 would otherwise paint *below* root-level planner chrome (the
  // status header at z46 and the 3D/2D view-mode pill at z31), leaving that
  // chrome clickable on top of an open modal.
  return createPortal(
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" tabIndex={-1}>
      <div ref={trapRef} style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h2 id="auth-modal-title" style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", marginBottom: 16 }}>
          Sign In to Save
        </h2>
        <SignIn routing="hash" />
      </div>
    </div>,
    document.body,
  );
}
