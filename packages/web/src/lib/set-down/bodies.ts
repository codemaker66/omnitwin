// ---------------------------------------------------------------------------
// The body of every placeable piece: its feet, its mass and the parts that
// ring when it lands (T-677).
//
// The modal renderer (task 6) strikes each foot into the surface and lets the
// piece's parts sound. Feet are in metres in the piece's own frame at
// catalogue size, and are the crafted model's contact spots (the shade
// under each foot), so what is seen to touch the floor is what is heard
// touching it; set-down-feet.test.ts enforces that. A few crafted pieces
// draw no shade (a cloth hides the legs, a deck stands on a skirt): their
// feet are written from the factory's own geometry, and the test holds them
// to the catalogue footprint. Masses are estimates (EST) from the venue's
// kit; shares are the part's share of the radiated energy.
// ---------------------------------------------------------------------------

import type { CraftedFurnitureSlug } from "../../components/meshes/crafted/crafted-slugs.js";
import { getCatalogueItemBySlug } from "../catalogue.js";

export type FootCap = "glide" | "rubber" | "felt" | "steel" | "castor" | "panel-edge";

export interface Foot {
  readonly x: number;
  readonly z: number;
  readonly cap: FootCap;
}

export type PartKind =
  | "beech-frame"
  | "steel-tube-frame"
  | "aluminium-frame"
  | "ply-top"
  | "mdf-top"
  | "phenolic-deck"
  | "cast-base"
  | "cabinet-carcass"
  | "av-plastic"
  | "av-glass"
  | "upholstery";

export interface BodyPart {
  readonly kind: PartKind;
  readonly lengthM: number;
  readonly thicknessM: number;
  /** The part's share of the radiated energy; a body's shares sum to 1. */
  readonly share: number;
}

export type BodyFamily =
  | "chair"
  | "round-table"
  | "rect-table"
  | "poseur"
  | "stage"
  | "dance-floor"
  | "lectern"
  | "av-stand"
  | "av-small"
  | "cabinet"
  | "divider"
  | "highchair";

export interface SetDownBody {
  readonly slug: string;
  readonly family: BodyFamily;
  readonly massKg: number;
  readonly feet: readonly Foot[];
  readonly parts: readonly BodyPart[];
  /** Folding or loose legs that chatter after a landing. */
  readonly legRattle: boolean;
  /** An upholstered seat that sighs when it takes the air. */
  readonly seatPuff: boolean;
  /** Castors that roll on a little after a landing. */
  readonly castorRoll: boolean;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface Flags {
  readonly legRattle?: boolean;
  readonly seatPuff?: boolean;
  readonly castorRoll?: boolean;
}

function body(slug: string, family: BodyFamily, massKg: number, feet: readonly Foot[], parts: readonly BodyPart[], flags: Flags = {}): SetDownBody {
  return {
    slug,
    family,
    massKg,
    feet,
    parts,
    legRattle: flags.legRattle ?? false,
    seatPuff: flags.seatPuff ?? false,
    castorRoll: flags.castorRoll ?? false,
  };
}

const part = (kind: PartKind, lengthM: number, thicknessM: number, share: number): BodyPart => ({ kind, lengthM, thicknessM, share });

/** Feet of one cap at the given (x, z) points. */
const on = (cap: FootCap, ...points: readonly (readonly [number, number])[]): Foot[] => points.map(([x, z]) => ({ x, z, cap }));

/** Four feet at the corners of a rectangle about the origin. */
const corners = (cap: FootCap, x: number, z: number): Foot[] => on(cap, [-x, -z], [x, -z], [-x, z], [x, z]);

// ---------------------------------------------------------------------------
// Parts shared by a family of pieces
// ---------------------------------------------------------------------------

const BANQUET_CHAIR_PARTS = [part("steel-tube-frame", 0.45, 0.025, 0.6), part("upholstery", 0.4, 0.05, 0.4)] as const;
const CHIAVARI_PARTS = [part("beech-frame", 0.45, 0.025, 0.7), part("upholstery", 0.4, 0.04, 0.3)] as const;
const HIGHCHAIR_PARTS = [part("beech-frame", 0.55, 0.026, 0.85), part("ply-top", 0.32, 0.026, 0.15)] as const;

/** The folding steel frame under a banqueting round or trestle. */
const folding = (share: number): BodyPart => part("steel-tube-frame", 0.7, 0.025, share);

/**
 * The folding frame hidden under a clothed round, from clothedRoundParts
 * (crafted-tables.ts:103): feet at [0.55 r x 1.04, 0.4 r x 1.1] for a table of
 * radius r. Only the black 6 ft round draws their shade; the others are hidden.
 */
const clothedRoundFeet = (radiusM: number): Foot[] => corners("rubber", radiusM * 0.55 * 1.04, radiusM * 0.4 * 1.1);

/**
 * A covered poseur stands on four folding legs under its stretch cover, whose
 * pockets sit at footReach = 0.98 r on the diagonals (crafted-poseur.ts:43) for
 * a top of radius r. Each pocket carries a spot of contact shade, so the test
 * matches these feet to the crafted model's own shade.
 */
const coveredPoseurFeet = (radiusM: number): Foot[] => {
  const reach = radiusM * 0.98 * Math.SQRT1_2;
  return corners("rubber", reach, reach);
};

const COVERED_POSEUR_PARTS = [part("mdf-top", 0.6, 0.025, 0.6), folding(0.4)] as const;

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

export const SET_DOWN_BODIES: Readonly<Record<CraftedFurnitureSlug, SetDownBody>> = {
  // Chairs: glides under the tube feet (crafted-chairs.ts, crafted-chiavari.ts).
  "chiavari-chair": body("chiavari-chair", "chair", 4, on("glide", [-0.1885, -0.1885], [-0.1765, 0.1885], [0.1885, -0.1885], [0.1765, 0.1885]), CHIAVARI_PARTS, { seatPuff: true }),
  "burgess-turini-18-3": body("burgess-turini-18-3", "chair", 6, on("glide", [-0.1885, -0.2765], [0.1885, -0.2765], [-0.1965, 0.2765], [0.1965, 0.2765]), BANQUET_CHAIR_PARTS, { seatPuff: true }),
  "checked-banquet-chair": body("checked-banquet-chair", "chair", 6, on("glide", [-0.2185, -0.2965], [0.2185, -0.2965], [-0.2265, 0.2965], [0.2265, 0.2965]), BANQUET_CHAIR_PARTS, { seatPuff: true }),
  "gallery-chair-red-gold": body("gallery-chair-red-gold", "chair", 6.5, on("glide", [-0.2035, -0.2115], [0.2035, -0.2115], [-0.2115, 0.2115], [0.2115, 0.2115]), BANQUET_CHAIR_PARTS, { seatPuff: true }),
  // The pink chair is the Burgess Turini 18/3 (0.42 x 0.58 m, migration 0103), so it stands on that chair's
  // glides: xs = 0.42 / 2 - 0.0125 - 0.016 - 0.001 = 0.1805, front +0.008 = 0.1885 at z = -0.29 + 0.0105 + 0.003
  // = -0.2765, rear +0.016 = 0.1965 at z = +0.2765 (crafted-chairs.ts). Mass is an EST and stays at 6 kg.
  "pink-chair": body("pink-chair", "chair", 6, on("glide", [-0.1885, -0.2765], [0.1885, -0.2765], [-0.1965, 0.2765], [0.1965, 0.2765]), BANQUET_CHAIR_PARTS, { seatPuff: true }),
  "banquet-chair": body("banquet-chair", "chair", 6, on("glide", [-0.2035, -0.2115], [0.2035, -0.2115], [-0.2115, 0.2115], [0.2115, 0.2115]), BANQUET_CHAIR_PARTS, { seatPuff: true }),

  // Banqueting rounds: a flat top on a folding steel frame with rubber feet. The clothed rounds hide
  // the frame clothedRoundParts draws; the bare round's is its own (bareRoundParts).
  "round-table-6ft-white": body("round-table-6ft-white", "round-table", 30, clothedRoundFeet(1.83 / 2), [part("mdf-top", 1.83, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  "round-table-6ft-black": body("round-table-6ft-black", "round-table", 30, corners("rubber", 0.5234, 0.4026), [part("mdf-top", 1.83, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  "round-table-6ft": body("round-table-6ft", "round-table", 30, corners("rubber", 0.5519, 0.4227), [part("ply-top", 1.83, 0.018, 0.7), folding(0.3)], { legRattle: true }),
  // The cake table is a clothed round at 1.1 m: the same hidden frame at its radius.
  "cake-cutting-table": body("cake-cutting-table", "round-table", 18, clothedRoundFeet(1.1 / 2), [part("mdf-top", 1.1, 0.025, 0.7), folding(0.3)], { legRattle: true }),

  // Trestles: the hinged steel legs dog-leg outward to a rubber foot (crafted-tables.ts trestleLegs).
  // Under a floor-length cloth the legs are the same.
  "trestle-4ft-white": body("trestle-4ft-white", "rect-table", 14, corners("rubber", 0.5108, 0.31), [part("mdf-top", 1.22, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  "trestle-4ft-black": body("trestle-4ft-black", "rect-table", 14, corners("rubber", 0.5108, 0.31), [part("mdf-top", 1.22, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  "trestle-6ft-white": body("trestle-6ft-white", "rect-table", 20, corners("rubber", 0.75, 0.31), [part("mdf-top", 1.83, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  "trestle-6ft-black": body("trestle-6ft-black", "rect-table", 20, corners("rubber", 0.75, 0.31), [part("mdf-top", 1.83, 0.025, 0.7), folding(0.3)], { legRattle: true }),
  // The bare trestle's top is a blow-moulded plastic panel; av-plastic is the nearest part kind.
  "trestle-6ft": body("trestle-6ft", "rect-table", 20, corners("rubber", 0.75, 0.31), [part("av-plastic", 1.83, 0.045, 0.7), folding(0.3)], { legRattle: true }),
  "trestle-4ft": body("trestle-4ft", "rect-table", 14, corners("rubber", 0.5108, 0.31), [part("av-plastic", 1.22, 0.045, 0.7), folding(0.3)], { legRattle: true }),
  "trestle-6ft-wooden": body("trestle-6ft-wooden", "rect-table", 20, corners("rubber", 0.75, 0.31), [part("ply-top", 1.83, 0.02, 0.7), folding(0.3)], { legRattle: true }),
  // Hidden under its skirt: a trestle frame at the table's width (trestleLegs at 1.6 m by 1 m).
  "ceremony-table": body("ceremony-table", "rect-table", 24, corners("rubber", 0.659, 0.43), [part("mdf-top", 1.6, 0.03, 0.7), folding(0.3)], { legRattle: true }),

  // Café tables: a cast column on four arched arms with glides.
  "round-cafe-table-white": body("round-cafe-table-white", "round-table", 10, corners("glide", 0.2121, 0.2121), [part("mdf-top", 0.9, 0.02, 0.6), part("cast-base", 0.5, 0.03, 0.4)]),
  "square-cafe-table-white": body("square-cafe-table-white", "rect-table", 10, corners("glide", 0.2227, 0.2227), [part("mdf-top", 1.05, 0.02, 0.6), part("cast-base", 0.5, 0.03, 0.4)]),

  // The covered poseurs stand on four folding legs under the stretch cover (poseurParts). The bare
  // poseur has one weighted round chrome foot, 0.216 m in radius (barePoseurParts), set down on four points of its rim.
  "poseur-table-white": body("poseur-table-white", "poseur", 13, coveredPoseurFeet(0.3), COVERED_POSEUR_PARTS, { legRattle: true }),
  "poseur-table-black": body("poseur-table-black", "poseur", 13, coveredPoseurFeet(0.3), COVERED_POSEUR_PARTS, { legRattle: true }),
  "poseur-table": body("poseur-table", "poseur", 13, corners("steel", 0.1527, 0.1527), [part("mdf-top", 0.6, 0.025, 0.5), part("cast-base", 0.7, 0.03, 0.5)]),

  // Cabinets. The bar stands on a plinth: its corners, 5 cm in from the plinth's edge.
  "bar-counter": body("bar-counter", "cabinet", 70, corners("panel-edge", 0.725, 0.23), [part("cabinet-carcass", 1.6, 0.022, 0.8), part("ply-top", 1.6, 0.045, 0.2)]),
  "servery-unit": body("servery-unit", "cabinet", 55, on("castor", [-0.925, -0.2], [-0.925, 0.2], [0, -0.2], [0, 0.2], [0.925, -0.2], [0.925, 0.2]), [part("cabinet-carcass", 2.05, 0.025, 0.8), part("ply-top", 2.05, 0.035, 0.2)], { castorRoll: true }),

  // Staging: skirted sectional decks. Their legs are hidden, so the feet are the corners, 5 cm in.
  "platform": body("platform", "stage", 35, corners("panel-edge", 1.17, 0.56), [part("phenolic-deck", 2.44, 0.018, 0.75), part("aluminium-frame", 1.22, 0.003, 0.25)]),
  "platform-narrow": body("platform-narrow", "stage", 25, corners("panel-edge", 1.17, 0.46), [part("phenolic-deck", 2.44, 0.018, 0.75), part("aluminium-frame", 1.02, 0.003, 0.25)]),
  "staging-deck-6x4": body("staging-deck-6x4", "stage", 45, corners("panel-edge", 0.865, 0.56), [part("phenolic-deck", 1.83, 0.018, 0.75), part("aluminium-frame", 1.22, 0.003, 0.25)]),
  "staging-deck-6x3": body("staging-deck-6x3", "stage", 38, corners("panel-edge", 0.865, 0.405), [part("phenolic-deck", 1.83, 0.018, 0.75), part("aluminium-frame", 0.91, 0.003, 0.25)]),
  // A 3 ft panel: the parquet face on an aluminium-edged base, set down on its corners, 4 cm in.
  "dancefloor-panel": body("dancefloor-panel", "dance-floor", 15, corners("panel-edge", 0.415, 0.415), [part("ply-top", 0.91, 0.016, 0.6), part("aluminium-frame", 0.91, 0.003, 0.4)]),

  // The lectern stands on a mahogany plinth: its corners, 4 cm in.
  "lectern": body("lectern", "lectern", 25, corners("panel-edge", 0.255, 0.205), [part("cabinet-carcass", 0.5, 0.02, 0.7), part("ply-top", 0.6, 0.026, 0.3)]),

  // AV. The screen's rubber feet are drawn at the ends of its two foot bars.
  "projector-screen": body("projector-screen", "av-stand", 12, corners("rubber", 1.2, 0.28), [part("steel-tube-frame", 1.8, 0.016, 0.8), part("av-plastic", 2.4, 0.006, 0.2)], { legRattle: true }),
  "hisense-television": body("hisense-television", "av-stand", 32, on("castor", [-0.32, -0.235], [-0.32, 0.235], [0.32, -0.235], [0.32, 0.235]), [part("av-glass", 1.46, 0.004, 0.35), part("av-plastic", 1.46, 0.02, 0.25), part("steel-tube-frame", 1, 0.022, 0.4)], { castorRoll: true }),
  "mic-stand": body("mic-stand", "av-stand", 3, on("rubber", [0.1905, 0.11], [-0.1905, 0.11], [0, -0.22]), [part("steel-tube-frame", 1, 0.0115, 0.8), part("cast-base", 0.1, 0.032, 0.2)], { legRattle: true }),
  // A projector and a laptop stand on four rubber feet on a table (projectorParts; the laptop draws none, its base has four).
  "projector": body("projector", "av-small", 3.5, corners("rubber", 0.209, 0.1225), [part("av-plastic", 0.55, 0.003, 0.9), part("av-glass", 0.05, 0.003, 0.1)]),
  "laptop": body("laptop", "av-small", 1.8, on("rubber", [-0.14, -0.105], [0.14, -0.105], [-0.14, 0.0384], [0.14, 0.0384]), [part("aluminium-frame", 0.36, 0.006, 0.8), part("av-glass", 0.3, 0.003, 0.2)]),
  "handheld-microphone": body("handheld-microphone", "av-small", 0.3, on("rubber", [0, 0]), [part("av-plastic", 0.14, 0.004, 0.7), part("aluminium-frame", 0.04, 0.001, 0.3)]),
  "lapel-microphone": body("lapel-microphone", "av-small", 0.3, on("rubber", [0, 0]), [part("av-plastic", 0.05, 0.002, 1)]),
  "microphone": body("microphone", "av-small", 0.3, on("rubber", [0, 0]), [part("cast-base", 0.1, 0.012, 0.6), part("steel-tube-frame", 0.25, 0.01, 0.4)]),

  // Highchairs: four splayed square legs, bare wood or paint on the floor.
  "highchair-white": body("highchair-white", "highchair", 5, corners("glide", 0.22, 0.245), HIGHCHAIR_PARTS),
  "highchair-green": body("highchair-green", "highchair", 5, corners("glide", 0.22, 0.245), HIGHCHAIR_PARTS),
  "highchair-blue": body("highchair-blue", "highchair", 5, corners("glide", 0.22, 0.245), HIGHCHAIR_PARTS),
  // The wooden highchair is 0.51 x 0.51 x 0.75 m (migration 0103): its feet are width / 2 - 0.03 = 0.225 in x and
  // depth / 2 - 0.03 = 0.225 in z (crafted-extras.ts footX, footZ). Its splayed leg runs from (0.225, 0.014, 0.225)
  // to the seat (0.15, 0.415, 0.1428), 0.417 m against the 0.53 m of the 0.95 m painted chairs that HIGHCHAIR_PARTS
  // (0.55 m of frame) was written for, so the frame scales to 0.55 x 0.417 / 0.53 = 0.43 m. The 0.32 m seat is unchanged.
  // Mass is an EST and stays at 5 kg.
  "highchair-wooden": body("highchair-wooden", "highchair", 5, corners("glide", 0.225, 0.225), [part("beech-frame", 0.43, 0.026, 0.85), part("ply-top", 0.32, 0.026, 0.15)]),

  // The folding divider: a castor under every hinge post (nine along the line) and two at each end frame.
  "room-divider": body(
    "room-divider",
    "divider",
    22,
    on(
      "castor",
      [-2.02, 0], [-1.515, 0], [-1.01, 0], [-0.505, 0], [0, 0], [0.505, 0], [1.01, 0], [1.515, 0], [2.02, 0],
      [-2.07, -0.345], [-2.07, 0.345], [2.07, -0.345], [2.07, 0.345],
    ),
    [part("steel-tube-frame", 1.7, 0.014, 0.4), part("upholstery", 0.5, 0.032, 0.6)],
    { legRattle: true, castorRoll: true },
  ),
};

// ---------------------------------------------------------------------------
// Pieces with no crafted body
// ---------------------------------------------------------------------------

/** A piece's scale is held within this range, so no mass or length can overflow. */
const MIN_SCALE = 0.01;
const MAX_SCALE = 100;

function sane(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function scaled(source: SetDownBody, scale: number): SetDownBody {
  if (scale === 1) return source;
  return {
    ...source,
    massKg: source.massKg * scale ** 3,
    feet: source.feet.map((foot) => ({ x: foot.x * scale, z: foot.z * scale, cap: foot.cap })),
    parts: source.parts.map((p) => ({ kind: p.kind, lengthM: p.lengthM * scale, thicknessM: p.thicknessM * scale, share: p.share })),
  };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const dimension = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) && value > 0 ? clamp(value, 0.02, 20) : 0.5);

interface Footprint {
  readonly category: string;
  readonly tableShape: string | null;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/**
 * The family template for a piece with no crafted body, from its catalogue
 * category, table shape and size: a plausible body that is never silent.
 */
function templateBody(slug: string, item: Footprint | undefined): SetDownBody {
  const w = dimension(item?.width);
  const d = dimension(item?.depth);
  const h = dimension(item?.height);
  const category = item?.category ?? "other";
  const inset = Math.min(0.05, w * 0.15, d * 0.15);
  const cornerX = w / 2 - inset;
  const cornerZ = d / 2 - inset;
  const longest = Math.max(w, d);
  switch (category) {
    case "chair":
      return body(slug, "chair", 5, corners("glide", cornerX, cornerZ), BANQUET_CHAIR_PARTS, { seatPuff: true });
    case "table": {
      if (item?.tableShape === "round") {
        const radius = Math.min(w, d) / 2;
        // Standing height: a poseur on one weighted foot; otherwise a banqueting round (11.4 kg a square metre of top).
        if (h > 0.9) {
          const ring = radius * 0.72 * Math.SQRT1_2;
          return body(slug, "poseur", clamp(13 * (radius / 0.3) ** 2, 3, 40), corners("steel", ring, ring), [part("mdf-top", radius * 2, 0.025, 0.5), part("cast-base", h * 0.7, 0.03, 0.5)]);
        }
        return body(slug, "round-table", clamp(11.4 * Math.PI * radius * radius, 3, 80), corners("rubber", radius * 0.603, radius * 0.462), [part("mdf-top", radius * 2, 0.025, 0.7), folding(0.3)], { legRattle: true });
      }
      const legX = Math.max(0.01, w / 2 - Math.min(0.2, w * 0.11) + 0.035);
      const legZ = Math.max(0.01, d / 2 - 0.07);
      return body(slug, "rect-table", clamp(14.4 * w * d, 4, 80), corners("rubber", legX, legZ), [part("mdf-top", longest, 0.025, 0.7), folding(0.3)], { legRattle: true });
    }
    case "stage":
      if (h < 0.08) {
        return body(slug, "dance-floor", clamp(18 * w * d, 2, 60), corners("panel-edge", cornerX, cornerZ), [part("ply-top", longest, 0.016, 0.6), part("aluminium-frame", longest, 0.003, 0.4)]);
      }
      return body(slug, "stage", clamp(20 * w * d, 5, 90), corners("panel-edge", cornerX, cornerZ), [part("phenolic-deck", longest, 0.018, 0.75), part("aluminium-frame", Math.min(w, d), 0.003, 0.25)]);
    case "lectern":
      return body(slug, "lectern", 25, corners("panel-edge", cornerX, cornerZ), [part("cabinet-carcass", longest, 0.02, 0.7), part("ply-top", longest, 0.026, 0.3)]);
    case "av":
    case "lighting":
      if (category === "av" && longest < 0.7 && h < 0.6) {
        return body(slug, "av-small", 2, corners("rubber", w * 0.38, d * 0.35), [part("av-plastic", longest, 0.003, 1)]);
      }
      return body(slug, "av-stand", 12, corners("rubber", cornerX, cornerZ), [part("steel-tube-frame", h, 0.016, 0.8), part("av-plastic", longest, 0.006, 0.2)], { legRattle: true });
    case "barrier":
      return body(slug, "divider", clamp(5.2 * longest, 3, 60), corners("castor", Math.max(0.01, w / 2 - 0.06), Math.max(0.01, d / 2 - 0.03)), [part("steel-tube-frame", h, 0.014, 0.4), part("upholstery", longest, 0.03, 0.6)], { castorRoll: true });
    case "decor":
      return body(slug, "av-small", 0.5, corners("felt", cornerX, cornerZ), [part("av-plastic", longest, 0.003, 1)]);
    default:
      // Anything else is a cabinet, at about 70 kg a square metre of footprint.
      return body(slug, "cabinet", clamp(71 * w * d, 3, 90), corners("panel-edge", cornerX, cornerZ), [part("cabinet-carcass", longest, 0.022, 0.8), part("ply-top", longest, 0.03, 0.2)]);
  }
}

function isCrafted(slug: string): slug is CraftedFurnitureSlug {
  return Object.prototype.hasOwnProperty.call(SET_DOWN_BODIES, slug);
}

/**
 * The body to set down for a piece. A crafted slug returns its own body; any
 * other piece (an imported model, a proxy box) takes a family template from
 * its catalogue category, table shape and size, or a generic cabinet if the
 * catalogue does not know it. `scale` (a placed item's scale) scales feet and
 * lengths by itself and mass by its cube; a scale that is not a positive
 * number counts as 1, and one beyond 0.01–100 is held to that range.
 */
export function bodyFor(slug: string, scale?: number): SetDownBody {
  const s = sane(scale);
  if (isCrafted(slug)) return scaled(SET_DOWN_BODIES[slug], s);
  return scaled(templateBody(slug, getCatalogueItemBySlug(slug)), s);
}
