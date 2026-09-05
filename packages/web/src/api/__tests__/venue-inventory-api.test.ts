import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueInventoryWriteInput } from "@omnitwin/types";
import { INVENTORY_WRITE_TIMEOUT_MS, listVenueInventory, writeVenueInventory } from "../venue-inventory.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

const fetchMock = vi.fn();
const venueId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const input: VenueInventoryWriteInput = { commandId: "00000000-0000-4000-8000-000000000003", expectedRevision: null,
  ownedQuantity: 0, damagedQuantity: 0, unavailableQuantity: 0, hires: [], storageLocation: null, status: "active", reason: "Initial count" };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); _resetTokenGetterForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("inventory API response boundary", () => {
  it("unwraps the shared list envelope without turning unknown stock into zero", async () => {
    const data = { items: [{ catalogue: { id: assetId, name: "Chair", category: "chair" }, stock: null }],
      availability: { status: "unavailable", reason: "RESERVATIONS_NOT_CONNECTED" } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
    await expect(listVenueInventory(venueId)).resolves.toEqual(data);
  });

  it("rejects drifted stock data at the response boundary", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { items: [{ catalogue: { id: assetId, name: "Chair", category: "chair" }, stock: 0 }],
      availability: { status: "unavailable", reason: "RESERVATIONS_NOT_CONNECTED" } } }), { status: 200 }));
    await expect(listVenueInventory(venueId)).rejects.toMatchObject({ code: "RESPONSE_VALIDATION_ERROR" });
  });

  it("bounds a write that never responds and aborts its transport without claiming a failed save", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => { /* Simulated unresponsive transport. */ }));
    const request = writeVenueInventory(venueId, assetId, input);
    const rejection = expect(request).rejects.toMatchObject({ status: 0, code: "INVENTORY_WRITE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(INVENTORY_WRITE_TIMEOUT_MS);
    await rejection;
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options?.signal?.aborted).toBe(true);
  });
});
