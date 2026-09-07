import { useState, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./WorkspaceAccessGate.css";

/** Keep a signed-in account out of operational pages until access is resolved. */
export function WorkspaceAccessGate({ children }: { readonly children: ReactNode }): React.ReactElement {
  const { accessStatus, accessEmail, error, retryAccess } = useAuthStore();
  const { signOut, openUserProfile } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  if (accessStatus !== "checking" && accessStatus !== "pending" && accessStatus !== "error") {
    return <>{children}</>;
  }

  const checking = accessStatus === "checking";
  const pending = accessStatus === "pending";
  const primaryEmail = user?.primaryEmailAddress;
  const needsVerification = isLoaded && isSignedIn && primaryEmail !== undefined && primaryEmail !== null
    && primaryEmail.verification.status !== "verified";
  const handleOpenProfile = (): void => {
    setProfileError(null);
    try {
      openUserProfile();
    } catch {
      setProfileError("Account settings did not open. Please try again.");
    }
  };
  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut({ redirectUrl: "/login" });
    } catch {
      setSignOutError("Sign out did not finish. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <main className="workspace-access" aria-label="Your Venviewer account">
      <section className="workspace-access__card">
        <a className="workspace-access__brand" href="/plan">Venviewer</a>
        <p className="workspace-access__eyebrow">Your venue workspace</p>
        <h1>{checking ? "Finding your place." : needsVerification ? "Verify your email to continue." : pending ? "Your account is ready." : "Let’s reconnect."}</h1>
        {accessEmail !== null && accessEmail !== "" && <p className="workspace-access__email">Signed in as <strong>{accessEmail}</strong></p>}
        {checking ? <ActivityStatus variant="panel">Confirming your venue access…</ActivityStatus> : (
          <>
            {needsVerification ? <p role="status">In account settings, find Email addresses, open the menu beside your email and choose Complete verification. After verifying, return here and choose Check my access.</p> : <>
              <p role={pending ? "status" : "alert"}>{pending
                ? "Your venue access is pending. Ask your Venviewer contact to add this email address to the right venue, then check access below."
                : error}</p>
              {pending && <p>Already invited? Use the same email address as your invitation.</p>}
            </>}
          </>
        )}
        <div className="workspace-access__actions">
          {!checking && needsVerification && <button type="button" onClick={handleOpenProfile} disabled={signingOut}>Open account settings</button>}
          {!checking && <button type="button" onClick={retryAccess} disabled={signingOut}>Check my access</button>}
          <button type="button" className="workspace-access__secondary" disabled={signingOut}
            aria-busy={signingOut} onClick={() => { void handleSignOut(); }}>
            {signingOut && <ActivityIndicator size={18} />}
            {signingOut ? "Signing out…" : "Use another account"}
          </button>
        </div>
        {profileError !== null && profileError !== "" && <p role="alert">{profileError}</p>}
        {signOutError !== null && signOutError !== "" && <p role="alert">{signOutError}</p>}
      </section>
    </main>
  );
}
