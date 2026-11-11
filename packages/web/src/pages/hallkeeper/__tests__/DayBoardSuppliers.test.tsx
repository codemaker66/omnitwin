import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SupplierArrival } from "@omnitwin/types";
import { SuppliersSection } from "../DayBoardSuppliers.js";
import type { DayBoardSlot } from "../lib/day-board-state.js";
import type { SupplierArrivalsApi } from "../lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The booking's suppliers in its panel: when each is due and by which door,
// the floor's Arrived and Gone, and the office's add, change and remove.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const TZ = "Europe/London";
const at = (time: string, day = "14"): string => `2026-11-${day}T${time}:00.000Z`;
const SLOT = { bookingId: "00000000-0000-4000-8000-0000000000b1", startsAtMs: Date.parse(at("18:00")) } as DayBoardSlot;

function arrival(overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  return {
    id: "00000000-0000-4000-8000-0000000005a1", venueId: "00000000-0000-4000-8000-000000000001", bookingId: SLOT.bookingId,
    supplierName: "The Kelvin Reelers", category: "band", arrivesAt: at("20:30"), leavesBy: at("00:45", "15"),
    entrance: "the Glassford Street door", contact: "Siobhan", note: "Five players", arrivedAt: null, arrivedByName: null,
    leftAt: null, leftByName: null, revision: 1, updatedAt: at("09:00"), ...overrides,
  };
}

function actions(overrides: Partial<SupplierArrivalsApi> = {}): SupplierArrivalsApi {
  return {
    status: "ready", arrivals: [], byBooking: new Map(), busy: new Set(), failure: null, refresh: vi.fn(),
    step: vi.fn(() => Promise.resolve(true)), add: vi.fn(() => Promise.resolve(true)),
    change: vi.fn(() => Promise.resolve(true)), remove: vi.fn(() => Promise.resolve(true)), ...overrides,
  };
}

function show(props: { arrivals?: readonly SupplierArrival[]; canPlan?: boolean; canMark?: boolean; api?: SupplierArrivalsApi; nowMs?: number }) {
  const api = props.api ?? actions();
  render(<SuppliersSection slot={SLOT} arrivals={props.arrivals ?? []} timeZone={TZ} nowMs={props.nowMs ?? Date.parse(at("12:00"))}
    canPlan={props.canPlan ?? false} canMark={props.canMark ?? false} actions={api} />);
  return api;
}

describe("SuppliersSection", () => {
  it("says when each supplier is due, by which door, and who to ring", () => {
    show({ arrivals: [arrival()] });
    const section = screen.getByRole("region", { name: "Suppliers" });
    expect(within(section).getByText("The Kelvin Reelers")).toBeTruthy();
    expect(within(section).getByText("20:30–00:45 · the Glassford Street door")).toBeTruthy();
    expect(within(section).getByText("Siobhan · Five players")).toBeTruthy();
    // The floor's own buttons only where the floor may mark the door.
    expect(within(section).queryByRole("button")).toBeNull();
  });

  it("lets the floor mark a supplier in, then gone, and says who did", () => {
    const api = show({ arrivals: [arrival()], canMark: true });
    fireEvent.click(screen.getByRole("button", { name: "The Kelvin Reelers arrived" }));
    expect(api.step).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "The Kelvin Reelers" }), "arrived");
    cleanup();
    show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie" })], canMark: true });
    expect(screen.getByText("In at 20:34 · Jamie")).toBeTruthy();
    expect(screen.getByRole("button", { name: "The Kelvin Reelers gone" })).toBeTruthy();
  });

  it("says plainly when a supplier is not here ten minutes after they were due", () => {
    show({ arrivals: [arrival()], nowMs: Date.parse(at("20:41")) });
    expect(screen.getByText("Not here yet").className).toContain("is-late");
  });

  it("lets the office add a supplier, a late leaving time read as the next morning", async () => {
    const api = show({ canPlan: true });
    expect(screen.getByText("No suppliers are down for this booking.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "  The Kelvin Reelers " } });
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "20:30" } });
    fireEvent.change(within(form).getByLabelText("Leaves by"), { target: { value: "00:45" } });
    fireEvent.change(within(form).getByLabelText("Door"), { target: { value: "the Glassford Street door" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalled(); });
    expect(api.add).toHaveBeenCalledWith({
      bookingId: SLOT.bookingId, supplierName: "The Kelvin Reelers", category: null, arrivesAt: at("20:30"), leavesBy: at("00:45", "15"),
      entrance: "the Glassford Street door", contact: null, note: null,
    });
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Add a supplier" })).toBeNull(); });
  });

  it("asks for a name and a time before it sends anything", () => {
    const api = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    fireEvent.submit(screen.getByRole("form", { name: "Add a supplier" }));
    expect(screen.getByText("Name the supplier and when they arrive.")).toBeTruthy();
    expect(api.add).not.toHaveBeenCalled();
  });

  it("lets the office change a supplier from its own times, and remove one once asked", async () => {
    const api = show({ arrivals: [arrival()], canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change The Kelvin Reelers" }));
    const form = screen.getByRole("form", { name: "Change The Kelvin Reelers" });
    expect((within(form).getByLabelText("Arrives")).value).toBe("20:30");
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "21:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(api.change).toHaveBeenCalled(); });
    expect(api.change).toHaveBeenCalledWith(expect.objectContaining({ id: arrival().id }), expect.objectContaining({ arrivesAt: at("21:00"), leavesBy: at("00:45", "15") }));

    fireEvent.click(await screen.findByRole("button", { name: "Remove The Kelvin Reelers" }));
    const confirm = screen.getByRole("group", { name: "Remove The Kelvin Reelers?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => { expect(api.remove).toHaveBeenCalled(); });
  });

  it("says when the suppliers could not be read, rather than showing none, and offers Try again", () => {
    const api = actions({ status: "failed" });
    render(<SuppliersSection slot={SLOT} arrivals={[]} timeZone={TZ} nowMs={Date.parse(at("12:00"))} canPlan={false} canMark actions={api} unread />);
    expect(screen.getByText("The suppliers could not be read just now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.refresh).toHaveBeenCalled();
  });

  it("says why a change could not be made", () => {
    show({ arrivals: [arrival()], canPlan: true, api: actions({ failure: "Couldn’t save that: Someone changed this arrival since you opened it. Read it again." }) });
    expect(screen.getByRole("status").textContent).toContain("Someone changed this arrival");
  });
});
