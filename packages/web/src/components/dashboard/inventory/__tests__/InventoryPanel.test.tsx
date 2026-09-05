import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VenueInventoryWriteInputSchema, type InventoryStock, type VenueInventoryReceipt, type VenueInventoryWriteInput } from "@omnitwin/types";
import type { VenueInventoryData } from "../../../../api/venue-inventory.js";
import { ApiError } from "../../../../api/client.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { InventoryPanel } from "../InventoryPanel.js";
import { inventoryPendingKey, writeInventoryPending } from "../inventory-pending.js";

const venueId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const mocks = vi.hoisted(() => ({ list: vi.fn(), write: vi.fn(), history: vi.fn() }));
vi.mock("../../../../api/venue-inventory.js", () => ({ listVenueInventory: mocks.list,
  writeVenueInventory: mocks.write, recentVenueInventoryHistory: mocks.history }));
vi.mock("../InventoryDemand.js", () => ({ InventoryDemand: ({ refreshKey }: { readonly refreshKey: string | number }) =>
  <div data-testid="demand-assessment" data-refresh={refreshKey}>Demand assessment</div> }));
const stock: InventoryStock = { venueId, assetDefinitionId: assetId, revision: 3,
  ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0, hires: [],
  storageLocation: "East store", status: "active", effectiveAt: "2026-09-05T09:00:00.000Z" };
const data: VenueInventoryData = { items: [{ catalogue: { id: assetId, name: "Chiavari chair", category: "chair" }, stock }],
  availability: { status: "requires_assessment", reason: "TIME_WINDOW_REQUIRED" } };

function success(input: VenueInventoryWriteInput): { stock: InventoryStock; receipt: VenueInventoryReceipt; replayed: boolean } {
  const after: InventoryStock = { ...stock, ownedQuantity: input.ownedQuantity, revision: 4,
    effectiveAt: "2026-09-05T10:00:00.000Z" };
  return { stock: after, replayed: false, receipt: { kind: "adjusted", command: { ...input, expectedRevision: 3,
    venueId, assetDefinitionId: assetId }, actorUserId: actorId, actorRole: "admin", reason: input.reason,
    before: stock, after, recordedAt: after.effectiveAt } };
}

async function edit(): Promise<void> {
  render(<InventoryPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Adjust Chiavari chair" }));
  expect(await screen.findByRole("dialog", { name: "Chiavari chair" })).toBeTruthy();
}

beforeEach(() => {
  writeInventoryPending(inventoryPendingKey(actorId, venueId, assetId), null);
  mocks.list.mockReset().mockResolvedValue(data);
  mocks.write.mockReset().mockImplementation((_venue: string, _asset: string, input: VenueInventoryWriteInput) => Promise.resolve(success(input)));
  mocks.history.mockReset().mockResolvedValue([]);
  useAuthStore.getState().setUser({ id: actorId, name: "Venue admin", email: "admin@example.test",
    role: "admin", platformRole: "none", venueId });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("InventoryPanel", () => {
  it("shows physical stock separately from the dated demand assessment", async () => {
    render(<InventoryPanel />);
    expect(await screen.findByRole("button", { name: "Adjust Chiavari chair" })).toBeTruthy();
    expect(screen.getByTestId("demand-assessment")).toBeTruthy();
    expect(screen.queryByText(/200 available/u)).toBeNull();
  });

  it("records unknown counts only after explicit entry and a reason", async () => {
    mocks.list.mockResolvedValue({ ...data, items: [{ ...data.items[0], stock: null }] });
    render(<InventoryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Record Chiavari chair" }));
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("");
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Damaged"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Other unavailable"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock record" }));
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "No owned stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock record" }));
    await waitFor(() => { expect(mocks.write).toHaveBeenCalledWith(venueId, assetId,
      expect.objectContaining({ expectedRevision: null, ownedQuantity: 0, reason: "No owned stock" })); });
  });

  it("saves exact changes with an audit receipt and refreshes visible stock", async () => {
    await edit();
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stock count" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText("Stock saved" )).toBeTruthy();
    expect(screen.getByText("Stock count")).toBeTruthy();
    expect(mocks.write).toHaveBeenCalledWith(venueId, assetId, expect.objectContaining({
      ownedQuantity: 210, damagedQuantity: 20, expectedRevision: 3, reason: "Stock count" }));
    expect(screen.getByTestId("demand-assessment").getAttribute("data-refresh")).toBe(`${assetId}:4`);
  });

  it("retries an ambiguous write with the same immutable command", async () => {
    mocks.write.mockRejectedValueOnce(new ApiError(0, "Connection lost", "NETWORK_ERROR"));
    await edit();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Count" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText(/The result is not confirmed/u)).toBeTruthy();
    expect(screen.getByLabelText("Owned").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry this save" }));
    await screen.findByText("Stock saved");
    expect(mocks.write.mock.calls[1]?.[2]).toEqual(mocks.write.mock.calls[0]?.[2]);
  });

  it("retains proposed edits on stale revision and requires a deliberate rebase", async () => {
    const currentStock = { ...stock, revision: 4, ownedQuantity: 205 };
    mocks.write.mockRejectedValueOnce(new ApiError(409, "Stock changed", "INVENTORY_REVISION_CONFLICT", { currentStock }));
    await edit();
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Count" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText("This stock record changed")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits against latest record" }));
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    await waitFor(() => { expect(mocks.write).toHaveBeenCalledTimes(2); });
    expect(mocks.write.mock.calls[1]?.[2]).toMatchObject({ expectedRevision: 4, ownedQuantity: 210 });
    expect(VenueInventoryWriteInputSchema.parse(mocks.write.mock.calls[1]?.[2]).commandId)
      .not.toBe(VenueInventoryWriteInputSchema.parse(mocks.write.mock.calls[0]?.[2]).commandId);
  });

  it("can close an uncertain save and confirm the original command after reopening", async () => {
    mocks.write.mockRejectedValueOnce(new ApiError(0, "Connection lost", "NETWORK_ERROR"));
    await edit();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Count" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close and check later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => { expect(mocks.list).toHaveBeenCalledTimes(2); });
    fireEvent.click(screen.getByRole("button", { name: "Adjust Chiavari chair" }));
    expect(await screen.findByText(/An earlier save is not confirmed/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry this save" }));
    await screen.findByText("Stock saved");
    expect(mocks.write.mock.calls[1]?.[2]).toEqual(mocks.write.mock.calls[0]?.[2]);
  });

  it("provides a retry for inventory load failures", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Offline"));
    render(<InventoryPanel />);
    expect(await screen.findByText("Inventory could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Adjust Chiavari chair" })).toBeTruthy();
  });

  it.each(["staff", "hallkeeper", "planner"])("does not grant a platform admin with %s venue role inventory access", (role) => {
    useAuthStore.getState().setUser({ id: actorId, name: "Platform", email: "platform@example.test", role,
      platformRole: "admin", venueId });
    render(<InventoryPanel />);
    expect(screen.getByText("Venue administrator access required")).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
