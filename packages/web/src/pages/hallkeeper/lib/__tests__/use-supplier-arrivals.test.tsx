import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import type { CreateSupplierArrival, SupplierArrival, SupplierArrivalStep, UpdateSupplierArrival } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { SuppliersSection } from "../../DayBoardSuppliers.js";
import type { DayBoardSlot } from "../day-board-state.js";
import { useSupplierArrivals, type ArrivalOutcome } from "../use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The board's arrivals: a change answers with the arrival as it now stands
// (off the day if it is not due on it); a read that set out before a change
// landed is read again, never painted; a change goes from the revision the
// form opened on, and a refusal reads the day again and says so beside the
// arrival, for that day only.
// ---------------------------------------------------------------------------

const api = vi.hoisted(() => ({
  list: vi.fn<(venueId: string, fromMs: number, toMs: number) => Promise<SupplierArrival[]>>(),
  create: vi.fn<(venueId: string, body: CreateSupplierArrival) => Promise<SupplierArrival>>(),
  update: vi.fn<(venueId: string, id: string, body: UpdateSupplierArrival) => Promise<SupplierArrival>>(),
  remove: vi.fn<(venueId: string, arrival: Pick<SupplierArrival, "id" | "revision">) => Promise<void>>(),
  step: vi.fn<(venueId: string, id: string, step: SupplierArrivalStep) => Promise<SupplierArrival>>(),
  undo: vi.fn<(venueId: string, id: string, step: SupplierArrivalStep) => Promise<SupplierArrival>>(),
}));
vi.mock("../../../../api/supplier-arrivals.js", () => ({
  listSupplierArrivals: (venueId: string, fromMs: number, toMs: number) => api.list(venueId, fromMs, toMs),
  createSupplierArrival: (venueId: string, body: CreateSupplierArrival) => api.create(venueId, body),
  updateSupplierArrival: (venueId: string, id: string, body: UpdateSupplierArrival) => api.update(venueId, id, body),
  removeSupplierArrival: (venueId: string, arrival: Pick<SupplierArrival, "id" | "revision">) => api.remove(venueId, arrival),
  recordSupplierArrivalStep: (venueId: string, id: string, step: SupplierArrivalStep) => api.step(venueId, id, step),
  undoSupplierArrivalStep: (venueId: string, id: string, step: SupplierArrivalStep) => api.undo(venueId, id, step),
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const BAND = "00000000-0000-4000-8000-0000000005a1";
const SAT = { fromMs: Date.parse("2026-11-14T00:00:00.000Z"), toMs: Date.parse("2026-11-15T04:00:00.000Z") };
const SUN = { fromMs: Date.parse("2026-11-15T00:00:00.000Z"), toMs: Date.parse("2026-11-16T04:00:00.000Z") };

function arrival(overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  return {
    id: BAND, venueId: VENUE, bookingId: BOOKING,
    supplierName: "The Kelvin Reelers", category: "band", arrivesAt: "2026-11-14T20:30:00.000Z", leavesBy: "2026-11-15T00:45:00.000Z",
    entrance: "the Glassford Street door", contact: "Siobhan", note: "Five players", arrivedAt: null, arrivedByName: null,
    leftAt: null, leftByName: null, revision: 1, updatedAt: "2026-11-14T09:00:00.000Z", ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const MARKED = arrival({ arrivedAt: "2026-11-14T20:31:00.000Z", arrivedByName: "Jamie" });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});
afterEach(() => { cleanup(); });

describe("useSupplierArrivals", () => {
  it("keeps why a tap failed against its own arrival, and forgets it on another day", async () => {
    api.list.mockResolvedValue([arrival()]);
    api.step.mockRejectedValue(new Error("Network error — check your connection"));
    const { result, rerender } = renderHook(({ range }) => useSupplierArrivals(VENUE, range, true), { initialProps: { range: SAT } });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    let outcome: ArrivalOutcome | null = null;
    await act(async () => { outcome = await result.current.step(arrival(), "arrived"); });
    expect(outcome).toBe("failed");
    expect([...result.current.failures]).toEqual([[BAND, "Couldn’t mark that: Network error — check your connection."]]);
    api.list.mockResolvedValue([]);
    rerender({ range: SUN });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.failures.size).toBe(0);
  });

  it("calls a refusal from someone's newer change stale, says so in the board's words, and reads the day again", async () => {
    api.list.mockResolvedValue([arrival()]);
    api.update.mockRejectedValue(new ApiError(409, "Someone changed this arrival since you opened it. Read it again.", "STALE_ARRIVAL"));
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    let outcome: ArrivalOutcome | null = null;
    await act(async () => { outcome = await result.current.change(arrival({ revision: 3 }), 1, { note: "Six players" }); });
    expect(outcome).toBe("stale");
    expect(api.update).toHaveBeenCalledWith(VENUE, BAND, { note: "Six players", expectedRevision: 1 });
    expect(result.current.failures.get(BAND)).toBe("Couldn’t save that: someone else changed it meanwhile, so it now shows as it stands.");
    await waitFor(() => { expect(api.list).toHaveBeenCalledTimes(2); });
  });

  it("shows an arrival saved for the day at once, and takes one saved onto another day off it", async () => {
    api.list.mockResolvedValue([]);
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const body = { bookingId: BOOKING, supplierName: "The Kelvin Reelers", category: null, arrivesAt: arrival().arrivesAt, leavesBy: null, entrance: null, contact: null, note: null };
    api.create.mockResolvedValueOnce(arrival());
    await act(async () => { await result.current.add(body); });
    expect(result.current.byBooking.get(BOOKING)?.map((item) => item.id)).toEqual([BAND]);
    // Moved to Friday: it leaves Saturday's board at once rather than at the next read.
    api.update.mockResolvedValueOnce(arrival({ arrivesAt: "2026-11-13T11:00:00.000Z", leavesBy: null, revision: 2 }));
    await act(async () => { await result.current.change(arrival(), 1, { arrivesAt: "2026-11-13T11:00:00.000Z", leavesBy: null }); });
    expect(result.current.arrivals).toEqual([]);
  });

  it("never paints a read that set out before a tap landed, and reads the day again", async () => {
    api.list.mockResolvedValueOnce([arrival()]);
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    // The minute's read leaves, slow; the floor taps Arrived meanwhile.
    const slow = deferred<SupplierArrival[]>();
    api.list.mockReturnValueOnce(slow.promise);
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(api.list).toHaveBeenCalledTimes(2); });
    api.step.mockResolvedValue(MARKED);
    api.list.mockResolvedValue([MARKED]);
    await act(async () => { await result.current.step(arrival(), "arrived"); });
    expect(result.current.arrivals[0]?.arrivedAt).toBe(MARKED.arrivedAt);
    // The read from before the tap lands now: it is dropped, and the day read again.
    await act(async () => { slow.resolve([arrival()]); await slow.promise; });
    expect(result.current.arrivals[0]?.arrivedAt).toBe(MARKED.arrivedAt);
    await waitFor(() => { expect(api.list).toHaveBeenCalledTimes(3); });
    expect(result.current.arrivals[0]?.arrivedAt).toBe(MARKED.arrivedAt);
  });

  it("takes a mistaken tap back through the floor's own call", async () => {
    api.list.mockResolvedValue([MARKED]);
    api.undo.mockResolvedValue(arrival({ revision: 1 }));
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    let outcome: ArrivalOutcome | null = null;
    await act(async () => { outcome = await result.current.undo(MARKED, "arrived"); });
    expect(outcome).toBe("saved");
    expect(api.undo).toHaveBeenCalledWith(VENUE, BAND, "arrived");
    expect(result.current.arrivals[0]?.arrivedAt).toBeNull();
  });

  it("reads a look-back before the day, kept apart from the day's own", async () => {
    const lookBack = 36 * 3_600_000;
    const overnight = arrival({ id: "00000000-0000-4000-8000-0000000005a9", supplierName: "Clyde Staging", arrivesAt: "2026-11-13T20:00:00.000Z", leavesBy: null,
      arrivedAt: "2026-11-13T20:05:00.000Z", arrivedByName: "Ngozi" });
    api.list.mockResolvedValue([overnight, arrival()]);
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true, lookBack));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(api.list).toHaveBeenCalledWith(VENUE, SAT.fromMs - lookBack, SAT.toMs);
    expect(result.current.earlier.map((item) => item.supplierName)).toEqual(["Clyde Staging"]);
    expect(result.current.arrivals.map((item) => item.supplierName)).toEqual(["The Kelvin Reelers"]);
    expect(result.current.byBooking.get(BOOKING)?.map((item) => item.supplierName)).toEqual(["The Kelvin Reelers"]);
    // Marked gone from the building's list, it stays read and leaves "still in".
    api.step.mockResolvedValue({ ...overnight, leftAt: "2026-11-14T09:00:00.000Z", leftByName: "Jamie" });
    await act(async () => { await result.current.step(overnight, "left"); });
    expect(result.current.earlier[0]?.leftAt).toBe("2026-11-14T09:00:00.000Z");
  });

  it("says a read is on its way, while what it last knew stands", async () => {
    api.list.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSupplierArrivals(VENUE, SAT, true));
    await waitFor(() => { expect(result.current.status).toBe("failed"); });
    expect(result.current.reading).toBe(false);
    const again = deferred<SupplierArrival[]>();
    api.list.mockReturnValueOnce(again.promise);
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(result.current.reading).toBe(true); });
    expect(result.current.status).toBe("failed");
    await act(async () => { again.resolve([arrival()]); await again.promise; });
    expect(result.current.status).toBe("ready");
    expect(result.current.reading).toBe(false);
  });
});

describe("useSupplierArrivals with the panel", () => {
  const SLOT = { bookingId: BOOKING, startsAtMs: Date.parse("2026-11-14T18:00:00.000Z") } as DayBoardSlot;

  function Panel(): ReactElement {
    const arrivals = useSupplierArrivals(VENUE, SAT, true);
    return (
      <SuppliersSection slot={SLOT} arrivals={arrivals.byBooking.get(BOOKING) ?? []} boardDate="2026-11-14" dayBoundaryHour={4}
        timeZone="Europe/London" nowMs={Date.parse("2026-11-14T12:00:00.000Z")} today canPlan canMark={false} actions={arrivals} />
    );
  }

  it("sends a change from the copy the form opened on, and after a refusal shows the colleague's", async () => {
    api.list.mockResolvedValueOnce([arrival()]);
    api.list.mockResolvedValue([arrival({ revision: 2, entrance: "the Hutcheson Street door" })]);
    api.update.mockRejectedValueOnce(new ApiError(409, "Someone changed this arrival since you opened it. Read it again.", "STALE_ARRIVAL"));
    render(<Panel />);
    fireEvent.click(await screen.findByRole("button", { name: "Change The Kelvin Reelers" }));
    // A colleague moves them to another door; the board reads it while the form is open.
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => { expect(api.list).toHaveBeenCalledTimes(2); });
    const form = screen.getByRole("form", { name: "Change The Kelvin Reelers" });
    fireEvent.change(within(form).getByLabelText("Note"), { target: { value: "Six players" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(api.update).toHaveBeenCalledTimes(1); });
    expect(api.update.mock.calls[0]?.[2]).toMatchObject({ expectedRevision: 1, note: "Six players" });
    // Refused: the form closes, says why beside the supplier, and the board shows the colleague's door.
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change The Kelvin Reelers" })).toBeNull(); });
    expect(await screen.findByText("20:30–00:45 · the Hutcheson Street door")).toBeTruthy();
    expect(screen.getByText("Couldn’t save that: someone else changed it meanwhile, so it now shows as it stands.")).toBeTruthy();
  });
});
