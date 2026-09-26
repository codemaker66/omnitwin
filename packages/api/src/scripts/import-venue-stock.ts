import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getCanonicalAssetBySlug, type InventoryActor } from "@omnitwin/types";
import { createDbConnection } from "../db/client.js";
import { writeVenueInventory } from "../services/venue-inventory.js";

// ---------------------------------------------------------------------------
// Import Trades Hall's counted equipment into venue inventory.
//
// The venue supplied an equipment document on 5 September 2026; its normalised
// intake is the JSON this script reads. Nothing in that file is an inventory
// record — it is a transcription, with blanks, overlapping groups and unit
// ambiguities left visible on purpose. This script turns the part of it that
// IS unambiguous into stock adjustments, and refuses to guess about the rest.
//
// Three rules it will not break:
//
//   1. Every write goes through writeVenueInventory, the same audited path the
//      dashboard uses. Each produces a receipt carrying the actor, the reason
//      and the before/after counts. There is no bulk INSERT here.
//   2. A reported physical quantity is not a usable quantity. The source
//      establishes no damage and no unavailability, so both are written as
//      zero — "none recorded" — and the reason says so. The 20 damaged and
//      190 reserved figures that circulated in design fixtures are not venue
//      facts and appear nowhere in this file.
//   3. A source record with no confirmed count, or with no catalogue identity
//      to record it against, is SKIPPED and listed. Inventing an identity or
//      adding overlapping groups together would manufacture a venue fact.
//
// Dry run is the default and needs no database. Applying requires --apply and
// --backup-branch together: the backup identifier is recorded in the plan so
// the receipt trail says what could be restored.
//
//   Dry run (offline):
//     pnpm --filter @omnitwin/api exec tsx src/scripts/import-venue-stock.ts \
//       --source <intake>.json --venue <venue uuid> --actor <admin user uuid> \
//       --reason "initial intake 2026-09-05" --plan-out plan.json
//
//   Apply (after the backup branch exists):
//     … --database-url "$DATABASE_URL" --apply --backup-branch <branch id>
// ---------------------------------------------------------------------------

/** UUID v5 namespace shared with the catalogue, so command ids are derivable. */
const OMNITWIN_NAMESPACE = "43033bd6-17fd-599e-b305-0bd60dec57f0";

const EquipmentRecordSchema = z.object({
  source_record_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  reported_quantity: z.number().int().nonnegative().nullable(),
  quantity_status: z.string().min(1),
  storage_location: z.string().min(1).nullable().optional(),
}).passthrough();

export const EquipmentIntakeSchema = z.object({
  record_kind: z.string().min(1),
  received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  equipment_records: z.array(EquipmentRecordSchema).min(1),
}).passthrough();

export type EquipmentIntake = z.infer<typeof EquipmentIntakeSchema>;

/**
 * Source record to catalogue slug. Written out one line at a time rather than
 * matched by name, because a fuzzy match between "6 ft trestle" and some
 * catalogue entry is exactly the kind of guess that puts a wrong count against
 * the wrong item. A source record absent from this table is not imported.
 *
 * The omissions are deliberate and each has a reason:
 *   - No catalogue identity exists yet: booster seat, flipcharts, the portable
 *     PA, the 5ft/3ft round, metal, 7ft, halfmoon and café tables, the gallery
 *     brown trestle, the Robert Adam tables, every décor line, every linen
 *     line and both chair covers.
 *   - The count is unresolved in the source: the unquantified main-room
 *     chairs, the candelabra/hurricane line, the easel total, the green and
 *     white main linen.
 *   - The catalogue cannot express a distinction the venue counts: tall and
 *     small microphone stands are two source records against one "Mic Stand"
 *     identity, and adding them together would invent a pooled count.
 */
export const SOURCE_TO_CATALOGUE_SLUG: Readonly<Record<string, string>> = {
  "chiavari-wedding-chair": "chiavari-chair",
  "chair-red-gold-gallery": "gallery-chair-red-gold",
  "chair-pink": "pink-chair",
  "chair-checked": "checked-banquet-chair",
  "highchair-white": "highchair-white",
  "highchair-green": "highchair-green",
  "highchair-blue": "highchair-blue",
  "highchair-wooden": "highchair-wooden",
  "round-6ft": "round-table-6ft",
  "trestle-6ft": "trestle-6ft",
  "trestle-4ft": "trestle-4ft",
  "poseur-table": "poseur-table",
  "projector": "projector",
  "projection-screen": "projector-screen",
  "laptop": "laptop",
  "handheld-mic": "handheld-microphone",
  "lapel-mic": "lapel-microphone",
  "hisense-tv": "hisense-television",
  "stage-panel-6x4": "staging-deck-6x4",
  "stage-panel-6x3": "staging-deck-6x3",
};

export interface PlannedAdjustment {
  readonly sourceRecordId: string;
  readonly sourceName: string;
  readonly catalogueSlug: string;
  readonly assetDefinitionId: string;
  readonly commandId: string;
  readonly ownedQuantity: number;
  readonly damagedQuantity: 0;
  readonly unavailableQuantity: 0;
  readonly storageLocation: string | null;
  readonly status: "active";
  readonly reason: string;
}

export interface SkippedRecord {
  readonly sourceRecordId: string;
  readonly sourceName: string;
  readonly reason: "no_catalogue_identity" | "no_confirmed_quantity" | "unknown_catalogue_slug";
  readonly detail: string;
}

export interface StockImportPlan {
  readonly venueId: string;
  readonly actorUserId: string;
  readonly reason: string;
  readonly sourceReceivedOn: string;
  readonly sourceRecordCount: number;
  readonly adjustments: readonly PlannedAdjustment[];
  readonly skipped: readonly SkippedRecord[];
}

/** Deterministic UUID v5, so re-running an import replays rather than doubles. */
export function deterministicUuid(name: string, namespace = OMNITWIN_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(Buffer.concat([namespaceBytes, Buffer.from(name, "utf8")])).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

export interface PlanOptions {
  readonly venueId: string;
  readonly actorUserId: string;
  readonly reason: string;
}

/**
 * Turn the intake into an adjustment plan. Pure: no database, no clock, no
 * network — the same intake always yields the same plan, including its command
 * ids, which is what makes a re-run replay instead of double-counting.
 */
export function planStockImport(intake: EquipmentIntake, options: PlanOptions): StockImportPlan {
  const adjustments: PlannedAdjustment[] = [];
  const skipped: SkippedRecord[] = [];

  for (const record of intake.equipment_records) {
    const slug = SOURCE_TO_CATALOGUE_SLUG[record.source_record_id];
    if (slug === undefined) {
      skipped.push({
        sourceRecordId: record.source_record_id, sourceName: record.name,
        reason: "no_catalogue_identity",
        detail: "No catalogue item represents this record; recording stock would need an identity that does not exist.",
      });
      continue;
    }
    const asset = getCanonicalAssetBySlug(slug);
    if (asset === undefined) {
      skipped.push({
        sourceRecordId: record.source_record_id, sourceName: record.name,
        reason: "unknown_catalogue_slug",
        detail: `This mapping points at "${slug}", which is not in the canonical catalogue.`,
      });
      continue;
    }
    if (record.reported_quantity === null) {
      skipped.push({
        sourceRecordId: record.source_record_id, sourceName: record.name,
        reason: "no_confirmed_quantity",
        detail: `The source records status "${record.quantity_status}" with no quantity.`,
      });
      continue;
    }
    adjustments.push({
      sourceRecordId: record.source_record_id,
      sourceName: record.name,
      catalogueSlug: slug,
      assetDefinitionId: asset.id,
      // Scoped to venue, item and reason, so the same import replays and a
      // deliberately different import (a new reason) is a new command.
      commandId: deterministicUuid(`stock-import:${options.venueId}:${asset.id}:${options.reason}`),
      ownedQuantity: record.reported_quantity,
      damagedQuantity: 0,
      unavailableQuantity: 0,
      storageLocation: record.storage_location ?? null,
      status: "active",
      reason: options.reason,
    });
  }

  return {
    venueId: options.venueId,
    actorUserId: options.actorUserId,
    reason: options.reason,
    sourceReceivedOn: intake.received_on,
    sourceRecordCount: intake.equipment_records.length,
    adjustments,
    skipped,
  };
}

export function renderPlan(plan: StockImportPlan): string {
  const lines = [
    `Venue stock import plan (source received ${plan.sourceReceivedOn})`,
    `  source records: ${String(plan.sourceRecordCount)}`,
    `  to record:      ${String(plan.adjustments.length)}`,
    `  skipped:        ${String(plan.skipped.length)}`,
    `  reason:         ${plan.reason}`,
    "",
    "Recorded as owned (damaged and unavailable are written as zero — the",
    "source establishes neither; it reports physical counts only):",
  ];
  for (const adjustment of plan.adjustments) {
    lines.push(`  ${String(adjustment.ownedQuantity).padStart(4)} x ${adjustment.sourceName} -> ${adjustment.catalogueSlug}`);
  }
  lines.push("", "Not recorded:");
  for (const record of plan.skipped) {
    lines.push(`  - ${record.sourceName} (${record.reason}): ${record.detail}`);
  }
  return lines.join("\n");
}

export interface ApplyOutcome {
  readonly assetDefinitionId: string;
  readonly catalogueSlug: string;
  readonly revision: number;
  readonly replayed: boolean;
}

/**
 * Execute the plan through the audited adjustment service, one command at a
 * time. Each write is its own transaction and its own receipt: a failure
 * partway through leaves the earlier receipts standing, which is the honest
 * outcome for a physical count, and a re-run replays them rather than adding
 * the same stock twice.
 *
 * `onOutcome` fires as each receipt lands, not at the end. The realistic
 * failure here is an INVENTORY_REVISION_CONFLICT on an item somebody already
 * counted by hand, and it arrives partway down the list. Returning the array
 * only on success meant a throw on item n printed "Stock import failed" and
 * nothing about the n-1 receipts already written — at Friday 16:30, against
 * production, that is the worst possible moment to have to reconstruct what
 * happened from the database.
 */
export async function applyStockImport(
  db: Parameters<typeof writeVenueInventory>[0],
  actor: InventoryActor,
  plan: StockImportPlan,
  onOutcome: (outcome: ApplyOutcome) => void = () => undefined,
): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];
  for (const adjustment of plan.adjustments) {
    const response = await writeVenueInventory(db, actor, {
      commandId: adjustment.commandId,
      venueId: plan.venueId,
      assetDefinitionId: adjustment.assetDefinitionId,
      expectedRevision: null,
      ownedQuantity: adjustment.ownedQuantity,
      damagedQuantity: adjustment.damagedQuantity,
      unavailableQuantity: adjustment.unavailableQuantity,
      hires: [],
      storageLocation: adjustment.storageLocation,
      status: adjustment.status,
      reason: adjustment.reason,
    });
    const outcome: ApplyOutcome = {
      assetDefinitionId: adjustment.assetDefinitionId,
      catalogueSlug: adjustment.catalogueSlug,
      revision: response.data.stock.revision,
      replayed: response.data.replayed,
    };
    outcomes.push(outcome);
    onOutcome(outcome);
  }
  return outcomes;
}

export interface CliOptions {
  readonly source: string;
  readonly venueId: string;
  readonly actorUserId: string;
  readonly reason: string;
  readonly planOut: string | null;
  readonly databaseUrl: string | null;
  readonly apply: boolean;
  readonly backupBranch: string | null;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--apply") { apply = true; continue; }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
    values.set(token.slice(2), value);
    index += 1;
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (value === undefined || value.trim().length === 0) throw new Error(`--${key} is required`);
    return value.trim();
  };
  const backupBranch = values.get("backup-branch")?.trim() ?? null;
  if (apply && (backupBranch === null || backupBranch.length === 0)) {
    // A stock import changes what the venue believes it owns. Without a
    // restorable point there is nothing to compare the receipts against.
    throw new Error("--apply requires --backup-branch <id>: record the backup before writing stock");
  }
  const databaseUrl = values.get("database-url")?.trim() ?? null;
  if (apply && databaseUrl === null) throw new Error("--apply requires --database-url");
  return {
    source: required("source"),
    venueId: required("venue"),
    actorUserId: required("actor"),
    reason: required("reason"),
    planOut: values.get("plan-out")?.trim() ?? null,
    databaseUrl,
    apply,
    backupBranch,
  };
}

export async function readIntake(path: string): Promise<EquipmentIntake> {
  const raw: unknown = JSON.parse(await readFile(resolve(path), "utf8"));
  return EquipmentIntakeSchema.parse(raw);
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  return resolve(entrypoint) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const intake = await readIntake(options.source);
  const plan = planStockImport(intake, {
    venueId: options.venueId, actorUserId: options.actorUserId, reason: options.reason,
  });
  process.stdout.write(`${renderPlan(plan)}\n`);
  if (options.planOut !== null) {
    await writeFile(resolve(options.planOut),
      `${JSON.stringify({ ...plan, backupBranch: options.backupBranch }, null, 2)}\n`, "utf8");
    process.stdout.write(`\nPlan written to ${options.planOut}\n`);
  }
  if (!options.apply || options.databaseUrl === null) {
    process.stdout.write("\nDRY RUN — nothing was written. Add --apply --backup-branch <id> to record it.\n");
    return;
  }
  const connection = createDbConnection(options.databaseUrl);
  let recorded = 0;
  try {
    const actor: InventoryActor = { userId: options.actorUserId, role: "admin", venueId: options.venueId };
    // Print each receipt the moment it lands. If item n throws, the operator
    // still has the list of the n-1 already written, on screen, in order.
    const outcomes = await applyStockImport(connection.db, actor, plan, (outcome) => {
      recorded += 1;
      process.stdout.write(
        `  [${String(recorded)}/${String(plan.adjustments.length)}] recorded ${outcome.catalogueSlug}`
        + ` at revision ${String(outcome.revision)}${outcome.replayed ? " (replay)" : ""}\n`);
    });
    process.stdout.write(`\nRecorded ${String(outcomes.length)} item(s) against backup ${options.backupBranch ?? "unknown"}.\n`);
  } catch (error) {
    // Say what stands before the failure propagates, so the operator does not
    // have to reconstruct it from the database mid-window.
    process.stdout.write(
      `\nSTOPPED after ${String(recorded)} of ${String(plan.adjustments.length)} item(s).`
      + ` Those receipts are written and a re-run replays them rather than counting twice.\n`);
    throw error;
  } finally {
    await connection.close();
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Stock import failed: ${message}\n`);
    process.exitCode = 1;
  });
}
