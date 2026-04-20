import { eq, and, desc, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  ConfigurationMetadataSchema,
  type ConfigurationMetadata,
  type ConfigurationSheetSnapshot,
  type HallkeeperSheetV2,
  type SetupPhase,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  configurations,
  configurationSheetSnapshots,
  configurationReviewHistory,
  placedObjects,
  assetDefinitions,
  assetAccessories,
  spaces,
} from "../db/schema.js";
import { extractEventSheet, type ExtractionInput } from "./event-sheet-extractor.js";
import { assembleSheetDataV2 } from "./hallkeeper-sheet-v2-data.js";
import type {
  AccessoryRule,
  AccessoryMap,
  ManifestObjectV2,
} from "./manifest-generator-v2.js";

// ---------------------------------------------------------------------------
// Sheet Snapshot Service — the immutability boundary between the live
// configuration and the hallkeeper's view.
//
// Every write on this table represents a specific attempt by a planner
// to submit their config for review. The row captures:
//
//   - the full HallkeeperSheetV2 payload at that moment (for read)
//   - a sha256 sourceHash of the canonicalised extraction input
//     (for idempotency — re-submitting the same layout is a no-op)
//   - version + timestamps + the acting user
//
// Approval denormalises `approved_at` / `approved_by` back onto the
// configurations row so hot-path queries ("latest approved sheet for
// this config?") don't need a JOIN.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error types — structured so route handlers can map to HTTP codes.
// ---------------------------------------------------------------------------

export class ConfigurationNotFoundError extends Error {
  public readonly code = "CONFIGURATION_NOT_FOUND";
  constructor(public readonly configId: string) {
    super(`Configuration not found: ${configId}`);
    this.name = "ConfigurationNotFoundError";
  }
}

export class SnapshotNotFoundError extends Error {
  public readonly code = "SNAPSHOT_NOT_FOUND";
  constructor(public readonly snapshotId: string) {
    super(`Snapshot not found: ${snapshotId}`);
    this.name = "SnapshotNotFoundError";
  }
}

export class SnapshotAlreadyApprovedError extends Error {
  public readonly code = "SNAPSHOT_ALREADY_APPROVED";
  constructor(public readonly snapshotId: string) {
    super(`Snapshot already approved: ${snapshotId}`);
    this.name = "SnapshotAlreadyApprovedError";
  }
}

/**
 * Raised when two concurrent submits both try to insert the same next
 * version for a configuration. The `UNIQUE(configuration_id, version)`
 * constraint in migration 0013 rejects the loser; we catch the
 * Postgres 23505 and surface this typed error so the route returns 409
 * instead of a 500 that leaks the constraint name.
 */
export class SnapshotConflictError extends Error {
  public readonly code = "SNAPSHOT_CONFLICT";
  constructor(public readonly configId: string) {
    super(`Snapshot version conflict for configuration: ${configId}`);
    this.name = "SnapshotConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Duck-type check for a Postgres unique-constraint violation. Exported
 * so unit tests can pin the 23505 contract without a real DB — the
 * neondatabase/serverless driver is the nominal producer, but any
 * `pg`-style adapter that sets `err.code` on constraint violations
 * hits the same branch.
 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object"
    && err !== null
    && "code" in err
    && (err as { code: unknown }).code === PG_UNIQUE_VIOLATION;
}

// ---------------------------------------------------------------------------
// Row → domain hydration
// ---------------------------------------------------------------------------

type SnapshotRow = typeof configurationSheetSnapshots.$inferSelect;

function hydrateSnapshotRow(row: SnapshotRow): ConfigurationSheetSnapshot {
  return {
    id: row.id,
    configurationId: row.configurationId,
    version: row.version,
    payload: row.payload as HallkeeperSheetV2,
    diagramUrl: row.diagramUrl,
    pdfUrl: row.pdfUrl,
    sourceHash: row.sourceHash,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
    approvedBy: row.approvedBy,
  };
}

// ---------------------------------------------------------------------------
// Load ExtractionInput — the minimal DB read needed to compute
// sourceHash. Runs alongside assembleSheetDataV2 which loads the same
// tables to build the full payload. The two loaders are intentionally
// NOT DRY-merged in this pass because assembleSheetDataV2 is tested +
// stable and a refactor would widen the blast radius of this feature.
// Noted as cleanup candidate for Phase 2 review.
// ---------------------------------------------------------------------------

async function loadExtractionInputs(
  db: Database,
  configId: string,
): Promise<ExtractionInput | null> {
  const [config] = await db.select()
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;

  const [space] = await db.select()
    .from(spaces)
    .where(eq(spaces.id, config.spaceId))
    .limit(1);
  if (space === undefined) return null;

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

  const placements: ManifestObjectV2[] = objects.map((obj) => {
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

  const accessoryMap: AccessoryMap = (() => {
    const m = new Map<string, AccessoryRule[]>();
    for (const row of accessoryRows) {
      let list = m.get(row.parentName);
      if (list === undefined) {
        list = [];
        m.set(row.parentName, list);
      }
      list.push({
        name: row.name,
        category: row.category,
        quantityPerParent: row.quantityPerParent,
        phase: row.phase as SetupPhase,
        afterDepth: row.afterDepth,
      });
    }
    return m;
  })();

  const metadata: ConfigurationMetadata | null = (() => {
    if (config.metadata === null) return null;
    const parsed = ConfigurationMetadataSchema.safeParse(config.metadata);
    return parsed.success ? parsed.data : null;
  })();

  return {
    placements,
    accessoryMap,
    metadata,
    room: {
      widthM: Number(space.widthM),
      lengthM: Number(space.lengthM),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API — createSnapshot
//
// Idempotent semantics: if the latest snapshot's sourceHash equals the
// just-computed hash, we return that row with `created: false`. The
// route handler uses the flag to decide whether to write a history
// row + send a "submitted" email (it should NOT for a no-op re-submit).
//
// Race-condition window: between the latest-read and the insert, a
// concurrent submit could land. The UNIQUE(configuration_id, version)
// constraint will then reject the second insert. Currently we surface
// that as a 500; a retry loop is a Phase 2 polish item.
// ---------------------------------------------------------------------------

export interface CreateSnapshotInput {
  readonly configId: string;
  readonly createdBy: string | null;
  readonly baseUrl: string;
}

export interface CreateSnapshotResult {
  readonly snapshot: ConfigurationSheetSnapshot;
  readonly created: boolean;
}

export async function createSnapshot(
  db: Database,
  input: CreateSnapshotInput,
): Promise<CreateSnapshotResult> {
  const [extractionInputs, payloadResult] = await Promise.all([
    loadExtractionInputs(db, input.configId),
    assembleSheetDataV2(db, input.configId, input.baseUrl),
  ]);

  if (extractionInputs === null || payloadResult === null) {
    throw new ConfigurationNotFoundError(input.configId);
  }

  const extraction = extractEventSheet(extractionInputs);

  const [latest] = await db.select()
    .from(configurationSheetSnapshots)
    .where(eq(configurationSheetSnapshots.configurationId, input.configId))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  if (latest !== undefined && latest.sourceHash === extraction.sourceHash) {
    return { snapshot: hydrateSnapshotRow(latest), created: false };
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  let inserted;
  try {
    [inserted] = await db.insert(configurationSheetSnapshots).values({
      configurationId: input.configId,
      version: nextVersion,
      payload: payloadResult.payload,
      diagramUrl: payloadResult.payload.diagramUrl,
      pdfUrl: null,
      sourceHash: extraction.sourceHash,
      createdBy: input.createdBy,
    }).returning();
  } catch (err) {
    // Concurrent-submit race: two requests both read `latest.version = N`
    // and both try to insert `N+1`. The UNIQUE(configuration_id, version)
    // constraint rejects the loser. Map to a typed 409 so the route
    // doesn't return a 500 exposing the constraint name / internals.
    if (isUniqueViolation(err)) {
      throw new SnapshotConflictError(input.configId);
    }
    throw err;
  }

  if (inserted === undefined) {
    throw new Error("Snapshot insertion returned no row");
  }

  return { snapshot: hydrateSnapshotRow(inserted), created: true };
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

export async function getLatestSnapshot(
  db: Database,
  configId: string,
): Promise<ConfigurationSheetSnapshot | null> {
  const [row] = await db.select()
    .from(configurationSheetSnapshots)
    .where(eq(configurationSheetSnapshots.configurationId, configId))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);
  return row === undefined ? null : hydrateSnapshotRow(row);
}

export async function getLatestApprovedSnapshot(
  db: Database,
  configId: string,
): Promise<ConfigurationSheetSnapshot | null> {
  const [row] = await db.select()
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);
  return row === undefined ? null : hydrateSnapshotRow(row);
}

export async function getSnapshotByVersion(
  db: Database,
  configId: string,
  version: number,
): Promise<ConfigurationSheetSnapshot | null> {
  const [row] = await db.select()
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      eq(configurationSheetSnapshots.version, version),
    ))
    .limit(1);
  return row === undefined ? null : hydrateSnapshotRow(row);
}

// ---------------------------------------------------------------------------
// Retention — `pruneSnapshotsForConfig`
//
// Submit-heavy configs accumulate snapshot rows over time (each submit
// that produces a different source hash inserts a new version). Once a
// config is `archived`, older versions stop being operationally useful:
// the hallkeeper has finished the event, the audit anchor is the
// latest approved row, and the re-review case is moot.
//
// Retention policy (kept narrow on purpose so operators understand it):
//   - KEEP the most-recent APPROVED snapshot. That is the audit
//     anchor — the row a hallkeeper operated against. Never prune it
//     even if older than the retention window.
//   - KEEP the N most-recent snapshots by version. Covers the case
//     where a staff member comparing two recent drafts wants to see
//     what changed between them.
//   - DELETE everything else.
//
// The decision logic is a pure function (`computeSnapshotsToKeep`)
// so it can be unit-tested without a DB. The DB wrapper is thin.
//
// Safety: this function is IDEMPOTENT and ORDER-INDEPENDENT — running
// it twice is a no-op on the second run.  Approval mirror on the
// configurations row is NOT touched, so the denormalised
// `approved_at` / `approved_by` survive a pruning of older approved
// rows that are no longer the latest.
// ---------------------------------------------------------------------------

export interface SnapshotRetentionResult {
  readonly deleted: number;
  readonly kept: number;
}

/**
 * Default retention count when no explicit value is passed.
 * Chosen to cover:
 *   - The approved snapshot itself (audit anchor, always kept).
 *   - One "current draft under review" version.
 *   - One "prior draft" for staff-side comparison ("what changed?").
 */
export const DEFAULT_SNAPSHOT_RETENTION = 3;

/**
 * Pure decision logic. Returns the set of snapshot IDs to KEEP given
 * the current rows for a single config. Exported for direct unit
 * testing — the DB wrapper below composes with this plus a delete.
 */
export function computeSnapshotsToKeep(
  rows: readonly {
    readonly id: string;
    readonly version: number;
    readonly approvedAt: Date | null;
  }[],
  keep: number,
): ReadonlySet<string> {
  if (keep < 1) {
    throw new Error(`Retention count must be >= 1, got ${String(keep)}`);
  }

  const sortedByVersion = [...rows].sort((a, b) => b.version - a.version);
  const kept = new Set<string>();

  // Rule 1: the N most-recent by version (any approval status).
  for (let i = 0; i < Math.min(keep, sortedByVersion.length); i += 1) {
    const row = sortedByVersion[i];
    if (row !== undefined) kept.add(row.id);
  }

  // Rule 2: the latest approved snapshot — even if it falls outside
  // the recency window. Find by scanning the version-sorted array.
  const latestApproved = sortedByVersion.find((r) => r.approvedAt !== null);
  if (latestApproved !== undefined) kept.add(latestApproved.id);

  return kept;
}

/**
 * Delete non-retained snapshots for a single configuration.
 *
 * Two-step: read the rows, compute the keep-set via the pure helper,
 * then bulk-delete the complement. We avoid a single "DELETE WHERE
 * NOT IN (latest 3)" SQL expression because the composite policy
 * (latest approved OR latest 3) doesn't translate cleanly without a
 * self-join or CTE and the row count is small per config.
 */
export async function pruneSnapshotsForConfig(
  db: Database,
  configId: string,
  keep: number = DEFAULT_SNAPSHOT_RETENTION,
): Promise<SnapshotRetentionResult> {
  const rows = await db.select({
    id: configurationSheetSnapshots.id,
    version: configurationSheetSnapshots.version,
    approvedAt: configurationSheetSnapshots.approvedAt,
  })
    .from(configurationSheetSnapshots)
    .where(eq(configurationSheetSnapshots.configurationId, configId));

  if (rows.length === 0) return { deleted: 0, kept: 0 };

  const toKeep = computeSnapshotsToKeep(rows, keep);
  const toDelete = rows
    .filter((r) => !toKeep.has(r.id))
    .map((r) => r.id);

  if (toDelete.length === 0) return { deleted: 0, kept: toKeep.size };

  await db.delete(configurationSheetSnapshots)
    .where(inArray(configurationSheetSnapshots.id, toDelete));

  return { deleted: toDelete.length, kept: toKeep.size };
}

/**
 * Apply retention across EVERY configuration whose `review_status` is
 * `archived`. Post-event cleanup — once the event has run, older
 * snapshots become audit-only and can be pruned to the retention
 * window. Returns aggregated counts.
 *
 * Non-archived configs are NEVER touched by this function, so running
 * it safely co-exists with in-flight approvals and active hallkeeper
 * sessions. For a more aggressive "prune everything older than N
 * days" policy, compose multiple calls at the operator level rather
 * than layering policies inside this service.
 */
export async function pruneArchivedConfigSnapshots(
  db: Database,
  keep: number = DEFAULT_SNAPSHOT_RETENTION,
): Promise<SnapshotRetentionResult> {
  const archivedConfigs = await db.select({ id: configurations.id })
    .from(configurations)
    .where(eq(configurations.reviewStatus, "archived"));

  let totalDeleted = 0;
  let totalKept = 0;
  for (const c of archivedConfigs) {
    const result = await pruneSnapshotsForConfig(db, c.id, keep);
    totalDeleted += result.deleted;
    totalKept += result.kept;
  }
  return { deleted: totalDeleted, kept: totalKept };
}

// ---------------------------------------------------------------------------
// Approval — updates the snapshot row and denormalises to configurations.
//
// Race-safe via the `isNull(approvedAt)` WHERE clause: only one UPDATE
// can possibly win. A concurrent approve on an already-approved row
// returns zero rows and raises SnapshotAlreadyApprovedError. The
// configurations-row update happens after the snapshot update succeeds
// — if THAT update fails (shouldn't outside infra failure), the
// snapshot is approved but the denormalised fields on configurations
// lag. A periodic reconciliation job can detect + fix this; for now
// we let it self-heal on the next approval.
// ---------------------------------------------------------------------------

export async function approveSnapshot(
  db: Database,
  snapshotId: string,
  approvedBy: string,
): Promise<ConfigurationSheetSnapshot> {
  const now = new Date();

  // CONSISTENCY BOUNDARY: approving a snapshot touches TWO rows:
  //   - the snapshot row (source of truth for `approvedAt`)
  //   - the configurations row (denormalised mirror for hot-path
  //     "is this config approved?" queries)
  //
  // If we updated the snapshot then crashed/failed before the
  // mirror update, the hallkeeper sheet would serve the approved
  // snapshot but `config.reviewStatus` would still say `submitted`
  // — the UI shows conflicting state and middleware that gates on
  // `reviewStatus` mis-classifies the config. Wrapping both writes
  // in a transaction removes that window entirely.
  //
  // Race-safety against concurrent approves is still provided by
  // the `isNull(approvedAt)` predicate on the snapshot UPDATE —
  // only one transaction can flip it; others see row === undefined
  // and throw SnapshotAlreadyApprovedError cleanly.
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(configurationSheetSnapshots)
      .set({ approvedAt: now, approvedBy })
      .where(and(
        eq(configurationSheetSnapshots.id, snapshotId),
        isNull(configurationSheetSnapshots.approvedAt),
      ))
      .returning();

    if (updated === undefined) {
      const [existing] = await tx.select()
        .from(configurationSheetSnapshots)
        .where(eq(configurationSheetSnapshots.id, snapshotId))
        .limit(1);
      if (existing === undefined) {
        throw new SnapshotNotFoundError(snapshotId);
      }
      throw new SnapshotAlreadyApprovedError(snapshotId);
    }

    await tx.update(configurations)
      .set({ approvedAt: now, approvedBy, reviewStatus: "approved" })
      .where(eq(configurations.id, updated.configurationId));

    return updated;
  });

  return hydrateSnapshotRow(row);
}

// ---------------------------------------------------------------------------
// History — append a row to configuration_review_history. Called by
// the route layer after every successful state transition.
// ---------------------------------------------------------------------------

export interface AppendHistoryInput {
  readonly configurationId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly changedBy: string | null;
  readonly note: string | null;
}

export async function appendReviewHistory(
  db: Database,
  input: AppendHistoryInput,
): Promise<void> {
  await db.insert(configurationReviewHistory).values({
    configurationId: input.configurationId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    changedBy: input.changedBy,
    note: input.note,
  });
}
