import { describe, expect, it } from "vitest";
import {
  crowdedDayInstant,
  crowdedDayOpenRequests,
  crowdedTradesHallDay,
  isUnownedRequest,
} from "@omnitwin/types";
import { deriveDayBoard, type DayBoard, type DayBoardSlot } from "../day-board-state.js";

// ---------------------------------------------------------------------------
// The Day Board on a crowded Trades Hall day (L9; goal 05 "every slot's
// severity is legible in a crowded day"; goal 19 D3 and D12).
//
// The fixture is one Saturday in all six published rooms: twenty-one
// functions, a wedding through three rooms and past midnight, the North
// Gallery's install, a tight changeover, a room seen and not yet cleared, and
// sixteen open requests. Read at its busiest moment and swept across the
// whole day, the board must say every slot's state in words and an icon, never
// colour alone; keep the lanes in order without overlaps; put every unowned
// request on the rail; lead with the urgent one nobody has; and always know
// when it next has to change.
// ---------------------------------------------------------------------------

const day = crowdedTradesHallDay();
const open = crowdedDayOpenRequests(day);
const TIME_ZONE = day.timeZone;
const at = (time: string, dayOffset = 0): number => Date.parse(crowdedDayInstant(day.date, time, dayOffset));

function board(nowMs: number): DayBoard {
  return deriveDayBoard(day.calendar, nowMs, TIME_ZONE, open, day.observations);
}

function slotTitled(derived: DayBoard, title: string): DayBoardSlot {
  const slot = derived.lanes.flatMap((lane) => lane.slots).find((candidate) => candidate.title === title);
  if (slot === undefined) throw new Error(`No slot ${title} on the board`);
  return slot;
}

/** Meaning in words and an icon, so colour never carries it alone. */
function expectLegible(slot: DayBoardSlot, when: string): void {
  const where = `${slot.title} at ${when}`;
  expect(slot.stateLabel.trim().length, where).toBeGreaterThan(0);
  expect(slot.countdown.trim().length, where).toBeGreaterThan(0);
  expect(slot.icon.length, where).toBeGreaterThan(0);
  expect(slot.timeRange, where).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2}$/u);
}

describe("the Day Board on a crowded day, at its busiest moment (14:20)", () => {
  const busiest = board(day.busiestAtMs);
  const slots = busiest.lanes.flatMap((lane) => lane.slots);

  it("draws all six rooms in the venue's order, with every function of the day", () => {
    expect(busiest.lanes.map((lane) => lane.room.name)).toEqual([
      "Grand Hall", "Saloon", "Reception Room", "Robert Adam Room", "North Gallery", "South Gallery",
    ]);
    expect(slots).toHaveLength(21);
    for (const slot of slots) expectLegible(slot, "14:20");
  });

  it("says each room's moment in its own words", () => {
    expect(slotTitled(busiest, "Morrison–Adeyemi wedding · ceremony")).toMatchObject({ state: "live", stateLabel: "Live" });
    expect(slotTitled(busiest, "Morrison–Adeyemi wedding · ceremony").countdown).toBe("LIVE · 1 h 20 elapsed");
    expect(slotTitled(busiest, "Digital skills workshop (afternoon)").state).toBe("live");
    expect(slotTitled(busiest, "Morrison–Adeyemi wedding · drinks reception")).toMatchObject({
      state: "organisers-due", countdown: "Setting up · doors 15:00",
    });
    expect(slotTitled(busiest, "Merchants' Breakfast Briefing")).toMatchObject({ state: "done", stateLabel: "Cleaned" });
    expect(slotTitled(busiest, "Morrison–Adeyemi wedding · dinner and ceilidh").state).toBe("scheduled");
  });

  it("calls the prize giving's changeover at risk: the AGM was seen done and nobody has cleared it", () => {
    const prizeGiving = slotTitled(busiest, "Glasgow Schools Prize Giving");
    expect(prizeGiving).toMatchObject({ state: "exception", exception: "turnaround-at-risk", stateLabel: "Changeover at risk" });
    expect(prizeGiving.countdown).toBe("Changeover at risk · Doors · 10 min");
    expect(prizeGiving.exceptionDetail).toContain("Bridgewrights' Society AGM not yet cleared");
    expect(prizeGiving.gapBefore).toEqual({ minutes: 30, neededMinutes: 60, short: true });
    // The one tight changeover of the day; every other gap is wide enough.
    expect(slots.filter((slot) => slot.gapBefore?.short === true).map((slot) => slot.title)).toEqual(["Glasgow Schools Prize Giving"]);
  });

  it("names the other rooms of a function that moves between them", () => {
    expect([...slotTitled(busiest, "Morrison–Adeyemi wedding · ceremony").linkedRooms].sort())
      .toEqual(["Grand Hall", "Reception Room"]);
    expect(slotTitled(busiest, "Private view: Glasgow Trades in Print").linkedRooms).toEqual(["North Gallery"]);
  });

  it("puts every unowned request on the rail, and leads with the urgent one nobody has", () => {
    const unowned = open.filter((request) => isUnownedRequest({ state: request.state, ownerUserId: request.ownerUserId }));
    expect(unowned.length).toBeGreaterThanOrEqual(10);
    expect(new Set(busiest.unowned.map((request) => request.id))).toEqual(new Set(unowned.map((request) => request.id)));
    const urgent = open.find((request) => request.urgency === "now" && request.ownerUserId === null);
    expect(busiest.nextAction).toMatchObject({ kind: "request", requestId: urgent?.id });
    expect(busiest.nextAction.line).toContain("Chairs × 6");
  });

  it("rings the slots that have work open, and owns what is owned", () => {
    const ceremony = slotTitled(busiest, "Morrison–Adeyemi wedding · ceremony");
    expect(ceremony.requests).toHaveLength(3);
    expect(ceremony.attention?.level).toBe("urgent");
    const workshop = slotTitled(busiest, "Digital skills workshop (afternoon)");
    expect(workshop.requests).toHaveLength(3);
    // A finished request leaves the slab.
    expect(slotTitled(busiest, "Merchants' Breakfast Briefing").requests).toHaveLength(0);
  });
});

describe("the Day Board on a crowded day, swept from 06:00 to 01:00", () => {
  it("says every slot in words and an icon at every quarter hour, keeps each lane in time order, and always knows when it next changes", () => {
    for (let nowMs = at("06:00"); nowMs <= at("01:00", 1); nowMs += 15 * 60_000) {
      const derived = board(nowMs);
      const when = new Date(nowMs).toISOString();
      for (const lane of derived.lanes) {
        for (let index = 0; index < lane.slots.length; index += 1) {
          const slot = lane.slots[index];
          if (slot === undefined) continue;
          expectLegible(slot, when);
          const previous = lane.slots[index - 1];
          if (previous !== undefined) expect(slot.startsAtMs, `${lane.room.name} at ${when}`).toBeGreaterThanOrEqual(previous.endsAtMs);
          if (slot.nextBoundaryMs !== null) expect(slot.nextBoundaryMs, `${slot.title} at ${when}`).toBeGreaterThan(nowMs);
        }
      }
      if (derived.nextBoundaryMs !== null) expect(derived.nextBoundaryMs).toBeGreaterThan(nowMs);
      expect(derived.nextAction.line.trim().length).toBeGreaterThan(0);
    }
  });

  it("runs the wedding's dinner past midnight and only then lets it go", () => {
    expect(slotTitled(board(at("23:50")), "Morrison–Adeyemi wedding · dinner and ceilidh").state).toBe("live");
    expect(slotTitled(board(at("00:40", 1)), "Morrison–Adeyemi wedding · dinner and ceilidh").state).toBe("clear-down");
  });
});
