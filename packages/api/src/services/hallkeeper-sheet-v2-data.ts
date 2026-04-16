import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import type { HallkeeperSheetV2, Timing, SetupPhase } from "@omnitwin/types";
import {
  configurations, placedObjects, assetDefinitions, assetAccessories, spaces, venues, enquiries,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { generateManifestV2, type ManifestObjectV2, type AccessoryRule } from "./manifest-generator-v2.js";

// ---------------------------------------------------------------------------
// Hallkeeper Sheet V2 — data assembly
//
// Produces the HallkeeperSheetV2
// shape instead of the flat manifest. The v2 shape is phase/zone
// grouped with dependency ordering and stable keys — see
// @omnitwin/types/hallkeeper-v2.ts for the schema contract.
//
// Timing policy: if the config has a linked enquiry with a preferredDate,
// we derive an 18:00 event start + 16:30 setupBy (90-minute buffer).
// Without an enquiry or preferredDate we return timing=null; the web
// view then hides the timing chip rather than showing a fake number.
// This is NOT trying to be a scheduling system — it's a reasonable
// default the hallkeeper can override in conversation with the planner.
// ---------------------------------------------------------------------------

const DEFAULT_EVENT_START_HOUR = 18;
const SETUP_BUFFER_MINUTES = 90;

/**
 * Returns v2 data with the auth-pivot fields (venue.id, config.userId)
 * alongside the schema-shaped response so the route handler can call canAccessResource
 * without loading a second query.
 */
export interface SheetDataV2Internal {
  readonly authPivot: {
    readonly venueId: string;
    readonly configUserId: string | null;
  };
  readonly payload: HallkeeperSheetV2;
}

export async function assembleSheetDataV2(
  db: Database,
  configId: string,
  baseUrl: string,
): Promise<SheetDataV2Internal | null> {
  const [config] = await db.select().from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;

  const [space] = await db.select().from(spaces)
    .where(eq(spaces.id, config.spaceId))
    .limit(1);
  if (space === undefined) return null;

  const [venue] = await db.select().from(venues)
    .where(eq(venues.id, config.venueId))
    .limit(1);
  if (venue === undefined) return null;

  // Placed objects + asset cache — same pattern as v1
  const objects = await db.select({
    id: placedObjects.id,
    assetDefinitionId: placedObjects.assetDefinitionId,
    positionX: placedObjects.positionX,
    positionY: placedObjects.positionY,
    positionZ: placedObjects.positionZ,
    rotationY: placedObjects.rotationY,
    metadata: placedObjects.metadata,
  }).from(placedObjects)
    .where(eq(placedObjects.configurationId, configId));

  const uniqueAssetIds = [...new Set(objects.map((o) => o.assetDefinitionId))];
  const assetCache = new Map<string, { name: string; category: string }>();
  if (uniqueAssetIds.length > 0) {
    const assetRows = await db.select({
      id: assetDefinitions.id,
      name: assetDefinitions.name,
      category: assetDefinitions.category,
    }).from(assetDefinitions).where(inArray(assetDefinitions.id, uniqueAssetIds));
    for (const a of assetRows) {
      assetCache.set(a.id, { name: a.name, category: a.category });
    }
  }

  const manifestObjects: ManifestObjectV2[] = objects.map((obj) => {
    const asset = assetCache.get(obj.assetDefinitionId);
    const meta = obj.metadata as Record<string, unknown> | null;
    const rawGroupId = meta?.["groupId"];
    const groupId = typeof rawGroupId === "string" ? rawGroupId : null;
    return {
      id: obj.id,
      assetName: asset?.name ?? "Unknown",
      assetCategory: asset?.category ?? "other",
      positionX: Number(obj.positionX),
      positionY: Number(obj.positionY),
      positionZ: Number(obj.positionZ),
      rotationY: Number(obj.rotationY),
      chairCount: 0,
      groupId,
    };
  });

  // Load accessory rules from the DB in one query. JOIN asset_definitions
  // to get the parent asset name, which is the key the generator uses.
  const accessoryRows = await db.select({
    parentName: assetDefinitions.name,
    name: assetAccessories.name,
    category: assetAccessories.category,
    quantityPerParent: assetAccessories.quantityPerParent,
    phase: assetAccessories.phase,
    afterDepth: assetAccessories.afterDepth,
  })
    .from(assetAccessories)
    .innerJoin(assetDefinitions, eq(assetAccessories.parentAssetId, assetDefinitions.id));

  const accessoryMap: Map<string, AccessoryRule[]> = new Map();
  for (const row of accessoryRows) {
    let list = accessoryMap.get(row.parentName);
    if (list === undefined) {
      list = [];
      accessoryMap.set(row.parentName, list);
    }
    list.push({
      name: row.name,
      category: row.category,
      quantityPerParent: row.quantityPerParent,
      phase: row.phase as SetupPhase,
      afterDepth: row.afterDepth,
    });
  }

  const roomDims = { widthM: Number(space.widthM), lengthM: Number(space.lengthM) };
  const manifest = generateManifestV2(manifestObjects, roomDims, accessoryMap);

  const timing = await resolveTiming(db, configId);

  const payload: HallkeeperSheetV2 = {
    config: {
      id: config.id,
      name: config.name,
      guestCount: config.guestCount,
      layoutStyle: config.layoutStyle as HallkeeperSheetV2["config"]["layoutStyle"],
    },
    venue: {
      name: venue.name,
      address: venue.address,
      logoUrl: venue.logoUrl,
    },
    space: {
      name: space.name,
      widthM: Number(space.widthM),
      lengthM: Number(space.lengthM),
      heightM: Number(space.heightM),
    },
    timing,
    phases: manifest.phases,
    totals: manifest.totals,
    diagramUrl: config.thumbnailUrl,
    webViewUrl: `${baseUrl}/hallkeeper/${configId}`,
    generatedAt: new Date().toISOString(),
  };

  return {
    authPivot: { venueId: venue.id, configUserId: config.userId },
    payload,
  };
}

/**
 * Pick the most recent enquiry linked to this configId and derive a
 * setupBy/eventStart pair from its preferredDate. If there's no
 * enquiry or no date, return null — the UI hides the timing chip
 * rather than showing a fabricated time.
 */
async function resolveTiming(db: Database, configId: string): Promise<Timing | null> {
  const [recent] = await db.select({
    preferredDate: enquiries.preferredDate,
  }).from(enquiries)
    .where(eq(enquiries.configurationId, configId))
    .orderBy(desc(enquiries.createdAt))
    .limit(1);

  if (recent === undefined || recent.preferredDate === null) return null;

  // preferredDate is a date-only string from Postgres ("2026-06-15").
  // Assume a default local-time event start and serialise as ISO UTC so
  // the front-end can render in the venue's timezone.
  const dateStr = recent.preferredDate;
  const eventStart = new Date(`${dateStr}T${String(DEFAULT_EVENT_START_HOUR).padStart(2, "0")}:00:00.000Z`);
  if (Number.isNaN(eventStart.getTime())) return null;
  const setupBy = new Date(eventStart.getTime() - SETUP_BUFFER_MINUTES * 60_000);

  return {
    eventStart: eventStart.toISOString(),
    setupBy: setupBy.toISOString(),
    bufferMinutes: SETUP_BUFFER_MINUTES,
  };
}
