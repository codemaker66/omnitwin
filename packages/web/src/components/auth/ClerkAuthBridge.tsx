import { useEffect } from "react";
import { useUser, useAuth, useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { setTokenGetter } from "../../api/auth-bridge.js";
import { getCurrentAuthUser } from "../../api/auth.js";
import { ApiError } from "../../api/client.js";

/** Clerk proves identity; only the API may populate venue and platform access. */
export function ClerkAuthBridge(): null {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  // The provider's own script can fail to load (patchy wifi, an outage, a
  // content blocker). It gives up by itself and reports "error"; `isLoaded`
  // then stays false for good. Nobody is signed in on a page whose sign-in
  // could not load, so that reads as signed out: a protected page sends the
  // person to the sign-in page, which says sign-in is unavailable, instead of
  // every page standing at "Checking access…" for ever.
  const signInUnavailable = useClerk().status === "error";
  const retry = useAuthStore((state) => state.accessRetry);
  const identityId = user?.id;
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded && !signInUnavailable) {
      useAuthStore.getState().setLoading(true);
    } else if (isLoaded && isSignedIn) {
      setTokenGetter(getToken);
      // Each route group mounts its own bridge. A person already confirmed for
      // this same identity stays on the page while /auth/me is asked again
      // behind it; its answer applies a changed role, or a refusal, as a first
      // check's would. Any other identity is checked from nobody.
      useAuthStore.getState().beginAccessCheck(email, identityId ?? null);
      // An explicit retry after email verification must not reuse older JWT claims.
      const request = retry > 0
        ? getToken({ skipCache: true }).then(() => cancelled ? null : getCurrentAuthUser())
        : getCurrentAuthUser();
      void request.then((dbUser) => {
        if (!cancelled && dbUser !== null) useAuthStore.getState().setUser(dbUser);
      }).catch((error: unknown) => {
        if (cancelled) return;
        const pending = error instanceof ApiError && error.code === "INVITATION_REQUIRED";
        useAuthStore.getState().failAccessCheck(
          pending ? "Your account is ready. Venue access is waiting for an invitation."
            : "We could not confirm your venue access. Try again, or sign in again if your session has expired.",
          pending,
        );
      });
    } else {
      // Only a sign-out (or a sign-in that cannot load) lets go of the getter.
      setTokenGetter(null);
      useAuthStore.getState().setUser(null);
    }
    // Leaving the getter in place as the bridge unmounts is deliberate. What a
    // page sends as it goes (the planner's last save, the action log behind
    // it) is built after every cleanup of that route change, and the next page
    // may have no sign-in provider at all. Clerk's getToken reads the browser's
    // one live session each time it is called and answers null once nobody is
    // signed in, so it never speaks for a person who has signed out, nor for
    // the last person once another has signed in.
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, signInUnavailable, identityId, email, retry]);

  return null;
}
