import { useEffect } from "react";
import { useUser, useAuth } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { setTokenGetter } from "../../api/auth-bridge.js";
import { getCurrentAuthUser, PlatformRoleSchema } from "../../api/auth.js";

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
    let cancelled = false;

    if (!isLoaded) {
      useAuthStore.getState().setLoading(true);
      return () => { cancelled = true; };
    }

    if (isSignedIn) {
      setTokenGetter(getToken);
      // After `isSignedIn` narrows, `user` is non-null per Clerk's types.
      const email = user.primaryEmailAddress?.emailAddress ?? "";
      // publicMetadata is `unknown` jsonb — only accept string values, never
      // trust a cast (a previous `as string` would let through numbers/objects).
      const rawRole = user.publicMetadata["role"];
      const role = typeof rawRole === "string" ? rawRole : "planner";
      const rawPlatformRole = user.publicMetadata["platformRole"];
      const platformRoleResult = PlatformRoleSchema.safeParse(rawPlatformRole);
      const platformRole = platformRoleResult.success ? platformRoleResult.data : "none";
      const rawVenueId = user.publicMetadata["venueId"];
      const venueId = typeof rawVenueId === "string" ? rawVenueId : null;

      useAuthStore.getState().setUser({
        id: user.id,
        email,
        role,
        platformRole,
        venueId,
        name: user.fullName ?? user.firstName ?? email.split("@")[0] ?? "User",
      });

      void getCurrentAuthUser()
        .then((dbUser) => {
          if (!cancelled) useAuthStore.getState().setUser(dbUser);
        })
        .catch(() => {
          // Keep the Clerk-derived fallback. API calls remain server-gated,
          // and uninvited users will fail closed at the endpoint boundary.
        });
    } else {
      useAuthStore.getState().setUser(null);
    }

    return () => { cancelled = true; };
  }, [getToken, isLoaded, isSignedIn, user]);

  // Register getToken with the API client's auth-bridge module so
  // non-React code (api/client.ts, api/enquiries.ts) can fetch tokens.
  // Depends on isSignedIn so the getter is cleared on logout — otherwise
  // the stale token function stays registered and returns expired tokens.
  useEffect(() => {
    if (isSignedIn === true) {
      setTokenGetter(getToken);
    } else {
      setTokenGetter(null);
    }
    return () => { setTokenGetter(null); };
  }, [getToken, isSignedIn]);

  return null;
}
