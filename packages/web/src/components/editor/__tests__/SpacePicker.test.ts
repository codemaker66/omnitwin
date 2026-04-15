import { describe, it, expect } from "vitest";
import type { Venue } from "../../../api/spaces.js";
import { selectVenueFromSlug } from "../SpacePicker.js";

// ---------------------------------------------------------------------------
// selectVenueFromSlug — venue routing policy (B2 multi-venue hook)
// ---------------------------------------------------------------------------

const TRADES_HALL: Venue = {
  id: "venue-1",
  name: "Trades Hall Glasgow",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
};

const SECOND_VENUE: Venue = {
  id: "venue-2",
  name: "City Chambers",
  slug: "city-chambers",
  address: "George Square",
  logoUrl: null,
  brandColour: null,
};

const VENUES: readonly Venue[] = [TRADES_HALL, SECOND_VENUE];

describe("selectVenueFromSlug", () => {
  it("returns the venue whose slug matches the URL param", () => {
    expect(selectVenueFromSlug(VENUES, "city-chambers")).toBe(SECOND_VENUE);
  });

  it("returns the first venue when no slug is provided (single-tenant default)", () => {
    expect(selectVenueFromSlug(VENUES, undefined)).toBe(TRADES_HALL);
  });

  it("returns the first venue when the slug is an empty string", () => {
    expect(selectVenueFromSlug(VENUES, "")).toBe(TRADES_HALL);
  });

  it("falls back to the first venue when the slug doesn't match any known venue", () => {
    // Stale bookmark / typo — silently fall back rather than erroring.
    // This is the minimum-harm policy: never 404 the editor entry on a
    // bad URL; the rest of the page renders the first venue's spaces.
    expect(selectVenueFromSlug(VENUES, "no-such-venue")).toBe(TRADES_HALL);
  });

  it("returns undefined when the venues list is empty", () => {
    expect(selectVenueFromSlug([], "anything")).toBeUndefined();
    expect(selectVenueFromSlug([], undefined)).toBeUndefined();
  });

  it("does not match by name or id (slug only)", () => {
    // Defensive: someone passing the venue id or name in the URL must not
    // accidentally select that venue — only the slug counts.
    expect(selectVenueFromSlug(VENUES, "venue-2")).toBe(TRADES_HALL); // id ≠ slug
    expect(selectVenueFromSlug(VENUES, "City Chambers")).toBe(TRADES_HALL); // name ≠ slug
  });
});
