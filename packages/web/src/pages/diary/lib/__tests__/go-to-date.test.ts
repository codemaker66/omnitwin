import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarRoom } from "@omnitwin/types";
import { parseGoToDate, roomsOnDay, saidWeekday, type RoomAnswer } from "../go-to-date.js";

const TODAY = "2026-09-27";

describe("parseGoToDate", () => {
  it.each([
    ["5 Jun 27", "2027-06-05"],
    ["5 June 2027", "2027-06-05"],
    ["5th of June 2027", "2027-06-05"],
    ["the 5th of June 2027", "2027-06-05"],
    ["Sat 5 Jun 2027", "2027-06-05"],
    ["June 5, 2027", "2027-06-05"],
    ["05/06/2027", "2027-06-05"],
    ["Sat 05/06/2027", "2027-06-05"],
    ["5/6/27", "2027-06-05"],
    ["5.6.27", "2027-06-05"],
    ["2027-06-05", "2027-06-05"],
    ["  5 SEPT 2027 ", "2027-09-05"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseGoToDate(input, TODAY)).toBe(expected);
  });

  it("takes a date without a year as its next occurrence from today", () => {
    expect(parseGoToDate("5 Jun", TODAY)).toBe("2027-06-05");
    expect(parseGoToDate("30 Sept", TODAY)).toBe("2026-09-30");
    expect(parseGoToDate("27 Sep", TODAY)).toBe("2026-09-27");
    expect(parseGoToDate("29 Feb", TODAY)).toBe("2028-02-29");
  });

  it("knows today and tomorrow, across a month's end", () => {
    expect(parseGoToDate("today", TODAY)).toBe(TODAY);
    expect(parseGoToDate("tomorrow", "2026-09-30")).toBe("2026-10-01");
  });

  it.each(["31 Feb 2027", "30/02/27", "5 Juno 27", "next week", "13/13/2027", "", "2027-02-30", "wedding 5 June"])("refuses %j", (input) => {
    expect(parseGoToDate(input, TODAY)).toBeNull();
  });
});

describe("saidWeekday", () => {
  it("hears the weekday said before a date, however it is spelled", () => {
    expect(saidWeekday("Fri 5 Jun 27")).toBe(5);
    expect(saidWeekday("Saturday the 5th of June")).toBe(6);
    expect(saidWeekday("thurs. 3 June")).toBe(4);
    expect(saidWeekday("Sun, 6 June 2027")).toBe(0);
    expect(saidWeekday("Fri 19/09/2026")).toBe(5);
  });

  it("hears none where none was said", () => {
    expect(saidWeekday("5 Jun 27")).toBeNull();
    expect(saidWeekday("05/06/2027")).toBeNull();
    expect(saidWeekday("wedding 5 June")).toBeNull();
  });
});

describe("roomsOnDay", () => {
  const HALL = "00000000-0000-4000-8000-0000000000a1";
  const SALOON = "00000000-0000-4000-8000-0000000000a2";
  const ADAM = "00000000-0000-4000-8000-0000000000a3";
  const GALLERY = "00000000-0000-4000-8000-0000000000a4";
  const ROOMS: readonly CalendarRoom[] = [
    { id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
    { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    { id: ADAM, name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 2 },
    { id: GALLERY, name: "North Gallery", slug: "north-gallery", sortOrder: 3 },
  ];
  const DAY = { startMs: Date.parse("2027-06-04T23:00:00.000Z"), endMs: Date.parse("2027-06-05T23:00:00.000Z") };
  let next = 0;
  function entry(overrides: Partial<CalendarBookingEntry>): CalendarBookingEntry {
    next += 1;
    return {
      entryType: "booking", id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`, spaceId: HALL, kind: "hold",
      status: "active", state: "hold", title: "Booking", eventType: null, startsAt: "2027-06-05T13:00:00.000Z",
      endsAt: "2027-06-05T22:00:00.000Z", rank: 1, jointFlag: false, decisionAt: null, ownerUserId: null,
      nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
    };
  }
  const titles = (answer: RoomAnswer | undefined): readonly string[] => answer?.bookings.map((booking) => booking.title) ?? [];

  it("lists what holds each room that day in time order, and leaves out a hold behind a confirmed booking", () => {
    const entries = [
      entry({ spaceId: HALL, kind: "ink", state: "ink", rank: null, title: "Hammermen dinner", startsAt: "2027-06-05T17:00:00.000Z" }),
      // Overlaps the dinner, so the dinner has that time.
      entry({ spaceId: HALL, rank: 1, title: "Behind the dinner", startsAt: "2027-06-05T18:00:00.000Z" }),
      // A lunch held 1st option on its own ladder, before the dinner.
      entry({ spaceId: HALL, rank: 1, title: "Guild lunch", startsAt: "2027-06-05T10:00:00.000Z", endsAt: "2027-06-05T14:00:00.000Z" }),
      entry({ spaceId: SALOON, rank: 2, title: "Guild dinner", decisionAt: "2026-10-20T11:00:00.000Z" }),
      entry({ spaceId: SALOON, rank: 1, title: "Fraser wedding", decisionAt: "2026-10-12T11:00:00.000Z" }),
      entry({ spaceId: ADAM, kind: "internal_block", state: "internal_block", rank: null, title: "Floor polish" }),
      entry({ spaceId: GALLERY, kind: "hold", status: "released", state: "released", title: "Gone" }),
    ];
    const answers = roomsOnDay(entries, ROOMS, DAY);
    expect(answers.map((answer) => answer.room)).toEqual(["Grand Hall", "Saloon", "Robert Adam Room", "North Gallery"]);
    expect(titles(answers[0])).toEqual(["Guild lunch", "Hammermen dinner"]);
    // Same start: the ladder's order.
    expect(titles(answers[1])).toEqual(["Fraser wedding", "Guild dinner"]);
    expect(titles(answers[2])).toEqual(["Floor polish"]);
    expect(answers[3]).toEqual({ roomId: GALLERY, room: "North Gallery", bookings: [], interest: [], freeFromMs: null });
  });

  it("keeps each hold's own place on its ladder, so two 1st options are not a joint 1st", () => {
    const entries = [
      entry({ spaceId: HALL, rank: 1, jointFlag: false, title: "Morning seminar", startsAt: "2027-06-05T08:00:00.000Z", endsAt: "2027-06-05T11:00:00.000Z" }),
      entry({ spaceId: HALL, rank: 1, jointFlag: false, title: "Evening ball" }),
      entry({ spaceId: SALOON, rank: 2, title: "Second in line" }),
    ];
    const answers = roomsOnDay(entries, ROOMS, DAY);
    expect(answers[0]?.bookings.map((booking) => [booking.title, booking.rank, booking.jointFlag])).toEqual([
      ["Morning seminar", 1, false],
      ["Evening ball", 1, false],
    ]);
    expect(answers[1]?.bookings.map((booking) => booking.rank)).toEqual([2]);
  });

  it("notes interest only on a free day, and ignores the next day", () => {
    const entries = [
      entry({ spaceId: SALOON, kind: "prospect", state: "prospect", rank: null, title: "Law Society" }),
      entry({ spaceId: HALL, kind: "prospect", state: "prospect", rank: null, title: "Beside a booking" }),
      entry({ spaceId: HALL, rank: 1, title: "Fraser wedding" }),
      entry({ spaceId: ADAM, kind: "ink", state: "ink", rank: null, title: "Next day",
        startsAt: "2027-06-05T23:00:00.000Z", endsAt: "2027-06-06T02:00:00.000Z" }),
    ];
    const answers = roomsOnDay(entries, ROOMS, DAY);
    expect(titles(answers[0])).toEqual(["Fraser wedding"]);
    expect(answers[0]?.interest).toEqual([]);
    expect(answers[1]).toMatchObject({ bookings: [], interest: ["Law Society"], freeFromMs: null });
    expect(answers[2]).toMatchObject({ bookings: [], interest: [], freeFromMs: null });
  });

  it("leaves a room free from when the night before's event ends in the small hours", () => {
    const entries = [
      // Friday's wedding dances until 01:00 on Saturday.
      entry({ spaceId: HALL, kind: "ink", state: "ink", rank: null, title: "Friday wedding",
        startsAt: "2027-06-04T14:00:00.000Z", endsAt: "2027-06-05T00:00:00.000Z" }),
      // A conference that began on Friday and runs through Saturday takes it.
      entry({ spaceId: SALOON, kind: "ink", state: "ink", rank: null, title: "Law conference",
        startsAt: "2027-06-04T07:00:00.000Z", endsAt: "2027-06-05T16:00:00.000Z" }),
      // Interest only never holds the room, late or not.
      entry({ spaceId: ADAM, kind: "prospect", state: "prospect", rank: null, title: "Late interest",
        startsAt: "2027-06-04T20:00:00.000Z", endsAt: "2027-06-05T01:00:00.000Z" }),
      // A house block through the night until 06:00 is still the night's.
      entry({ spaceId: GALLERY, kind: "internal_block", state: "internal_block", rank: null, title: "Floor polish",
        startsAt: "2027-06-04T21:00:00.000Z", endsAt: "2027-06-05T05:00:00.000Z" }),
    ];
    const answers = roomsOnDay(entries, ROOMS, DAY);
    expect(answers[0]).toMatchObject({ bookings: [], freeFromMs: Date.parse("2027-06-05T00:00:00.000Z") });
    expect(titles(answers[1])).toEqual(["Law conference"]);
    expect(answers[2]).toMatchObject({ bookings: [], interest: [], freeFromMs: null });
    expect(answers[3]).toMatchObject({ bookings: [], freeFromMs: Date.parse("2027-06-05T05:00:00.000Z") });
  });

  it("counts an event that runs on past 06:00 as the day's", () => {
    const entries = [
      entry({ spaceId: HALL, kind: "ink", state: "ink", rank: null, title: "All-night ball",
        startsAt: "2027-06-04T19:00:00.000Z", endsAt: "2027-06-05T05:30:00.000Z" }),
    ];
    expect(titles(roomsOnDay(entries, ROOMS, DAY)[0])).toEqual(["All-night ball"]);
  });
});
