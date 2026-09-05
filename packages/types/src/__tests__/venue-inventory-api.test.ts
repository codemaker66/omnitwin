import { describe, expect, it } from "vitest";
import { VenueInventoryListResponseSchema, VenueInventoryReceiptSchema, VenueInventoryWriteInputSchema } from "../venue-inventory-api.js";
import { applyInventoryAdjustment } from "../venue-inventory-adjustment.js";
import type { InventoryStock } from "../venue-inventory.js";

const venueId = "00000000-0000-4000-8000-000000000001";
const assetDefinitionId = "00000000-0000-4000-8000-000000000002";
const commandId = "00000000-0000-4000-8000-000000000003";
const actorUserId = "00000000-0000-4000-8000-000000000004";
const recordedAt = "2026-09-05T10:00:00.000Z";
const values = { ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0,
  hires: [], storageLocation: "East store", status: "active" as const };
const command = { ...values, venueId, assetDefinitionId, commandId, expectedRevision: null, reason: "Physical count" };
const after: InventoryStock = { venueId, assetDefinitionId, revision: 1, ...values, effectiveAt: recordedAt };
const receipt = { kind: "created", command, actorUserId, actorRole: "admin", reason: command.reason, recordedAt, before: null, after };

describe("venue inventory persisted contracts", () => {
  it("represents first recorded stock without inventing a zero before-state", () => {
    expect(VenueInventoryReceiptSchema.parse(receipt).before).toBeNull();
    expect(VenueInventoryReceiptSchema.safeParse({ ...receipt, before: after }).success).toBe(false);
  });
  it.each([{ after: { ...after, ownedQuantity: 999 } }, { command: { ...command, expectedRevision: 0 } },
    { actorRole: "hallkeeper" }, { reason: "Another reason" }])("rejects contradictory creation receipts %j", (change) => {
    expect(VenueInventoryReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false);
  });
  it("preserves the foundation's complete adjustment integrity validation", () => {
    const result = applyInventoryAdjustment(after, { ...command, expectedRevision: 1, ownedQuantity: 180 },
      { userId: actorUserId, venueId, role: "admin" }, recordedAt);
    expect(VenueInventoryReceiptSchema.parse({ ...result.receipt, kind: "adjusted" }).after.ownedQuantity).toBe(180);
    expect(VenueInventoryReceiptSchema.safeParse({ ...result.receipt, kind: "adjusted", after }).success).toBe(false);
  });
  it("accepts explicit first-record input and rejects false counts or injected actor", () => {
    const { venueId: _venueId, assetDefinitionId: _assetDefinitionId, ...body } = command;
    expect(VenueInventoryWriteInputSchema.parse(body).expectedRevision).toBeNull();
    expect(VenueInventoryWriteInputSchema.safeParse({ ...body, damagedQuantity: 201 }).success).toBe(false);
    expect(VenueInventoryWriteInputSchema.safeParse({ ...body, actorUserId }).success).toBe(false);
  });
  it("keeps absent stock and unknown reservation knowledge explicit", () => {
    const result = VenueInventoryListResponseSchema.parse({ data: { items: [
      { catalogue: { id: assetDefinitionId, name: "Banquet chair", category: "chair" }, stock: null }],
    availability: { status: "unavailable", reason: "RESERVATIONS_NOT_CONNECTED" } } });
    expect(result.data.items[0]?.stock).toBeNull();
    expect(result.data.availability.status).toBe("unavailable");
  });
});
