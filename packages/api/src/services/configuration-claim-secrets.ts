import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Claim secrets — proof that a browser created a public plan (migration 0102,
// release audit public-surface-1).
//
// A plan's id is shared freely (/plan/<id>, "Copy layout link"), so it cannot
// be what lets an account take the plan. POST /public/configurations returns
// one of these to the creating browser, once; the database keeps only its
// SHA-256 (configuration_claim_secrets). POST /configurations/:id/claim
// accepts the plan only with the secret, and consumes it.
//
// The same secret is what the anonymous plan routes ask for before they return
// a guest plan's notes (routes/public-configs.ts). There it travels in a
// request header, named here once so the route that reads it and the scrubbers
// that keep it out of error reports (observability/redact.ts) cannot disagree.
// ---------------------------------------------------------------------------

/** The request header a browser presents its plan's claim secret in, as Node
 *  names it (lower case). The web app sends `X-Plan-Claim-Secret`. */
export const PLAN_CLAIM_SECRET_HEADER = "x-plan-claim-secret";

/** 32 random bytes, base64url: 43 characters. */
export function generateClaimSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClaimSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Whether a presented secret is the one whose hash was stored. */
export function claimSecretMatches(storedHash: string, presented: string): boolean {
  const stored = Buffer.from(storedHash, "hex");
  const offered = Buffer.from(hashClaimSecret(presented), "hex");
  return stored.length === offered.length && timingSafeEqual(stored, offered);
}
