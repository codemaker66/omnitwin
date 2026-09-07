import { useState, type ReactNode } from "react";
import { useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./WorkspaceAccessGate.css";

/** Keep a signed-in account out of operational pages until access is resolved. */
export function WorkspaceAccessGate({ children }: { readonly children: ReactNode }): React.ReactElement {
  const { accessStatus, accessEmail, error, retryAccess } = useAuthStore();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (accessStatus !== "checking" && accessStatus !== "pending" && accessStatus !== "error") {
    return <>{children}</>;
  }

  const checking = accessStatus === "checking";
  const pending = accessStatus === "pending";
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
        <h1>{checking ? "Venue access" : pending ? "Venue access pending" : "Connection unavailable"}</h1>
        {accessEmail !== null && accessEmail !== "" && <p className="workspace-access__email"><strong>{accessEmail}</strong></p>}
        {checking ? <ActivityStatus variant="panel">Checking access…</ActivityStatus> : (
          <>
            <p role={pending ? "status" : "alert"}>{pending
              ? "Ask your Venviewer contact to grant this email venue access."
              : error}</p>
            {pending && <p>Invited? Sign in with your invitation email and verify it.</p>}
          </>
        )}
        <div className="workspace-access__actions">
          {!checking && <button type="button" onClick={retryAccess} disabled={signingOut}>Check my access</button>}
          <button type="button" className="workspace-access__secondary" disabled={signingOut}
            aria-busy={signingOut} onClick={() => { void handleSignOut(); }}>
            {signingOut && <ActivityIndicator size={18} />}
            {signingOut ? "Signing out…" : "Use another account"}
          </button>
        </div>
        {signOutError !== null && signOutError !== "" && <p role="alert">{signOutError}</p>}
      </section>
    </main>
  );
}
