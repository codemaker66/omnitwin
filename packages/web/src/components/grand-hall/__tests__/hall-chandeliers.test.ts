import { describe, expect, it } from "vitest";
import { buildChandeliers } from "../hall-chandeliers.js";
import { HALL_CHANDELIERS } from "../hall-spec.js";

const set = buildChandeliers();

describe("the hall's chandeliers", () => {
  it("draws each fitting down to its surveyed lowest point and out to its surveyed reach", () => {
    for (const chandelier of HALL_CHANDELIERS) {
      const [cx, , cz] = chandelier.position;
      let bottom = Infinity;
      let reach = 0;
      for (const key of ["gilt", "bulb"] as const) {
        const position = set.geometries.get(key)?.getAttribute("position");
        expect(position).toBeDefined();
        if (position === undefined) continue;
        for (let i = 0; i < position.count; i++) {
          const distance = Math.hypot(position.getX(i) - cx, position.getZ(i) - cz);
          if (distance > 1.5) continue;
          bottom = Math.min(bottom, position.getY(i));
          reach = Math.max(reach, distance);
        }
      }
      expect(bottom).toBeCloseTo(chandelier.bottom, 2);
      expect(Math.abs(reach - chandelier.radius)).toBeLessThan(0.04);
    }
  });

  it("hangs 74 bulbs under the dome and 35 on each rose, every one inside its fitting", () => {
    const counts = HALL_CHANDELIERS.map(() => 0);
    for (const bulb of set.bulbs) {
      const distances = HALL_CHANDELIERS.map(({ position }) => Math.hypot(bulb[0] - position[0], bulb[2] - position[2]));
      const nearest = distances.indexOf(Math.min(...distances));
      const chandelier = HALL_CHANDELIERS[nearest];
      expect(chandelier).toBeDefined();
      if (chandelier === undefined) continue;
      counts[nearest] = (counts[nearest] ?? 0) + 1;
      expect(distances[nearest]).toBeLessThan(chandelier.radius + 0.005);
      expect(bulb[1]).toBeGreaterThan(chandelier.bottom);
      expect(bulb[1]).toBeLessThan(chandelier.suspension);
    }
    expect(counts).toEqual([74, 35, 35, 35, 35]);
  });

  it("winds every triangle to face along its normals, with none degenerate", () => {
    // The metal is drawn single-sided: a triangle wound against its normals
    // would vanish when seen from outside.
    for (const [part, geometry] of set.geometries) {
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const index = geometry.index;
      expect(index, part).not.toBeNull();
      if (index === null) continue;
      let against = 0;
      let degenerate = 0;
      for (let t = 0; t < index.count; t += 3) {
        const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        const u = [position.getX(b) - position.getX(a), position.getY(b) - position.getY(a), position.getZ(b) - position.getZ(a)] as const;
        const v = [position.getX(c) - position.getX(a), position.getY(c) - position.getY(a), position.getZ(c) - position.getZ(a)] as const;
        const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
        if (Math.hypot(...face) < 1e-12) {
          degenerate++;
          continue;
        }
        const shading = [0, 1, 2].map((axis) => normal.getComponent(a, axis) + normal.getComponent(b, axis) + normal.getComponent(c, axis));
        if (face[0] * (shading[0] ?? 0) + face[1] * (shading[1] ?? 0) + face[2] * (shading[2] ?? 0) <= 0) against++;
      }
      expect({ part, against, degenerate }).toEqual({ part, against: 0, degenerate: 0 });
    }
  });

  it("stays within its triangle budget", () => {
    expect(set.triangles).toBeLessThan(135_000);
  });
});
