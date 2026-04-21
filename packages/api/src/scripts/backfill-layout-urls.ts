import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { buildLayoutPathKey, slugifyLayoutName } from "@omnitwin/types";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";
import { configurations, layoutAliases, users } from "../db/schema.js";
import { generateUniqueShortCode } from "../services/shortcode.js";

// ---------------------------------------------------------------------------
// backfill-layout-urls
//
// One-shot, idempotent backfill that gives every existing configuration
// a canonical URL identifier + layout_aliases row:
//
//   - User-owned configs      → slug derived from config.name, unique
//                               per user (collisions append -2, -3, …).
//                               Writes user_slug canonical alias + uuid
//                               legacy alias (retired).
//   - Guest configs           → 6-char shortcode from the nanoid alphabet.
//                               Writes shortcode canonical alias + uuid
//                               legacy alias (retired).
//
// Skips rows that already have slug/shortCode set (re-run safe). Alias
// inserts use existence probes for idempotency.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/backfill-layout-urls.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

async function aliasExists(pathKey: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: layoutAliases.id })
    .from(layoutAliases)
    .where(eq(layoutAliases.pathKey, pathKey))
    .limit(1);
  return hit !== undefined;
}

async function slugTaken(userId: string, candidate: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: configurations.id })
    .from(configurations)
    .where(and(
      eq(configurations.userId, userId),
      eq(configurations.slug, candidate),
      isNull(configurations.deletedAt),
    ))
    .limit(1);
  return hit !== undefined;
}

async function findUniqueSlug(userId: string, base: string): Promise<string> {
  if (!(await slugTaken(userId, base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${String(i)}`;
    if (candidate.length > 60) {
      // Shouldn't happen for sane names; bail with a randomised suffix.
      return `${base.slice(0, 52)}-${Date.now().toString(36).slice(-6)}`;
    }
    if (!(await slugTaken(userId, candidate))) return candidate;
  }
  throw new Error(`findUniqueSlug exhausted for user=${userId} base=${base}`);
}

async function shortCodeExists(candidate: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: configurations.id })
    .from(configurations)
    .where(and(
      eq(configurations.shortCode, candidate),
      isNull(configurations.deletedAt),
    ))
    .limit(1);
  return hit !== undefined;
}

async function insertAliasIfMissing(
  configurationId: string,
  kind: "uuid" | "shortcode" | "user_slug",
  pathKey: string,
  retired: boolean,
): Promise<void> {
  if (await aliasExists(pathKey)) return;
  await db.insert(layoutAliases).values({
    configurationId,
    kind,
    pathKey,
    retiredAt: retired ? new Date() : null,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rows = await db
  .select({
    id: configurations.id,
    userId: configurations.userId,
    name: configurations.name,
    slug: configurations.slug,
    shortCode: configurations.shortCode,
  })
  .from(configurations)
  .where(isNull(configurations.deletedAt));

// eslint-disable-next-line no-console
console.log(`Backfilling URL identifiers for ${String(rows.length)} live configurations...`);

let userSlugs = 0;
let guestShortcodes = 0;
let skipped = 0;

for (const row of rows) {
  const uuidKey = buildLayoutPathKey("uuid", { uuid: row.id });

  if (row.userId !== null) {
    // User-owned — derive slug from name.
    const [userRow] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    const hasUsername = userRow?.username !== null && userRow?.username !== undefined;

    if (row.slug === null) {
      const base = slugifyLayoutName(row.name);
      const slug = await findUniqueSlug(row.userId, base);
      await db.update(configurations).set({ slug }).where(eq(configurations.id, row.id));
      row.slug = slug;
      userSlugs += 1;
    }

    // Write aliases only if the user has a username — otherwise defer
    // until UsernameGate prompts them and the webhook mirrors back.
    if (hasUsername) {
      const slugKey = buildLayoutPathKey("user_slug", {
        username: userRow.username as string,
        slug: row.slug,
      });
      await insertAliasIfMissing(row.id, "user_slug", slugKey, false);
      await insertAliasIfMissing(row.id, "uuid", uuidKey, true);
    }
  } else {
    // Guest config — assign a shortcode.
    if (row.shortCode === null) {
      const code = await generateUniqueShortCode(shortCodeExists);
      await db.update(configurations).set({ shortCode: code }).where(eq(configurations.id, row.id));
      row.shortCode = code;
      guestShortcodes += 1;
    }

    const scKey = buildLayoutPathKey("shortcode", { shortCode: row.shortCode });
    await insertAliasIfMissing(row.id, "shortcode", scKey, false);
    await insertAliasIfMissing(row.id, "uuid", uuidKey, true);
  }

  if (row.slug === null && row.shortCode === null) skipped += 1;
}

// eslint-disable-next-line no-console
console.log(
  `Backfill complete. user_slugs_assigned=${String(userSlugs)} guest_shortcodes_assigned=${String(guestShortcodes)} skipped=${String(skipped)}`,
);
process.exit(0);
