import { describe, expect, it } from "vitest";
import { haversineDistanceM } from "../lib/venue-site.js";
import {
  AIRY_1830,
  osgb36ToWgs84,
  project,
  unproject,
  wgs84ToOsgb36,
  type TransverseMercator,
} from "../scripts/sky-normals/osgb.js";

// ---------------------------------------------------------------------------
// British National Grid conversions used by the sky normals generator
// (T-647), checked against the worked example in Ordnance Survey's "A guide
// to coordinate systems in Great Britain", Annex C.
// ---------------------------------------------------------------------------

const NATIONAL_GRID: TransverseMercator = {
  ellipsoid: AIRY_1830,
  scaleFactor: 0.9996012717,
  originLatitude: 49,
  originLongitude: -2,
  falseEasting: 400_000,
  falseNorthing: -100_000,
};

const dms = (degrees: number, minutes: number, seconds: number): number => degrees + minutes / 60 + seconds / 3600;

describe("transverse Mercator (OS guide Annex C)", () => {
  // The guide's example point: 52° 39′ 27.2531″ N, 1° 43′ 4.5177″ E (OSGB36)
  // is E 651409.903 m, N 313177.270 m.
  const latitude = dms(52, 39, 27.2531);
  const longitude = dms(1, 43, 4.5177);

  it("projects the worked example to the millimetre", () => {
    const { easting, northing } = project(latitude, longitude, NATIONAL_GRID);
    expect(Math.abs(easting - 651_409.903)).toBeLessThan(0.001);
    expect(Math.abs(northing - 313_177.270)).toBeLessThan(0.001);
  });

  it("inverts the worked example to a ten-thousandth of an arcsecond", () => {
    const point = unproject(651_409.903, 313_177.270, NATIONAL_GRID);
    expect(Math.abs(point.latitude - latitude) * 3600).toBeLessThan(1e-4);
    expect(Math.abs(point.longitude - longitude) * 3600).toBeLessThan(1e-4);
  });
});

describe("Helmert transformation (OS guide section 6.6)", () => {
  const site = { latitude: 55.8593, longitude: -4.2491 };

  it("moves a Glasgow point by about a hundred metres between WGS84 and OSGB36", () => {
    const osgb = wgs84ToOsgb36(site.latitude, site.longitude);
    const shift = haversineDistanceM(site, osgb);
    expect(shift).toBeGreaterThan(50);
    expect(shift).toBeLessThan(150);
  });

  it("round-trips to within a centimetre", () => {
    const osgb = wgs84ToOsgb36(site.latitude, site.longitude);
    const back = osgb36ToWgs84(osgb.latitude, osgb.longitude);
    expect(haversineDistanceM(site, back)).toBeLessThan(0.01);
  });
});
