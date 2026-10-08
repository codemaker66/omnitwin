import { describe, expect, it } from "vitest";
import { VenueSkySchema } from "@omnitwin/types";
import { dayLengthHours, monthDaylightHours, sunshineFraction, utcDayOfYear } from "../services/sky/daylength.js";
import {
  SkyNormalsFileSchema,
  buildNormalsSky,
  normalsFor,
  zonedMonth,
  type SkyNormalsFile,
} from "../services/sky/normals.js";

// ---------------------------------------------------------------------------
// Monthly normals: the month chosen, the derived values and the day-length
// formula (T-647). The normals file is synthetic: no HadUK-Grid file is
// committed (the CEDA download needs a login).
// ---------------------------------------------------------------------------

const GLASGOW = { latitude: 55.8593, longitude: -4.2491 };

function file(overrides: Partial<SkyNormalsFile> = {}): SkyNormalsFile {
  return {
    schemaVersion: 1,
    dataset: { name: "HadUK-Grid", version: "synthetic-test", period: "1991-2020", resolutionKm: 1, licence: "Open Government Licence v3.0", citation: "Synthetic." },
    generatedAt: "2026-10-08T00:00:00Z",
    inputs: [{ variable: "raindays1mm", url: "https://example.invalid/r.nc", sha256: "a".repeat(64) }],
    cell: { latitude: 55.8590, longitude: -4.2490 },
    months: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      rainDaysAtLeast1mm: 10 + index,
      snowLyingDays: null,
      sunshineHours: 50 + 10 * index,
      meanTemperatureC: index,
      meanWindSpeedMs: 5,
    })),
    ...overrides,
  };
}

describe("day length", () => {
  it("gives about 17.3 h at midsummer and 6.7 h at midwinter in Glasgow", () => {
    expect(dayLengthHours(172, GLASGOW.latitude)).toBeGreaterThan(17.1);
    expect(dayLengthHours(172, GLASGOW.latitude)).toBeLessThan(17.5);
    expect(dayLengthHours(355, GLASGOW.latitude)).toBeGreaterThan(6.6);
    expect(dayLengthHours(355, GLASGOW.latitude)).toBeLessThan(6.8);
  });

  it("gives 12 h at the equator and clamps the polar day and night", () => {
    expect(dayLengthHours(100, 0)).toBeCloseTo(12, 9);
    expect(dayLengthHours(172, 80)).toBe(24);
    expect(dayLengthHours(355, 80)).toBe(0);
  });

  it("sums a month day by day, including a leap February", () => {
    const february2028 = monthDaylightHours(2028, 2, GLASGOW.latitude);
    const february2027 = monthDaylightHours(2027, 2, GLASGOW.latitude);
    expect(february2028 - february2027).toBeGreaterThan(10);
    expect(utcDayOfYear(Date.parse("2028-12-31T12:00:00Z"))).toBe(366);
  });

  it("refuses an impossible sunshine fraction instead of clamping it away", () => {
    expect(sunshineFraction(50, 100)).toBe(0.5);
    expect(sunshineFraction(100.5, 100)).toBe(1);
    expect(sunshineFraction(130, 100)).toBeNull();
    expect(sunshineFraction(null, 100)).toBeNull();
  });
});

describe("zonedMonth", () => {
  it("bounds a summer month in BST and a winter month in GMT", () => {
    expect(zonedMonth(Date.parse("2027-07-15T12:00:00Z"), "Europe/London")).toEqual({
      year: 2027, month: 7, start: Date.parse("2027-06-30T23:00:00Z"), end: Date.parse("2027-07-31T23:00:00Z"),
    });
    expect(zonedMonth(Date.parse("2027-01-15T12:00:00Z"), "Europe/London")).toEqual({
      year: 2027, month: 1, start: Date.parse("2027-01-01T00:00:00Z"), end: Date.parse("2027-02-01T00:00:00Z"),
    });
  });

  it("chooses the month by the venue's clock, not UTC", () => {
    expect(zonedMonth(Date.parse("2027-03-31T23:30:00Z"), "Europe/London").month).toBe(4);
    expect(zonedMonth(Date.parse("2027-03-31T23:30:00Z"), "UTC").month).toBe(3);
  });

  it("crosses the year at local midnight", () => {
    const december = zonedMonth(Date.parse("2027-12-31T23:59:59Z"), "Europe/London");
    expect(december).toMatchObject({ year: 2027, month: 12, end: Date.parse("2028-01-01T00:00:00Z") });
  });
});

describe("normals selection", () => {
  it("selects the month of the instant and derives the probability and sunshine", () => {
    const body = buildNormalsSky(file(), {
      venueId: "8f6c2b1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f",
      timeZone: "Europe/London",
      at: Date.parse("2027-02-10T15:00:00Z"),
      reason: "beyond_forecast_horizon",
    });
    expect(VenueSkySchema.safeParse(body).success).toBe(true);
    expect(body.climatology).toMatchObject({ month: 2, daysInMonth: 28, rainDaysAtLeast1mm: 11, sunshineHours: 60, meanTemperatureC: 1 });
    expect(body.precipitation.probability).toBeCloseTo(11 / 28, 12);
    expect(body.precipitation.probabilityDefinition).toBe("share_of_days_with_at_least_1_mm");
    expect(body.sunshineFraction).toBeCloseTo(60 / monthDaylightHours(2027, 2, 55.8590), 12);
    expect(body.temperatureC).toBe(1);
    expect(body.windMs).toBe(5);
    expect(body.climatology?.snowLyingDays).toBeNull();
    expect(body.source).toContain("monthly normals");
  });

  it("leaves the probability null when rain days are missing", () => {
    const missing = file();
    const months = missing.months.map((month) => ({ ...month, rainDaysAtLeast1mm: null }));
    const body = buildNormalsSky({ ...missing, months }, {
      venueId: "8f6c2b1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f", timeZone: "Europe/London", at: Date.parse("2027-02-10T15:00:00Z"), reason: "forecast_not_configured",
    });
    expect(body.precipitation.probability).toBeNull();
    expect(body.precipitation.probabilityDefinition).toBeNull();
  });

  it("uses only a file whose cell contains the venue", () => {
    expect(normalsFor([file()], GLASGOW)).not.toBeNull();
    expect(normalsFor([file({ cell: { latitude: 55.875, longitude: -4.2491 } })], GLASGOW)).toBeNull();
    expect(normalsFor([], GLASGOW)).toBeNull();
  });
});

describe("SkyNormalsFileSchema", () => {
  it("accepts a well-formed file", () => {
    expect(SkyNormalsFileSchema.safeParse(file()).success).toBe(true);
  });

  it("refuses months out of order, a bad digest and a missing month", () => {
    const shuffled = file();
    expect(SkyNormalsFileSchema.safeParse({ ...shuffled, months: [...shuffled.months].reverse() }).success).toBe(false);
    expect(SkyNormalsFileSchema.safeParse({ ...shuffled, inputs: [{ variable: "sun", url: "https://example.invalid/s.nc", sha256: "xyz" }] }).success).toBe(false);
    expect(SkyNormalsFileSchema.safeParse({ ...shuffled, months: shuffled.months.slice(1) }).success).toBe(false);
  });
});
