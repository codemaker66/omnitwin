import { eq, and, isNull, isNotNull, inArray, desc } from "drizzle-orm";
import type {
  EventInstructions,
  HallkeeperSheetV2,
  SheetApproval,
  Timing,
  SetupPhase,
} from "@omnitwin/types";
import { HallkeeperSheetV2Schema, hasInstructionContent } from "@omnitwin/types";
import {
  configurations, placedObjects, assetDefinitions, assetAccessories,
  spaces, venues, enquiries, configurationSheetSnapshots, users,
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
  // Step 1: config is the root — every subsequent query either uses its
  // columns or needs it to exist to be meaningful.
  const [config] = await db.select().from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;

  // Step 2: fire all remaining queries in parallel. Five of the six are
  // independent given `config`:
  //   - space              (needs config.spaceId)
  //   - venue              (needs config.venueId)
  //   - placed objects     (needs configId — already have it)
  //   - accessory rules    (global; no config dependency at all)
  //   - approval           (needs config.{id, reviewStatus})
  // Asset-definition rows depend on the set of assetIds inside `objects`
  // and therefore wait for that — second stage, below.
  //
  // Wall-clock: before this refactor an approved /v2 request paid 5–6
  // serial round-trips. Now it pays at most 2 (the object fan-in, then
  // the asset fan-out). For the approved-frozen branch — which is the
  // common hallkeeper-tablet path — the manifest work is skipped
  // entirely so only step 1 + approval run.
  const [spaceRows, venueRows, objects, accessoryRows, approval] = await Promise.all([
    db.select().from(spaces).where(eq(spaces.id, config.spaceId)).limit(1),
    db.select().from(venues).where(eq(venues.id, config.venueId)).limit(1),
    db.select({
      id: placedObjects.id,
      assetDefinitionId: placedObjects.assetDefinitionId,
      positionX: placedObjects.positionX,
      positionY: placedObjects.positionY,
      positionZ: placedObjects.positionZ,
      rotationY: placedObjects.rotationY,
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
    resolveApproval(db, config),
  ]);

  const [space] = spaceRows;
  const [venue] = venueRows;
  if (space === undefined) return null;
  if (venue === undefined) return null;

  const nowIso = new Date().toISOString();
  const webViewUrl = `${baseUrl}/hallkeeper/${configId}`;

  // Short-circuit for the approved-frozen branch BEFORE doing any of
  // the manifest work below. See the big comment block further down
  // for the semantic rationale; what matters here is that on the hot
  // hallkeeper path we skip asset-definition fan-out, manifest gen,
  // timing/instructions resolution entirely.
  if (approval !== null) {
    const frozen = await loadLatestApprovedSnapshotPayload(db, configId);
    if (frozen !== null) {
      return {
        authPivot: { venueId: venue.id, configUserId: config.userId },
        payload: { ...frozen, approval, generatedAt: nowIso, webViewUrl },
      };
    }
  }

  // Live branch: resolve asset-definition cache for THIS config's
  // placed objects (second DB fan-out — only runs when we aren't
  // serving from a snapshot).
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

  // Live branch: runs only when we didn't short-circuit to a frozen
  // snapshot above. The snapshot-vs-live decision is documented at the
  // top of this function. `resolveTiming` is deferred until here
  // because an approved request never needs it (the snapshot carries
  // its own `timing`), saving one round-trip on the hot path.
  //
  // Immutability boundary rationale (for the approved path short-
  // circuit further up): once a config is approved, the hallkeeper
  // must see the FROZEN state captured at submission, not any post-
  // approval drift (admin override, late edits). The snapshot.payload
  // is that frozen record. We overlay three dynamic fields:
  //   - `approval`    — recomputed from live DB so a re-approval shows
  //                     the current approver + timestamp + version
  //   - `generatedAt` — reflects THIS render, not the snapshot write
  //   - `webViewUrl`  — rebuilt against the request's baseUrl, which
  //                     varies between environments (localhost / preview /
  //                     prod) and is NOT an intrinsic property of the
  //                     frozen payload
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
    webViewUrl,
    generatedAt: nowIso,
    approval,
  };

  return {
    authPivot: { venueId: venue.id, configUserId: config.userId },
    payload: livePayload,
  };
}

/**
 * Load the payload of the latest APPROVED snapshot for a config, or
 * null if none exists or the stored jsonb does not parse as a valid
 * `HallkeeperSheetV2`. Sorted by version descending — the most recent
 * approval wins if the config was re-approved (version increments on
 * each submit + approve cycle).
 *
 * Why Zod-validate on read: `payload` is a jsonb column (Drizzle
 * types it as `unknown`). The schema has evolved at least once (the
 * `approval` field was added in Phase 4c), and can evolve again. A
 * corrupted row, a manual DB patch, or a future-schema snapshot would
 * otherwise silently produce an invalid payload the consumers (PDF,
 * tablet) must then defensively handle. Validating here means the
 * assembly function hands back either a known-good payload or falls
 * through to live data — never garbage.
 *
 * For the `approval` field specifically: the caller overlays it from
 * live DB after this read, so a pre-4c snapshot missing the key is
 * tolerated via the overlay. That is why the stored schema uses
 * `.nullable()` rather than `.nullable().optional()` — the overlay is
 * mandatory; we validate against the full schema regardless.
 */
async function loadLatestApprovedSnapshotPayload(
  db: Database,
  configId: string,
): Promise<HallkeeperSheetV2 | null> {
  const [snap] = await db.select({ payload: configurationSheetSnapshots.payload })
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  if (snap === undefined) return null;
  return parseStoredSnapshotPayload(snap.payload);
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
 * from live DB, so the placeholder never reaches consumers.
 */
export function parseStoredSnapshotPayload(raw: unknown): HallkeeperSheetV2 | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = "approval" in raw ? raw : { ...raw, approval: null };
  const parsed = HallkeeperSheetV2Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
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

/**
 * Populate the approval audit block when the configuration is in the
 * `approved` review state. Two DB reads:
 *   - latest approved snapshot for this config (gives version +
 *     authoritative approvedAt)
 *   - the approving user's `displayName` (preferred) or `name` (always
 *     populated per schema; `users.name` is NOT NULL varchar(200))
 *
 * Returns null unless ALL of the following hold:
 *   - config.reviewStatus === "approved"
 *   - at least one approved snapshot row exists
 *   - the approving user is still resolvable (row might be gone after
 *     a user deletion; we do not surface a stale stamp in that case —
 *     the sheet renders without an approval banner)
 *
 * The config's own `approvedAt` column mirrors the latest approval so
 * we prefer the snapshot's own timestamp — a user re-approving a new
 * version updates the snapshot but may race the config mirror.
 */
async function resolveApproval(
  db: Database,
  config: { id: string; reviewStatus: string },
): Promise<SheetApproval | null> {
  if (config.reviewStatus !== "approved") return null;

  const [snap] = await db.select({
    version: configurationSheetSnapshots.version,
    approvedAt: configurationSheetSnapshots.approvedAt,
    approvedBy: configurationSheetSnapshots.approvedBy,
  })
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, config.id),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  if (snap === undefined || snap.approvedAt === null || snap.approvedBy === null) {
    return null;
  }

  const [approver] = await db.select({
    name: users.name,
    displayName: users.displayName,
  })
    .from(users)
    .where(eq(users.id, snap.approvedBy))
    .limit(1);

  return buildSheetApproval(
    { version: snap.version, approvedAt: snap.approvedAt },
    approver ?? null,
  );
}

/**
 * Pure "snapshot row + approver row → SheetApproval | null" step.
 * Extracted out of `resolveApproval` so the null-handling contract
 * (deleted user, missing approver record) is unit-testable without a
 * DB. Matches the `parseStoredSnapshotPayload` split: the DB function
 * becomes I/O-only; the validation/build lives here.
 *
 * Returns null when the approver is null (user row deleted after
 * approval — we do not surface a stale stamp in that case; the sheet
 * renders without the approval banner).
 *
 * `approverName` prefers `displayName` but falls back to `name`, which
 * is `NOT NULL varchar(200)` in the schema so the fallback always
 * resolves to a real string.
 */
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
