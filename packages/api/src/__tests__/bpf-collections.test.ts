import { describe, expect, it } from "vitest";
import {
  describeListing,
  offeredIds,
  selectCollections,
  type ListedCollection,
} from "../services/sky/bpf-collections.js";
import { WANTED_COLLECTION_PARAMETERS } from "../services/sky/met-office-bpf.js";

// ---------------------------------------------------------------------------
// Which Met Office BPF v2 collections the sky reads (T-647). The live v2
// listing offered neither of the v1 ids the first release looked for, so
// the choice is made from what each collection declares, never from one
// spelling. Listings here are synthetic.
// ---------------------------------------------------------------------------

function named(...ids: string[]): ListedCollection[] {
  return ids.map((id) => ({ id, title: null, parameters: null }));
}

function choose(listed: readonly ListedCollection[]): { percentiles: string | null; probabilities: string | null } {
  const selection = selectCollections(listed, WANTED_COLLECTION_PARAMETERS);
  return { percentiles: selection.percentiles?.id ?? null, probabilities: selection.probabilities?.id ?? null };
}

const PERCENTILE_KEYS = WANTED_COLLECTION_PARAMETERS.percentiles;
const PROBABILITY_KEYS = WANTED_COLLECTION_PARAMETERS.probabilities;

describe("selectCollections by name", () => {
  it("reads the v2 names, preferring the UK spot set", () => {
    const selection = selectCollections(
      named("global-spot-percentiles", "global-spot-probabilities", "uk-spot-percentiles", "uk-spot-probabilities"),
      WANTED_COLLECTION_PARAMETERS,
    );
    expect(selection.percentiles).toEqual({ id: "uk-spot-percentiles", region: "uk", basis: "name" });
    expect(selection.probabilities).toEqual({ id: "uk-spot-probabilities", region: "uk", basis: "name" });
  });

  it("still reads the v1 names and the glossary's mo- model ids", () => {
    expect(choose(named("improver-percentiles-spot-uk", "improver-probabilities-spot-uk")))
      .toEqual({ percentiles: "improver-percentiles-spot-uk", probabilities: "improver-probabilities-spot-uk" });
    expect(choose(named("mo-improver-percentiles-spot-global", "mo-improver-percentiles-spot-uk")))
      .toEqual({ percentiles: "mo-improver-percentiles-spot-uk", probabilities: null });
  });

  it("reads the sample files' naming, where the probability set is 'probabilistic'", () => {
    expect(choose(named("improver-uk-probabilistic", "improver-uk-percentiles")))
      .toEqual({ percentiles: "improver-uk-percentiles", probabilities: "improver-uk-probabilistic" });
  });

  it("falls back to the global spot set when no UK set is offered", () => {
    const selection = selectCollections(named("global-spot-probabilities", "global-spot-percentiles"), WANTED_COLLECTION_PARAMETERS);
    expect(selection.percentiles).toEqual({ id: "global-spot-percentiles", region: "global", basis: "name" });
    expect(selection.probabilities?.id).toBe("global-spot-probabilities");
  });

  it("takes probabilities from the region its percentiles come from", () => {
    expect(choose(named("global-spot-percentiles", "uk-spot-probabilities", "global-spot-probabilities")).probabilities)
      .toBe("global-spot-probabilities");
    expect(choose(named("uk-spot-percentiles", "global-spot-probabilities")).probabilities).toBe("global-spot-probabilities");
  });

  it("uses the title when the id says nothing, but not the product's own name", () => {
    expect(choose([
      { id: "c1", title: "UK spot percentiles", parameters: null },
      { id: "c2", title: "UK spot probabilities", parameters: null },
    ])).toEqual({ percentiles: "c1", probabilities: "c2" });
    // "Probabilistic" in a title is the product's name, not the collection's kind.
    expect(choose([{ id: "c3", title: "Site-Specific Blended Probabilistic Forecast", parameters: null }]))
      .toEqual({ percentiles: null, probabilities: null });
  });

  it("chooses nothing it cannot classify, and nothing ambiguous", () => {
    expect(choose(named("spot", "blended", "percentile-probabilities"))).toEqual({ percentiles: null, probabilities: null });
  });

  it("reports a probability set even when no percentile set is offered", () => {
    expect(choose(named("uk-spot-probabilities", "global-spot-probabilities")))
      .toEqual({ percentiles: null, probabilities: "uk-spot-probabilities" });
  });

  it("breaks a tie by id, so the choice is stable", () => {
    expect(choose(named("uk-spot-percentiles-b", "uk-spot-percentiles-a")).percentiles).toBe("uk-spot-percentiles-a");
  });
});

describe("selectCollections by declared parameters", () => {
  it("classifies opaque ids by the EDR parameter_names they declare", () => {
    const selection = selectCollections([
      { id: "bpf-1", title: null, parameters: [...PROBABILITY_KEYS, "probabilityOfWindSpeedAboveThreshold10m"] },
      { id: "bpf-2", title: null, parameters: [...PERCENTILE_KEYS, "relativeHumidity1p5m"] },
    ], WANTED_COLLECTION_PARAMETERS);
    expect(selection.percentiles).toEqual({ id: "bpf-2", region: null, basis: "parameters" });
    expect(selection.probabilities).toEqual({ id: "bpf-1", region: null, basis: "parameters" });
  });

  it("trusts declared parameters over a name", () => {
    expect(choose([
      { id: "uk-spot-percentiles", title: null, parameters: ["relativeHumidity1p5m", "ultravioletIndex"] },
      { id: "global-spot-percentiles", title: null, parameters: ["airTemperature1p5m", "cloudAreaFraction"] },
    ]).percentiles).toBe("global-spot-percentiles");
  });

  it("refuses a percentile set without total cloud or temperature, the forecast's backbone", () => {
    expect(choose([{ id: "uk-spot-percentiles", title: null, parameters: ["windSpeed10m", "visibilityInAir1p5m"] }]).percentiles)
      .toBeNull();
  });

  it("prefers a collection that declares the sky's parameters to one known only by name", () => {
    expect(choose([
      { id: "uk-spot-percentiles", title: null, parameters: null },
      { id: "uk-spot-percentiles-declared", title: null, parameters: ["airTemperature1p5m"] },
    ]).percentiles).toBe("uk-spot-percentiles-declared");
  });

  it("prefers the UK set to a global one that declares more", () => {
    expect(choose([
      { id: "uk-spot-percentiles", title: null, parameters: ["airTemperature1p5m", "cloudAreaFraction"] },
      { id: "global-spot-percentiles", title: null, parameters: PERCENTILE_KEYS },
    ]).percentiles).toBe("uk-spot-percentiles");
  });
});

describe("the listing as logged", () => {
  it("keeps each collection's id, title and parameter count, and nothing else", () => {
    expect(describeListing([
      { id: "uk-spot-percentiles", title: "UK spot percentiles", parameters: ["airTemperature1p5m"] },
      { id: "opaque", title: null, parameters: null },
    ])).toEqual([
      { id: "uk-spot-percentiles", title: "UK spot percentiles", parameters: 1 },
      { id: "opaque", title: null, parameters: null },
    ]);
  });

  it("bounds what an unexpected listing can put in the log", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${String(i)}-${"x".repeat(200)}`, title: "t\u0007\n".repeat(80), parameters: null }));
    const logged = describeListing(many);
    expect(logged).toHaveLength(25);
    expect(logged.every((entry) => entry.id.length <= 100 && (entry.title?.length ?? 0) <= 100)).toBe(true);
    expect(logged.some((entry) => /[^ -~]/u.test(`${entry.id}${entry.title ?? ""}`))).toBe(false);
    expect(offeredIds(many)).toMatch(/and 15 more$/u);
    expect(offeredIds([])).toBe("none");
    expect(offeredIds(named("uk-spot-probabilities", "global-spot-probabilities"))).toBe("uk-spot-probabilities, global-spot-probabilities");
  });
});
