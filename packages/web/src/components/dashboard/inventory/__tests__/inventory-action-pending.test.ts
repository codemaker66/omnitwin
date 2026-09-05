import { afterEach, describe, expect, it } from "vitest";
import { inventoryActionKey, readInventoryAction, writeInventoryAction, type InventoryPendingAction } from "../inventory-action-pending.js";

const key = inventoryActionKey("actor", "venue");
const pending: InventoryPendingAction = { kind: "prepare", title: "Hire request · Chair", input: {
  commandId: "00000000-0000-4000-8000-000000000001", assetDefinitionId: "00000000-0000-4000-8000-000000000002",
  kind: "hire_request", quantity: 12, window: { startsAt: "2026-09-06T10:00:00.000Z", endsAt: "2026-09-06T20:00:00.000Z" },
  expectedAssessmentDigest: "a".repeat(64), reason: "Cover the recorded shortage" } };
afterEach(() => { writeInventoryAction(key, null); sessionStorage.removeItem("corrupt"); });
describe("unconfirmed inventory actions", () => {
  it("retains the exact command and scopes it to its actor and venue", () => {
    writeInventoryAction(key, pending);
    expect(readInventoryAction(key)).toEqual(pending);
    expect(readInventoryAction(inventoryActionKey("other", "venue"))).toBeNull();
    expect(readInventoryAction(inventoryActionKey("actor", "other"))).toBeNull();
  });
  it("does not execute a corrupt browser record", () => {
    sessionStorage.setItem("corrupt", JSON.stringify({ kind: "approve", input: { commandId: "bad" } }));
    expect(readInventoryAction("corrupt")).toBeNull();
  });
});
