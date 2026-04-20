import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { UserIdSchema } from "./user.js";
import { HallkeeperSheetV2Schema } from "./hallkeeper-v2.js";

// ---------------------------------------------------------------------------
// Configuration Sheet Snapshot — the immutability boundary between the
// live configuration (mutable, planner-driven) and the sheet the
// hallkeeper sees (frozen at approval time).
//
// Flow:
//
//   1. Planner clicks "Submit for approval" in the editor.
//   2. Server runs the extraction pipeline (placed furniture → manifest
//      + implicit equipment requirements + accessibility callouts).
//   3. Server canonicalises the extraction input and computes a sha256
//      `sourceHash`.
//   4. Server upserts a snapshot row:
//        - if the hash equals the latest snapshot for this config,
//          return that row unchanged (idempotent re-submit — no wasted
//          work, no approval discarded)
//        - otherwise insert a new row with version = max(version) + 1
//   5. Server transitions review_status to `submitted`.
//
// Approval:
//   - Snapshot row gets `approvedAt` / `approvedBy` populated.
//   - Configurations row denormalises the same columns for the hot
//     "latest approved snapshot" query.
//
// Post-approval planner edits DO NOT mutate the snapshot. The planner
// must re-submit to create a new version; staff must re-approve it.
// The editor surfaces a "snapshot diverges from live" banner when this
// state exists.
// ---------------------------------------------------------------------------

export const ConfigurationSheetSnapshotIdSchema = z.string().uuid();
export type ConfigurationSheetSnapshotId = z.infer<
  typeof ConfigurationSheetSnapshotIdSchema
>;

/**
 * A sha256 hex digest — 64 characters, lowercase [0-9a-f]. Anchored
 * regex keeps the validation O(1) and rejects case-mixed / truncated
 * input from clients that try to spoof the hash.
 */
const SourceHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "sourceHash must be 64 lowercase hex chars");

export const ConfigurationSheetSnapshotSchema = z.object({
  id: ConfigurationSheetSnapshotIdSchema,
  configurationId: ConfigurationIdSchema,
  /** Monotonic per configuration, starts at 1, gapless within a config. */
  version: z.number().int().positive(),
  /** Full HallkeeperSheetV2 JSON — frozen at snapshot creation time. */
  payload: HallkeeperSheetV2Schema,
  /** Diagram thumbnail URL captured at snapshot creation (null in tests). */
  diagramUrl: z.string().url().nullable(),
  /** Pre-rendered PDF URL in R2, populated on approval. */
  pdfUrl: z.string().url().nullable(),
  /**
   * sha256 hex digest of the canonicalised extraction input (sorted
   * placements + metadata). Idempotency key: re-submit with the same
   * hash → return this snapshot instead of inserting a new row.
   */
  sourceHash: SourceHashSchema,
  createdAt: z.string().datetime(),
  /** Null for system-automatic creation (e.g. migration backfill). */
  createdBy: UserIdSchema.nullable(),
  /** Approval timestamps — denormalised from configurations for hot-path reads. */
  approvedAt: z.string().datetime().nullable(),
  approvedBy: UserIdSchema.nullable(),
});
export type ConfigurationSheetSnapshot = z.infer<
  typeof ConfigurationSheetSnapshotSchema
>;

/**
 * True if this snapshot has been approved (both approval columns
 * populated). Both-or-neither invariant enforced at the DB level; this
 * helper keeps consumers from accidentally half-checking.
 */
export function isSnapshotApproved(
  snapshot: ConfigurationSheetSnapshot,
): boolean {
  return snapshot.approvedAt !== null && snapshot.approvedBy !== null;
}
