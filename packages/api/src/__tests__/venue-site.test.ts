import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRADES_HALL_SITE,
  TRADES_HALL_VENUE_SLUG,
  haversineDistanceM,
  siteAgreement,
} from "../lib/venue-site.js";

// ---------------------------------------------------------------------------
// The Trades Hall site and the check that a stored location is that site
// (T-647). The site is the one T-639 agreed (grand-hall.json room.site).
// ---------------------------------------------------------------------------

describe("haversineDistanceM", () => {
  it("is zero for one point and symmetric", () => {
    expect(haversineDistanceM(TRADES_HALL_SITE, TRADES_HALL_SITE)).toBe(0);
    const other = { latitude: 55.8642, longitude: -4.2518 };
    expect(haversineDistanceM(TRADES_HALL_SITE, other)).toBeCloseTo(haversineDistanceM(other, TRADES_HALL_SITE), 9);
  });

  it("measures a degree of latitude as about 111.2 km", () => {
    const d = haversineDistanceM({ latitude: 55, longitude: -4 }, { latitude: 56, longitude: -4 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it("shrinks a degree of longitude by cos(latitude) at Glasgow", () => {
    const d = haversineDistanceM({ latitude: 55.8593, longitude: -5 }, { latitude: 55.8593, longitude: -4 });
    const expected = 111_195 * Math.cos((55.8593 * Math.PI) / 180);
    expect(Math.abs(d - expected)).toBeLessThan(100);
  });
});

describe("siteAgreement", () => {
  it("agrees for the agreed site and for a point inside 100 m", () => {
    expect(siteAgreement(TRADES_HALL_SITE)).toEqual({ agrees: true, distanceM: 0 });
    // 0.0006 degrees of latitude is about 67 m.
    const near = siteAgreement({ latitude: TRADES_HALL_SITE.latitude + 0.0006, longitude: TRADES_HALL_SITE.longitude });
    expect(near.agrees).toBe(true);
    expect(near.distanceM).toBeGreaterThan(60);
  });

  it("disagrees beyond 100 m, naming the distance", () => {
    // 0.0012 degrees of latitude is about 133 m.
    const far = siteAgreement({ latitude: TRADES_HALL_SITE.latitude + 0.0012, longitude: TRADES_HALL_SITE.longitude });
    expect(far).toMatchObject({ agrees: false, reason: "too_far" });
    expect(far.distanceM).toBeGreaterThan(100);
  });

  it("never agrees for a venue with no stored location", () => {
    expect(siteAgreement({ latitude: null, longitude: null })).toEqual({ agrees: false, distanceM: null, reason: "not_located" });
    expect(siteAgreement({ latitude: 55.8593, longitude: null })).toMatchObject({ agrees: false, reason: "not_located" });
  });

  it("is what migration 0086 stores for Trades Hall", async () => {
    const sql = await readFile(resolve("drizzle", "0086_venue_location.sql"), "utf8");
    const match = /SET "latitude" = (-?\d+\.\d+), "longitude" = (-?\d+\.\d+)\s+WHERE "slug" = '([a-z-]+)'/u.exec(sql);
    expect(match).not.toBeNull();
    const [, latitude, longitude, slug] = match ?? [];
    expect(slug).toBe(TRADES_HALL_VENUE_SLUG);
    expect(siteAgreement({ latitude: Number(latitude), longitude: Number(longitude) }).agrees).toBe(true);
  });
});
