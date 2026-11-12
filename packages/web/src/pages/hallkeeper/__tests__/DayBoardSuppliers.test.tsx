import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SupplierArrival } from "@omnitwin/types";
import { SuppliersSection } from "../DayBoardSuppliers.js";
import type { DayBoardSlot } from "../lib/day-board-state.js";
import { newArrivalKey, type ArrivalOutcome, type SupplierArrivalsApi } from "../lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The booking's suppliers in its panel: when each is due and by which door;
// the floor's Arrived, Gone and Undo on today's board; the office's add,
// change and remove, with times typed for the board's day (the small hours
// are that night), sent from the copy the form opened on. Every refusal is
// said beside the supplier it is about, and the keyboard keeps its place.
// November is on GMT, so the venue's clock reads these UTC times as written.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const TZ = "Europe/London";
const at = (time: string, day = "14"): string => `2026-11-${day}T${time}:00.000Z`;
const BAND = "00000000-0000-4000-8000-0000000005a1";
const FLOWERS = "00000000-0000-4000-8000-0000000005a2";
const SLOT = { bookingId: "00000000-0000-4000-8000-0000000000b1", startsAtMs: Date.parse(at("18:00")) } as DayBoardSlot;

function arrival(overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  return {
    id: BAND, venueId: "00000000-0000-4000-8000-000000000001", bookingId: SLOT.bookingId,
    supplierName: "The Kelvin Reelers", category: "band", arrivesAt: at("20:30"), leavesBy: at("00:45", "15"),
    entrance: "the Glassford Street door", contact: "Siobhan", note: "Five players", arrivedAt: null, arrivedByName: null,
    leftAt: null, leftByName: null, revision: 1, updatedAt: at("09:00"), ...overrides,
  };
}

const saved = (): Promise<ArrivalOutcome> => Promise.resolve("saved");

function actions(overrides: Partial<SupplierArrivalsApi> = {}): SupplierArrivalsApi {
  return {
    status: "ready", reading: false, arrivals: [], earlier: [], byBooking: new Map(), busy: new Set(), failures: new Map(), refresh: vi.fn(),
    step: vi.fn(saved), undo: vi.fn(saved), add: vi.fn(saved), change: vi.fn(saved), remove: vi.fn(saved), ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface Shown {
  readonly slot?: DayBoardSlot;
  readonly arrivals?: readonly SupplierArrival[];
  readonly boardDate?: string;
  readonly nowMs?: number;
  readonly today?: boolean;
  readonly canPlan?: boolean;
  readonly canMark?: boolean;
  readonly api?: SupplierArrivalsApi;
}

function show(shown: Shown) {
  const props = {
    slot: shown.slot ?? SLOT,
    arrivals: shown.arrivals ?? [],
    boardDate: shown.boardDate ?? "2026-11-14",
    dayBoundaryHour: 4,
    timeZone: TZ,
    nowMs: shown.nowMs ?? Date.parse(at("12:00")),
    today: shown.today ?? true,
    canPlan: shown.canPlan ?? false,
    canMark: shown.canMark ?? false,
    actions: shown.api ?? actions(),
  };
  const view = render(<SuppliersSection {...props} />);
  return { api: props.actions, props, view };
}

/** The list item a supplier's name stands in. */
function itemOf(name: string): HTMLElement {
  const item = screen.getByText(name).closest("li");
  if (item === null) throw new Error(`No list item for ${name}`);
  return item;
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

  it("lets the floor mark a supplier in and gone, and undo a mistaken tap", async () => {
    const waiting = show({ arrivals: [arrival()], canMark: true });
    fireEvent.click(screen.getByRole("button", { name: "The Kelvin Reelers arrived" }));
    expect(waiting.api.step).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "arrived");
    await act(async () => { await Promise.resolve(); });
    cleanup();

    const inside = show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie" })], canMark: true });
    expect(screen.getByText("In at 20:34 · Jamie")).toBeTruthy();
    expect(screen.getByRole("button", { name: "The Kelvin Reelers gone" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo: The Kelvin Reelers marked in" }));
    expect(inside.api.undo).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "arrived");
    await act(async () => { await Promise.resolve(); });
    cleanup();

    const gone = show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie", leftAt: at("23:50"), leftByName: "Ngozi" })], canMark: true });
    expect(screen.getByText("In at 20:34, gone at 23:50 · Ngozi")).toBeTruthy();
    // Marked gone, only the last tap can be undone.
    expect(screen.queryByRole("button", { name: "Undo: The Kelvin Reelers marked in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo: The Kelvin Reelers marked gone" }));
    expect(gone.api.undo).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "left");
    await act(async () => { await Promise.resolve(); });
  });

  it("keeps the keyboard on the supplier when Arrived gives way to Gone, and says it was done", async () => {
    const tapped = deferred<ArrivalOutcome>();
    const { props, view } = show({ arrivals: [arrival()], canMark: true, api: actions({ step: vi.fn(() => tapped.promise) }) });
    const button = screen.getByRole("button", { name: "The Kelvin Reelers arrived" });
    button.focus();
    fireEvent.click(button);
    // The board holds the supplier as now in before the tap's promise settles.
    view.rerender(<SuppliersSection {...props} arrivals={[arrival({ arrivedAt: at("20:40"), arrivedByName: "Jamie" })]} />);
    expect(document.activeElement).toBe(document.body);
    await act(async () => { tapped.resolve("saved"); await tapped.promise; });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "The Kelvin Reelers gone" }));
    expect(document.querySelector(".dayboard-sr")?.textContent).toBe("The Kelvin Reelers marked in.");
  });

  it("calls a supplier nobody has marked in late, in copper, only on today's board while expected", () => {
    show({ arrivals: [arrival()], nowMs: Date.parse(at("20:41")) });
    expect(screen.getByText("Not marked in yet").className).toContain("is-late");
    cleanup();
    // Not yet ten minutes past due: nothing is said.
    show({ arrivals: [arrival()], nowMs: Date.parse(at("20:35")) });
    expect(screen.queryByText(/marked in/u)).toBeNull();
    cleanup();
    // Past the time they were to leave, it is a plain fact, not a call to the door.
    show({ arrivals: [arrival()], nowMs: Date.parse(at("01:00", "15")) });
    expect(screen.getByText("Not marked in").className).not.toContain("is-late");
    cleanup();
    // On another day's board, a week on.
    show({ arrivals: [arrival()], nowMs: Date.parse(at("12:00", "21")), today: false });
    expect(screen.getByText("Not marked in").className).not.toContain("is-late");
  });

  it("names the day of a tap made on another board's day than the one they were due", () => {
    show({ arrivals: [
      arrival({ arrivedAt: at("19:00", "13"), arrivedByName: "Jamie" }),
      arrival({ id: FLOWERS, supplierName: "Thistle & Fern Flowers", arrivesAt: at("23:30"), leavesBy: null, arrivedAt: at("00:20", "15"), arrivedByName: "Ngozi" }),
    ] });
    expect(screen.getByText("In at 19:00 on Fri 13 Nov · Jamie")).toBeTruthy();
    // After midnight is still the same night.
    expect(screen.getByText("In at 00:20 · Ngozi")).toBeTruthy();
  });

  it("lets the office add a supplier on the board's day, a time in the small hours on that night", async () => {
    const { api } = show({ canPlan: true });
    expect(screen.getByText("No suppliers are down for this booking.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    expect(document.activeElement).toBe(within(form).getByLabelText("Supplier"));
    expect(within(form).getByText("For Sat 14 Nov.")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "  DJ Morven " } });
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "00:30" } });
    fireEvent.change(within(form).getByLabelText("Leaves by"), { target: { value: "02:00" } });
    // The form says back what it will save, date and all.
    expect(within(form).getByText("Due Sun 15 Nov at 00:30, leaving by 02:00.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalled(); });
    expect(api.add).toHaveBeenCalledWith({
      bookingId: SLOT.bookingId, supplierName: "DJ Morven", category: null, arrivesAt: at("00:30", "15"), leavesBy: at("02:00", "15"),
      entrance: null, contact: null, note: null,
    });
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Add a supplier" })).toBeNull(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a supplier" }));
    expect(document.querySelector(".dayboard-sr")?.textContent).toBe("DJ Morven added.");
  });

  it("adds from the day shown, not the first day of a booking that spans several", async () => {
    // An exhibition from Friday, opened from Saturday's board.
    const exhibition = { ...SLOT, startsAtMs: Date.parse(at("08:00", "13")) };
    const { api } = show({ slot: exhibition, canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "Clydeside Kitchen Co." } });
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "22:00" } });
    fireEvent.change(within(form).getByLabelText("Leaves by"), { target: { value: "05:00" } });
    expect(within(form).getByText("Due Sat 14 Nov at 22:00, leaving by Sun 15 Nov at 05:00.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ arrivesAt: at("22:00"), leavesBy: at("05:00", "15") })); });
  });

  it("asks for a name and a time before it sends anything", () => {
    const { api } = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    fireEvent.submit(screen.getByRole("form", { name: "Add a supplier" }));
    expect(screen.getByText("Name the supplier and when they arrive.")).toBeTruthy();
    expect(api.add).not.toHaveBeenCalled();
  });

  it("names a time the clocks skip, and saves what it reads instead only once asked again", async () => {
    // Saturday 27 March 2027: the clocks go forward at 01:00 that night.
    const { api } = show({ canPlan: true, boardDate: "2027-03-27", nowMs: Date.parse("2027-03-27T12:00:00.000Z") });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "The Kelvin Reelers" } });
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "20:00" } });
    fireEvent.change(within(form).getByLabelText("Leaves by"), { target: { value: "01:30" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(within(form).getByText("The clocks go forward that night, so there is no 01:30. It reads 02:30 now; save again to keep it.")).toBeTruthy();
    expect(within(form).getByLabelText<HTMLInputElement>("Leaves by").value).toBe("02:30");
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalled(); });
    // 02:30 BST is 01:30 UTC.
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ arrivesAt: "2027-03-27T20:00:00.000Z", leavesBy: "2027-03-28T01:30:00.000Z" }));
  });

  it("changes a supplier from the copy the form opened on, not a newer one read since", async () => {
    const { api, props, view } = show({ arrivals: [arrival()], canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change The Kelvin Reelers" }));
    // The minute's read brings a colleague's change while the form is open.
    view.rerender(<SuppliersSection {...props} arrivals={[arrival({ revision: 2, entrance: "the Hutcheson Street door" })]} />);
    const form = screen.getByRole("form", { name: "Change The Kelvin Reelers" });
    expect(within(form).getByLabelText<HTMLInputElement>("Arrives").value).toBe("20:30");
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "21:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(api.change).toHaveBeenCalled(); });
    // Revision 1, the one the form showed: the server refuses it rather than undo the colleague.
    expect(api.change).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), 1, expect.objectContaining({ arrivesAt: at("21:00"), leavesBy: at("00:45", "15") }));
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change The Kelvin Reelers" })).toBeNull(); });
    expect(document.querySelector(".dayboard-sr")?.textContent).toBe("The Kelvin Reelers saved.");
  });

  it("changes a supplier due after midnight on their own night", async () => {
    const { api } = show({ arrivals: [arrival({ supplierName: "DJ Morven", arrivesAt: at("00:30", "15"), leavesBy: at("02:00", "15") })], canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change DJ Morven" }));
    const form = screen.getByRole("form", { name: "Change DJ Morven" });
    fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: "23:45" } });
    expect(within(form).getByText("Due Sat 14 Nov at 23:45, leaving by Sun 15 Nov at 02:00.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(api.change).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ arrivesAt: at("23:45"), leavesBy: at("02:00", "15") })); });
  });

  it("closes the form when someone changed the supplier first, and keeps it when the change did not go", async () => {
    const stale = show({ arrivals: [arrival()], canPlan: true, api: actions({ change: vi.fn(() => Promise.resolve<ArrivalOutcome>("stale")) }) });
    fireEvent.click(screen.getByRole("button", { name: "Change The Kelvin Reelers" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Change The Kelvin Reelers" })).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(stale.api.change).toHaveBeenCalled(); });
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change The Kelvin Reelers" })).toBeNull(); });
    cleanup();

    const failed = show({ arrivals: [arrival()], canPlan: true, api: actions({ change: vi.fn(() => Promise.resolve<ArrivalOutcome>("failed")) }) });
    fireEvent.click(screen.getByRole("button", { name: "Change The Kelvin Reelers" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Change The Kelvin Reelers" })).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(failed.api.change).toHaveBeenCalled(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("form", { name: "Change The Kelvin Reelers" })).toBeTruthy();
  });

  it("says why a change failed beside the supplier it is about, and no other", () => {
    show({
      arrivals: [arrival(), arrival({ id: FLOWERS, supplierName: "Thistle & Fern Flowers", arrivesAt: at("15:00"), leavesBy: null })],
      canMark: true,
      canPlan: true,
      api: actions({ failures: new Map([
        [FLOWERS, "Couldn’t mark that: Thistle & Fern Flowers is not due yet."],
        [newArrivalKey("00000000-0000-4000-8000-0000000000b9"), "Couldn’t add that: another booking’s form."],
      ]) }),
    });
    expect(within(itemOf("Thistle & Fern Flowers")).getByRole("status").textContent).toBe("Couldn’t mark that: Thistle & Fern Flowers is not due yet.");
    expect(within(itemOf("The Kelvin Reelers")).getByRole("status").textContent).toBe("");
    expect(screen.queryByText("Couldn’t add that: another booking’s form.")).toBeNull();
  });

  it("removes a supplier once asked, and once however fast the tap", async () => {
    const removing = deferred<ArrivalOutcome>();
    const remove = vi.fn(() => removing.promise);
    show({ arrivals: [arrival()], canPlan: true, api: actions({ remove }) });
    fireEvent.click(screen.getByRole("button", { name: "Remove The Kelvin Reelers" }));
    const confirm = screen.getByRole("group", { name: "Remove The Kelvin Reelers?" });
    // The question takes the keyboard to its safe answer.
    expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "Keep" }));
    const button = within(confirm).getByRole("button", { name: "Remove" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => { removing.resolve("saved"); await removing.promise; });
    expect(document.querySelector(".dayboard-sr")?.textContent).toBe("The Kelvin Reelers removed.");
  });

  it("says it is reading the suppliers, not that there are none, until the read comes back", () => {
    show({ canPlan: true, api: actions({ status: "loading" }) });
    expect(screen.getByText("Reading the suppliers…")).toBeTruthy();
    expect(screen.queryByText("No suppliers are down for this booking.")).toBeNull();
  });

  it("says when the suppliers could not be read, and shows Try again at work once pressed", () => {
    const api = actions({ status: "failed" });
    const { props, view } = show({ canMark: true, api });
    expect(screen.getByText("The suppliers could not be read just now.")).toBeTruthy();
    expect(screen.queryByText("No suppliers are down for this booking.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.refresh).toHaveBeenCalled();
    view.rerender(<SuppliersSection {...props} actions={{ ...api, reading: true }} />);
    expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-busy")).toBe("true");
  });
});
