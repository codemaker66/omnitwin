import { VenueInventoryWriteInputSchema, type InventoryStock, type VenueInventoryWriteInput } from "@omnitwin/types";

export interface InventoryDraft {
  readonly ownedQuantity: string;
  readonly damagedQuantity: string;
  readonly unavailableQuantity: string;
  readonly storageLocation: string;
  readonly status: "active" | "retired";
  readonly reason: string;
}

export function inventoryDraft(stock: InventoryStock | null): InventoryDraft {
  return { ownedQuantity: stock?.ownedQuantity.toString() ?? "",
    damagedQuantity: stock?.damagedQuantity.toString() ?? "",
    unavailableQuantity: stock?.unavailableQuantity.toString() ?? "",
    storageLocation: stock?.storageLocation ?? "", status: stock?.status ?? "active", reason: "" };
}

/** A rebase retains intentional edits only. Untouched storage/status/counts
 * adopt the concurrent record instead of silently overwriting another admin. */
export function rebaseInventoryDraft(draft: InventoryDraft, before: InventoryStock | null,
  current: InventoryStock | null): InventoryDraft {
  const original = inventoryDraft(before);
  const latest = inventoryDraft(current);
  return { ownedQuantity: draft.ownedQuantity === original.ownedQuantity ? latest.ownedQuantity : draft.ownedQuantity,
    damagedQuantity: draft.damagedQuantity === original.damagedQuantity ? latest.damagedQuantity : draft.damagedQuantity,
    unavailableQuantity: draft.unavailableQuantity === original.unavailableQuantity ? latest.unavailableQuantity : draft.unavailableQuantity,
    storageLocation: draft.storageLocation === original.storageLocation ? latest.storageLocation : draft.storageLocation,
    status: draft.status === original.status ? latest.status : draft.status, reason: draft.reason };
}

type WriteInputResult = { readonly success: true; readonly data: VenueInventoryWriteInput } |
  { readonly success: false; readonly message: string };

export function inventoryWriteInput(draft: InventoryDraft, stock: InventoryStock | null,
  commandId: string): WriteInputResult {
  const quantities = [draft.ownedQuantity, draft.damagedQuantity, draft.unavailableQuantity];
  if (quantities.some((value) => !/^\d+$/u.test(value.trim()) || !Number.isSafeInteger(Number(value)))) {
    return { success: false, message: "Enter a whole number of zero or more for each stock count." };
  }
  if (draft.reason.trim() === "") return { success: false, message: "Add a reason for this stock record." };
  const result = VenueInventoryWriteInputSchema.safeParse({ ...draft, commandId,
    expectedRevision: stock?.revision ?? null, ownedQuantity: Number(draft.ownedQuantity),
    damagedQuantity: Number(draft.damagedQuantity), unavailableQuantity: Number(draft.unavailableQuantity),
    storageLocation: draft.storageLocation.trim() || null, hires: stock?.hires ?? [] });
  if (!result.success) return { success: false, message: result.error.issues[0]?.message ?? "Check the stock details." };
  return { success: true, data: result.data };
}

export function inventoryErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Inventory could not be saved. Please try again.";
}
