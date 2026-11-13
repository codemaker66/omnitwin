import { describe, expect, it } from "vitest";
import type { Booking, CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry, CalendarRoom } from "@omnitwin/types";
import { dayAnswer } from "../../../../pages/diary/lib/day-answer.js";
import { approveUnread, enquiryStanding, occasionFormat, type StandingInput } from "../enquiry-standing.js";

// ---------------------------------------------------------------------------
// Where an enquiry stands in the Diary, in the panel's words: every state the
// fact, the In the Diary list and Approve's sentence can be in. Days are
// worded by the Diary's own dayAnswer, as the panel words them.
// ---------------------------------------------------------------------------

const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const RECEPTION = "00000000-0000-4000-8000-0000000000a3";
const ADAM = "00000000-0000-4000-8000-0000000000a4";
const NORTH = "00000000-0000-4000-8000-0000000000a5";
const SOUTH = "00000000-0000-4000-8000-0000000000a6";
const ROOMS: readonly CalendarRoom[] = [
  { id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
  { id: RECEPTION, name: "Reception Room", slug: "reception-room", sortOrder: 2 },
  { id: ADAM, name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 3 },
  { id: NORTH, name: "North Gallery", slug: "north-gallery", sortOrder: 4 },
  { id: SOUTH, name: "South Gallery", slug: "south-gallery", sortOrder: 5 },
];
const ROOM_MAP = new Map(ROOMS.map((room) => [room.id, { name: room.name, slug: room.slug }]));

/** Friday 14 May 2027, midnight to midnight in Glasgow (BST). */
const DAY = { startMs: Date.parse("2027-05-13T23:00:00.000Z"), endMs: Date.parse("2027-05-14T23:00:00.000Z") };
/** Wednesday 14 October 2026. */
const NOW = Date.parse("2026-10-14T09:00:00.000Z");

let next = 0;
function entry(overrides: Partial<CalendarBookingEntry>): CalendarBookingEntry {
  next += 1;
  return {
    entryType: "booking", id: `00000000-0000-4000-9000-${String(next).padStart(12, "0")}`, spaceId: HALL, kind: "ink",
    status: "active", state: "ink", title: "Smith wedding", eventType: "wedding", startsAt: "2027-05-14T11:00:00.000Z",
    endsAt: "2027-05-14T22:00:00.000Z", rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
  };
}

function phase(overrides: Partial<CalendarPhaseEntry>): CalendarPhaseEntry {
  next += 1;
  return {
    entryType: "phase", id: `00000000-0000-4000-a000-${String(next).padStart(12, "0")}`, spaceId: SALOON,
    eventId: "00000000-0000-4000-b000-000000000001", eventName: "Fraser wedding", name: "Drinks reception",
    startsAt: "2027-05-14T16:00:00.000Z", endsAt: "2027-05-14T17:30:00.000Z", sortOrder: 0, ...overrides,
  };
}

/** The enquiry's own booking, as GET /bookings?enquiryId= serves it. */
function own(of: CalendarBookingEntry): Booking {
  return {
    id: of.id, venueId: "00000000-0000-4000-8000-0000000000f1", spaceId: of.spaceId, eventId: null, kind: of.kind,
    status: of.status, state: of.state, title: of.title, eventType: of.eventType, startsAt: of.startsAt, endsAt: of.endsAt,
    rank: of.rank, jointFlag: of.jointFlag, decisionAt: of.decisionAt, ownerUserId: null, nextAction: null,
    nextActionDueAt: null, seriesId: null, notes: null, createdBy: null, enquiryId: "00000000-0000-4000-8000-0000000000e1",
    createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

const ENQUIRY: StandingInput["enquiry"] = {
  state: "under_review", spaceId: HALL, roomChosen: true, estimatedGuests: 140, eventType: "wedding",
};

function standingFor(options: {
  readonly enquiry?: Partial<StandingInput["enquiry"]>;
  readonly entries?: readonly CalendarEntry[];
  readonly own?: readonly Booking[];
  readonly published?: boolean;
  readonly noDay?: boolean;
} = {}) {
  return enquiryStanding({
    enquiry: { ...ENQUIRY, ...options.enquiry },
    day: options.noDay === true ? null : { rooms: dayAnswer(options.entries ?? [], ROOMS, DAY, NOW), ...DAY },
    own: options.own ?? [],
    rooms: ROOM_MAP,
    published: options.published ?? true,
    nowMs: NOW,
  });
}

describe("the room asked for, that day", () => {
  it("is free, and Approve says nothing holds it for this enquiry yet", () => {
    const standing = standingFor();
    expect([standing.fact, standing.mark, standing.said]).toEqual(["Free", "free", "In the Diary: Free."]);
    expect(standing.approve).toBe("The Grand Hall is free that day. Nothing holds it for this enquiry yet.");
  });

  it("sets the guests against the room's published figure only when the room is smaller than the party", () => {
    const saloon = standingFor({ enquiry: { spaceId: SALOON } });
    expect(saloon.fact).toBe("Free · seats 60 for dinner");
    expect(saloon.approve).toBe("The Saloon is free that day and seats 60 for dinner. Nothing holds it for this enquiry yet.");
    // No figure is ever guessed: none without the venue's figures, a guest
    // count, or an occasion the public composer measures.
    expect(standingFor({ enquiry: { spaceId: SALOON }, published: false }).fact).toBe("Free");
    expect(standingFor({ enquiry: { spaceId: SALOON, estimatedGuests: null } }).fact).toBe("Free");
    expect(standingFor({ enquiry: { spaceId: SALOON, estimatedGuests: 0 } }).fact).toBe("Free");
    expect(standingFor({ enquiry: { spaceId: SALOON, eventType: "corporate" } }).fact).toBe("Free");
    expect(standingFor({ enquiry: { spaceId: SALOON, estimatedGuests: 40 } }).fact).toBe("Free");
  });

  it("says what has the room in the Diary's words, and Approve says the email does not mention it", () => {
    const standing = standingFor({ entries: [entry({})] });
    expect([standing.fact, standing.mark]).toEqual(["Confirmed, Smith wedding, 12:00–23:00", "taken"]);
    expect(standing.approve)
      .toBe("That day the Diary has the Grand Hall: Confirmed, Smith wedding, 12:00–23:00. The email does not mention it.");
  });

  it("says several bookings briefly, their titles left to the list", () => {
    const standing = standingFor({
      entries: [
        entry({ title: "Breakfast briefing", startsAt: "2027-05-14T07:00:00.000Z", endsAt: "2027-05-14T10:00:00.000Z" }),
        entry({ kind: "hold", state: "hold", rank: 1, title: "MacLeod wedding", startsAt: "2027-05-14T17:00:00.000Z",
          decisionAt: "2026-12-01T12:00:00.000Z" }),
      ],
    });
    expect(standing.fact).toBe("2 bookings: Confirmed 08:00–11:00 · 1st option 18:00–23:00, decides Tue 1 Dec");
    expect(standing.approve).toBe("That day the Diary has the Grand Hall: 2 bookings, Confirmed 08:00–11:00 · "
      + "1st option 18:00–23:00, decides Tue 1 Dec. The email does not mention it.");
    expect(standing.rooms[0]?.lines.map((line) => line.text)).toEqual([
      "Confirmed, Breakfast briefing, 08:00–11:00",
      "1st option MacLeod wedding, 18:00–23:00, decides Tue 1 Dec",
    ]);
  });

  it("says a decision that has passed as the Diary does", () => {
    const standing = standingFor({
      entries: [entry({ kind: "hold", state: "hold", rank: 1, title: "MacLeod wedding", decisionAt: "2026-10-05T12:00:00.000Z" })],
    });
    expect(standing.fact).toBe("1st option MacLeod wedding, 12:00–23:00, decision was due Mon 5 Oct");
  });

  it("counts another event's phase in the room as using it", () => {
    const standing = standingFor({ enquiry: { spaceId: SALOON }, entries: [phase({})] });
    expect([standing.fact, standing.mark]).toEqual(["In use for Fraser wedding (Drinks reception), 17:00–18:30", "taken"]);
  });

  it("says so when the room asked for is no longer in the Diary", () => {
    const standing = standingFor({ enquiry: { spaceId: "00000000-0000-4000-8000-0000000000ff" } });
    expect(standing.fact).toBe("The room asked for is not in the Diary");
    expect(standing.approve).toBe("The room asked for is not in the Diary, so this does not say whether it is free.");
  });
});

describe("the enquiry's own bookings", () => {
  it("lead when the room asked for is held for this enquiry, and are marked in the list", () => {
    const hold = entry({ kind: "hold", state: "hold", rank: 1, title: "Smith wedding", decisionAt: "2026-12-01T12:00:00.000Z" });
    const standing = standingFor({ entries: [hold], own: [own(hold)] });
    expect([standing.fact, standing.mark]).toEqual(["1st option for this enquiry, decides Tue 1 Dec", "own"]);
    expect(standing.approve).toBe("The Diary holds the Grand Hall for this enquiry: 1st option, decides Tue 1 Dec.");
    expect(standing.rooms[0]?.lines).toEqual([
      { key: hold.id, kind: "hold", text: "1st option Smith wedding, 12:00–23:00, decides Tue 1 Dec", own: true },
    ]);
    expect(standing.elsewhere).toEqual([]);
  });

  it("say when this enquiry's hold is behind a confirmed booking, which the day's lines leave out", () => {
    const hold = entry({ kind: "hold", state: "hold", rank: 2, title: "Smith wedding", decisionAt: "2026-12-01T12:00:00.000Z" });
    const ink = entry({ title: "Law Society dinner", startsAt: "2027-05-14T16:00:00.000Z" });
    const standing = standingFor({ entries: [hold, ink], own: [own(hold)] });
    expect(standing.fact).toBe("2nd option for this enquiry, behind Confirmed, Law Society dinner, 17:00–23:00");
    expect(standing.approve).toBe("That day the Diary has the Grand Hall: Confirmed, Law Society dinner, 17:00–23:00. "
      + "This enquiry is held behind it (2nd option). The email does not mention it.");
    expect(standing.elsewhere).toEqual([
      { key: hold.id, text: "2nd option for this enquiry: Grand Hall, Fri 14 May 2027, decides Tue 1 Dec" },
    ]);
  });

  it("lead from another date, and Approve says the email names a date that is not held", () => {
    const hold = entry({ spaceId: SALOON, kind: "hold", state: "hold", rank: 1, title: "Smith wedding",
      startsAt: "2027-05-21T11:00:00.000Z", endsAt: "2027-05-21T22:00:00.000Z", decisionAt: "2026-12-01T12:00:00.000Z" });
    const standing = standingFor({ own: [own(hold)] });
    expect(standing.fact).toBe("1st option for this enquiry: Saloon, Fri 21 May 2027, decides Tue 1 Dec");
    expect(standing.approve).toBe("The Diary holds the Saloon on Fri 21 May 2027 for this enquiry (1st option), not the date the email names.");
    expect(standing.elsewhere.map((line) => line.text)).toEqual([standing.fact]);
    // The day asked for is still listed, room by room.
    expect(standing.rooms.map((room) => room.name)[0]).toBe("Grand Hall");
  });

  it("lead from another room that day, which Approve names beside the room the email names", () => {
    const hold = entry({ spaceId: SALOON, kind: "hold", state: "hold", rank: 1, title: "Smith wedding" });
    const standing = standingFor({ entries: [hold], own: [own(hold)] });
    expect(standing.fact).toBe("1st option for this enquiry: Saloon, Fri 14 May 2027");
    expect(standing.approve).toBe("The Diary holds the Saloon for this enquiry that day (1st option), not the Grand Hall, which the email names.");
    expect(standing.rooms.find((room) => room.id === SALOON)?.lines[0]?.own).toBe(true);
  });

  it("say how many more there are", () => {
    const first = entry({ kind: "hold", state: "hold", rank: 1, title: "Smith wedding" });
    const second = entry({ spaceId: SALOON, kind: "hold", state: "hold", rank: 1, title: "Smith wedding",
      startsAt: "2027-05-21T11:00:00.000Z", endsAt: "2027-05-21T22:00:00.000Z" });
    expect(standingFor({ entries: [first], own: [own(second), own(first)] }).fact).toBe("1st option for this enquiry · 1 more below");
  });

  it("of a closed enquiry are all it says: what it still holds, or nothing", () => {
    const hold = entry({ kind: "hold", state: "hold", rank: 1, title: "Smith wedding" });
    const declined = { state: "rejected" };
    expect(standingFor({ enquiry: declined, own: [own(hold)], noDay: true }).fact)
      .toBe("Still held for this enquiry: 1st option, Grand Hall, Fri 14 May 2027");
    expect(standingFor({ enquiry: declined, noDay: true })).toMatchObject({ fact: "Nothing held for this enquiry", mark: "none" });
  });
});

describe("the enquiry's own viewing (migration 0100)", () => {
  /** A show-round for this enquiry: Saturday 10 April 2027, 14:00–15:00 BST. */
  function show(overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
    return entry({
      kind: "viewing", state: "viewing", title: "Smith wedding", eventType: null,
      startsAt: "2027-04-10T13:00:00.000Z", endsAt: "2027-04-10T14:00:00.000Z", ...overrides,
    });
  }

  it("reads as a viewing booked for its time and room, and never stands for the date asked for", () => {
    const viewing = show();
    const standing = standingFor({ own: [own(viewing)] });
    expect([standing.fact, standing.mark]).toEqual(["Free", "free"]);
    expect(standing.approve).toBe("The Grand Hall is free that day. Nothing holds it for this enquiry yet.");
    expect(standing.elsewhere).toEqual([
      { key: viewing.id, text: "Viewing for this enquiry: Grand Hall, Sat 10 Apr 2027, 14:00–15:00" },
    ]);
  });

  it("on the day and in the room asked for, leaves the room free: a show-round holds nothing", () => {
    const viewing = show({ startsAt: "2027-05-14T09:00:00.000Z", endsAt: "2027-05-14T10:00:00.000Z" });
    const standing = standingFor({ entries: [viewing], own: [own(viewing)] });
    expect([standing.fact, standing.mark]).toEqual(["Free", "free"]);
    expect(standing.rooms[0]?.lines).toEqual([{ key: "free", kind: "free", text: "Free", own: false }]);
    expect(standing.elsewhere.map((line) => line.text))
      .toEqual(["Viewing for this enquiry: Grand Hall, Fri 14 May 2027, 10:00–11:00"]);
  });

  it("lets the enquiry's hold lead, and is counted among those below", () => {
    const hold = entry({ kind: "hold", state: "hold", rank: 1, title: "Smith wedding", decisionAt: "2026-12-01T12:00:00.000Z" });
    const viewing = show();
    const standing = standingFor({ entries: [hold], own: [own(viewing), own(hold)] });
    expect([standing.fact, standing.mark]).toEqual(["1st option for this enquiry, decides Tue 1 Dec · 1 more below", "own"]);
    expect(standing.approve).toBe("The Diary holds the Grand Hall for this enquiry: 1st option, decides Tue 1 Dec.");
    expect(standing.elsewhere.map((line) => line.text))
      .toEqual(["Viewing for this enquiry: Grand Hall, Sat 10 Apr 2027, 14:00–15:00"]);
  });

  it("of a closed enquiry holds nothing, and is still listed", () => {
    const viewing = show();
    const standing = standingFor({ enquiry: { state: "rejected" }, own: [own(viewing)], noDay: true });
    expect([standing.fact, standing.mark]).toEqual(["Nothing held for this enquiry", "none"]);
    expect(standing.elsewhere).toHaveLength(1);
  });
});

describe("no room chosen", () => {
  const roomless = { roomChosen: false };

  it("names the free rooms that hold the guests by the published figure", () => {
    const standing = standingFor({ enquiry: roomless });
    expect([standing.fact, standing.mark]).toEqual(["Free and seats 140 for dinner: Grand Hall", "free"]);
    expect(standing.approve).toBe("No room was chosen. Free that day and seats 140 for dinner: Grand Hall.");
    const conference = standingFor({ enquiry: { ...roomless, eventType: "conference", estimatedGuests: 80 } });
    expect(conference.fact).toBe("Free and seats 80 theatre style: Grand Hall, Saloon, Reception Room and Robert Adam Room");
    expect(standingFor({ enquiry: { ...roomless, eventType: "reception", estimatedGuests: 200 } }).fact)
      .toBe("Free and holds 200 standing: Grand Hall");
  });

  it("says when no room that holds the guests is free, and when none holds them at all", () => {
    const taken = standingFor({ enquiry: roomless, entries: [entry({})] });
    expect([taken.fact, taken.mark]).toEqual(["No room that seats 140 for dinner is free", "taken"]);
    expect(taken.approve).toBe("No room was chosen. No room that seats 140 for dinner is free that day. The email does not mention it.");
    expect(standingFor({ enquiry: { ...roomless, estimatedGuests: 300 } }).fact).toBe("No room seats 300 for dinner");
  });

  it("counts the free rooms without a guest count, a format or published figures", () => {
    expect(standingFor({ enquiry: { ...roomless, estimatedGuests: null } }).fact).toBe("All 6 rooms free");
    const one = standingFor({ enquiry: { ...roomless, eventType: "private" }, entries: [entry({})] });
    expect(one.fact).toBe("5 of 6 rooms free");
    expect(one.approve).toBe("No room was chosen. 5 of 6 rooms free that day.");
    expect(standingFor({ enquiry: roomless, published: false }).fact).toBe("All 6 rooms free");
  });
});

describe("the In the Diary list", () => {
  it("puts the room asked for first, then the rooms that hold the guests, then the rest, with their figures", () => {
    const standing = standingFor({ enquiry: { spaceId: SALOON } });
    expect(standing.rooms.map((room) => [room.name, room.asked, room.figure])).toEqual([
      ["Saloon", true, "seats 60 for dinner"],
      ["Grand Hall", false, "seats 180 for dinner"],
      ["Reception Room", false, "seats 60 for dinner"],
      ["Robert Adam Room", false, "seats 60 for dinner"],
      ["North Gallery", false, "seats 40 for dinner"],
      ["South Gallery", false, "seats 40 for dinner"],
    ]);
    // Another venue's rooms of the same names never borrow Trades Hall's figures.
    expect(standingFor({ published: false }).rooms.every((room) => room.figure === null)).toBe(true);
  });
});

describe("without a day", () => {
  it("says there is no date to look up, and Approve says the Diary was not read", () => {
    const standing = standingFor({ noDay: true });
    expect([standing.fact, standing.rooms]).toEqual(["No date to look up", []]);
    expect(standing.approve).toBe("No date was given, so the Diary was not read.");
  });

  it("still leads with the enquiry's own booking, wherever it is", () => {
    const hold = entry({ spaceId: SALOON, kind: "hold", state: "hold", rank: 1, title: "Smith wedding" });
    const standing = standingFor({ own: [own(hold)], noDay: true });
    expect(standing.fact).toBe("1st option for this enquiry: Saloon, Fri 14 May 2027");
    expect(standing.approve).toBe("The Diary holds the Saloon on Fri 14 May 2027 for this enquiry: 1st option.");
  });
});

describe("approveUnread", () => {
  it("says what the confirmation cannot tell when the Diary could not be read", () => {
    expect(approveUnread({ roomChosen: true, preferredDate: "2027-05-14" }, "Grand Hall"))
      .toBe("The Diary could not be read, so this does not say whether the Grand Hall is free.");
    expect(approveUnread({ roomChosen: false, preferredDate: "2027-05-14" }, null))
      .toBe("The Diary could not be read, so this does not say which rooms are free that day.");
    expect(approveUnread({ roomChosen: true, preferredDate: null }, "Grand Hall"))
      .toBe("The Diary could not be read, so this does not say what it holds for this enquiry.");
  });
});

describe("occasionFormat", () => {
  it("reads an occasion by the public composer's formats, and guesses none for the rest", () => {
    expect(["wedding", "dinner", "conference", "reception", " Wedding "].map(occasionFormat))
      .toEqual(["dinner", "dinner", "theatre", "reception", "dinner"]);
    expect(["corporate", "Wedding reception", ""].map(occasionFormat)).toEqual([null, null, null]);
    expect(occasionFormat(null)).toBeNull();
  });
});
