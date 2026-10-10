import { describe, expect, it } from "vitest";
import { CoverageCollectionSchema, describeStructure, unitSymbol } from "../services/sky/bpf-schemas.js";
import {
  axisNumber,
  locateStep,
  medianSelector,
  readSeries,
  thresholdSelector,
  valueAt,
} from "../services/sky/coverage-series.js";
import {
  BPF_V2_BASE_URL,
  DailyCallBudget,
  MetOfficeBpfClient,
  UpstreamError,
  fetchForecastSnapshot,
  latestInstance,
  listedCollection,
} from "../services/sky/met-office-bpf.js";
import { weatherCodeEntry } from "../services/sky/weather-codes.js";
import {
  V2_COLLECTION_IDS,
  collectionsBody,
  coverageCollectionBody,
  forecastTimes,
  instancesBody,
  percentilesBody,
  probabilitiesBody,
  routedFetch,
} from "./fixtures/met-office-bpf-v2.js";

// ---------------------------------------------------------------------------
// The Met Office BPF v2 client and the CoverageJSON reader (T-647). Bodies
// come from fixtures/met-office-bpf-v2.ts: documented structure, synthetic
// numbers, never a real response.
// ---------------------------------------------------------------------------

const KEY = "test-key-not-a-real-key";
const ISSUED = Date.parse("2026-10-08T09:00:00Z");
const POINT = { latitude: 55.8593, longitude: -4.2491 };
const NOW = (): number => ISSUED + 30 * 60_000;

function client(fetchImpl: typeof fetch, cap = 40): MetOfficeBpfClient {
  return new MetOfficeBpfClient({ apiKey: KEY, fetchImpl, budget: new DailyCallBudget(cap), now: NOW });
}

async function failure(promise: Promise<unknown>): Promise<UpstreamError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error("expected an UpstreamError");
}

describe("MetOfficeBpfClient requests", () => {
  it("sends the key in the apikey header and asks for the venue point and the median", async () => {
    const times = forecastTimes(ISSUED, 3, 0);
    const { fetch, calls } = routedFetch(() => ({ status: 200, body: percentilesBody(times) }));
    await client(fetch).position("uk-spot-percentiles", "2026-10-08T09:00:00Z", POINT, ["cloudAreaFraction", "airTemperature1p5m"], "50");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.apikey).toBe(KEY);
    const url = new URL(call?.url ?? "");
    expect(url.href.startsWith(`${BPF_V2_BASE_URL}/collections/uk-spot-percentiles/instances/`)).toBe(true);
    expect(url.pathname.endsWith("/position")).toBe(true);
    expect(url.searchParams.get("coords")).toBe("POINT(-4.2491 55.8593)");
    expect(url.searchParams.get("parameter-name")).toBe("cloudAreaFraction,airTemperature1p5m");
    expect(url.searchParams.get("percentiles")).toBe("50");
    // The key never travels in the URL.
    expect(url.href).not.toContain(KEY);
  });

  it.each([
    [401, "key_rejected"],
    [403, "key_rejected"],
    [429, "quota_exhausted"],
    [204, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const { fetch } = routedFetch(() => ({ status, body: { message: "upstream says no" } }));
    const error = await failure(client(fetch).collections());
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain(KEY);
  });

  it("maps a network failure to unavailable without the key", async () => {
    const fetchImpl = ((): Promise<Response> => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const error = await failure(client(fetchImpl).collections());
    expect(error.kind).toBe("unavailable");
    expect(JSON.stringify(error.detail)).not.toContain(KEY);
  });

  it("stops at the daily budget before calling the Met Office", async () => {
    const { fetch, calls } = routedFetch(() => ({ status: 200, body: { collections: [] } }));
    const bpf = client(fetch, 1);
    await bpf.collections();
    const error = await failure(bpf.collections());
    expect(error.kind).toBe("quota_exhausted");
    expect(error.status).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("Zod rejection of malformed upstream data", () => {
  const times = forecastTimes(ISSUED, 2, 0);

  it.each([
    ["not JSON", "<html>gateway</html>"],
    ["a Coverage instead of a collection", { type: "Coverage", domain: { axes: {} }, ranges: {} }],
    ["no coverages", { type: "CoverageCollection", parameters: {}, coverages: [] }],
    ["values that do not fill the shape", {
      type: "CoverageCollection",
      parameters: {},
      coverages: [{
        type: "Coverage",
        domain: { axes: { t: { values: ["2026-10-08T09:00:00Z"] } } },
        ranges: { cloudAreaFraction: { type: "NdArray", axisNames: ["t"], shape: [2], values: [0.5] } },
      }],
    }],
    ["a string value", {
      type: "CoverageCollection",
      parameters: {},
      coverages: [{
        type: "Coverage",
        domain: { axes: { t: { values: ["2026-10-08T09:00:00Z"] } } },
        ranges: { cloudAreaFraction: { type: "NdArray", axisNames: ["t"], shape: [1], values: ["0.5"] } },
      }],
    }],
  ])("rejects %s", async (_label, body) => {
    const { fetch } = routedFetch(() => ({ status: 200, body }));
    const error = await failure(client(fetch).position("uk-spot-percentiles", "i", POINT, ["cloudAreaFraction"], "50"));
    expect(error.kind).toBe("unavailable");
    expect(error.detail.length).toBeGreaterThan(0);
  });

  it("rejects malformed collection and instance lists", async () => {
    const collections = routedFetch(() => ({ status: 200, body: { collections: [{ title: "no id" }] } }));
    expect((await failure(client(collections.fetch).collections())).kind).toBe("unavailable");
    const instances = routedFetch(() => ({ status: 200, body: { instances: "latest" } }));
    expect((await failure(client(instances.fetch).instances("uk-spot-percentiles"))).kind).toBe("unavailable");
  });

  it("accepts the documented collection body, with parameters on each coverage or on the collection", () => {
    expect(CoverageCollectionSchema.safeParse(percentilesBody(times)).success).toBe(true);
    expect(CoverageCollectionSchema.safeParse(probabilitiesBody(times)).success).toBe(true);
    expect(CoverageCollectionSchema.safeParse(percentilesBody(times, {}, "collection")).success).toBe(true);
    expect(CoverageCollectionSchema.safeParse(probabilitiesBody(times, 0.2, 0.05, "collection")).success).toBe(true);
  });
});

describe("CoverageJSON parameters in scope (OGC 21-069r2, 9.6.4 and 9.6.5)", () => {
  const times = forecastTimes(ISSUED, 2, 0);
  const temperature = { airTemperature1p5m: { unit: "K", values: [284.15, 285.15] } };

  function body(collectionUnit: string | null, coverageUnit: string | null): unknown {
    const unit = (symbol: string | null): unknown => (symbol === null ? {} : { airTemperature1p5m: { type: "Parameter", unit: { symbol } } });
    return {
      type: "CoverageCollection",
      ...(collectionUnit === null ? {} : { parameters: unit(collectionUnit) }),
      coverages: [{
        type: "Coverage",
        domain: { type: "Domain", axes: { t: { values: ["2026-10-08T09:00:00Z"] } } },
        ...(coverageUnit === null ? {} : { parameters: unit(coverageUnit) }),
        ranges: { airTemperature1p5m: { type: "NdArray", axisNames: ["t"], shape: [1], values: [284.15] } },
      }],
    };
  }

  it("reads a unit from the coverage's own parameters, as the live service sends them", () => {
    expect(unitSymbol(CoverageCollectionSchema.parse(coverageCollectionBody(times, temperature)), "airTemperature1p5m")).toBe("K");
    expect(unitSymbol(CoverageCollectionSchema.parse(body(null, "K")), "airTemperature1p5m")).toBe("K");
  });

  it("reads a unit from the collection's parameters when the coverage has none", () => {
    expect(unitSymbol(CoverageCollectionSchema.parse(coverageCollectionBody(times, temperature, "collection")), "airTemperature1p5m")).toBe("K");
    expect(unitSymbol(CoverageCollectionSchema.parse(body("K", null)), "airTemperature1p5m")).toBe("K");
  });

  it("takes the coverage's parameters as the scope when both levels have them", () => {
    expect(unitSymbol(CoverageCollectionSchema.parse(body("degF", "K")), "airTemperature1p5m")).toBe("K");
  });

  it("states no unit when none is in scope, so the documented unit applies", () => {
    expect(unitSymbol(CoverageCollectionSchema.parse(body(null, null)), "airTemperature1p5m")).toBeNull();
    expect(unitSymbol(CoverageCollectionSchema.parse(body(null, "K")), "cloudAreaFraction")).toBeNull();
  });
});

describe("a body that fails its schema is described, not dumped", () => {
  it("logs the structure of an unparseable position body, without its values or links", async () => {
    const geoJson = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "00000046",
        geometry: { type: "Point", coordinates: [-4.25, 55.86, 12] },
        properties: { airTemperature1p5m: 284.15, note: "value-that-must-not-be-logged" },
      }],
      links: [{ href: "https://example.invalid/collections?apikey=never-in-a-log", rel: "self" }],
    };
    const { fetch } = routedFetch(() => ({ status: 200, body: geoJson }));
    const error = await failure(client(fetch).position("uk-spot-percentiles", "blended", POINT, ["airTemperature1p5m"], "50"));
    expect(error.kind).toBe("unavailable");
    expect(error.detail).toEqual(expect.arrayContaining([
      "body: (root) keys: features, links, type",
      "body: type = FeatureCollection",
      "body: features: array(1)",
      "body: features[0] keys: geometry, id, properties, type",
      "body: features[0].type = Feature",
      "body: features[0].properties keys: airTemperature1p5m, note",
    ]));
    const logged = JSON.stringify(error.detail);
    for (const secret of ["value-that-must-not-be-logged", "never-in-a-log", "example.invalid", "284.15", "55.86", "00000046"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("describes a CoverageCollection's coverages, parameters and ranges by name", () => {
    expect(describeStructure(coverageCollectionBody(forecastTimes(ISSUED, 2, 0), { airTemperature1p5m: { unit: "K", values: [284.15, 285.15] } })))
      .toEqual(expect.arrayContaining([
        "(root) keys: coverages, domainType, referencing, type",
        "type = CoverageCollection",
        "domainType = PointSeries",
        "coverages: array(1)",
        "coverages[0] keys: domain, parameters, ranges, type",
        "coverages[0].parameters keys: airTemperature1p5m",
        "coverages[0].ranges keys: airTemperature1p5m",
      ]));
  });

  it("stays bounded for a large or deep body", () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${String(i)}`, { [`n${String(i)}`]: [i] }]));
    let deep: unknown = { leaf: "x" };
    for (let i = 0; i < 50; i += 1) deep = { next: deep };
    for (const lines of [describeStructure(wide), describeStructure(deep), describeStructure({ type: "\u0007".repeat(500) })]) {
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(lines.every((line) => line.length <= 200 && !/[^ -~]/u.test(line))).toBe(true);
    }
    expect(describeStructure(wide)[0]).toMatch(/and 40 more$/u);
    expect(describeStructure("text")).toEqual(["(root): string"]);
  });
});

describe("latestInstance", () => {
  it("chooses the newest run by its date-time id and states it as issuedAt", () => {
    const body = { instances: [{ id: "2026-10-08T07:00:00Z" }, { id: "2026-10-08T09:00:00Z" }, { id: "2026-10-08T08:00:00Z" }] };
    expect(latestInstance(body)).toEqual({ id: "2026-10-08T09:00:00Z", issuedAt: "2026-10-08T09:00:00.000Z" });
  });

  it("orders by temporal extent when ids are not dates, and then states no issue time", () => {
    const body = {
      instances: [
        { id: "run-a", extent: { temporal: { interval: [["2026-10-08T07:00:00Z", null] as [string, null]] } } },
        { id: "run-b", extent: { temporal: { interval: [["2026-10-08T08:00:00Z", null] as [string, null]] } } },
      ],
    };
    expect(latestInstance(body)).toEqual({ id: "run-b", issuedAt: null });
  });

  it("uses a lone undated instance and refuses to guess among several", () => {
    expect(latestInstance({ instances: [{ id: "latest" }] })).toEqual({ id: "latest", issuedAt: null });
    expect(latestInstance({ instances: [{ id: "a" }, { id: "b" }] })).toBeNull();
    expect(latestInstance({ instances: [] })).toBeNull();
  });
});

describe("the collections listing", () => {
  it("reads each collection's id, title and declared EDR parameter keys", async () => {
    const { fetch } = routedFetch(() => ({
      status: 200,
      body: collectionsBody(V2_COLLECTION_IDS, { "uk-spot-percentiles": ["airTemperature1p5m", "cloudAreaFraction"] }),
    }));
    const listed = await client(fetch).collections();
    expect(listed.map((collection) => collection.id)).toEqual([...V2_COLLECTION_IDS]);
    expect(listed.find((collection) => collection.id === "uk-spot-percentiles"))
      .toEqual({ id: "uk-spot-percentiles", title: "uk-spot-percentiles", parameters: ["airTemperature1p5m", "cloudAreaFraction"] });
    expect(listed.find((collection) => collection.id === "uk-spot-probabilities")?.parameters).toBeNull();
  });

  it("ignores a title or parameter_names of another shape instead of failing the list", () => {
    expect(listedCollection({ id: "a", title: 42, parameter_names: ["airTemperature1p5m"] }))
      .toEqual({ id: "a", title: null, parameters: null });
    expect(listedCollection({ id: "b", title: "  ", parameter_names: {} })).toEqual({ id: "b", title: null, parameters: null });
    expect(listedCollection({ id: "c" })).toEqual({ id: "c", title: null, parameters: null });
  });
});

describe("readSeries", () => {
  const times = forecastTimes(ISSUED, 3, 2);
  const collection = CoverageCollectionSchema.parse(percentilesBody(times, {
    cloudAreaFraction: {
      unit: "1",
      values: [0.1, 0.2, 0.3, 0.4, 0.5],
      extraAxis: { name: "percentile", values: [10, 25, 50, 75, 90], at: 2 },
    },
  }));

  it("takes the 50th percentile out of several, in row-major order", () => {
    const read = readSeries(collection, "cloudAreaFraction", medianSelector);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.series.values).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(read.series.times).toEqual(times);
    expect(read.series.bounds).toBeNull();
  });

  it("reads a categorical parameter with no percentile axis and keeps its bounds", () => {
    const read = readSeries(collection, "weatherCodePt01h", medianSelector);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.series.bounds?.[0]).toEqual([ISSUED - 3_600_000, ISSUED]);
  });

  it("reports an absent parameter and refuses an axis it cannot choose from", () => {
    expect(readSeries(collection, "cloudBaseHeight", medianSelector).status).toBe("absent");
    const noMedian = CoverageCollectionSchema.parse(percentilesBody(times, {
      cloudAreaFraction: { unit: "1", values: [0.1, 0.2, 0.3, 0.4, 0.5], extraAxis: { name: "percentile", values: [10, 90], at: 0 } },
    }));
    expect(readSeries(noMedian, "cloudAreaFraction", medianSelector)).toMatchObject({ status: "invalid" });
  });

  it("refuses times that are not ascending date-times", () => {
    const body = coverageCollectionBody([ISSUED + 3_600_000, ISSUED], { cloudAreaFraction: { unit: "1", values: [0.1, 0.2] } });
    expect(readSeries(CoverageCollectionSchema.parse(body), "cloudAreaFraction", medianSelector)).toMatchObject({ status: "invalid" });
  });

  it("selects a probability threshold by value", () => {
    const probabilities = CoverageCollectionSchema.parse(probabilitiesBody(times, 0.3, 0.07));
    const precipitation = readSeries(probabilities, "probabilityOfLwePrecipitationRateAboveThreshold", thresholdSelector(0.1 / 3_600_000));
    const fog = readSeries(probabilities, "probabilityOfVisibilityInAirBelowThreshold1p5m", thresholdSelector(1000));
    expect(precipitation.status === "ok" && precipitation.series.values[0]).toBe(0.3);
    expect(fog.status === "ok" && fog.series.values[0]).toBe(0.07);
    expect(readSeries(probabilities, "probabilityOfVisibilityInAirBelowThreshold1p5m", thresholdSelector(800)).status).toBe("invalid");
  });

  it("parses threshold labels", () => {
    expect(axisNumber(">=2.778e-08")).toBeCloseTo(2.778e-8, 15);
    expect(axisNumber("<1000.0")).toBe(1000);
    expect(axisNumber(50)).toBe(50);
    expect(axisNumber("fifty")).toBeNull();
  });

  it("reports the label and index it chose on each extra axis", () => {
    const fog = readSeries(CoverageCollectionSchema.parse(probabilitiesBody(times)), "probabilityOfVisibilityInAirBelowThreshold1p5m", thresholdSelector(1000));
    expect(fog.status === "ok" && fog.axes).toEqual([
      { name: "probabilityOfVisibilityInAirBelowThreshold1p5mValues", values: ["<200.0", "<1000.0", "<5000.0"], chosen: 1 },
    ]);
  });

  it("reads a threshold-major range at the chosen threshold for every time", () => {
    // axisNames [threshold, t]: every time of the first threshold, then the next.
    const body = {
      type: "CoverageCollection",
      coverages: [{
        type: "Coverage",
        domain: {
          type: "Domain",
          axes: {
            t: { values: times.slice(0, 3).map((ms) => new Date(ms).toISOString()) },
            visibilityThresholds: { values: ["<200.0", "<1000.0", "<5000.0"] },
          },
        },
        parameters: { probabilityOfVisibilityInAirBelowThreshold1p5m: { type: "Parameter", unit: { symbol: "1" } } },
        ranges: {
          probabilityOfVisibilityInAirBelowThreshold1p5m: {
            type: "NdArray",
            axisNames: ["visibilityThresholds", "t"],
            shape: [3, 3],
            values: [0.01, 0.02, 0.03, 0.11, 0.12, 0.13, 0.51, 0.52, 0.53],
          },
        },
      }],
    };
    const fog = readSeries(CoverageCollectionSchema.parse(body), "probabilityOfVisibilityInAirBelowThreshold1p5m", thresholdSelector(1000));
    expect(fog.status === "ok" && fog.series.values).toEqual([0.11, 0.12, 0.13]);
  });

  it("never takes the nearest threshold, or one in other units", () => {
    for (const labels of [["<500.0", "<2000.0"], ["<0.2", "<1.0", "<5.0"]]) {
      const body = coverageCollectionBody(times.slice(0, 2), {
        probabilityOfVisibilityInAirBelowThreshold1p5m: {
          unit: "1",
          values: [0.3, 0.3],
          extraAxis: { name: "probabilityOfVisibilityInAirBelowThreshold1p5mValues", values: labels, at: 1 },
        },
      });
      expect(readSeries(CoverageCollectionSchema.parse(body), "probabilityOfVisibilityInAirBelowThreshold1p5m", thresholdSelector(1000)))
        .toMatchObject({ status: "invalid" });
    }
  });
});

describe("locateStep and valueAt", () => {
  const times = forecastTimes(ISSUED, 3, 2); // 09, 10, 11, then 14, 17

  it("gives each step the span to the midpoints with its neighbours", () => {
    expect(locateStep(times, ISSUED + 10 * 60_000)).toEqual({ index: 0, validFrom: ISSUED - 30 * 60_000, validTo: ISSUED + 30 * 60_000 });
    const step = locateStep(times, ISSUED + 4 * 3_600_000);
    expect(step).toEqual({ index: 3, validFrom: ISSUED + 3.5 * 3_600_000, validTo: ISSUED + 6.5 * 3_600_000 });
  });

  it("is before the first step and after the last", () => {
    expect(locateStep(times, ISSUED - 31 * 60_000)).toBe("before");
    // The last step (17:00, three-hourly) stands until 18:30, inclusive.
    expect(locateStep(times, ISSUED + 9.5 * 3_600_000 + 1)).toBe("after");
    expect(locateStep(times, ISSUED + 9.5 * 3_600_000)).toMatchObject({ index: 4 });
  });

  it("reads a period parameter from the period that contains the instant", () => {
    const series = { times: [ISSUED, ISSUED + 3_600_000], bounds: [[ISSUED - 3_600_000, ISSUED], [ISSUED, ISSUED + 3_600_000]] as const, values: [1, 2] };
    expect(valueAt(series, ISSUED - 1)).toBe(1);
    expect(valueAt(series, ISSUED + 1)).toBe(2);
    expect(valueAt(series, ISSUED + 3_600_000)).toBeUndefined();
  });
});

describe("weather codes", () => {
  it("maps the published codes to precipitation types", () => {
    expect(weatherCodeEntry(11)).toEqual({ code: 11, description: "Drizzle", precipitation: "drizzle" });
    expect(weatherCodeEntry(18)?.precipitation).toBe("sleet");
    expect(weatherCodeEntry(21)?.precipitation).toBe("hail");
    expect(weatherCodeEntry(27)?.precipitation).toBe("snow");
    expect(weatherCodeEntry(6)).toEqual({ code: 6, description: "Fog", precipitation: "none" });
    expect(weatherCodeEntry(-1)?.precipitation).toBe("rain");
  });

  it("has no entry for the unused code, unknown codes or fractions", () => {
    expect(weatherCodeEntry(4)).toBeNull();
    expect(weatherCodeEntry(31)).toBeNull();
    expect(weatherCodeEntry(7.5)).toBeNull();
    expect(weatherCodeEntry(null)).toBeNull();
  });
});

describe("fetchForecastSnapshot", () => {
  const times = forecastTimes(ISSUED, 3, 2);
  const collections = { percentiles: "uk-spot-percentiles", probabilities: "uk-spot-probabilities" };

  function router(overrides: { percentiles?: unknown; probabilitiesStatus?: number } = {}) {
    return routedFetch((url) => {
      if (url.pathname.endsWith("/instances")) return { status: 200, body: instancesBody(["2026-10-08T08:00:00Z", "2026-10-08T09:00:00Z"]) };
      if (url.pathname.includes("uk-spot-percentiles")) return { status: 200, body: overrides.percentiles ?? percentilesBody(times) };
      return overrides.probabilitiesStatus === undefined
        ? { status: 200, body: probabilitiesBody(times) }
        : { status: overrides.probabilitiesStatus, body: {} };
    });
  }

  it("reads the newest run in contract units with four calls", async () => {
    const { fetch, calls } = router();
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(calls).toHaveLength(4);
    expect(calls.filter((call) => call.url.includes("/instances/2026-10-08T09%3A00%3A00Z/position"))).toHaveLength(2);
    expect(snapshot.issuedAt).toBe("2026-10-08T09:00:00.000Z");
    expect(snapshot.series.temperature?.values[0]).toBeCloseTo(11, 9);
    expect(snapshot.series.precipitationRate?.values[0]).toBe(0);
    expect(snapshot.series.precipitationProbability?.values[0]).toBe(0.2);
    expect(snapshot.series.fogProbability?.values[0]).toBe(0.05);
    expect(snapshot.site).toEqual({ latitude: 55.8611, longitude: -4.2502 });
    expect(snapshot.collection).toBe("uk-spot-percentiles");
    expect(snapshot.probabilityCollection).toBe("uk-spot-probabilities");
  });

  it("reads a body whose parameters sit on the collection as well as one with them on each coverage", async () => {
    const { fetch } = router({ percentiles: percentilesBody(times, {}, "collection") });
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(snapshot.series.temperature?.values[0]).toBeCloseTo(11, 9);
    expect(snapshot.series.wind?.values[0]).toBe(4.5);
    expect(snapshot.problems.filter((problem) => problem.includes("unit"))).toEqual([]);
  });

  it("reads each probability at its own time steps, which need not match the percentiles'", async () => {
    // Probabilities start an hour after the percentiles, with a different value at each step.
    const later = times.map((t) => t + 3_600_000);
    const { fetch } = routedFetch((url) => {
      if (url.pathname.endsWith("/instances")) return { status: 200, body: instancesBody(["2026-10-08T09:00:00Z"]) };
      if (url.pathname.includes("uk-spot-percentiles")) return { status: 200, body: percentilesBody(times) };
      return {
        status: 200,
        body: coverageCollectionBody(later, {
          probabilityOfVisibilityInAirBelowThreshold1p5m: {
            unit: "1",
            values: later.map((_, i) => i / 10),
            extraAxis: { name: "probabilityOfVisibilityInAirBelowThreshold1p5mValues", values: ["<200.0", "<1000.0", "<5000.0"], at: 1 },
          },
        }),
      };
    });
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    const fog = snapshot.series.fogProbability;
    if (fog === undefined) throw new Error("fog was not read");
    expect(fog.times).toEqual(later);
    expect(valueAt(fog, later[2] ?? 0)).toBe(0.2);
    expect(valueAt(fog, ISSUED + 2 * 3_600_000)).toBe(0.1);
  });

  it("describes what it read for each field, with no forecast values", async () => {
    const { fetch } = router();
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(snapshot.metadata.find((entry) => entry.field === "fogProbability")).toEqual({
      field: "fogProbability",
      key: "probabilityOfVisibilityInAirBelowThreshold1p5m",
      collection: "uk-spot-probabilities",
      unit: "1",
      unitDeclared: true,
      axes: [{ name: "probabilityOfVisibilityInAirBelowThreshold1p5mValues", values: ["<200.0", "<1000.0", "<5000.0"], chosen: 1 }],
      times: { count: 5, first: "2026-10-08T09:00:00.000Z", last: "2026-10-08T17:00:00.000Z", stepsMinutes: [60, 180] },
      periodsHours: null,
    });
    expect(snapshot.metadata.find((entry) => entry.field === "temperature")).toMatchObject({
      key: "airTemperature1p5m",
      collection: "uk-spot-percentiles",
      unit: "K",
      axes: [{ name: "percentile", values: [50], chosen: 0 }],
    });
    expect(snapshot.metadata.find((entry) => entry.field === "weatherCode1h")?.periodsHours).toEqual([1]);
    const logged = JSON.stringify(snapshot.metadata);
    for (const value of ["284.15", "15000", "0.05", "4.5"]) expect(logged).not.toContain(value);
  });

  it("reads the percentiles alone when no probability collection is offered", async () => {
    const { fetch, calls } = router();
    const snapshot = await fetchForecastSnapshot(client(fetch), { percentiles: "uk-spot-percentiles", probabilities: null }, POINT, NOW);
    expect(calls).toHaveLength(2);
    expect(snapshot.series.cloudTotal).toBeDefined();
    expect(snapshot.series.precipitationProbability).toBeUndefined();
    expect(snapshot.probabilityCollection).toBeNull();
    expect(snapshot.problems).toContain("probability collection not offered");
  });

  it("converts a precipitation rate from m/s to mm/h", async () => {
    const twoMmPerHour = 2 / 3_600_000;
    const { fetch } = router({
      percentiles: percentilesBody(times, {
        lwePrecipitationRate: { unit: "m s-1", values: times.map(() => twoMmPerHour), extraAxis: { name: "percentile", values: [50], at: 0 } },
      }),
    });
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(snapshot.series.precipitationRate?.values[0]).toBeCloseTo(2, 9);
  });

  it("drops a parameter in an unexpected unit instead of rescaling it", async () => {
    const { fetch } = router({
      percentiles: percentilesBody(times, {
        airTemperature1p5m: { unit: "degF", values: times.map(() => 52), extraAxis: { name: "percentile", values: [50], at: 0 } },
      }),
    });
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(snapshot.series.temperature).toBeUndefined();
    expect(snapshot.problems).toContain("airTemperature1p5m: unexpected unit degF");
  });

  it("keeps the median forecast when the probability half fails", async () => {
    const { fetch } = router({ probabilitiesStatus: 500 });
    const snapshot = await fetchForecastSnapshot(client(fetch), collections, POINT, NOW);
    expect(snapshot.series.cloudTotal).toBeDefined();
    expect(snapshot.series.fogProbability).toBeUndefined();
    expect(snapshot.probabilityCollection).toBeNull();
    expect(snapshot.problems.some((problem) => problem.startsWith("probabilities dropped"))).toBe(true);
  });

  it("fails when neither total cloud nor temperature can be read", async () => {
    const { fetch } = router({ percentiles: percentilesBody(times, { cloudAreaFraction: undefined, airTemperature1p5m: undefined }) });
    const error = await failure(fetchForecastSnapshot(client(fetch), collections, POINT, NOW));
    expect(error.kind).toBe("unavailable");
  });
});
