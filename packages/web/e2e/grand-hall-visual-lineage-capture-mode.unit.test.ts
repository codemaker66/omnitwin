import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX,
  GRAND_HALL_DIFIX_CAPTURE_METHOD,
  GRAND_HALL_DIFIX_CAPTURE_MODE,
  deriveGrandHallLineageCaptureProfile,
  grandHallCaptureEvidenceLimitation,
  requireDifixCapturePaths,
} from "./grand-hall-visual-lineage-capture-mode.js";

describe("Grand Hall lineage capture-mode derivation", () => {
  it("preserves default viewport, frame profile, and replace publication semantics", () => {
    expect(deriveGrandHallLineageCaptureProfile(undefined, 137, 421)).toEqual({
      difixNoReference: false,
      viewport: { width: 1_600, height: 900 },
      warmupFrameCount: 137,
      frameSampleCount: 421,
      publication: "replace_by_rename",
    });
  });

  it("pins the explicit Difix mode and create-exclusive publication semantics", () => {
    expect(deriveGrandHallLineageCaptureProfile(
      GRAND_HALL_DIFIX_CAPTURE_MODE,
      137,
      421,
    )).toEqual({
      difixNoReference: true,
      viewport: { width: 1_024, height: 576 },
      warmupFrameCount: 8,
      frameSampleCount: 1,
      publication: "create_exclusive",
    });
  });

  it("rejects unknown modes and non-absolute Difix paths", () => {
    expect(() => deriveGrandHallLineageCaptureProfile("unknown", 120, 600)).toThrow();
    const profile = deriveGrandHallLineageCaptureProfile(
      GRAND_HALL_DIFIX_CAPTURE_MODE,
      120,
      600,
    );
    expect(() => {
      requireDifixCapturePaths(profile, "relative", "relative");
    })
      .toThrow(/absolute/u);
    expect(() => {
      requireDifixCapturePaths(
        profile,
        path.resolve("source"),
        path.resolve("evidence"),
      );
    })
      .not.toThrow();
  });

  it("serializes the exact observed capture values and actual Playwright method", () => {
    const marker = grandHallCaptureEvidenceLimitation({
      canvasWidth: 1_024,
      canvasHeight: 576,
      devicePixelRatio: 1,
      contextAntialias: false,
    });
    expect(marker.startsWith(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX)).toBe(true);
    expect(JSON.parse(marker.slice(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX.length)))
      .toEqual({
        method: GRAND_HALL_DIFIX_CAPTURE_METHOD,
        canvasWidth: 1_024,
        canvasHeight: 576,
        devicePixelRatio: 1,
        contextAntialias: false,
        resizeApplied: false,
      });
  });
});
