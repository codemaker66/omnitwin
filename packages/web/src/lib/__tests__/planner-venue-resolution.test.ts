import { describe, expect, it } from "vitest";
import type { Venue } from "../../api/spaces.js";
import { resolvePlannerVenue } from "../planner-venue-resolution.js";

const tradesHall: Venue = {
  id: "venue-trades",
  name: "Trades Hall",
  slug: "trades-hall",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
};

const cityRooms: Venue = {
  id: "venue-city",
  name: "City Rooms",
  slug: "city-rooms",
  address: "1 Example Street",
  logoUrl: null,
  brandColour: null,
};

describe("resolvePlannerVenue", () => {
  it("uses the first active venue for the unscoped /plan shortcut", () => {
    const result = resolvePlannerVenue([tradesHall, cityRooms], undefined, null);

    expect(result).toEqual({ status: "resolved", venue: tradesHall });
  });

  it("resolves an explicit venue slug without falling back to the first venue", () => {
    const result = resolvePlannerVenue([tradesHall, cityRooms], "city-rooms", null);

    expect(result).toEqual({ status: "resolved", venue: cityRooms });
  });

  it("returns not_found for an explicit unknown slug", () => {
    const result = resolvePlannerVenue([tradesHall, cityRooms], "missing-venue", null);

    expect(result).toEqual({ status: "not_found", requestedSlug: "missing-venue" });
  });

  it("returns empty only when the unscoped shortcut has no active venues", () => {
    const result = resolvePlannerVenue([], undefined, null);

    expect(result).toEqual({ status: "empty" });
  });

  it("blocks a scoped non-admin user from opening another venue", () => {
    const result = resolvePlannerVenue(
      [tradesHall, cityRooms],
      "city-rooms",
      { role: "planner", venueId: tradesHall.id },
    );

    expect(result).toEqual({
      status: "forbidden",
      requestedSlug: "city-rooms",
      venue: cityRooms,
    });
  });

  it("allows admins to open any active venue", () => {
    const result = resolvePlannerVenue(
      [tradesHall, cityRooms],
      "city-rooms",
      { role: "admin", venueId: tradesHall.id },
    );

    expect(result).toEqual({ status: "resolved", venue: cityRooms });
  });
});
