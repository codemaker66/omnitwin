import { describe, expect, it } from "vitest";
import {
  crowdedDayInstant,
  crowdedDayOpenRequests,
  crowdedTradesHallDay,
  isUnownedRequest,
} from "@omnitwin/types";
import { deriveDayBoard, type DayBoard, type DayBoardSlot } from "../day-board-state.js";
import { boardWindow } from "../day-board-layout.js";
import { boardSummary, planeStages, roomDay, roomInFocus, summaryText } from "../day-board-rooms.js";
import { boardRange } from "../../../diary/lib/board-time.js";

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
  // A booking that runs for days names them; the rest read as clock times.
  expect(slot.timeRange, where).toMatch(/^(?:\d{2}:\d{2} – \d{2}:\d{2}|[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} – [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2})$/u);
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
    // Setup was due at two; the words say so rather than "0 min until setup".
    expect(prizeGiving.exceptionDetail).toBe("Bridgewrights' Society AGM not yet cleared · setup was due 14:00, doors 14:30");
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

describe("the rooms board on a crowded day, at its busiest moment (14:20)", () => {
  const busiest = board(day.busiestAtMs);
  const rooms = busiest.lanes.map(roomDay);
  const titles = (slots: readonly DayBoardSlot[]): readonly string[] => slots.map((slot) => slot.title);
  const room = (name: string): ReturnType<typeof roomDay> => {
    const found = rooms.find((candidate) => candidate.room.name === name);
    if (found === undefined) throw new Error(`No room ${name}`);
    return found;
  };

  it("reads each room as what has finished, what it is doing, what comes next and what comes after", () => {
    const grandHall = room("Grand Hall");
    expect(titles(grandHall.earlier)).toEqual(["Merchants' Breakfast Briefing", "Bridgewrights' Society AGM"]);
    expect(grandHall.lead?.title).toBe("Glasgow Schools Prize Giving");
    expect(grandHall.next?.title).toBe("Morrison–Adeyemi wedding · dinner and ceilidh");
    expect(grandHall.later).toEqual([]);
    expect(grandHall.tone).toBe("red");

    const saloon = room("Saloon");
    expect(saloon.lead?.title).toBe("Morrison–Adeyemi wedding · ceremony");
    expect(saloon.next?.title).toBe("Book launch: The Clyde at Night");
    expect(titles(saloon.later)).toEqual(["Speyside whisky tasting"]);
    expect(saloon.tone).toBe("live");

    // Every slot of the day is in exactly one of the four.
    for (const day of rooms) {
      const read = [...day.earlier, ...(day.lead === null ? [] : [day.lead]), ...(day.next === null ? [] : [day.next]), ...day.later];
      expect(new Set(read.map((slot) => slot.bookingId))).toEqual(new Set(day.slots.map((slot) => slot.bookingId)));
      expect(read).toHaveLength(day.slots.length);
    }
  });

  it("counts the day on the plane, and each count finds the rooms it names", () => {
    const stages = planeStages(busiest.lanes);
    expect(stages.map((stage) => [stage.label, stage.count])).toEqual([
      ["At risk", 2], ["Requests waiting", busiest.unowned.length], ["Live", 3], ["Setting up", 1], ["Still to come", 7], ["Bookings", 21],
    ]);
    expect(rooms.filter((day) => roomInFocus(day, "risk")).map((day) => day.room.name)).toEqual(["Grand Hall", "South Gallery"]);
    expect(rooms.filter((day) => roomInFocus(day, "live")).map((day) => day.room.name))
      .toEqual(["Saloon", "Robert Adam Room", "North Gallery"]);
    expect(rooms.filter((day) => roomInFocus(day, "all"))).toHaveLength(6);
  });

  it("says what matters in one sentence: the rooms at risk, the requests nobody has, the rooms live", () => {
    const parts = boardSummary({ lanes: busiest.lanes, unowned: busiest.unowned, today: true, nowMs: day.busiestAtMs });
    expect(parts).not.toBeNull();
    expect(summaryText(parts ?? [])).toBe(
      `Two rooms need you now: Grand Hall and South Gallery. ${String(busiest.unowned.length)} requests have no one on them; the longest has waited 1 h 50. Three rooms are live and one is getting ready.`,
    );
    expect(parts?.filter((part) => typeof part !== "string" && part.tone === "risk")).toEqual([{ strong: "Two rooms", tone: "risk" }]);
  });

  it("counts the exhibition in its days, and names them", () => {
    const exhibition = slotTitled(busiest, "Exhibition: Glasgow Trades in Print");
    expect(exhibition.countdown).toBe("LIVE · day 3 of 5");
    expect(exhibition.timeRange).toBe("Thu 12 Nov, 10:00 – Mon 16 Nov, 17:00");
  });

  it("keeps the night off the board: the exhibition's earlier days do not drag the window to midnight", () => {
    const window = boardWindow(boardRange(day.busiestAtMs, "day", TIME_ZONE), busiest.lanes, day.busiestAtMs, TIME_ZONE);
    // Half an hour before the breakfast's seven o'clock setup.
    expect(window.fromMs).toBe(at("06:30"));
    // A midnight-to-midnight day: the wedding's dinner runs past its end.
    expect(window.toMs).toBe(at("00:00", 1));
    // On the venue's own day, to four in the morning, the dinner ends at half
    // past midnight and clears down for the Grand Hall's hour (its own rule
    // is more specific than the ninety minutes after a wedding).
    const venueDay = { view: "day" as const, fromMs: at("00:00"), toMs: at("04:00", 1) };
    expect(boardWindow(venueDay, busiest.lanes, day.busiestAtMs, TIME_ZONE)).toEqual({ fromMs: at("06:30"), toMs: at("02:00", 1) });
  });
});
