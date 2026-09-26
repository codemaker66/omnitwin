import { eq, and, isNull, isNotNull, inArray, desc } from "drizzle-orm";
import type {
  EventInstructions,
  HallkeeperSheetV2,
  SheetApproval,
  Timing,
  SetupPhase,
} from "@omnitwin/types";
import { hasInstructionContent } from "@omnitwin/types";
import {
  configurations, placedObjects, assetDefinitions, assetAccessories,
  spaces, venues, enquiries, configurationSheetSnapshots, users,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { REAL_METRE_COORDINATE_SPACE, type LayoutCoordinateSpace } from "../db/coordinate-space.js";
import { generateManifestV2, type ManifestObjectV2, type AccessoryRule } from "./manifest-generator-v2.js";
import { parseHallkeeperSnapshotPayload } from "./layout-coordinate-space.js";
import { buildHallkeeperFloorPlan, type FloorPlanAsset } from "./hallkeeper-floor-plan.js";

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
  /** Only the validated approved snapshot's PDF; live sheets never reuse it. */
  readonly approvedPdfUrl: string | null;
}

export class ApprovedSnapshotUnavailableError extends Error {
  readonly code = "APPROVED_SNAPSHOT_UNAVAILABLE";

  constructor() {
    super("The approved setup sheet is unavailable. Contact venue staff before using a replacement.");
    this.name = "ApprovedSnapshotUnavailableError";
  }
}

export async function assembleSheetDataV2(
  db: Database,
  configId: string,
  baseUrl: string,
): Promise<SheetDataV2Internal | null> {
  // Step 1: config is the root — every subsequent query either uses its
  // columns or needs it to exist to be meaningful.
  const [config] = await db.select().from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;

  const nowIso = new Date().toISOString();
  const webViewUrl = `${baseUrl}/hallkeeper/${configId}`;
  if (config.reviewStatus === "approved") {
    // Read the content, approval and PDF from one version. Missing or damaged
    // evidence must never replace the approved layout with current live edits.
    const snapshot = await loadLatestApprovedSnapshot(db, configId);
    const frozen = resolveApprovedSnapshotPayload(configId, snapshot);
    return {
      authPivot: { venueId: config.venueId, configUserId: config.userId },
      payload: { ...frozen, generatedAt: nowIso, webViewUrl },
      approvedPdfUrl: snapshot?.pdfUrl ?? null,
    };
  }

  // Live sheets only: independent reads, then the asset-definition fan-out.
  const [spaceRows, venueRows, objects, accessoryRows] = await Promise.all([
    db.select().from(spaces).where(eq(spaces.id, config.spaceId)).limit(1),
    db.select().from(venues).where(eq(venues.id, config.venueId)).limit(1),
    db.select({
      id: placedObjects.id,
      assetDefinitionId: placedObjects.assetDefinitionId,
      positionX: placedObjects.positionX,
      positionY: placedObjects.positionY,
      positionZ: placedObjects.positionZ,
      rotationY: placedObjects.rotationY,
      scale: placedObjects.scale,
      metadata: placedObjects.metadata,
    }).from(placedObjects).where(eq(placedObjects.configurationId, configId)),
    // JOIN asset_definitions to key by parent-asset NAME (what the
    // manifest generator expects).
    db.select({
      parentName: assetDefinitions.name,
      name: assetAccessories.name,
      category: assetAccessories.category,
      quantityPerParent: assetAccessories.quantityPerParent,
      phase: assetAccessories.phase,
      afterDepth: assetAccessories.afterDepth,
    })
      .from(assetAccessories)
      .innerJoin(assetDefinitions, eq(assetAccessories.parentAssetId, assetDefinitions.id)),
  ]);

  const [space] = spaceRows;
  const [venue] = venueRows;
  if (space === undefined) return null;
  if (venue === undefined) return null;

  // Live branch: resolve asset-definition cache for THIS config's
  // placed objects (second DB fan-out — only runs when we aren't
  // serving from a snapshot).
  const uniqueAssetIds = [...new Set(objects.map((o) => o.assetDefinitionId))];
  const assetCache = new Map<string, FloorPlanAsset>();
  if (uniqueAssetIds.length > 0) {
    const assetRows = await db.select({
      id: assetDefinitions.id,
      name: assetDefinitions.name,
      category: assetDefinitions.category,
      widthM: assetDefinitions.widthM,
      depthM: assetDefinitions.depthM,
      collisionType: assetDefinitions.collisionType,
    }).from(assetDefinitions).where(inArray(assetDefinitions.id, uniqueAssetIds));
    for (const a of assetRows) {
      assetCache.set(a.id, a);
    }
  }

  const manifestObjects: ManifestObjectV2[] = objects.map((obj) => {
    const asset = assetCache.get(obj.assetDefinitionId);
    const meta = obj.metadata as Record<string, unknown> | null;
    const rawGroupId = meta?.["groupId"];
    const groupId = typeof rawGroupId === "string" ? rawGroupId : null;
    const rawNotes = meta?.["notes"];
    const notes = typeof rawNotes === "string" ? rawNotes : null;
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
      notes,
    };
  });

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

  // Approved snapshots carry their own timing and instructions; only live
  // sheets reach this branch.
  const timing = await resolveTiming(db, configId);
  const instructions = resolveInstructions(config.metadata);

  const livePayload: HallkeeperSheetV2 = {
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
      timezone: venue.timezone,
    },
    space: {
      name: space.name,
      widthM: Number(space.widthM),
      lengthM: Number(space.lengthM),
      heightM: Number(space.heightM),
    },
    timing,
    instructions,
    phases: manifest.phases,
    totals: manifest.totals,
    diagramUrl: config.thumbnailUrl,
    floorPlan: buildHallkeeperFloorPlan(space.floorPlanOutline, objects, assetCache),
    webViewUrl,
    generatedAt: nowIso,
    approval: null,
  };

  return {
    authPivot: { venueId: venue.id, configUserId: config.userId },
    payload: livePayload,
    approvedPdfUrl: null,
  };
}

interface ApprovedSnapshot {
  readonly payload: unknown;
  readonly coordinateSpace: LayoutCoordinateSpace;
  readonly version: number;
  readonly approvedAt: Date | null;
  readonly approver: { name: string; displayName: string | null } | null;
}

/** A single row binds the payload, stamp and optional PDF to the same version. */
async function loadLatestApprovedSnapshot(
  db: Database,
  configId: string,
): Promise<(ApprovedSnapshot & { pdfUrl: string | null }) | null> {
  const [snap] = await db.select({
    payload: configurationSheetSnapshots.payload,
    coordinateSpace: configurationSheetSnapshots.coordinateSpace,
    version: configurationSheetSnapshots.version,
    approvedAt: configurationSheetSnapshots.approvedAt,
    currentApprovedAt: configurations.approvedAt,
    pdfUrl: configurationSheetSnapshots.pdfUrl,
    approver: { name: users.name, displayName: users.displayName },
  })
    .from(configurationSheetSnapshots)
    .innerJoin(configurations, eq(configurations.id, configurationSheetSnapshots.configurationId))
    .leftJoin(users, eq(users.id, configurationSheetSnapshots.approvedBy))
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
      eq(configurations.reviewStatus, "approved"),
      isNull(configurations.deletedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  if (snap === undefined) return null;
  // Approval writes update these timestamps together in one transaction.
  // A missing newest row must not silently resurrect an older approval.
  if (snap.approvedAt === null || snap.currentApprovedAt === null
    || snap.approvedAt.getTime() !== snap.currentApprovedAt.getTime()) {
    throw new ApprovedSnapshotUnavailableError();
  }
  return snap;
}

/** Validate frozen evidence without depending on the approving account's lifetime. */
export function resolveApprovedSnapshotPayload(
  configId: string,
  snapshot: ApprovedSnapshot | null,
): HallkeeperSheetV2 {
  if (snapshot === null || snapshot.approvedAt === null) throw new ApprovedSnapshotUnavailableError();
  const frozen = parseStoredSnapshotPayload(snapshot.payload, snapshot.coordinateSpace);
  if (frozen === null || frozen.config.id !== configId) throw new ApprovedSnapshotUnavailableError();

  const approvedAt = snapshot.approvedAt.toISOString();
  if (frozen.approval !== null) {
    if (frozen.approval.version !== snapshot.version
      || Date.parse(frozen.approval.approvedAt) !== snapshot.approvedAt.getTime()) {
      throw new ApprovedSnapshotUnavailableError();
    }
    return frozen;
  }

  // Submission-era payloads may lack a stamp. Preserve their frozen contents
  // and derive only the stamp from this exact row, without rewriting history.
  const approval = buildSheetApproval({ version: snapshot.version, approvedAt: snapshot.approvedAt }, snapshot.approver)
    ?? { version: snapshot.version, approvedAt, approverName: "Historical approver unavailable" };
  return { ...frozen, approval };
}

/**
 * Pure jsonb → `HallkeeperSheetV2 | null` parse. Lives outside the DB
 * function so it can be unit-tested directly — the DB boundary is
 * irrelevant to the parse / backfill / validation contract.
 *
 * Returns null when:
 *   - the raw value is null or non-object (malformed jsonb)
 *   - validation against `HallkeeperSheetV2Schema` fails after the
 *     `approval: null` backfill (schema drift, manual patch, corrupt
 *     row)
 *
 * Pre-4c snapshots (written before the schema gained the required
 * `approval` key) are tolerated by backfilling `approval: null`
 * before validation. The upstream caller overlays a real approval
 * from the same snapshot row, so the placeholder never reaches consumers.
 */
export function parseStoredSnapshotPayload(
  raw: unknown,
  coordinateSpace: LayoutCoordinateSpace = REAL_METRE_COORDINATE_SPACE,
): HallkeeperSheetV2 | null {
  return parseHallkeeperSnapshotPayload(raw, coordinateSpace);
}

/**
 * Pull EventInstructions out of configurations.metadata. The PATCH
 * route validates the shape on write (ConfigurationMetadataSchema), so
 * here we just cast and gate on `hasInstructionContent` to avoid
 * rendering an empty callout.
 */
function resolveInstructions(raw: unknown): EventInstructions | null {
  const metadata = raw as { instructions?: EventInstructions } | null;
  const instructions = metadata?.instructions;
  if (instructions === undefined || !hasInstructionContent(instructions)) return null;
  return instructions;
}

/** Build a legacy stamp when its approving account can still be resolved. */
export function buildSheetApproval(
  snap: { version: number; approvedAt: Date },
  approver: { name: string; displayName: string | null } | null,
): SheetApproval | null {
  if (approver === null) return null;
  const approverName = approver.displayName ?? approver.name;
  return {
    version: snap.version,
    approvedAt: snap.approvedAt.toISOString(),
    approverName,
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
