import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SignIn } from "@clerk/react";
import { isClerkGoogleSignInEnabled, VENVIEWER_CLERK_APPEARANCE } from "../auth/clerk-appearance.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { captureEditorSession, isCurrentEditorSession, useEditorStore } from "../../stores/editor-store.js";
import { claimConfig } from "../../api/configurations.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { ActivityStatus } from "../shared/Activity.js";
import "./AuthModal.css";

// ---------------------------------------------------------------------------
// AuthModal — Clerk sign-in in a modal for mid-flow authentication
// ---------------------------------------------------------------------------

interface AuthModalProps {
  readonly onClose: () => void;
}

// Claim is not idempotent. Share its result across StrictMode effect replay and
// dismissal/reopening; server settlement belongs to this editor/account session.
const pendingClaims = new Map<string, Promise<void>>();
function claimPreview(configId: string, userId: string | null): Promise<void> {
  const session = captureEditorSession();
  const key = JSON.stringify([configId, session.generation, userId]);
  const pending = pendingClaims.get(key);
  if (pending !== undefined) return pending;
  const request = claimConfig(configId).then(() => {
    const auth = useAuthStore.getState();
    if (!isCurrentEditorSession(session) || !auth.isAuthenticated || (auth.user?.id ?? null) !== userId) return;
    useEditorStore.setState({ isPublicPreview: false });
    void useEditorStore.getState().saveToServer(true);
  }).finally(() => { pendingClaims.delete(key); });
  pendingClaims.set(key, request);
  return request;
}

export function AuthModal({ onClose }: AuthModalProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimAttempt, setClaimAttempt] = useState(0);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const trapRef = useFocusTrap<HTMLDivElement>();
  const modalClassName = isClerkGoogleSignInEnabled()
    ? "auth-modal auth-modal--social-enabled"
    : "auth-modal auth-modal--social-disabled";

  // When auth succeeds via Clerk, claim the config and close
  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated && configId !== null && isPublicPreview) {
      setClaimError(null);
      void claimPreview(configId, userId).catch(() => {
        if (!cancelled) setClaimError("We couldn't add this layout to your account. Your preview is still available. Try again.");
      });
    } else if (isAuthenticated) {
      closeRef.current();
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, userId, configId, isPublicPreview, claimAttempt]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
  };

  // Portal to <body>: the planner shell declares `isolation: isolate`, which
  // traps any descendant z-index inside its stacking context — the overlay's
  // zIndex 200 would otherwise paint *below* root-level planner chrome (the
  // status header at z46 and the 3D/2D view-mode pill at z31), leaving that
  // chrome clickable on top of an open modal.
  return createPortal(
    <div className={modalClassName} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" tabIndex={-1}>
      <div ref={trapRef} className="auth-modal__panel" onClick={(e) => { e.stopPropagation(); }}>
        <h2 id="auth-modal-title" className="auth-modal__title">
          Sign In to Save
        </h2>
        {isAuthenticated && configId !== null && isPublicPreview ? (
          claimError === null ? (
            <ActivityStatus variant="panel">Adding this layout to your account…</ActivityStatus>
          ) : (
            <div className="auth-modal__claim-error">
              <p role="alert">{claimError}</p>
              <button type="button" onClick={() => { setClaimError(null); setClaimAttempt((attempt) => attempt + 1); }}>Try again</button>
              <button type="button" onClick={onClose}>Return to layout</button>
            </div>
          )
        ) : <SignIn appearance={VENVIEWER_CLERK_APPEARANCE} routing="hash" />}
      </div>
    </div>,
    document.body,
  );
}
