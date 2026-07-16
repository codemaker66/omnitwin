import {
  normalizeAuthEmail,
  resolveVerifiedClerkEmail,
  type VerifiedEmailResolution,
} from "./auth-email.js";

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
// verification status is "verified" on a non-banned, non-locked account is
// accepted. With customised claims the fallback never runs, so production
// behaviour is unchanged.
//
// Post-security-review hardening: per-clerkId eviction wired to the Clerk
// webhook (user.updated/deleted), in-flight de-duplication, transient
// Backend-API failures are logged and NOT cached (only confirmed verdicts
// are), oldest-entry eviction, banned/locked rejection.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
/** Negative verdicts recover fast — a user who just verified their email
 *  should not stay locked out for the full positive TTL (review P2). */
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
  readonly resolution: VerifiedEmailResolution;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<VerifiedEmailResolution>>();

/** Test seam: the shape of the Clerk user lookup this module needs.
 *  Returns the user, null when Clerk CONFIRMS no such user, or
 *  "unavailable" for transport/API failures (never cached). */
export type ClerkUserFetcher = (clerkId: string) => Promise<
  | {
      readonly primaryEmailAddressId: string | null;
      readonly emailAddresses: readonly {
        readonly id: string;
        readonly emailAddress: string;
        readonly verification: { readonly status: string } | null;
      }[];
      readonly banned?: boolean;
      readonly locked?: boolean;
    }
  | null
  | "unavailable"
>;

async function defaultFetcher(clerkId: string): ReturnType<ClerkUserFetcher> {
  const secretKey = process.env["CLERK_SECRET_KEY"] ?? "";
  if (secretKey === "") return "unavailable";
  try {
    const { createClerkClient } = await import("@clerk/backend");
    const client = createClerkClient({ secretKey });
    return await client.users.getUser(clerkId);
  } catch (error) {
    const status = (error as { status?: number }).status;
    // 404 is Clerk CONFIRMING the user does not exist — a cacheable verdict.
    if (status === 404) return null;
    // Anything else is transport/config trouble — fail closed for THIS
    // request but never cache it, and leave a trace (no request logger
    // exists at module scope; this path is dormant in production).
    // eslint-disable-next-line no-console -- observability for a claims-fallback failure outside request scope
    console.error(
      "[clerk-email] Backend-API fallback unavailable:",
      error instanceof Error ? error.message : String(error),
    );
    return "unavailable";
  }
}

/** Evict one identity — wired to the Clerk webhook so email/verification
 *  changes take effect immediately instead of after the TTL. */
export function evictClerkEmailCacheEntry(clerkId: string): void {
  cache.delete(clerkId);
}

/** For tests: clear the module cache between cases. */
export function clearClerkEmailCache(): void {
  cache.clear();
  inFlight.clear();
}

function resolutionFromUser(
  user: Awaited<ReturnType<ClerkUserFetcher>>,
  fromClaims: VerifiedEmailResolution,
): { resolution: VerifiedEmailResolution; cacheable: boolean } {
  if (user === "unavailable") return { resolution: fromClaims, cacheable: false };
  if (user === null) return { resolution: fromClaims, cacheable: true };
  if (user.banned === true || user.locked === true) {
    // The Backend API is the source of truth — a banned/locked account
    // never gains access through the fallback.
    return {
      resolution: {
        ok: false,
        code: "EMAIL_UNVERIFIED",
        message: "Email address must be verified before access is granted",
      },
      cacheable: true,
    };
  }
  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
  if (primary === undefined) return { resolution: fromClaims, cacheable: true };
  if (primary.verification?.status !== "verified") {
    return {
      resolution: {
        ok: false,
        code: "EMAIL_UNVERIFIED",
        message: "Email address must be verified before access is granted",
      },
      cacheable: true,
    };
  }
  const email = normalizeAuthEmail(primary.emailAddress);
  if (email === null) return { resolution: fromClaims, cacheable: true };
  return { resolution: { ok: true, email }, cacheable: true };
}

/**
 * Resolves a verified email for the token holder: claims first (production
 * path, no network), then the Backend API (default-claims path). Confirmed
 * verdicts are cached per clerkId; concurrent misses share one lookup.
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

  const pending = inFlight.get(clerkId);
  if (pending !== undefined) return pending;

  const lookup = (async (): Promise<VerifiedEmailResolution> => {
    const { resolution, cacheable } = resolutionFromUser(await fetchClerkUser(clerkId), fromClaims);
    if (cacheable) {
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      const ttl = resolution.ok ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      cache.set(clerkId, { resolution, expiresAt: Date.now() + ttl });
    }
    return resolution;
  })().finally(() => {
    inFlight.delete(clerkId);
  });
  inFlight.set(clerkId, lookup);
  return lookup;
}
