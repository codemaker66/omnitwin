import type { z } from "zod";
import type { GeoPoint } from "../../lib/venue-site.js";
import type { ListedCollection, WantedParameters } from "./bpf-collections.js";
import {
  CoverageCollectionSchema,
  EdrCollectionsSchema,
  EdrInstancesSchema,
  describeStructure,
  issuePaths,
  unitSymbol,
  type CoverageCollection,
  type EdrCollections,
  type EdrInstances,
} from "./bpf-schemas.js";
import { medianSelector, readSeries, thresholdSelector, type AxisSelector, type Series } from "./coverage-series.js";

// ---------------------------------------------------------------------------
// Met Office Site-Specific Blended Probabilistic Forecast v2 client (T-647).
//
// Product: "Site-Specific Blended Probabilistic Forecast" (BPF) v2 on Weather
// DataHub. Its v1 retires on 11 November 2026 and v1 keys do not work on v2
// (DataHub "Changes & Updates", read 2026-10-08), so only v2 is built.
// - Base URL (API User Guide / OpenAPI server):
//   https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0
// - Auth: the subscription's key in the `apikey` request header (OpenAPI
//   securitySchemes, DataHub FAQ "How do I use an API key?"). A DataHub key
//   is unique to the product subscription it was issued for (FAQ "Can I
//   transfer my API key"), so a key for another product is answered 401.
// - Free plan: up to 55 calls a day, one site, hourly (DataHub pricing,
//   Site-specific). Limits reset at 00:00 UTC; over the limit is 429.
// - Collections: one of percentiles of each parameter, one of probabilities
//   above or below thresholds, for UK and global spot sites. Their v2 ids
//   are read from /collections and chosen by bpf-collections.ts from what
//   each declares; the v1 ids (improver-percentiles-spot-uk, …) are not
//   offered by v2.
// - Horizon (glossary, UK percentiles): hourly to T+120 h, then three-hourly
//   to T+186 h or T+192 h depending on the parameter.
//
// The deterministic value is the 50th percentile, as the Met Office's own
// guide "How to create a deterministic forecast" recommends.
// ---------------------------------------------------------------------------

export const BPF_V2_BASE_URL = "https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0";

/** The 0.1 mm/h precipitation threshold, in the m/s the thresholds use. */
export const PRECIPITATION_THRESHOLD_M_S = 0.1 / 3_600_000;
/** Fog: visibility below 1000 m (WMO). */
export const FOG_VISIBILITY_THRESHOLD_M = 1000;

export type UpstreamFailureKind = "key_rejected" | "quota_exhausted" | "unavailable";

/** A failed upstream exchange. Carries no key, header or body. */
export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamFailureKind,
    readonly stage: string,
    readonly status: number | null,
    readonly detail: readonly string[] = [],
  ) {
    super(`Met Office ${stage}: ${kind}${status === null ? "" : ` (HTTP ${String(status)})`}`);
    this.name = "UpstreamError";
  }
}

/** Upstream calls allowed per UTC day, counted before each call. */
export class DailyCallBudget {
  private day = "";
  private used = 0;

  constructor(readonly cap: number) {}

  tryConsume(now: number): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.cap) return false;
    this.used += 1;
    return true;
  }

  usedOn(now: number): number {
    return new Date(now).toISOString().slice(0, 10) === this.day ? this.used : 0;
  }
}

export interface BpfClientOptions {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly budget: DailyCallBudget;
  readonly now: () => number;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const MAX_RESPONSE_CHARS = 20_000_000;

export class MetOfficeBpfClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: BpfClientOptions) {
    this.baseUrl = options.baseUrl ?? BPF_V2_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async getJson<T>(stage: string, path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    if (!this.options.budget.tryConsume(this.options.now())) {
      throw new UpstreamError("quota_exhausted", stage, null, ["daily call budget reached on this server"]);
    }
    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { apikey: this.options.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      throw new UpstreamError("unavailable", stage, null, [`request failed: ${name}`]);
    }
    if (response.status === 401 || response.status === 403) throw new UpstreamError("key_rejected", stage, response.status);
    if (response.status === 429) throw new UpstreamError("quota_exhausted", stage, response.status);
    if (response.status === 204) throw new UpstreamError("unavailable", stage, 204, ["no content"]);
    if (!response.ok) throw new UpstreamError("unavailable", stage, response.status);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new UpstreamError("unavailable", stage, response.status, ["response too large"]);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamError("unavailable", stage, response.status, ["response is not JSON"]);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // What failed and the body's shape (names, counts, type strings; no values).
      const shape = describeStructure(json).map((line) => `body: ${line}`);
      throw new UpstreamError("unavailable", stage, response.status, [...issuePaths(parsed.error), ...shape]);
    }
    return parsed.data;
  }

  async collections(): Promise<ListedCollection[]> {
    const body = await this.getJson("collections", "/collections", EdrCollectionsSchema);
    return body.collections.map(listedCollection);
  }

  instances(collection: string): Promise<EdrInstances> {
    return this.getJson(`instances ${collection}`, `/collections/${encodeURIComponent(collection)}/instances`, EdrInstancesSchema);
  }

  position(
    collection: string,
    instanceId: string,
    point: GeoPoint,
    parameterNames: readonly string[],
    percentiles: string | null,
  ): Promise<CoverageCollection> {
    const query = [
      `coords=${encodeURIComponent(`POINT(${String(point.longitude)} ${String(point.latitude)})`)}`,
      `parameter-name=${encodeURIComponent(parameterNames.join(","))}`,
      ...(percentiles === null ? [] : [`percentiles=${encodeURIComponent(percentiles)}`]),
    ].join("&");
    const path = `/collections/${encodeURIComponent(collection)}/instances/${encodeURIComponent(instanceId)}/position?${query}`;
    return this.getJson(`position ${collection}`, path, CoverageCollectionSchema);
  }
}

/** A listed collection as the selection reads it. Its title and its EDR
 *  parameter_names are used only when present and of the documented shape
 *  (a string; an object keyed by parameter); an empty declaration counts as
 *  none. */
export function listedCollection(raw: EdrCollections["collections"][number]): ListedCollection {
  const title = typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title : null;
  const names = raw.parameter_names;
  const keys = typeof names === "object" && names !== null && !Array.isArray(names) ? Object.keys(names) : [];
  return { id: raw.id, title, parameters: keys.length === 0 ? null : keys };
}

/** The newest instance: by its id when ids are date-times (the run time),
 *  else by the start of its temporal extent. issuedAt is stated only when
 *  the id is a date-time. Null when no instance can be ordered. */
export function latestInstance(body: EdrInstances): { id: string; issuedAt: string | null } | null {
  const dated = body.instances.map((instance) => {
    const fromId = Date.parse(instance.id);
    const start = instance.extent?.temporal?.interval?.[0]?.[0] ?? null;
    const fromExtent = start === null ? Number.NaN : Date.parse(start);
    return {
      id: instance.id,
      issuedAt: Number.isFinite(fromId) ? new Date(fromId).toISOString() : null,
      order: Number.isFinite(fromId) ? fromId : fromExtent,
    };
  });
  if (dated.length === 1 && !Number.isFinite(dated[0]?.order)) {
    const only = dated[0];
    return only === undefined ? null : { id: only.id, issuedAt: null };
  }
  const orderable = dated.filter((entry) => Number.isFinite(entry.order));
  if (orderable.length === 0) return null;
  const newest = orderable.reduce((a, b) => (b.order > a.order ? b : a));
  return { id: newest.id, issuedAt: newest.issuedAt };
}

// ---------------------------------------------------------------------------
// The parameters read, their documented units (DataHub glossary) and the
// conversion to the sky contract's units. A declared unit outside the
// accepted spellings makes that parameter unusable (null), never rescaled
// by guess; an undeclared unit is taken as the glossary's.
// ---------------------------------------------------------------------------

type Converter = (value: number) => number | null;

const fraction: Converter = (v) => (v < -1e-6 || v > 1 + 1e-6 ? null : Math.min(1, Math.max(0, v)));
const percentToFraction: Converter = (v) => fraction(v / 100);
const nonNegative: Converter = (v) => (v < -1e-9 ? null : Math.max(0, v));
const metresPerSecondToMmPerHour: Converter = (v) => nonNegative(v * 3_600_000);
const kelvinToCelsius: Converter = (v) => {
  const celsius = v - 273.15;
  return celsius < -100 || celsius > 70 ? null : celsius;
};
const identity: Converter = (v) => v;

const SPEED_UNITS = ["m/s", "m s-1", "m.s-1", "m s^-1"] as const;

interface ParameterSpec {
  readonly key: string;
  readonly documentedUnit: string;
  readonly units: Readonly<Record<string, Converter>>;
}

const fractionUnits = { "1": fraction, "%": percentToFraction };
const speedUnits = (convert: Converter): Record<string, Converter> =>
  Object.fromEntries(SPEED_UNITS.map((unit) => [unit, convert]));

export const PERCENTILE_PARAMETERS = {
  cloudTotal: { key: "cloudAreaFraction", documentedUnit: "1", units: fractionUnits },
  cloudLow: { key: "lowTypeCloudAreaFraction", documentedUnit: "1", units: fractionUnits },
  visibility: { key: "visibilityInAir1p5m", documentedUnit: "m", units: { m: nonNegative } },
  precipitationRate: { key: "lwePrecipitationRate", documentedUnit: "m/s", units: speedUnits(metresPerSecondToMmPerHour) },
  temperature: { key: "airTemperature1p5m", documentedUnit: "K", units: { K: kelvinToCelsius } },
  wind: { key: "windSpeed10m", documentedUnit: "m/s", units: speedUnits(nonNegative) },
  weatherCode1h: { key: "weatherCodePt01h", documentedUnit: "1", units: { "1": identity, "n/a": identity } },
  weatherCode3h: { key: "weatherCodePt03h", documentedUnit: "1", units: { "1": identity, "n/a": identity } },
  sunshine24h: { key: "durationOfSunshineSumPt24h", documentedUnit: "s", units: { s: nonNegative } },
} as const satisfies Record<string, ParameterSpec>;

export const PROBABILITY_PARAMETERS = {
  precipitationProbability: { key: "probabilityOfLwePrecipitationRateAboveThreshold", documentedUnit: "1", units: fractionUnits },
  fogProbability: { key: "probabilityOfVisibilityInAirBelowThreshold1p5m", documentedUnit: "1", units: fractionUnits },
} as const satisfies Record<string, ParameterSpec>;

/** The parameters a collection must declare to be chosen for its kind. */
export const WANTED_COLLECTION_PARAMETERS: WantedParameters = {
  percentilesEssential: [PERCENTILE_PARAMETERS.cloudTotal.key, PERCENTILE_PARAMETERS.temperature.key],
  percentiles: Object.values(PERCENTILE_PARAMETERS).map((spec) => spec.key),
  probabilities: Object.values(PROBABILITY_PARAMETERS).map((spec) => spec.key),
};

export type ForecastSeriesName = keyof typeof PERCENTILE_PARAMETERS | keyof typeof PROBABILITY_PARAMETERS;

const PROBABILITY_SELECTORS: Record<keyof typeof PROBABILITY_PARAMETERS, AxisSelector> = {
  precipitationProbability: thresholdSelector(PRECIPITATION_THRESHOLD_M_S),
  fogProbability: thresholdSelector(FOG_VISIBILITY_THRESHOLD_M),
};

export interface ForecastSnapshot {
  readonly collection: string;
  /** The probability collection that supplied values, or null when none was
   *  offered, its read failed or none of its values were usable. */
  readonly probabilityCollection: string | null;
  readonly instanceId: string;
  readonly issuedAt: string | null;
  readonly requestedAt: number;
  readonly site: GeoPoint | null;
  /** Each series in the sky contract's units; absent when unusable. */
  readonly series: Readonly<Partial<Record<ForecastSeriesName, Series>>>;
  /** Why parameters were dropped, for the log. */
  readonly problems: readonly string[];
}

function convertSeries(collection: CoverageCollection, spec: ParameterSpec, select: AxisSelector, problems: string[]): Series | null {
  const read = readSeries(collection, spec.key, select);
  if (read.status === "absent") {
    problems.push(`${spec.key}: absent`);
    return null;
  }
  if (read.status === "invalid") {
    problems.push(read.problem);
    return null;
  }
  const declared = unitSymbol(collection, spec.key) ?? spec.documentedUnit;
  const convert = spec.units[declared];
  if (convert === undefined) {
    problems.push(`${spec.key}: unexpected unit ${declared}`);
    return null;
  }
  return { ...read.series, values: read.series.values.map((value) => (value === null ? null : convert(value))) };
}

function siteOf(collection: CoverageCollection): GeoPoint | null {
  const axes = collection.coverages[0]?.domain.axes;
  const x = axes?.["x"]?.values?.[0];
  const y = axes?.["y"]?.values?.[0];
  if (typeof x !== "number" || typeof y !== "number" || Math.abs(y) > 90 || Math.abs(x) > 180) return null;
  return { latitude: y, longitude: x };
}

async function newestInstance(client: MetOfficeBpfClient, collection: string): Promise<{ id: string; issuedAt: string | null }> {
  const instance = latestInstance(await client.instances(collection));
  if (instance === null) throw new UpstreamError("unavailable", `instances ${collection}`, 200, ["no orderable instance"]);
  return instance;
}

/**
 * Fetches the newest forecast for a point: the percentile collection's
 * newest instance (median of each parameter) and, when available, the
 * probability collection's (precipitation at 0.1 mm/h, fog below 1000 m).
 * Four calls; a failure of the probability half drops only the
 * probabilities.
 */
export async function fetchForecastSnapshot(
  client: MetOfficeBpfClient,
  collections: { percentiles: string; probabilities: string | null },
  point: GeoPoint,
  now: () => number,
): Promise<ForecastSnapshot> {
  const requestedAt = now();
  const problems: string[] = [];
  const instance = await newestInstance(client, collections.percentiles);
  const percentileKeys = Object.values(PERCENTILE_PARAMETERS).map((spec) => spec.key);
  const percentiles = await client.position(collections.percentiles, instance.id, point, percentileKeys, "50");
  const series: Partial<Record<ForecastSeriesName, Series>> = {};
  for (const [name, spec] of Object.entries(PERCENTILE_PARAMETERS) as [keyof typeof PERCENTILE_PARAMETERS, ParameterSpec][]) {
    const converted = convertSeries(percentiles, spec, medianSelector, problems);
    if (converted !== null) series[name] = converted;
  }
  if (series.cloudTotal === undefined && series.temperature === undefined) {
    throw new UpstreamError("unavailable", `position ${collections.percentiles}`, 200, ["neither total cloud nor temperature is usable", ...problems]);
  }

  let probabilityCollection: string | null = null;
  if (collections.probabilities === null) {
    problems.push("probability collection not offered");
  } else {
    try {
      const probabilityInstance = await newestInstance(client, collections.probabilities);
      const probabilityKeys = Object.values(PROBABILITY_PARAMETERS).map((spec) => spec.key);
      const probabilities = await client.position(collections.probabilities, probabilityInstance.id, point, probabilityKeys, null);
      for (const [name, spec] of Object.entries(PROBABILITY_PARAMETERS) as [keyof typeof PROBABILITY_PARAMETERS, ParameterSpec][]) {
        const converted = convertSeries(probabilities, spec, PROBABILITY_SELECTORS[name], problems);
        if (converted === null) continue;
        series[name] = converted;
        probabilityCollection = collections.probabilities;
      }
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      problems.push(`probabilities dropped: ${error.message}`);
    }
  }

  return {
    collection: collections.percentiles,
    probabilityCollection,
    instanceId: instance.id,
    issuedAt: instance.issuedAt,
    requestedAt,
    site: siteOf(percentiles),
    series,
    problems,
  };
}
