import { describe, expect, it } from "vitest";
import { BuildingChecksDayQuerySchema, buildingBoardDay, buildingTickDays } from "../building-checks.js";

// ---------------------------------------------------------------------------
// Opening and lock-up's day rules (T-693): the board day an instant falls on,
// by the venue's clock and boundary hour, and the days a check may be ticked
// on now: the venue's own, and the one before for eight hours after the board
// rolls, since a night's lock-up may run past the boundary.
// ---------------------------------------------------------------------------

const TZ = "Europe/London";
const at = (iso: string): number => Date.parse(iso);

describe("buildingBoardDay", () => {
  it("puts the hours before the boundary on the day before, on the venue's clock", () => {
    expect(buildingBoardDay(at("2026-11-15T03:59:00.000Z"), 4, TZ)).toBe("2026-11-14");
    expect(buildingBoardDay(at("2026-11-15T04:00:00.000Z"), 4, TZ)).toBe("2026-11-15");
    expect(buildingBoardDay(at("2026-11-15T00:30:00.000Z"), 0, TZ)).toBe("2026-11-15");
    // 03:30 UTC on 15 June is 04:30 BST: the 15th's own day.
    expect(buildingBoardDay(at("2026-06-15T03:30:00.000Z"), 4, TZ)).toBe("2026-06-15");
    // 02:30 UTC on 28 March 2027 is 03:30 BST, the clocks gone forward: still the 27th's night.
    expect(buildingBoardDay(at("2027-03-28T02:30:00.000Z"), 4, TZ)).toBe("2027-03-27");
  });
});

describe("buildingTickDays", () => {
  it("keeps last night tickable for eight hours after the board rolls", () => {
    // The board rolls at 04:00; at 05:00 and until 12:00, Saturday night may still be ticked.
    expect(buildingTickDays(at("2026-12-06T05:00:00.000Z"), 4, TZ)).toEqual(["2026-12-05", "2026-12-06"]);
    expect(buildingTickDays(at("2026-12-06T11:59:00.000Z"), 4, TZ)).toEqual(["2026-12-05", "2026-12-06"]);
    expect(buildingTickDays(at("2026-12-06T12:00:00.000Z"), 4, TZ)).toEqual(["2026-12-06"]);
    // Before the roll, it is still Saturday's board.
    expect(buildingTickDays(at("2026-12-06T03:30:00.000Z"), 4, TZ)).toEqual(["2026-12-05"]);
    // A venue rolling at midnight keeps Saturday until 08:00.
    expect(buildingTickDays(at("2026-12-06T07:59:00.000Z"), 0, TZ)).toEqual(["2026-12-05", "2026-12-06"]);
    expect(buildingTickDays(at("2026-12-06T08:00:00.000Z"), 0, TZ)).toEqual(["2026-12-06"]);
  });
});

describe("BuildingChecksDayQuerySchema", () => {
  it("takes real dates only", () => {
    expect(BuildingChecksDayQuerySchema.safeParse({ day: "2026-11-14" }).success).toBe(true);
    expect(BuildingChecksDayQuerySchema.safeParse({ day: "2026-02-30" }).success).toBe(false);
    expect(BuildingChecksDayQuerySchema.safeParse({ day: "14/11/2026" }).success).toBe(false);
  });
});
