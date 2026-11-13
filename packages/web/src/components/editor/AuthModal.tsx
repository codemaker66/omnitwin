import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SignIn } from "@clerk/react";
import { isClerkGoogleSignInEnabled, VENVIEWER_CLERK_APPEARANCE } from "../auth/clerk-appearance.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { ApiError } from "../../api/client.js";
import { claimOpenDraft } from "../../hooks/use-planner-draft-claim.js";
import { getSafeReturnTo } from "../../lib/auth-return.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { ActivityStatus } from "../shared/Activity.js";
import "./AuthModal.css";

// ---------------------------------------------------------------------------
// AuthModal — Clerk sign-in in a modal for mid-flow authentication
// ---------------------------------------------------------------------------

interface AuthModalProps {
  readonly onClose: () => void;
}

// The claim itself is hooks/use-planner-draft-claim.ts: the planner page asks
// for it too, because signing in closes this dialog before the account is
// known, and the two share one request.

/**
 * Where Clerk sends the person once they have signed in: back to this plan.
 * With no address given, Clerk goes to the site's front page and the plan
 * they were saving is left behind. Clerk's own steps use the fragment, so the
 * plan's address is its path and options.
 */
function plannerReturnAddress(): string {
  return getSafeReturnTo(`${window.location.pathname}${window.location.search}`) ?? "/plan";
}

interface ClaimProblem {
  readonly message: string;
  readonly retryable: boolean;
}

const NOT_CREATED_HERE: ClaimProblem = {
  message: "This layout was started in another browser, so it can’t be added to your account from here. It is still open as a preview.",
  retryable: false,
};

function claimProblemFor(error: unknown): ClaimProblem {
  if (error instanceof ApiError && error.code === "NOT_PLAN_CREATOR") return NOT_CREATED_HERE;
  if (error instanceof ApiError && error.code === "CONFIGURATION_IN_VENUE_WORK") {
    return { message: "The venue is already using this layout for an event, so it stays with the venue. It is still open as a preview.", retryable: false };
  }
  return { message: "Couldn't add this layout to your account. Your preview is still available.", retryable: true };
}

export function AuthModal({ onClose }: AuthModalProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const [claimProblem, setClaimProblem] = useState<ClaimProblem | null>(null);
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
      setClaimProblem(null);
      void claimOpenDraft(configId, userId).then((outcome) => {
        if (!cancelled && outcome === "not-created-here") setClaimProblem(NOT_CREATED_HERE);
      }, (error: unknown) => {
        if (!cancelled) setClaimProblem(claimProblemFor(error));
      });
    } else if (isAuthenticated) {
      closeRef.current();
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, userId, configId, isPublicPreview, claimAttempt]);

  // Escape closes it wherever focus is, through the planner's one keyboard
  // owner, and while it is open the planner's shortcuts leave the room alone.
  useEscapeLayer("modal", { open: true, onEscape: onClose });

  // Portal to <body>: the planner shell declares `isolation: isolate`, which
  // traps any descendant z-index inside its stacking context — the overlay's
  // zIndex 200 would otherwise paint *below* root-level planner chrome (the
  // status header at z46 and the 3D/2D view-mode pill at z31), leaving that
  // chrome clickable on top of an open modal.
  return createPortal(
    <div className={modalClassName} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" tabIndex={-1}>
      <div ref={trapRef} className="auth-modal__panel" onClick={(e) => { e.stopPropagation(); }}>
        <h2 id="auth-modal-title" className="auth-modal__title">
          Sign In to Save
        </h2>
        {isAuthenticated && configId !== null && isPublicPreview ? (
          claimProblem === null ? (
            <ActivityStatus variant="panel">Adding this layout to your account…</ActivityStatus>
          ) : (
            <div className="auth-modal__claim-error">
              <p role="alert">{claimProblem.message}</p>
              {claimProblem.retryable ? (
                <button type="button" onClick={() => { setClaimProblem(null); setClaimAttempt((attempt) => attempt + 1); }}>Try again</button>
              ) : null}
              <button type="button" onClick={onClose}>Return to layout</button>
            </div>
          )
        ) : <SignIn appearance={VENVIEWER_CLERK_APPEARANCE} routing="hash" fallbackRedirectUrl={plannerReturnAddress()} />}
      </div>
    </div>,
    document.body,
  );
}
