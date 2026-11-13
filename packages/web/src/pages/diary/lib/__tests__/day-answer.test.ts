import { describe, expect, it } from "vitest";
import type { CalendarEntry, CalendarRoom } from "@omnitwin/types";
import { dayAnswer, freeRoomsSaid } from "../day-answer.js";

// ---------------------------------------------------------------------------
// A day, room by room, in the Diary's own words: what Go to date on the board
// and the staff header's Find both say about a date. Every kind of line is
// pinned here, so the two can never drift apart unnoticed.
// ---------------------------------------------------------------------------

const ROOMS: readonly CalendarRoom[] = [
  { id: "r1", name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: "r2", name: "Saloon", slug: "saloon", sortOrder: 1 },
  { id: "r3", name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 2 },
  { id: "r4", name: "Reception Room", slug: "reception-room", sortOrder: 3 },
  { id: "r5", name: "North Gallery", slug: "north-gallery", sortOrder: 4 },
  { id: "r6", name: "South Gallery", slug: "south-gallery", sortOrder: 5 },
  { id: "r7", name: "Lady Convenors' Room", slug: "lady-convenors", sortOrder: 6 },
];

function booking(id: string, spaceId: string, kind: string, title: string, startsAt: string, endsAt: string,
  extra: { readonly rank?: number | null; readonly jointFlag?: boolean; readonly decisionAt?: string | null; readonly eventId?: string } = {}): CalendarEntry {
  return {
    entryType: "booking", id, spaceId, kind, status: "active", state: kind, title, eventType: "dinner",
    startsAt, endsAt, rank: extra.rank ?? null, jointFlag: extra.jointFlag ?? false, decisionAt: extra.decisionAt ?? null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: extra.eventId ?? null, seriesId: null,
  } as CalendarEntry;
}

function phase(id: string, spaceId: string, eventId: string, name: string, startsAt: string, endsAt: string): CalendarEntry {
  return { entryType: "phase", id, spaceId, eventId, eventName: "Fraser wedding", name, startsAt, endsAt, sortOrder: 0 };
}

/** Saturday 14 November 2026, midnight to midnight in Glasgow (GMT). */
const DAY = { startMs: Date.parse("2026-11-14T00:00:00.000Z"), endMs: Date.parse("2026-11-15T00:00:00.000Z") };
/** Wednesday 7 October 2026. */
const NOW = Date.parse("2026-10-07T09:00:00.000Z");

const ENTRIES: readonly CalendarEntry[] = [
  booking("b1", "r1", "ink", "Fraser wedding", "2026-11-14T13:00:00.000Z", "2026-11-14T23:00:00.000Z"),
  booking("b2", "r2", "hold", "Burns supper", "2026-11-14T18:00:00.000Z", "2026-11-14T23:00:00.000Z",
    { rank: 2, decisionAt: "2026-11-10T12:00:00.000Z" }),
  booking("b3", "r3", "hold", "Guild dinner", "2026-11-14T18:00:00.000Z", "2026-11-14T22:00:00.000Z", { rank: 1, jointFlag: true }),
  booking("b4", "r4", "prospect", "Henderson enquiry", "2026-11-14T12:00:00.000Z", "2026-11-14T16:00:00.000Z"),
  // The night before's party runs into the small hours: the day itself is free from then.
  booking("b5", "r5", "ink", "Friday ceilidh", "2026-11-13T19:00:00.000Z", "2026-11-14T01:00:00.000Z"),
  booking("b6", "r6", "internal_block", "Floor polishing", "2026-11-14T08:00:00.000Z", "2026-11-14T10:00:00.000Z"),
  booking("b7", "r7", "hold", "Book launch", "2026-11-14T12:00:00.000Z", "2026-11-14T14:00:00.000Z", { rank: null }),
];

describe("dayAnswer", () => {
  const answer = dayAnswer(ENTRIES, ROOMS, DAY, NOW);
  const said = (id: string): readonly string[] => answer.find((room) => room.id === id)?.lines.map((line) => line.text) ?? [];
  const free = (id: string): boolean | undefined => answer.find((room) => room.id === id)?.free;

  it("names every room in the Diary's order", () => {
    expect(answer.map((room) => room.name)).toEqual(ROOMS.map((room) => room.name));
  });

  it("says a confirmed booking, a numbered option with its decision date, a joint 1st and a provisional hold", () => {
    expect(said("r1")).toEqual(["Confirmed, Fraser wedding, 13:00–23:00"]);
    expect(said("r2")).toEqual([expect.stringMatching(/^2nd option Burns supper, 18:00–23:00, decides Tue 10 Nov( 2026)?$/u)]);
    expect(said("r3")).toEqual(["Joint 1st Guild dinner, 18:00–22:00"]);
    expect(said("r7")).toEqual(["Provisional, Book launch, 12:00–14:00"]);
    expect([free("r1"), free("r2"), free("r3"), free("r7")]).toEqual([false, false, false, false]);
  });

  it("says a house block as the venue's own", () => {
    expect(said("r6")).toEqual(["House block, Floor polishing, 08:00–10:00"]);
    expect(free("r6")).toBe(false);
  });

  it("calls a room with interest only free, and says whose interest", () => {
    expect(said("r4")).toEqual(["Free, interest only from Henderson enquiry"]);
    expect(free("r4")).toBe(true);
  });

  it("calls a room free from when the night before's event ends in the small hours", () => {
    expect(said("r5")).toEqual(["Free from 01:00"]);
    expect(free("r5")).toBe(true);
  });

  it("keeps each line's kind, the booking it words, and a brief form without the title", () => {
    const lines = (id: string) => answer.find((room) => room.id === id)?.lines ?? [];
    expect(lines("r1")).toEqual([
      { key: "b1", kind: "confirmed", bookingId: "b1", text: "Confirmed, Fraser wedding, 13:00–23:00", brief: "Confirmed 13:00–23:00" },
    ]);
    expect(lines("r2")[0]).toMatchObject({
      kind: "hold", bookingId: "b2", brief: expect.stringMatching(/^2nd option 18:00–23:00, decides Tue 10 Nov( 2026)?$/u) as unknown,
    });
    expect([lines("r3")[0]?.brief, lines("r7")[0]?.brief]).toEqual(["Joint 1st 18:00–22:00", "Provisional 12:00–14:00"]);
    expect(lines("r6")[0]).toMatchObject({ kind: "block", bookingId: "b6", brief: "House block 08:00–10:00" });
    const interest = "Free, interest only from Henderson enquiry";
    expect(lines("r4")).toEqual([{ key: "free", kind: "free", bookingId: null, text: interest, brief: interest }]);
  });
});

describe("dayAnswer, over time and with other events", () => {
  const room = (answer: ReturnType<typeof dayAnswer>, id: string) => answer.find((each) => each.id === id);

  it("says a decision that has passed as the Diary's decisions list does, from the moment it passes", () => {
    const after = room(dayAnswer(ENTRIES, ROOMS, DAY, Date.parse("2026-11-11T09:00:00.000Z")), "r2");
    expect(after?.lines.map((line) => [line.text, line.brief])).toEqual([[
      "2nd option Burns supper, 18:00–23:00, decision was due Tue 10 Nov",
      "2nd option 18:00–23:00, decision was due Tue 10 Nov",
    ]]);
    const atTheMoment = room(dayAnswer(ENTRIES, ROOMS, DAY, Date.parse("2026-11-10T12:00:00.000Z")), "r2");
    expect(atTheMoment?.lines[0]?.text).toBe("2nd option Burns supper, 18:00–23:00, decides Tue 10 Nov");
  });

  it("says another event's phase in a room that event has not booked, and never calls that room free", () => {
    const entries = [
      booking("b1", "r1", "ink", "Fraser wedding", "2026-11-14T13:00:00.000Z", "2026-11-14T23:00:00.000Z", { eventId: "e1" }),
      // The wedding's ceremony in the hall it has booked is that booking's own time.
      phase("p1", "r1", "e1", "Ceremony", "2026-11-14T13:00:00.000Z", "2026-11-14T14:00:00.000Z"),
      phase("p2", "r2", "e1", "Drinks reception", "2026-11-14T17:00:00.000Z", "2026-11-14T18:30:00.000Z"),
      booking("b2", "r2", "ink", "Law Society lunch", "2026-11-14T12:00:00.000Z", "2026-11-14T15:00:00.000Z"),
    ];
    const answer = dayAnswer(entries, ROOMS, DAY, NOW);
    expect(room(answer, "r1")?.lines.map((line) => line.text)).toEqual(["Confirmed, Fraser wedding, 13:00–23:00"]);
    expect(room(answer, "r2")?.lines).toEqual([
      { key: "b2", kind: "confirmed", bookingId: "b2", text: "Confirmed, Law Society lunch, 12:00–15:00", brief: "Confirmed 12:00–15:00" },
      { key: "p2", kind: "in_use", bookingId: null, text: "In use for Fraser wedding (Drinks reception), 17:00–18:30", brief: "In use 17:00–18:30" },
    ]);
    const onlyThePhase = room(dayAnswer(entries.filter((entry) => entry.id !== "b2"), ROOMS, DAY, NOW), "r2");
    expect(onlyThePhase?.free).toBe(false);
    expect(onlyThePhase?.lines.map((line) => line.kind)).toEqual(["in_use"]);
  });

  it("lets the night before's phase leave a room free from when it ends, and a phase of no length use nothing", () => {
    const entries = [
      phase("p1", "r3", "e1", "Ceilidh", "2026-11-13T20:00:00.000Z", "2026-11-14T00:30:00.000Z"),
      phase("p2", "r4", "e1", "Photographs", "2026-11-14T15:00:00.000Z", "2026-11-14T15:00:00.000Z"),
    ];
    const answer = dayAnswer(entries, ROOMS, DAY, NOW);
    expect(room(answer, "r3")).toMatchObject({ free: true, lines: [{ kind: "free", text: "Free from 00:30" }] });
    expect(room(answer, "r4")).toMatchObject({ free: true, lines: [{ kind: "free", text: "Free" }] });
  });

  it("never words a viewing as a hold: a room with only a show-round is free, with no option or decision", () => {
    const entries = [
      booking("v1", "r1", "viewing", "Fraser viewing", "2026-11-14T11:00:00.000Z", "2026-11-14T12:00:00.000Z"),
      booking("v2", "r2", "viewing", "Late viewing", "2026-11-13T23:30:00.000Z", "2026-11-14T00:30:00.000Z"),
      booking("b2", "r3", "ink", "Guild dinner", "2026-11-14T18:00:00.000Z", "2026-11-14T22:00:00.000Z"),
      booking("v3", "r3", "viewing", "Viewing before dinner", "2026-11-14T15:00:00.000Z", "2026-11-14T16:00:00.000Z"),
    ];
    const answer = dayAnswer(entries, ROOMS, DAY, NOW);
    expect(room(answer, "r1")).toMatchObject({ free: true, lines: [{ kind: "free", bookingId: null, text: "Free" }] });
    expect(room(answer, "r2")).toMatchObject({ free: true, lines: [{ kind: "free", text: "Free" }] });
    expect(room(answer, "r3")?.lines.map((line) => line.text)).toEqual(["Confirmed, Guild dinner, 18:00–22:00"]);
    const words = answer.flatMap((each) => each.lines.map((line) => line.text)).join(" ");
    expect(words).not.toMatch(/option|Provisional|decides|viewing/iu);
    expect(freeRoomsSaid(answer, false)).toBe("6 of 7 rooms free");
  });
});

describe("freeRoomsSaid", () => {
  const SIX = ["Grand Hall", "Saloon", "Robert Adam Room", "Reception Room", "North Gallery", "South Gallery"];
  const rooms = (free: (name: string) => boolean) => SIX.map((name) => ({ name, free: free(name) }));

  it("counts the free rooms inside Find's sentence and as an answer of its own", () => {
    const allButTheHall = rooms((name) => name !== "Grand Hall");
    expect([freeRoomsSaid(allButTheHall, false), freeRoomsSaid(allButTheHall, true)]).toEqual(["5 of 6 rooms free", "5 of 6 rooms free"]);
    expect([freeRoomsSaid(rooms(() => true), false), freeRoomsSaid(rooms(() => true), true)]).toEqual(["all 6 rooms free", "All 6 rooms free"]);
    expect([freeRoomsSaid(rooms(() => false), false), freeRoomsSaid(rooms(() => false), true)]).toEqual(["no room free", "No room free"]);
  });

  it("names a venue's only room, and finds no room free where there are none", () => {
    expect(freeRoomsSaid([{ name: "Saloon", free: true }], true)).toBe("Saloon is free");
    expect(freeRoomsSaid([{ name: "Grand Hall", free: false }], false)).toBe("Grand Hall is taken");
    expect(freeRoomsSaid([], true)).toBe("No room free");
  });
});
