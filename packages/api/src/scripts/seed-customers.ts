import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { UsernameSchema } from "@omnitwin/types";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";
import { users, venues } from "../db/schema.js";

// ---------------------------------------------------------------------------
// seed-customers
//
// Pre-provisions user rows from a JSON file so real people (venue staff,
// hallkeepers, admins) land in the app already set up when they first sign
// up via Clerk. Without this, every new signup would need manual role + venue
// assignment before they could use anything.
//
// How it ties together:
//
//   1. Operator edits customers.json (gitignored; copy from customers.example.json)
//   2. This script inserts/updates `users` rows by email, setting name, role,
//      username, venueId — leaves `clerk_id` NULL.
//   3. When the real person signs up via Clerk later, the clerk-webhook
//      handler at /webhooks/clerk fires `user.created`, looks up the row
//      by email, and attaches the Clerk ID. The pre-set role/venue stay
//      intact.
//
// Idempotent: safe to re-run. Existing rows are updated, not duplicated.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/seed-customers.ts`
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = ["client", "planner", "staff", "hallkeeper", "admin"] as const;

const CustomerSchema = z.object({
  email: z.string().email("email must be a valid address"),
  name: z.string().min(1).max(200),
  role: z.enum(ALLOWED_ROLES),
  username: UsernameSchema.optional(),
  venueSlug: z.string().min(1).max(100),
  phone: z.string().min(1).max(50).optional(),
});

const CustomersFileSchema = z.object({
  _comment: z.string().optional(),
  customers: z.array(CustomerSchema).min(0).max(200),
});

export type Customer = z.infer<typeof CustomerSchema>;

// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveInputFile(): string {
  const real = resolve(__dirname, "customers.json");
  const example = resolve(__dirname, "customers.example.json");
  if (existsSync(real)) {
    return real;
  }
  return example;
}

function loadCustomers(path: string): Customer[] {
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${String(err)}`);
  }
  const result = CustomersFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Validation failed for ${path}:\n  ${issues}`);
  }
  return result.data.customers;
}

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const file = resolveInputFile();
// eslint-disable-next-line no-console
console.log(`Loading customers from ${file}`);

const list = loadCustomers(file);
// eslint-disable-next-line no-console
console.log(`Found ${String(list.length)} customer(s) to seed`);

let inserted = 0;
let updated = 0;
let skippedMissingVenue = 0;

for (const c of list) {
  // Resolve venue by slug
  const [venue] = await db
    .select({ id: venues.id, slug: venues.slug })
    .from(venues)
    .where(and(eq(venues.slug, c.venueSlug), isNull(venues.deletedAt)))
    .limit(1);

  if (venue === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`  SKIP ${c.email} — venue "${c.venueSlug}" not found`);
    skippedMissingVenue += 1;
    continue;
  }

  // Upsert by email
  const [existing] = await db
    .select({ id: users.id, clerkId: users.clerkId })
    .from(users)
    .where(eq(users.email, c.email))
    .limit(1);

  if (existing === undefined) {
    await db.insert(users).values({
      email: c.email,
      name: c.name,
      displayName: c.name,
      role: c.role,
      venueId: venue.id,
      username: c.username ?? null,
      phone: c.phone ?? null,
      clerkId: null,
    });
    // eslint-disable-next-line no-console
    console.log(`  INSERT ${c.email} as ${c.role} @ ${venue.slug}`);
    inserted += 1;
  } else {
    await db.update(users).set({
      name: c.name,
      displayName: c.name,
      role: c.role,
      venueId: venue.id,
      username: c.username ?? null,
      phone: c.phone ?? null,
      updatedAt: new Date(),
    }).where(eq(users.id, existing.id));
    // eslint-disable-next-line no-console
    console.log(`  UPDATE ${c.email} (clerk ${existing.clerkId ?? "not-yet-linked"})`);
    updated += 1;
  }
}

// eslint-disable-next-line no-console
console.log(
  `Seed complete. inserted=${String(inserted)} updated=${String(updated)} skipped_missing_venue=${String(skippedMissingVenue)}`,
);
process.exit(0);
