import { Box3, Mesh, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS, type CraftedFurnitureSlug } from "../../../components/meshes/crafted/crafted-slugs.js";
import { clearCraftedGeometryCache, createCraftedFurniture } from "../../../components/meshes/crafted/crafted-registry.js";
import { getCatalogueItemBySlug } from "../../catalogue.js";
import { SET_DOWN_BODIES, bodyFor } from "../bodies.js";

interface Spot {
  readonly x: number;
  readonly z: number;
}

/** The spots of shade a piece leaves on the floor: each a quad of four corners, centred on its foot. */
function contactSpotsOf(slug: CraftedFurnitureSlug): Spot[] {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`No catalogue item for ${slug}`);
  const model = createCraftedFurniture({ slug, width: item.width, depth: item.depth, height: item.height });
  const spots: Spot[] = [];
  try {
    model.object.traverse((object) => {
      if (!(object instanceof Mesh) || !object.name.endsWith(":contact")) return;
      object.updateWorldMatrix(true, false);
      const position = object.geometry.getAttribute("position");
      for (let corner = 0; corner + 3 < position.count; corner += 4) {
        const quad = [0, 1, 2, 3].map((k) => new Vector3().fromBufferAttribute(position, corner + k).applyMatrix4(object.matrixWorld));
        const box = new Box3().setFromPoints(quad);
        spots.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 });
      }
    });
  } finally {
    model.dispose();
  }
  return spots;
}

/**
 * Pieces whose crafted model draws no contact shade, and why. Their feet are
 * written from the factory's own geometry or the real piece, and the test
 * holds them to the catalogue footprint; a model that gains a shade leaves
 * this list and is matched spot for spot instead.
 */
const NO_CONTACT_SHADE: Readonly<Record<string, string>> = {
  "round-table-6ft-white": "floor-length cloth hides the folding frame, which is the bare round's",
  "cake-cutting-table": "floor-length cloth hides the folding frame, the bare round's at its radius",
  "trestle-4ft-white": "floor-length cloth hides the trestle legs",
  "trestle-4ft-black": "floor-length cloth hides the trestle legs",
  "trestle-6ft-white": "floor-length cloth hides the trestle legs",
  "trestle-6ft-black": "floor-length cloth hides the trestle legs",
  "ceremony-table": "skirt to the floor hides the legs, a trestle frame at its width",
  "poseur-table-white": "stretch cover hides the weighted round base",
  "poseur-table-black": "stretch cover hides the weighted round base",
  "poseur-table": "one weighted round base, set down on four points of its rim",
  "bar-counter": "a plinth, not feet",
  "platform": "skirt to the floor hides the deck legs",
  "platform-narrow": "skirt to the floor hides the deck legs",
  "staging-deck-6x4": "skirt to the floor hides the deck legs",
  "staging-deck-6x3": "skirt to the floor hides the deck legs",
  "dancefloor-panel": "a flat panel with an aluminium rim, set down on its corners",
  "lectern": "a plinth, not feet",
  "projector-screen": "rubber feet are drawn but cast no shade",
  "projector": "rubber feet are drawn but stand on a table, with no floor shade",
  "laptop": "no feet drawn; four rubber feet under the base",
};

const MATCH_M = 0.015;

afterEach(() => {
  clearCraftedGeometryCache();
});

describe("set-down bodies", () => {
  it("has a body for every crafted piece, and only those", () => {
    expect(Object.keys(SET_DOWN_BODIES).sort()).toEqual([...CRAFTED_FURNITURE_SLUGS].sort());
    for (const slug of CRAFTED_FURNITURE_SLUGS) expect(SET_DOWN_BODIES[slug].slug).toBe(slug);
  });

  it("lists a no-shade exception only for a piece that has no shade", () => {
    const shadeless = CRAFTED_FURNITURE_SLUGS.filter((slug) => contactSpotsOf(slug).length === 0);
    expect([...shadeless].sort()).toEqual(Object.keys(NO_CONTACT_SHADE).sort());
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("stands %s where its crafted model shades the floor", (slug) => {
    const spots = contactSpotsOf(slug);
    const body = SET_DOWN_BODIES[slug];
    expect(body.feet.length, "at least one foot").toBeGreaterThan(0);
    if (spots.length === 0) {
      // No shade to match: each foot lies inside the catalogue footprint.
      const item = getCatalogueItemBySlug(slug);
      if (item === undefined) throw new Error(`No catalogue item for ${slug}`);
      for (const foot of body.feet) {
        expect(Math.abs(foot.x), `${slug} foot x`).toBeLessThanOrEqual(item.width / 2);
        expect(Math.abs(foot.z), `${slug} foot z`).toBeLessThanOrEqual(item.depth / 2);
      }
      return;
    }
    expect(body.feet.length).toBe(spots.length);
    // Each foot sits within 1.5 cm of a spot, and no two feet take the same spot.
    const taken = new Set<number>();
    for (const foot of body.feet) {
      let best = -1;
      let bestDistance = Infinity;
      spots.forEach((spot, index) => {
        const distance = Math.hypot(spot.x - foot.x, spot.z - foot.z);
        if (!taken.has(index) && distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      expect(bestDistance, `${slug} foot (${String(foot.x)}, ${String(foot.z)})`).toBeLessThanOrEqual(MATCH_M);
      taken.add(best);
    }
  });

  it("shares each part's radiated energy out to exactly one", () => {
    for (const body of Object.values(SET_DOWN_BODIES)) {
      expect(body.parts.length, body.slug).toBeGreaterThan(0);
      const total = body.parts.reduce((sum, part) => sum + part.share, 0);
      expect(Math.abs(total - 1), body.slug).toBeLessThan(1e-9);
      for (const part of body.parts) {
        expect(part.lengthM, `${body.slug} ${part.kind}`).toBeGreaterThan(0);
        expect(part.thicknessM, `${body.slug} ${part.kind}`).toBeGreaterThan(0);
        expect(part.share, `${body.slug} ${part.kind}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every mass between 0.2 and 100 kg", () => {
    for (const body of Object.values(SET_DOWN_BODIES)) {
      expect(body.massKg, body.slug).toBeGreaterThanOrEqual(0.2);
      expect(body.massKg, body.slug).toBeLessThanOrEqual(100);
    }
  });

  it("keeps the researched masses and caps", () => {
    expect(SET_DOWN_BODIES["chiavari-chair"].massKg).toBe(4);
    expect(SET_DOWN_BODIES["chiavari-chair"].feet.every((foot) => foot.cap === "glide")).toBe(true);
    expect(SET_DOWN_BODIES["pink-chair"].massKg).toBe(6);
    expect(SET_DOWN_BODIES["gallery-chair-red-gold"].massKg).toBe(6.5);
    expect(SET_DOWN_BODIES["round-table-6ft"].massKg).toBe(30);
    expect(SET_DOWN_BODIES["trestle-4ft"].massKg).toBe(14);
    expect(SET_DOWN_BODIES["trestle-6ft"].massKg).toBe(20);
    expect(SET_DOWN_BODIES["bar-counter"].massKg).toBe(70);
    expect(SET_DOWN_BODIES["hisense-television"].feet.every((foot) => foot.cap === "castor")).toBe(true);
    expect(SET_DOWN_BODIES["servery-unit"].feet.every((foot) => foot.cap === "castor")).toBe(true);
    expect(SET_DOWN_BODIES["room-divider"].feet.every((foot) => foot.cap === "castor")).toBe(true);
    expect(SET_DOWN_BODIES["mic-stand"].feet.every((foot) => foot.cap === "rubber")).toBe(true);
    expect(SET_DOWN_BODIES["round-table-6ft-white"].legRattle).toBe(true);
    expect(SET_DOWN_BODIES["chiavari-chair"].parts.map((part) => [part.kind, part.share])).toEqual([["beech-frame", 0.7], ["upholstery", 0.3]]);
    expect(SET_DOWN_BODIES["banquet-chair"].parts.map((part) => [part.kind, part.share])).toEqual([["steel-tube-frame", 0.6], ["upholstery", 0.4]]);
    expect(SET_DOWN_BODIES["round-table-6ft"].parts.map((part) => part.kind)).toContain("steel-tube-frame");
  });

  it("scales the feet by the scale, the mass by its cube and the lengths by the scale", () => {
    const one = bodyFor("chiavari-chair");
    const two = bodyFor("chiavari-chair", 2);
    const spread = (feet: readonly { readonly x: number; readonly z: number }[]): number =>
      Math.max(...feet.map((foot) => Math.abs(foot.x)), ...feet.map((foot) => Math.abs(foot.z)));
    expect(spread(two.feet)).toBeCloseTo(2 * spread(one.feet), 12);
    expect(two.massKg).toBeCloseTo(8 * one.massKg, 12);
    expect(two.feet.length).toBe(one.feet.length);
    expect(two.parts[0]?.lengthM).toBeCloseTo(2 * (one.parts[0]?.lengthM ?? NaN), 12);
    expect(two.parts[0]?.thicknessM).toBeCloseTo(2 * (one.parts[0]?.thicknessM ?? NaN), 12);
    expect(two.parts[0]?.share).toBe(one.parts[0]?.share);
    expect(two.slug).toBe("chiavari-chair");
    // The shared body is untouched.
    expect(SET_DOWN_BODIES["chiavari-chair"].massKg).toBe(4);
  });

  it("gives the crafted body itself at scale 1", () => {
    expect(bodyFor("chiavari-chair")).toBe(SET_DOWN_BODIES["chiavari-chair"]);
    expect(bodyFor("chiavari-chair", 1)).toBe(SET_DOWN_BODIES["chiavari-chair"]);
  });

  it("never throws, goes NaN or goes silent for a piece with no crafted body", () => {
    for (const slug of ["imported-thing", "", "constructor", "__proto__", "black-table-cloth", "dinner-place-setting"]) {
      for (const scale of [undefined, 1, 0.5, 3, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
        const body = bodyFor(slug, scale);
        expect(body.feet.length, `${slug} @ ${String(scale)}`).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(body.massKg), slug).toBe(true);
        expect(body.massKg, slug).toBeGreaterThan(0);
        for (const foot of body.feet) {
          expect(Number.isFinite(foot.x) && Number.isFinite(foot.z), slug).toBe(true);
        }
        const total = body.parts.reduce((sum, part) => sum + part.share, 0);
        expect(Math.abs(total - 1), slug).toBeLessThan(1e-9);
        for (const part of body.parts) {
          expect(Number.isFinite(part.lengthM) && Number.isFinite(part.thicknessM), slug).toBe(true);
        }
      }
    }
  });

  it("picks a family template from the catalogue for a piece that is catalogued but not crafted", () => {
    // Table cloths are dressing, not crafted pieces.
    const cloth = getCatalogueItemBySlug("black-table-cloth");
    expect(cloth).toBeDefined();
    expect(SET_DOWN_BODIES).not.toHaveProperty("black-table-cloth");
    const body = bodyFor("black-table-cloth");
    expect(body.slug).toBe("black-table-cloth");
    expect(body.feet.length).toBeGreaterThanOrEqual(1);
  });

  it("scales a fallback body the same way", () => {
    const one = bodyFor("imported-thing");
    const two = bodyFor("imported-thing", 2);
    expect(two.massKg).toBeCloseTo(8 * one.massKg, 12);
    expect(two.feet.length).toBe(one.feet.length);
  });
});
