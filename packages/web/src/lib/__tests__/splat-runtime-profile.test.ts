import { describe, expect, it } from "vitest";
import {
  parseSplatOverrides,
  resolveSplatRuntimeProfile,
  SPLAT_RUNTIME_PROFILES,
  type SplatRuntimeProfile,
  settledPixelRatio,
} from "../splat-runtime-profile.js";
import type { DeviceTier } from "../device-tier.js";

const TIERS: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

function expectWellFormed(profile: SplatRuntimeProfile): void {
  expect(Number.isFinite(profile.minSortIntervalMs)).toBe(true);
  expect(profile.minSortIntervalMs).toBeGreaterThanOrEqual(0);
  expect(profile.maxStdDev).toBeGreaterThan(0);
  expect(profile.lodSplatCount).toBeGreaterThan(0);
  expect(Number.isInteger(profile.lodSplatCount)).toBe(true);
  expect(Number.isInteger(profile.motionLodSplatCount)).toBe(true);
  expect(profile.motionLodSplatCount).toBeGreaterThan(0);
  expect(profile.motionLodSplatCount).toBeLessThanOrEqual(profile.lodSplatCount);
  expect(Number.isInteger(profile.maxSh)).toBe(true);
  expect(profile.maxSh).toBeGreaterThanOrEqual(0);
  expect(profile.maxSh).toBeLessThanOrEqual(3);
  expect(typeof profile.preferTrees).toBe("boolean");
  expect(profile.motionDpr).toBeGreaterThan(0);
  expect(profile.settledDpr).toBeGreaterThanOrEqual(profile.motionDpr);
}

describe("parseSplatOverrides", () => {
  it("returns no overrides for an empty or unrelated query", () => {
    expect(parseSplatOverrides("")).toEqual({});
    expect(parseSplatOverrides("?room=grand-hall&foo=bar")).toEqual({});
    expect(parseSplatOverrides("?splat=")).toEqual({});
  });

  it("reads sort, std, dpr, rest and a lod budget from the splat parameter", () => {
    expect(parseSplatOverrides("?splat=sort:50,std:2.236,dpr:0.5,rest:1.5,lod:1500000")).toEqual({
      minSortIntervalMs: 50,
      maxStdDev: 2.236,
      motionDpr: 0.5,
      settledDpr: 1.5,
      lod: true,
      lodSplatCount: 1_500_000,
    });
  });

  it("reads the motion budget and the spherical-harmonic cap", () => {
    expect(parseSplatOverrides("?splat=motion:750000,sh:1")).toEqual({
      motionLodSplatCount: 750_000,
      maxSh: 1,
    });
  });

  it("clamps the harmonic cap to a whole degree between 0 and 3", () => {
    expect(parseSplatOverrides("?splat=sh:9")).toEqual({ maxSh: 3 });
    expect(parseSplatOverrides("?splat=sh:1.6")).toEqual({ maxSh: 2 });
    expect(parseSplatOverrides("?splat=sh:0")).toEqual({ maxSh: 0 });
    expect(parseSplatOverrides("?splat=sh:-1")).toEqual({});
  });

  it("reads the prebuilt-tree preference", () => {
    expect(parseSplatOverrides("?splat=trees:off")).toEqual({ preferTrees: false });
    expect(parseSplatOverrides("?splat=trees:on")).toEqual({ preferTrees: true });
    expect(parseSplatOverrides("?splat=trees:maybe")).toEqual({});
  });

  it("understands lod:on (tier budget) and lod:off", () => {
    expect(parseSplatOverrides("?splat=lod:on")).toEqual({ lod: true });
    expect(parseSplatOverrides("?splat=lod:off")).toEqual({ lod: false });
  });

  it("reads a tier override and rejects an unknown tier", () => {
    expect(parseSplatOverrides("?splat=tier:medium")).toEqual({ tier: "medium" });
    expect(parseSplatOverrides("?splat=tier:ultra")).toEqual({});
  });

  it("ignores unknown keys and malformed values, keeping the valid ones", () => {
    expect(parseSplatOverrides("?splat=sort:abc,foo:1,dpr:-1,std:0,lod:0,rest:nope,sort:40")).toEqual({
      minSortIntervalMs: 40,
    });
  });

  it("clamps every numeric override to its sane range", () => {
    const parsed = parseSplatOverrides("?splat=sort:99999,std:99,dpr:0.01,rest:99,lod:99999999999");
    expect(parsed.minSortIntervalMs).toBe(1000);
    expect(parsed.maxStdDev).toBe(4);
    expect(parsed.motionDpr).toBe(0.25);
    expect(parsed.settledDpr).toBe(3);
    expect(parsed.lodSplatCount).toBe(16_777_216);
  });

  it("tolerates a leading question mark being absent and other parameters around it", () => {
    expect(parseSplatOverrides("a=1&splat=sort:33&b=2")).toEqual({ minSortIntervalMs: 33 });
  });
});

describe("resolveSplatRuntimeProfile", () => {
  it("gives every tier a well-formed profile whose lod budget shrinks with the tier", () => {
    const budgets = TIERS.map((tier) => {
      const profile = resolveSplatRuntimeProfile(tier);
      expectWellFormed(profile);
      expect(profile.tier).toBe(tier);
      expect(profile.source).toBe("tier");
      return profile.lodSplatCount;
    });
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i]).toBeGreaterThan(budgets[i - 1] ?? 0);
    }
  });

  it("returns the tier table verbatim when there is nothing to override", () => {
    const profile = resolveSplatRuntimeProfile("high", "", true);
    expect(profile).toEqual({ ...SPLAT_RUNTIME_PROFILES.high, tier: "high", source: "tier" });
  });

  it("applies overrides only when they are allowed", () => {
    const denied = resolveSplatRuntimeProfile("high", "?splat=sort:50,lod:1000000", false);
    expect(denied.minSortIntervalMs).toBe(SPLAT_RUNTIME_PROFILES.high.minSortIntervalMs);
    expect(denied.source).toBe("tier");

    const allowed = resolveSplatRuntimeProfile("high", "?splat=sort:50,lod:1000000", true);
    expect(allowed.minSortIntervalMs).toBe(50);
    expect(allowed.lod).toBe(true);
    expect(allowed.lodSplatCount).toBe(1_000_000);
    expect(allowed.source).toBe("override");
    expectWellFormed(allowed);
  });

  it("lets an override re-tier the device and then applies the rest on top of that tier", () => {
    const profile = resolveSplatRuntimeProfile("high", "?splat=tier:low,sort:20", true);
    expect(profile.tier).toBe("low");
    expect(profile.lodSplatCount).toBe(SPLAT_RUNTIME_PROFILES.low.lodSplatCount);
    expect(profile.minSortIntervalMs).toBe(20);
  });

  it("never lets the motion budget exceed the resting budget", () => {
    const profile = resolveSplatRuntimeProfile("high", "?splat=lod:1000000,motion:2000000", true);
    expect(profile.lodSplatCount).toBe(1_000_000);
    expect(profile.motionLodSplatCount).toBe(1_000_000);
    expectWellFormed(profile);
  });

  it("keeps the settled ratio at or above the motion ratio whatever the overrides say", () => {
    const profile = resolveSplatRuntimeProfile("high", "?splat=dpr:2,rest:0.5", true);
    expect(profile.settledDpr).toBeGreaterThanOrEqual(profile.motionDpr);
    expectWellFormed(profile);
  });

  it("marks a query with only ignorable overrides as untouched", () => {
    const profile = resolveSplatRuntimeProfile("medium", "?splat=foo:1", true);
    expect(profile.source).toBe("tier");
  });
});

// ---------------------------------------------------------------------------
// Supersampling at rest.
//
// The settled ratio used to be capped by the display's own, so a 1x screen
// rested at 1 whatever the profile asked for. Measured on the Grand Hall
// (2026-09-04, dev server, 1600x900): rendering at 2 and letting a 1x display
// present it makes the name boards 100% sharper by Laplacian variance, the
// panelling 75% and the frieze 48%, at no cost to the frame rate under drag,
// because a demand loop draws the settled frame once and then sleeps.
// ---------------------------------------------------------------------------
describe("settledPixelRatio", () => {
  it("gives a 1x laptop the profile's ratio, which is the whole point of supersampling", () => {
    expect(settledPixelRatio(2, 1600, 900)).toBe(2);
  });

  it("never asks for more than the profile wants, however small the canvas", () => {
    expect(settledPixelRatio(1.5, 640, 360)).toBe(1.5);
    expect(settledPixelRatio(1, 640, 360)).toBe(1);
  });

  it("holds a 4K canvas to its own pixels rather than rendering four times them", () => {
    expect(settledPixelRatio(2, 3840, 2160)).toBeCloseTo(1, 2);
  });

  it("scales the ratio down as the canvas grows, so the buffer stays inside the budget", () => {
    const budgetPixels = 8_300_000;
    for (const [w, h] of [[1600, 900], [2560, 1440], [3440, 1440]] as const) {
      const ratio = settledPixelRatio(2, w, h);
      expect(w * h * ratio * ratio).toBeLessThanOrEqual(budgetPixels * 1.01);
    }
  });

  it("never drops below one, whatever nonsense the canvas reports", () => {
    expect(settledPixelRatio(2, 0, 0)).toBe(1);
    expect(settledPixelRatio(2, Number.NaN, 900)).toBe(1);
    expect(settledPixelRatio(0.2, 1600, 900)).toBe(1);
  });
});
