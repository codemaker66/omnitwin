import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClerkEmailCache,
  evictClerkEmailCacheEntry,
  resolveVerifiedClerkEmailWithFallback,
  type ClerkUserFetcher,
} from "../../middleware/clerk-email.js";

// ---------------------------------------------------------------------------
// Verified-email fallback (Slice 4, T-518): claims win when present; default
// tokens fall back to the Backend API, fail-closed on unverified/missing/
// banned/locked; confirmed verdicts are cached per clerkId (transient
// failures are NOT), concurrent misses share one lookup, and the Clerk
// webhook evicts entries.
// ---------------------------------------------------------------------------

const CLERK_ID = "user_fixture_1";

function fetcherReturning(
  user: Awaited<ReturnType<ClerkUserFetcher>>,
): ReturnType<typeof vi.fn> & ClerkUserFetcher {
  return vi.fn().mockResolvedValue(user);
}

type ClerkUserShape = Exclude<Awaited<ReturnType<ClerkUserFetcher>>, null | "unavailable">;

function verifiedUser(): ClerkUserShape {
  return {
    primaryEmailAddressId: "em_1",
    emailAddresses: [
      { id: "em_2", emailAddress: "other@venue.test", verification: { status: "verified" } },
      { id: "em_1", emailAddress: "Primary@Venue.Test", verification: { status: "verified" } },
    ],
  };
}

beforeEach(() => {
  clearClerkEmailCache();
});

describe("resolveVerifiedClerkEmailWithFallback", () => {
  it("uses verified claims without touching the Backend API", async () => {
    const fetcher = fetcherReturning(null);
    const result = await resolveVerifiedClerkEmailWithFallback(
      { email: "claims@venue.test", email_verified: true },
      CLERK_ID,
      fetcher,
    );
    expect(result).toEqual({ ok: true, email: "claims@venue.test" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back to the Backend API for default tokens and accepts a verified primary", async () => {
    const fetcher = fetcherReturning(verifiedUser());
    const result = await resolveVerifiedClerkEmailWithFallback({ sub: CLERK_ID }, CLERK_ID, fetcher);
    expect(result).toEqual({ ok: true, email: "primary@venue.test" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the primary address is unverified", async () => {
    const fetcher = fetcherReturning({
      primaryEmailAddressId: "em_1",
      emailAddresses: [
        { id: "em_1", emailAddress: "primary@venue.test", verification: { status: "unverified" } },
      ],
    });
    const result = await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_UNVERIFIED");
  });

  it("fails closed for banned or locked accounts even with a verified email", async () => {
    const banned: ClerkUserShape = { ...verifiedUser(), banned: true };
    const result = await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcherReturning(banned));
    expect(result.ok).toBe(false);

    clearClerkEmailCache();
    const locked: ClerkUserShape = { ...verifiedUser(), locked: true };
    const lockedResult = await resolveVerifiedClerkEmailWithFallback(
      {},
      CLERK_ID,
      fetcherReturning(locked),
    );
    expect(lockedResult.ok).toBe(false);
  });

  it("fails closed when the user or primary address is missing", async () => {
    const missingUser = await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcherReturning(null));
    expect(missingUser.ok).toBe(false);
    if (!missingUser.ok) expect(missingUser.code).toBe("EMAIL_REQUIRED");

    clearClerkEmailCache();
    const noPrimary = await resolveVerifiedClerkEmailWithFallback(
      {},
      CLERK_ID,
      fetcherReturning({ primaryEmailAddressId: null, emailAddresses: [] }),
    );
    expect(noPrimary.ok).toBe(false);
    if (!noPrimary.ok) expect(noPrimary.code).toBe("EMAIL_REQUIRED");
  });

  it("keeps the claims-path verdict when the fallback learns nothing better", async () => {
    // Claims said "email present but not verified"; a confirmed-missing
    // Backend-API user must not soften that into EMAIL_REQUIRED.
    const result = await resolveVerifiedClerkEmailWithFallback(
      { email: "person@venue.test" },
      CLERK_ID,
      fetcherReturning(null),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_UNVERIFIED");
  });

  it("caches confirmed verdicts per clerkId so a burst costs one lookup", async () => {
    const fetcher = fetcherReturning(verifiedUser());
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never caches a transient Backend-API failure (review P2)", async () => {
    // First call: Clerk unreachable → fail closed for that request only.
    const failing = fetcherReturning("unavailable");
    const first = await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, failing);
    expect(first.ok).toBe(false);
    // Clerk recovers: the very next call must retry, not serve the failure.
    const recovered = fetcherReturning(verifiedUser());
    const second = await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, recovered);
    expect(second).toEqual({ ok: true, email: "primary@venue.test" });
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("shares one lookup between concurrent misses (review P3)", async () => {
    let release: ((value: Awaited<ReturnType<ClerkUserFetcher>>) => void) | undefined;
    const gate = new Promise<Awaited<ReturnType<ClerkUserFetcher>>>((resolvePromise) => {
      release = resolvePromise;
    });
    const fetcher = vi.fn().mockReturnValue(gate) as ReturnType<typeof vi.fn> & ClerkUserFetcher;
    const a = resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    const b = resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    release?.(verifiedUser());
    expect(await a).toEqual({ ok: true, email: "primary@venue.test" });
    expect(await b).toEqual({ ok: true, email: "primary@venue.test" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("webhook eviction invalidates one identity immediately (review P2)", async () => {
    const fetcher = fetcherReturning(verifiedUser());
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    evictClerkEmailCacheEntry(CLERK_ID);
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
