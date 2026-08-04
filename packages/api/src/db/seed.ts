import "dotenv/config";
import { type FloorPlanPoint, polygonBoundingBox, CANONICAL_ASSETS, ACCESSORY_RULES } from "@omnitwin/types";
import { validateEnv } from "../env.js";
import { createDb, isLocalDatabaseUrl } from "./client.js";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
  assetAccessories,
  pricingRules,
  bookings,
  events,
  eventPhases,
  turnaroundRules,
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

  // Security-review guard (T-518): this seed writes venues, users, and a
  // whole booking week — it must never run against a remote database by
  // accident. packages/api/.env points at the PRODUCTION Neon project, so
  // an unthinking `pnpm db:seed` would otherwise write straight into it.
  if (!isLocalDatabaseUrl(env.DATABASE_URL) && process.env["SEED_ALLOW_REMOTE"] !== "1") {
    console.error(
      "Refusing to seed a non-local DATABASE_URL. Point DATABASE_URL at the",
    );
    console.error(
      "local dev database (infra/dev-db/) or set SEED_ALLOW_REMOTE=1 if you",
    );
    console.error("really mean to seed a remote database.");
    process.exit(1);
  }

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
    { name: "Grand Hall", slug: "grand-hall", width: 21, length: 10.5, height: 7, sort: 0 },
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
    // Live-e2e coordinators (Diary Slice 4, T-518). clerkId stays NULL so the
    // first real Clerk sign-in with the email links through the seed-user
    // branch of getUserByClerkId — a non-null placeholder would be rejected
    // as a Clerk-ID mismatch. `+clerk_test` addresses are Clerk dev-instance
    // test users: OTP 424242, no real mail ever sent.
    {
      clerkId: null,
      email: "fiona.coordinator+clerk_test@tradeshall.co.uk",
      name: "Fiona Coordinator",
      role: "staff",
      venueId: venue.id,
    },
    {
      clerkId: null,
      email: "graham.coordinator+clerk_test@tradeshall.co.uk",
      name: "Graham Coordinator",
      role: "staff",
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

  // --- 6. Diary seed (T-492; Canon §12 P0) ---
  // A believable week of mixed commitments across all six rooms, several per
  // room per day: inks (never overlapping in one space — the exclusion
  // constraint enforces it), ranked hold ladders incl. a joint first pair,
  // a non-blocking prospect, an internal block, and one linked event whose
  // room-scoped phases form an Occupancy Footprint. Two ink gaps are
  // deliberately shorter than the applicable turnaround rule so the calendar
  // shows real, honest warnings out of the box.
  //
  // Times: the week of Mon 14 Sep 2026, expressed as Europe/London wall
  // clock (BST, UTC+1 all week) and stored as UTC instants.
  const weekLabel = "week of Mon 14 Sep 2026";
  const bst = (day: number, hour: number, minute = 0): Date =>
    new Date(Date.UTC(2026, 8, 14 + day, hour - 1, minute));

  const adminUser = insertedUsers.find((u) => u.role === "admin");
  if (adminUser === undefined) throw new Error("Diary seed requires the admin user");

  const requireSpace = (name: string): string => {
    const id = spaceIdByName.get(name);
    if (id === undefined) throw new Error(`Space not found: ${name}`);
    return id;
  };

  const grandHall = requireSpace("Grand Hall");
  const saloon = requireSpace("Saloon");
  const receptionRoom = requireSpace("Reception Room");
  const robertAdam = requireSpace("Robert Adam Room");
  const northGallery = requireSpace("North Gallery");
  const southGallery = requireSpace("South Gallery");

  const insertedTurnarounds = await db.insert(turnaroundRules).values([
    { venueId: venue.id, spaceId: null, eventType: null, name: "House default turnaround", minutes: 90 },
    { venueId: venue.id, spaceId: grandHall, eventType: null, name: "Grand Hall reset", minutes: 120 },
    { venueId: venue.id, spaceId: grandHall, eventType: "wedding", name: "Grand Hall wedding reset", minutes: 180 },
    { venueId: venue.id, spaceId: northGallery, eventType: null, name: "Gallery light reset", minutes: 30 },
    { venueId: venue.id, spaceId: southGallery, eventType: null, name: "Gallery light reset", minutes: 30 },
  ]).returning();
  console.log(`  Turnaround rules: ${String(insertedTurnarounds.length)} created`);

  // One linked event with a room-scoped footprint (Canon §2.3): the Saturday
  // wedding occupies the Grand Hall as setup → live → teardown phases inside
  // its ink booking window.
  const [weddingEvent] = await db.insert(events).values({
    venueId: venue.id,
    createdBy: adminUser.id,
    name: "Mackenzie–Ross wedding",
    eventType: "wedding",
    status: "in_planning",
    startsAt: bst(5, 13, 0),
    endsAt: bst(6, 0, 30),
    guestCount: 120,
    clientName: "Mackenzie & Ross",
    headcountGuaranteed: 110,
    headcountExpected: 120,
    headcountSetFor: 126,
  }).returning();
  if (weddingEvent === undefined) throw new Error("Failed to seed the wedding event");

  await db.insert(eventPhases).values([
    {
      eventId: weddingEvent.id,
      spaceId: grandHall,
      templateKey: null,
      name: "Setup",
      sortOrder: 0,
      startsAt: bst(5, 9, 0),
      durationMinutes: 240,
    },
    {
      eventId: weddingEvent.id,
      spaceId: grandHall,
      templateKey: null,
      name: "Ceremony & reception",
      sortOrder: 1,
      startsAt: bst(5, 13, 0),
      durationMinutes: 690,
    },
    {
      eventId: weddingEvent.id,
      spaceId: grandHall,
      templateKey: null,
      name: "Teardown",
      sortOrder: 2,
      startsAt: bst(6, 0, 30),
      durationMinutes: 90,
    },
  ]);
  console.log(`  Event footprint: ${weddingEvent.name} (3 Grand Hall phases)`);

  // Hold hygiene (Canon §3): every hold carries a decision date, an owner,
  // and a dated next action — the seed obeys the same law the API enforces.
  const hygiene = (decisionAt: Date, nextAction: string): {
    decisionAt: Date;
    ownerUserId: string;
    nextAction: string;
    nextActionDueAt: Date;
  } => ({
    decisionAt,
    ownerUserId: adminUser.id,
    nextAction,
    nextActionDueAt: new Date(decisionAt.getTime() - 7 * 24 * 60 * 60 * 1000),
  });

  const insertedBookings = await db.insert(bookings).values([
    // --- Grand Hall ---------------------------------------------------------
    {
      venueId: venue.id, spaceId: grandHall, kind: "ink", title: "Chamber of Commerce conference",
      eventType: "conference", startsAt: bst(0, 9, 0), endsAt: bst(0, 17, 0), createdBy: adminUser.id,
    },
    {
      // 90-minute gap after the conference vs the 120-minute Grand Hall reset
      // rule → an honest turnaround warning in the seeded calendar.
      venueId: venue.id, spaceId: grandHall, kind: "ink", title: "Charity ceilidh",
      eventType: "ceilidh", startsAt: bst(0, 18, 30), endsAt: bst(0, 23, 30), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: grandHall, kind: "prospect", title: "Design fair enquiry",
      eventType: "exhibition", startsAt: bst(1, 10, 0), endsAt: bst(1, 16, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: grandHall, kind: "hold", rank: 1, title: "MacLeod wedding",
      eventType: "wedding", startsAt: bst(4, 17, 0), endsAt: bst(4, 23, 30), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-21T12:00:00.000Z"), "Call Fiona MacLeod about the decision date."),
    },
    {
      venueId: venue.id, spaceId: grandHall, kind: "hold", rank: 2, title: "Robertson ceilidh",
      eventType: "ceilidh", startsAt: bst(4, 18, 0), endsAt: bst(4, 23, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-28T12:00:00.000Z"), "Confirm band availability with the Robertsons."),
    },
    {
      venueId: venue.id, spaceId: grandHall, eventId: weddingEvent.id, kind: "ink",
      title: "Mackenzie–Ross wedding", eventType: "wedding",
      startsAt: bst(5, 9, 0), endsAt: bst(6, 2, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: grandHall, kind: "hold", rank: 1, jointFlag: true,
      title: "Kerr wedding", eventType: "wedding",
      startsAt: bst(6, 14, 0), endsAt: bst(6, 23, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-14T12:00:00.000Z"), "Offer the Kerrs first-to-confirm terms."),
    },
    {
      venueId: venue.id, spaceId: grandHall, kind: "hold", rank: 1, jointFlag: true,
      title: "Nairn wedding", eventType: "wedding",
      startsAt: bst(6, 14, 0), endsAt: bst(6, 23, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-14T12:00:00.000Z"), "Offer the Nairns first-to-confirm terms."),
    },
    // --- Saloon --------------------------------------------------------------
    {
      venueId: venue.id, spaceId: saloon, kind: "ink", title: "Conference drinks reception",
      eventType: "reception", startsAt: bst(0, 17, 30), endsAt: bst(0, 19, 30), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: saloon, kind: "internal_block", title: "Floor maintenance",
      startsAt: bst(2, 8, 0), endsAt: bst(2, 12, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: saloon, kind: "hold", rank: 1, title: "Sinclair anniversary",
      eventType: "dinner", startsAt: bst(3, 18, 0), endsAt: bst(3, 23, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-09-01T12:00:00.000Z"), "Send the Sinclairs the dinner menu options."),
    },
    // --- Reception Room ------------------------------------------------------
    {
      venueId: venue.id, spaceId: receptionRoom, kind: "ink", title: "Board strategy morning",
      eventType: "meeting", startsAt: bst(1, 8, 0), endsAt: bst(1, 12, 0), createdBy: adminUser.id,
    },
    {
      // 30-minute gap vs the 90-minute house default → turnaround warning.
      venueId: venue.id, spaceId: receptionRoom, kind: "ink", title: "Alumni dinner",
      eventType: "dinner", startsAt: bst(1, 12, 30), endsAt: bst(1, 17, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: receptionRoom, kind: "hold", rank: 1, title: "Wedding breakfast option",
      eventType: "wedding", startsAt: bst(5, 10, 0), endsAt: bst(5, 16, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-25T12:00:00.000Z"), "Check whether the couple wants the smaller room."),
    },
    // --- Robert Adam Room ----------------------------------------------------
    {
      venueId: venue.id, spaceId: robertAdam, kind: "ink", title: "Trustees meeting",
      eventType: "meeting", startsAt: bst(2, 9, 0), endsAt: bst(2, 11, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: robertAdam, kind: "hold", rank: 1, title: "Portrait workshop",
      eventType: "workshop", startsAt: bst(2, 10, 0), endsAt: bst(2, 13, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-09-04T12:00:00.000Z"), "Confirm easel count with the tutor."),
    },
    {
      venueId: venue.id, spaceId: robertAdam, kind: "prospect", title: "Podcast recording enquiry",
      startsAt: bst(2, 10, 30), endsAt: bst(2, 12, 30), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: robertAdam, kind: "ink", title: "Whisky tasting",
      eventType: "tasting", startsAt: bst(4, 19, 0), endsAt: bst(4, 22, 0), createdBy: adminUser.id,
    },
    // --- Galleries -----------------------------------------------------------
    {
      venueId: venue.id, spaceId: northGallery, kind: "ink", title: "Craft exhibition install",
      eventType: "exhibition", startsAt: bst(2, 9, 0), endsAt: bst(2, 17, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: northGallery, kind: "ink", title: "Craft exhibition",
      eventType: "exhibition", startsAt: bst(3, 9, 0), endsAt: bst(5, 8, 0), createdBy: adminUser.id,
    },
    {
      venueId: venue.id, spaceId: southGallery, kind: "hold", rank: 1, title: "Photography backdrop",
      eventType: "photography", startsAt: bst(1, 9, 0), endsAt: bst(1, 13, 0), createdBy: adminUser.id,
      ...hygiene(new Date("2026-08-30T12:00:00.000Z"), "Ask the photographer for the shot list."),
    },
    {
      venueId: venue.id, spaceId: southGallery, kind: "ink", title: "Wedding photography overflow",
      eventType: "wedding", startsAt: bst(5, 12, 0), endsAt: bst(5, 23, 0), createdBy: adminUser.id,
    },
  ]).returning();
  console.log(`  Diary bookings: ${String(insertedBookings.length)} created (${weekLabel})`);

  console.log("\nSeed complete.");
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
