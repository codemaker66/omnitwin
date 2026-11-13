// ---------------------------------------------------------------------------
// The front's material: cut with the window wall, lit as the city is
//
// The front wears the section's finish (hall-section.ts SECTION_PRESETS):
// Ashlar, the building's own materials, its stone the preset's pale
// Glassford Street sandstone with white joinery, a dark front door, the
// verdigris dome on its leaded drum; Atelier, the city's card throughout;
// Nocturne, ebonised. It stands in the city's light (hall-street-light.ts
// cardLight and cardHaze): the real sun or moon through the city's own shadow
// map, the sky's light, the night look, and the haze with distance. After
// dusk the street lamps light it as they light the city's walls
// (hall-context.ts streetLampLight): a scallop under each lantern, its own
// two at the door and the council's lamp on the north pavilion among them,
// and the pools' light up its foot.
//
// The cut: every fragment above the window wall's cut (hall-exterior-cut.ts)
// is discarded, and the solids' inner faces, seen through the cut, draw flat
// in the section's colour and lit from above as the cut's top, by the sun
// with no shadow as the hall's cut is, so the front reads as masonry cut
// through, as the wall behind it does. They are a pass of their own, drawn a
// hair toward the eye (CUT_EYEWARD, CUT_EYEWARD_MAX): where two blocks touch,
// one block's face seen from inside and its neighbour's outer face lie on one
// plane, and the cut, which is what a section shows there, wins that tie every
// frame instead of the two taking turns. Normals come from the geometry's own attribute (it
// is built in world space), never normalWorld, which the section's unlit
// materials keep out of the pass's normal target (hall-section.ts).
// ---------------------------------------------------------------------------

import { BackSide, Color, FrontSide, SRGBColorSpace, type Side } from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  Discard, Fn, If, attribute, cameraProjectionMatrix, float, frontFacing, length, min, mix, normalize, positionView, positionWorld,
  select, smoothstep, vec3, vec4,
} from "three/tsl";
import { cardHaze, cardLight, nightDither, type StreetLightMaps } from "./hall-street-light.js";
import { NIGHT_WORK_BELOW, streetLampLight } from "./hall-context.js";
import { hallSkyUniforms as sky } from "./hall-sky-runtime.js";
import { hallFrontCut } from "./hall-exterior-cut.js";
import type { SectionPresetName } from "./hall-section.js";
import type { HallSun } from "./hall-sun.js";
import { FRONT_PART, LET_IN, type FrontPartName } from "./hall-exterior.js";
import { FRONT_LEVELS, FRONT_PAVEMENT_Y } from "./hall-exterior-spec.js";

type Palette = Readonly<Record<FrontPartName, string>> & { readonly cut: string };

/**
 * Each finish's colours, sRGB. Ashlar's stone is the preset's outer face
 * (#c9bca3) and its cut the preset's dressed leaf (#a8957a); the joinery is
 * white as photographed, the front door dark-stained, the dome the pale
 * verdigris of weathered copper and the drum lead grey (photographs, P).
 * Atelier is the city's card (hall-context.ts CARD), Nocturne the preset's
 * ebonised dark.
 */
export const FRONT_PALETTES: Readonly<Record<SectionPresetName, Palette>> = {
  ashlar: {
    stone: "#c9bca3", glass: "#2b3036", paint: "#eeebe4", timber: "#2c1d14", copper: "#86b09b", lead: "#6e7378", metal: "#3a342c",
    cut: "#a8957a",
  },
  atelier: {
    stone: "#dbd1c2", glass: "#b9ae9f", paint: "#e7dfd1", timber: "#c7b8a3", copper: "#d4cdbf", lead: "#cbc2b3", metal: "#bdb19f",
    cut: "#c7b8a3",
  },
  nocturne: {
    stone: "#1d1814", glass: "#0f0c0a", paint: "#2a231d", timber: "#140f0c", copper: "#26261f", lead: "#1a1714", metal: "#14110e",
    cut: "#2b241d",
  },
};

/** The ground floor's glass after dusk, its doors' fanlights and glazed doors and its shopfronts, lit from within (I). */
const DOORWAY_GLOW = 0.12;
/** The ground floor's glass stops under the string course (planner y). */
const GROUND_GLASS_TOP = FRONT_PAVEMENT_Y + FRONT_LEVELS.stringBottom;

function linear(hex: string): Node<"vec3"> {
  const colour = new Color().setStyle(hex, SRGBColorSpace);
  return vec3(colour.r, colour.g, colour.b);
}

/** The colour for a part index, as a chain of selects over FRONT_PART's order. */
function partColour(part: Node<"float">, palette: Palette): Node<"vec3"> {
  const order = Object.entries(FRONT_PART).sort((a, b) => a[1] - b[1]).map(([name]) => name as FrontPartName);
  let colour = linear(palette[order[order.length - 1] ?? "stone"]);
  for (let i = order.length - 2; i >= 0; i--) {
    const name = order[i] ?? "stone";
    colour = select(part.lessThan(i + 0.5), linear(palette[name]), colour);
  }
  return colour;
}

/**
 * How far the cut's faces are drawn toward the eye, as a share of their
 * distance from it: a quarter of a millimetre a metre, up to CUT_EYEWARD_MAX.
 * Within 10 m that is at least 40 steps of the depth buffer (near plane
 * 0.1 m), enough to win every tie with a face on the same plane. At a
 * right-angled edge, where a solid's outside and inside meet, the cut shows
 * across about a tenth of a pixel on a 900-pixel-high canvas, scaling with
 * the canvas's height (about a quarter at 2,000 pixels).
 */
export const CUT_EYEWARD = 2.5e-4;

/**
 * The most a corner of the cut is drawn toward the eye, metres: half the
 * let-in (LET_IN), and at most half the gap between any two faces of one of
 * the front's solids within 10° of looking opposite ways, except the 4 mm of
 * stone over the pavilion doorways' crowns, which keeps more than the pull
 * (hall-exterior-skin.test.ts says why that is enough). Across a face's own
 * plane no point is drawn farther; along a pixel's ray, inside a long
 * triangle seen nearly edge-on beyond 10 m, a fraction of a millimetre
 * farther. Uncapped, the share of the distance would reach a face let into
 * its holder from 20 m, and past about 48 m, face-on, the far face of the
 * thinnest glass (12 mm), drawing a solid's inside in front of its own
 * outside. The cap holds from 10 m: about ten depth steps at 20 m, five at
 * 30 m and one at 65 m, about as far as the orbit sees the cut from while
 * its target is held (CameraRig holds it for the keyboard's pan, not the
 * mouse's or two fingers', which reach the far plane, 900 m under the sky).
 * Past that a tie whose depths round equal is still the cut's: it draws
 * after the outside (HallExterior) and the depth test passes equal depths
 * (three's LessEqualDepth). From about 140 m some of the thinnest glass
 * below the cut is drawn in the cut's colour.
 */
export const CUT_EYEWARD_MAX = LET_IN / 2;

/** The front as drawn, two passes over one geometry: its outside, and its cut (each solid seen from inside). */
export interface FrontMaterials {
  readonly outside: MeshBasicNodeMaterial;
  readonly cut: MeshBasicNodeMaterial;
}

/**
 * The front as drawn: its finish, cut at the window wall's cut, in the city's
 * light and haze. `maps` are the city's street-light maps (HallContext).
 */
export function createFrontMaterials(sun: HallSun, maps: StreetLightMaps, preset: SectionPresetName): FrontMaterials {
  const outside = frontPass(sun, maps, preset, FrontSide);
  const cut = frontPass(sun, maps, preset, BackSide);
  // Each inside face is drawn as though nearer the eye by a share of its distance, at most
  // CUT_EYEWARD_MAX. A point moved straight toward the eye projects where it did, so the cut covers
  // the same pixels and is lit and coloured at its own place, but every tie with a face on its plane
  // is its own. Depth is set per vertex, never per fragment, so the depth test still turns hidden
  // faces away before they are shaded.
  const share = min(float(CUT_EYEWARD), float(CUT_EYEWARD_MAX).div(length(positionView)));
  cut.vertexNode = cameraProjectionMatrix.mul(vec4(positionView.mul(float(1).sub(share)), 1));
  cut.name = "grand-hall-front-cut";
  return { outside, cut };
}

function frontPass(sun: HallSun, maps: StreetLightMaps, preset: SectionPresetName, side: Side): MeshBasicNodeMaterial {
  const palette = FRONT_PALETTES[preset];
  const material = new MeshBasicNodeMaterial({ side, fog: false });
  material.colorNode = Fn(() => {
    const p = positionWorld;
    const part = attribute<"float">("aPart", "float");
    // A face seen from inside its solid is the cut through it: flat section colour, lit as a top.
    const outside = frontFacing;
    const n = select(outside, normalize(attribute<"vec3">("normal", "vec3")), vec3(0, 1, 0)).toVar();
    const albedo = select(outside, partColour(part, palette), linear(palette.cut)).toVar();
    // The cut takes the sun with no shadow, as the hall's own cut tops do
    // (hall-section.ts cutTopLight): its faces lie inside the uncut caster.
    const lit = albedo.mul(cardLight(n, select(outside, sun.factor, float(1)), float(0))).toVar();
    // Glass keeps a little of the sky in it by day.
    const glass = select(part.greaterThan(0.5).and(part.lessThan(1.5)).and(outside), float(1), float(0));
    lit.addAssign(mix(sky.horizonAway, sky.zenith, smoothstep(-0.2, 0.6, n.y)).mul(0.08).mul(glass).mul(float(1).sub(sky.night)));
    // After dusk the ground floor's glass, under the string course, glows from within.
    const groundFloor = float(1).sub(smoothstep(GROUND_GLASS_TOP - 0.3, GROUND_GLASS_TOP, p.y));
    lit.addAssign(vec3(1, 0.7, 0.42).mul(DOORWAY_GLOW).mul(glass).mul(sky.night).mul(groundFloor));
    // And the street lamps light its walls, never its cut (lit as a top): a
    // branch on a uniform, as the city's, so the derivatives inside stay legal.
    If(sky.sunAltitude.lessThan(NIGHT_WORK_BELOW), () => {
      const lamps = streetLampLight(maps, p, n);
      lit.addAssign(albedo.mul(lamps.onWall).mul(float(1).sub(smoothstep(0.7, 0.9, n.y))));
    });
    const haze = cardHaze(p);
    const colour = vec4(mix(lit, haze.color, haze.amount).mul(nightDither()), 1).toVar();
    // Above the window wall's cut nothing is drawn. Discarded last, once every
    // derivative above is taken: under GLSL a fragment discarded earlier leaves
    // its quad's derivatives undefined along the cut's edge.
    If(p.y.greaterThan(hallFrontCut), () => {
      Discard();
    });
    return colour;
  })();
  material.name = "grand-hall-front";
  return material;
}

/** The front's shadow stand-in: the whole building, never cut (drawn only by the sun's shadow cameras). */
export function createFrontCasterMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.colorNode = vec4(0, 0, 0, 1);
  material.name = "grand-hall-front-caster";
  return material;
}
