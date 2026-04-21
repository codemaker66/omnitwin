import { z } from "zod";

// ---------------------------------------------------------------------------
// URL identifier schemas — source of truth for the three URL families that
// identify a configuration:
//
//   - Username:   `/<username>/...`          → UsernameSchema
//   - Layout:     `/<username>/<slug>`       → LayoutSlugSchema
//   - Shortcode:  `/plan/<shortcode>`        → ShortCodeSchema
//
// Shape rules must stay in lock-step with the DB-level CHECK constraints
// in migration 0017_layout_urls.sql. If you change a regex here, mirror
// the SQL `CHECK ("col" ~ '...')` too — a mismatch means rows can be
// rejected at the API boundary yet slip past the DB (or vice-versa).
// ---------------------------------------------------------------------------

// Lowercase alphanumeric with optional single hyphens. First and last
// character must be alphanumeric (no leading or trailing hyphens, no
// consecutive hyphens). Length 3-30 for usernames, 3-60 for layout slugs.
const USERNAME_REGEX = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/;
const LAYOUT_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/;

// nanoid-style alphabet — removes 0/1/i/l/o to avoid visual confusion
// in URLs printed on paper (wedding flyers, seating cards, etc.).
const SHORTCODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SHORTCODE_REGEX = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;

/**
 * Public alphabet used when generating a new shortcode via nanoid. Keep
 * as a const export so server + tests reference the same string.
 */
export const SHORTCODE_ALPHABET_CHARS: string = SHORTCODE_ALPHABET;
export const SHORTCODE_LENGTH = 6 as const;

/**
 * First-segment path names that can never be a username. Any signup
 * request for one of these is rejected server-side; the React Router
 * layer also treats them as reserved so `/<reserved>` never matches
 * the `/:username/:slug` pattern.
 *
 * Additions are additive only — removing a reserved word after launch
 * would let a later user claim it and break the prior owner's URLs.
 */
export const RESERVED_USERNAMES: readonly string[] = Object.freeze([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "blueprint",
  "dashboard",
  "editor",
  "enquiries",
  "hallkeeper",
  "help",
  "landing",
  "legal",
  "login",
  "logout",
  "me",
  "plan",
  "privacy",
  "public",
  "register",
  "settings",
  "signup",
  "static",
  "support",
  "terms",
  "trades-hall",
  "v",
  "venviewer",
  "www",
]);

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_USERNAMES);

export const UsernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(
    USERNAME_REGEX,
    "Username must be lowercase alphanumeric with optional hyphens, not starting or ending with a hyphen",
  );

/**
 * Stricter form used at signup: rejects the reserved-list words on top
 * of the shape check. Lookup / read paths use {@link UsernameSchema} so
 * a legacy user who somehow holds a reserved name can still be resolved.
 */
export const NewUsernameSchema = UsernameSchema.refine(
  (value) => !RESERVED_SET.has(value),
  { message: "Username is reserved. Please choose a different handle." },
);

export const LayoutSlugSchema = z
  .string()
  .min(3, "Layout slug must be at least 3 characters")
  .max(60, "Layout slug must be at most 60 characters")
  .regex(
    LAYOUT_SLUG_REGEX,
    "Layout slug must be lowercase alphanumeric with optional hyphens, not starting or ending with a hyphen",
  );

export const ShortCodeSchema = z
  .string()
  .length(6, "Shortcode must be exactly 6 characters")
  .regex(
    SHORTCODE_REGEX,
    "Shortcode must use only the nanoid alphabet (no 0/1/i/l/o)",
  );

/** Normalised composite key used as `layout_aliases.path_key`. */
export type LayoutAliasKind = "uuid" | "shortcode" | "user_slug";

/**
 * Build the `layout_aliases.path_key` string for a URL. Pure function so
 * resolver, writer, and tests agree on the canonical form.
 */
export function buildLayoutPathKey(
  kind: LayoutAliasKind,
  identifier: { uuid?: string; shortCode?: string; username?: string; slug?: string },
): string {
  switch (kind) {
    case "uuid": {
      if (identifier.uuid === undefined) throw new Error("uuid required for kind='uuid'");
      return `uuid:${identifier.uuid}`;
    }
    case "shortcode": {
      if (identifier.shortCode === undefined) throw new Error("shortCode required for kind='shortcode'");
      return `sc:${identifier.shortCode}`;
    }
    case "user_slug": {
      if (identifier.username === undefined || identifier.slug === undefined) {
        throw new Error("username and slug required for kind='user_slug'");
      }
      return `u:${identifier.username}/${identifier.slug}`;
    }
  }
}

/**
 * Derive a URL-safe layout slug from a free-text configuration name.
 * Returns a candidate that satisfies {@link LayoutSlugSchema}; if the
 * input is empty or produces a too-short result, falls back to
 * `"untitled"`. Collision resolution (appending `-2`, `-3`, …) is the
 * caller's responsibility — this function is deterministic.
 */
export function slugifyLayoutName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (cleaned.length < 3) return "untitled";
  return cleaned;
}

export type Username = z.infer<typeof UsernameSchema>;
export type LayoutSlug = z.infer<typeof LayoutSlugSchema>;
export type ShortCode = z.infer<typeof ShortCodeSchema>;

// ---------------------------------------------------------------------------
// Resolver input + response — the request/response contract between the
// `/api/layouts/resolve` endpoint and every client that needs to convert
// an incoming URL into a config lookup. Kept in @omnitwin/types so the
// React Router loader (Phase 3) and the Fastify route (Phase 2) share
// one source of truth.
// ---------------------------------------------------------------------------

/** Result when the incoming URL is already the canonical form. */
const CanonicalResolveSchema = z.object({
  status: z.literal("canonical"),
  configId: z.string().uuid(),
});

/**
 * Result when the URL is valid but the canonical has moved. `toPath` is
 * the full path starting with `/` that the client should redirect to.
 */
const RedirectResolveSchema = z.object({
  status: z.literal("redirect"),
  configId: z.string().uuid(),
  toPath: z.string().min(1),
});

/** Result when no config exists at this URL (or the URL is malformed). */
const NotFoundResolveSchema = z.object({
  status: z.literal("not_found"),
});

export const LayoutResolveResponseSchema = z.discriminatedUnion("status", [
  CanonicalResolveSchema,
  RedirectResolveSchema,
  NotFoundResolveSchema,
]);

export type LayoutResolveResponse = z.infer<typeof LayoutResolveResponseSchema>;

/**
 * Query-string shape for the resolver endpoint:
 *   GET /api/layouts/resolve?path=<url-encoded-path>
 */
export const LayoutResolveQuerySchema = z.object({
  path: z.string().min(1).max(400),
});

export type LayoutResolveQuery = z.infer<typeof LayoutResolveQuerySchema>;
