import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SupplierArrival } from "@omnitwin/types";
import { SuppliersSection } from "../DayBoardSuppliers.js";
import type { DayBoundary } from "../lib/board-day.js";
import type { DayBoardSlot } from "../lib/day-board-state.js";
import { newArrivalKey, type ArrivalOutcome, type SupplierArrivalsApi } from "../lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The booking's suppliers in its panel: when each is due and by which door;
// the floor's Arrived, Gone and Undo on today's board; the office's add,
// change and remove, with times typed for the board's day (the small hours
// are that night), sent from the copy the form opened on, and saved only once
// the venue's night hours are read. The panel lists the board's own day: the
// small hours of the night before are only there for someone still at the
// door, and say their day. Every refusal is said beside the supplier it is
// about, and the keyboard keeps its place.
// November is on GMT, so the venue's clock reads these UTC times as written.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const TZ = "Europe/London";
const at = (time: string, day = "14"): string => `2026-11-${day}T${time}:00.000Z`;
const BAND = "00000000-0000-4000-8000-0000000005a1";
const FLOWERS = "00000000-0000-4000-8000-0000000005a2";
const SLOT = { bookingId: "00000000-0000-4000-8000-0000000000b1", startsAtMs: Date.parse(at("18:00")) } as DayBoardSlot;
/** The floor's door buttons, by the supplier they mark. */
const arrivedButton = (name: string): RegExp => new RegExp(`^(Mark )?${name} arrived$`, "u");
const goneButton = (name: string): RegExp => new RegExp(`^(Mark )?${name} gone$`, "u");

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
    status: "ready", reading: false, arrivals: [], byBooking: new Map(), busy: new Set(), failures: new Map(), refresh: vi.fn(),
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
  readonly dayBoundaryHour?: number;
  readonly boundary?: DayBoundary["state"];
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
    dayBoundaryHour: shown.dayBoundaryHour ?? 4,
    boundary: shown.boundary ?? "known",
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

/** Fill the add form's supplier and times. */
function fillAdd(form: HTMLElement, name: string, arrives: string, leaves = ""): void {
  fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: name } });
  fireEvent.change(within(form).getByLabelText("Arrives"), { target: { value: arrives } });
  if (leaves !== "") fireEvent.change(within(form).getByLabelText("Leaves by"), { target: { value: leaves } });
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

  it("lets the floor mark a supplier in and gone, and undo a mistaken tap, with buttons named for what they do", async () => {
    const waiting = show({ arrivals: [arrival()], canMark: true });
    fireEvent.click(screen.getByRole("button", { name: "Mark The Kelvin Reelers arrived" }));
    expect(waiting.api.step).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "arrived");
    await act(async () => { await Promise.resolve(); });
    cleanup();

    const inside = show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie" })], canMark: true });
    expect(screen.getByText("In at 20:34 · Jamie")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark The Kelvin Reelers gone" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo: The Kelvin Reelers marked in" }));
    expect(inside.api.undo).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "arrived");
    await act(async () => { await Promise.resolve(); });
    cleanup();

    const gone = show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie", leftAt: at("23:50"), leftByName: "Ngozi" })], canMark: true });
    // Two people marked the door: both are named.
    expect(screen.getByText("In at 20:34 · Jamie, gone at 23:50 · Ngozi")).toBeTruthy();
    // Marked gone, only the last tap can be undone.
    expect(screen.queryByRole("button", { name: "Undo: The Kelvin Reelers marked in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo: The Kelvin Reelers marked gone" }));
    expect(gone.api.undo).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "left");
    await act(async () => { await Promise.resolve(); });
    cleanup();

    // One person both times: named once.
    show({ arrivals: [arrival({ arrivedAt: at("20:34"), arrivedByName: "Jamie", leftAt: at("23:50"), leftByName: "Jamie" })] });
    expect(screen.getByText("In at 20:34, gone at 23:50 · Jamie")).toBeTruthy();
  });

  it("keeps the keyboard on the supplier when Arrived gives way to Gone, and says it was done", async () => {
    const tapped = deferred<ArrivalOutcome>();
    const { props, view } = show({ arrivals: [arrival()], canMark: true, api: actions({ step: vi.fn(() => tapped.promise) }) });
    const button = screen.getByRole("button", { name: arrivedButton("The Kelvin Reelers") });
    button.focus();
    fireEvent.click(button);
    // The board holds the supplier as now in before the tap's promise settles.
    view.rerender(<SuppliersSection {...props} arrivals={[arrival({ arrivedAt: at("20:40"), arrivedByName: "Jamie" })]} />);
    expect(document.activeElement).toBe(document.body);
    await act(async () => { tapped.resolve("saved"); await tapped.promise; });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: goneButton("The Kelvin Reelers") }));
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

  it("calls nobody late in copper from a read that has since failed: it says what was last read", () => {
    show({ arrivals: [arrival()], nowMs: Date.parse(at("20:41")), canMark: true, api: actions({ status: "failed" }) });
    expect(screen.queryByText("Not marked in yet")).toBeNull();
    expect(screen.getByText("Not marked in when last read").className).not.toContain("is-late");
    // The door can still be marked: the server keeps the first tap.
    expect(screen.getByRole("button", { name: arrivedButton("The Kelvin Reelers") })).toBeTruthy();
  });

  it("lists the board's own night, not the small hours of the night before, and names the day of one still at the door", () => {
    // Saturday's board at 00:20 on Sunday: its read holds Saturday 00:30 (Friday's
    // night, never marked) and Sunday 00:30 (Saturday's own night).
    const lastNight = arrival({ id: FLOWERS, supplierName: "Overnight security", arrivesAt: at("00:30"), leavesBy: null, entrance: null });
    const tonight = arrival({ supplierName: "Overnight security", arrivesAt: at("00:30", "15"), leavesBy: null, entrance: null });
    const { api } = show({ arrivals: [lastNight, tonight], nowMs: Date.parse(at("00:20", "15")), canMark: true });
    const door = screen.getAllByRole("button", { name: arrivedButton("Overnight security") });
    expect(door).toHaveLength(1);
    expect(screen.getAllByText(/^From 00:30/u).map((line) => line.textContent)).toEqual(["From 00:30"]);
    fireEvent.click(door[0] ?? document.body);
    expect(api.step).toHaveBeenCalledWith(expect.objectContaining({ id: BAND }), "arrived");
    cleanup();

    // Marked in last night and not out: still the floor's to mark gone, and its line says when it was due.
    show({ arrivals: [{ ...lastNight, arrivedAt: at("00:35"), arrivedByName: "Elaine" }, tonight], nowMs: Date.parse(at("00:20", "15")), canMark: true });
    expect(screen.getByText("From 00:30 on Sat 14 Nov")).toBeTruthy();
    expect(screen.getByText("In at 00:35 · Elaine")).toBeTruthy();
    expect(screen.getByText("From 00:30")).toBeTruthy();
    cleanup();

    // Late at the door now, from the night before: listed while they are, with its day.
    show({ arrivals: [arrival({ supplierName: "Govan Hire", arrivesAt: at("03:55"), leavesBy: null, entrance: null })], nowMs: Date.parse(at("04:10")), canMark: true });
    expect(screen.getByText("From 03:55 on Sat 14 Nov")).toBeTruthy();
    expect(screen.getByText("Not marked in yet").className).toContain("is-late");
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
    expect(screen.getByText("No suppliers are due today for this booking.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    expect(document.activeElement).toBe(within(form).getByLabelText("Supplier"));
    expect(within(form).getByText("For Sat 14 Nov.")).toBeTruthy();
    fillAdd(form, "  DJ Morven ", "00:30", "02:00");
    // The form says back what it will save, date and all.
    expect(within(form).getByText("Due Sun 15 Nov at 00:30, leaving by 02:00.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalled(); });
    expect(api.add).toHaveBeenCalledWith({
      bookingId: SLOT.bookingId, supplierName: "DJ Morven", category: null, arrivesAt: at("00:30", "15"), leavesBy: at("02:00", "15"),
      entrance: null, contact: null, note: null,
    }, expect.stringMatching(/^[0-9a-f-]{36}$/u));
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Add a supplier" })).toBeNull(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a supplier" }));
    expect(document.querySelector(".dayboard-sr")?.textContent).toBe("DJ Morven added.");
  });

  it("sends one key with every Save of one add form, so a resend adds once, and a new key with the next form", async () => {
    const add = vi.fn((_body: unknown, _key: string): Promise<ArrivalOutcome> => Promise.resolve("failed"));
    show({ canPlan: true, api: actions({ add }) });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fillAdd(form, "Clydeside Kitchen Co.", "15:00");
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await act(async () => { await Promise.resolve(); });
    // The answer was lost: the form stays, and Save again carries the same key.
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await act(async () => { await Promise.resolve(); });
    expect(add).toHaveBeenCalledTimes(2);
    const [first, second] = add.mock.calls;
    expect(first?.[1]).toBe(second?.[1]);
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const next = screen.getByRole("form", { name: "Add a supplier" });
    fillAdd(next, "Govan Hire", "16:00");
    fireEvent.click(within(next).getByRole("button", { name: "Add" }));
    await act(async () => { await Promise.resolve(); });
    expect(add.mock.calls[2]?.[1]).not.toBe(first?.[1]);
  });

  it("places no time on the board's night until the venue's night hours are read, and says so", async () => {
    // Before the venue's boundary hour arrives the board assumes midnight.
    const { api, props, view } = show({ canPlan: true, boundary: "reading", dayBoundaryHour: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    fillAdd(screen.getByRole("form", { name: "Add a supplier" }), "DJ Morven", "00:30", "02:00");
    expect(within(screen.getByRole("form", { name: "Add a supplier" })).getByText("Reading the venue’s night hours…")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("form", { name: "Add a supplier" })).getByRole("button", { name: "Add" }));
    expect(screen.getByText("The venue’s night hours are not read yet, so these times cannot be placed. Save again in a moment.")).toBeTruthy();
    expect(api.add).not.toHaveBeenCalled();
    // A failed read says so, and still saves nothing.
    view.rerender(<SuppliersSection {...props} boundary="retrying" />);
    expect(screen.getByText("The venue’s night hours could not be read yet; trying again.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("form", { name: "Add a supplier" })).getByRole("button", { name: "Add" }));
    expect(api.add).not.toHaveBeenCalled();
    // Read: 00:30 is that night's, the next date's.
    view.rerender(<SuppliersSection {...props} boundary="known" dayBoundaryHour={4} />);
    expect(screen.getByText("Due Sun 15 Nov at 00:30, leaving by 02:00.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("form", { name: "Add a supplier" })).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ arrivesAt: at("00:30", "15") }), expect.any(String)); });
  });

  it("adds from the day shown, not the first day of a booking that spans several", async () => {
    // An exhibition from Friday, opened from Saturday's board.
    const exhibition = { ...SLOT, startsAtMs: Date.parse(at("08:00", "13")) };
    const { api } = show({ slot: exhibition, canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fillAdd(form, "Clydeside Kitchen Co.", "22:00", "05:00");
    expect(within(form).getByText("Due Sat 14 Nov at 22:00, leaving by Sun 15 Nov at 05:00.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ arrivesAt: at("22:00"), leavesBy: at("05:00", "15") }), expect.any(String)); });
  });

  it("asks for a name and a time before it sends anything, in a status line that was there all along", () => {
    const { api } = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    // Mounted while empty, so what is put in it is heard.
    const line = within(form).getByRole("status");
    expect(line.textContent).toBe("");
    fireEvent.submit(form);
    expect(line.textContent).toBe("Name the supplier and when they arrive.");
    expect(api.add).not.toHaveBeenCalled();
  });

  it("hides an empty status line from sight only, never from a screen reader", () => {
    const sheet = readFileSync(resolve("src/pages/hallkeeper/day-board.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//gu, "");
    const empty = /\.dayboard-supplier-problem:empty\s*\{([^}]*)\}/u.exec(sheet)?.[1] ?? "";
    expect(empty).toContain("clip-path: inset(50%)");
    expect(sheet).not.toMatch(/\.dayboard-supplier-problem[^{]*\{[^}]*display:\s*none/u);
  });

  it("names a time the clocks skip, and saves what it reads instead only once asked again", async () => {
    // Saturday 27 March 2027: the clocks go forward at 01:00 that night.
    const { api } = show({ canPlan: true, boardDate: "2027-03-27", nowMs: Date.parse("2027-03-27T12:00:00.000Z") });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fillAdd(form, "The Kelvin Reelers", "20:00", "01:30");
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(within(form).getByText("The clocks go forward that night, so there is no 01:30. It reads 02:30 now; save again to keep it.")).toBeTruthy();
    expect(within(form).getByLabelText<HTMLInputElement>("Leaves by").value).toBe("02:30");
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(api.add).toHaveBeenCalled(); });
    // 02:30 BST is 01:30 UTC.
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ arrivesAt: "2027-03-27T20:00:00.000Z", leavesBy: "2027-03-28T01:30:00.000Z" }), expect.any(String));
  });

  it("names the second 01:30 on the night the clocks go back", () => {
    // Saturday 24 October 2026: at 02:00 BST on the Sunday the clocks go back to 01:00.
    show({ canPlan: true, boardDate: "2026-10-24", nowMs: Date.parse("2026-10-24T12:00:00.000Z") });
    fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
    const form = screen.getByRole("form", { name: "Add a supplier" });
    fillAdd(form, "The Kelvin Reelers", "20:30", "01:30");
    expect(within(form).getByText("Due Sat 24 Oct at 20:30, leaving by Sun 25 Oct at 01:30. 01:30 comes twice that night, as the clocks go back; this is the second.")).toBeTruthy();
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

  it("closes a change whose supplier a colleague removed, and keeps the keyboard and the reason with the booking", async () => {
    const change = vi.fn((): Promise<ArrivalOutcome> => Promise.resolve("gone"));
    const { props, view } = show({ arrivals: [arrival({ supplierName: "Govan Hire" })], canPlan: true, api: actions({ change }) });
    fireEvent.click(screen.getByRole("button", { name: "Change Govan Hire" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Change Govan Hire" })).getByRole("button", { name: "Save" }));
    await act(async () => { await Promise.resolve(); });
    // The removal reaches the board: the supplier goes, and the booking says why.
    view.rerender(<SuppliersSection {...props} arrivals={[]} actions={{
      ...props.actions,
      failures: new Map([[newArrivalKey(SLOT.bookingId), "Couldn’t save that: Govan Hire is no longer on the board."]]),
    }} />);
    expect(screen.queryByRole("form", { name: "Change Govan Hire" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a supplier" }));
    expect(screen.getByText("Couldn’t save that: Govan Hire is no longer on the board.").getAttribute("role")).toBe("status");
    cleanup();

    // The floor taps a supplier removed meanwhile: the panel stays to say so, and keeps the keyboard.
    const step = vi.fn((): Promise<ArrivalOutcome> => Promise.resolve("gone"));
    const floor = show({ arrivals: [arrival({ supplierName: "Govan Hire", arrivesAt: at("11:00"), leavesBy: null })], canMark: true, api: actions({ step }) });
    const tapped = screen.getByRole("button", { name: arrivedButton("Govan Hire") });
    tapped.focus();
    fireEvent.click(tapped);
    floor.view.rerender(<SuppliersSection {...floor.props} arrivals={[]} actions={{
      ...floor.props.actions,
      failures: new Map([[newArrivalKey(SLOT.bookingId), "Couldn’t mark that: Govan Hire is no longer on the board."]]),
    }} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Couldn’t mark that: Govan Hire is no longer on the board.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Suppliers" }));
  });

  it("puts the keyboard back where it came from: Keep and Cancel on what opened them, a removal and the add form on Add a supplier", async () => {
    show({ arrivals: [arrival()], canPlan: true });
    const changeButton = (): HTMLElement => screen.getByRole("button", { name: "Change The Kelvin Reelers" });
    const removeButton = (): HTMLElement => screen.getByRole("button", { name: "Remove The Kelvin Reelers" });
    const addButton = (): HTMLElement => screen.getByRole("button", { name: "Add a supplier" });

    fireEvent.click(removeButton());
    fireEvent.click(within(screen.getByRole("group", { name: "Remove The Kelvin Reelers?" })).getByRole("button", { name: "Keep" }));
    expect(document.activeElement).toBe(removeButton());

    fireEvent.click(changeButton());
    fireEvent.click(within(screen.getByRole("form", { name: "Change The Kelvin Reelers" })).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(changeButton());

    fireEvent.click(changeButton());
    fireEvent.click(within(screen.getByRole("form", { name: "Change The Kelvin Reelers" })).getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change The Kelvin Reelers" })).toBeNull(); });
    expect(document.activeElement).toBe(changeButton());

    fireEvent.click(addButton());
    fireEvent.click(within(screen.getByRole("form", { name: "Add a supplier" })).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(addButton());

    fireEvent.click(removeButton());
    fireEvent.click(within(screen.getByRole("group", { name: "Remove The Kelvin Reelers?" })).getByRole("button", { name: "Remove" }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(addButton());
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

  it("says it is reading the suppliers, to the floor too, not that there are none, until the read comes back", () => {
    show({ canPlan: true, api: actions({ status: "loading" }) });
    expect(screen.getByText("Reading the suppliers…")).toBeTruthy();
    expect(screen.queryByText(/No suppliers are/u)).toBeNull();
    cleanup();
    show({ canMark: true, api: actions({ status: "loading" }) });
    expect(screen.getByText("Reading the suppliers…")).toBeTruthy();
    cleanup();
    // Read, with none for this booking: the floor's panel says nothing at all.
    show({ canMark: true });
    expect(screen.queryByRole("region", { name: "Suppliers" })).toBeNull();
  });

  it("says no supplier is due on the board's day, rather than none for the booking", () => {
    show({ canPlan: true });
    expect(screen.getByText("No suppliers are due today for this booking.")).toBeTruthy();
    cleanup();
    // Next Saturday's board: the stand builder entered on another day is not this day's.
    show({ canPlan: true, today: false, boardDate: "2026-11-21", arrivals: [arrival()] });
    expect(screen.getByText("No suppliers are due for this booking on Sat 21 Nov.")).toBeTruthy();
    expect(screen.queryByText("The Kelvin Reelers")).toBeNull();
  });

  it("says when the suppliers could not be read, and shows Try again at work once pressed", () => {
    const api = actions({ status: "failed" });
    const { props, view } = show({ canMark: true, api });
    expect(screen.getByText("The suppliers could not be read just now.")).toBeTruthy();
    expect(screen.queryByText(/No suppliers are/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.refresh).toHaveBeenCalled();
    view.rerender(<SuppliersSection {...props} actions={{ ...api, reading: true }} />);
    expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-busy")).toBe("true");
  });
});
