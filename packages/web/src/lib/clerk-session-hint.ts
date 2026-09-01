// ---------------------------------------------------------------------------
// Clerk session hint — cookie-only detection of a likely existing Clerk
// session, with NO Clerk imports, so the check can run inside the router
// chunk without pulling the Clerk SDK into guest page loads.
//
// Why this exists (C2, the Run of Show): the planner routes (/plan,
// /plan/:code, /v/:venueSlug/plan) are deliberately Clerk-free so
// client-facing planning surfaces never pay the Clerk script/long-task
// cost (see AppRoot's comment in main.tsx). That held until the
// layout-timeline dock and the phase-snapshot freeze arrived: those are
// staff actions served by authenticated endpoints, so a signed-in
// coordinator deep-linking into /plan/<id> was silently unauthenticated —
// no ClerkAuthBridge ever mounted, the api client had no token getter,
// and every staff surface 401'd ("Session expired") despite a live Clerk
// session in the same browser. The router uses this hint to mount the
// (lazy) ClerkRouteProvider on planner routes only for returning
// signed-in users; guests keep the zero-Clerk fast path unchanged.
//
// Session evidence: Clerk maintains a `__client_uat` cookie (plus an
// instance-suffixed `__client_uat_<hash>` twin) on the app origin in both
// development and production instances. Its value is the unix timestamp
// of the last authentication — `0` is Clerk's own signed-out marker. A
// non-zero value means "a session very likely exists"; ClerkProvider then
// verifies it properly. A false positive costs one Clerk mount for a
// signed-out visitor with a stale cookie; a false negative is impossible
// for cookie-bearing sessions on this origin.
//
// The decision is taken at route mount: a user who signs in from another
// tab mid-session hydrates on their next navigation or reload, matching
// how the rest of the app treats cross-tab auth.
// ---------------------------------------------------------------------------

export function hasLikelyClerkSession(): boolean {
  try {
    return document.cookie.split("; ").some((entry) => {
      const eq = entry.indexOf("=");
      if (eq === -1) return false;
      const name = entry.slice(0, eq);
      if (name !== "__client_uat" && !name.startsWith("__client_uat_")) return false;
      const value = entry.slice(eq + 1);
      return value !== "" && value !== "0";
    });
  } catch {
    // Cookie access can throw in sandboxed/embedded documents; treat as
    // "no session" so the guest fast path stays intact.
    return false;
  }
}
