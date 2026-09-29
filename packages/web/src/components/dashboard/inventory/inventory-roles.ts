import type { InventoryAdjusterRole } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Who changed a venue's stock or decided its inventory, in words. A venue's
// administrators and managers both may (Blake, 29 September 2026); a record
// from before then carries no role, as only administrators could act.
// ---------------------------------------------------------------------------

type RoleOnRecord = InventoryAdjusterRole | null | undefined;

/** "Venue manager" or "Venue administrator", as a label. */
export function inventoryRoleName(role: RoleOnRecord): string {
  return role === "manager" ? "Venue manager" : "Venue administrator";
}

/** "a venue manager" or "a venue administrator", within a sentence. */
export function inventoryRoleWords(role: RoleOnRecord): string {
  return role === "manager" ? "a venue manager" : "a venue administrator";
}
