import { describe, expect, it } from "vitest";
import { CRANE_POSE, craneWeight } from "../crane.js";
import { RECEPTION_DOLLY_STATIONS } from "../reception-dolly-path.js";

// ---------------------------------------------------------------------------
// crane — the rising camera must engage only during the fill, hold while the
// floor completes, and hand back before the act ends. The pose is pinned to
// the empirically probed values: strictly above a walked station, below the
// ceiling-shell collapse height.
// ---------------------------------------------------------------------------

describe("craneWeight — the bell of the lift", () => {
  it("stays grounded through the intimate opener", () => {
    expect(craneWeight(0)).toBe(0);
    expect(craneWeight(0.2)).toBe(0);
    expect(craneWeight(0.35)).toBe(0);
  });

  it("is fully risen while the floor completes", () => {
    expect(craneWeight(0.7)).toBe(1);
    expect(craneWeight(0.8)).toBe(1);
    expect(craneWeight(0.9)).toBe(1);
  });

  it("hands back to the dolly by the act's end", () => {
    expect(craneWeight(1)).toBe(0);
    expect(craneWeight(1.2)).toBe(0);
  });

  it("rises and falls monotonically, bounded to [0, 1]", () => {
    let prev = 0;
    for (let p = 0.35; p <= 0.7001; p += 0.01) {
      const w = craneWeight(p);
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
    prev = 1;
    for (let p = 0.9; p <= 1.0001; p += 0.01) {
      const w = craneWeight(p);
      expect(w).toBeLessThanOrEqual(prev);
      expect(w).toBeGreaterThanOrEqual(0);
      prev = w;
    }
  });
});

describe("CRANE_POSE — empirically gated placement", () => {
  it("rises strictly vertically above the walked arrival station", () => {
    const arrival = RECEPTION_DOLLY_STATIONS[0];
    expect(arrival).toBeTruthy();
    expect(CRANE_POSE.position[0]).toBe(arrival?.position[0]);
    expect(CRANE_POSE.position[2]).toBe(arrival?.position[2]);
  });

  it("stays inside the probed clean band (+0.60 … +0.85 above capture height)", () => {
    expect(CRANE_POSE.position[1]).toBeGreaterThanOrEqual(0.6);
    expect(CRANE_POSE.position[1]).toBeLessThanOrEqual(0.85);
  });

  it("gazes down at the floor, not across the room", () => {
    expect(CRANE_POSE.look[1]).toBeLessThan(-1);
  });
});
