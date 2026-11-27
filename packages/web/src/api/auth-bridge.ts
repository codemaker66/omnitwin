// ---------------------------------------------------------------------------
// Auth bridge — connects Clerk's React-hook-only getToken() to the
// non-React API client.
//
// Punch list #9: previously this was a window-global mutation
// (`window.__clerk_getToken = getToken`) with three layers of
// unsafe double-casting on both sides. That pattern has race conditions
// if multiple bridges mount, is type-unsafe,
// and is the kind of thing diligence reviewers grep for.
//
// Now: a module-level setter/getter pair, fully typed, single instance.
// ClerkAuthBridge calls `setTokenGetter(getToken)` whenever it sees a person
// signed in, and the getter stays after that bridge unmounts: what a page
// sends as it goes, and a next page with no sign-in provider, still reach
// Clerk's getToken, which reads the browser's live session on every call and
// answers null once nobody is signed in. Only a mounted bridge that sees
// nobody signed in (or a sign-in that cannot load) clears it. The API client
// calls `getTokenGetter()` whenever it needs a fresh token; the Clerk SDK's
// getToken handles refresh automatically.
//
// SSR/test note: this module's state is per-process. In tests it must
// be reset between cases — see api-client.test.ts beforeEach.
// ---------------------------------------------------------------------------

export type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/**
 * Register the function the API client should call to get a fresh auth
 * token. Called by ClerkAuthBridge after Clerk's useAuth() resolves.
 */
export function setTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

/**
 * Returns the registered token getter: null before any bridge has seen a
 * person signed in, and after a mounted bridge has seen nobody signed in or
 * a sign-in that cannot load. A bridge that unmounts leaves it in place, so
 * null does not mean "no bridge is mounted".
 */
export function getTokenGetter(): TokenGetter | null {
  return tokenGetter;
}

/**
 * Test-only helper. Use in beforeEach() to reset module state between
 * test cases.
 */
export function _resetTokenGetterForTests(): void {
  tokenGetter = null;
}
