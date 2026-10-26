// ---------------------------------------------------------------------------
// The sun's light in the Grand Hall
//
// One directional light is the sun by day and the moon by night. It casts the
// only shadow map in the planner, shared by everything it lights: the
// furniture's own materials sample it through the light, and the room's
// photographed surfaces sample the same map in their own shaders
// (hall-materials.ts), so a table's shadow on the oak floor and on a chair
// agree.
//
// The map is fitted tightly around the room (the walls, the furniture's
// height) as seen from the sun, and redrawn only when something it shows
// changes: the sun moving, furniture placed, moved or in motion, the walls'
// relief or the city arriving. Orbiting the camera never redraws it.
//
// The walls cast their full height whatever the cutaway shows, and their
// glazing lets the sun through (the atlas marks it): the cutaway is a way of
// looking, not a hole in the roof, so the sun reaches the floor only through
// the windows, as it does in the real room. The walls cast as solids
// (hallSunCasterParts): the scanned relief is a single surface, whose top
// stands up to 5 cm behind the ceiling's edge and whose ends miss each other
// in the corners, and through those slits the moon drew thin bright lines
// across the floor and the tables; the walls' bodies, as thick as the real
// walls and open only at the windows and doors (hall-wall-body.ts), close
// them.
// ---------------------------------------------------------------------------

import { DirectionalLight, Matrix4, Vector3, type BufferGeometry, type LightShadow } from "three";
import { shadow } from "three/tsl";
import type { Node, ShadowNode } from "three/webgpu";

/** A box in the hall's frame, metres. */
export interface ShadowBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The box the hall's sun shadow covers: the room and its walls, floor to ceiling. */
const HALL_BOX: ShadowBox = { min: [-11.45, -0.05, -6.0], max: [11.45, 6.9, 6.0] };
/**
 * How far toward the sun the hall's map still sees casters, metres: far
 * enough for the buildings across Glassford Street, whose roofs hide the
 * low sun from the windows.
 */
const HALL_REACH = 90;
/** Room to spare round the box in light space, so filtering never reads past it, metres. */
const MARGIN = 0.35;

/**
 * The layer shadow casters live on: plain stand-ins (the hall's walls,
 * ceiling and dome, the city's blocks) that only the sun's shadow cameras
 * see. Visible surfaces that sample a map cannot also be drawn into it.
 */
export const HALL_SUN_CASTER_LAYER = 9;

/** One of the room's stand-ins on the caster layer. */
export interface SunCasterPart {
  readonly key: string;
  readonly geometry: BufferGeometry;
  /** The walls' relief: the light passes where the atlas marks glazing (createHallCasterMaterials). */
  readonly glazed: boolean;
}

/** The room's parts that cast: its geometry by material, as GrandHallModel builds it. */
export interface HallCasterSources {
  /** The ceiling, the dome and the windows' bars and outer reveals (hall-geometry.ts; its floor casts nothing). */
  readonly room: ReadonlyMap<string, BufferGeometry>;
  /** The walls' relief. */
  readonly walls: ReadonlyMap<string, BufferGeometry>;
  /** The doors' leaves, which cast shut: the cutaway is a way of looking, as everywhere else. */
  readonly doors: ReadonlyMap<string, BufferGeometry>;
  /** The walls' bodies (hall-wall-body.ts), uncut: their full height, through their real thickness. */
  readonly body: BufferGeometry;
}

/** What the room casts the sun's and the moon's shadow with, in a stable order. */
export function hallSunCasterParts(sources: HallCasterSources): SunCasterPart[] {
  const glazed = (key: string): boolean => key === "wallPhoto" || key === "wallPhotoGloss";
  return [
    ...[...sources.room, ...sources.walls].map(([key, geometry]) => ({ key, geometry, glazed: glazed(key) })),
    ...[...sources.doors].map(([key, geometry]) => ({ key, geometry, glazed: false })),
    { key: "body", geometry: sources.body, glazed: false },
  ].filter(({ key }) => key !== "floor");
}

export interface HallSun {
  readonly light: DirectionalLight;
  /** The map's sampling node, as the light uses it. */
  readonly shadow: ShadowNode;
  /** The same node as a shader value: 1 lit, 0 in shadow. */
  readonly factor: Node<"float">;
  /** Aims the light along `toward` (a unit vector toward the sun or moon) and refits the map. */
  aim(toward: readonly [number, number, number]): void;
  /** Redraws the map on the next frame. */
  redraw(): void;
  dispose(): void;
}

export interface SunCasterOptions {
  readonly name: string;
  readonly box: ShadowBox;
  readonly mapSize: number;
  /** Metres toward the light beyond the box in which casters still count. */
  readonly reach: number;
}

const corner = new Vector3();
const view = new Matrix4();
const eye = new Vector3();
const up = new Vector3(0, 1, 0);
const north = new Vector3(0, 0, 1);

/**
 * A light whose `mapSize`-square shadow map covers `box` as seen from the
 * sun, refitted whenever it is aimed and drawn only when asked.
 */
export function createSunCaster(options: SunCasterOptions): HallSun {
  const { box, mapSize, reach } = options;
  const light = new DirectionalLight(0xffffff, 0);
  light.name = options.name;
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  // Furniture on the default layer, the stand-ins on their own.
  light.shadow.camera.layers.enable(HALL_SUN_CASTER_LAYER);
  // A sliver of depth bias against acne at a grazing sun; the normal offset
  // follows the map's texel size at each fit.
  light.shadow.bias = -0.0003;
  light.shadow.radius = 2.5;
  const node = shadow(light);
  if (!isShadowFactor(node)) throw new Error("three's shadow() did not return a shadow node");
  // Materials lit by this light sample the same node (AnalyticLightNode reads
  // `shadow.shadowNode`), so there is one map and one redraw.
  (light.shadow as LightShadow & { shadowNode?: Node }).shadowNode = node;
  const centre = new Vector3(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  const radius = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2;
  light.target.position.copy(centre);

  const aim = (toward: readonly [number, number, number]): void => {
    eye.set(toward[0], toward[1], toward[2]).normalize().multiplyScalar(radius + reach + 10).add(centre);
    light.position.copy(eye);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    // The box in the light's view space.
    view.lookAt(eye, centre, Math.abs(toward[1]) > 0.999 ? north : up);
    view.setPosition(eye);
    view.invert();
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max[0] : box.min[0],
        i & 2 ? box.max[1] : box.min[1],
        i & 4 ? box.max[2] : box.min[2],
      ).applyMatrix4(view);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
      minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
    }
    const camera = light.shadow.camera;
    camera.left = minX - MARGIN;
    camera.right = maxX + MARGIN;
    camera.bottom = minY - MARGIN;
    camera.top = maxY + MARGIN;
    // The view looks down −z: nearer points have larger z. Casters up to
    // `reach` beyond the box, toward the light, still count.
    camera.near = Math.max(0.1, -maxZ - MARGIN - reach);
    camera.far = -minZ + MARGIN;
    camera.updateProjectionMatrix();
    const texel = Math.max(camera.right - camera.left, camera.top - camera.bottom) / mapSize;
    light.shadow.normalBias = texel * 1.1;
    light.shadow.needsUpdate = true;
  };

  return {
    light,
    shadow: node,
    factor: node,
    aim,
    redraw: () => { light.shadow.needsUpdate = true; },
    dispose: () => {
      light.shadow.dispose();
      light.dispose();
    },
  };
}

/**
 * A shadow node is the float light factor its setup returns (ShadowNode.setup,
 * read by AnalyticLightNode). three's typings leave a ShadowNode's output type
 * open, so the shadow base class's own flag stands for it. The flag three sets
 * is `isShadowBaseNode` (ShadowBaseNode.js); the typings misname it
 * `isShadowBasedNode`, which no node carries, so testing that one refused
 * every shadow node and the sky's sun could never be made.
 */
function isShadowFactor(node: Node): node is Node<"float"> {
  return "isShadowBaseNode" in node && node.isShadowBaseNode === true;
}

/** The hall's sun: its map covers the room, and the street toward the sun. */
export function createHallSun(mapSize: number): HallSun {
  return createSunCaster({ name: "grand-hall-sun", box: HALL_BOX, mapSize, reach: HALL_REACH });
}

let shared: HallSun | null = null;
let sharedSize = 0;

/**
 * The hall's one sun, created on first use at the device's map size. The
 * room's materials and the light component use the same instance.
 */
export function hallSun(mapSize: number): HallSun {
  if (shared === null || sharedSize !== mapSize) {
    shared?.dispose();
    shared = createHallSun(mapSize);
    sharedSize = mapSize;
  }
  return shared;
}

/**
 * Redraws the hall's sun map on the next frame, if the hall has a sun: for
 * what changes outside the room's own components (the city arriving).
 * Never creates one. Returns whether there was a sun to redraw.
 */
export function requestHallSunRedraw(): boolean {
  shared?.redraw();
  return shared !== null;
}

/**
 * Runs `render`, a render of part of the scene, without drawing `sun`'s map
 * in it. three draws a pending map from whatever scene is being rendered
 * (ShadowNode.updateBefore takes frame.scene) and then clears the request,
 * so a private stage holding only the room would draw the shared map without
 * the furniture or the city, and the full frame after it would not redraw.
 * The request is held through the render and handed back for the next one.
 */
export function withoutSunMapDraw<T>(sun: HallSun | null, render: () => T): T {
  if (sun === null) return render();
  const shadow = sun.light.shadow;
  const pending = shadow.needsUpdate;
  shadow.needsUpdate = false;
  try {
    return render();
  } finally {
    shadow.needsUpdate = pending || shadow.needsUpdate;
  }
}

/** The shadow map's size for a device: phones and half-size photographs take a smaller map. */
export function hallSunMapSize(photoQuality: number, liveLight: boolean): number {
  if (!liveLight) return 512;
  return photoQuality < 1 ? 1024 : 2048;
}
