import { describe, expect, it } from "vitest";
import type { SupplierArrival } from "@omnitwin/types";
import { summaryText } from "../day-board-rooms.js";
import { arrivalNotices, arrivalParts, isLateAtDoor } from "../supplier-notices.js";

// ---------------------------------------------------------------------------
// What today's sentence says of suppliers: who is late at the door (ten
// minutes past due, until they would have left) and who is due within the
// next hour, for bookings on the board, until someone marks them in. Past
// three, the late are counted rather than named.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const DINNER = "00000000-0000-4000-8000-0000000000b1";
const ELSEWHERE = "00000000-0000-4000-8000-0000000000b9";
const at = (time: string): string => `2026-11-14T${time}:00.000Z`;
const ON_BOARD = new Set([DINNER]);

let n = 0;
function arrival(name: string, arrives: string, overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, venueId: VENUE, bookingId: DINNER, supplierName: name,
    category: null, arrivesAt: at(arrives), leavesBy: null, entrance: null, contact: null, note: null,
    arrivedAt: null, arrivedByName: null, leftAt: null, leftByName: null, revision: 1, updatedAt: at("09:00"), ...overrides,
  };
}

const NOW = Date.parse(at("14:00"));

describe("arrivalNotices", () => {
  it("names a supplier ten minutes past due as late, and one due within the next hour as soon", () => {
    const notices = arrivalNotices([
      arrival("Thistle & Fern Flowers", "13:45"),
      arrival("Ferry Road Cakes", "13:55"),
      arrival("Govan Hire", "14:00"),
      arrival("Clydeside Kitchen Co.", "14:30"),
      arrival("The Kelvin Reelers", "20:30"),
    ], ON_BOARD, NOW);
    expect(notices.late.map((item) => item.supplierName)).toEqual(["Thistle & Fern Flowers"]);
    // Just past due is neither: never "is due at" a time already gone.
    expect(notices.soon.map((item) => item.supplierName)).toEqual(["Govan Hire", "Clydeside Kitchen Co."]);
  });

  it("agrees with the panel on who is late", () => {
    expect(isLateAtDoor(arrival("Thistle & Fern Flowers", "13:45"), NOW)).toBe(true);
    expect(isLateAtDoor(arrival("Ferry Road Cakes", "13:55"), NOW)).toBe(false);
    expect(isLateAtDoor(arrival("In already", "13:30", { arrivedAt: at("13:31") }), NOW)).toBe(false);
    expect(isLateAtDoor(arrival("Would have gone", "12:00", { leavesBy: at("13:00") }), NOW)).toBe(false);
  });

  it("leaves out whoever is in, a booking not on the board, and one who would have left", () => {
    const notices = arrivalNotices([
      arrival("In already", "13:30", { arrivedAt: at("13:31") }),
      arrival("Another booking", "13:30", { bookingId: ELSEWHERE }),
      arrival("Would have gone", "12:00", { leavesBy: at("13:00") }),
      arrival("Three hours on", "10:30"),
    ], ON_BOARD, NOW);
    expect([...notices.late, ...notices.soon]).toEqual([]);
  });
});

describe("arrivalParts", () => {
  it("says one late supplier by name, in copper, and one due soon with their door", () => {
    const parts = arrivalParts({
      late: [arrival("Thistle & Fern Flowers", "13:30")],
      soon: [arrival("Clydeside Kitchen Co.", "14:30", { entrance: "the kitchen lift" })],
    }, "Europe/London");
    expect(summaryText(parts.late)).toBe("Thistle & Fern Flowers is late: due at 13:30.");
    expect(parts.late[0]).toEqual({ strong: "Thistle & Fern Flowers", tone: "copper" });
    expect(summaryText(parts.soon)).toBe("Clydeside Kitchen Co. is due at 14:30 (the kitchen lift).");
  });

  it("counts several, naming the late", () => {
    const parts = arrivalParts({
      late: [arrival("Thistle & Fern Flowers", "13:30"), arrival("Ferry Road Cakes", "13:40")],
      soon: [arrival("A", "14:10"), arrival("B", "14:20"), arrival("C", "14:50")],
    }, "Europe/London");
    expect(summaryText(parts.late)).toBe("Two suppliers are late: Thistle & Fern Flowers and Ferry Road Cakes.");
    expect(summaryText(parts.soon)).toBe("Three suppliers are due within the hour.");
  });

  it("ends with one full stop after a name that has its own", () => {
    const parts = arrivalParts({ late: [arrival("Thistle & Fern Flowers", "13:30"), arrival("Clydeside Kitchen Co.", "13:40")], soon: [] }, "Europe/London");
    expect(summaryText(parts.late)).toBe("Two suppliers are late: Thistle & Fern Flowers and Clydeside Kitchen Co.");
  });

  it("counts the late past three rather than naming them all", () => {
    const late = ["A", "B", "C", "D"].map((name, index) => arrival(name, `13:${String(10 + index)}`));
    expect(summaryText(arrivalParts({ late: late.slice(0, 3), soon: [] }, "Europe/London").late)).toBe("Three suppliers are late: A, B and C.");
    expect(summaryText(arrivalParts({ late, soon: [] }, "Europe/London").late)).toBe("Four suppliers are late.");
  });
});
