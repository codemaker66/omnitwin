import { describe, expect, it } from "vitest";
import { ARRIVAL_HARNESS_PARAM, arrivalHarnessPhase } from "../arrival-dev-harness.js";
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
