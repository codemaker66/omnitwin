import { describe, expect, it } from "vitest";
import type { InventoryStock } from "@omnitwin/types";
import { inventoryDraft, inventoryWriteInput, rebaseInventoryDraft } from "../inventory-form.js";

const stock: InventoryStock = {
  venueId: "00000000-0000-4000-8000-000000000001",
  assetDefinitionId: "00000000-0000-4000-8000-000000000002", revision: 3,
  ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0,
  hires: [{ id: "00000000-0000-4000-8000-000000000003", quantity: 10,
    startsAt: "2026-09-06T09:00:00.000Z", endsAt: "2026-09-06T18:00:00.000Z" }],
  storageLocation: "East store", status: "active", effectiveAt: "2026-09-05T09:00:00.000Z",
};
const commandId = "00000000-0000-4000-8000-000000000004";

describe("inventory adjustment form", () => {
  it("leaves unknown counts blank until an admin records them", () => {
    expect(inventoryDraft(null)).toMatchObject({ ownedQuantity: "", damagedQuantity: "", unavailableQuantity: "" });
  });

  it("preserves hires and revision while normalising a reason and storage", () => {
    const result = inventoryWriteInput({ ...inventoryDraft(stock), ownedQuantity: "210", reason: "  Stock count  " }, stock, commandId);
    expect(result).toMatchObject({ success: true, data: { commandId, expectedRevision: 3,
      ownedQuantity: 210, hires: stock.hires, reason: "Stock count", storageLocation: "East store" } });
  });

  it.each(["", " ", "-1", "1.5", "2e2", "9007199254740992"])("rejects invalid count %j instead of coercing it", (ownedQuantity) => {
    expect(inventoryWriteInput({ ...inventoryDraft(stock), ownedQuantity, reason: "Count" }, stock, commandId).success).toBe(false);
  });

  it("rejects combined damaged and unavailable stock above owned quantity", () => {
    const result = inventoryWriteInput({ ...inventoryDraft(stock), unavailableQuantity: "190", reason: "Count" }, stock, commandId);
    expect(result.success).toBe(false);
  });

  it("requires a reason and accepts a deliberate first record of zero", () => {
    const draft = { ...inventoryDraft(null), ownedQuantity: "0", damagedQuantity: "0", unavailableQuantity: "0" };
    expect(inventoryWriteInput(draft, null, commandId).success).toBe(false);
    expect(inventoryWriteInput({ ...draft, reason: "No owned units" }, null, commandId)).toMatchObject({
      success: true, data: { expectedRevision: null, ownedQuantity: 0, storageLocation: null, hires: [] },
    });
  });

  it("keeps only the admin's edits when rebasing, adopting concurrent untouched fields", () => {
    const draft = { ...inventoryDraft(stock), ownedQuantity: "210", reason: "New chairs" };
    const current = { ...stock, revision: 4, storageLocation: "West store", damagedQuantity: 25, status: "retired" as const };
    expect(rebaseInventoryDraft(draft, stock, current)).toEqual({ ...inventoryDraft(current), ownedQuantity: "210", reason: "New chairs" });
  });
});
