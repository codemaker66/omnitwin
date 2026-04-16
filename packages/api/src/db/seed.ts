import "dotenv/config";
import { type FloorPlanPoint, polygonBoundingBox, CANONICAL_ASSETS, ACCESSORY_RULES } from "@omnitwin/types";
import { validateEnv } from "../env.js";
import { createDb } from "./client.js";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
  assetAccessories,
  pricingRules,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Seed — populates database with Trades Hall data
// Run: pnpm --filter @omnitwin/api db:seed
// ---------------------------------------------------------------------------

/** Rectangular floor plan centred at origin. The polygon is the source of
 *  truth; the seed derives width/length via `polygonBoundingBox` so the
 *  dataflow matches the runtime invariant documented in db/schema.ts. */
function rectOutline(w: number, l: number): readonly FloorPlanPoint[] {
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
  // Dataflow: we pick canonical source dimensions for each room, build the
  // rectangular polygon from them, then derive widthM/lengthM from the
  // polygon's bbox. The derived values equal the source by construction for
  // rectangles — but running them through `polygonBoundingBox` makes the
  // seed express the same polygon-is-source-of-truth invariant that the
  // write path enforces at runtime.
  const spaceData = [
    { name: "Grand Hall", slug: "grand-hall", width: 21, length: 10, height: 7, sort: 0 },
    { name: "Saloon", slug: "saloon", width: 12, length: 7, height: 5.4, sort: 1 },
    { name: "Reception Room", slug: "reception-room", width: 13.4, length: 11.2, height: 3.2, sort: 2 },
    { name: "Robert Adam Room", slug: "robert-adam-room", width: 9.7, length: 5.6, height: 2.18, sort: 3 },
    { name: "North Gallery", slug: "north-gallery", width: 8, length: 4, height: 3, sort: 4 },
    { name: "South Gallery", slug: "south-gallery", width: 8, length: 4, height: 3, sort: 5 },
  ] as const;

  const insertedSpaces = await db.insert(spaces).values(
    spaceData.map((s) => {
      const outline = rectOutline(s.width, s.length);
      const bbox = polygonBoundingBox(outline);
      return {
        venueId: venue.id,
        name: s.name,
        slug: s.slug,
        widthM: String(bbox.widthM),
        lengthM: String(bbox.lengthM),
        heightM: String(s.height),
        floorPlanOutline: outline,
        sortOrder: s.sort,
      };
    }),
  ).returning();

  for (const s of insertedSpaces) {
    console.log(`  Space: ${s.name} (${s.id})`);
  }

  // --- 3. Asset definitions — derived from the canonical catalogue in
  // @omnitwin/types/asset-catalogue.ts. Each item uses a deterministic
  // UUID v5 as its primary key (overriding defaultRandom()), so the DB
  // rows have the same IDs that the web catalogue references. Re-running
  // the seed with the same slugs produces the same UUIDs — idempotent.
  //
  // The canonical catalogue also guarantees that names, categories, and
  // dimensions match the web's rendering metadata. The old seed used
  // different names ("Round Table 6ft" vs "6ft Round Table") and invalid
  // categories ("staging", "danceFloor", "misc") which broke the FK
  // linkage and the hallkeeper accessory lookup.
  const insertedAssets = await db.insert(assetDefinitions).values(
    CANONICAL_ASSETS.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      widthM: String(a.widthM),
      depthM: String(a.depthM),
      heightM: String(a.heightM),
      seatCount: a.seatCount,
      collisionType: a.collisionType,
    })),
  ).returning();

  for (const a of insertedAssets) {
    console.log(`  Asset: ${a.name} (${a.id})`);
  }

  // --- 3b. Asset accessories (hallkeeper setup rules) ---
  // Convert ACCESSORY_RULES (static lookup keyed by asset name) into DB
  // rows keyed by the parent asset's UUID. The name→UUID mapping comes
  // from the just-inserted assets. Accessories for assets not in the
  // seed (future admin-created items) are silently skipped.
  const assetIdByName = new Map<string, string>();
  for (const a of insertedAssets) {
    assetIdByName.set(a.name, a.id);
  }

  const accessoryRows: {
    parentAssetId: string;
    name: string;
    category: string;
    quantityPerParent: number;
    phase: string;
    afterDepth: number;
  }[] = [];

  for (const [assetName, rules] of Object.entries(ACCESSORY_RULES)) {
    const parentId = assetIdByName.get(assetName);
    if (parentId === undefined) continue; // asset not in this seed run
    for (const rule of rules) {
      accessoryRows.push({
        parentAssetId: parentId,
        name: rule.name,
        category: rule.category,
        quantityPerParent: rule.quantityPerParent,
        phase: rule.phase,
        afterDepth: rule.afterDepth,
      });
    }
  }

  if (accessoryRows.length > 0) {
    await db.insert(assetAccessories).values(accessoryRows);
  }
  console.log(`  Accessories: ${String(accessoryRows.length)} rules created`);

  // --- 4. Users (Clerk manages auth — these are local profile records) ---
  // clerkId is null until real Clerk users are created and linked via webhook
  const insertedUsers = await db.insert(users).values([
    {
      clerkId: "clerk_seed_admin",
      email: "admin@tradeshall.co.uk",
      name: "Admin User",
      role: "admin",
      venueId: venue.id,
    },
    {
      clerkId: "clerk_seed_hallkeeper",
      email: "elaine@tradeshall.co.uk",
      name: "Elaine MacGregor",
      role: "hallkeeper",
      venueId: venue.id,
    },
  ]).returning();

  for (const u of insertedUsers) {
    console.log(`  User: ${u.email} (${u.role})`);
  }

  // --- 5. Pricing rules (from official Trades Hall price sheet) ---
  // Each room has three time slots: half day, full day, evening event.
  // Amounts are in GBP. Notes are encoded in the rule name.
  //
  // Source: Trades Hall Glasgow Room Hire PDF (March 2025)
  //   Half day:  09:00–13:00 or 14:00–18:00
  //   Full day:  09:00–17:30
  //   Evening:   19:00–00:30

  // Build a space-name → id lookup from the just-inserted rows
  const spaceIdByName = new Map<string, string>();
  for (const s of insertedSpaces) {
    spaceIdByName.set(s.name, s.id);
  }

  const pricingData: {
    readonly space: string;
    readonly slot: string;
    readonly amount: number;
    readonly note: string | null;
  }[] = [
    // Grand Hall
    { space: "Grand Hall", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 550, note: null },
    { space: "Grand Hall", slot: "Full Day (09:00–17:30)", amount: 900, note: null },
    { space: "Grand Hall", slot: "Evening Event (19:00–00:30)", amount: 1500, note: "Includes Saloon" },
    // Saloon
    { space: "Saloon", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 350, note: "Free with Grand Hall booking" },
    { space: "Saloon", slot: "Full Day (09:00–17:30)", amount: 450, note: "Free with Grand Hall booking" },
    { space: "Saloon", slot: "Evening Event (19:00–00:30)", amount: 500, note: null },
    // Reception Room
    { space: "Reception Room", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 300, note: null },
    { space: "Reception Room", slot: "Full Day (09:00–17:30)", amount: 400, note: null },
    { space: "Reception Room", slot: "Evening Event (19:00–00:30)", amount: 500, note: null },
    // Robert Adam Room
    { space: "Robert Adam Room", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 450, note: null },
    { space: "Robert Adam Room", slot: "Full Day (09:00–17:30)", amount: 550, note: null },
    { space: "Robert Adam Room", slot: "Evening Event (19:00–00:30)", amount: 650, note: null },
    // North Gallery
    { space: "North Gallery", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 130, note: "Only if venue already open" },
    { space: "North Gallery", slot: "Full Day (09:00–17:30)", amount: 250, note: "Only if venue already open" },
    { space: "North Gallery", slot: "Evening Event (19:00–00:30)", amount: 250, note: "Only if venue already open" },
    // South Gallery
    { space: "South Gallery", slot: "Half Day (09:00–13:00 or 14:00–18:00)", amount: 130, note: "Only if venue already open" },
    { space: "South Gallery", slot: "Full Day (09:00–17:30)", amount: 250, note: "Only if venue already open" },
    { space: "South Gallery", slot: "Evening Event (19:00–00:30)", amount: 250, note: "Only if venue already open" },
  ];

  interface SeedRule {
    readonly venueId: string;
    readonly spaceId: string | null;
    readonly name: string;
    readonly type: string;
    readonly amount: string;
    readonly currency: string;
    readonly isActive: boolean;
  }

  const ruleValues: SeedRule[] = pricingData.map((p) => {
    const spaceId = spaceIdByName.get(p.space);
    if (spaceId === undefined) throw new Error(`Space not found: ${p.space}`);
    const name = p.note !== null
      ? `${p.space} — ${p.slot} (${p.note})`
      : `${p.space} — ${p.slot}`;
    return {
      venueId: venue.id,
      spaceId,
      name,
      type: "flat_rate",
      amount: String(p.amount),
      currency: "GBP",
      isActive: true,
    };
  });

  // Add venue-wide exclusive hire rule (spaceId: null = applies to whole venue)
  ruleValues.push({
    venueId: venue.id,
    spaceId: null,
    name: "Exclusive Use of Full Venue",
    type: "flat_rate",
    amount: "2500",
    currency: "GBP",
    isActive: true,
  });

  const insertedRules = await db.insert(pricingRules).values(ruleValues).returning();
  console.log(`  Pricing rules: ${String(insertedRules.length)} created`);
  console.log("    Note: Breakout rooms get 10% discount on additional room charge");

  console.log("\nSeed complete.");
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
