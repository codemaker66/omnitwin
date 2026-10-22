// ---------------------------------------------------------------------------
// Materials for the Grand Hall
//
// Photographed surfaces (walls, floor, ceiling, dome) show the scan's own
// images, relit for the current mood: the photograph already holds the hall's
// light at the time of the scan (daylight through the windows with the
// chandeliers and frieze uplights on), so each texel is scaled by the ratio of
// the mood's light to that scan light at its vertex, both from the same baked
// channels. In Daylight the ratio is one and the room is exactly as scanned;
// Evening and Candlelight dim the windows, warm the chandeliers and lift the
// frieze. Glossy photographs (varnished panelling, the floor) also reflect.
//
// Under the real sky the windows' glass opens (HallGlazingUniforms): the wall
// photographs are cut where the atlas marks glazing, and hall-glazing.ts puts
// panes, painted bars and outer reveals in the opening.
//
// Where the planner looks at a wall closely, its 2 mm detail (hall-detail.ts)
// fades in over the atlas, wherever a tile of it is resident; the relighting
// and everything after treat it as the photograph.
//
// Where the cutaway cuts a wall, the walls' photographs carry the cut's gilt
// band and the soft shadow under it (hall-cut-lines.ts), following every
// moulding at the cut's height; not on what stands in a window (the curtains
// are cloth, the glass is glass).
//
// The doors' painted mahogany multiplies its albedo by the vertex's baked
// light (emissive, so the renderer adds only reflections); gilt and brass are
// metals lit by the environment with a share of the bake so they never fall
// to black. The doors' leaves turn about their hinges in the vertex shader
// (createDoorLeafMaterials, hall-doors.ts).
// ---------------------------------------------------------------------------

import { Color, DoubleSide, FrontSide, type Material, type Side, type Texture } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { attribute, bool, cameraPosition, color, dot, float, luminance, max, min, mix, normalWorld, positionWorld, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import type { HallMaterialKey } from "./hall-builders.js";
import { HALL_GLAZING_PAINT, HALL_OPENINGS, HALL_WALLS, isWindow } from "./hall-spec.js";
import { CARD, cardColour, cardLit } from "./hall-beyond.js";
import { DOOR_SLOTS, LINTEL_RELEASE, WALL_BODY_TOP } from "./hall-wall-body.js";
import { cutEdge, GILT_COLOUR, type CutEdge } from "./hall-cut-lines.js";
import type { HallSun } from "./hall-sun.js";
import { hallSkyUniforms } from "./hall-sky-runtime.js";
import { HALL_MOODS, type HallMoodUniforms } from "./hall-mood.js";
import type { HallTextures } from "./hall-textures.js";
import type { HallPhotos, HallPhotoKind } from "./hall-photos.js";
import type { HallDetailLayer } from "./hall-detail.js";
import { createOakFloorMaterial } from "./hall-floor.js";
import { doorLeafMask, doorLeafPosition, doorLeafTurn, type DoorSwingUniforms } from "./hall-doors.js";

type Shading = "gloss" | "metal" | "photo" | "photoGloss" | "paint";

interface SurfaceStyle {
  readonly shading: Shading;
  readonly map?: Texture;
  readonly photo?: HallPhotoKind;
  readonly tint: string;
  /** Texture repeats per uv unit. */
  readonly repeat?: readonly [number, number];
  readonly roughness?: number;
  readonly side?: Side;
  /** Share of the bake a metal keeps as diffuse fill. */
  readonly fill?: number;
}

/**
 * Cut heights for the dollhouse cutaway: one per wall (in HALL_WALLS order)
 * and one for the ceiling and dome. A fragment above its part's cut height is
 * discarded, so the planner can look into the room from above while the
 * walls behind the furniture keep their full height.
 */
export class HallSectionUniforms {
  readonly cuts = [uniform(100), uniform(100), uniform(100), uniform(100), uniform(100)] as const;
  /**
   * How far the chandeliers are put away (0 drawn, 1 hidden: in Plan and in
   * the overview from high up; eased by GrandHallModel): the floor's sharp
   * reflections of them soften with them (hall-floor.ts).
   */
  readonly chandeliersAway = uniform(0);

  set(index: number, height: number): void {
    const cut = this.cuts[index];
    if (cut !== undefined) cut.value = height;
  }

  get(index: number): number {
    return this.cuts[index]?.value ?? 100;
  }
}

/**
 * A fragment stands below its part's cut (hall-wall-body.ts reliefVisible
 * mirrors the rule). Relief standing in a corner against the neighbouring
 * wall (`aWallB`, hall-walls.ts sharedNeighbour) takes the lower of the two
 * walls' cuts. Over each doorway, once its wall is cut low enough that the
 * body drops the lintel (LINTEL_RELEASE), the relief over the door goes too,
 * so the doorway reads from above as a gap through the whole wall.
 */
function sectionCut(section: HallSectionUniforms): SectionCut {
  // Built once per set of cuts: the walls' mask and their cut's gilt edge
  // share these nodes, so a wall fragment works its cut out once, not twice.
  const cached = sectionCuts.get(section);
  if (cached !== undefined) return cached;
  const built = buildSectionCut(section);
  sectionCuts.set(section, built);
  return built;
}

interface SectionCut {
  /** The cut this fragment's relief takes (the lower of two walls' in a corner). */
  readonly cut: Node<"float">;
  /** Whether the fragment is drawn: under its cut, and not over a doorway whose lintel has gone. */
  readonly mask: Node<"bool">;
}

const sectionCuts = new WeakMap<HallSectionUniforms, SectionCut>();

function buildSectionCut(section: HallSectionUniforms): SectionCut {
  const [c0, c1, c2, c3, c4] = section.cuts;
  const wall = attribute("aWall", "float");
  const neighbour = attribute("aWallB", "float");
  const cutOf = (index: typeof wall) => index.lessThan(-0.5).select(float(1000),
    index.lessThan(0.5).select(c0,
      index.lessThan(1.5).select(c1,
        index.lessThan(2.5).select(c2,
          index.lessThan(3.5).select(c3, c4)))));
  const own = cutOf(wall);
  const cut = min(own, cutOf(neighbour));
  const p = positionWorld;
  let overDoor: Node<"bool"> = bool(false);
  for (const slot of DOOR_SLOTS) {
    const u = p.x.sub(slot.origin[0]).mul(slot.tangent[0]).add(p.z.sub(slot.origin[1]).mul(slot.tangent[1]));
    overDoor = overDoor.or(wall.greaterThan(slot.wall - 0.5).and(wall.lessThan(slot.wall + 0.5))
      .and(u.greaterThan(slot.u0)).and(u.lessThan(slot.u1)).and(p.y.greaterThan(slot.head)));
  }
  return { cut, mask: p.y.lessThan(cut).and(overDoor.and(own.lessThan(LINTEL_RELEASE)).not()) };
}

function sectionMask(section: HallSectionUniforms) {
  return sectionCut(section).mask;
}

/** Indices in HALL_OPENINGS of the windows. */
const WINDOW_OPENINGS = HALL_OPENINGS.flatMap((opening, index) => (isWindow(opening) ? [index] : []));

/**
 * The cut's gilt band and shadow on a wall photograph (hall-cut-lines.ts):
 * under the cut its relief takes (the lower of two walls' for relief in a
 * corner), only while that cut lies below the walls' top, on the room's
 * upright faces (`level`, from wallTexel, fades it from faces turned up or
 * down: on a ledge just under the cut an 8 mm band of height spreads into a
 * wide smear, and from above it showed as a broken sliver beyond the cut's
 * edge), and not on what stands in a window (`aOpening`).
 */
function wallCutEdge(section: HallSectionUniforms, level: Node<"float">): CutEdge {
  const { cut } = sectionCut(section);
  const opening = attribute("aOpening", "float");
  let inWindow: Node<"bool"> = bool(false);
  for (const index of WINDOW_OPENINGS) inWindow = inWindow.or(opening.greaterThan(index - 0.5).and(opening.lessThan(index + 0.5)));
  const active = cut.lessThan(WALL_BODY_TOP).and(inWindow.not()).select(float(1).sub(level), float(0));
  return cutEdge(cut.sub(positionWorld.y), positionWorld.y, active);
}

/**
 * 1 on a cut wall's relief within SLIVER_DEPTH under its cut while the camera
 * stands outside the wall's plane, easing to 0 below it and as the camera
 * comes round to the room's side. A near wall is seen from above, its room
 * face turned away; what shows of its relief is the moulding just under the
 * cut where it stands further out than at the cut itself, past the section's
 * edge (on the door wall the rail's swell stands up to 3.5 cm beyond the cut's
 * profile within 4 cm under it). Those tops face up into the chandeliers'
 * baked light: a pixel wide, pale and lit, they drew a beaded line of bright
 * dots along the near walls' cut (the skeptic's C3-bead, 22 October: 33 dots
 * in 170 x 90 px of Blake's opening view, every one of them these fragments).
 * They take the section's own room line instead
 * (HallMaterialOptions.sliverColour), without the varnish's highlight, so the
 * cut's edge reads as one band.
 */
function outsideSliver(section: HallSectionUniforms): Node<"float"> {
  const { cut } = sectionCut(section);
  const below = cut.sub(positionWorld.y);
  const near = float(1).sub(smoothstep(SLIVER_DEPTH * 0.5, SLIVER_DEPTH, below));
  const outside = float(1).sub(cameraOnRoomSide(attribute("aWall", "float")));
  return cut.lessThan(WALL_BODY_TOP).select(near.mul(outside), float(0));
}

/** How far under a near wall's cut its relief is drawn as the section's room line (outsideSliver), metres. */
export const SLIVER_DEPTH = 0.04;

/**
 * How far the camera stands on the room's side of wall `wall`'s plane
 * (HALL_WALLS order), eased from 0 a quarter of a metre outside it to 1 three
 * quarters of a metre in (SIDE_EASE; sideWeight is the rule on the CPU), so
 * an orbit crossing the plane, where the wall is seen on edge, never pops.
 */
function cameraOnRoomSide(wall: Node<"float">): Node<"float"> {
  const inside = (index: number): Node<"float"> => {
    const w = HALL_WALLS[index];
    if (w === undefined) return float(1);
    return cameraPosition.x.sub(w.origin[0]).mul(w.normal[0]).add(cameraPosition.z.sub(w.origin[2]).mul(w.normal[2]));
  };
  const distance = wall.lessThan(0.5).select(inside(0), wall.lessThan(1.5).select(inside(1), wall.lessThan(2.5).select(inside(2), inside(3))));
  return smoothstep(SIDE_EASE[0], SIDE_EASE[1], distance);
}

/** The camera's distance from a wall's plane (into the room positive) over which cameraOnRoomSide eases, metres. */
export const SIDE_EASE = [-0.25, 0.75] as const;

/** cameraOnRoomSide's weight for a camera `distance` metres on the room's side of a wall's plane (negative outside). */
export function sideWeight(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - SIDE_EASE[0]) / (SIDE_EASE[1] - SIDE_EASE[0])));
  return t * t * (3 - 2 * t);
}

/** The baked irradiance at this vertex under the current mood. */
export function bakedIrradiance(mood: HallMoodUniforms) {
  const light = attribute("aLight", "vec4");
  const ao = light.x;
  return mood.ambient.rgb.mul(mood.ambientIntensity).mul(ao)
    .add(mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(light.y).mul(ao.mul(0.45).add(0.55)))
    .add(mood.daylight.rgb.mul(mood.daylightIntensity).mul(light.z).mul(ao.mul(0.5).add(0.5)))
    .add(mood.uplight.rgb.mul(mood.uplightIntensity).mul(light.w));
}

/**
 * The same irradiance under the light the scan was made in — the Daylight
 * mood's channels, fixed — against which photographs are relit.
 */
export function scanIrradiance() {
  const scan = HALL_MOODS.daylight;
  const light = attribute("aLight", "vec4");
  const ao = light.x;
  const rgb = (hex: string) => vec3(...new Color(hex).toArray() as [number, number, number]);
  return rgb(scan.ambient).mul(scan.ambientIntensity).mul(ao)
    .add(rgb(scan.chandelier).mul(scan.chandelierIntensity).mul(light.y).mul(ao.mul(0.45).add(0.55)))
    .add(rgb(scan.daylight).mul(scan.daylightIntensity).mul(light.z).mul(ao.mul(0.5).add(0.5)))
    .add(rgb(scan.uplight).mul(scan.uplightIntensity).mul(light.w));
}

/** The daylight the scan was made in, as one colour. */
function scanDaylight() {
  const scan = HALL_MOODS.daylight;
  const [r, g, b] = new Color(scan.daylight).multiplyScalar(scan.daylightIntensity).toArray();
  return vec3(r, g, b);
}

/**
 * A wall photograph's texel for this fragment: the atlas, sharpened by the
 * 2 mm detail where a tile is resident (`detail`, hall-detail.ts). The
 * orthophotos look straight at each wall, so faces they see edge-on — the
 * sides of doorcases, boards and reveals — would stretch a single row of
 * texels into streaks; those faces take the photograph's local average: by a
 * window, six mip levels coarser (about 30 cm a texel), muted and shaded as
 * the recess it is, since the average of a window's glass and curtains would
 * otherwise streak blue and white down the reveal; elsewhere 2.5 levels
 * coarser, in its own colour. They are never glazing.
 */
function wallTexel(photos: HallPhotos, edgeOn = true, detail: HallDetailLayer | null = null) {
  const atlas = attribute("aAtlas", "vec2");
  const wall = attribute("aWall", "float");
  const photo = photos.sample("walls", atlas);
  // Where the walls' 2 mm detail has a tile in (hall-detail.ts), it fades in
  // over the atlas; never on glass, which the atlas's alpha marks (128/255).
  // Mixed in a square-root space, near the screen's own response, so each
  // step of a fade changes what is seen by about as much as the next (mixed in
  // linear light, a gilt letter brightening over dark wood made most of its
  // change in the first steps).
  const fine = detail === null ? null : detail.sample(atlas, wall);
  const sample = fine === null ? photo : vec4(
    mix(photo.rgb.max(0).sqrt(), fine.color.rgb.max(0).sqrt(), fine.weight.mul(smoothstep(0.85, 0.98, photo.a))).pow2(), photo.a,
  );
  const face = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize();
  // A door's leaf (hall-doors.ts) shows its photograph however it turns: open,
  // its face looks along the wall, and it is still the face the atlas saw.
  if (!edgeOn) return { texel: sample, alpha: photo.a, level: smoothstep(0.55, 0.8, face.y.abs()) };
  // Window and door walls face along z; the end walls along x.
  const alongZ = wall.lessThan(0.5).or(wall.greaterThan(1.5).and(wall.lessThan(2.5)));
  const facing = smoothstep(0.18, 0.42, alongZ.select(face.z.abs(), face.x.abs()));
  // Near glazing (the photograph's alpha below opaque) a face seen edge-on is
  // a window's reveal: it takes the coarse, muted, shaded average, since the
  // average of glass and curtains would otherwise streak blue and white down
  // it. Elsewhere it is joinery or plaster seen on edge (a board's shelf, a
  // doorcase's side): it keeps the colour of what the photograph shows at its
  // edge, averaged over a few centimetres (2.5 levels coarser) so a single row
  // of texels does not streak, and only a little shaded. The muted 30 cm
  // average everywhere laid a flat grey slab along the deacon boards' shelf
  // (review LOOK-7, 22 October). One sample either way: the level follows.
  const glassy = float(1).sub(smoothstep(0.9, 0.99, photo.a));
  const coarse = photo.bias(mix(float(2.5), float(6), glassy)).rgb;
  const reveal = vec4(mix(coarse.mul(0.86), mix(vec3(luminance(coarse)), coarse, 0.3).mul(0.62), glassy), 1);
  // The unbiased sample's alpha marks glazing; the window boards and heads
  // (faces turned up or down) are never glass, whatever texel they project to.
  const level = smoothstep(0.55, 0.8, face.y.abs());
  return { texel: mix(reveal, sample, facing), alpha: photo.a, level };
}

type WallTexel = ReturnType<typeof wallTexel>;

/**
 * Whether the windows' glass is open: 1 under the real sky, where the drawn
 * city and sky stand behind it (hall-glazing.ts puts panes and bars in the
 * opening), 0 while the room's reflections are captured (the void would show
 * through) and without the sky. Driven by GrandHallModel.
 */
export class HallGlazingUniforms {
  readonly open = uniform(0);

  set(open: boolean): void {
    this.open.value = open ? 1 : 0;
  }

  get isOpen(): boolean {
    return this.open.value > 0.5;
  }
}

/**
 * Where an open window's glass is cut from the wall: below this alpha the
 * atlas shows glazing (128/255, the bars smoothed into it at about 0.65); the
 * rest of the walls are opaque (255).
 */
export const GLAZING_CUT = 0.75;

/**
 * The sun's (or moon's) direct light on this fragment, in the baked channels'
 * units: the light's strength, the cosine of its angle, and the shared
 * shadow map (hall-sun.ts), which admits it only through the windows' glass.
 */
function sunIrradiance(sun: HallSun) {
  const sky = hallSkyUniforms;
  const facing = max(dot(normalWorld, sky.lightDirection), 0);
  return sky.lightRadiance.mul(facing).mul(sun.factor);
}

/** The gilt band's colour: the coffers' measured gilt, a photographed colour relit like the photographs. */
const GILT = new Color(GILT_COLOUR);

/**
 * A photographed surface's colour under the current mood. On the walls, the
 * cut's edge (when given) lays its gilt band into the photograph and its
 * shadow over it before the relighting, so the band is lit as the room is.
 */
function relitPhoto(photos: HallPhotos, kind: HallPhotoKind, mood: HallMoodUniforms, sun: HallSun | null, wall: WallTexel | null = null, edge: CutEdge | null = null) {
  const sample = kind === "walls" ? (wall ?? wallTexel(photos)).texel : photos.sample(kind, uv());
  const photographed = sample.rgb;
  const image = edge === null ? photographed : mix(photographed.mul(edge.shade), color(GILT).rgb, edge.gilt);
  // (baked + k) / (scan + k): exactly 1 under the scan's own light, so
  // Daylight is the photograph, and finite where the bake is nearly dark.
  // Direct sun is light the scan did not hold, so it adds to the bake.
  const k = float(0.06);
  const baked = sun === null ? bakedIrradiance(mood) : bakedIrradiance(mood).add(sunIrradiance(sun));
  const lit = image.mul(baked.add(k).div(scanIrradiance().add(k)));
  if (kind !== "walls") return lit;
  // Glazing seen between the curtains is the view out, not a lit surface: it
  // follows the daylight alone, falling to dusk blue and then dark. The
  // atlas's alpha marks it (half opaque where the photograph shows glass).
  // Under the real sky the glass is cut away instead (openGlazing) and the
  // drawn city shows through; this photograph stays for the room's captured
  // reflections and for the moods without the sky.
  const glass = float(1).sub(sample.a).mul(2).clamp(0, 1);
  const outside = photographed.mul(mood.daylight.rgb.mul(mood.daylightIntensity).div(scanDaylight()));
  return mix(lit, outside, glass);
}

/**
 * The outer reveals' finish, which no photograph shows (art direction until
 * one does): the sash box a warm white paint (sRGB e6e0d4) and the stone
 * beyond a pale sandstone (b4a58c), as albedos.
 */
const REVEAL_PAINT = new Color("#e6e0d4");
const REVEAL_STONE = new Color("#b4a58c");
/** How much of the sky an outer reveal sees, in the daylight channel's units. */
const REVEAL_SKY_VIEW = 0.5;

/**
 * The windows' paint (hall-glazing.ts). Inside the glass, the bars are their
 * photographed colour relit like the photographs around them, so they match
 * the sash frames the atlas shows in every light. Outside it, the reveals
 * (uv.x 1; uv.y 1 where stone) are lit as surfaces: the room's light
 * spilling out through the glass (the bake), the sky they see and the sun.
 */
function paintSurface(mood: HallMoodUniforms, sun: HallSun | null): Material {
  const outside = uv().x;
  const stone = uv().y;
  const k = float(0.06);
  const room = bakedIrradiance(mood);
  const direct = sun === null ? vec3(0) : sunIrradiance(sun);
  const [pr, pg, pb] = HALL_GLAZING_PAINT;
  const bars = vec3(pr, pg, pb).mul(room.add(direct).add(k).div(scanIrradiance().add(k)));
  const albedo = mix(color(REVEAL_PAINT).rgb, color(REVEAL_STONE).rgb, stone);
  const sky = mood.daylight.rgb.mul(mood.daylightIntensity).mul(REVEAL_SKY_VIEW);
  const reveals = albedo.mul(room.add(sky).add(direct));
  const material = new MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0, fog: false });
  material.colorNode = vec3(0);
  material.emissiveNode = mix(bars, reveals, outside);
  material.roughnessNode = mix(float(0.38), float(0.85), stone);
  return material;
}

function albedoNode(style: SurfaceStyle) {
  const tint = color(new Color(style.tint)).rgb;
  if (style.map === undefined) return tint;
  const repeat = style.repeat ?? [1, 1];
  return texture(style.map, uv().mul(vec2(repeat[0], repeat[1]))).rgb.mul(tint);
}

/**
 * The glass cut from a wall photograph where the windows are open: the
 * opacity the alpha test reads (the atlas's own alpha, 1 whenever the glass
 * is closed). Every upright face over glazing goes, the steep faces where
 * the relief eases from the curtains back to the glass too: those are air in
 * the room, and kept they showed as grey shards along the curtains' edges.
 * The window boards stay, though they project onto the glass's lowest
 * texels. With
 * multisampling the test becomes alpha to coverage, so the cut's edge is
 * smooth on a phone; desktops' temporal resolve and tablets' FXAA smooth the
 * hard cut.
 */
function openGlazing(material: MeshBasicNodeMaterial | MeshStandardNodeMaterial, wall: WallTexel, glazing: HallGlazingUniforms, alphaToCoverage: boolean): void {
  material.opacityNode = mix(float(1), wall.alpha, glazing.open.mul(float(1).sub(wall.level)));
  material.alphaTestNode = float(GLAZING_CUT);
  material.alphaToCoverage = alphaToCoverage;
}

interface SurfaceOptions {
  readonly glazing: HallGlazingUniforms | null;
  readonly alphaToCoverage: boolean;
  readonly section: HallSectionUniforms;
  readonly detail: HallDetailLayer | null;
  readonly sliverColour: SliverColour | null;
}

/** The section's room line, lit, at a wall's cut `height` (hall-section.ts sectionRoomLine). */
export type SliverColour = (height: Node<"float">) => Node<"vec3">;

function createSurface(style: SurfaceStyle, mood: HallMoodUniforms, photos: HallPhotos, sun: HallSun | null, options: SurfaceOptions): Material {
  const side = style.side ?? FrontSide;
  if (style.shading === "photo" || style.shading === "photoGloss") {
    const kind = style.photo ?? "walls";
    const wall = kind === "walls" ? wallTexel(photos, true, options.detail) : null;
    const photographed = relitPhoto(photos, kind, mood, sun, wall, wall === null ? null : wallCutEdge(options.section, wall.level));
    // A near wall's slivers past the cut are drawn as the section's room line (outsideSliver).
    const line = wall === null ? null : options.sliverColour;
    const sliver = line === null ? null : outsideSliver(options.section);
    const lit = line === null || sliver === null ? photographed : mix(photographed, line(sectionCut(options.section).cut), sliver);
    const material = style.shading === "photo"
      ? new MeshBasicNodeMaterial({ side, fog: false })
      : new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.45, metalness: 0, fog: false });
    if (material instanceof MeshStandardNodeMaterial) {
      material.colorNode = vec3(0);
      material.emissiveNode = lit;
      // The varnish's highlight goes on the near walls' slivers past the cut (outsideSliver): a black
      // metal has no specular colour, and its colour (black) leaves the emissive as it was.
      if (sliver !== null) material.metalnessNode = sliver;
    } else {
      material.colorNode = lit;
    }
    if (wall !== null && options.glazing !== null) openGlazing(material, wall, options.glazing, options.alphaToCoverage);
    return material;
  }
  if (style.shading === "paint") return paintSurface(mood, sun);
  const albedo = albedoNode(style);
  const irradiance = sun === null ? bakedIrradiance(mood) : bakedIrradiance(mood).add(sunIrradiance(sun));
  if (style.shading === "gloss") {
    const material = new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.4, metalness: 0, fog: false });
    material.colorNode = vec3(0);
    material.emissiveNode = albedo.mul(irradiance);
    return material;
  }
  // Metal: gilt and brass.
  const material = new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.32, metalness: 1, fog: false });
  material.colorNode = albedo;
  material.emissiveNode = albedo.mul(irradiance).mul(style.fill ?? 0.35);
  material.aoNode = attribute("aLight", "vec4").x;
  return material;
}

/** Shading, texture and tint of every hall material. */
function styles(textures: HallTextures): Record<HallMaterialKey, SurfaceStyle> {
  return {
    floor: { shading: "photoGloss", photo: "floor", tint: "#ffffff", roughness: 0.5 },
    wallPhoto: { shading: "photo", photo: "walls", tint: "#ffffff" },
    wallPhotoGloss: { shading: "photoGloss", photo: "walls", tint: "#ffffff", roughness: 0.42 },
    ceilingPhoto: { shading: "photo", photo: "ceiling", tint: "#ffffff" },
    domePhoto: { shading: "photo", photo: "dome", tint: "#ffffff" },
    mahoganyDark: { shading: "gloss", map: textures.mahoganyDark, tint: "#ffffff", repeat: [1, 1], roughness: 0.38 },
    gilt: { shading: "metal", tint: "#d6a650", roughness: 0.3, fill: 0.4 },
    brass: { shading: "metal", tint: "#c9a35a", roughness: 0.28, fill: 0.4 },
    paint: { shading: "paint", tint: "#ffffff" },
  };
}

export interface HallMaterialOptions {
  /** The windows' glass, opened under the real sky (null: always the photograph). */
  readonly glazing?: HallGlazingUniforms | null;
  /** The scene pass is multisampled (phones): the glass's cut edge uses alpha to coverage. */
  readonly alphaToCoverage?: boolean;
  /** The walls' 2 mm detail, faded in over the atlas where a tile is resident (null: the atlas alone). */
  readonly detail?: HallDetailLayer | null;
  /** The section's room line, which a near wall's slivers past its cut take (outsideSliver; null: none). */
  readonly sliverColour?: SliverColour | null;
}

export type HallMaterials = ReadonlyMap<HallMaterialKey, Material>;

/**
 * The hall's materials. With a `sun` (the real sky drives the hall), every
 * surface also takes the sun's or moon's direct, shadowed light.
 */
export function createHallMaterials(
  textures: HallTextures, photos: HallPhotos, mood: HallMoodUniforms, section: HallSectionUniforms, sun: HallSun | null = null,
  options: HallMaterialOptions = {},
): HallMaterials {
  const table = styles(textures);
  const materials = new Map<HallMaterialKey, Material>();
  const surface: SurfaceOptions = {
    glazing: options.glazing ?? null, alphaToCoverage: options.alphaToCoverage ?? false, section, detail: options.detail ?? null,
    sliverColour: options.sliverColour ?? null,
  };
  for (const key of Object.keys(table) as HallMaterialKey[]) {
    // The floor is drawn (hall-floor.ts), lit by the same baked light.
    const floorLight = sun === null ? bakedIrradiance(mood) : bakedIrradiance(mood).add(sunIrradiance(sun));
    const material = key === "floor" ? createOakFloorMaterial(floorLight, section.chandeliersAway) : createSurface(table[key], mood, photos, sun, surface);
    if (material instanceof MeshBasicNodeMaterial || material instanceof MeshStandardNodeMaterial) {
      material.maskNode = sectionMask(section);
    }
    material.name = `grand-hall-${key}`;
    materials.set(key, material);
  }
  return materials;
}

/**
 * The doors' leaves (hall-doors.ts): the walls' photograph on the faces the
 * atlas photographed shut (varnished below the dado's top, matte above it,
 * as the walls' relief), the room's mahogany and brass on the
 * rest, lit by the bake at the closed position and, under the real sky, the
 * sun or moon. Every vertex turns about its leaf's hinge in the shader
 * (doorLeafPosition) and the leaf is cut where its wall is (doorLeafMask,
 * with a section laid at the cut).
 */
export function createDoorLeafMaterials(
  textures: HallTextures, photos: HallPhotos, mood: HallMoodUniforms, section: HallSectionUniforms, swing: DoorSwingUniforms, sun: HallSun | null = null,
  options: { readonly card?: boolean; readonly detail?: HallDetailLayer | null } = {},
): HallMaterials {
  const table = styles(textures);
  const position = doorLeafPosition(section, swing);
  const mask = doorLeafMask(section);
  const materials = new Map<HallMaterialKey, Material>();
  const card = options.card === true ? cardLeafColour(mood, swing, sun) : null;
  const detail = options.detail ?? null;
  for (const key of ["wallPhoto", "wallPhotoGloss", "mahoganyDark", "brass"] as const) {
    let material: Material;
    if (card !== null) {
      // Atelier: every leaf in the city's card, its panels scored (cardLeafColour).
      const basic = new MeshBasicNodeMaterial({ fog: false });
      basic.colorNode = card;
      material = basic;
    } else if (key === "wallPhoto") {
      // Above the dado the walls' photograph is matte, on the leaves as on the relief they replace.
      const photo = new MeshBasicNodeMaterial({ fog: false });
      photo.colorNode = relitPhoto(photos, "walls", mood, sun, wallTexel(photos, false, detail));
      material = photo;
    } else if (key === "wallPhotoGloss") {
      const photo = new MeshStandardNodeMaterial({ roughness: table.wallPhotoGloss.roughness ?? 0.42, metalness: 0, fog: false });
      photo.colorNode = vec3(0);
      photo.emissiveNode = relitPhoto(photos, "walls", mood, sun, wallTexel(photos, false, detail));
      material = photo;
    } else {
      material = createSurface(table[key], mood, photos, sun, { glazing: null, alphaToCoverage: false, section, detail: null, sliverColour: null });
    }
    if (material instanceof MeshBasicNodeMaterial || material instanceof MeshStandardNodeMaterial) {
      material.positionNode = position;
      material.maskNode = mask;
    }
    material.name = `grand-hall-door-${key}`;
    materials.set(key, material);
  }
  return materials;
}

/**
 * A door leaf in card (the Atelier section): the city's wall card, lit as the
 * city is (hall-beyond.ts cardLit), every face not square to the leaf's own
 * face darker in proportion (the panels' sunk margins nearly half as bright,
 * their bevels a little, the slab's edges as the margins), so the panels read
 * as lines scored in card. The leaf's facing turns with it (doorLeafTurn).
 */
function cardLeafColour(mood: HallMoodUniforms, swing: DoorSwingUniforms, sun: HallSun | null): Node<"vec3"> {
  const wall = attribute("aWall", "float");
  const pickNormal = (axis: 0 | 2): Node<"float"> => {
    const value = (index: number): Node<"float"> => float(HALL_WALLS[index]?.normal[axis] ?? 0);
    return wall.lessThan(0.5).select(value(0), wall.lessThan(1.5).select(value(1), wall.lessThan(2.5).select(value(2), value(3))));
  };
  const nx = pickNormal(0);
  const nz = pickNormal(2);
  const turn = doorLeafTurn(swing);
  const c = turn.cos();
  const s = turn.sin();
  const facing = vec3(nx.mul(c).add(nz.mul(s)), 0, nx.negate().mul(s).add(nz.mul(c)));
  // The face's own normal turned with its leaf (as doorLeafPosition turns it), read from the
  // geometry rather than normalWorld, which in an unlit material upset the pass's normal target.
  const n0 = attribute("normal", "vec3");
  const normal = vec3(n0.x.mul(c).add(n0.z.mul(s)), n0.y, n0.x.negate().mul(s).add(n0.z.mul(c)));
  const score = mix(float(0.55), float(1), dot(normal, facing).abs().pow(6));
  // In the doorway the room's own light reaches it too (the leaves' bake).
  const albedo = cardColour(CARD.wall).mul(score);
  return cardLit(albedo, normal, sun, mood, float(1)).add(albedo.mul(bakedIrradiance(mood)).mul(0.6));
}

export interface HallCasterMaterials {
  /** The walls: their glazing (marked in the atlas) lets the sun through. */
  readonly glazed: Material;
  /** The ceiling and dome: solid. */
  readonly solid: Material;
}

/**
 * Plain stand-ins the sun's shadow camera alone draws for the room
 * (hall-sun.ts HALL_SUN_CASTER_LAYER). They cast every surface's whole shape
 * whatever the cutaway shows, because the cutaway is a way of looking, not a
 * hole in the roof; only the glazing lets light through. The atlas smoothed
 * the glazing bars into its glass, so the bars cast as the measured geometry
 * of hall-glazing.ts ("paint", solid), and the sun's patches on the floor
 * carry their shadows.
 */
export function createHallCasterMaterials(photos: HallPhotos): HallCasterMaterials {
  const glazed = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false });
  glazed.colorNode = vec4(0, 0, 0, 1);
  // The atlas marks glazing half opaque (alpha 128/255) and everything else opaque.
  glazed.maskShadowNode = photos.sample("walls", attribute("aAtlas", "vec2")).a.greaterThan(0.75);
  glazed.name = "grand-hall-caster-glazed";
  const solid = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false });
  solid.colorNode = vec4(0, 0, 0, 1);
  solid.name = "grand-hall-caster";
  return { glazed, solid };
}

export function disposeHallMaterials(materials: HallMaterials): void {
  for (const material of materials.values()) material.dispose();
}
