import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClerkEmailCache,
  resolveVerifiedClerkEmailWithFallback,
  type ClerkUserFetcher,
} from "../../middleware/clerk-email.js";

// ---------------------------------------------------------------------------
// Verified-email fallback (Slice 4, T-518): claims win when present; default
// tokens fall back to the Backend API, fail-closed on unverified/missing;
// lookups are cached per clerkId.
// ---------------------------------------------------------------------------

const CLERK_ID = "user_fixture_1";

function fetcherReturning(
  user: Awaited<ReturnType<ClerkUserFetcher>>,
): ReturnType<typeof vi.fn> & ClerkUserFetcher {
  return vi.fn().mockResolvedValue(user);
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
    const fetcher = fetcherReturning({
      primaryEmailAddressId: "em_1",
      emailAddresses: [
        { id: "em_2", emailAddress: "other@venue.test", verification: { status: "verified" } },
        { id: "em_1", emailAddress: "Primary@Venue.Test", verification: { status: "verified" } },
      ],
    });
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
    // Claims said "email present but not verified"; a failed Backend-API
    // lookup must not soften that into EMAIL_REQUIRED.
    const result = await resolveVerifiedClerkEmailWithFallback(
      { email: "person@venue.test" },
      CLERK_ID,
      fetcherReturning(null),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_UNVERIFIED");
  });

  it("caches per clerkId so a burst costs one lookup", async () => {
    const fetcher = fetcherReturning({
      primaryEmailAddressId: "em_1",
      emailAddresses: [
        { id: "em_1", emailAddress: "primary@venue.test", verification: { status: "verified" } },
      ],
    });
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    await resolveVerifiedClerkEmailWithFallback({}, CLERK_ID, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
