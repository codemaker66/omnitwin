import { useEffect } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { useAuthStore } from "../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// ClerkAuthBridge — syncs Clerk session state to the Zustand auth store
// so existing components (dashboard, protected routes, etc.) keep working.
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

  // Expose getToken globally for the API client
  useEffect(() => {
    if (getToken !== undefined) {
      (window as unknown as Record<string, unknown>)["__clerk_getToken"] = getToken;
    }
  }, [getToken]);

  return null;
}
