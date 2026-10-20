// ---------------------------------------------------------------------------
// Beyond the doors: what the cutaway shows past each open doorway
//
// When a wall is cut its doors swing open (hall-doors.ts), and each doorway
// shows a short stretch of the real space beyond it (hall-neighbours.ts),
// dissolving with distance into what lies under it: the city model's
// cut-away building under the real sky, the dark without it. Each section
// preset (hall-section.ts SECTION_PRESETS) has its own beyond:
//
//   - Ashlar, the building's own materials: the floors as photographed (the
//     Saloon's herringbone oak; the landing at the head of Stair 5 with its
//     inlaid TRADES HALL and crest; tools/grand-hall-survey/project-beyond.py),
//     the corridor and the fire stair's landing in plain colours (the plan is
//     the only evidence there), the stairwell falling away into the dark past
//     the landing's balustrade, and the start of the Saloon's mahogany dado;
//   - Atelier, an architect's card model like the city: the whole first floor's
//     walls from the 2010 plan, cut at 1.2 m in the city's card, with warm
//     light falling out of each door;
//   - Nocturne, a dark jewel box: only warm pools of light past each door.
//
// The light falling out through an open door is the room's chandelier light at
// the mood's strength, falling off with distance from the doorway and
// strongest straight out of it. It is baked into the colour (unlit materials,
// computed per fragment from the mood's uniforms), so a phone pays arithmetic,
// not more lights. Nothing moves on the CPU: each door's beyond follows its
// door's angle (DoorSwingUniforms) in the shader, appearing as the door opens
// and going as it shuts.
//
// The floors lie at BEYOND_FLOOR_Y, a centimetre above the city's caps at the
// floor's level, and are blended (no depth written, drawn after the opaque
// room), so they never fight the caps for a pixel; the balustrade and the
// dado are blended too (their presence follows the door) but write depth.
// ---------------------------------------------------------------------------

import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  ImageBitmapLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  ShapeUtils,
  Texture,
  UnsignedByteType,
  Vector2,
  type BufferGeometry,
} from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  attribute, cameraPosition, clamp, dot, exp, float, length, luminance, max, mix, normalize, positionLocal, positionWorld, pow,
  smoothstep, texture as textureNode, uniform, uv, vec2, vec3,
} from "three/tsl";
import { MeshBuilder, type V2, type V3 } from "./mesh-builder.js";
import { HALL_MOODS, type HallMoodUniforms } from "./hall-mood.js";
import { hallSkyUniforms as sky } from "./hall-sky-runtime.js";
import { HALL_PAVEMENT_Y } from "./hall-site.js";
import type { HallSun } from "./hall-sun.js";
import type { DoorSwingUniforms } from "./hall-doors.js";
import type { HallSectionUniforms } from "./hall-materials.js";
import type { HallTextures } from "./hall-textures.js";
import { HALL_DOORS } from "./hall-spec.js";
import { hallSurveyUrl } from "./hall-photos.js";
import {
  BEYOND_FLOOR_Y,
  BEYOND_SPACES,
  LANDING_BALUSTRADE,
  SALOON_DADO,
  doorwayFace,
  type BeyondFinish,
  type DoorwayFace,
  type FirstFloorPlan,
  type PlanPoint,
} from "./hall-neighbours.js";

// ---------------------------------------------------------------------------
// The doors, in HALL_DOORS order
// ---------------------------------------------------------------------------

/** Each door's outer face (HALL_DOORS order), which the beyond's fade and light are measured from. */
export const BEYOND_DOORWAYS: readonly DoorwayFace[] = HALL_DOORS.map((door) => doorwayFace(door.opening));

/** Each door's reach (HALL_DOORS order): how far its beyond is drawn. */
export const BEYOND_REACH: readonly number[] = HALL_DOORS.map((door) => BEYOND_SPACES.find((space) => space.opening === door.opening)?.reach ?? 2.4);

/**
 * A door's beyond is wholly there within BEYOND_FADE_START of its reach from
 * the doorway's middle, and gone by BEYOND_FADE_END of it: its floor was
 * measured within the reach of the same point (beyond-doors.py), so wherever
 * the floor ends at its reach it has already dissolved, and only real walls
 * give it an edge.
 */
export const BEYOND_FADE_START = 0.3;
export const BEYOND_FADE_END = 0.96;

/** The fade the shader draws `distance` metres from a doorway's middle whose beyond reaches `reach`: 1 near, 0 by the reach. */
export function beyondFade(distance: number, reach: number): number {
  const t = Math.max(0, Math.min(1, (distance - BEYOND_FADE_START * reach) / ((BEYOND_FADE_END - BEYOND_FADE_START) * reach)));
  return 1 - t * t * (3 - 2 * t);
}

/** How much of a door's beyond shows at its swing (radians): none shut, all once it stands nearly open. */
export function beyondPresence(angle: number): number {
  const t = Math.max(0, Math.min(1, (angle / (Math.PI / 2) - 0.05) / 0.85));
  return t * t * (3 - 2 * t);
}

function select4(index: Node<"float">, values: readonly Node<"float">[]): Node<"float"> {
  const [a, b, c, d] = values;
  if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error("The hall has four doors");
  return index.lessThan(0.5).select(a, index.lessThan(1.5).select(b, index.lessThan(2.5).select(c, d)));
}

function perDoor(index: Node<"float">, values: readonly number[]): Node<"float"> {
  return select4(index, values.map((value) => float(value)));
}

/** A fragment's distance in plan from door `index`'s outer face, and the cosine of its bearing from straight out of it. */
function doorwayGeometry(index: Node<"float">, p: Node<"vec2">): { distance: Node<"float">; facing: Node<"float"> } {
  const ax = perDoor(index, BEYOND_DOORWAYS.map((face) => face.a[0]));
  const az = perDoor(index, BEYOND_DOORWAYS.map((face) => face.a[1]));
  const bx = perDoor(index, BEYOND_DOORWAYS.map((face) => face.b[0]));
  const bz = perDoor(index, BEYOND_DOORWAYS.map((face) => face.b[1]));
  const ox = perDoor(index, BEYOND_DOORWAYS.map((face) => face.outward[0]));
  const oz = perDoor(index, BEYOND_DOORWAYS.map((face) => face.outward[1]));
  const ab = vec2(bx.sub(ax), bz.sub(az));
  const ap = vec2(p.x.sub(ax), p.y.sub(az));
  const t = clamp(dot(ap, ab).div(dot(ab, ab)), 0, 1);
  const distance = length(ap.sub(ab.mul(t)));
  const centre = vec2(ax.add(bx).mul(0.5), az.add(bz).mul(0.5));
  const facing = dot(normalize(p.sub(centre).add(vec2(1e-5, 0))), vec2(ox, oz));
  return { distance, facing };
}

/** A fragment's place relative to door `index`'s outer face: along its outward normal from its middle, and across it. */
function doorwayLocal(index: Node<"float">, p: Node<"vec2">): { along: Node<"float">; across: Node<"float"> } {
  const cx = perDoor(index, BEYOND_DOORWAYS.map((face) => face.centre[0]));
  const cz = perDoor(index, BEYOND_DOORWAYS.map((face) => face.centre[1]));
  const ox = perDoor(index, BEYOND_DOORWAYS.map((face) => face.outward[0]));
  const oz = perDoor(index, BEYOND_DOORWAYS.map((face) => face.outward[1]));
  const d = vec2(p.x.sub(cx), p.y.sub(cz));
  return { along: dot(d, vec2(ox, oz)), across: dot(d, vec2(oz.negate(), ox)).abs() };
}

/** Door `index`'s open share (0 shut, 1 at 90 degrees), from its swing's uniforms. */
function doorOpen(index: Node<"float">, swing: DoorSwingUniforms): Node<"float"> {
  return clamp(select4(index, swing.angles).div(Math.PI / 2), 0, 1);
}

/** beyondPresence, in the shader. */
function presenceNode(open: Node<"float">): Node<"float"> {
  return smoothstep(0.05, 0.9, open);
}

/** beyondFade, in the shader. */
function fadeNode(distance: Node<"float">, reach: Node<"float">): Node<"float"> {
  return float(1).sub(smoothstep(reach.mul(BEYOND_FADE_START), reach.mul(BEYOND_FADE_END), distance));
}

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

/**
 * The spaces beyond are lit, like the hall, by the mood: its ambient, a small
 * share of its chandeliers' light (their own lamps are a corridor's and a
 * landing's, not a ballroom's) and of its daylight (their windows and the
 * landing's rooflight, which the scan's light held too), so at night they lie
 * darker than the hall, warm only where its light falls out of the doors. Their photographs are relit by the ratio
 * of this light to the same under the scan's own (the Daylight mood), as the
 * hall's photographs are (hall-materials.ts relitPhoto).
 */
export const BEYOND_CHANNELS = { chandelier: 0.15, daylight: 0.35 } as const;

/**
 * The light falling out through an open door: the room's chandelier colour at
 * the mood's strength times SPILL.strength at the doorway, falling off over
 * SPILL.reach metres, and from straight out of the door to its sides by
 * SPILL.side.
 */
export const SPILL = { strength: 0.5, reach: 0.9, side: 0.45 } as const;

/** The spill's share at `distance` metres from a doorway, `facing` the cosine from straight out (the shader's rule). */
export function spillShare(distance: number, facing: number): number {
  return Math.exp(-distance / SPILL.reach) * ((1 - SPILL.side) + SPILL.side * Math.max(0, facing));
}

const linear = (hex: string): Node<"vec3"> => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** An sRGB colour stated 0-255, in linear light. */
function srgb255(rgb: readonly [number, number, number]): Node<"vec3"> {
  return vec3(srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255));
}

/** The beyond's light under the current mood (the hall's baked channels' units). */
export function beyondLight(mood: HallMoodUniforms): Node<"vec3"> {
  return mood.ambient.rgb.mul(mood.ambientIntensity)
    .add(mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(BEYOND_CHANNELS.chandelier))
    .add(mood.daylight.rgb.mul(mood.daylightIntensity).mul(BEYOND_CHANNELS.daylight));
}

/** The same under the scan's light (the Daylight mood, fixed). */
export function beyondScanLight(): Node<"vec3"> {
  const scan = HALL_MOODS.daylight;
  return linear(scan.ambient).mul(scan.ambientIntensity)
    .add(linear(scan.chandelier).mul(scan.chandelierIntensity * BEYOND_CHANNELS.chandelier))
    .add(linear(scan.daylight).mul(scan.daylightIntensity * BEYOND_CHANNELS.daylight));
}

/** The spill's irradiance at `distance` from a doorway, `facing` the cosine from straight out, for a door `open`. */
function spillLight(mood: HallMoodUniforms, distance: Node<"float">, facing: Node<"float">, open: Node<"float">): Node<"vec3"> {
  const fall = exp(distance.div(-SPILL.reach));
  const lobe = mix(float(1 - SPILL.side), float(1), max(facing, float(0)));
  return mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(SPILL.strength).mul(fall).mul(lobe).mul(open);
}

/**
 * A photographed colour relit for the mood with `extra` light added: (light +
 * extra + k) / (scan light + k), as hall-materials.ts relitPhoto (exactly the
 * photograph in the scan's own light, finite where both are dark).
 */
export function relitBeyond(colour: Node<"vec3">, mood: HallMoodUniforms, extra: Node<"vec3">): Node<"vec3"> {
  const k = float(0.06);
  return colour.mul(beyondLight(mood).add(extra).add(k).div(beyondScanLight().add(k)));
}

/** The painted mahogany's mean luminance (hsl(12, 55%, 17%), linear), against which its grain is read. */
const MAHOGANY_LUMINANCE = 0.025;

/** The painted mahogany's grain as a brightness about 1 (0.6-1.5), at `coordinates`. */
export function mahoganyGrain(textures: HallTextures, coordinates: Node<"vec2">): Node<"float"> {
  return luminance(textureNode(textures.mahoganyDark, coordinates).rgb).div(MAHOGANY_LUMINANCE).clamp(0.6, 1.5);
}

/**
 * The city model's white card (hall-context.ts CARD, private to that file and
 * not to be edited from this lane; copied here, sRGB, for the Atelier section,
 * so the card it adds is the city's card).
 */
export const CARD = {
  cap: [0.93, 0.9, 0.85],
  wall: [0.86, 0.82, 0.76],
  section: [0.78, 0.72, 0.64],
} as const satisfies Readonly<Record<string, readonly [number, number, number]>>;

/** A card colour (sRGB 0-1, as the city states it) in linear light. */
export function cardColour(rgb: readonly [number, number, number]): Node<"vec3"> {
  return vec3(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]));
}

/**
 * Card lit as the city lights it (a copy of hall-context.ts cityColor's light):
 * the sun or the moon through the shadow map, the sky's light from above, the
 * sun's warmth bounced up onto upright faces, upright faces a little darker
 * at their foot (`upright` 1 for a wall, 0 for a cap), and the air between
 * the eye and it. Without the real sky (no sun) the room's mood lights it, as
 * it lights the hall's section. `shadowed` false leaves the map out, for the
 * hall's cut walls: their tops lie inside the walls' full-height casters
 * (hall-sun.ts), and the map's node reads normalWorld for its normal offset,
 * which in an unlit material put the pass's normal target out of step (the
 * occlusion went black in speckles on the cut's tops). They take the sun as a
 * model standing in the light does, as Ashlar's cut does (cutTopLight).
 */
export function cardLit(
  albedo: Node<"vec3">, normal: Node<"vec3">, sun: HallSun | null, mood: HallMoodUniforms, upright: Node<"float">, shadowed = true,
): Node<"vec3"> {
  if (sun === null) {
    const ambient = mood.ambient.rgb.mul(mood.ambientIntensity).add(mood.skyHorizon.rgb.mul(mood.skyIntensity).mul(0.5));
    return albedo.mul(ambient).mul(mix(float(0.78), float(1), normal.y.mul(0.5).add(0.5)));
  }
  const p = positionWorld;
  const facing = max(dot(normal, sky.lightDirection), 0);
  const daylight = sky.sunColor.mul(sky.sunStrength).mul(1.1);
  const moonlight = sky.moonColor.mul(sky.moonStrength).mul(1.6);
  const direct = shadowed ? daylight.add(moonlight).mul(facing).mul(sun.factor) : daylight.add(moonlight).mul(facing);
  const skyLight = mix(sky.horizonAway, sky.zenith, 0.45);
  const bounce = vec3(0.6, 0.46, 0.33).mul(sky.sunStrength).mul(0.5);
  const ambient = mix(bounce.add(skyLight.mul(0.5)), skyLight.mul(0.95), normal.y.mul(0.5).add(0.5));
  const foot = mix(float(1), smoothstep(0.0, 9.0, p.y.sub(HALL_PAVEMENT_Y)).mul(0.28).add(0.72), upright);
  const lit = albedo.mul(direct.add(ambient)).mul(foot);
  const toCamera = normalize(cameraPosition.sub(p));
  const view = toCamera.negate();
  const distance = length(p.sub(cameraPosition));
  const lowSun = smoothstep(0.42, 0.0, sky.sunDirection.y);
  const reach = mix(float(230), float(100), lowSun);
  const air = float(1).sub(exp(max(distance.sub(16), 0).div(reach.negate()))).mul(0.88);
  const flatSun = normalize(vec3(sky.sunDirection.x, 0, sky.sunDirection.z).add(vec3(1e-4, 0, 0)));
  const flatView = normalize(vec3(view.x, 0, view.z).add(vec3(1e-4, 0, 0)));
  const horizon = mix(sky.horizonAway, sky.horizonSun, pow(clamp(dot(flatSun, flatView).mul(0.5).add(0.5), 0, 1), 2.2));
  const toward = pow(max(dot(view, sky.sunDirection), 0), 6);
  const hazeColour = horizon.mul(0.94).add(sky.glow.mul(sky.glowStrength).mul(toward).mul(0.6));
  return mix(lit, hazeColour, air);
}

// ---------------------------------------------------------------------------
// The photographs (Ashlar)
// ---------------------------------------------------------------------------

/** One surface of the beyond's atlas (tools/grand-hall-survey/beyond-atlas.json). */
export interface BeyondAtlasSurface {
  /** Its texels in the full-size atlas: left, top, width, height. */
  readonly rect: readonly [number, number, number, number];
  /** Its median colour as photographed (sRGB 0-255), drawn until the image arrives, or if it fails. */
  readonly median: readonly [number, number, number];
}

export interface BeyondFloorMap extends BeyondAtlasSurface {
  /** Planner x and z at the corner of the rect's top-left texel; columns run with x, rows with z. */
  readonly x0: number;
  readonly z0: number;
  /** Texels a metre. */
  readonly ppm: number;
}

export interface BeyondLiningMap extends BeyondAtlasSurface {
  readonly opening: string;
  /**
   * The doorway along its wall (u0, u1, hall-spec.ts), its head and depth: the
   * lining unrolled, columns its depth behind the hall's face, rows the jamb at
   * u0 from the floor up, the head from u0 to u1, the jamb at u1 from the head down.
   */
  readonly u0: number;
  readonly u1: number;
  readonly head: number;
  readonly depth: number;
  readonly ppm: number;
}

/**
 * The atlas the survey build published (project-beyond.py; its record,
 * tools/grand-hall-survey/beyond-atlas.json, holds the same numbers and the
 * tests hold them to it): 832 x 640 on desktops, 416 x 320 on phones.
 */
export const BEYOND_ATLAS = {
  size: [832, 640],
  files: { full: "beyond-832.webp", half: "beyond-416.webp" },
  saloonFloor: { rect: [0, 0, 453, 288], median: [167, 141, 109], x0: 7.45, z0: 6.435, ppm: 120 },
  landingFloor: { rect: [0, 296, 576, 221], median: [188, 193, 195], x0: -2.394, z0: 6.385, ppm: 120 },
  linings: [
    { opening: "door-end", rect: [588, 0, 114, 581], median: [42, 20, 8], u0: 1.1975, u1: 2.2975, head: 2.35, depth: 1.14, ppm: 100 },
    { opening: "door-main", rect: [708, 0, 110, 615], median: [42, 22, 14], u0: 9.8375, u1: 11.2875, head: 2.35, depth: 1.09, ppm: 100 },
  ],
} as const satisfies {
  readonly size: readonly [number, number];
  readonly files: { readonly full: string; readonly half: string };
  readonly saloonFloor: BeyondFloorMap;
  readonly landingFloor: BeyondFloorMap;
  readonly linings: readonly BeyondLiningMap[];
};

/** The atlas's file for a device: full size on desktops, half on phones (hall-finish.ts photoQuality). */
export function beyondAtlasUrl(quality: number): string {
  return hallSurveyUrl(quality >= 0.75 ? BEYOND_ATLAS.files.full : BEYOND_ATLAS.files.half);
}

/** Texture coordinates in the atlas (flipped in the decode, as hall-photos.ts) of texel position (column, row). */
export function atlasCoordinates(column: number, row: number): readonly [number, number] {
  return [column / BEYOND_ATLAS.size[0], 1 - row / BEYOND_ATLAS.size[1]];
}

/** How long the photographs take to cross-fade in once they arrive, seconds (at once under reduced motion). */
export const BEYOND_PHOTO_FADE = 0.2;

function placeholder(): DataTexture {
  const created = new DataTexture(new Uint8Array([128, 112, 96, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  created.colorSpace = SRGBColorSpace;
  // Nearest-filtered data textures bind without a sampler on WebGPU (hall-photos.ts).
  created.magFilter = LinearFilter;
  created.minFilter = LinearFilter;
  created.needsUpdate = true;
  return created;
}

/** A sampling node of the atlas (typed as hall-photos.ts types its own). */
function atlasNode(image: Texture, coordinates: Parameters<typeof textureNode>[1]) {
  return textureNode(image, coordinates);
}

type BeyondSampleNode = ReturnType<typeof atlasNode>;

/**
 * The beyond's photographs, loaded the first time a door opens (no one pays
 * for them otherwise) and cross-faded in over BEYOND_PHOTO_FADE from the
 * surfaces' median colours; a failed image leaves those colours. The atlas is
 * decoded off the main thread and flipped in the decode, as the hall's
 * photographs are (hall-photos.ts).
 */
export class HallBeyondPhotos {
  /** The cross-fade, 0 (the medians) to 1 (the photographs). */
  readonly mix = uniform(0);
  private readonly placeholder: Texture = placeholder();
  private image: Texture = this.placeholder;
  private readonly nodes: BeyondSampleNode[] = [];
  private bitmap: ImageBitmap | null = null;
  private state: "idle" | "loading" | "loaded" | "failed" = "idle";
  private disposed = false;

  /** A sampling node at `coordinates`, swapped to the photograph when it arrives. */
  sample(coordinates: Parameters<typeof textureNode>[1]): BeyondSampleNode {
    const node = atlasNode(this.image, coordinates);
    this.nodes.push(node);
    return node;
  }

  get status(): "idle" | "loading" | "loaded" | "failed" {
    return this.state;
  }

  /** Starts the load, once; `onSettled` runs when it arrives or fails. */
  load(quality: number, onSettled: (loaded: boolean) => void): void {
    if (this.state !== "idle" || this.disposed) return;
    this.state = "loading";
    const loader = new ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
    loader.load(beyondAtlasUrl(quality), (bitmap) => {
      if (this.disposed) { bitmap.close(); return; }
      this.bitmap = bitmap;
      const image = new Texture(bitmap);
      image.flipY = false;
      image.colorSpace = SRGBColorSpace;
      image.wrapS = ClampToEdgeWrapping;
      image.wrapT = ClampToEdgeWrapping;
      image.magFilter = LinearFilter;
      image.minFilter = LinearMipmapLinearFilter;
      image.generateMipmaps = true;
      image.anisotropy = 8;
      image.needsUpdate = true;
      this.image = image;
      for (const node of this.nodes) node.value = image;
      this.state = "loaded";
      onSettled(true);
    }, undefined, () => {
      if (this.disposed) return;
      this.state = "failed";
      onSettled(false);
    });
  }

  /**
   * Advances the cross-fade by `delta` seconds once the photograph is in, at
   * once under reduced motion. Returns whether it is still fading.
   */
  step(delta: number, reducedMotion: () => boolean): boolean {
    if (this.state !== "loaded" || this.mix.value >= 1) return false;
    const next = reducedMotion() ? 1 : Math.min(1, this.mix.value + Math.max(0, delta) / BEYOND_PHOTO_FADE);
    this.mix.value = next;
    return next < 1;
  }

  dispose(): void {
    this.disposed = true;
    this.placeholder.dispose();
    if (this.image !== this.placeholder) this.image.dispose();
    this.bitmap?.close();
    this.bitmap = null;
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** What a beyond floor's fragment draws (aBeyond.y). */
export const BEYOND_SURFACE: Readonly<Record<BeyondFinish | "well", number>> = {
  "saloon-oak": 0,
  "landing-stone": 1,
  corridor: 2,
  "stair-landing": 3,
  well: 4,
};

const UP: V3 = [0, 1, 0];

/** A builder whose vertices carry aBeyond (door index in HALL_DOORS, and a code). */
function taggedBuilder(tag: { door: number; code: number }): MeshBuilder {
  return new MeshBuilder({ extraSize: 2, extraName: "aBeyond", extra: () => [tag.door, tag.code] });
}

/** A plan polygon (with holes) triangulated, faced up, at height `y`. */
function addPlanPolygon(builder: MeshBuilder, outline: readonly PlanPoint[], holes: readonly (readonly PlanPoint[])[], y: number, facing: V3 = UP): number {
  // ShapeUtils wants the contour counter-clockwise and the holes clockwise in
  // its own plane; (x, -z) is the plan seen from above.
  const contour = outline.map(([x, z]) => new Vector2(x, -z));
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  const holeRings = holes.map((hole) => {
    const ringPoints = hole.map(([x, z]) => new Vector2(x, -z));
    if (!ShapeUtils.isClockWise(ringPoints)) ringPoints.reverse();
    return ringPoints;
  });
  const triangles = ShapeUtils.triangulateShape(contour, holeRings);
  const points = [...contour, ...holeRings.flat()];
  const ids = points.map((p) => builder.vertex([p.x, y, -p.y], facing, [p.x, -p.y]));
  let count = 0;
  for (const [i, j, k] of triangles) {
    const a = ids[i ?? -1];
    const b = ids[j ?? -1];
    const c = ids[k ?? -1];
    const pa = points[i ?? -1];
    const pb = points[j ?? -1];
    const pc = points[k ?? -1];
    if (a === undefined || b === undefined || c === undefined || pa === undefined || pb === undefined || pc === undefined) continue;
    const turn = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (Math.abs(turn) < 1e-12) continue;
    // Counter-clockwise in (x, -z) faces up.
    const up = facing[1] >= 0;
    if ((turn > 0) === up) builder.triangle(a, b, c);
    else builder.triangle(a, c, b);
    count += 1;
  }
  return count;
}

/** The four doors' floors and the main door's stairwell (Ashlar), at BEYOND_FLOOR_Y. */
export function buildBeyondFloors(): BufferGeometry {
  const tag = { door: 0, code: 0 };
  const builder = taggedBuilder(tag);
  for (const space of BEYOND_SPACES) {
    tag.door = HALL_DOORS.findIndex((door) => door.opening === space.opening);
    tag.code = BEYOND_SURFACE[space.finish];
    addPlanPolygon(builder, space.floor, [], BEYOND_FLOOR_Y);
    if (space.well !== null) {
      tag.code = BEYOND_SURFACE.well;
      addPlanPolygon(builder, space.well, [], BEYOND_FLOOR_Y);
    }
  }
  const geometry = builder.build();
  geometry.name = "grand-hall-beyond-floors";
  return geometry;
}

/** A box's faces (no bottom, and none on the sides `skip` names), its uv metres across each face. */
function boxFaces(builder: MeshBuilder, min: V3, max: V3, skip: readonly ("+x" | "-x" | "+z" | "-z")[] = []): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const quad = (a: V3, b: V3, c: V3, d: V3, facing: V3, uvs: readonly [V2, V2, V2, V2]): void => {
    builder.quadFacing(a, b, c, d, uvs[0], uvs[1], uvs[2], uvs[3], facing);
  };
  quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], UP, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  if (!skip.includes("+x")) quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  if (!skip.includes("-x")) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  if (!skip.includes("+z")) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  if (!skip.includes("-z")) quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

/**
 * A turned baluster's profile (radius, height), from the scan's 6.7 cm at its
 * widest: a plain foot, a vase swelling low, a slender neck and a block under
 * the rail. The rail's underside meets its top.
 */
function balusterProfile(top: number, width: number): V2[] {
  const r = width / 2;
  return [[r * 0.82, 0], [r * 0.82, 0.07], [r * 0.6, 0.1], [r, 0.24], [r * 0.5, 0.48], [r * 0.42, 0.58], [r * 0.7, top - 0.05], [r * 0.7, top]];
}

/** Segments round a turned baluster or finial. */
const TURNED_SEGMENTS = 6;

/**
 * The beyond's solid joinery (Ashlar): the landing's balustrade over the
 * stairwell (its two newels with their caps and finials, the moulded rail,
 * the curb along the landing's edge and the turned balusters, at the scan's
 * positions, under 1.5k triangles) and the start of the Saloon's mahogany
 * dado beside the end door, standing its measured 3.9 cm proud of the wall's
 * outer face (whose own face is never doubled: the dado has no back).
 */
export function buildBeyondSolids(): BufferGeometry {
  const tag = { door: HALL_DOORS.findIndex((door) => door.opening === "door-main"), code: 0 };
  const builder = taggedBuilder(tag);
  const b = LANDING_BALUSTRADE;
  const railBottom = b.railTop - 0.07;
  const railZ0 = b.railZ[0];
  const railZ1 = b.railZ[1];
  const railMid = (railZ0 + railZ1) / 2;
  // Each newel: a plinth at the scan's footprint to 0.25 m, the post 0.26 m square to its cap at
  // 0.98 m, the cap 0.32 m square and 6 cm deep, a turned finial to the scan's top.
  const post = 0.13;
  for (const newel of b.newels) {
    const cx = (newel.x[0] + newel.x[1]) / 2;
    const cz = (newel.z[0] + newel.z[1]) / 2;
    boxFaces(builder, [newel.x[0], 0, newel.z[0]], [newel.x[1], 0.25, newel.z[1]]);
    boxFaces(builder, [cx - post, 0.25, cz - post], [cx + post, 0.98, cz + post]);
    boxFaces(builder, [cx - 0.16, 0.98, cz - 0.16], [cx + 0.16, 1.04, cz + 0.16]);
    builder.lathe([cx, 1.04, cz], [[0.06, 0], [0.075, 0.05], [0.04, 0.09], [0.055, 0.13], [0, newel.top - 1.04]], TURNED_SEGMENTS);
  }
  // The rail and the curb run between the posts' faces.
  const left = (b.newels[0].x[0] + b.newels[0].x[1]) / 2 + post;
  const right = (b.newels[1].x[0] + b.newels[1].x[1]) / 2 - post;
  // The rail: a moulded section 10.5 cm deep, its top rounded, swept between the newels.
  const section: V2[] = [
    [railZ0 + 0.012, railBottom], [railZ0, railBottom + 0.02], [railZ0 + 0.006, b.railTop - 0.02], [railZ0 + 0.025, b.railTop - 0.004],
    [railMid, b.railTop], [railZ1 - 0.025, b.railTop - 0.004], [railZ1 - 0.006, b.railTop - 0.02], [railZ1, railBottom + 0.02], [railZ1 - 0.012, railBottom],
  ];
  for (let i = 0; i < section.length; i++) {
    const p = section[i];
    const q = section[(i + 1) % section.length];
    if (p === undefined || q === undefined) continue;
    const dz = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dz, dy);
    // Outward from the section's centre: (dy, -dz) for a clockwise run in (z, y).
    const normal: V3 = [0, -dz / l, dy / l];
    builder.quadFacing([left, p[1], p[0]], [right, p[1], p[0]], [right, q[1], q[0]], [left, q[1], q[0]], [left, p[1]], [right, p[1]], [right, q[1]], [left, q[1]], normal);
  }
  // The curb the balusters stand on, along the landing's edge.
  boxFaces(builder, [left, 0, railZ0 + 0.005], [right, 0.06, railZ1 - 0.005], ["+x", "-x"]);
  const { first, last, count, width, z } = b.balusters;
  for (let i = 0; i < count; i++) {
    const x = first + ((last - first) * i) / (count - 1);
    builder.lathe([x, 0.06, z], balusterProfile(railBottom - 0.06, width), TURNED_SEGMENTS);
  }
  // The Saloon's dado beside the end door: panelling 3.9 cm proud of the door wall's outer face,
  // a cap rail 2 cm prouder along its top.
  tag.door = HALL_DOORS.findIndex((door) => door.opening === "door-end");
  const face = BEYOND_DOORWAYS[tag.door];
  const wallZ = face === undefined ? 6.435 : face.a[1];
  boxFaces(builder, [SALOON_DADO.from, 0, wallZ], [SALOON_DADO.to, SALOON_DADO.top - 0.05, wallZ + SALOON_DADO.proud], ["-z"]);
  boxFaces(builder, [SALOON_DADO.from - 0.01, SALOON_DADO.top - 0.05, wallZ], [SALOON_DADO.to + 0.01, SALOON_DADO.top, wallZ + SALOON_DADO.proud + 0.02], ["-z"]);
  const geometry = builder.build();
  geometry.name = "grand-hall-beyond-solids";
  return geometry;
}

/**
 * Pools of light past each door (Atelier and Nocturne): a quad from the
 * doorway's outer face out POOL.reach metres and POOL.width across, the pool
 * drawn in it by the shader, a little above the floors.
 */
export const POOL = { reach: 1.8, width: 2.2, y: 0.02, radius: 0.95, centre: 0.55 } as const;

export function buildBeyondPools(): BufferGeometry {
  const tag = { door: 0, code: 0 };
  const builder = taggedBuilder(tag);
  BEYOND_DOORWAYS.forEach((face, index) => {
    tag.door = index;
    const along: PlanPoint = [face.b[0] - face.a[0], face.b[1] - face.a[1]];
    const l = Math.hypot(along[0], along[1]);
    const t: PlanPoint = [along[0] / l, along[1] / l];
    const half = POOL.width / 2;
    const c = face.centre;
    const corner = (s: number, o: number): V3 => [c[0] + t[0] * s + face.outward[0] * o, POOL.y, c[1] + t[1] * s + face.outward[1] * o];
    const p0 = corner(-half, 0);
    const p1 = corner(half, 0);
    const p2 = corner(half, POOL.reach);
    const p3 = corner(-half, POOL.reach);
    builder.quadFacing(p0, p1, p2, p3, [0, 0], [1, 0], [1, 1], [0, 1], UP);
  });
  const geometry = builder.build();
  geometry.name = "grand-hall-beyond-pools";
  return geometry;
}

/** The first floor's walls are cut at this height (Atelier), metres. */
export const CARD_WALL_HEIGHT = 1.2;

/** aBeyond.y on the first floor's card: a wall's side, its cut top, the floor. */
export const CARD_PART = { side: 0, top: 1, floor: 2 } as const;

/**
 * The whole first floor in card (Atelier), from the 2010 plan: every wall
 * extruded to CARD_WALL_HEIGHT (its sides, and its top, the cut), and, where
 * nothing else gives a floor (without the real sky the city's caps are not
 * drawn), the floor between them at BEYOND_FLOOR_Y. The published plan never
 * reaches the hall's bodies or its plinth ring (measure/first-floor.py cuts
 * them away), so nothing here meets the hall in a shared plane.
 */
export function buildFirstFloorCard(plan: FirstFloorPlan, withFloor: boolean): BufferGeometry {
  const tag: { door: number; code: number } = { door: -1, code: CARD_PART.side };
  const builder = taggedBuilder(tag);
  for (const wall of plan.walls) {
    tag.code = CARD_PART.top;
    addPlanPolygon(builder, wall.outline, wall.holes, CARD_WALL_HEIGHT);
    tag.code = CARD_PART.side;
    for (const ringPoints of [wall.outline, ...wall.holes]) {
      // Each side faces away from the polygon's inside: outward round its outline, inward round a hole.
      const area = ringPoints.reduce((sum, p, i) => {
        const q = ringPoints[(i + 1) % ringPoints.length];
        return q === undefined ? sum : sum + p[0] * q[1] - q[0] * p[1];
      }, 0);
      const isHole = ringPoints !== wall.outline;
      for (let i = 0; i < ringPoints.length; i++) {
        const p = ringPoints[i];
        const q = ringPoints[(i + 1) % ringPoints.length];
        if (p === undefined || q === undefined) continue;
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        // In (x, z) a counter-clockwise ring (positive area) has its outside to the right of each edge: (dz, -dx).
        const sense = (area > 0 ? 1 : -1) * (isHole ? -1 : 1);
        const out: V3 = [(sense * dz) / l, 0, (-sense * dx) / l];
        builder.quadFacing([p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], CARD_WALL_HEIGHT, q[1]], [p[0], CARD_WALL_HEIGHT, p[1]], [0, 0], [l, 0], [l, CARD_WALL_HEIGHT], [0, CARD_WALL_HEIGHT], out);
      }
    }
  }
  if (withFloor) {
    tag.code = CARD_PART.floor;
    for (const floor of plan.floor) addPlanPolygon(builder, floor.outline, floor.holes, BEYOND_FLOOR_Y);
  }
  const geometry = builder.build();
  geometry.name = "grand-hall-first-floor-card";
  return geometry;
}

/** A geometry's triangle count. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index === null ? geometry.getAttribute("position").count : index.count) / 3;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface BeyondMaterialContext {
  readonly mood: HallMoodUniforms;
  readonly swing: DoorSwingUniforms;
  readonly section: HallSectionUniforms;
  /** The real sun and moon (under the real sky), or null. */
  readonly sun: HallSun | null;
}

/**
 * A face's normal in the world, from its geometry (the beyond's meshes are
 * drawn where they are built, untransformed). Not normalWorld: in an unlit
 * material it put the pass's normal target, and with it the ambient
 * occlusion, out of step (hall-section.ts bodyNormal).
 */
export const geometryNormal = (): Node<"vec3"> => attribute("normal", "vec3");

/** Collapses a vertex far below the floor, so its faces have no area (as hall-section.ts does). */
const COLLAPSED = vec3(0, -50, 0);

/** The ceiling's cut (HallSectionUniforms' fifth): above 50 m on a walk, when the room is whole and nothing beyond is seen. */
function onWalk(section: HallSectionUniforms): Node<"bool"> {
  return section.cuts[4].greaterThan(50);
}

/** A floor surface's photograph coordinates: planner (x, z) to its rect in the atlas. */
function floorCoordinates(map: BeyondFloorMap, p: Node<"vec2">): Node<"vec2"> {
  const column = p.x.sub(map.x0).mul(map.ppm).clamp(0.5, map.rect[2] - 0.5).add(map.rect[0]);
  const row = p.y.sub(map.z0).mul(map.ppm).clamp(0.5, map.rect[3] - 0.5).add(map.rect[1]);
  return vec2(column.div(BEYOND_ATLAS.size[0]), float(1).sub(row.div(BEYOND_ATLAS.size[1])));
}

/**
 * Plain floors where the plan is the only evidence (art direction, said so):
 * the F.16 corridor's east lobby in the landing's photographed stone (the same
 * corridor, 8 m along); Stair 7's landing a dark stone; the stairwell's edge
 * the landing's mahogany shadow, going to black.
 */
const PLAIN = {
  corridor: BEYOND_ATLAS.landingFloor.median,
  stairLanding: [62, 57, 52],
  wellEdge: [34, 22, 16],
} as const satisfies Readonly<Record<string, readonly [number, number, number]>>;

/** Where the stairwell's edge lies (the landing's, at its balustrade), planner z. */
const WELL_EDGE_Z = LANDING_BALUSTRADE.railZ[0];

/**
 * The Ashlar floors: photographed (relit for the mood) or plain, the spill of
 * the room's light from each open door, faded out over the reach and shown
 * as the door opens. Blended, no depth written.
 */
export function createBeyondFloorMaterial(context: BeyondMaterialContext, photos: HallBeyondPhotos): MeshBasicNodeMaterial {
  const { mood, swing, section } = context;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const tag = attribute("aBeyond", "vec2");
  const door = tag.x;
  const code = tag.y;
  const p = vec2(positionWorld.x, positionWorld.z);
  const { distance, facing } = doorwayGeometry(door, p);
  const open = doorOpen(door, swing);
  const reach = perDoor(door, BEYOND_REACH);
  const isCode = (value: number): Node<"bool"> => code.greaterThan(value - 0.5).and(code.lessThan(value + 0.5));
  const saloon = photos.sample(floorCoordinates(BEYOND_ATLAS.saloonFloor, p)).rgb;
  const landing = photos.sample(floorCoordinates(BEYOND_ATLAS.landingFloor, p)).rgb;
  const photographed = isCode(BEYOND_SURFACE["saloon-oak"]).select(
    mix(srgb255(BEYOND_ATLAS.saloonFloor.median), saloon, photos.mix),
    mix(srgb255(BEYOND_ATLAS.landingFloor.median), landing, photos.mix),
  );
  const intoWell = max(positionWorld.z.sub(WELL_EDGE_Z), float(0));
  const well = mix(srgb255(PLAIN.wellEdge), vec3(0, 0, 0), smoothstep(0.0, 0.55, intoWell));
  const colour = code.lessThan(1.5).select(photographed,
    isCode(BEYOND_SURFACE.corridor).select(srgb255(PLAIN.corridor),
      isCode(BEYOND_SURFACE["stair-landing"]).select(srgb255(PLAIN.stairLanding), well)));
  // The stairwell takes none of the room's spill below its edge: the light falls past it.
  const spill = spillLight(mood, distance, facing, open).mul(isCode(BEYOND_SURFACE.well).select(float(0.25), float(1)));
  material.colorNode = relitBeyond(colour, mood, spill);
  const { along, across } = doorwayLocal(door, p);
  material.opacityNode = fadeNode(length(vec2(along, across)), reach).mul(presenceNode(open));
  material.positionNode = onWalk(section).select(COLLAPSED, positionLocal);
  material.name = "grand-hall-beyond-floors";
  return material;
}

/**
 * The Ashlar joinery beyond (the balustrade, the Saloon's dado): the room's
 * painted mahogany, lit by the beyond's light and the spill, a little darker
 * on faces turned from the light above, shown as its door opens.
 */
export function createBeyondSolidMaterial(context: BeyondMaterialContext, textures: HallTextures): MeshBasicNodeMaterial {
  const { mood, swing, section } = context;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true, fog: false });
  const tag = attribute("aBeyond", "vec2");
  const door = tag.x;
  const p = vec2(positionWorld.x, positionWorld.z);
  const { distance, facing } = doorwayGeometry(door, p);
  const open = doorOpen(door, swing);
  // The hall's dado mahogany as photographed (#5c3132, hall-section.ts) carried by the painted
  // grain's light and dark (its luminance against the paint's own, hall-textures.ts paintWood).
  const albedo = linear("#5c3132").mul(mahoganyGrain(textures, uv().mul(2)));
  const shade = mix(float(0.62), float(1), geometryNormal().y.mul(0.5).add(0.5));
  material.colorNode = relitBeyond(albedo.mul(shade), mood, spillLight(mood, distance, facing, open));
  material.opacityNode = presenceNode(open);
  material.positionNode = onWalk(section).select(COLLAPSED, positionLocal);
  material.name = "grand-hall-beyond-solids";
  return material;
}

/**
 * Pools of warm light past each open door (Atelier, Nocturne): the room's
 * chandelier light at the mood's strength, round, softest at its rim,
 * strongest a little out from the doorway, added to whatever lies beneath.
 * Under the real sky they fade as the sun climbs (gone by a third of its
 * overhead strength): a room's light falling out of a door is lost in
 * daylight, and a pale disc on the sunlit city read as a stain.
 */
export function createBeyondPoolMaterial(context: BeyondMaterialContext, strength: number): MeshBasicNodeMaterial {
  const { mood, swing, section, sun } = context;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const tag = attribute("aBeyond", "vec2");
  const door = tag.x;
  const p = vec2(positionWorld.x, positionWorld.z);
  const { along, across } = doorwayLocal(door, p);
  const open = doorOpen(door, swing);
  // Round, centred POOL.centre out of the doorway, softest at its rim and gone by 1.25 radii.
  const r = length(vec2(across, along.sub(POOL.centre))).div(POOL.radius);
  const pool = exp(r.mul(r).mul(-2.2)).mul(float(1).sub(smoothstep(0.85, 1.25, r)));
  const light = mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(strength).mul(pool).mul(presenceNode(open));
  material.colorNode = sun === null ? light : light.mul(float(1).sub(smoothstep(0.02, 0.33, sky.sunStrength)));
  material.positionNode = onWalk(section).select(COLLAPSED, positionLocal);
  material.name = "grand-hall-beyond-pools";
  return material;
}

/**
 * The first floor in card (Atelier): its walls' sides in the city's wall card,
 * their cut tops in its section card, the floor in its section card, all lit
 * as the city is (cardLit), with the light from each open door warming the
 * floor and the walls' feet near it.
 */
export function createFirstFloorCardMaterial(context: BeyondMaterialContext): MeshBasicNodeMaterial {
  const { mood, swing, section, sun } = context;
  const material = new MeshBasicNodeMaterial({ fog: false });
  const code = attribute("aBeyond", "vec2").y;
  const top = code.greaterThan(CARD_PART.top - 0.5).and(code.lessThan(CARD_PART.top + 0.5));
  const side = code.lessThan(CARD_PART.side + 0.5);
  const albedo = side.select(cardColour(CARD.wall), cardColour(CARD.section));
  const normal = geometryNormal();
  const lit = cardLit(albedo, normal, sun, mood, side.select(float(1), float(0)));
  // Each open door's light on the card near it.
  const p = vec2(positionWorld.x, positionWorld.z);
  let spill: Node<"vec3"> = vec3(0, 0, 0);
  for (let index = 0; index < BEYOND_DOORWAYS.length; index++) {
    const { distance, facing } = doorwayGeometry(float(index), p);
    spill = spill.add(spillLight(mood, distance, facing, doorOpen(float(index), swing)));
  }
  material.colorNode = lit.add(albedo.mul(spill).mul(top.select(float(0.5), float(1))));
  material.positionNode = onWalk(section).select(COLLAPSED, positionLocal);
  material.name = "grand-hall-first-floor-card";
  return material;
}
