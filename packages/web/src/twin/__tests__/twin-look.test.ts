import { describe, expect, it } from "vitest";
import { decodeTwinLook, encodeTwinLook } from "../twin-look.js";

// -----------------------------------------------------------------------------
// twin-look — the exact-view deep link codec (SS++ "the irresistible link").
// The contract that matters: encode→decode round-trips within rounding, and
// ANY malformed input decodes to null so a tampered link can never break the
// opening — the twin just opens normally.
// -----------------------------------------------------------------------------

describe("encodeTwinLook / decodeTwinLook", () => {
  it("round-trips a view within rounding (0.1° angles, 0.5° fov)", () => {
    const encoded = encodeTwinLook({
      nodeId: "scan_045",
      yawDeg: 12.34,
      pitchDeg: -4.56,
      fovDeg: 68.4,
    });
    expect(encoded).toBe("scan_045,12.3,-4.6,68.5");
    const decoded = decodeTwinLook(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.nodeId).toBe("scan_045");
    expect(decoded?.yawDeg).toBeCloseTo(12.3, 5);
    expect(decoded?.pitchDeg).toBeCloseTo(-4.6, 5);
    expect(decoded?.fovDeg).toBeCloseTo(68.5, 5);
  });

  it("clamps a hand-edited pitch and fov into the walk's real ranges", () => {
    const decoded = decodeTwinLook("scan_000,0,-2000,500");
    expect(decoded?.pitchDeg).toBe(-85);
    expect(decoded?.fovDeg).toBe(95);
    expect(decodeTwinLook("scan_000,0,89,10")?.pitchDeg).toBe(85);
    expect(decodeTwinLook("scan_000,0,0,10")?.fovDeg).toBe(30);
  });

  it("rejects malformed input with null, never a throw", () => {
    for (const raw of [
      null,
      "",
      "scan_045",
      "scan_045,1,2",
      "scan_045,1,2,3,4",
      "scan_045,abc,2,3",
      "scan_045,NaN,2,3",
      "scan_045,Infinity,2,3",
      "../etc,1,2,3",
      "a".repeat(200),
    ]) {
      expect(decodeTwinLook(raw)).toBeNull();
    }
  });
});
