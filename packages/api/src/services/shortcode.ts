import { randomInt } from "node:crypto";
import {
  SHORTCODE_ALPHABET_CHARS,
  SHORTCODE_LENGTH,
  ShortCodeSchema,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Shortcode generator
//
// Produces 6-character codes from the nanoid alphabet (see
// @omnitwin/types/url-identifiers.ts). Used by `public-configs.ts` at
// create-time to give every guest layout a globally-unique URL.
//
// `randomInt` from node:crypto is cryptographically secure (rejection-
// sampled uniform distribution).
//
// Collision handling is the caller's responsibility: this function
// generates candidates, the caller inserts into the DB, the unique
// index on `short_code` rejects collisions, and the caller retries.
// With 31^6 ≈ 887M possible codes and < 32K configs projected in the
// first year, collision retry depth is effectively zero.
// ---------------------------------------------------------------------------

/**
 * Generate a fresh 6-char shortcode. Output is guaranteed to pass
 * {@link ShortCodeSchema}; we assert this at return time so a change
 * to the alphabet / length that drifts from the schema fails loudly in
 * tests rather than producing DB-CHECK violations at runtime.
 */
export function generateShortCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < SHORTCODE_LENGTH; i++) {
    const idx = randomInt(0, SHORTCODE_ALPHABET_CHARS.length);
    chars.push(SHORTCODE_ALPHABET_CHARS[idx] as string);
  }
  const code = chars.join("");
  // Defensive — should never fire; if it does, the alphabet or length
  // drifted from the schema and we'd rather crash here than hit the
  // DB CHECK.
  const parsed = ShortCodeSchema.safeParse(code);
  if (!parsed.success) {
    throw new Error(
      `generateShortCode produced invalid code "${code}" — alphabet/length out of sync with ShortCodeSchema`,
    );
  }
  return code;
}

/**
 * Generate a shortcode candidate and test it against an existence
 * predicate. Retries up to `maxAttempts` times on collision. Throws
 * on exhaustion — callers should log the event as a monitoring signal
 * that the alphabet is saturating.
 */
export async function generateUniqueShortCode(
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateShortCode();
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(
    `generateUniqueShortCode exhausted ${String(maxAttempts)} attempts — alphabet collision space exhausted?`,
  );
}
