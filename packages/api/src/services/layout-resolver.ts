import { and, eq, isNull, sql } from "drizzle-orm";
import {
  buildLayoutPathKey,
  type LayoutAliasKind,
  type LayoutResolveResponse,
} from "@omnitwin/types";
import { configurations, layoutAliases, users } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Layout URL resolver
//
// Translates an incoming URL into one of three outcomes:
//
//   - canonical — the URL is the current canonical address; load configId
//   - redirect  — the URL is valid but points to a retired alias; the
//                 client should 301 to `toPath` (which IS canonical)
//   - not_found — no config exists at this URL
//
// Input URLs must be one of the three recognised forms:
//
//   - /plan/<uuid>           (legacy config-id path, pre-backfill)
//   - /plan/<short_code>     (guest config, globally unique 6-char code)
//   - /<username>/<slug>     (signed-in user's named layout)
//
// The resolver uses a two-tier lookup:
//
//   1. layout_aliases (post-Phase-5-backfill source of truth) — O(1)
//      lookup by `path_key`. If the alias has `retired_at IS NULL`, it's
//      the current canonical; otherwise we follow to the config's current
//      canonical alias and return a redirect.
//
//   2. Direct table lookup fallback — critical during the Phase 5 backfill
//      window when aliases haven't been populated yet. For UUIDs we look
//      up `configurations.id` directly; for user_slug we join users +
//      configurations; for shortcodes we look up `configurations.short_code`
//      directly.
//
// Both tiers are always consulted (aliases first), so a row that exists
// only via the direct column (no alias yet) resolves correctly. Writers
// will populate aliases lazily at create/rename time (Phase 4).
//
// Pure functions — `parseLayoutUrlPath` and `buildCanonicalPath` — live
// alongside the async resolver so test suites can exercise the URL
// grammar without a database.
// ---------------------------------------------------------------------------

export type ResolveInput =
  | { kind: "uuid"; uuid: string }
  | { kind: "shortcode"; shortCode: string }
  | { kind: "user_slug"; username: string; slug: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORTCODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
const USERNAME_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/;

// Must stay in sync with RESERVED_USERNAMES from @omnitwin/types.
// The types test verifies equality at build time.
const RESERVED_FIRST_SEGMENTS = new Set<string>([
  "admin", "api", "app", "assets", "auth", "blueprint", "dashboard",
  "editor", "enquiries", "hallkeeper", "help", "landing", "legal",
  "login", "logout", "me", "plan", "privacy", "public", "register",
  "settings", "signup", "static", "support", "terms", "trades-hall",
  "v", "venviewer", "www",
]);

/**
 * Parse an incoming URL path into the resolver's canonical input shape.
 * Returns `null` if the path doesn't match any supported URL family or
 * if the first segment is a reserved route (so `/dashboard/foo` is
 * never mistaken for a user_slug).
 */
export function parseLayoutUrlPath(path: string): ResolveInput | null {
  const withoutQuery = path.split("?")[0] ?? "";
  const withoutHash = withoutQuery.split("#")[0] ?? "";
  const clean = withoutHash.replace(/^\/+/, "").replace(/\/+$/, "");
  if (clean.length === 0) return null;
  const segments = clean.split("/");

  // /plan/<code-or-uuid> — two segments, first literal "plan"
  if (segments.length === 2 && segments[0] === "plan") {
    const id = segments[1] ?? "";
    if (UUID_RE.test(id)) return { kind: "uuid", uuid: id.toLowerCase() };
    if (SHORTCODE_RE.test(id)) return { kind: "shortcode", shortCode: id };
    return null;
  }

  // /<username>/<slug> — two segments, first must not be reserved
  if (segments.length === 2) {
    const [username, slug] = segments;
    if (username === undefined || slug === undefined) return null;
    if (RESERVED_FIRST_SEGMENTS.has(username)) return null;
    if (!USERNAME_RE.test(username)) return null;
    if (!SLUG_RE.test(slug)) return null;
    return { kind: "user_slug", username, slug };
  }

  return null;
}

/**
 * Build a canonical URL path. Inverse of `parseLayoutUrlPath` — used
 * by the resolver when producing `toPath` on redirects.
 */
export function buildCanonicalPath(
  kind: "shortcode" | "user_slug",
  parts: { shortCode?: string; username?: string; slug?: string },
): string {
  if (kind === "shortcode") {
    if (parts.shortCode === undefined) throw new Error("shortCode required");
    return `/plan/${parts.shortCode}`;
  }
  if (parts.username === undefined || parts.slug === undefined) {
    throw new Error("username and slug required for user_slug");
  }
  return `/${parts.username}/${parts.slug}`;
}

/**
 * Resolve a parsed URL input against the database.
 */
export async function resolveLayoutUrl(
  db: Database,
  input: ResolveInput,
): Promise<LayoutResolveResponse> {
  const incomingPathKey = resolveInputToPathKey(input);

  // Tier 1 — alias lookup (fast path once backfill is complete).
  const [alias] = await db
    .select({
      configurationId: layoutAliases.configurationId,
      retiredAt: layoutAliases.retiredAt,
    })
    .from(layoutAliases)
    .where(eq(layoutAliases.pathKey, incomingPathKey))
    .limit(1);

  if (alias !== undefined) {
    if (alias.retiredAt === null) {
      return { status: "canonical", configId: alias.configurationId };
    }
    const canonical = await findCanonicalPath(db, alias.configurationId);
    if (canonical === null) {
      return { status: "not_found" };
    }
    return {
      status: "redirect",
      configId: alias.configurationId,
      toPath: canonical.toPath,
    };
  }

  // Tier 2 — direct column fallback (pre-backfill safety net).
  return await directLookup(db, input);
}

function resolveInputToPathKey(input: ResolveInput): string {
  switch (input.kind) {
    case "uuid":
      return buildLayoutPathKey("uuid", { uuid: input.uuid });
    case "shortcode":
      return buildLayoutPathKey("shortcode", { shortCode: input.shortCode });
    case "user_slug":
      return buildLayoutPathKey("user_slug", {
        username: input.username,
        slug: input.slug,
      });
  }
}

/**
 * Find the current canonical URL for a config by scanning its
 * non-retired alias rows. Prefers `user_slug` over `shortcode` when a
 * config has both (ownership claimed by a user — prefer the named URL).
 */
async function findCanonicalPath(
  db: Database,
  configurationId: string,
): Promise<{ toPath: string; kind: LayoutAliasKind } | null> {
  const rows = await db
    .select({ kind: layoutAliases.kind, pathKey: layoutAliases.pathKey })
    .from(layoutAliases)
    .where(and(
      eq(layoutAliases.configurationId, configurationId),
      isNull(layoutAliases.retiredAt),
    ));

  const preferenceOrder: LayoutAliasKind[] = ["user_slug", "shortcode", "uuid"];
  for (const preferredKind of preferenceOrder) {
    const match = rows.find((r) => r.kind === preferredKind);
    if (match === undefined) continue;
    const parts = parsePathKey(match.pathKey);
    if (parts === null) continue;
    const path = pathFromParts(parts);
    if (path === null) continue;
    return { toPath: path, kind: match.kind as LayoutAliasKind };
  }
  return null;
}

function parsePathKey(
  key: string,
): { kind: "uuid"; uuid: string } | { kind: "sc"; code: string } | { kind: "u"; username: string; slug: string } | null {
  if (key.startsWith("uuid:")) return { kind: "uuid", uuid: key.slice(5) };
  if (key.startsWith("sc:")) return { kind: "sc", code: key.slice(3) };
  if (key.startsWith("u:")) {
    const rest = key.slice(2);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    return { kind: "u", username: rest.slice(0, slash), slug: rest.slice(slash + 1) };
  }
  return null;
}

function pathFromParts(
  parts: { kind: "uuid"; uuid: string } | { kind: "sc"; code: string } | { kind: "u"; username: string; slug: string },
): string | null {
  switch (parts.kind) {
    case "uuid":
      return `/plan/${parts.uuid}`;
    case "sc":
      return `/plan/${parts.code}`;
    case "u":
      return `/${parts.username}/${parts.slug}`;
  }
}

/**
 * Direct table lookup — used when the alias table doesn't yet have a
 * row for this URL (pre-backfill). Returns canonical or not_found; it
 * never returns redirect (a direct lookup IS by definition the canonical
 * address for that identifier at this moment) — except for UUID inputs,
 * which ARE redirected to a slug/shortcode when one exists, because the
 * UUID form is always the "old" address.
 */
async function directLookup(db: Database, input: ResolveInput): Promise<LayoutResolveResponse> {
  switch (input.kind) {
    case "uuid": {
      const [row] = await db
        .select({
          id: configurations.id,
          userId: configurations.userId,
          slug: configurations.slug,
          shortCode: configurations.shortCode,
        })
        .from(configurations)
        .where(and(eq(configurations.id, input.uuid), isNull(configurations.deletedAt)))
        .limit(1);
      if (row === undefined) return { status: "not_found" };

      if (row.userId !== null && row.slug !== null) {
        const [userRow] = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, row.userId))
          .limit(1);
        if (userRow?.username !== null && userRow?.username !== undefined) {
          return {
            status: "redirect",
            configId: row.id,
            toPath: `/${userRow.username}/${row.slug}`,
          };
        }
      }
      if (row.shortCode !== null) {
        return {
          status: "redirect",
          configId: row.id,
          toPath: `/plan/${row.shortCode}`,
        };
      }
      // Pre-backfill: only a UUID exists. Treat as canonical.
      return { status: "canonical", configId: row.id };
    }

    case "shortcode": {
      const [row] = await db
        .select({ id: configurations.id, userId: configurations.userId, slug: configurations.slug })
        .from(configurations)
        .where(and(
          eq(configurations.shortCode, input.shortCode),
          isNull(configurations.deletedAt),
        ))
        .limit(1);
      if (row === undefined) return { status: "not_found" };

      if (row.userId !== null && row.slug !== null) {
        const [userRow] = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, row.userId))
          .limit(1);
        if (userRow?.username !== null && userRow?.username !== undefined) {
          return {
            status: "redirect",
            configId: row.id,
            toPath: `/${userRow.username}/${row.slug}`,
          };
        }
      }
      return { status: "canonical", configId: row.id };
    }

    case "user_slug": {
      const [row] = await db
        .select({
          id: configurations.id,
        })
        .from(configurations)
        .innerJoin(users, eq(users.id, configurations.userId))
        .where(and(
          sql`lower(${users.username}) = lower(${input.username})`,
          sql`lower(${configurations.slug}) = lower(${input.slug})`,
          isNull(configurations.deletedAt),
        ))
        .limit(1);
      if (row === undefined) return { status: "not_found" };
      return { status: "canonical", configId: row.id };
    }
  }
}
