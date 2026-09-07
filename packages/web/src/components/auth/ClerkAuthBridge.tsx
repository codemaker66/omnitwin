import { useEffect } from "react";
import { useUser, useAuth } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { setTokenGetter } from "../../api/auth-bridge.js";
import { getCurrentAuthUser } from "../../api/auth.js";
import { ApiError } from "../../api/client.js";

/** Clerk proves identity; only the API may populate venue and platform access. */
export function ClerkAuthBridge(): null {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const retry = useAuthStore((state) => state.accessRetry);
  const identityId = user?.id;
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) {
      useAuthStore.getState().setLoading(true);
    } else if (isSignedIn) {
      setTokenGetter(getToken);
      useAuthStore.getState().beginAccessCheck(email);
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
      setTokenGetter(null);
      useAuthStore.getState().setUser(null);
    }
    return () => {
      cancelled = true;
      setTokenGetter(null);
    };
  }, [getToken, isLoaded, isSignedIn, identityId, email, retry]);

  return null;
}
