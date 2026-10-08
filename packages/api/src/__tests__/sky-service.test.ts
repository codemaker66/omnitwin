import { describe, expect, it } from "vitest";
import { VenueSkySchema } from "@omnitwin/types";
import {
  FORECAST_FAILURE_BACKOFF_MS,
  FORECAST_REFRESH_MS,
  MET_OFFICE_ATTRIBUTION,
  SkyUnavailableError,
  createVenueSkyService,
  presetHintFromCloud,
  type SkyLogger,
  type VenueForSky,
} from "../services/sky/sky-service.js";
import type { SkyNormalsFile } from "../services/sky/normals.js";
import {
  collectionsBody,
  forecastTimes,
  instancesBody,
  percentilesBody,
  probabilitiesBody,
  routedFetch,
} from "./fixtures/met-office-bpf-v2.js";

// ---------------------------------------------------------------------------
// Which source answers an instant, the forecast cache and the bodies
// (T-647). Upstream bodies are documented-structure fixtures with synthetic
// numbers; the normals file below is synthetic too (no HadUK-Grid file is
// committed), shaped by the normals schema.
// ---------------------------------------------------------------------------

const KEY = "test-key-not-a-real-key";
const HOUR = 3_600_000;
const ISSUED = Date.parse("2026-10-08T09:00:00Z");
const VENUE: VenueForSky = { id: "8f6c2b1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f", latitude: 55.8593, longitude: -4.2491, timezone: "Europe/London" };

const SYNTHETIC_NORMALS: SkyNormalsFile = {
  schemaVersion: 1,
  dataset: {
    name: "HadUK-Grid",
    version: "synthetic-test",
    period: "1991-2020",
    resolutionKm: 1,
    licence: "Open Government Licence v3.0",
    citation: "Synthetic test citation.",
  },
  generatedAt: "2026-10-08T00:00:00Z",
  inputs: [{ variable: "sun", url: "https://example.invalid/sun.nc", sha256: "0".repeat(64) }],
  cell: { latitude: 55.8590, longitude: -4.2490 },
  months: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    rainDaysAtLeast1mm: 15,
    snowLyingDays: index < 2 ? 2 : 0,
    sunshineHours: 100,
    meanTemperatureC: 8,
    meanWindSpeedMs: null,
  })),
};

class RecordingLogger implements SkyLogger {
  readonly entries: { level: string; details: Record<string, unknown>; message: string }[] = [];
  warn(details: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "warn", details, message });
  }
  info(details: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "info", details, message });
  }
}

interface Harness {
  readonly service: ReturnType<typeof createVenueSkyService>;
  readonly calls: { url: string }[];
  readonly logger: RecordingLogger;
  readonly clock: { now: number };
}

function harness(options: {
  apiKey?: string | undefined;
  normals?: readonly SkyNormalsFile[];
  status?: (url: URL) => number;
  percentiles?: unknown;
  dailyCallCap?: number;
  now?: number;
} = {}): Harness {
  const times = forecastTimes(ISSUED, 120, 22);
  const clock = { now: options.now ?? ISSUED + 30 * 60_000 };
  const { fetch, calls } = routedFetch((url) => {
    const status = options.status?.(url) ?? 200;
    if (status !== 200) return { status, body: { message: "no" } };
    if (url.pathname.endsWith("/collections")) return { status, body: collectionsBody() };
    if (url.pathname.endsWith("/instances")) return { status, body: instancesBody(["2026-10-08T08:00:00Z", "2026-10-08T09:00:00Z"]) };
    if (url.pathname.includes("percentiles")) return { status, body: options.percentiles ?? percentilesBody(times) };
    return { status, body: probabilitiesBody(times) };
  });
  const logger = new RecordingLogger();
  const service = createVenueSkyService({
    apiKey: "apiKey" in options ? options.apiKey : KEY,
    normals: options.normals ?? [SYNTHETIC_NORMALS],
    logger,
    fetchImpl: fetch,
    now: () => clock.now,
    ...(options.dailyCallCap === undefined ? {} : { dailyCallCap: options.dailyCallCap }),
  });
  return { service, calls, logger, clock };
}

describe("horizon selection", () => {
  it("serves the forecast for now", async () => {
    const { service } = harness();
    const answer = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(answer.body.kind).toBe("forecast");
    expect(answer.body.degraded).toBeNull();
    expect(answer.body.validFrom).toBe("2026-10-08T09:30:00.000Z");
    expect(answer.body.validTo).toBe("2026-10-08T10:30:00.000Z");
  });

  it("serves a three-hourly step on day six", async () => {
    const { service } = harness();
    const answer = await service.skyFor(VENUE, ISSUED + 140 * HOUR);
    expect(answer.body.kind).toBe("forecast");
    expect(Date.parse(answer.body.validTo) - Date.parse(answer.body.validFrom)).toBe(3 * HOUR);
  });

  it("serves normals beyond the horizon without calling the Met Office", async () => {
    const { service, calls } = harness();
    const answer = await service.skyFor(VENUE, ISSUED + 30 * 24 * HOUR);
    expect(answer.body.kind).toBe("normals");
    expect(answer.body.degraded).toEqual({ reason: "beyond_forecast_horizon" });
    expect(calls).toHaveLength(0);
  });

  it("serves normals past the forecast's last step", async () => {
    const { service } = harness();
    // The fixture run ends at T+185 h; T+190 h is inside the 192 h pre-check.
    const answer = await service.skyFor(VENUE, ISSUED + 190 * HOUR);
    expect(answer.body.degraded).toEqual({ reason: "beyond_forecast_horizon" });
  });

  it("serves normals for the past", async () => {
    const { service, calls } = harness();
    const longAgo = await service.skyFor(VENUE, ISSUED - 3 * 24 * HOUR);
    expect(longAgo.body.degraded).toEqual({ reason: "before_forecast_window" });
    expect(calls).toHaveLength(0);
    const justBefore = await service.skyFor(VENUE, ISSUED - 2 * HOUR);
    expect(justBefore.body.degraded).toEqual({ reason: "before_forecast_window" });
  });

  it("serves normals marked forecast_not_configured without a key", async () => {
    const { service, calls } = harness({ apiKey: undefined });
    const answer = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(answer.body.kind).toBe("normals");
    expect(answer.body.degraded).toEqual({ reason: "forecast_not_configured" });
    expect(calls).toHaveLength(0);
  });
});

describe("forecast body", () => {
  it("carries the median values in contract units with nothing invented", async () => {
    const { service } = harness();
    const { body } = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(body.cloud).toEqual({ total: 0.5, low: 0.25, mid: null, high: null });
    expect(body.visibilityM).toBe(15_000);
    expect(body.temperatureC).toBeCloseTo(11, 9);
    expect(body.windMs).toBe(4.5);
    expect(body.fog).toBe(0.05);
    expect(body.precipitation).toEqual({ type: "none", probability: 0.2, probabilityDefinition: "rate_at_least_0_1_mm_per_hour", rateMmH: 0 });
    expect(body.weather).toEqual({ code: 7, description: "Cloudy" });
    expect(body.presetHint).toBeNull();
    expect(body.climatology).toBeNull();
    expect(body.issuedAt).toBe("2026-10-08T09:00:00.000Z");
    expect(body.attribution).toEqual([MET_OFFICE_ATTRIBUTION]);
    expect(VenueSkySchema.safeParse(body).success).toBe(true);
  });

  it("states provenance: when the forecast was requested, its age and the site used", async () => {
    const { service, clock } = harness();
    await service.skyFor(VENUE, ISSUED + HOUR);
    clock.now += 600_000;
    const { body } = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(body.provenance.upstreamRequestedAt).toBe("2026-10-08T09:30:00.000Z");
    expect(body.provenance.cacheAgeSeconds).toBe(600);
    expect(body.provenance.forecastSite).toMatchObject({ latitude: 55.8611, longitude: -4.2502 });
    expect(body.provenance.forecastSite?.distanceM).toBeGreaterThan(150);
    expect(body.provenance.forecastSite?.distanceM).toBeLessThan(250);
  });

  it("leaves a parameter the source lacks as null, never a default", async () => {
    const times = forecastTimes(ISSUED, 120, 22);
    const { service } = harness({
      percentiles: percentilesBody(times, { visibilityInAir1p5m: undefined, windSpeed10m: undefined, weatherCodePt01h: undefined, lowTypeCloudAreaFraction: undefined }),
    });
    const { body } = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(body.visibilityM).toBeNull();
    expect(body.windMs).toBeNull();
    expect(body.weather).toBeNull();
    expect(body.precipitation.type).toBeNull();
    expect(body.cloud.low).toBeNull();
    expect(body.cloud.total).toBe(0.5);
  });

  it("gives the sunshine fraction of the day containing the instant", async () => {
    const { service } = harness();
    // The fixture's first full day (8 Oct) has 3 h of sunshine.
    const { body } = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(body.sunshineFraction).toBeGreaterThan(0.25);
    expect(body.sunshineFraction).toBeLessThan(0.3);
  });

  it("sets the preset hint from total cloud only", () => {
    expect(presetHintFromCloud(0.2)).toBe("sunny");
    expect(presetHintFromCloud(0.25)).toBe("sunny");
    expect(presetHintFromCloud(0.5)).toBeNull();
    expect(presetHintFromCloud(0.75)).toBe("overcast");
    expect(presetHintFromCloud(null)).toBeNull();
  });
});

describe("degraded reasons and logging", () => {
  it.each([
    [401, "forecast_key_rejected"],
    [403, "forecast_key_rejected"],
    [429, "forecast_quota_exhausted"],
    [500, "upstream_unavailable"],
  ] as const)("HTTP %i gives normals with %s, logged without the key", async (status, reason) => {
    const { service, logger } = harness({ status: () => status });
    const answer = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(answer.body.kind).toBe("normals");
    expect(answer.body.degraded).toEqual({ reason });
    expect(answer.cacheControl).toBe("public, max-age=300");
    expect(logger.entries.some((entry) => entry.details["event"] === "venue_sky_upstream_failed")).toBe(true);
    expect(JSON.stringify(logger.entries)).not.toContain(KEY);
  });

  it("gives normals with upstream_unavailable for a malformed body", async () => {
    const { service } = harness({ percentiles: { type: "CoverageCollection", parameters: {}, coverages: [] } });
    const answer = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(answer.body.degraded).toEqual({ reason: "upstream_unavailable" });
  });

  it("throws SkyUnavailableError when normals are needed and none cover the venue", async () => {
    const { service } = harness({ apiKey: undefined, normals: [] });
    await expect(service.skyFor(VENUE, ISSUED + HOUR)).rejects.toBeInstanceOf(SkyUnavailableError);
    const far = harness({ apiKey: undefined, normals: [{ ...SYNTHETIC_NORMALS, cell: { latitude: 51.5, longitude: -0.12 } }] });
    await expect(far.service.skyFor(VENUE, ISSUED + HOUR)).rejects.toMatchObject({ forecastReason: "forecast_not_configured" });
  });
});

describe("cache", () => {
  it("fetches once per refresh period and coalesces concurrent requests", async () => {
    const { service, calls, clock } = harness();
    const answers = await Promise.all([
      service.skyFor(VENUE, ISSUED + HOUR),
      service.skyFor(VENUE, ISSUED + 2 * HOUR),
      service.skyFor(VENUE, ISSUED + 30 * HOUR),
    ]);
    expect(answers.every((answer) => answer.body.kind === "forecast")).toBe(true);
    // collections + (instances + position) for each of the two collections.
    expect(calls).toHaveLength(5);
    clock.now += FORECAST_REFRESH_MS - 1;
    await service.skyFor(VENUE, ISSUED + 3 * HOUR);
    expect(calls).toHaveLength(5);
    clock.now += 2;
    await service.skyFor(VENUE, ISSUED + 5 * HOUR);
    // The collection list is kept for a day: four calls per refresh.
    expect(calls).toHaveLength(9);
    expect(service.upstreamCallsToday()).toBe(9);
  });

  it("caps Cache-Control at the forecast's remaining life", async () => {
    const { service, clock } = harness();
    expect((await service.skyFor(VENUE, ISSUED + HOUR)).cacheControl).toBe("public, max-age=900");
    clock.now += FORECAST_REFRESH_MS - 120_000;
    expect((await service.skyFor(VENUE, ISSUED + HOUR)).cacheControl).toBe("public, max-age=120");
  });

  it("holds a failure for the backoff before trying again", async () => {
    let failing = true;
    const { service, calls, clock } = harness({ status: () => (failing ? 503 : 200) });
    await service.skyFor(VENUE, ISSUED + HOUR);
    const afterFailure = calls.length;
    failing = false;
    clock.now += FORECAST_FAILURE_BACKOFF_MS - 1;
    expect((await service.skyFor(VENUE, ISSUED + HOUR)).body.degraded).toEqual({ reason: "upstream_unavailable" });
    expect(calls).toHaveLength(afterFailure);
    clock.now += 2;
    expect((await service.skyFor(VENUE, ISSUED + HOUR)).body.kind).toBe("forecast");
  });

  it("holds a spent quota until the next UTC midnight", async () => {
    let status = 429;
    const { service, calls, clock } = harness({ status: () => status });
    await service.skyFor(VENUE, ISSUED + HOUR);
    const afterFailure = calls.length;
    status = 200;
    clock.now = Date.parse("2026-10-08T23:59:00Z");
    expect((await service.skyFor(VENUE, Date.parse("2026-10-09T01:00:00Z"))).body.degraded).toEqual({ reason: "forecast_quota_exhausted" });
    expect(calls).toHaveLength(afterFailure);
  });

  it("stops at this server's daily cap and reports the quota", async () => {
    const { service, calls } = harness({ dailyCallCap: 2 });
    const answer = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(answer.body.degraded).toEqual({ reason: "forecast_quota_exhausted" });
    expect(calls).toHaveLength(2);
  });

  it("keeps the median forecast when the cap only cuts the probability half", async () => {
    const { service, calls } = harness({ dailyCallCap: 3 });
    const { body } = await service.skyFor(VENUE, ISSUED + HOUR);
    expect(body.kind).toBe("forecast");
    expect(body.fog).toBeNull();
    expect(body.precipitation.probability).toBeNull();
    expect(body.precipitation.probabilityDefinition).toBeNull();
    expect(calls).toHaveLength(3);
  });
});

describe("normals answer", () => {
  it("serves the venue-local month, its rain-day share and sunshine fraction", async () => {
    const { service } = harness({ apiKey: undefined });
    // 23:30 UTC on 30 June is 00:30 BST on 1 July in Glasgow.
    const { body, cacheControl } = await service.skyFor(VENUE, Date.parse("2027-06-30T23:30:00Z"));
    expect(body.climatology?.month).toBe(7);
    expect(body.validFrom).toBe("2027-06-30T23:00:00.000Z");
    expect(body.validTo).toBe("2027-07-31T23:00:00.000Z");
    expect(body.precipitation).toEqual({ type: null, probability: 15 / 31, probabilityDefinition: "share_of_days_with_at_least_1_mm", rateMmH: null });
    expect(body.sunshineFraction).toBeCloseTo(100 / (body.climatology?.astronomicalDaylightHours ?? 1), 9);
    expect(body.cloud).toEqual({ total: null, low: null, mid: null, high: null });
    expect(body.fog).toBeNull();
    expect(body.windMs).toBeNull();
    expect(body.issuedAt).toBeNull();
    expect(body.provenance).toEqual({ upstreamRequestedAt: null, cacheAgeSeconds: null, forecastSite: null });
    expect(body.attribution[0]?.licence).toBe("Open Government Licence v3.0");
    expect(body.attribution[0]?.credit).toContain("Contains public sector information licensed under the Open Government Licence v3.0.");
    expect(cacheControl).toBe("public, max-age=3600");
  });
});
