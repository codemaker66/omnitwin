import { describe, expect, it } from "vitest";
import {
  GENERATOR,
  HADUK_GRID,
  HADUK_INPUTS,
  axisFrom,
  cellIndex,
  convertUnits,
  hadukFileName,
  hadukUrl,
  locateCell,
  monthsFromTime,
  sanityCheck,
} from "../scripts/generate-sky-normals.js";
import { AIRY_1830, type TransverseMercator } from "../scripts/sky-normals/osgb.js";
import type { SkyNormalsMonth } from "../services/sky/normals.js";
import { SKY_NORMALS } from "../services/sky/normals-data.js";
import { TRADES_HALL_SITE, haversineDistanceM } from "../lib/venue-site.js";

// ---------------------------------------------------------------------------
// The sky normals generator's pure parts (T-647): pinned inputs and their
// URLs, unit conversion, CF month decoding, the cell lookup on a British
// National Grid axis, and the plausibility report. The HDF5 reading itself
// runs against the pinned CEDA files, which are not in the repository.
// ---------------------------------------------------------------------------

const NATIONAL_GRID: TransverseMercator = {
  ellipsoid: AIRY_1830,
  scaleFactor: 0.9996012717,
  originLatitude: 49,
  originLongitude: -2,
  falseEasting: 400_000,
  falseNorthing: -100_000,
};

/** A 1 km axis of cell centres at half-kilometres, as HadUK-Grid uses. */
function kmAxis(from: number, count: number): ReturnType<typeof axisFrom> {
  return axisFrom(Array.from({ length: count }, (_, i) => from + 500 + i * 1000), null);
}

describe("pinned inputs", () => {
  it("pins the five variables by sha256 and names their CEDA URLs", () => {
    expect(HADUK_INPUTS.map((input) => input.variable)).toEqual(["raindays1mm", "sfcWind", "snowLying", "sun", "tas"]);
    for (const input of HADUK_INPUTS) expect(input.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(hadukFileName("sun")).toBe("sun_hadukgrid_uk_1km_mon-30y_199101-202012.nc");
    expect(hadukUrl("sun")).toBe(
      "https://dap.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/v1.3.2.ceda/1km/sun/mon-30y/v20260512/sun_hadukgrid_uk_1km_mon-30y_199101-202012.nc",
    );
    expect(HADUK_GRID.licence).toBe("Open Government Licence v3.0");
    expect(HADUK_GRID.citation).toContain("doi:10.5285/789b3065d74a4c948ab05d33556c86d0");
  });
});

describe("convertUnits", () => {
  it("converts knots to metres per second and passes declared contract units through", () => {
    expect(convertUnits("sfcWind", "knots")(10)).toBeCloseTo(5.14444, 4);
    expect(convertUnits("sfcWind", "m s-1")(5)).toBe(5);
    expect(convertUnits("tas", "degC")(4.2)).toBe(4.2);
    expect(convertUnits("tas", "K")(273.15)).toBeCloseTo(0, 9);
    expect(convertUnits("sun", "hour")(150)).toBe(150);
    expect(convertUnits("raindays1mm", "1.0")(18)).toBe(18);
    expect(convertUnits("snowLying", "1")(2)).toBe(2);
  });

  it("stops on a unit it does not know", () => {
    expect(() => convertUnits("tas", "degF")).toThrow(/unexpected units/u);
    expect(() => convertUnits("sun", null)).toThrow(/unexpected units/u);
  });
});

describe("monthsFromTime", () => {
  it("decodes CF hours since 1800 to calendar months", () => {
    const midMonths = Array.from({ length: 12 }, (_, i) => (Date.UTC(2005, i, 16) - Date.UTC(1800, 0, 1)) / 3_600_000);
    expect(monthsFromTime(midMonths, "hours since 1800-01-01 00:00:00", "gregorian")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("refuses calendars and units it cannot honour", () => {
    expect(() => monthsFromTime([0], "hours since 1800-01-01", "360_day")).toThrow(/calendar/u);
    expect(() => monthsFromTime([0], "months since 1800-01-01", null)).toThrow(/time units/u);
  });
});

describe("cell lookup", () => {
  it("finds the cell whose bounds contain a coordinate, lower bound inclusive", () => {
    const axis = kmAxis(250_000, 20);
    expect(cellIndex(axis, 258_000)).toBe(8);
    expect(cellIndex(axis, 258_999.9)).toBe(8);
    expect(() => cellIndex(axis, 249_999)).toThrow(/outside/u);
  });

  it("refuses an uneven axis without bounds", () => {
    expect(() => axisFrom([500, 1500, 2600], null)).toThrow(/uniform/u);
  });

  it("places the Trades Hall site in a 1 km cell within 710 m of its centre", () => {
    const cell = locateCell({ projection: NATIONAL_GRID, x: kmAxis(250_000, 20), y: kmAxis(660_000, 20), latitude: null, longitude: null }, { latitude: 55.8593, longitude: -4.2491 });
    expect(cell.siteDistanceM).toBeLessThan(710);
    expect(cell.edgeMarginM).toBeGreaterThanOrEqual(0);
    expect(cell.centreEastingM % 1000).toBe(500);
    expect(cell.centreNorthingM % 1000).toBe(500);
  });
});

function month(index: number, overrides: Partial<SkyNormalsMonth> = {}): SkyNormalsMonth {
  // Shapes like Glasgow's, synthetic numbers.
  const tas = [4, 4.5, 6, 8, 11, 14, 15.5, 15, 13, 9.5, 6.5, 4.2];
  const sun = [40, 65, 100, 145, 185, 165, 160, 150, 115, 80, 50, 35];
  const rain = [18, 15, 16, 13, 12, 12, 13, 14, 15, 17, 17, 17];
  const snow = [3, 2.5, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0.4, 2];
  const wind = [5.5, 5.4, 5.1, 4.4, 4.0, 3.8, 3.7, 3.8, 4.2, 4.7, 5.0, 5.3];
  return {
    month: index + 1,
    meanTemperatureC: tas[index] ?? null,
    sunshineHours: sun[index] ?? null,
    rainDaysAtLeast1mm: rain[index] ?? null,
    snowLyingDays: snow[index] ?? null,
    meanWindSpeedMs: wind[index] ?? null,
    ...overrides,
  };
}

describe("sanityCheck", () => {
  it("finds a Glasgow-shaped year plausible", () => {
    const findings = sanityCheck(Array.from({ length: 12 }, (_, i) => month(i)));
    expect(findings.filter((finding) => !finding.plausible)).toEqual([]);
  });

  it("flags an implausible year without changing it", () => {
    const months = Array.from({ length: 12 }, (_, i) => month(i, i === 0 ? { meanTemperatureC: 20, sunshineHours: 300, rainDaysAtLeast1mm: 40 } : {}));
    const before = JSON.stringify(months);
    const findings = sanityCheck(months);
    expect(findings.filter((finding) => !finding.plausible).map((finding) => finding.check)).toEqual([
      "mean temperature about 4-16 °C, coldest Dec-Feb, warmest Jun-Aug",
      "sunshine peaks in May or June, least in Nov-Jan, 900-1600 h a year",
      "more rain days in winter than late spring, none above the days in the month",
    ]);
    expect(JSON.stringify(months)).toBe(before);
  });

  it("reports missing values", () => {
    const findings = sanityCheck(Array.from({ length: 12 }, (_, i) => month(i, i === 6 ? { meanWindSpeedMs: null } : {})));
    expect(findings[0]).toMatchObject({ plausible: false, detail: "Jul meanWindSpeedMs" });
  });
});

describe("the committed Trades Hall normals", () => {
  const file = SKY_NORMALS[0];

  it("come from the pinned inputs through this generator", () => {
    expect(SKY_NORMALS).toHaveLength(1);
    expect(file?.generator).toEqual(GENERATOR);
    expect(file?.dataset).toMatchObject({ version: HADUK_GRID.version, period: "1991-2020", resolutionKm: 1, citation: HADUK_GRID.citation, doi: HADUK_GRID.doi });
    expect(file?.inputs.map((input) => [input.variable, input.sha256, input.url])).toEqual(
      HADUK_INPUTS.map((input) => [input.variable, input.sha256, hadukUrl(input.variable)]),
    );
  });

  it("belong to the 1 km cell that contains the Trades Hall site", () => {
    expect(file?.cell.site).toEqual(TRADES_HALL_SITE);
    const distance = haversineDistanceM(TRADES_HALL_SITE, { latitude: file?.cell.latitude ?? 0, longitude: file?.cell.longitude ?? 0 });
    expect(distance).toBeCloseTo(file?.cell.siteDistanceM ?? -1, 3);
    // Inside a 1 km square: never further from its centre than half the diagonal.
    expect(distance).toBeLessThanOrEqual(Math.SQRT2 * 500);
    expect((file?.cell.eastingM ?? 0) % 1000).toBe(500);
    expect((file?.cell.northingM ?? 0) % 1000).toBe(500);
  });

  it("hold twelve months with every value present", () => {
    expect(file?.months.map((month) => month.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sanityCheck(file?.months ?? [])[0]).toMatchObject({ check: "no missing values", plausible: true });
  });
});
