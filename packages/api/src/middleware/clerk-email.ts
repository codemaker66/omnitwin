import { resolveVerifiedClerkEmail, type VerifiedEmailResolution } from "./auth.js";

// ---------------------------------------------------------------------------
// Verified-email resolution with a Backend-API fallback (Slice 4, T-518).
//
// Venviewer's production Clerk instance customises the session token to carry
// `email` + an explicit verified flag, and `resolveVerifiedClerkEmail` fails
// closed without them. Clerk's DEFAULT session token carries neither — so on
// any instance without that customisation (the dev instance today), every
// real token was rejected with EMAIL_REQUIRED before this fallback existed.
//
// When claims are missing, the user's primary email is resolved from Clerk's
// Backend API with the instance secret key — strictly more authoritative
// than token claims, and still fail-closed: only a primary address whose
// verification status is "verified" is accepted. With customised claims the
// fallback never runs, so production behaviour is unchanged.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
  readonly resolution: VerifiedEmailResolution;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: the shape of the Clerk user lookup this module needs. */
export type ClerkUserFetcher = (clerkId: string) => Promise<{
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly {
    readonly id: string;
    readonly emailAddress: string;
    readonly verification: { readonly status: string } | null;
  }[];
} | null>;

async function defaultFetcher(clerkId: string): ReturnType<ClerkUserFetcher> {
  const secretKey = process.env["CLERK_SECRET_KEY"] ?? "";
  if (secretKey === "") return null;
  try {
    const { createClerkClient } = await import("@clerk/backend");
    const client = createClerkClient({ secretKey });
    return await client.users.getUser(clerkId);
  } catch {
    // Any Backend-API failure resolves as "no usable email" — fail closed.
    return null;
  }
}

/** For tests: clear the module cache between cases. */
export function clearClerkEmailCache(): void {
  cache.clear();
}

/**
 * Resolves a verified email for the token holder: claims first (production
 * path, no network), then the Backend API (default-claims path), cached per
 * clerkId so a burst of requests costs one lookup.
 */
export async function resolveVerifiedClerkEmailWithFallback(
  payload: Record<string, unknown>,
  clerkId: string,
  fetchClerkUser: ClerkUserFetcher = defaultFetcher,
): Promise<VerifiedEmailResolution> {
  const fromClaims = resolveVerifiedClerkEmail(payload);
  if (fromClaims.ok) return fromClaims;

  const cached = cache.get(clerkId);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.resolution;

  const user = await fetchClerkUser(clerkId);
  const primary = user?.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);

  const resolution: VerifiedEmailResolution =
    primary === undefined
      ? fromClaims // nothing better learned — keep the claims-path verdict
      : primary.verification?.status === "verified"
        ? { ok: true, email: primary.emailAddress.trim().toLowerCase() }
        : {
            ok: false,
            code: "EMAIL_UNVERIFIED",
            message: "Email address must be verified before access is granted",
          };

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(clerkId, { resolution, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolution;
}
