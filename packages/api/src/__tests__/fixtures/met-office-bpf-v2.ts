// ---------------------------------------------------------------------------
// Met Office BPF v2 test bodies (T-647). NOT Met Office responses.
//
// No live response body has been seen here. Production showed on 10
// October that the key is accepted and that the v2 listing offers neither
// improver-percentiles-spot-uk nor anything ending in it (the v1 ids). The
// DataHub's own sample files may not be redistributed. These bodies are
// built from the documented structure only, with synthetic numbers chosen
// to exercise the code:
// - /collections: the OpenAPI definition's collections schema
//   (mo-site-specific-blended-probabilistic-forecast-v2_subscriber.json,
//   components.schemas.MODEL3b85ce / collection: id, title, links,
//   output_formats), with EDR parameter_names where a test needs them. The
//   v2 ids are a third-party client's (see bpf-collections.ts), unverified.
// - /instances: OGC API - EDR Part 1 (OGC 19-086r6) instances, as the API
//   User Guide describes ("explore available versions, time ranges").
// - /position: the API User Guide, "Understand Forecast Data Responses"
//   (https://datahub.metoffice.gov.uk/docs/f/category/site-specific/type/probabilistic-forecast-feature/api-user-guide):
//   a CoverageCollection of PointSeries coverages, one per parameter, with
//   t / x / y / z / locationId axes, an extra threshold or percentile axis,
//   `bounds` for period parameters, and NdArray ranges. Parameters sit on
//   each coverage by default, as the live service sends them (no
//   collection-level parameters, production 10 October; CoverageJSON
//   9.6.4), or on the collection (9.6.5) where a test asks.
// - Parameter keys: the DataHub "BPF v2 parameter name changes" table and
//   glossary; units: the glossary ("1", "m", "m/s", "K", "s").
// ---------------------------------------------------------------------------

export const FIXTURE_SITE = { latitude: 55.8611, longitude: -4.2502 } as const;

/** The v2 ids a third-party client lists (unverified against a live listing). */
export const V2_COLLECTION_IDS = ["uk-spot-percentiles", "uk-spot-probabilities", "global-spot-percentiles", "global-spot-probabilities"] as const;
/** The v1 ids (Met Office weather_datahub_utilities), which v2 does not offer. */
export const V1_COLLECTION_IDS = ["improver-percentiles-spot-uk", "improver-probabilities-spot-uk"] as const;

/** A /collections body; `parameters` adds EDR parameter_names to the ids it names. */
export function collectionsBody(
  ids: readonly string[] = V2_COLLECTION_IDS,
  parameters: Readonly<Record<string, readonly string[]>> = {},
): unknown {
  return {
    collections: ids.map((id) => ({
      id,
      title: id,
      links: [{ href: `/collections/${id}`, rel: "data" }],
      output_formats: ["CoverageJSON"],
      ...(parameters[id] === undefined
        ? {}
        : { parameter_names: Object.fromEntries((parameters[id] ?? []).map((key) => [key, { type: "Parameter" }])) }),
    })),
    links: [],
  };
}

/** A listing with no usable percentile collection: probability sets, a
 *  percentile set holding only wind (no total cloud or temperature, so no
 *  forecast can stand on it) and one declaring nothing the sky reads. */
export function listingWithoutPercentilesBody(): unknown {
  return collectionsBody(
    ["uk-spot-probabilities", "global-spot-probabilities", "uk-spot-percentiles-wind", "uk-spot-summary"],
    {
      "uk-spot-percentiles-wind": ["windSpeed10m", "windSpeedOfGust10mMaximumPt01h"],
      "uk-spot-summary": ["ultravioletIndex"],
    },
  );
}

export function instancesBody(ids: readonly string[]): unknown {
  return {
    instances: ids.map((id) => ({
      id,
      links: [],
      extent: { temporal: { interval: [[id, null]] } },
    })),
    links: [],
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

interface ParameterFixture {
  readonly unit?: string;
  /** One value per time. */
  readonly values: readonly (number | null)[];
  /** Period parameters: [start, end] per time, as epoch ms. */
  readonly bounds?: readonly (readonly [number, number])[];
  /** Times for this parameter (defaults to the collection's). */
  readonly times?: readonly number[];
  /** An extra axis and the index the wanted value sits at. */
  readonly extraAxis?: { readonly name: string; readonly values: readonly (string | number)[]; readonly at: number };
}

/** Where a body defines its parameters. CoverageJSON (OGC 21-069r2) lets a
 *  coverage collection hold them (9.6.5) or, when it does not, requires each
 *  coverage to hold its own (9.6.4). The live v2 service sends no
 *  collection-level parameters (production, 10 October), so "coverage" is
 *  the default. */
export type ParametersAt = "collection" | "coverage";

function parameterObject(key: string, fixture: ParameterFixture): unknown {
  return { type: "Parameter", observedProperty: { label: { en: key } }, ...(fixture.unit === undefined ? {} : { unit: { symbol: fixture.unit } }) };
}

function coverage(key: string, fixture: ParameterFixture, times: readonly number[], parametersAt: ParametersAt): unknown {
  const ts = fixture.times ?? times;
  const axes: Record<string, unknown> = {
    t: {
      values: ts.map(iso),
      ...(fixture.bounds === undefined ? {} : { bounds: fixture.bounds.flatMap(([a, b]) => [iso(a), iso(b)]) }),
    },
    x: { values: [FIXTURE_SITE.longitude] },
    y: { values: [FIXTURE_SITE.latitude] },
    z: { values: [12.0] },
    locationId: { values: ["00000001"] },
  };
  let axisNames = ["t"];
  let shape = [ts.length];
  let values: (number | null)[] = [...fixture.values];
  if (fixture.extraAxis !== undefined) {
    const extra = fixture.extraAxis;
    axes[extra.name] = { values: [...extra.values] };
    axisNames = ["t", extra.name];
    shape = [ts.length, extra.values.length];
    // Row-major: for each time, one value per extra-axis entry. The wanted
    // value sits at `at`; the others are distinct decoys.
    values = fixture.values.flatMap((value) =>
      extra.values.map((_, index) => (index === extra.at ? value : 9_999 + index)));
  }
  return {
    type: "Coverage",
    domain: { type: "Domain", axes },
    ...(parametersAt === "coverage" ? { parameters: { [key]: parameterObject(key, fixture) } } : {}),
    ranges: { [key]: { type: "NdArray", dataType: "float", axisNames, shape, values } },
  };
}

export function coverageCollectionBody(
  times: readonly number[],
  parameters: Readonly<Record<string, ParameterFixture>>,
  parametersAt: ParametersAt = "coverage",
): unknown {
  return {
    type: "CoverageCollection",
    domainType: "PointSeries",
    ...(parametersAt === "collection"
      ? { parameters: Object.fromEntries(Object.entries(parameters).map(([key, fixture]) => [key, parameterObject(key, fixture)])) }
      : {}),
    referencing: [],
    coverages: Object.entries(parameters).map(([key, fixture]) => coverage(key, fixture, times, parametersAt)),
  };
}

const HOUR = 3_600_000;

/** Hourly steps from `issued` for `hourly` hours, then three-hourly. */
export function forecastTimes(issued: number, hourly: number, threeHourly: number): number[] {
  const times: number[] = [];
  for (let h = 0; h < hourly; h += 1) times.push(issued + h * HOUR);
  const last = times.at(-1) ?? issued;
  for (let k = 1; k <= threeHourly; k += 1) times.push(last + k * 3 * HOUR);
  return times;
}

const PERCENTILES = { name: "percentile", values: [50], at: 0 } as const;

/** A percentile body: each parameter's values the same at every step
 *  unless given per step. */
export function percentilesBody(
  times: readonly number[],
  overrides: Partial<Record<string, ParameterFixture>> = {},
  parametersAt: ParametersAt = "coverage",
): unknown {
  const n = times.length;
  const constant = (value: number): number[] => Array.from({ length: n }, () => value);
  const day = 24 * HOUR;
  const firstMidnight = Math.floor((times[0] ?? 0) / day) * day;
  const base: Record<string, ParameterFixture> = {
    cloudAreaFraction: { unit: "1", values: constant(0.5), extraAxis: PERCENTILES },
    lowTypeCloudAreaFraction: { unit: "1", values: constant(0.25), extraAxis: PERCENTILES },
    visibilityInAir1p5m: { unit: "m", values: constant(15_000), extraAxis: PERCENTILES },
    lwePrecipitationRate: { unit: "m/s", values: constant(0), extraAxis: PERCENTILES },
    airTemperature1p5m: { unit: "K", values: constant(284.15), extraAxis: PERCENTILES },
    windSpeed10m: { unit: "m/s", values: constant(4.5), extraAxis: PERCENTILES },
    weatherCodePt01h: {
      unit: "1",
      values: constant(7),
      bounds: times.map((t) => [t - HOUR, t] as const),
    },
    durationOfSunshineSumPt24h: {
      unit: "s",
      times: [firstMidnight + day, firstMidnight + 2 * day],
      values: [3 * 3600, 5 * 3600],
      bounds: [[firstMidnight, firstMidnight + day], [firstMidnight + day, firstMidnight + 2 * day]],
      extraAxis: PERCENTILES,
    },
  };
  // An override of undefined removes that parameter from the body.
  const merged: Record<string, ParameterFixture> = {};
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) merged[key] = value;
  }
  return coverageCollectionBody(times, merged, parametersAt);
}

/** A probability body: precipitation at the 0.1 mm/h threshold and fog
 *  below 1000 m, each among other thresholds. */
export function probabilitiesBody(times: readonly number[], precipitation = 0.2, fog = 0.05, parametersAt: ParametersAt = "coverage"): unknown {
  const n = times.length;
  return coverageCollectionBody(times, {
    probabilityOfLwePrecipitationRateAboveThreshold: {
      unit: "1",
      values: Array.from({ length: n }, () => precipitation),
      extraAxis: {
        name: "probabilityOfLwePrecipitationRateAboveThresholdValues",
        values: [">=8.333e-09", ">=2.778e-08", ">=6.944e-08"],
        at: 1,
      },
    },
    probabilityOfVisibilityInAirBelowThreshold1p5m: {
      unit: "1",
      values: Array.from({ length: n }, () => fog),
      extraAxis: {
        name: "probabilityOfVisibilityInAirBelowThreshold1p5mValues",
        values: ["<200.0", "<1000.0", "<5000.0"],
        at: 1,
      },
    },
  }, parametersAt);
}

export interface RecordedCall {
  readonly url: string;
  readonly apikey: string | null;
}

/** A fetch that answers DataHub paths from a router and records calls. */
export function routedFetch(route: (url: URL) => { status: number; body?: unknown }): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({ url: url.href, apikey: headers.get("apikey") });
    const { status, body } = route(url);
    const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(status === 204 ? null : text, { status, headers: { "content-type": "application/json" } }));
  };
  return { fetch: fake as typeof fetch, calls };
}
