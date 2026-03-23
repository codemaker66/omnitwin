import "dotenv/config";
import { hash } from "argon2";
import { validateEnv } from "../env.js";
import { createDb } from "./client.js";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Seed — populates database with Trades Hall data
// Run: pnpm --filter @omnitwin/api db:seed
// ---------------------------------------------------------------------------

/** Rectangular floor plan from width/length, centered at origin. */
function rectOutline(w: number, l: number): readonly { x: number; y: number }[] {
  const hw = w / 2;
  const hl = l / 2;
  return [
    { x: -hw, y: -hl },
    { x: hw, y: -hl },
    { x: hw, y: hl },
    { x: -hw, y: hl },
  ];
}

async function seed(): Promise<void> {
  const env = validateEnv();
  const db = createDb(env.DATABASE_URL);

  console.log("Seeding database...");

  // --- 1. Venue ---
  const [venue] = await db.insert(venues).values({
    name: "Trades Hall Glasgow",
    slug: "trades-hall-glasgow",
    address: "85 Glassford Street, Glasgow G1 1UH",
    brandColour: "#1a1a2e",
  }).returning();

  if (venue === undefined) throw new Error("Failed to create venue");
  console.log(`  Venue: ${venue.name} (${venue.id})`);

  // --- 2. Spaces (real dimensions from official Trades Hall website) ---
  const spaceData = [
    { name: "Grand Hall", slug: "grand-hall", width: 21, length: 10, height: 7, sort: 0 },
    { name: "Saloon", slug: "saloon", width: 12, length: 7, height: 5.4, sort: 1 },
    { name: "Reception Room", slug: "reception-room", width: 13.4, length: 11.2, height: 3.2, sort: 2 },
    { name: "Robert Adam Room", slug: "robert-adam-room", width: 9.7, length: 5.6, height: 2.18, sort: 3 },
  ] as const;

  const insertedSpaces = await db.insert(spaces).values(
    spaceData.map((s) => ({
      venueId: venue.id,
      name: s.name,
      slug: s.slug,
      widthM: String(s.width),
      lengthM: String(s.length),
      heightM: String(s.height),
      floorPlanOutline: rectOutline(s.width, s.length),
      sortOrder: s.sort,
    })),
  ).returning();

  for (const s of insertedSpaces) {
    console.log(`  Space: ${s.name} (${s.id})`);
  }

  // --- 3. Asset definitions (placeholder furniture catalogue) ---
  const assets = [
    { name: "Round Table 5ft", category: "table", width: 1.524, depth: 1.524, height: 0.762, seats: 8, collision: "cylinder" },
    { name: "Round Table 6ft", category: "table", width: 1.829, depth: 1.829, height: 0.762, seats: 10, collision: "cylinder" },
    { name: "Rectangular Table 6ft", category: "table", width: 1.829, depth: 0.762, height: 0.762, seats: null, collision: "box" },
    { name: "Standard Chair", category: "chair", width: 0.45, depth: 0.45, height: 0.9, seats: 1, collision: "box" },
    { name: "Highboy Cocktail Table", category: "table", width: 0.6, depth: 0.6, height: 1.1, seats: null, collision: "cylinder" },
    { name: "Stage Platform", category: "staging", width: 2.4, depth: 1.2, height: 0.2, seats: null, collision: "box" },
    { name: "Dance Floor Panel", category: "danceFloor", width: 1.2, depth: 1.2, height: 0.03, seats: null, collision: "box" },
    { name: "Lectern", category: "misc", width: 0.6, depth: 0.5, height: 1.1, seats: null, collision: "box" },
  ] as const;

  const insertedAssets = await db.insert(assetDefinitions).values(
    assets.map((a) => ({
      name: a.name,
      category: a.category,
      widthM: String(a.width),
      depthM: String(a.depth),
      heightM: String(a.height),
      seatCount: a.seats,
      collisionType: a.collision,
    })),
  ).returning();

  for (const a of insertedAssets) {
    console.log(`  Asset: ${a.name} (${a.id})`);
  }

  // --- 4. Users (dev only — insecure passwords) ---
  const adminHash = await hash("admin123");
  const staffHash = await hash("staff123");

  const insertedUsers = await db.insert(users).values([
    {
      email: "admin@tradeshall.co.uk",
      passwordHash: adminHash,
      name: "Admin User",
      role: "admin",
      venueId: venue.id,
    },
    {
      email: "elaine@tradeshall.co.uk",
      passwordHash: staffHash,
      name: "Elaine MacGregor",
      role: "hallkeeper",
      venueId: venue.id,
    },
  ]).returning();

  for (const u of insertedUsers) {
    console.log(`  User: ${u.email} (${u.role})`);
  }

  console.log("\nSeed complete.");
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
