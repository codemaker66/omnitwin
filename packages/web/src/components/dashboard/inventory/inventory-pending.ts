import { z } from "zod";
import { InventoryStockSchema, VenueInventoryWriteInputSchema } from "@omnitwin/types";

const PendingRecordSchema = z.object({ command: VenueInventoryWriteInputSchema, baseStock: InventoryStockSchema.nullable() }).strict();
export type InventoryPendingRecord = z.infer<typeof PendingRecordSchema>;

// Retain within the SPA if browser storage is unavailable. sessionStorage keeps
// the command private to this tab and scoped to the authenticated venue actor.
const memory = new Map<string, InventoryPendingRecord>();

export function inventoryPendingKey(actorId: string, venueId: string, assetId: string): string {
  return `venviewer:inventory-pending:v2:${actorId}:${venueId}:${assetId}`;
}

export function readInventoryPending(key: string): InventoryPendingRecord | null {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const result = PendingRecordSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    memory.set(key, result.data);
    return result.data;
  } catch { return null; } // Corrupt/disabled browser storage never becomes an executable command.
}

export function writeInventoryPending(key: string, record: InventoryPendingRecord | null): void {
  if (record === null) memory.delete(key);
  else memory.set(key, record);
  try {
    if (record === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(record));
  } catch { /* The scoped in-memory command remains available for retry in this SPA. */ }
}
