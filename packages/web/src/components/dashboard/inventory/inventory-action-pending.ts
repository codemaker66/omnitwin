import { z } from "zod";
import { InventoryWindowSchema, InventoryReservationApprovalInputSchema, InventoryReservationRevokeInputSchema,
  InventoryRemedyPrepareInputSchema, InventoryRemedyApproveInputSchema } from "@omnitwin/types";
import { approveInventoryReservation, revokeInventoryReservation, prepareInventoryRemedy, approveInventoryRemedy,
  type ReservationResult, type RemedyResult } from "../../../api/venue-inventory-demand.js";

const Title = z.string().min(1).max(400);
const PendingActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reserve"), title: Title, input: InventoryReservationApprovalInputSchema }).strict(),
  z.object({ kind: z.literal("revoke"), title: Title, input: InventoryReservationRevokeInputSchema }).strict(),
  z.object({ kind: z.literal("prepare"), title: Title, input: InventoryRemedyPrepareInputSchema }).strict(),
  z.object({ kind: z.literal("approve"), title: Title, remedyId: z.string().uuid(), window: InventoryWindowSchema, input: InventoryRemedyApproveInputSchema }).strict(),
]);
export type InventoryPendingAction = z.infer<typeof PendingActionSchema>;
export type InventoryActionResult = { readonly kind: "reservation"; readonly result: ReservationResult }
  | { readonly kind: "remedy"; readonly result: RemedyResult };
const memory = new Map<string, InventoryPendingAction>();
export function inventoryActionKey(actorId: string, venueId: string): string {
  return `venviewer:inventory-action:v1:${actorId}:${venueId}`;
}
export function readInventoryAction(key: string): InventoryPendingAction | null {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const result = PendingActionSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    memory.set(key, result.data); return result.data;
  } catch { return null; } // Disabled or corrupt storage never becomes an executable action.
}
export function writeInventoryAction(key: string, action: InventoryPendingAction | null): void {
  if (action === null) memory.delete(key); else memory.set(key, action);
  try {
    if (action === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(action));
  } catch { /* The scoped in-memory command remains available when sessionStorage is disabled. */ }
}
export async function runInventoryAction(venueId: string, action: InventoryPendingAction): Promise<InventoryActionResult> {
  switch (action.kind) {
    case "reserve": return { kind: "reservation", result: await approveInventoryReservation(venueId, action.input) };
    case "revoke": return { kind: "reservation", result: await revokeInventoryReservation(venueId, action.input) };
    case "prepare": return { kind: "remedy", result: await prepareInventoryRemedy(venueId, action.input) };
    case "approve": return { kind: "remedy", result: await approveInventoryRemedy(venueId, action.remedyId, action.input) };
  }
}
