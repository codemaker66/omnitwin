import { eq, ne, and, gte, lte, isNull, isNotNull, inArray, desc, asc } from "drizzle-orm";
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
  spaces, venues, configurationSheetSnapshots, users,
  bookings, eventConfigurationLinks, eventPhases, layoutVariants, turnaroundRules,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { REAL_METRE_COORDINATE_SPACE, type LayoutCoordinateSpace } from "../db/coordinate-space.js";
import { generateManifestV2, type ManifestObjectV2, type AccessoryRule } from "./manifest-generator-v2.js";
import { parseHallkeeperSnapshotPayload } from "./layout-coordinate-space.js";
import { buildHallkeeperFloorPlan, type FloorPlanAsset } from "./hallkeeper-floor-plan.js";
import { resolveTurnaroundRule } from "./calendar-conflicts.js";

// ---------------------------------------------------------------------------
// Hallkeeper Sheet V2 — data assembly
//
// Produces the HallkeeperSheetV2
// shape instead of the flat manifest. The v2 shape is phase/zone
// grouped with dependency ordering and stable keys — see
// @omnitwin/types/hallkeeper-v2.ts for the schema contract.
//
// Timing policy (Ship Friday, gate line 20): times come from the Diary and
// nowhere else. We resolve which event(s) this configuration belongs to,
// find the live booking that holds THIS room, and read `eventStart` from
// that booking's own window. `setupBy` is the earliest scheduled phase in
// the same room on the same day when one exists, otherwise the venue's own
// turnaround rule for that room and event type — resolved through the same
// `resolveTurnaroundRule` the calendar conflict rail enforces — and null
// when the venue has recorded neither. There is no house constant: the
// 90-minute buffer this file used to apply printed an hour a hallkeeper
// could set a room to and be wrong about, and looked identical on the page
// to a derived one. When no live booking holds the room we return null and
// the sheet/PDF say so — the sheet never invents an hour. The previous
// behaviour (an enquiry's preferredDate at a fixed 18:00 UTC) produced a
// time that agreed with nothing on the timetable.
//
// Which event (the `?eventId=` contract): the corridor carries the event a
// hallkeeper arrived from, and that event alone decides the hour when this
// configuration is linked to it. An id that parses but is NOT linked — a
// stale bookmark, a hand-edited query string — is ignored exactly as an
// unparseable one is, and the union of the configuration's own links
// applies; that union is what a sheet opened directly has always shown.
// ---------------------------------------------------------------------------


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
  /** The event the request came from, when the caller knows it. Scopes the
   *  sheet's times to that event rather than to the union of every event the
   *  layout is linked to. */
  requestedEventId: string | null = null,
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
  const timing = await resolveTiming(db, {
    id: config.id,
    spaceId: config.spaceId,
    venueId: config.venueId,
  }, requestedEventId);
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
  const [snap] = await db.select({
    payload: configurationSheetSnapshots.payload,
    coordinateSpace: configurationSheetSnapshots.coordinateSpace,
  })
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  if (snap === undefined) return null;
  return parseStoredSnapshotPayload(snap.payload, snap.coordinateSpace);
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
 * Pure "booked window + room phase + venue turnaround → Timing" step,
 * extracted so the arithmetic is unit-testable without a database.
 *
 * `eventStart` is the Diary booking's own start — never a default hour.
 *
 * `setupBy` has two honest sources and no invented third:
 *   1. the earliest scheduled phase in the SAME room on the SAME day, when it
 *      is earlier than the booking — the planner said when work begins, and
 *      that is more specific than any rule;
 *   2. otherwise the venue's turnaround rule for this room and event type,
 *      resolved through the same `resolveTurnaroundRule` the calendar conflict
 *      engine enforces, so the sheet cannot disagree with the conflict rail.
 *
 * When neither exists, `setupBy` and `bufferMinutes` are **null** and the
 * sheet and PDF say the set-up time is not set because the venue's turnaround
 * rules are not recorded. That is the same honesty the conflict rail shows
 * when it says "not checked". This function used to fall back to a hard-coded
 * 90 minutes, which printed an hour a hallkeeper could set a room to and be
 * wrong about — and which looked identical on the page to a derived one.
 *
 * `bufferMinutes` always reports the REAL gap, never the rule's nominal value,
 * so a phase-derived deadline cannot claim a buffer it does not have.
 *
 * Returns null for an unparseable instant rather than emitting "Invalid
 * Date" into a frozen snapshot.
 */
export function deriveSheetTiming(
  bookingStartsAt: Date,
  earliestRoomPhaseStartsAt: Date | null,
  turnaroundMinutes: number | null,
): Timing | null {
  const startMs = bookingStartsAt.getTime();
  if (!Number.isFinite(startMs)) return null;
  const eventStart = new Date(startMs).toISOString();

  const phaseMs = earliestRoomPhaseStartsAt === null ? null : earliestRoomPhaseStartsAt.getTime();
  const usablePhaseMs = phaseMs !== null && Number.isFinite(phaseMs) && phaseMs < startMs
    ? phaseMs
    : null;
  const ruleMs = turnaroundMinutes !== null && Number.isFinite(turnaroundMinutes) && turnaroundMinutes >= 0
    ? startMs - turnaroundMinutes * 60_000
    : null;
  const setupMs = usablePhaseMs ?? ruleMs;

  if (setupMs === null) return { eventStart, setupBy: null, bufferMinutes: null };

  return {
    eventStart,
    setupBy: new Date(setupMs).toISOString(),
    bufferMinutes: Math.max(0, Math.round((startMs - setupMs) / 60_000)),
  };
}

/**
 * Every event this configuration is attached to: explicit event links and
 * non-archived layout variants. Both are event-owned references, so a
 * configuration that was never linked to an event yields no booking and
 * therefore no timing.
 */
async function linkedEventIds(db: Database, configId: string): Promise<string[]> {
  const [links, variants] = await Promise.all([
    db.select({ eventId: eventConfigurationLinks.eventId })
      .from(eventConfigurationLinks)
      .where(eq(eventConfigurationLinks.configurationId, configId)),
    db.select({ eventId: layoutVariants.eventId })
      .from(layoutVariants)
      .where(and(
        eq(layoutVariants.configurationId, configId),
        ne(layoutVariants.status, "archived"),
      )),
  ]);
  return [...new Set([...links, ...variants].map((row) => row.eventId))];
}

/**
 * Resolve the sheet's times from the Diary: configuration → linked event(s)
 * → the live booking that holds this configuration's room in this venue.
 *
 * `requestedEventId` narrows that to a single event when this configuration
 * is linked to it, and is ignored otherwise — the contract is spelled out on
 * the branch below.
 *
 * Prospect bookings (the sales pipeline) and released/cancelled rows are
 * excluded — a hallkeeper preps rooms for things that are actually
 * happening. If nothing holds the room we return null; the sheet and PDF
 * then say the event is not scheduled rather than printing a fabricated
 * hour a hallkeeper could set a room to.
 */
export async function resolveTiming(
  db: Database,
  config: { readonly id: string; readonly spaceId: string; readonly venueId: string },
  requestedEventId: string | null = null,
): Promise<Timing | null> {
  // A layout can be reused across events. When the caller knows which event
  // the hallkeeper arrived from — the corridor carries it as ?eventId= — that
  // event alone decides the hour, PROVIDED this configuration is linked to
  // it. An id that parses but is not linked (a stale bookmark, a hand-edited
  // query string) is ignored rather than trusted: trusted verbatim it printed
  // a DIFFERENT event's hour whenever that event happened to hold the same
  // room in the same venue, and blanked the times of a perfectly scheduled
  // sheet when it did not. Both cases fall back to the union of this
  // configuration's own links — the same answer a sheet opened directly
  // gives — and the union stays a guess the caller should avoid making by
  // carrying the event.
  const linkedIds = await linkedEventIds(db, config.id);
  const eventIds = requestedEventId !== null && linkedIds.includes(requestedEventId)
    ? [requestedEventId]
    : linkedIds;
  if (eventIds.length === 0) return null;

  const [booking] = await db.select({ startsAt: bookings.startsAt, eventType: bookings.eventType })
    .from(bookings)
    .where(and(
      inArray(bookings.eventId, eventIds),
      eq(bookings.spaceId, config.spaceId),
      eq(bookings.venueId, config.venueId),
      eq(bookings.status, "active"),
      ne(bookings.kind, "prospect"),
      isNull(bookings.deletedAt),
    ))
    .orderBy(asc(bookings.startsAt))
    .limit(1);

  if (booking === undefined) return null;

  // Bound the phase search to the booking's own day. Without it the earliest
  // phase of a multi-day event — or of another event sharing the layout —
  // became this sheet's set-up deadline, and `bufferMinutes` reported
  // thousands of minutes as though that were a real buffer.
  const dayStart = new Date(booking.startsAt.getTime() - 24 * 60 * 60_000);
  const [phase] = await db.select({ startsAt: eventPhases.startsAt })
    .from(eventPhases)
    .where(and(
      inArray(eventPhases.eventId, eventIds),
      eq(eventPhases.spaceId, config.spaceId),
      isNotNull(eventPhases.startsAt),
      gte(eventPhases.startsAt, dayStart),
      lte(eventPhases.startsAt, booking.startsAt),
    ))
    .orderBy(asc(eventPhases.startsAt))
    .limit(1);

  const rules = await db.select({
    name: turnaroundRules.name,
    spaceId: turnaroundRules.spaceId,
    eventType: turnaroundRules.eventType,
    minutes: turnaroundRules.minutes,
    isActive: turnaroundRules.isActive,
  })
    .from(turnaroundRules)
    .where(and(
      eq(turnaroundRules.venueId, config.venueId),
      isNull(turnaroundRules.deletedAt),
    ));

  const rule = resolveTurnaroundRule(rules, config.spaceId, booking.eventType);

  return deriveSheetTiming(booking.startsAt, phase?.startsAt ?? null, rule?.minutes ?? null);
}
