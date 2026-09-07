const AUTH_RETURN_ORIGIN = "https://venviewer.invalid";
const AUTH_ROUTE_PREFIX = /^\/(?:login|register|onboard|app|oauth-consent)(?:\/|$)/iu;

function hasForbiddenCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code < 32 || (code >= 127 && code <= 159);
  });
}

/** Preserve an internal destination without accepting external redirects or
 * returning to an authentication route. Query values remain opaque: a URL in
 * a harmless query parameter must not be mistaken for the destination host. */
export function getSafeReturnTo(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith("/") || value.startsWith("//")) return null;
  if (hasForbiddenCharacters(value)) return null;

  try {
    if (hasForbiddenCharacters(decodeURIComponent(value))) return null;
    const destination = new URL(value, AUTH_RETURN_ORIGIN);
    if (destination.origin !== AUTH_RETURN_ORIGIN) return null;

    // Inspect each encoded path layer, including dot-segment normalization.
    // Keep the original URL for navigation so encoded query/fragment values
    // retain their exact meaning. Encoded slashes cannot introduce another host.
    let path = value.split(/[?#]/u, 1)[0] ?? "/";
    for (;;) {
      if (/%(?:2f|5c)/iu.test(path) || hasForbiddenCharacters(path)) return null;
      const normalized = new URL(path, AUTH_RETURN_ORIGIN);
      if (normalized.origin !== AUTH_RETURN_ORIGIN || AUTH_ROUTE_PREFIX.test(normalized.pathname)) return null;

      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // An initially valid %25 may decode to a literal percent sign. The
        // initial full-URL decode above already rejected malformed input.
        break;
      }
      if (decoded === path) break;
      path = decoded;
    }
    return value;
  } catch {
    return null;
  }
}

export function getAuthReturnTo(search: string): string | null {
  return getSafeReturnTo(new URLSearchParams(search).get("returnTo"));
}

export function authRouteWithReturnTo(route: "/login" | "/register", returnTo: string): string {
  const destination = getSafeReturnTo(returnTo);
  if (destination === null) return route;
  return `${route}?${new URLSearchParams({ returnTo: destination }).toString()}`;
}
