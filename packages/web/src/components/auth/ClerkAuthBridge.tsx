import { useEffect } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { setTokenGetter } from "../../api/auth-bridge.js";

// ---------------------------------------------------------------------------
// ClerkAuthBridge — syncs Clerk session state to the Zustand auth store
// AND registers Clerk's getToken function with the API client's
// auth-bridge module so non-React code can fetch tokens.
//
// Punch list #9: previously mutated `window.__clerk_getToken` to expose
// getToken to the API client. Now uses a typed module-level setter pair
// (api/auth-bridge.ts) — no window mutation, no race conditions if
// multiple bridges mount.
// ---------------------------------------------------------------------------

export function ClerkAuthBridge(): null {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) {
      useAuthStore.getState().setLoading(true);
      return;
    }

    if (isSignedIn && user !== null && user !== undefined) {
      const email = user.primaryEmailAddress?.emailAddress ?? "";
      const role = (user.publicMetadata?.["role"] as string) ?? "planner";
      const venueId = (user.publicMetadata?.["venueId"] as string) ?? null;

      useAuthStore.getState().setUser({
        id: user.id,
        email,
        role,
        venueId,
        name: user.fullName ?? user.firstName ?? email.split("@")[0] ?? "User",
      });
    } else {
      useAuthStore.getState().setUser(null);
    }
  }, [isLoaded, isSignedIn, user]);

  // Register getToken with the API client's auth-bridge module so
  // non-React code (api/client.ts, api/enquiries.ts) can fetch tokens.
  // Returns a cleanup function that unregisters on unmount so test
  // tear-downs don't leak state into subsequent test cases.
  useEffect(() => {
    setTokenGetter(getToken);
    return () => { setTokenGetter(null); };
  }, [getToken]);

  return null;
}
