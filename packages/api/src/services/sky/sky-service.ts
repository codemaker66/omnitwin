import {
  SKY_PRESET_OVERCAST_MIN_CLOUD,
  SKY_PRESET_SUNNY_MAX_CLOUD,
  VenueSkySchema,
  type SkyAttribution,
  type SkyDegradedReason,
  type SkyPresetHint,
  type VenueSky,
} from "@omnitwin/types";
import { haversineDistanceM, type GeoPoint } from "../../lib/venue-site.js";
import { describeListing, offeredIds, selectCollections } from "./bpf-collections.js";
import { locateStep, valueAt, type Series } from "./coverage-series.js";
import {
  DailyCallBudget,
  MetOfficeBpfClient,
  UpstreamError,
  WANTED_COLLECTION_PARAMETERS,
  fetchForecastSnapshot,
  type ForecastSnapshot,
} from "./met-office-bpf.js";
import { buildNormalsSky, normalsFor, type SkyNormalsFile } from "./normals.js";
import { weatherCodeEntry } from "./weather-codes.js";

// ---------------------------------------------------------------------------
// The venue sky service (T-647): which source answers an instant, the
// forecast cache, and the bodies.
//
// Selection, for a located venue and an instant `at`:
// 1. `at` more than 6 h before now: normals, before_forecast_window (the
//    past is not forecast; observations are reserved).
// 2. `at` more than 192 h after now: normals, beyond_forecast_horizon,
//    without calling the Met Office.
// 3. No key: normals, forecast_not_configured.
// 4. Otherwise the cached forecast; a failed fetch gives normals with
//    forecast_key_rejected, forecast_quota_exhausted or upstream_unavailable.
// 5. `at` before the forecast's first step or after its last: normals with
//    before_forecast_window or beyond_forecast_horizon.
// When normals are needed but none cover the venue, SkyUnavailableError.
//
// Cache: one forecast per venue location, held in process. The BPF is
// issued hourly; a forecast is refetched every fourth issue (4 h), so a
// refresh costs 4 of the free plan's 55 daily calls and steady state is 24
// calls a day. Concurrent requests share one fetch. Failures are held too:
// 30 min for an unavailable upstream, 1 h for a refused key, and until the
// next 00:00 UTC for a spent quota (when the Met Office resets it). A cap of
// 40 calls per UTC day on this process keeps a restart loop or a burst of
// new locations inside the plan.
//
// Collections: the listing is read once a day and the percentile and
// probability collections are chosen from it by bpf-collections.ts; the
// choice and the whole listing (ids, titles, parameter counts) are logged.
// A listing with no usable percentile collection is logged with what it
// offered and held for 6 h, so retries cost 4 calls a day, not one per
// failed forecast. The selection log also names the sunshine parameters the
// chosen collection declares.
//
// The first successful forecast in a process is logged once
// (venue_sky_forecast_metadata) with what each field was read from: key,
// unit, axis labels and the chosen index, time-axis length and spacing,
// period lengths. Never a forecast value.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
export const BPF_ISSUE_CADENCE_MS = HOUR_MS;
export const FORECAST_REFRESH_MS = 4 * BPF_ISSUE_CADENCE_MS;
export const FORECAST_FAILURE_BACKOFF_MS = 30 * 60_000;
export const FORECAST_KEY_REJECTED_BACKOFF_MS = HOUR_MS;
export const COLLECTIONS_REFRESH_MS = 24 * HOUR_MS;
export const COLLECTIONS_UNMATCHED_RETRY_MS = 6 * HOUR_MS;
export const DAILY_UPSTREAM_CALL_CAP = 40;
export const FORECAST_MAX_HORIZON_MS = 192 * HOUR_MS;
export const FORECAST_PAST_GRACE_MS = 6 * HOUR_MS;

export const MET_OFFICE_ATTRIBUTION: SkyAttribution = {
  source: "Met Office Weather DataHub: Site-Specific Blended Probabilistic Forecast v2",
  // The statement the DataHub FAQ requires applications to show.
  credit: "Powered by Met Office data",
  licence: "Met Office Weather DataHub terms and conditions",
  licenceUrl: "https://www.metoffice.gov.uk/api/assets/file/met-office-weatherdatahub-terms-and-conditionspdf?prefix=assets",
};

export interface SkyLogger {
  warn(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
}

export interface VenueForSky {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
}

export interface VenueSkyAnswer {
  readonly body: VenueSky;
  readonly cacheControl: string;
}

export class SkyUnavailableError extends Error {
  constructor(readonly forecastReason: SkyDegradedReason) {
    super(`No sky: forecast not served (${forecastReason}) and no normals cover this venue`);
    this.name = "SkyUnavailableError";
  }
}

export interface VenueSkyService {
  skyFor(venue: VenueForSky, at: number): Promise<VenueSkyAnswer>;
  /** Upstream calls made today on this process (for tests and logs). */
  upstreamCallsToday(): number;
}

export interface VenueSkyServiceOptions {
  readonly apiKey: string | undefined;
  readonly normals: readonly SkyNormalsFile[];
  readonly logger: SkyLogger;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly baseUrl?: string;
  readonly dailyCallCap?: number;
}

/** The collection ids a forecast is read from. */
interface ChosenCollections {
  readonly percentiles: string;
  readonly probabilities: string | null;
}

type ForecastEntry =
  | { readonly ok: true; readonly snapshot: ForecastSnapshot; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: SkyDegradedReason; readonly retryAt: number };

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function presetHintFromCloud(total: number | null): SkyPresetHint | null {
  if (total === null) return null;
  if (total <= SKY_PRESET_SUNNY_MAX_CLOUD) return "sunny";
  if (total >= SKY_PRESET_OVERCAST_MIN_CLOUD) return "overcast";
  return null;
}

function at(series: Series | undefined, instant: number): number | null {
  if (series === undefined) return null;
  return valueAt(series, instant) ?? null;
}

/** A forecast answer for the step that stands for `instant`. */
export function buildForecastSky(
  snapshot: ForecastSnapshot,
  venue: VenueForSky,
  instant: number,
  step: { readonly validFrom: number; readonly validTo: number },
  now: number,
): VenueSky {
  const { series } = snapshot;
  const code = weatherCodeEntry(at(series.weatherCode1h, instant) ?? at(series.weatherCode3h, instant));
  const cloudTotal = at(series.cloudTotal, instant);
  const precipitationProbability = at(series.precipitationProbability, instant);
  return {
    venueId: venue.id,
    kind: "forecast",
    source: `Met Office Site-Specific Blended Probabilistic Forecast v2 (${snapshot.collection}, 50th percentile${
      snapshot.probabilityCollection === null ? "" : `; probabilities from ${snapshot.probabilityCollection}`})`,
    issuedAt: snapshot.issuedAt,
    validFrom: new Date(step.validFrom).toISOString(),
    validTo: new Date(step.validTo).toISOString(),
    at: new Date(instant).toISOString(),
    cloud: { total: cloudTotal, low: at(series.cloudLow, instant), mid: null, high: null },
    visibilityM: at(series.visibility, instant),
    fog: at(series.fogProbability, instant),
    precipitation: {
      type: code?.precipitation ?? null,
      probability: precipitationProbability,
      probabilityDefinition: precipitationProbability === null ? null : "rate_at_least_0_1_mm_per_hour",
      rateMmH: at(series.precipitationRate, instant),
    },
    windMs: at(series.wind, instant),
    temperatureC: at(series.temperature, instant),
    // BPF v2 has sunshine only as a 24 h sum ending at each step, which
    // describes the day before the step, not the sky at `instant`.
    sunshineFraction: null,
    weather: code === null ? null : { code: code.code, description: code.description },
    presetHint: presetHintFromCloud(cloudTotal),
    climatology: null,
    degraded: null,
    attribution: [MET_OFFICE_ATTRIBUTION],
    provenance: {
      upstreamRequestedAt: new Date(snapshot.requestedAt).toISOString(),
      cacheAgeSeconds: Math.max(0, Math.floor((now - snapshot.requestedAt) / 1000)),
      forecastSite: snapshot.site === null
        ? null
        : { ...snapshot.site, distanceM: Math.round(haversineDistanceM(snapshot.site, venue)) },
    },
  };
}

/** How long a normals answer may be reused. Short after an upstream
 *  failure, which may clear; an hour when the cause is the date or the
 *  configuration. */
function normalsMaxAge(reason: SkyDegradedReason): number {
  switch (reason) {
    case "upstream_unavailable":
    case "forecast_key_rejected":
    case "forecast_quota_exhausted":
      return 300;
    case "forecast_not_configured":
    case "beyond_forecast_horizon":
    case "before_forecast_window":
      return 3600;
  }
}

export function createVenueSkyService(options: VenueSkyServiceOptions): VenueSkyService {
  const now = options.now ?? (() => Date.now());
  const budget = new DailyCallBudget(options.dailyCallCap ?? DAILY_UPSTREAM_CALL_CAP);
  const apiKey = options.apiKey;
  const client = apiKey === undefined
    ? null
    : new MetOfficeBpfClient({
      apiKey,
      fetchImpl: options.fetchImpl ?? fetch,
      budget,
      now,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    });
  const entries = new Map<string, ForecastEntry>();
  const inFlight = new Map<string, Promise<ForecastEntry>>();
  let collections:
    | { readonly ok: true; readonly ids: ChosenCollections; readonly expiresAt: number }
    | { readonly ok: false; readonly error: UpstreamError; readonly expiresAt: number }
    | null = null;
  let metadataLogged = false;

  async function collectionIds(bpf: MetOfficeBpfClient): Promise<ChosenCollections> {
    if (collections !== null && now() < collections.expiresAt) {
      if (!collections.ok) throw collections.error;
      return collections.ids;
    }
    const listed = await bpf.collections();
    const selection = selectCollections(listed, WANTED_COLLECTION_PARAMETERS);
    const offered = describeListing(listed);
    if (selection.percentiles === null) {
      options.logger.warn(
        { event: "venue_sky_collections_unmatched", offered, probabilities: selection.probabilities },
        "Met Office listed no usable percentile collection; serving normals",
      );
      const error = new UpstreamError("unavailable", "collections", 200, ["percentile collection not offered", `offered: ${offeredIds(listed)}`]);
      collections = { ok: false, error, expiresAt: now() + COLLECTIONS_UNMATCHED_RETRY_MS };
      throw error;
    }
    const chosen = listed.find((collection) => collection.id === selection.percentiles?.id);
    // The sunshine parameters it declares (null when it declares none); none
    // is read, but the names show whether an hourly one is ever offered.
    const sunshineParameters = chosen === undefined || chosen.parameters === null
      ? null
      : chosen.parameters.filter((name) => /sunshine/iu.test(name)).slice(0, 20).map((name) => name.replace(/[^ -~]+/gu, "?").slice(0, 100));
    options.logger.info(
      { event: "venue_sky_collections_selected", percentiles: selection.percentiles, probabilities: selection.probabilities, sunshineParameters, offered },
      "Met Office collections chosen for the sky",
    );
    const ids = { percentiles: selection.percentiles.id, probabilities: selection.probabilities?.id ?? null };
    collections = { ok: true, ids, expiresAt: now() + COLLECTIONS_REFRESH_MS };
    return ids;
  }

  async function refresh(bpf: MetOfficeBpfClient, point: GeoPoint): Promise<ForecastEntry> {
    try {
      const snapshot = await fetchForecastSnapshot(bpf, await collectionIds(bpf), point, now);
      if (!metadataLogged) {
        metadataLogged = true;
        options.logger.info(
          {
            event: "venue_sky_forecast_metadata",
            collection: snapshot.collection,
            probabilityCollection: snapshot.probabilityCollection,
            instanceId: snapshot.instanceId,
            issuedAt: snapshot.issuedAt,
            series: snapshot.metadata,
          },
          "Met Office forecast read: keys, units, axis labels and time steps (no values)",
        );
      }
      if (snapshot.problems.length > 0) {
        options.logger.warn({ event: "venue_sky_forecast_partial", problems: snapshot.problems }, "Met Office forecast fetched with unusable parameters");
      }
      return { ok: true, snapshot, expiresAt: snapshot.requestedAt + FORECAST_REFRESH_MS };
    } catch (error) {
      const failedAt = now();
      if (error instanceof UpstreamError) {
        options.logger.warn(
          { event: "venue_sky_upstream_failed", kind: error.kind, stage: error.stage, status: error.status, detail: error.detail },
          "Met Office forecast unavailable; serving normals",
        );
        switch (error.kind) {
          case "key_rejected":
            return { ok: false, reason: "forecast_key_rejected", retryAt: failedAt + FORECAST_KEY_REJECTED_BACKOFF_MS };
          case "quota_exhausted":
            return { ok: false, reason: "forecast_quota_exhausted", retryAt: nextUtcMidnight(failedAt) };
          case "unavailable":
            return { ok: false, reason: "upstream_unavailable", retryAt: failedAt + FORECAST_FAILURE_BACKOFF_MS };
        }
      }
      options.logger.warn(
        { event: "venue_sky_upstream_failed", kind: "unexpected", error: error instanceof Error ? error.name : "unknown" },
        "Met Office forecast failed unexpectedly; serving normals",
      );
      return { ok: false, reason: "upstream_unavailable", retryAt: failedAt + FORECAST_FAILURE_BACKOFF_MS };
    }
  }

  function forecastFor(bpf: MetOfficeBpfClient, point: GeoPoint): Promise<ForecastEntry> {
    const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    const cached = entries.get(key);
    if (cached !== undefined && now() < (cached.ok ? cached.expiresAt : cached.retryAt)) return Promise.resolve(cached);
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const fetching = refresh(bpf, point).then((entry) => {
      entries.set(key, entry);
      return entry;
    }).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, fetching);
    return fetching;
  }

  function normals(venue: VenueForSky, instant: number, reason: SkyDegradedReason): VenueSkyAnswer {
    const file = normalsFor(options.normals, venue);
    if (file === null) throw new SkyUnavailableError(reason);
    const body = VenueSkySchema.parse(buildNormalsSky(file, { venueId: venue.id, timeZone: venue.timezone, at: instant, reason }));
    return { body, cacheControl: `public, max-age=${String(normalsMaxAge(reason))}` };
  }

  return {
    upstreamCallsToday: () => budget.usedOn(now()),
    async skyFor(venue, instant) {
      const current = now();
      if (instant < current - FORECAST_PAST_GRACE_MS) return normals(venue, instant, "before_forecast_window");
      if (instant > current + FORECAST_MAX_HORIZON_MS) return normals(venue, instant, "beyond_forecast_horizon");
      if (client === null) return normals(venue, instant, "forecast_not_configured");

      const entry = await forecastFor(client, venue);
      if (!entry.ok) return normals(venue, instant, entry.reason);
      const grid = entry.snapshot.series.cloudTotal ?? entry.snapshot.series.temperature;
      if (grid === undefined) return normals(venue, instant, "upstream_unavailable");
      const step = locateStep(grid.times, instant);
      if (step === "before") return normals(venue, instant, "before_forecast_window");
      if (step === "after") return normals(venue, instant, "beyond_forecast_horizon");

      const answeredAt = now();
      const body = VenueSkySchema.parse(buildForecastSky(entry.snapshot, venue, instant, step, answeredAt));
      const maxAge = Math.max(0, Math.min(900, Math.floor((entry.expiresAt - answeredAt) / 1000)));
      return { body, cacheControl: `public, max-age=${String(maxAge)}` };
    },
  };
}
