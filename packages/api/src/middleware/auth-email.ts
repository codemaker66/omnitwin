import { z } from "zod";

// ---------------------------------------------------------------------------
// Verified-email primitives (extracted from auth.ts in T-518 so that
// clerk-email.ts and auth.ts can both consume them without a circular
// import — this module is a leaf: it imports nothing from the middleware).
// auth.ts re-exports everything here, so existing importers are unaffected.
// ---------------------------------------------------------------------------

const AuthEmailSchema = z.string().trim().toLowerCase().email();

export type VerifiedEmailResolution =
  | { readonly ok: true; readonly email: string }
  | {
      readonly ok: false;
      readonly code: "EMAIL_REQUIRED" | "EMAIL_UNVERIFIED";
      readonly message: string;
    };

export function normalizeAuthEmail(raw: unknown): string | null {
  const result = AuthEmailSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isExplicitlyVerified(value: unknown): boolean {
  return value === true || value === "true" || value === "verified";
}

/**
 * Clerk JWT templates can name the verification claim differently depending
 * on configuration. Venviewer fails closed: a token needs an explicit verified
 * signal, not just an email string.
 */
export function resolveVerifiedClerkEmail(payload: Record<string, unknown>): VerifiedEmailResolution {
  const email = normalizeAuthEmail(payload["email"]);
  if (email === null) {
    return {
      ok: false,
      code: "EMAIL_REQUIRED",
      message: "A verified email address is required",
    };
  }

  const verified =
    isExplicitlyVerified(payload["email_verified"]) ||
    isExplicitlyVerified(payload["emailVerified"]) ||
    isExplicitlyVerified(payload["email_verification_status"]) ||
    isExplicitlyVerified(payload["emailVerificationStatus"]) ||
    isExplicitlyVerified(payload["primary_email_verified"]) ||
    isExplicitlyVerified(payload["primaryEmailVerified"]) ||
    isExplicitlyVerified(payload["primary_email_verification_status"]) ||
    isExplicitlyVerified(payload["primaryEmailVerificationStatus"]);

  if (!verified) {
    return {
      ok: false,
      code: "EMAIL_UNVERIFIED",
      message: "Email address must be verified before access is granted",
    };
  }

  return { ok: true, email };
}
