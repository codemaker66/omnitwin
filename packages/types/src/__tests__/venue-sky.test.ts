import { describe, expect, it } from "vitest";
import {
  SKY_DEGRADED_REASONS,
  SKY_PRECIPITATION_TYPES,
  VenueSkyQuerySchema,
  VenueSkySchema,
  type VenueSky,
} from "../venue-sky.js";

// ---------------------------------------------------------------------------
// The venue sky contract (T-647). These values are shaped by hand to exercise
// the schema; they are not weather and were not received from any source.
// ---------------------------------------------------------------------------

const ATTRIBUTION = [{
  source: "Met Office Weather DataHub",
  credit: "Powered by Met Office data",
  licence: "Met Office Weather DataHub terms and conditions",
  licenceUrl: "https://www.metoffice.gov.uk/api/assets/file/met-office-weatherdatahub-terms-and-conditionspdf?prefix=assets",
}];

function forecast(overrides: Partial<VenueSky> = {}): VenueSky {
  return {
    venueId: "8f6c2b1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f",
    kind: "forecast",
    source: "Met Office Site-Specific Blended Probabilistic Forecast v2",
    issuedAt: "2026-10-08T09:00:00.000Z",
    validFrom: "2026-10-08T11:30:00.000Z",
    validTo: "2026-10-08T12:30:00.000Z",
    at: "2026-10-08T12:00:00.000Z",
    cloud: { total: 0.5, low: 0.25, mid: null, high: null },
    visibilityM: 12000,
    fog: 0.05,
    precipitation: { type: "none", probability: 0.1, probabilityDefinition: "rate_at_least_0_1_mm_per_hour", rateMmH: 0 },
    windMs: 4,
    temperatureC: 11,
    sunshineFraction: null,
    weather: { code: 7, description: "Cloudy" },
    presetHint: null,
    climatology: null,
    degraded: null,
    attribution: ATTRIBUTION,
    provenance: { upstreamRequestedAt: "2026-10-08T10:00:00.000Z", cacheAgeSeconds: 120, forecastSite: { latitude: 55.86, longitude: -4.25, distanceM: 400 } },
    ...overrides,
  };
}

function normals(overrides: Partial<VenueSky> = {}): VenueSky {
  return forecast({
    kind: "normals",
    source: "HadUK-Grid 1991-2020 monthly climatology",
    issuedAt: null,
    validFrom: "2026-11-30T23:00:00.000Z",
    validTo: "2026-12-31T23:00:00.000Z",
    at: "2026-12-12T15:00:00.000Z",
    cloud: { total: null, low: null, mid: null, high: null },
    visibilityM: null,
    fog: null,
    precipitation: { type: null, probability: 0.6, probabilityDefinition: "share_of_days_with_at_least_1_mm", rateMmH: null },
    windMs: null,
    temperatureC: 4,
    sunshineFraction: 0.15,
    weather: null,
    climatology: {
      period: "1991-2020",
      month: 12,
      daysInMonth: 31,
      rainDaysAtLeast1mm: 18.6,
      snowLyingDays: 2,
      sunshineHours: 30,
      meanTemperatureC: 4,
      meanWindSpeedMs: null,
      astronomicalDaylightHours: 214,
      dataset: "HadUK-Grid",
      cell: { latitude: 55.86, longitude: -4.25, resolutionKm: 1 },
    },
    degraded: { reason: "beyond_forecast_horizon" },
    provenance: { upstreamRequestedAt: null, cacheAgeSeconds: null, forecastSite: null },
    ...overrides,
  });
}

describe("VenueSkySchema", () => {
  it("accepts a forecast and a normals body", () => {
    expect(VenueSkySchema.parse(forecast()).kind).toBe("forecast");
    expect(VenueSkySchema.parse(normals()).kind).toBe("normals");
  });

  it("keeps missing values as null rather than defaulting them", () => {
    const parsed = VenueSkySchema.parse(forecast({ visibilityM: null, windMs: null, fog: null }));
    expect(parsed.visibilityM).toBeNull();
    expect(parsed.windMs).toBeNull();
    expect(parsed.fog).toBeNull();
    // An omitted field is refused: no field is ever filled in by the schema.
    const { windMs: _omitted, ...withoutWind } = forecast();
    expect(VenueSkySchema.safeParse(withoutWind).success).toBe(false);
  });

  it("holds fractions and probabilities to 0..1", () => {
    expect(VenueSkySchema.safeParse(forecast({ cloud: { total: 1.2, low: null, mid: null, high: null } })).success).toBe(false);
    expect(VenueSkySchema.safeParse(forecast({ fog: -0.1 })).success).toBe(false);
  });

  it("requires UTC instants", () => {
    expect(VenueSkySchema.safeParse(forecast({ at: "2026-10-08T13:00:00+01:00" })).success).toBe(false);
  });

  it("keeps the requested instant inside the validity window", () => {
    expect(VenueSkySchema.safeParse(forecast({ at: "2026-10-08T14:00:00.000Z" })).success).toBe(false);
  });

  it("never marks a forecast degraded, and always says why normals were served", () => {
    expect(VenueSkySchema.safeParse(forecast({ degraded: { reason: "upstream_unavailable" } })).success).toBe(false);
    expect(VenueSkySchema.safeParse(normals({ degraded: null })).success).toBe(false);
  });

  it("states what a precipitation probability means, per kind", () => {
    expect(VenueSkySchema.safeParse(forecast({
      precipitation: { type: "rain", probability: 0.4, probabilityDefinition: null, rateMmH: 0.5 },
    })).success).toBe(false);
    expect(VenueSkySchema.safeParse(normals({
      precipitation: { type: null, probability: 0.6, probabilityDefinition: "rate_at_least_0_1_mm_per_hour", rateMmH: null },
    })).success).toBe(false);
  });

  it("carries climatology only for normals", () => {
    expect(VenueSkySchema.safeParse(normals({ climatology: null })).success).toBe(false);
    expect(VenueSkySchema.safeParse(forecast({ climatology: normals().climatology })).success).toBe(false);
  });

  it("requires attribution and refuses unknown fields", () => {
    expect(VenueSkySchema.safeParse(forecast({ attribution: [] })).success).toBe(false);
    expect(VenueSkySchema.safeParse({ ...forecast(), sunAzimuthDeg: 180 }).success).toBe(false);
  });

  it("closes the degraded reasons and precipitation types", () => {
    expect(SKY_DEGRADED_REASONS).toEqual([
      "forecast_not_configured",
      "forecast_key_rejected",
      "forecast_quota_exhausted",
      "upstream_unavailable",
      "beyond_forecast_horizon",
      "before_forecast_window",
    ]);
    expect(SKY_PRECIPITATION_TYPES).toEqual(["none", "rain", "drizzle", "snow", "sleet", "hail"]);
    expect(VenueSkySchema.safeParse(normals({ degraded: { reason: "no_reason" as never } })).success).toBe(false);
  });
});

describe("VenueSkyQuerySchema", () => {
  it("accepts an absent or offset instant and refuses a date without a time", () => {
    expect(VenueSkyQuerySchema.parse({}).at).toBeUndefined();
    expect(VenueSkyQuerySchema.parse({ at: "2026-12-12T18:00:00+00:00" }).at).toBe("2026-12-12T18:00:00+00:00");
    expect(VenueSkyQuerySchema.safeParse({ at: "2026-12-12" }).success).toBe(false);
    expect(VenueSkyQuerySchema.safeParse({ at: "tomorrow" }).success).toBe(false);
  });
});
