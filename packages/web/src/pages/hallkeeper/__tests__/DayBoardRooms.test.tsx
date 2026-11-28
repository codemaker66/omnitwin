import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CalendarResponse } from "@omnitwin/types";
import { boardRange } from "../../diary/lib/board-time.js";
import { deriveDayBoard } from "../lib/day-board-state.js";
import { roomDay } from "../lib/day-board-rooms.js";
import { RoomRow } from "../DayBoardRooms.js";

// ---------------------------------------------------------------------------
// The bar under a room's day draws a short turn-round as a red rule from the
// end of the booking it runs from (the one its words measure) to the next
// setup, not from whatever is listed before it: a talk held inside a running
// exhibition, or a first option beside the second, is not where it runs from.
// ---------------------------------------------------------------------------

afterEach(() => { cleanup(); });

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const TZ = "Europe/London";
/** 13:00 on a summer Wednesday in Glasgow. */
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = boardRange(NOW, "day", TZ);
/** 10:00 to 20:00: ten hours, so half an hour is 5% of the bar. */
const VIEW = { fromMs: NOW - 3 * HOUR, toMs: NOW + 7 * HOUR };

function response(entries: CalendarResponse["entries"]): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: new Date(DAY.fromMs).toISOString(), to: new Date(DAY.toMs).toISOString() },
    rooms: [{ id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries,
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
    turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }],
  };
}

/** A booking in the Grand Hall, its times in minutes from 13:00; a hold when it has a rank. */
function booking(id: string, title: string, startOffsetMin: number, endOffsetMin: number, rank: number | null = null): CalendarResponse["entries"][number] {
  const kind = rank === null ? "ink" : "hold";
  return {
    entryType: "booking", id, spaceId: GRAND_HALL, kind, status: "active", state: kind, title, eventType: "dinner",
    startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(), endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    rank, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  } as CalendarResponse["entries"][number];
}

/** The room's red rules, each as where along the bar it starts and how far it runs. */
function rules(entries: CalendarResponse["entries"]): string[] {
  const lane = deriveDayBoard(response(entries), NOW, TZ).lanes[0];
  if (lane === undefined) throw new Error("no lane");
  const { container } = render(
    <ul>
      <RoomRow day={roomDay(lane)} view={VIEW} plaque={null} nowMs={NOW} venueSlug={null} selectedId={null} onOpen={() => undefined} wall={false} frozen={false} />
    </ul>,
  );
  return [...container.querySelectorAll<HTMLElement>(".dayboard-bar-gap")].map((rule) => `${rule.style.left} for ${rule.style.width}`);
}

describe("the day bar's short turn-round", () => {
  it("runs from the exhibition's end to the dinner's setup, not from a talk held inside the exhibition", () => {
    // Exhibition 10:00–18:00 with a talk 10:30–11:00 inside it; dinner at
    // 18:30, half an hour after the exhibition where the house needs an hour.
    expect(rules([
      booking("exhibition", "Exhibition", -180, 300),
      booking("talk", "Talk", -150, -120),
      booking("dinner", "Dinner", 330, 570),
    ])).toEqual(["80% for 5%"]);
    // The rule draws what the dinner's words say.
    expect(screen.getByRole("button", { name: /^Dinner,/u }).textContent).toContain("Turn-round 30 min · needs 1 h");
  });

  it("runs a second option's from the lunch before both options, not from the first option beside it", () => {
    // Lunch 12:00–14:00, then a 1st and a 2nd option from 14:30.
    expect(rules([
      booking("lunch", "Lunch", -60, 60),
      booking("first", "Awards dinner", 90, 390, 1),
      booking("second", "Charity dinner", 90, 390, 2),
    ])).toEqual(["40% for 5%", "40% for 5%"]);
  });
});
