import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VenueInventoryWriteInputSchema, type InventoryStock, type VenueInventoryWriteInput } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import type { VenueInventoryItem, VenueInventoryResult } from "../../../../api/venue-inventory.js";
import { InventoryEditor, type InventoryEditorHandle } from "../InventoryEditor.js";
import { inventoryPendingKey, readInventoryPending, writeInventoryPending } from "../inventory-pending.js";

const venueId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const pendingKey = inventoryPendingKey(actorId, venueId, assetId);
const mocks = vi.hoisted(() => ({ write: vi.fn(), history: vi.fn() }));
vi.mock("../../../../api/venue-inventory.js", () => ({
  writeVenueInventory: mocks.write, recentVenueInventoryHistory: mocks.history,
}));
const stock: InventoryStock = { venueId, assetDefinitionId: assetId, revision: 3,
  ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0, hires: [],
  storageLocation: "East store", status: "active", effectiveAt: "2026-09-05T09:00:00.000Z" };
const item: VenueInventoryItem = { catalogue: { id: assetId, name: "Chiavari chair", category: "chair" }, stock };

function success(input: VenueInventoryWriteInput): VenueInventoryResult {
  const revision = input.expectedRevision;
  if (revision === null) throw new Error("This fixture writes an existing stock record.");
  const before = { ...stock, revision };
  const after: InventoryStock = { ...stock, ownedQuantity: input.ownedQuantity, damagedQuantity: input.damagedQuantity,
    unavailableQuantity: input.unavailableQuantity, storageLocation: input.storageLocation, status: input.status, hires: input.hires,
    revision: revision + 1, effectiveAt: "2026-09-05T10:00:00.000Z" };
  return { stock: after, replayed: false, receipt: { kind: "adjusted", command: { ...input, expectedRevision: revision, venueId, assetDefinitionId: assetId },
    actorUserId: actorId, actorRole: "admin", reason: input.reason, before, after, recordedAt: after.effectiveAt } };
}

beforeEach(() => {
  writeInventoryPending(pendingKey, null);
  mocks.write.mockReset().mockImplementation((_venue: string, _asset: string, input: VenueInventoryWriteInput) => Promise.resolve(success(input)));
  mocks.history.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); writeInventoryPending(pendingKey, null); });

describe("InventoryEditor presentations and requested navigation", () => {
  it("preserves the standalone dialog and its existing action labels by default", async () => {
    const { container } = render(<InventoryEditor actorId={actorId} venueId={venueId} item={item} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Chiavari chair" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByRole("button", { name: "Save adjustment" })).toBeTruthy();
    expect(screen.getByText("Adjust physical stock")).toBeTruthy();
    await screen.findByText("No adjustments recorded.");
  });

  it("renders inline in the parent's tree without a modal or focus trap", async () => {
    const { container } = render(<><button type="button">Another workspace action</button>
      <InventoryEditor actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} /></>);
    const region = screen.getByRole("region", { name: "Correct stock" });
    expect(container.contains(region)).toBe(true);
    expect(region.hasAttribute("aria-modal")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Chiavari chair · Current stock")).toBeTruthy();
    await screen.findByText("No adjustments recorded.");
    const outside = screen.getByRole("button", { name: "Another workspace action" });
    outside.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    outside.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it("keeps status, usable-owned calculation and preserved hire metadata in the inline stock disclosure", async () => {
    const hireStock: InventoryStock = { ...stock, hires: [{ id: "00000000-0000-4000-8000-000000000005", quantity: 4,
      startsAt: "2026-09-06T09:00:00.000Z", endsAt: "2026-09-06T17:00:00.000Z" }] };
    render(<InventoryEditor actorId={actorId} venueId={venueId} item={{ ...item, stock: hireStock }} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    // happy-dom does not hide the descendants of closed native details from
    // role queries; browser integration checks real visibility and focus order.
    expect(screen.getByText("Stock details").closest("details")?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Stock details"));
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    expect(screen.getByText("1 hire record is preserved separately.")).toBeTruthy();
    expect(screen.getByText("180")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "retired" } });
    expect(screen.getByText("Retired stock is excluded from use.")).toBeTruthy();
    await screen.findByText("No adjustments recorded.");
  });

  it("requests native unload confirmation only while edits need protection and removes the guard on unmount", async () => {
    const mounted = render(<InventoryEditor actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "200" } });
    const reverted = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reverted);
    expect(reverted.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    await screen.findByText("No adjustments recorded.");
    mounted.unmount();
    const afterUnmount = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("requires confirmation before a dirty item switch and invokes only the accepted target", async () => {
    const ref = createRef<InventoryEditorHandle>(); const onClose = vi.fn(); const firstTarget = vi.fn(); const secondTarget = vi.fn();
    render(<InventoryEditor ref={ref} actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    act(() => { ref.current?.requestClose(firstTarget); });
    expect(screen.getByText("Keep these changes?")).toBeTruthy();
    expect(firstTarget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
    expect(screen.getByText("Chiavari chair · Unsaved correction")).toBeTruthy();
    act(() => { ref.current?.requestClose(secondTarget); });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(secondTarget).toHaveBeenCalledTimes(1);
    expect(firstTarget).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await screen.findByText("No adjustments recorded.");
  });

  it("uses its own close handler after the user cancels a requested item switch", async () => {
    const ref = createRef<InventoryEditorHandle>(); const onClose = vi.fn(); const target = vi.fn();
    render(<InventoryEditor ref={ref} actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    act(() => { ref.current?.requestClose(target); });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Close inventory adjustment" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(target).not.toHaveBeenCalled();
    await screen.findByText("No adjustments recorded.");
  });

  it("blocks requested navigation while a stock write is active, then permits it after confirmation", async () => {
    let resolveWrite: ((value: VenueInventoryResult) => void) | undefined;
    mocks.write.mockImplementation(() => new Promise<VenueInventoryResult>((resolve) => { resolveWrite = resolve; }));
    const ref = createRef<InventoryEditorHandle>(); const target = vi.fn();
    render(<InventoryEditor ref={ref} actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    act(() => { ref.current?.requestClose(target); });
    expect(target).not.toHaveBeenCalled();
    expect(screen.queryByText("Keep these changes?")).toBeNull();
    expect(screen.getByRole("button", { name: "Close inventory adjustment" }).hasAttribute("disabled")).toBe(true);
    const command = VenueInventoryWriteInputSchema.parse(mocks.write.mock.calls[0]?.[2]);
    act(() => { resolveWrite?.(success(command)); });
    await screen.findByText("Stock saved");
    act(() => { ref.current?.requestClose(target); });
    expect(target).toHaveBeenCalledTimes(1);
  });

  it("dismisses a prior discard question when the user explicitly saves the current edits", async () => {
    const ref = createRef<InventoryEditorHandle>(); const target = vi.fn();
    render(<InventoryEditor ref={ref} actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    act(() => { ref.current?.requestClose(target); });
    expect(screen.getByText("Keep these changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    await screen.findByText("Stock saved");
    expect(screen.queryByText("Keep these changes?")).toBeNull();
    expect(target).not.toHaveBeenCalled();
  });

  it("retains an uncertain command when switching away and retries the same write after reopening", async () => {
    mocks.write.mockRejectedValueOnce(new ApiError(0, "Connection lost", "NETWORK_ERROR"));
    const ref = createRef<InventoryEditorHandle>(); const target = vi.fn();
    const first = render(<InventoryEditor ref={ref} actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    await screen.findByText(/The result is not confirmed/u);
    const command = VenueInventoryWriteInputSchema.parse(mocks.write.mock.calls[0]?.[2]);
    act(() => { ref.current?.requestClose(target); });
    expect(target).toHaveBeenCalledTimes(1);
    expect(readInventoryPending(pendingKey)?.command).toEqual(command);
    first.unmount();
    render(<InventoryEditor actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Chiavari chair · Save not confirmed")).toBeTruthy();
    expect(screen.getByLabelText("Owned").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry this save" }));
    await screen.findByText("Stock saved");
    expect(mocks.write.mock.calls[1]?.[2]).toEqual(command);
    expect(readInventoryPending(pendingKey)).toBeNull();
  });

  it("keeps remedy forms independent while the inline save submits the stock form", async () => {
    const remedySubmit = vi.fn(); const onSaved = vi.fn();
    render(<InventoryEditor actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={onSaved}
      remedies={<form aria-label="Remedy review" onSubmit={(event) => { event.preventDefault(); remedySubmit(); }}>
        <button type="submit">Review remedy</button></form>} />);
    const remedyForm = screen.getByRole("form", { name: "Remedy review" });
    expect(remedyForm.parentElement?.closest("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review remedy" }));
    expect(remedySubmit).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    await screen.findByText("Stock saved");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ownedQuantity: 210, revision: 4 }));
    expect(remedySubmit).toHaveBeenCalledTimes(1);
  });

  it("retains the revision-conflict review and deliberately rebases untouched fields inline", async () => {
    const currentStock: InventoryStock = { ...stock, revision: 4, storageLocation: "West store", unavailableQuantity: 5 };
    mocks.write.mockRejectedValueOnce(new ApiError(409, "Stock changed", "INVENTORY_REVISION_CONFLICT", { currentStock }));
    render(<InventoryEditor actorId={actorId} venueId={venueId} item={item} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Owned"), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stocktake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    await screen.findByText("This stock record changed");
    expect(screen.getByRole("button", { name: "Save stock correction" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits against latest record" }));
    expect(screen.getByLabelText<HTMLInputElement>("Storage location").value).toBe("West store");
    expect(screen.getByLabelText<HTMLInputElement>("Other unavailable").value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Save stock correction" }));
    await waitFor(() => { expect(mocks.write).toHaveBeenCalledTimes(2); });
    expect(mocks.write.mock.calls[1]?.[2]).toMatchObject({ expectedRevision: 4, ownedQuantity: 210,
      unavailableQuantity: 5, storageLocation: "West store" });
    await screen.findByText("Stock saved");
  });

  it("keeps unrecorded quantities blank and requires explicit counts and a reason inline", async () => {
    render(<InventoryEditor actorId={actorId} venueId={venueId} item={{ ...item, stock: null }} presentation="inline" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Record stock" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save stock record" }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a whole number of zero or more for each stock count.")).toBeTruthy();
    for (const field of ["Owned", "Damaged", "Other unavailable"]) fireEvent.change(screen.getByLabelText(field), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock record" }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByText("Add a reason for this stock record.")).toBeTruthy();
    await screen.findByText("No adjustments recorded.");
  });
});
