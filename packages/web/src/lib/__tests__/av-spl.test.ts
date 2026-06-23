import { describe, it, expect } from "vitest";
import {
  buildAvCoverage,
  coverageWidthM,
  splAtDistanceDb,
  splFalloffDb,
  speechSnrStatus,
} from "../av-spl.js";

describe("splFalloffDb", () => {
  it("drops ~6 dB per distance doubling", () => {
    expect(splFalloffDb(1, 2)).toBeCloseTo(6.02, 2);
    expect(splFalloffDb(1, 4)).toBeCloseTo(12.04, 2);
  });
});

describe("splAtDistanceDb", () => {
  it("subtracts the falloff from the 1 m rating", () => {
    expect(splAtDistanceDb(127, 1)).toBe(127);
    expect(splAtDistanceDb(127, 2)).toBeCloseTo(120.98, 2);
  });
});

describe("coverageWidthM", () => {
  it("is 2·d·tan(angle/2)", () => {
    expect(coverageWidthM(12, 90)).toBeCloseTo(24, 5); // tan45 = 1
    expect(coverageWidthM(10, 60)).toBeCloseTo(11.547, 3);
  });
});

describe("speechSnrStatus", () => {
  it("classifies against the target and ambient", () => {
    expect(speechSnrStatus(15, 10)).toBe("good");
    expect(speechSnrStatus(5, 10)).toBe("marginal");
    expect(speechSnrStatus(-3, 10)).toBe("poor");
  });
});

describe("buildAvCoverage", () => {
  it("computes SPL at the listener, coverage width and a good speech SNR", () => {
    const c = buildAvCoverage({ maxSplAt1mDb: 127, coverageAngleDeg: 90, listenerDistanceM: 12, ambientDb: 70 });
    expect(c.splAtListenerDb).toBeCloseTo(105.42, 1); // 127 − 20·log10(12)
    expect(c.coverageWidthM).toBeCloseTo(24, 5);
    expect(c.speechSnrDb).toBeCloseTo(35.42, 1);
    expect(c.targetSnrDb).toBe(10);
    expect(c.meetsTarget).toBe(true);
    expect(c.snrStatus).toBe("good");
  });

  it("flags poor intelligibility when ambient swamps the level", () => {
    const c = buildAvCoverage({ maxSplAt1mDb: 90, coverageAngleDeg: 90, listenerDistanceM: 16, ambientDb: 85 });
    expect(c.meetsTarget).toBe(false);
    expect(c.snrStatus).toBe("poor");
  });
});
