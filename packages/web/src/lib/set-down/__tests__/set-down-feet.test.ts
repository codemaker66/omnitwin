import { Box3, Mesh, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS, type CraftedFurnitureSlug } from "../../../components/meshes/crafted/crafted-slugs.js";
import { clearCraftedGeometryCache, createCraftedFurniture } from "../../../components/meshes/crafted/crafted-registry.js";
import { getCatalogueItemBySlug } from "../../catalogue.js";
import { SET_DOWN_BODIES, bodyFor, type Foot } from "../bodies.js";

interface Spot {
  readonly x: number;
  readonly z: number;
}

interface Size {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

function sizeOf(slug: string): Size {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`No catalogue item for ${slug}`);
  return { width: item.width, depth: item.depth, height: item.height };
}

/** The spots of shade a piece leaves on the floor: each a quad of four corners, centred on its foot. */
function contactSpotsAt(slug: CraftedFurnitureSlug, size: Size): Spot[] {
  const model = createCraftedFurniture({ slug, ...size });
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

/** Each piece's own spots, built once at its catalogue size. */
const OWN_SPOTS = new Map<CraftedFurnitureSlug, Spot[]>();
/** The twins' spots, built once per twin and size. */
const TWIN_SPOTS = new Map<string, Spot[]>();

function twinSpots(twin: CraftedFurnitureSlug, size: Size): Spot[] {
  const key = `${twin}|${String(size.width)}|${String(size.depth)}|${String(size.height)}`;
  let spots = TWIN_SPOTS.get(key);
  if (spots === undefined) {
    spots = contactSpotsAt(twin, size);
    TWIN_SPOTS.set(key, spots);
  }
  return spots;
}

function ownSpots(slug: CraftedFurnitureSlug): readonly Spot[] {
  const spots = OWN_SPOTS.get(slug);
  if (spots === undefined) throw new Error(`Spots for ${slug} were not built`);
  return spots;
}

/**
 * Pieces whose crafted model draws no contact shade, and why. Each is held to
 * either the shade of a twin model that draws the same hidden frame
 * (HIDDEN_FRAME_TWINS) or to the position its factory's own formula gives
 * (FORMULA_FEET). The list is exact: a model that gains a shade leaves it and
 * is matched spot for spot instead.
 */
const NO_CONTACT_SHADE: Readonly<Record<string, string>> = {
  "round-table-6ft-white": "floor-length cloth hides clothedRoundParts' frame, which the black round shades",
  "cake-cutting-table": "floor-length cloth hides clothedRoundParts' frame at the cake table's radius",
  "trestle-4ft-white": "floor-length cloth hides the trestle legs the bare 4 ft trestle shades",
  "trestle-4ft-black": "floor-length cloth hides the trestle legs the bare 4 ft trestle shades",
  "trestle-6ft-white": "floor-length cloth hides the trestle legs the bare 6 ft trestle shades",
  "trestle-6ft-black": "floor-length cloth hides the trestle legs the bare 6 ft trestle shades",
  "ceremony-table": "skirt to the floor hides legs that trestleLegs would put at the table's width",
  "poseur-table-white": "the cover's four pockets carry no contact shade on master (#259 adds them)",
  "poseur-table-black": "the cover's four pockets carry no contact shade on master (#259 adds them)",
  "poseur-table": "one weighted round base with no feet drawn, set down on four points of its rim",
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

/** A twin that draws the same hidden frame with a shade, built at the hidden piece's own size. */
const HIDDEN_FRAME_TWINS: Readonly<Record<string, CraftedFurnitureSlug>> = {
  "round-table-6ft-white": "round-table-6ft-black",
  "trestle-4ft-white": "trestle-4ft",
  "trestle-4ft-black": "trestle-4ft",
  "trestle-6ft-white": "trestle-6ft",
  "trestle-6ft-black": "trestle-6ft",
  "ceremony-table": "trestle-6ft",
};

/** Four feet at the corners of a rectangle about the origin. */
const rect = (x: number, z: number): Spot[] => [{ x: -x, z: -z }, { x, z: -z }, { x: -x, z }, { x, z }];

/** A covered poseur's pockets sit at 0.98 of its radius on the diagonals (crafted-poseur.ts:43). */
const coveredPoseur = ({ width, depth }: Size): Spot[] => {
  const reach = (Math.min(width, depth) / 2) * 0.98 * Math.SQRT1_2;
  return rect(reach, reach);
};

/** Where each remaining piece's factory puts its feet, written out from its own formulas. */
const FORMULA_FEET: Readonly<Record<string, (size: Size) => Spot[]>> = {
  // crafted-tables.ts:103, the clothed round's hidden frame, at the cake table's radius.
  "cake-cutting-table": ({ width }) => rect((width / 2) * 0.55 * 1.04, (width / 2) * 0.4 * 1.1),
  "poseur-table-white": coveredPoseur,
  "poseur-table-black": coveredPoseur,
  // crafted-tables.ts barePoseurParts: a weighted foot of 0.72 of the radius, set down on its rim's diagonals.
  "poseur-table": ({ width, depth }) => {
    const reach = (Math.min(width, depth) / 2) * 0.72 * Math.SQRT1_2;
    return rect(reach, reach);
  },
  // crafted-cabinets.ts: the plinth is the body less 5 cm; the feet are 5 cm in from its edge.
  "bar-counter": ({ width, depth }) => rect((width - 0.05) / 2 - 0.05, (depth - 0.05) / 2 - 0.05),
  // crafted-av.ts lecternParts: the plinth is the footprint less 1 cm; the feet are 4 cm in.
  "lectern": ({ width, depth }) => rect((width - 0.01) / 2 - 0.04, (depth - 0.01) / 2 - 0.04),
  // crafted-staging.ts: the deck's corners, 5 cm in; the dance panel's, 4 cm in.
  "platform": ({ width, depth }) => rect(width / 2 - 0.05, depth / 2 - 0.05),
  "platform-narrow": ({ width, depth }) => rect(width / 2 - 0.05, depth / 2 - 0.05),
  "staging-deck-6x4": ({ width, depth }) => rect(width / 2 - 0.05, depth / 2 - 0.05),
  "staging-deck-6x3": ({ width, depth }) => rect(width / 2 - 0.05, depth / 2 - 0.05),
  "dancefloor-panel": ({ width, depth }) => rect(width / 2 - 0.04, depth / 2 - 0.04),
  // crafted-av.ts projectorScreenParts: legX = frameW / 2 - 0.03 with frameW = width - 0.04; footHalf = depth / 2 - 0.02.
  "projector-screen": ({ width, depth }) => rect((width - 0.04) / 2 - 0.03, depth / 2 - 0.02),
  // crafted-av.ts projectorParts: rubber feet at 0.38 of the width and 0.35 of the depth.
  "projector": ({ width, depth }) => rect(width * 0.38, depth * 0.35),
  // crafted-av.ts laptopParts: four feet 4 cm and 2 cm in from the base's corners, the base spanning baseD of the depth.
  "laptop": ({ width, depth, height }) => {
    const tilt = (15 * Math.PI) / 180;
    const lidH = Math.min(height - 0.016, depth * 0.95);
    const baseD = depth - lidH * Math.sin(tilt) - 0.006;
    const centre = -(depth - baseD) / 2;
    const reach = baseD / 2 - 0.02;
    const x = width / 2 - 0.04;
    return [{ x: -x, z: centre - reach }, { x, z: centre - reach }, { x: -x, z: centre + reach }, { x, z: centre + reach }];
  },
};

const MATCH_M = 0.015;

/** The feet pair one-to-one with the expected spots, each within 1.5 cm. */
function expectFeetAt(label: string, feet: readonly Foot[], expected: readonly Spot[]): void {
  expect(feet.length, `${label} foot count`).toBe(expected.length);
  const taken = new Set<number>();
  for (const foot of feet) {
    let best = -1;
    let bestDistance = Infinity;
    expected.forEach((spot, index) => {
      const distance = Math.hypot(spot.x - foot.x, spot.z - foot.z);
      if (!taken.has(index) && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    expect(bestDistance, `${label} foot (${String(foot.x)}, ${String(foot.z)})`).toBeLessThanOrEqual(MATCH_M);
    taken.add(best);
  }
}

beforeAll(() => {
  for (const slug of CRAFTED_FURNITURE_SLUGS) OWN_SPOTS.set(slug, contactSpotsAt(slug, sizeOf(slug)));
  // Twins at the hidden pieces' sizes.
  for (const [slug, twin] of Object.entries(HIDDEN_FRAME_TWINS)) twinSpots(twin, sizeOf(slug));
  clearCraftedGeometryCache();
});

afterAll(() => {
  clearCraftedGeometryCache();
});

describe("set-down bodies", () => {
  it("has a body for every crafted piece, and only those", () => {
    expect(Object.keys(SET_DOWN_BODIES).sort()).toEqual([...CRAFTED_FURNITURE_SLUGS].sort());
    for (const slug of CRAFTED_FURNITURE_SLUGS) expect(SET_DOWN_BODIES[slug].slug).toBe(slug);
  });

  it("lists a no-shade exception only for a piece that has no shade", () => {
    const shadeless = CRAFTED_FURNITURE_SLUGS.filter((slug) => ownSpots(slug).length === 0);
    expect([...shadeless].sort()).toEqual(Object.keys(NO_CONTACT_SHADE).sort());
  });

  it("holds every shadeless piece to exactly one of a shaded twin or a factory formula", () => {
    for (const slug of Object.keys(NO_CONTACT_SHADE)) {
      expect(slug in HIDDEN_FRAME_TWINS !== slug in FORMULA_FEET, slug).toBe(true);
    }
    for (const slug of [...Object.keys(HIDDEN_FRAME_TWINS), ...Object.keys(FORMULA_FEET)]) {
      expect(NO_CONTACT_SHADE, slug).toHaveProperty(slug);
    }
    for (const twin of Object.values(HIDDEN_FRAME_TWINS)) {
      expect(ownSpots(twin).length, `${twin} shades its feet`).toBeGreaterThan(0);
    }
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("stands %s where its crafted model puts its feet", (slug) => {
    const body = SET_DOWN_BODIES[slug];
    expect(body.feet.length, "at least one foot").toBeGreaterThan(0);
    const own = ownSpots(slug);
    if (own.length > 0) {
      expectFeetAt(slug, body.feet, own);
      return;
    }
    const twin = HIDDEN_FRAME_TWINS[slug];
    if (twin !== undefined) {
      expectFeetAt(`${slug} against ${twin}`, body.feet, twinSpots(twin, sizeOf(slug)));
      return;
    }
    const formula = FORMULA_FEET[slug];
    if (formula === undefined) throw new Error(`${slug} has no shade, twin or formula`);
    expectFeetAt(`${slug} by formula`, body.feet, formula(sizeOf(slug)));
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

  it("stands a covered poseur on four rubber folding-leg feet, not the bare poseur's disc", () => {
    for (const slug of ["poseur-table-white", "poseur-table-black"] as const) {
      const poseur = SET_DOWN_BODIES[slug];
      expect(poseur.feet.every((foot) => foot.cap === "rubber"), slug).toBe(true);
      expect(poseur.parts.map((part) => part.kind), slug).toEqual(["mdf-top", "steel-tube-frame"]);
      expect(poseur.legRattle, slug).toBe(true);
      expect(Math.abs(poseur.feet[0]?.x ?? NaN), slug).toBeCloseTo(0.2079, 3);
    }
    expect(SET_DOWN_BODIES["poseur-table"].feet.every((foot) => foot.cap === "steel")).toBe(true);
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
