import { describe, expect, it } from "vitest";
import {
  HOP_FOV_BREATH_DEG,
  SHIMMER_FADE_MS,
  shimmerPhaseAfterTier,
  type TwinShimmerPhase,
} from "../TwinViewer.js";

// -----------------------------------------------------------------------------
// TwinViewer — pure polish-pass logic (2026-07-05).
//
// The R3F composition itself is exercised by the twin-walk e2e and the visual
// harness; here we pin the pure pieces: the initial-load shimmer's state
// machine (the shimmer belongs to the opening only — hops must never re-arm
// it) and the travel fov breath's contract (a mid-hop surge that vanishes at
// both endpoints, so the WalkControls handover carries zero residue).
// -----------------------------------------------------------------------------

describe("shimmerPhaseAfterTier", () => {
  it("keeps shimmering while the initial node is still at preview tier", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_000", "scan_000", "preview")).toBe(
      "loading",
    );
  });

  it("fades on the initial node's base-tier arrival", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_000", "scan_000", "base")).toBe(
      "fading",
    );
  });

  it("fades when any OTHER node reports — the visitor walked on", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_001", "scan_000", "preview")).toBe(
      "fading",
    );
    expect(shimmerPhaseAfterTier("loading", "scan_001", "scan_000", "base")).toBe(
      "fading",
    );
  });

  it("never re-arms once past loading — hops cannot bring the shimmer back", () => {
    const settled: TwinShimmerPhase[] = ["fading", "done"];
    for (const phase of settled) {
      expect(shimmerPhaseAfterTier(phase, "scan_000", "scan_000", "preview")).toBe(phase);
      expect(shimmerPhaseAfterTier(phase, "scan_000", "scan_000", "base")).toBe(phase);
      expect(shimmerPhaseAfterTier(phase, "scan_002", "scan_000", "base")).toBe(phase);
    }
  });
});

describe("travel fov breath", () => {
  it("is a subtle +4 degree surge", () => {
    expect(HOP_FOV_BREATH_DEG).toBe(4);
  });

  it("vanishes exactly at both hop endpoints (sin π·p)", () => {
    // The breath is base + sin(π·progress)·HOP_FOV_BREATH_DEG; the settle
    // handover to WalkControls relies on a zero contribution at p = 0 and 1.
    expect(Math.sin(Math.PI * 0) * HOP_FOV_BREATH_DEG).toBeCloseTo(0, 10);
    expect(Math.sin(Math.PI * 1) * HOP_FOV_BREATH_DEG).toBeCloseTo(0, 10);
    expect(Math.sin(Math.PI * 0.5) * HOP_FOV_BREATH_DEG).toBeCloseTo(4, 10);
  });
});

describe("shimmer fade window", () => {
  it("outlives the 400 ms CSS fade so the element never pops off mid-fade", () => {
    expect(SHIMMER_FADE_MS).toBeGreaterThanOrEqual(400);
  });
});
