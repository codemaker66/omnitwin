import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BuildingCheck, BuildingChecksDay } from "@omnitwin/types";
import { BuildingSection } from "../DayBoardBuilding.js";
import type { BuildingDay } from "../lib/building-day.js";
import type { BuildingChecksApi } from "../lib/use-building-checks.js";

// ---------------------------------------------------------------------------
// The building on the board: when it opens and locks up, the venue's own
// checks ticked by the floor, who is still in at lock-up, and the office's
// lists kept from the list they saw.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const TZ = "Europe/London";
const ms = (time: string, day = "14"): number => Date.parse(`2026-11-${day}T${time}:00.000Z`);

function check(id: string, kind: BuildingCheck["kind"], label: string, mark: BuildingCheck["mark"] = null, retired = false): BuildingCheck {
  return { id: `00000000-0000-4000-8000-00000000000${id}`, kind, label, retired, mark };
}

const DAY: BuildingChecksDay = {
  day: "2026-11-14",
  opening: [check("1", "opening", "Alarm unset", { doneAt: "2026-11-14T06:52:00.000Z", doneByName: "Jamie" }), check("2", "opening", "Fire exits unlocked and clear")],
  lockup: [check("3", "lockup", "Fire doors shut"), check("4", "lockup", "Alarm set")],
};

const BUILDING: BuildingDay = {
  openBy: { atMs: ms("07:00"), why: "Merchants' Breakfast Briefing sets up" },
  lockUpAfter: { atMs: ms("01:00", "15"), why: "Morrison–Adeyemi wedding clears" },
  stillIn: [],
};

function api(overrides: Partial<BuildingChecksApi> = {}): BuildingChecksApi {
  return {
    status: "ready", day: DAY, busy: new Set(), failure: null, refresh: vi.fn(),
    tick: vi.fn(() => Promise.resolve(true)), replace: vi.fn(() => Promise.resolve(true)), ...overrides,
  };
}

function show(props: { building?: BuildingDay; api?: BuildingChecksApi; canTick?: boolean; canPlan?: boolean }) {
  const used = props.api ?? api();
  render(<BuildingSection building={props.building ?? BUILDING} api={used} boardDate="2026-11-14" timeZone={TZ} canTick={props.canTick ?? true} canPlan={props.canPlan ?? false} />);
  fireEvent.click(screen.getByText("The building"));
  return used;
}

describe("BuildingSection", () => {
  it("says in one line when the building opens, when it can be locked up, and the checks done", () => {
    show({});
    const section = screen.getByRole("region", { name: "The building" });
    expect(within(section).getByText("Open by 07:00 · Lock up after 01:00, after midnight · opening 1 of 2 · lock-up 0 of 2")).toBeTruthy();
    expect(within(section).getByText("· Merchants' Breakfast Briefing sets up", { exact: false })).toBeTruthy();
  });

  it("lets the floor tick a check, and says who ticked one and when", () => {
    const used = show({});
    const opening = screen.getByRole("group", { name: "Opening checks" });
    expect(within(opening).getByText("Jamie · 06:52")).toBeTruthy();
    fireEvent.click(within(opening).getByRole("checkbox", { name: "Fire exits unlocked and clear" }));
    expect(used.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Fire exits unlocked and clear" }), true);
    // Taking a tick back is the same box.
    fireEvent.click(within(opening).getByRole("checkbox", { name: "Alarm unset" }));
    expect(used.tick).toHaveBeenCalledWith(expect.objectContaining({ label: "Alarm unset" }), false);
  });

  it("names whoever is still in at lock-up", () => {
    show({ building: { ...BUILDING, stillIn: [{ supplierName: "The Kelvin Reelers", arrivedAt: "2026-11-14T20:34:00.000Z", arrivesAt: "2026-11-14T20:30:00.000Z" } as BuildingDay["stillIn"][number]] } });
    expect(screen.getByText("Still in the building: The Kelvin Reelers (in at 20:34).")).toBeTruthy();
  });

  it("offers no ticking where the floor may not, and no list changes outside the office", () => {
    show({ canTick: false });
    for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Change the/u })).toBeNull();
  });

  it("says a building with no checks has none, and asks the office to write its own", () => {
    show({ api: api({ day: { day: "2026-11-14", opening: [], lockup: [] } }) });
    expect(screen.getByText("No opening checks are set up. The office can write the building’s own.")).toBeTruthy();
    cleanup();
    show({ api: api({ day: { day: "2026-11-14", opening: [], lockup: [] } }), canPlan: true });
    expect(screen.getByText("No opening checks yet. Write the building’s own.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write the opening checks" })).toBeTruthy();
  });

  it("lets the office rename, move, take off and add checks, and saves the list as left", async () => {
    const used = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change the lock-up checks" }));
    const form = screen.getByRole("form", { name: "Change the lock-up checks" });
    fireEvent.click(within(form).getByRole("button", { name: "Move “Alarm set” up" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Lock-up checks, 1" }), { target: { value: "Alarm set, all zones" } });
    fireEvent.click(within(form).getByRole("button", { name: "Take “Fire doors shut” off" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Lock-up checks, 2" }), { target: { value: "Keys back in the safe" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save the list" }));
    await waitFor(() => { expect(used.replace).toHaveBeenCalled(); });
    expect(used.replace).toHaveBeenCalledWith("lockup", [
      { id: check("4", "lockup", "").id, label: "Alarm set, all zones" },
      { label: "Keys back in the safe" },
    ]);
  });

  it("asks for each check's words before it saves", () => {
    const used = show({ canPlan: true });
    fireEvent.click(screen.getByRole("button", { name: "Change the opening checks" }));
    const form = screen.getByRole("form", { name: "Change the opening checks" });
    fireEvent.click(within(form).getByRole("button", { name: "Add a check" }));
    fireEvent.submit(form);
    expect(screen.getByText("Write each check, or take it off.")).toBeTruthy();
    expect(used.replace).not.toHaveBeenCalled();
  });

  it("says when the checks could not be read, with Try again", () => {
    const used = show({ api: api({ status: "failed", day: null }) });
    expect(screen.getByText("The building’s checks could not be read just now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(used.refresh).toHaveBeenCalled();
  });
});
