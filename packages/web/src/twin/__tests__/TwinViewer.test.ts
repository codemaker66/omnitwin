import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import { DOLLHOUSE_DOT_RADIUS_M } from "../DollhouseStage.js";
import {
  HOP_FOV_BREATH_DEG,
  SHIMMER_FADE_MS,
  TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M,
  dollhouseCutawayInsetForVenue,
  lowerFloorSectionMinimumY,
  shimmerPhaseAfterTier,
  type TwinShimmerPhase,
} from "../TwinViewer.js";

describe("dollhouse cutaway venue gate", () => {
  it("enables the visually reviewed inset for Trades Hall only", () => {
    expect(dollhouseCutawayInsetForVenue("trades-hall")).toBe(
      TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M,
    );
    expect(TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M).toBe(4);
    expect(dollhouseCutawayInsetForVenue("another-venue")).toBeUndefined();
  });

  it("uses the lowest current-storey pose to suppress lower-floor slab scraps", () => {
    const node = (id: string, floor: number, z: number): TwinScanNode => ({
      id,
      index: Number(id.slice(-3)),
      pose: { q: [1, 0, 0, 0], t: [0, 0, z] },
      floor,
      roomSlug: null,
    });
    const scan080 = node("scan_080", 0, -0.21);
    const scan146 = node("scan_146", 0, -0.21);
    const nodes = [
      node("scan_000", -1, -2.1),
      node("scan_001", -1, -1.35),
      scan080,
      scan146,
      node("scan_028", 0, 1.72),
    ];

    const minimumY = lowerFloorSectionMinimumY(nodes, 0);
    expect(minimumY).toBeCloseTo(-0.39);
    for (const lowestCurrent of [scan080, scan146]) {
      expect(lowestCurrent.pose.t[2] - (minimumY ?? Number.NaN)).toBeGreaterThanOrEqual(
        DOLLHOUSE_DOT_RADIUS_M,
      );
    }
    expect(lowerFloorSectionMinimumY(nodes, -1)).toBeUndefined();
    expect(lowerFloorSectionMinimumY(nodes, 99)).toBeUndefined();
  });
});

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
