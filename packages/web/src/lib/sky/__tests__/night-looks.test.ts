import { describe, expect, it } from "vitest";
import { STREET_NIGHT_LOOK, STREET_NIGHT_LOOKS, STREET_NIGHT_LOOK_NAMES, resolveStreetNightLook, type StreetNightLook } from "../night-looks.js";

const HEX = /^#[0-9a-f]{6}$/u;

/** Every number in a look, with its path, for range checks. */
function numbers(value: unknown, path: string, out: [string, number][] = []): [string, number][] {
  if (typeof value === "number") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => numbers(item, `${path}[${String(index)}]`, out));
  else if (typeof value === "object" && value !== null) for (const [key, item] of Object.entries(value)) numbers(item, `${path}.${key}`, out);
  return out;
}

describe("the street's night looks", () => {
  it.each(STREET_NIGHT_LOOK_NAMES)("%s holds only finite values in range", (name) => {
    const look: StreetNightLook = STREET_NIGHT_LOOKS[name];
    expect(look.name).toBe(name);
    for (const [path, value] of numbers(look, name)) {
      expect(Number.isFinite(value), path).toBe(true);
      expect(value, path).toBeGreaterThanOrEqual(0);
      // Lenses are the only light meant to pass the bloom's threshold; nothing else comes near 4.
      expect(value, path).toBeLessThanOrEqual(path.includes(".lens") ? 4 : 250);
    }
    for (const key of [look.sky12, look.sky18]) for (const hex of Object.values(key)) expect(hex).toMatch(HEX);
    const w = look.windows;
    for (const share of [w.share, w.nearShare, w.coolShare, w.magentaShare, w.cyanShare]) expect(share).toBeLessThanOrEqual(1);
    expect(w.nearShare).toBeLessThanOrEqual(w.share);
    const [left, right, bottom, top] = w.pane;
    expect(0 < left && left < right && right < 1 && 0 < bottom && bottom < top && top < 1).toBe(true);
    expect(look.hazeReach).toBeGreaterThan(50);
    expect(look.pool.radius).toBeGreaterThan(2);
    expect(look.pool.softness).toBeGreaterThan(0);
    expect(look.pool.softness).toBeLessThan(1);
    expect(look.beam.reach).toBeGreaterThan(0);
    expect(look.beam.reach).toBeLessThanOrEqual(1);
    const f = look.facades;
    for (const share of [f.officeShare, f.homeShare, f.curtainShare, f.curtain, f.spill]) expect(share).toBeLessThanOrEqual(1);
  });

  it("lights the surveyed openings across the street in every look with lamps, and none in the look before them", () => {
    for (const name of STREET_NIGHT_LOOK_NAMES) {
      const { facades, lamps } = STREET_NIGHT_LOOKS[name];
      const lights = [facades.office, facades.home, facades.pub, facades.bar, facades.glassGreen, facades.signTeal, facades.signViolet, facades.signGreen];
      if (!lamps) {
        expect([facades.officeShare, facades.homeShare, facades.spill], name).toEqual([0, 0, 0]);
        for (const rgb of lights) expect(rgb, name).toEqual([0, 0, 0]);
        continue;
      }
      expect(facades.officeShare, name).toBeGreaterThan(0);
      expect(facades.homeShare, name).toBeGreaterThan(0);
      // Below the bloom's threshold, as the city's windows are: lit glass, not lamps.
      for (const rgb of lights) expect(Math.max(...rgb), name).toBeLessThan(0.92);
      // A home's lamplight warm, the signs in the hues the panoramas show: teal, violet, green.
      expect(facades.home[0], name).toBeGreaterThan(facades.home[2]);
      expect(facades.signTeal[1] > facades.signTeal[0] && facades.signTeal[2] > facades.signTeal[0], name).toBe(true);
      expect(facades.signViolet[2] > facades.signViolet[0] && facades.signViolet[0] > facades.signViolet[1], name).toBe(true);
      expect(facades.signGreen[1] > facades.signGreen[0] && facades.signGreen[1] > facades.signGreen[2], name).toBe(true);
    }
  });

  it("keeps every lit lens above the bloom's threshold and every halo below it, warm", () => {
    for (const name of STREET_NIGHT_LOOK_NAMES) {
      const look = STREET_NIGHT_LOOKS[name];
      if (!look.lamps) continue;
      const [r, g, b] = look.lens;
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b, name).toBeGreaterThan(0.92);
      const [hr, hg, hb] = look.halo;
      expect(Math.max(hr, hg, hb), name).toBeLessThan(0.92);
      expect(hr, name).toBeGreaterThan(hg);
      expect(hg, name).toBeGreaterThan(hb);
    }
  });

  it("darkens the card at dusk, walls most, except in the look before the lamps", () => {
    for (const name of STREET_NIGHT_LOOK_NAMES) {
      const { wall, roof, air } = STREET_NIGHT_LOOKS[name].dusk;
      if (name === "off") {
        expect([wall, roof, air], name).toEqual([1, 1, 1]);
        continue;
      }
      for (const share of [wall, roof, air]) {
        expect(share, name).toBeGreaterThanOrEqual(0.25);
        expect(share, name).toBeLessThan(1);
      }
      expect(wall, name).toBeLessThanOrEqual(roof);
    }
  });

  it("shows Evocative unless a development build asks for another by name", () => {
    expect(STREET_NIGHT_LOOK).toBe("evocative");
    expect(resolveStreetNightLook("", true).name).toBe("evocative");
    expect(resolveStreetNightLook("?street=noir", true).name).toBe("noir");
    expect(resolveStreetNightLook("?sky=1&street=off", true).name).toBe("off");
    expect(resolveStreetNightLook("?street=noir", false).name).toBe("evocative");
    expect(resolveStreetNightLook("?street=neon", true).name).toBe("evocative");
    expect(resolveStreetNightLook("?street=NOIR", true).name).toBe("evocative");
  });
});
