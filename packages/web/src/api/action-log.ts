import { z } from "zod";
import {
  ActionActorSchema,
  ActionProvenanceSchema,
  BoundedJsonValueSchema,
  type ActionLogBatch,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Action-log API — G4 Slice 3. Write: the flusher's batch POST (idempotent
// server-side by action id). Read: the audit trail, paged by the server's
// ordinal. Claim safety in the read model: `recordedTs` is the operator's
// clock as reported and `receivedAt` is the server's — distinct fields,
// never conflated, and nothing labels client-supplied actor/provenance as
// verified.
// ---------------------------------------------------------------------------

const PostResponseSchema = z.object({
  data: z.object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
  }),
});

export async function postActionBatch(
  configId: string,
  batch: ActionLogBatch,
): Promise<{ readonly accepted: number; readonly duplicates: number }> {
  const response = await api.post(`/configurations/${configId}/actions`, batch, false, PostResponseSchema);
  return response.data;
}

/** Read-side entries parse with the DEPTH-CAPPED JsonValue (reviewer HIGH):
 *  the raw recursive schema throws RangeError on a pathological blob instead
 *  of failing cleanly, which would escape the api client's error contract. */
export const AuditEntrySchema = z.object({
  ordinal: z.number().int().nonnegative(),
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  /** The authenticated principal the SERVER observed at ingestion —
   *  distinct from the client-reported actor blob below. */
  submittedBy: z.string().uuid(),
  actor: ActionActorSchema,
  intent: z.string().min(1),
  payload: BoundedJsonValueSchema,
  inverse: BoundedJsonValueSchema.nullable(),
  provenance: ActionProvenanceSchema,
  /** Operator-reported clock, as recorded — not server-verified. */
  recordedTs: z.string(),
  /** The API server's clock at ingestion. */
  receivedAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditEntrySchema>;

const GetResponseSchema = z.object({
  data: z.object({
    entries: z.array(AuditEntrySchema),
    nextAfter: z.number().int().nonnegative(),
  }),
});

/** Page the audit trail by server ordinal. Paging convention: when a page
 *  comes back empty, `nextAfter` equals the requested `after` — loop on
 *  `entries.length > 0`, not on `nextAfter` changing. */
export async function getActionLog(
  configId: string,
  after = 0,
  limit = 100,
): Promise<{ readonly entries: readonly AuditLogEntry[]; readonly nextAfter: number }> {
  const response = await api.get(
    `/configurations/${configId}/actions?after=${String(after)}&limit=${String(limit)}`,
    GetResponseSchema,
  );
  return response.data;
}
