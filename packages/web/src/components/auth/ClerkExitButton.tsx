import { useState } from "react";
import { useClerk } from "@clerk/react";
import { ActivityIndicator } from "../shared/Activity.js";
import type { AskBeforeSignOut } from "../dashboard/staff-shell.js";

export interface ExitButtonProps {
  readonly onLocalSignOut: () => void;
  /** Inside the staff shell, asks first about anything the page would lose. */
  readonly askFirst: AskBeforeSignOut;
}

/**
 * The refusal screen's way out through Clerk's own sign-out.
 *
 * This lives in its own module on purpose: ProtectedRoute is imported by the
 * router, which every visitor loads, and a static `@clerk/react` import there
 * put the whole Clerk chunk on the front door. ProtectedRoute loads this file
 * only when an access-denied screen is actually shown.
 *
 * Clerk's hook is reached through a component that only mounts when the
 * provider is really there. ClerkRouteProvider returns its children bare under
 * the E2E auth bypass, so calling useClerk() at the guard's level would throw
 * and take the whole refusal screen with it — a guard that renders nothing is
 * worse than the dead end it was meant to fix.
 */
export function ClerkExitButton({ onLocalSignOut, askFirst }: ExitButtonProps): React.ReactElement {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      onLocalSignOut();
      await signOut({ redirectUrl: "/login" });
    } catch {
      setSignOutError("Sign out did not finish. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <button type="button" className="vv-button primary" disabled={signingOut} aria-busy={signingOut}
        onClick={() => { askFirst(() => { void handleSignOut(); }); }}>
        {signingOut && <ActivityIndicator size={18} />}
        {signingOut ? "Signing out…" : "Use another account"}
      </button>
      {signOutError !== null && <p role="alert">{signOutError}</p>}
    </>
  );
}
