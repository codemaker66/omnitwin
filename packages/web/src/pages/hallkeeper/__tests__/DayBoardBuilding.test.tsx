import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { BuildingCheck, BuildingChecksDay, SupplierArrival } from "@omnitwin/types";
import { BuildingSection, type BuildingSuppliers } from "../DayBoardBuilding.js";
import type { BuildingDay } from "../lib/building-day.js";
import type { BuildingChecksApi, CheckOutcome } from "../lib/use-building-checks.js";
import type { ArrivalOutcome } from "../lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The building on the board: when it opens and locks up, or what holds it
// across the day's edge; whoever is marked in and not out, with Gone; the
// venue's own checks ticked by the floor, a tick taken back by whoever made
// it or the office; last night's lock-up while it may still be ticked; and
// the office's lists saved from the list the editor opened on, on today's
// board or a later one. While the suppliers are read, or could not be, the
// line says so; one marked gone here stays named, with Undo. What changes
// under the keyboard keeps it in the section, and is said.
// November is on GMT, so these UTC times are the venue's clock.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const TZ = "Europe/London";
const ms = (time: string, day = "14"): number => Date.parse(`2026-11-${day}T${time}:00.000Z`);
const JAMIE = "00000000-0000-4000-8000-0000000000f1";
const ELAINE = "00000000-0000-4000-8000-0000000000f2";
const NOW = ms("15:00");

function check(id: string, kind: BuildingCheck["kind"], label: string, mark: BuildingCheck["mark"] = null, retired = false): BuildingCheck {
  return { id: `00000000-0000-4000-8000-00000000000${id}`, kind, label, retired, mark };
}

const tick = (doneAt: string, doneByName = "Jamie", doneByUserId: string | null = JAMIE): BuildingCheck["mark"] => ({ doneAt, doneByUserId, doneByName });

const DAY: BuildingChecksDay = {
  day: "2026-11-14",
  opening: [check("1", "opening", "Alarm unset", tick("2026-11-14T06:52:00.000Z")), check("2", "opening", "Fire exits unlocked and clear")],
  lockup: [check("3", "lockup", "Fire doors shut"), check("4", "lockup", "Alarm set")],
};

const BUILDING: BuildingDay = {
  openBy: { atMs: ms("07:00"), why: "Merchants' Breakfast Briefing sets up" },
  lockUpAfter: { atMs: ms("01:00", "15"), why: "Morrison–Adeyemi wedding clears" },
  heldFrom: null,
  heldUntil: null,
  longHolds: [],
  stillIn: [],
};

const saved = (): Promise<CheckOutcome> => Promise.resolve("saved");

function api(overrides: Partial<BuildingChecksApi> = {}): BuildingChecksApi {
  return {
    status: "ready", reading: false, day: DAY, busy: new Set(), failures: new Map(), refresh: vi.fn(),
    tick: vi.fn(saved), replace: vi.fn(saved), ...overrides,
  };
}

function inside(name: string, arrivedAt: string): SupplierArrival {
  return {
    id: `00000000-0000-4000-8000-0000000007${String(name.length).padStart(2, "0")}`, venueId: "00000000-0000-4000-8000-000000000001",
    bookingId: "00000000-0000-4000-8000-0000000000b1", supplierName: name, category: null, arrivesAt: arrivedAt, leavesBy: null,
    entrance: null, contact: null, note: null, arrivedAt, arrivedByName: "Elaine", leftAt: null, leftByName: null, revision: 1, updatedAt: arrivedAt,
  };
}

const arrived = (): Promise<ArrivalOutcome> => Promise.resolve("saved");

function suppliersApi(overrides: Partial<BuildingSuppliers> = {}): BuildingSuppliers {
  return {
    status: "ready", reading: false, arrivals: [], earlier: [], busy: new Set(), failures: new Map(), refresh: vi.fn(),
    step: vi.fn(arrived), undo: vi.fn(arrived), ...overrides,
  };
}

interface Shown {
  readonly building?: BuildingDay;
  readonly api?: BuildingChecksApi;
  readonly lastNight?: { readonly api: BuildingChecksApi; readonly canTick: boolean } | null;
  readonly canTick?: boolean;
  readonly canPlan?: boolean;
  readonly current?: boolean;
  readonly canMark?: boolean;
  readonly userId?: string | null;
  readonly suppliers?: BuildingSuppliers;
}

function show(shown: Shown, open = true) {
  const props = {
    building: shown.building ?? BUILDING,
    api: shown.api ?? api(),
    lastNight: shown.lastNight ?? null,
    boardDate: "2026-11-14",
    dayBoundaryHour: 4,
    timeZone: TZ,
    nowMs: NOW,
    userId: shown.userId === undefined ? JAMIE : shown.userId,
    canTick: shown.canTick ?? true,
    tickNote: "Checks are ticked on the day itself, and last night’s the morning after.",
    canPlan: shown.canPlan ?? false,
    current: shown.current ?? true,
    canMark: shown.canMark ?? false,
    suppliers: shown.suppliers ?? suppliersApi(),
  };
  const view = render(<BuildingSection {...props} />);
  if (open) fireEvent.click(screen.getByText("The building"));
  return { props, view };
}

/** What a box is described by, read as one string. */
function description(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

/**
 * The section as the page holds it, with a stand-in for the suppliers' hook:
 * Gone and Undo answer with the arrival as it now stands, and the day's
 * still-in list follows from it.
 */
function WithSuppliers({ start, step, undo }: {
  readonly start: readonly SupplierArrival[];
  readonly step: (arrival: SupplierArrival) => Promise<ArrivalOutcome>;
  readonly undo: (arrival: SupplierArrival) => Promise<ArrivalOutcome>;
}): ReactElement {
  const [arrivals, setArrivals] = useState(start);
  const settle = (id: string, leftAt: string | null): void => {
    setArrivals((current) => current.map((item) => (item.id === id ? { ...item, leftAt, leftByName: leftAt === null ? null : "Jamie" } : item)));
  };
  const suppliers = suppliersApi({
    arrivals,
    step: async (arrival) => { const outcome = await step(arrival); if (outcome === "saved") settle(arrival.id, new Date(NOW).toISOString()); return outcome; },
    undo: async (arrival) => { const outcome = await undo(arrival); if (outcome === "saved") settle(arrival.id, null); return outcome; },
  });
  const building = { ...BUILDING, stillIn: arrivals.filter((item) => item.arrivedAt !== null && item.leftAt === null) };
  return (
    <BuildingSection building={building} api={api()} boardDate="2026-11-14" dayBoundaryHour={4} timeZone={TZ} nowMs={NOW}
      userId={JAMIE} canTick canPlan={false} canMark suppliers={suppliers} />
  );
}

describe("BuildingSection", () => {
  it("says in one line when the building opens, when it can be locked up, and the checks done", () => {
    show({});
    const section = screen.getByRole("region", { name: "The building" });
    expect(within(section).getByText("Open by 07:00 · Lock up after 01:00, after midnight · opening 1 of 2 · lock-up 0 of 2")).toBeTruthy();
    expect(within(section).getByText("· Merchants' Breakfast Briefing sets up", { exact: false })).toBeTruthy();
  });

  it("lets the floor tick a check, and says who ticked one and when", () => {
    const { props } = show({});
    const opening = screen.getByRole("group", { name: "Opening checks" });
    expect(within(opening).getByText("Jamie · 06:52")).toBeTruthy();
    fireEvent.click(within(opening).getByRole("checkbox", { name: "Fire exits unlocked and clear" }));
    expect(props.api.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Fire exits unlocked and clear" }), true);
    // Their own tick is taken back with the same box.
    fireEvent.click(within(opening).getByRole("checkbox", { name: "Alarm unset" }));
    expect(props.api.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Alarm unset" }), false);
  });

  it("leaves a colleague's tick for them or the office to take back", () => {
    show({ userId: ELAINE });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Alarm unset" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Fire exits unlocked and clear" }).disabled).toBe(false);
    cleanup();
    show({ userId: ELAINE, canPlan: true });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Alarm unset" }).disabled).toBe(false);
  });

  it("says the day a tick was made when it is not the list's own", () => {
    show({ api: api({ day: { ...DAY, opening: [check("1", "opening", "Alarm unset", tick("2026-11-13T16:00:00.000Z"))] } }) });
    expect(screen.getByText("Jamie · 16:00 on Fri 13 Nov")).toBeTruthy();
  });

  it("offers no ticking where the floor may not, and no list changes outside the office", () => {
    show({ canTick: false });
    for (const box of screen.getAllByRole<HTMLInputElement>("checkbox")) expect(box.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Change the/u })).toBeNull();
  });

  it("names whoever is marked in and not out, with Gone, even when the checks could not be read", async () => {
    const { props } = show({
      api: api({ status: "failed", day: null }),
      building: { ...BUILDING, stillIn: [inside("Clyde Staging", "2026-11-13T20:05:00.000Z"), inside("Thistle & Fern Flowers", "2026-11-14T11:31:00.000Z")] },
      canMark: true,
    });
    const section = screen.getByRole("region", { name: "The building" });
    expect(within(section).getByText(/2 marked in, not out$/u)).toBeTruthy();
    const still = within(section).getByRole("group", { name: "Marked in, not out" });
    expect(within(still).getByText("Clyde Staging · in at 20:05 on Fri 13 Nov")).toBeTruthy();
    expect(within(still).getByText("Thistle & Fern Flowers · in at 11:31")).toBeTruthy();
    fireEvent.click(within(still).getByRole("button", { name: "Clyde Staging gone" }));
    expect(props.suppliers.step).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "Clyde Staging" }), "left");
    await act(async () => { await Promise.resolve(); });
  });

  it("stays on the board for the floor when there are no checks but the building has times or people in it", () => {
    const empty = api({ day: { day: "2026-11-14", opening: [], lockup: [] } });
    show({ api: empty, building: { ...BUILDING, openBy: null } }, false);
    expect(screen.getByRole("region", { name: "The building" })).toBeTruthy();
    cleanup();
    show({ api: api({ status: "failed", day: null }), building: { ...BUILDING, openBy: null, lockUpAfter: null } }, false);
    expect(screen.getByRole("region", { name: "The building" })).toBeTruthy();
    cleanup();
    // With nothing to say at all, the floor's board leaves it out.
    show({ api: empty, building: { ...BUILDING, openBy: null, lockUpAfter: null } }, false);
    expect(screen.queryByRole("region", { name: "The building" })).toBeNull();
  });

  it("names a booking running for days beside the day's own times, and its hours as not on the Diary", () => {
    const exhibition = { title: "Glasgow Trades in Print", fromMs: ms("09:00", "12"), toMs: ms("17:45", "16"), setsUp: true, days: true, provisional: false, startsToday: false, endsToday: false };
    show({ building: { ...BUILDING, longHolds: [exhibition] } });
    expect(screen.getByText("Open by 07:00 · Lock up after 01:00, after midnight · Glasgow Trades in Print runs all day · opening 1 of 2 · lock-up 0 of 2")).toBeTruthy();
    expect(screen.getByText("Glasgow Trades in Print runs from Thu 12 Nov to Mon 16 Nov; its daily hours are not on the Diary.")).toBeTruthy();
    cleanup();
    show({ building: { ...BUILDING, openBy: null, lockUpAfter: null, longHolds: [{ ...exhibition, startsToday: true }] } });
    expect(screen.getByText("Glasgow Trades in Print runs on to Mon 16 Nov · opening 1 of 2 · lock-up 0 of 2")).toBeTruthy();
    cleanup();
    show({ building: { ...BUILDING, openBy: null, longHolds: [{ ...exhibition, endsToday: true }] } });
    expect(screen.getByText(/^Lock up after 01:00, after midnight · Glasgow Trades in Print ends today/u)).toBeTruthy();
    cleanup();
    const conference = { title: "Trades conference", fromMs: ms("22:00", "13"), toMs: ms("18:00"), setsUp: true, days: false, provisional: false };
    show({ building: { ...BUILDING, openBy: null, heldFrom: conference } });
    expect(screen.getByText(/^Open since last night · Lock up after 01:00/u)).toBeTruthy();
    expect(screen.getByText("Open since last night: Trades conference sets up through the night.")).toBeTruthy();
    cleanup();
    show({ building: { ...BUILDING, lockUpAfter: null, heldUntil: { ...conference, fromMs: ms("22:00"), toMs: ms("18:00", "15") } } });
    expect(screen.getByText(/^Open by 07:00 · No lock-up tonight/u)).toBeTruthy();
    expect(screen.getByText("No lock-up tonight: Trades conference sets up through the night.")).toBeTruthy();
    cleanup();
    // A provisional booking says so wherever it is named.
    show({ building: { ...BUILDING, longHolds: [{ ...exhibition, title: "Burns weekend", provisional: true }], heldUntil: { ...conference, provisional: true }, lockUpAfter: null } });
    expect(screen.getByText(/· Burns weekend \(provisional\) runs all day ·/u)).toBeTruthy();
    expect(screen.getByText("Burns weekend (provisional) runs from Thu 12 Nov to Mon 16 Nov; its daily hours are not on the Diary.")).toBeTruthy();
    expect(screen.getByText("No lock-up tonight: Trades conference (provisional) sets up through the night.")).toBeTruthy();
  });

  it("puts last night's lock-up on the board while it is not done, ticked against last night", () => {
    const lastNight = api({ day: { day: "2026-11-13", opening: [], lockup: [check("5", "lockup", "Alarm set", tick("2026-11-14T01:10:00.000Z")), check("6", "lockup", "Keys in the safe")] } });
    show({ lastNight: { api: lastNight, canTick: true } });
    expect(screen.getByText(/· last night’s lock-up 1 of 2 ·/u)).toBeTruthy();
    const list = screen.getByRole("group", { name: "Last night’s lock-up, Fri 13 Nov" });
    fireEvent.click(within(list).getByRole("checkbox", { name: "Keys in the safe" }));
    expect(lastNight.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Keys in the safe" }), true);
    cleanup();
    // Done, it leaves the board.
    const doneNight = api({ day: { day: "2026-11-13", opening: [], lockup: [check("5", "lockup", "Alarm set", tick("2026-11-14T01:10:00.000Z"))] } });
    show({ lastNight: { api: doneNight, canTick: true } });
    expect(screen.queryByRole("group", { name: /Last night’s lock-up/u })).toBeNull();
  });

  it("says why a tick failed beside its own check", () => {
    show({ api: api({ failures: new Map([[check("2", "opening", "").id, "Couldn’t tick that: the server refused it."]]) }) });
    const opening = screen.getByRole("group", { name: "Opening checks" });
    const item = within(opening).getByText("Fire exits unlocked and clear").closest("li");
    if (item === null) throw new Error("no list item");
    expect(within(item).getByRole("status").textContent).toBe("Couldn’t tick that: the server refused it.");
  });

  it("says a building with no checks has none, and asks the office to write its own", () => {
    const empty = api({ day: { day: "2026-11-14", opening: [], lockup: [] } });
    show({ api: empty });
    expect(screen.getByText("No opening checks are set up. The office can write the building’s own.")).toBeTruthy();
    cleanup();
    show({ api: empty, canPlan: true });
    expect(screen.getByText("No opening checks yet. Write the building’s own.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write the opening checks" })).toBeTruthy();
  });

  it("lets the office rename, move, take off and add checks, and saves the list from the one it opened", async () => {
    const { props, view } = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change the lock-up checks" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Lock-up checks, 1" }));
    // A colleague's list arrives while the editor is open: the save still names the list it opened on.
    const newer = api({ day: { ...DAY, lockup: [...DAY.lockup, check("7", "lockup", "Keys back in the safe")] }, replace: props.api.replace });
    view.rerender(<BuildingSection {...props} api={newer} />);
    const form = screen.getByRole("form", { name: "Change the lock-up checks" });
    fireEvent.click(within(form).getByRole("button", { name: "Move “Alarm set” up" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Lock-up checks, 1" }), { target: { value: "Alarm set, all zones" } });
    fireEvent.click(within(form).getByRole("button", { name: "Take “Fire doors shut” off" }));
    // The keyboard stays in the list.
    expect(document.activeElement).toBe(within(form).getByRole("textbox", { name: "Lock-up checks, 1" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    expect(document.activeElement).toBe(within(form).getByRole("textbox", { name: "Lock-up checks, 2" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Lock-up checks, 2" }), { target: { value: "Heating off" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save the list" }));
    await waitFor(() => { expect(props.api.replace).toHaveBeenCalled(); });
    expect(props.api.replace).toHaveBeenCalledWith("lockup", [
      { id: check("4", "lockup", "").id, label: "Alarm set, all zones" },
      { label: "Heating off" },
    ], [check("3", "lockup", "").id, check("4", "lockup", "").id]);
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change the lock-up checks" })).toBeNull(); });
  });

  it("closes the editor when someone changed the list first, and keeps it when the save did not go", async () => {
    const stale = vi.fn(() => Promise.resolve<CheckOutcome>("stale"));
    show({ canPlan: true, api: api({ replace: stale }) });
    fireEvent.click(screen.getByRole("button", { name: "Change the opening checks" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Change the opening checks" })).getByRole("button", { name: "Save the list" }));
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Change the opening checks" })).toBeNull(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change the opening checks" }));
    cleanup();
    const failed = vi.fn(() => Promise.resolve<CheckOutcome>("failed"));
    show({ canPlan: true, api: api({ replace: failed }) });
    fireEvent.click(screen.getByRole("button", { name: "Change the opening checks" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Change the opening checks" })).getByRole("button", { name: "Save the list" }));
    await waitFor(() => { expect(failed).toHaveBeenCalled(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("form", { name: "Change the opening checks" })).toBeTruthy();
  });

  it("holds a list to forty checks, and asks for each check's words before it saves", () => {
    const forty = Array.from({ length: 40 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`, kind: "opening" as const, label: `Check ${String(index + 1)}`, retired: false, mark: null,
    }));
    const { props } = show({ canPlan: true, api: api({ day: { ...DAY, opening: forty } }) });
    fireEvent.click(screen.getByRole("button", { name: "Change the opening checks" }));
    const form = screen.getByRole("form", { name: "Change the opening checks" });
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    expect(within(form).getAllByRole("textbox")).toHaveLength(40);
    expect(within(form).getByText("A list holds 40 checks at most.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Take “Check 1” off" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    fireEvent.submit(form);
    expect(screen.getByText("Write each check, or take it off.")).toBeTruthy();
    expect(props.api.replace).not.toHaveBeenCalled();
  });

  it("says when the checks could not be read, and shows Try again at work once pressed", () => {
    const { props, view } = show({ api: api({ status: "failed", day: null }) });
    expect(screen.getByText("The building’s checks could not be read just now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.api.refresh).toHaveBeenCalled();
    view.rerender(<BuildingSection {...props} api={{ ...props.api, reading: true }} />);
    expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-busy")).toBe("true");
  });

  it("says on the line while the suppliers are read, and when they could not be, with who is in as last read", () => {
    const stillIn = [inside("Clyde Staging", "2026-11-13T20:05:00.000Z")];
    show({ building: { ...BUILDING, stillIn: [] }, suppliers: suppliersApi({ status: "loading" }) }, false);
    const line = screen.getByText(/reading the suppliers…$/u);
    expect(line.textContent).toBe("Open by 07:00 · Lock up after 01:00, after midnight · opening 1 of 2 · lock-up 0 of 2 · reading the suppliers…");
    expect(line.querySelector("[data-activity-indicator]")).not.toBeNull();
    cleanup();
    const refresh = vi.fn();
    show({ building: { ...BUILDING, stillIn }, suppliers: suppliersApi({ status: "failed", earlier: stillIn, refresh }), canMark: true });
    expect(screen.getByText("Open by 07:00 · Lock up after 01:00, after midnight · opening 1 of 2 · lock-up 0 of 2 · 1 marked in, not out, as last read · suppliers could not be read")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Marked in, not out, as last read" })).toBeTruthy();
    expect(screen.getByText("The suppliers could not be read just now, so these times, and who is marked in, may leave someone out.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalled();
    cleanup();
    // With nothing else to say, a read that failed still shows the section.
    show({ api: api({ day: { day: "2026-11-14", opening: [], lockup: [] } }), building: { ...BUILDING, openBy: null, lockUpAfter: null },
      suppliers: suppliersApi({ status: "failed" }) }, false);
    expect(screen.getByText("suppliers could not be read")).toBeTruthy();
  });

  it("keeps a supplier marked gone here named with Undo, says so, and keeps the keyboard on the row", async () => {
    const clyde = inside("Clyde Staging", "2026-11-13T20:05:00.000Z");
    const flowers = inside("Thistle & Fern Flowers", "2026-11-14T11:31:00.000Z");
    const step = vi.fn(arrived);
    const undo = vi.fn(arrived);
    render(<WithSuppliers start={[clyde, flowers]} step={step} undo={undo} />);
    fireEvent.click(screen.getByText("The building"));
    expect(screen.getByText(/· 2 marked in, not out$/u)).toBeTruthy();
    const still = screen.getByRole("group", { name: "Marked in, not out" });
    const gone = within(still).getByRole("button", { name: "Clyde Staging gone" });
    gone.focus();
    fireEvent.click(gone);
    const back = await within(still).findByRole("button", { name: "Undo: Clyde Staging marked gone" });
    expect(step).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "Clyde Staging" }));
    expect(within(still).getByText("Clyde Staging · in at 20:05 on Fri 13 Nov, gone at 15:00")).toBeTruthy();
    await waitFor(() => { expect(document.activeElement).toBe(back); });
    expect(within(still).getByText("Clyde Staging marked gone.")).toBeTruthy();
    expect(screen.getByText(/· 1 marked in, not out$/u)).toBeTruthy();
    // The wrong row, put back where it was tapped.
    fireEvent.click(back);
    const again = await within(still).findByRole("button", { name: "Clyde Staging gone" });
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "Clyde Staging" }));
    await waitFor(() => { expect(document.activeElement).toBe(again); });
    expect(within(still).getByText("Clyde Staging no longer marked gone.")).toBeTruthy();
    expect(screen.getByText(/· 2 marked in, not out$/u)).toBeTruthy();
  });

  it("offers the lists' changes only on today's board or a later one, never from a past day's list", () => {
    show({ canPlan: true, current: false });
    expect(screen.queryByRole("button", { name: /Change the/u })).toBeNull();
    cleanup();
    show({ canPlan: true, current: false, api: api({ day: { day: "2026-11-14", opening: [], lockup: [] } }) });
    expect(screen.getByText("No opening checks were set up for this day.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Write the/u })).toBeNull();
  });

  it("says last night's lock-up is done once its last check is ticked, and keeps the keyboard in the section", async () => {
    const open = api({ day: { day: "2026-11-13", opening: [], lockup: [check("5", "lockup", "Keys in the safe")] } });
    const { props, view } = show({ lastNight: { api: open, canTick: true } });
    const box = within(screen.getByRole("group", { name: "Last night’s lock-up, Fri 13 Nov" })).getByRole("checkbox", { name: "Keys in the safe" });
    box.focus();
    fireEvent.click(box);
    expect(open.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Keys in the safe" }), true);
    // The tick lands: the list is done, and leaves.
    const doneNight = api({ day: { day: "2026-11-13", opening: [], lockup: [check("5", "lockup", "Keys in the safe", tick("2026-11-14T05:10:00.000Z"))] } });
    box.blur();
    view.rerender(<BuildingSection {...props} lastNight={{ api: doneNight, canTick: true }} />);
    expect(screen.queryByRole("group", { name: /Last night’s lock-up/u })).toBeNull();
    await waitFor(() => { expect(screen.getByText("Last night’s lock-up is done.")).toBeTruthy(); });
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Lock-up checks" }));
  });

  it("keeps the keyboard on a moved check, and says where it went", () => {
    show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change the lock-up checks" }));
    const form = screen.getByRole("form", { name: "Change the lock-up checks" });
    const down = within(form).getByRole("button", { name: "Move “Fire doors shut” down" });
    down.focus();
    fireEvent.click(down);
    // At the foot of the list its down arrow stops: the keyboard goes to its words.
    expect(document.activeElement).toBe(within(form).getByRole("textbox", { name: "Lock-up checks, 2" }));
    expect(within(form).getByRole<HTMLInputElement>("textbox", { name: "Lock-up checks, 2" }).value).toBe("Fire doors shut");
    expect(within(form).getByText("“Fire doors shut” moved to 2 of 2.")).toBeTruthy();
    const up = within(form).getByRole("button", { name: "Move “Fire doors shut” up" });
    up.focus();
    fireEvent.click(up);
    expect(document.activeElement).toBe(within(form).getByRole("textbox", { name: "Lock-up checks, 1" }));
    // Moved within the list, it keeps the arrow it was moved with.
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Lock-up checks, 3" }), { target: { value: "Keys back in the safe" } });
    const keys = within(form).getByRole("button", { name: "Move “Keys back in the safe” up" });
    keys.focus();
    fireEvent.click(keys);
    expect(document.activeElement).toBe(within(form).getByRole("button", { name: "Move “Keys back in the safe” up" }));
    expect(within(form).getByRole<HTMLInputElement>("textbox", { name: "Lock-up checks, 2" }).value).toBe("Keys back in the safe");
    expect(within(form).getByText("“Keys back in the safe” moved to 2 of 3.")).toBeTruthy();
  });

  it("names a new check by its place, and takes the keyboard to the first check still without words", () => {
    const { props } = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change the opening checks" }));
    const form = screen.getByRole("form", { name: "Change the opening checks" });
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    expect(within(form).getByRole("button", { name: "Move new check 3 up" })).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Take new check 3 off" })).toBeTruthy();
    within(form).getByRole("button", { name: "Add a check" }).focus();
    fireEvent.submit(form);
    const empty = within(form).getByRole("textbox", { name: "Opening checks, 3" });
    expect(document.activeElement).toBe(empty);
    expect(empty.getAttribute("aria-invalid")).toBe("true");
    expect(description(empty)).toBe("Write each check, or take it off.");
    expect(within(form).getByText("Write each check, or take it off.").getAttribute("role")).toBe("status");
    expect(props.api.replace).not.toHaveBeenCalled();
  });

  it("reads who ticked a check, and why a box cannot be ticked, with the box", () => {
    show({ userId: ELAINE });
    expect(description(screen.getByRole("checkbox", { name: "Alarm unset" }))).toBe("Jamie · 06:52 Jamie ticked this. Only they, or the office, can take it back.");
    expect(description(screen.getByRole("checkbox", { name: "Fire exits unlocked and clear" }))).toBe("");
    cleanup();
    show({ canTick: false });
    expect(description(screen.getByRole("checkbox", { name: "Fire exits unlocked and clear" }))).toBe("Checks are ticked on the day itself, and last night’s the morning after.");
    expect(description(screen.getByRole("checkbox", { name: "Alarm unset" }))).toBe("Jamie · 06:52 Checks are ticked on the day itself, and last night’s the morning after.");
  });
});
