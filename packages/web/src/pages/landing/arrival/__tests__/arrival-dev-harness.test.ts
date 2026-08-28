import { describe, expect, it } from "vitest";
import {
  ARRIVAL_HARNESS_PARAM,
  ARRIVAL_HARNESS_TILES_PARAM,
  ARRIVAL_HARNESS_TILES_TOKEN,
  arrivalHarnessPhase,
  arrivalHarnessTilesToken,
} from "../arrival-dev-harness.js";
import { type ArrivalPhase } from "../arrival-store.js";

// ---------------------------------------------------------------------------
// The DEV-only phase seam (arrival-dev-harness.ts). It exists so a real
// browser can be driven into "flight" and "arrived" without a paid Google Map
// Tiles key — see e2e/arrival-hero-controls.spec.ts, which uses it to prove
// the hero's two accessibility controls are not painted under .fr-hero-panel.
//
// Vitest runs with import.meta.env.DEV === true, so these cases exercise the
// live branch. The production branch is a build-time constant fold and cannot
// be observed from here.
// ---------------------------------------------------------------------------

const url = (value: string): string => `?${ARRIVAL_HARNESS_PARAM}=${value}`;

describe("arrivalHarnessPhase", () => {
  it("returns null for a search string that does not mention it", () => {
    expect(arrivalHarnessPhase("")).toBeNull();
    expect(arrivalHarnessPhase("?utm_source=x")).toBeNull();
  });

  it("accepts every real ArrivalPhase", () => {
    const phases: readonly ArrivalPhase[] = [
      "loading",
      "flight",
      "arrived",
      "exploded",
      "fallback",
    ];
    for (const phase of phases) {
      expect(arrivalHarnessPhase(url(phase))).toBe(phase);
    }
  });

  it("rejects a value that is not a phase", () => {
    expect(arrivalHarnessPhase(url("landed"))).toBeNull();
    expect(arrivalHarnessPhase(url(""))).toBeNull();
  });

  // `value in HARNESS_PHASES` would have accepted every Object.prototype
  // member, handing back "toString" as if it were a phase and writing it
  // straight into the store. Object.hasOwn is what makes this safe.
  it("rejects inherited Object.prototype names", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(arrivalHarnessPhase(url(name))).toBeNull();
    }
  });

  it("reads the first occurrence when the parameter is repeated", () => {
    expect(
      arrivalHarnessPhase(`?${ARRIVAL_HARNESS_PARAM}=flight&${ARRIVAL_HARNESS_PARAM}=arrived`),
    ).toBe("flight");
  });
});

// ---------------------------------------------------------------------------
// The DEV-only TILES seam. It exists so Google's two required attributions can
// be asserted in a real browser with no paid key and at any device tier — see
// e2e/arrival.spec.ts's THE ATTRIBUTION FIXTURE. Its safety properties are
// what these cases pin: it yields a CONSTANT (never the query value), and it
// yields nothing at all unless the page asked for it by the exact spelling.
// ---------------------------------------------------------------------------

const tilesUrl = (value: string): string => `?${ARRIVAL_HARNESS_TILES_PARAM}=${value}`;

describe("arrivalHarnessTilesToken", () => {
  it("returns null for a search string that does not mention it", () => {
    expect(arrivalHarnessTilesToken("")).toBeNull();
    expect(arrivalHarnessTilesToken("?utm_source=x")).toBeNull();
    expect(arrivalHarnessTilesToken(`?${ARRIVAL_HARNESS_PARAM}=flight`)).toBeNull();
  });

  it("returns the synthetic token for the one accepted value", () => {
    expect(arrivalHarnessTilesToken(tilesUrl("stub"))).toBe(ARRIVAL_HARNESS_TILES_TOKEN);
  });

  // The whole point of the constant. A seam that echoed the query value back
  // would be a way to put a real, billable Google credential into a link; this
  // one can only ever produce a string Google rejects, so the value in the URL
  // must be ignored even when it looks exactly like a key.
  it("never hands back a token supplied in the URL", () => {
    const token = arrivalHarnessTilesToken(tilesUrl("AIzaSyLOOKS-LIKE-A-REAL-KEY"));
    expect(token).toBeNull();
    expect(ARRIVAL_HARNESS_TILES_TOKEN).not.toContain("AIza");
  });

  it("rejects near-misses rather than accepting them loosely", () => {
    for (const value of ["", "STUB", "stubbed", "true", "1", "on"]) {
      expect(arrivalHarnessTilesToken(tilesUrl(value))).toBeNull();
    }
  });

  it("reads the first occurrence when the parameter is repeated", () => {
    expect(
      arrivalHarnessTilesToken(
        `?${ARRIVAL_HARNESS_TILES_PARAM}=nope&${ARRIVAL_HARNESS_TILES_PARAM}=stub`,
      ),
    ).toBeNull();
  });

  it("composes with the phase seam, which is how the E2E uses it", () => {
    const search = `?${ARRIVAL_HARNESS_PARAM}=flight&${ARRIVAL_HARNESS_TILES_PARAM}=stub`;
    expect(arrivalHarnessPhase(search)).toBe("flight");
    expect(arrivalHarnessTilesToken(search)).toBe(ARRIVAL_HARNESS_TILES_TOKEN);
  });
});
