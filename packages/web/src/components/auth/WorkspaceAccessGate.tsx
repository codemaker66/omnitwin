import { useState, type FormEvent, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/react";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { useAuthStore } from "../../stores/auth-store.js";
import { submitGuestEnquiry } from "../../api/configurations.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./WorkspaceAccessGate.css";

/**
 * The public dead end, closed.
 *
 * An uninvited but signed-in identity used to be told to "ask your Venviewer
 * contact" with no way to ask. This posts that ask to the same public enquiry
 * route the site's own enquiry form uses, tagged as a venue-access request so
 * the inbox can tell it from a booking. The email is the one already being
 * refused, so the venue answers the identity it is actually looking at.
 */
function RequestAccessForm({ email }: { readonly email: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setState("sending");
    try {
      await submitGuestEnquiry({
        venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
        email,
        eventType: "venue-access",
        message: note.trim().length > 0
          ? `Venue access request from ${email}. ${note.trim()}`
          : `Venue access request from ${email}.`,
      });
      setState("sent");
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <p role="status" className="workspace-access__request-sent">
        Request sent. The venue will reply to {email}.
      </p>
    );
  }

  if (!open) {
    return (
      <p>
        <button type="button" className="workspace-access__request-open" onClick={() => { setOpen(true); }}>
          Request access
        </button>
      </p>
    );
  }

  const sending = state === "sending";
  return (
    <form className="workspace-access__request" onSubmit={(event) => { void handleSubmit(event); }}>
      <label htmlFor="workspace-access-note">Anything the venue should know? (optional)</label>
      <textarea id="workspace-access-note" name="note" rows={3} maxLength={500} value={note}
        disabled={sending} onChange={(event) => { setNote(event.target.value); }} />
      <button type="submit" disabled={sending} aria-busy={sending}>
        {sending && <ActivityIndicator size={18} />}
        {sending ? "Sending…" : "Send request"}
      </button>
      {state === "error" && <p role="alert">That request did not send. Please try again.</p>}
    </form>
  );
}

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
        <h1>{checking ? "Venue access" : needsVerification ? "Verify your email" : pending ? "Venue access pending" : "Connection unavailable"}</h1>
        {accessEmail !== null && accessEmail !== "" && <p className="workspace-access__email"><strong>{accessEmail}</strong></p>}
        {checking ? <ActivityStatus variant="panel">Checking access…</ActivityStatus> : (
          <>
            {needsVerification ? <p role="status">In account settings, open your email menu under Email addresses and choose Complete verification. Then return here and choose Check my access.</p> : <>
              <p role={pending ? "status" : "alert"}>{pending
                ? "Ask your Venviewer contact to grant this email venue access."
                : error}</p>
              {pending && <p>Invited? Sign in with your invitation email.</p>}
              {pending && accessEmail !== null && accessEmail !== "" && <RequestAccessForm email={accessEmail} />}
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
          <a className="workspace-access__secondary" href="/">Back to Venviewer</a>
        </div>
        {profileError !== null && profileError !== "" && <p role="alert">{profileError}</p>}
        {signOutError !== null && signOutError !== "" && <p role="alert">{signOutError}</p>}
      </section>
    </main>
  );
}
