import { describe, expect, it } from "vitest";
import {
  CROWDED_DAY_DEFAULT_DATE,
  TRADES_HALL_ROOM_CAPACITIES,
  crowdedDayInstant,
  crowdedDayOpenRequests,
  crowdedTradesHallDay,
  type CalendarBookingEntry,
} from "../index.js";

// The crowded day is a fixture other tests and the local demo lean on, so its
// promises are held here: it is the same day every time, it is what the
// contracts say a day can be, it is crowded in the ways the board must
// survive, and it carries nobody real.

const day = crowdedTradesHallDay();
const bookings = day.calendar.entries.filter((entry): entry is CalendarBookingEntry => entry.entryType === "booking");

describe("the crowded Trades Hall day", () => {
  it("is the same day, to the id and the minute, every time it is built", () => {
    expect(JSON.stringify(crowdedTradesHallDay())).toBe(JSON.stringify(day));
    expect(day.date).toBe(CROWDED_DAY_DEFAULT_DATE);
  });

  it("uses every room the venue publishes, and no other", () => {
    expect(new Set(day.rooms.map((room) => room.slug))).toEqual(new Set(Object.keys(TRADES_HALL_ROOM_CAPACITIES)));
    expect(day.rooms.map((room) => room.name)).toEqual([
      "Grand Hall", "Saloon", "Reception Room", "Robert Adam Room", "North Gallery", "South Gallery",
    ]);
  });

  it("is crowded: twenty-one functions over six lanes, sixteen open requests, every request state the slab knows", () => {
    expect(bookings).toHaveLength(21);
    for (const room of day.rooms) {
      expect(bookings.filter((entry) => entry.spaceId === room.id).length).toBeGreaterThanOrEqual(1);
    }
    const open = crowdedDayOpenRequests(day);
    expect(open).toHaveLength(16);
    expect(new Set(day.requests.map((request) => request.state))).toEqual(
      new Set(["sent", "acknowledged", "accepted", "underway", "handed-over", "resolved"]),
    );
    expect(open.filter((request) => request.ownerUserId === null).length).toBeGreaterThanOrEqual(8);
    expect(open.some((request) => request.urgency === "now" && request.ownerUserId === null)).toBe(true);
    expect(new Set(bookings.map((entry) => entry.kind))).toEqual(new Set(["ink", "hold", "viewing", "internal_block"]));
  });

  it("never double-books a room: functions in one lane do not overlap", () => {
    for (const room of day.rooms) {
      const lane = bookings.filter((entry) => entry.spaceId === room.id)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      for (let index = 1; index < lane.length; index += 1) {
        const previous = lane[index - 1];
        const current = lane[index];
        if (previous === undefined || current === undefined) continue;
        expect(Date.parse(current.startsAt), `${room.name}: ${current.title}`).toBeGreaterThanOrEqual(Date.parse(previous.endsAt));
      }
    }
  });

  it("keeps each function within the room's published capacity", () => {
    for (const entry of bookings) {
      if (entry.guestCount === null || entry.guestCount === undefined) continue;
      const room = day.rooms.find((candidate) => candidate.id === entry.spaceId);
      const capacity = room === undefined ? undefined : TRADES_HALL_ROOM_CAPACITIES[room.slug];
      expect(capacity, entry.title).toBeDefined();
      const most = Math.max(capacity?.theatre ?? 0, capacity?.reception ?? 0, capacity?.dinner ?? 0, capacity?.classroom ?? 0);
      expect(entry.guestCount, entry.title).toBeLessThanOrEqual(most);
    }
  });

  it("moves one wedding through three rooms and past midnight, and runs the install over four days", () => {
    const wedding = day.events.find((event) => event.eventType === "wedding");
    const weddingRooms = new Set(bookings.filter((entry) => entry.eventId === wedding?.id).map((entry) => entry.spaceId));
    expect(weddingRooms.size).toBe(3);
    const dinner = bookings.find((entry) => entry.title.includes("dinner and ceilidh"));
    expect(dinner?.endsAt).toBe(crowdedDayInstant(day.date, "00:30", 1));
    const install = bookings.find((entry) => entry.title === "Exhibition: Glasgow Trades in Print");
    expect(install?.startsAt).toBe(crowdedDayInstant(day.date, "10:00", -2));
    expect(install?.endsAt).toBe(crowdedDayInstant(day.date, "17:00", 2));
  });

  it("names the one changeover shorter than its room needs, and only that one", () => {
    expect(day.calendar.conflicts.conflicts).toHaveLength(1);
    const [tight] = day.calendar.conflicts.conflicts;
    expect(tight?.type).toBe("insufficient_turnaround");
    const titles = tight?.entryIds.map((id) => bookings.find((entry) => entry.id === id)?.title);
    expect(titles).toEqual(["Bridgewrights' Society AGM", "Glasgow Schools Prize Giving"]);
  });

  it("carries nobody real: first names only, no phone numbers, every address .invalid", () => {
    const addresses = [...day.people.map((person) => person.email), ...day.suppliers.map((supplier) => supplier.email)];
    for (const address of addresses) expect(address).toMatch(/@crowded-day\.invalid$/u);
    for (const person of day.people) expect(person.name).toMatch(/^[A-Z][a-z]+$/u);
    expect(JSON.stringify(day)).not.toMatch(/\+44|\b07\d{3}\s?\d{6}\b|@(?!crowded-day\.invalid)[a-z0-9-]+\.(?:com|co\.uk|org|net)/u);
  });

  it("puts every request, fact and supplier on a booking of the day", () => {
    const ids = new Set(bookings.map((entry) => entry.id));
    for (const request of day.requests) expect(ids.has(request.bookingId ?? "")).toBe(true);
    for (const fact of day.observations) expect(ids.has(fact.bookingId)).toBe(true);
    for (const supplier of day.suppliers) expect(ids.has(supplier.bookingId)).toBe(true);
    // Nothing on the day was asked for after the busiest moment it is read at.
    for (const request of day.requests) expect(Date.parse(request.createdAt)).toBeLessThanOrEqual(day.busiestAtMs);
    for (const fact of day.observations) expect(Date.parse(fact.observedAt)).toBeLessThanOrEqual(day.busiestAtMs);
  });

  it("reads venue time either side of the clocks changing", () => {
    // British Summer Time: 14:20 is 13:20 UTC; Greenwich Mean Time: 14:20 UTC.
    expect(crowdedDayInstant("2026-07-11", "14:20")).toBe("2026-07-11T13:20:00.000Z");
    expect(crowdedDayInstant("2026-11-14", "14:20")).toBe("2026-11-14T14:20:00.000Z");
    // The Sunday the clocks went back, after the change.
    expect(crowdedDayInstant("2026-10-25", "09:00")).toBe("2026-10-25T09:00:00.000Z");
    const summer = crowdedTradesHallDay("2026-07-11");
    expect(summer.busiestAtMs).toBe(Date.parse("2026-07-11T13:20:00.000Z"));
    expect(() => crowdedTradesHallDay("14/11/2026")).toThrow(/YYYY-MM-DD/u);
  });
});
