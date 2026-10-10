// ---------------------------------------------------------------------------
// GrandHallModel — the Grand Hall as a real-time room
//
// Draws the hall as surveyed — the walls' scanned relief, the floor, the
// coffered ceiling and the dome, each coloured by the scan's photographs with
// baked light — with the chandeliers and their halos, and the dollhouse
// cutaway that lets the planner look in from above. Its real lights and
// reflections are HallLightRig, mounted beside it. The relief and the
// photographs stream in after the first frame (flat walls in their average
// colour until then). Everything here renders on demand: frames are requested
// only while a mood blends or the cutaway eases after the camera moves.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BoxGeometry,
  DataTexture,
  Vector3,
  InstancedBufferAttribute,
  LinearFilter,
  RGBAFormat,
  Sprite,
  type Material,
  type Texture,
} from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, SpriteNodeMaterial } from "three/webgpu";
import { color, float, instancedBufferAttribute, mix, normalWorld, texture, uniform, uv, vec3 } from "three/tsl";
import { hallGeometry, hallWallGeometry } from "./hall-geometry.js";
import { loadWallRelief, type WallRelief } from "./hall-relief.js";
import { hallChandeliers } from "./hall-chandeliers.js";
import { paintHallTextures, disposeHallTextures, type HallTextures } from "./hall-textures.js";
import { HALL_PHOTO_COUNT, HallPhotos } from "./hall-photos.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useHallFinish, type HallFinish } from "./hall-finish.js";
import { createHallMaterials, disposeHallMaterials, HallSectionUniforms } from "./hall-materials.js";
import { HALL_MOODS, HallMoodUniforms, hallFrameStep, moodEase, type HallMoodName, type HallMoodSpec } from "./hall-mood.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WALLS, HALL_ELEVATION, type HallWall } from "./hall-spec.js";

/** How the planner is looking at the room; "auto" decides from the camera. */
export type HallView = "plan" | "overview" | "walk" | "auto";

/** The framing an "auto" view resolves to for a camera pose. */
export function resolveHallView(position: readonly [number, number, number], lookingDown: number, previous: Exclude<HallView, "auto">): Exclude<HallView, "auto"> {
  const [x, y, z] = position;
  const inside = Math.abs(x) < HALL_HALF_LENGTH - 0.1 && Math.abs(z) < HALL_HALF_WIDTH - 0.1 && y < HALL_HEIGHT - 0.35;
  if (inside) return "walk";
  const overFloor = Math.abs(x) < HALL_HALF_LENGTH && Math.abs(z) < HALL_HALF_WIDTH;
  // Hysteresis keeps a camera hovering at the threshold from flickering.
  const steep = previous === "plan" ? lookingDown > 0.9 : lookingDown > 0.95;
  return overFloor && steep ? "plan" : "overview";
}

export interface GrandHallModelProps {
  readonly mood: HallMoodName;
  readonly view: HallView;
  /** How much finish to draw; by default the device's own (hall-finish.ts). */
  readonly finish?: HallFinish;
  /** Chandeliers in the overview (always shown on a walk, never in plan). */
  readonly overviewChandeliers?: boolean;
  /** Seconds a mood takes to blend into the next. */
  readonly moodSeconds?: number;
}

/** Heights the cutaway uses. */
export const HALL_CUTS = {
  /** Walls nearest the camera stop at the dado rail. */
  near: HALL_ELEVATION.dadoTop + 0.01,
  /** Plan view: above the doors, through the windows' heads, below the frieze. */
  plan: 3.12,
  /** Nothing cut. */
  none: 100,
  /** The ceiling removed. */
  hidden: -1,
} as const;

/**
 * The cut height for one wall seen from `camera` in `view`. In the overview,
 * walls the camera stands behind drop to the dado rail and the far walls keep
 * their full height, so the room reads tall while the floor stays open.
 */
export function wallCutHeight(view: Exclude<HallView, "auto">, wall: HallWall, camera: readonly [number, number, number]): number {
  if (view === "walk") return HALL_CUTS.none;
  if (view === "plan") return HALL_CUTS.plan;
  // Distance of the camera behind the wall's plane (positive outside the room).
  const behind = -((camera[0] - wall.origin[0]) * wall.normal[0] + (camera[2] - wall.origin[2]) * wall.normal[2]);
  const t = Math.max(0, Math.min(1, (behind + 1.5) / 4));
  const eased = t * t * (3 - 2 * t);
  return HALL_HEIGHT + 0.2 + (HALL_CUTS.near - HALL_HEIGHT - 0.2) * eased;
}

function glowTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      // A bright core with a long soft tail, like a lamp seen through warm air.
      const value = Math.max(0, Math.exp(-r * r * 7) * 0.9 + Math.exp(-r * 3.2) * 0.35 - 0.02 * r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, value) * 255);
    }
  }
  const textureData = new DataTexture(data, size, size, RGBAFormat);
  textureData.magFilter = LinearFilter;
  textureData.minFilter = LinearFilter;
  textureData.needsUpdate = true;
  return textureData;
}

interface HallResources {
  readonly textures: HallTextures;
  readonly photos: HallPhotos;
  readonly mood: HallMoodUniforms;
  readonly section: HallSectionUniforms;
  readonly materials: ReturnType<typeof createHallMaterials>;
  readonly chandelierMaterials: ReadonlyMap<string, Material>;
  /** How far the chandeliers' metal is lit by its own lamps (1 with the reflection map). */
  readonly selfLit: { value: number };
  readonly halos: Sprite;
  readonly haloTexture: Texture;
  readonly caps: readonly { readonly wall: HallWall; readonly geometry: BoxGeometry }[];
  readonly capMaterial: MeshBasicNodeMaterial;
}

/** The chandeliers' own light on their metal where no reflection map gives it anything to mirror. */
const SELF_LIT_WITHOUT_REFLECTIONS = 2.5;

function createResources(quality: number, initialMood: HallMoodSpec): HallResources {
  const textures = paintHallTextures(quality);
  const photos = new HallPhotos();
  const mood = new HallMoodUniforms();
  mood.apply(initialMood, initialMood, 1);
  const section = new HallSectionUniforms();
  const materials = createHallMaterials(textures, photos, mood, section);

  // As scanned: pale silver-gilt fittings on dark bronze stems, and white
  // bulbs, which warm with the mood's chandelier light.
  const warm = mood.chandelier.rgb;
  const ambient = mood.ambient.rgb.mul(mood.ambientIntensity);
  const bulbWhite = mix(vec3(1.0, 0.98, 0.95), warm, 0.15);
  const silverGilt = color("#cdc8b8").rgb;
  // Lit by its own lamps; faces turned down, away from them and from the lit
  // room above, fall dark, as the fittings' undersides do in the scan.
  const facingUp = normalWorld.y.mul(0.3).add(0.7);
  // Without the reflection map (a software rasteriser) the metal has nothing
  // to mirror, so its own light carries more of its brightness; the finish
  // sets this (GrandHallModel).
  const selfLit = uniform(1);
  const gilt = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 1 });
  gilt.colorNode = silverGilt;
  gilt.emissiveNode = silverGilt.mul(bulbWhite.mul(mood.glow.mul(0.3)).add(ambient.mul(0.3))).mul(facingUp).mul(selfLit);
  const darkBronze = color("#4f4234").rgb;
  const bronze = new MeshStandardNodeMaterial({ roughness: 0.42, metalness: 1 });
  bronze.colorNode = darkBronze;
  bronze.emissiveNode = darkBronze.mul(ambient.mul(0.35)).mul(selfLit);
  const bulb = new MeshBasicNodeMaterial();
  bulb.colorNode = bulbWhite.mul(mood.glow.mul(5).add(0.6));
  const chandelierMaterials = new Map<string, Material>([["gilt", gilt], ["bronze", bronze], ["bulb", bulb]]);

  // Halos: one instanced sprite per bulb, additive, never writing depth.
  const { bulbs } = hallChandeliers();
  const positions = new Float32Array(bulbs.length * 3);
  bulbs.forEach((position, index) => { positions.set(position, index * 3); });
  const haloTexture = glowTexture();
  const haloMaterial = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  haloMaterial.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(positions, 3));
  haloMaterial.scaleNode = float(0.26);
  haloMaterial.colorNode = bulbWhite.mul(texture(haloTexture, uv()).a).mul(mood.glow);
  const halos = new Sprite(haloMaterial);
  halos.count = bulbs.length;
  halos.frustumCulled = false;
  halos.name = "grand-hall-chandelier-halos";

  const caps = HALL_WALLS.map((wall) => {
    const geometry = new BoxGeometry(wall.length + 1.4, 0.03, 0.64);
    return { wall, geometry };
  });
  const capMaterial = new MeshBasicNodeMaterial();
  capMaterial.colorNode = color("#2a2019");
  return { textures, photos, mood, section, materials, chandelierMaterials, selfLit, halos, haloTexture, caps, capMaterial };
}

function disposeResources(resources: HallResources): void {
  disposeHallTextures(resources.textures);
  resources.photos.dispose();
  disposeHallMaterials(resources.materials);
  for (const material of resources.chandelierMaterials.values()) material.dispose();
  resources.halos.material.dispose();
  resources.haloTexture.dispose();
  for (const cap of resources.caps) cap.geometry.dispose();
  resources.capMaterial.dispose();
}

export function GrandHallModel({ mood, view, finish: finishOverride, overviewChandeliers = true, moodSeconds = 1.6 }: GrandHallModelProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => hallGeometry(), []);
  const [relief, setRelief] = useState<WallRelief | null>(null);
  const walls = useMemo(() => hallWallGeometry(relief), [relief]);
  const chandeliers = useMemo(() => hallChandeliers(), []);
  const deviceFinish = useHallFinish();
  const { photoQuality: quality, liveLight } = finishOverride ?? deviceFinish;
  const resources = useMemo(() => createResources(quality, HALL_MOODS[mood]), [quality]);
  // The mood resources were created with is applied directly; later moods blend.
  const blend = useRef<{ from: HallMoodSpec; to: HallMoodSpec; t: number; started: boolean } | null>(null);
  const settledMood = useRef<HallMoodName>(mood);
  const cutState = useRef<number[]>([HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none]);
  const cutsEasing = useRef(false);
  const capRefs = useRef<(import("three").Mesh | null)[]>([]);
  const resolvedView = useRef<Exclude<HallView, "auto">>(view === "auto" ? "overview" : view);
  const chandelierGroup = useRef<import("three").Group | null>(null);
  const lookDirection = useMemo(() => new Vector3(), []);

  useEffect(() => () => { disposeResources(resources); }, [resources]);

  // Without the reflection map the chandeliers' metal leans on its own light.
  useEffect(() => {
    resources.selfLit.value = liveLight ? 1 : SELF_LIT_WITHOUT_REFLECTIONS;
    invalidate();
  }, [invalidate, liveLight, resources]);

  // The scan's photographs and the walls' relief stream in after the first
  // frame; the planner's caption counts them in.
  useEffect(() => {
    let live = true;
    const surfaces = useHallViewStore.getState();
    surfaces.startSurfaces(HALL_PHOTO_COUNT + 1);
    resources.photos.load(quality, (_kind, loaded) => {
      if (!live) return;
      useHallViewStore.getState().settleSurface(loaded);
      if (loaded) invalidate();
    });
    loadWallRelief().then((loaded) => {
      if (!live) return;
      setRelief(loaded);
      useHallViewStore.getState().settleSurface(true);
      invalidate();
    }, () => {
      // Without the relief the walls stay flat photographs.
      if (live) useHallViewStore.getState().settleSurface(false);
    });
    return () => {
      live = false;
      useHallViewStore.getState().endSurfaces();
    };
  }, [invalidate, quality, resources]);

  // The mood's exposure applies from the first frame and is restored on exit.
  useEffect(() => {
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = resources.mood.exposure;
    invalidate();
    return () => { gl.toneMappingExposure = previous; };
  }, [gl, invalidate, resources]);

  // Start a blend whenever the requested mood changes.
  useEffect(() => {
    if (mood === settledMood.current && blend.current === null) return;
    blend.current = { from: resources.mood.snapshot(HALL_MOODS[settledMood.current]), to: HALL_MOODS[mood], t: 0, started: false };
    settledMood.current = mood;
    invalidate();
  }, [invalidate, mood, resources]);

  useFrame((state, delta) => {
    let moving = false;
    const active = blend.current;
    if (active !== null) {
      active.t = Math.min(1, active.t + hallFrameStep(delta, !active.started) / Math.max(0.05, moodSeconds));
      active.started = true;
      resources.mood.apply(active.from, active.to, moodEase(active.t));
      state.gl.toneMappingExposure = resources.mood.exposure;
      if (active.t >= 1) blend.current = null;
      else moving = true;
    }
    // Ease every cut toward its target for this camera and view.
    const camera: [number, number, number] = [state.camera.position.x, state.camera.position.y, state.camera.position.z];
    state.camera.getWorldDirection(lookDirection);
    const effective = view === "auto" ? resolveHallView(camera, -lookDirection.y, resolvedView.current) : view;
    resolvedView.current = effective;
    const targets = HALL_WALLS.map((wall) => wallCutHeight(effective, wall, camera));
    targets.push(effective === "walk" ? HALL_CUTS.none : HALL_CUTS.hidden);
    // Chandeliers: always on a walk, never in plan, and in the overview only
    // once the camera comes down toward the room (with hysteresis).
    const group = chandelierGroup.current;
    if (group !== null) {
      const show = effective === "walk" || (effective === "overview" && overviewChandeliers
        && (group.visible ? camera[1] < 11.5 : camera[1] < 10.5));
      if (group.visible !== show) { group.visible = show; moving = true; }
    }
    // A cut that starts to move does not spend the demand loop's idle gap.
    const damping = 1 - Math.exp(-hallFrameStep(delta, !cutsEasing.current) * 7);
    let easing = false;
    targets.forEach((target, index) => {
      const current = cutState.current[index] ?? target;
      // Snap across the "no cut" sentinel instead of easing through 100 m.
      const next = Math.abs(target - current) > 20 || Math.abs(target - current) < 0.002 ? target : current + (target - current) * damping;
      if (Math.abs(next - target) >= 0.002) easing = true;
      cutState.current[index] = next;
      resources.section.set(index, next);
    });
    cutsEasing.current = easing;
    moving = moving || easing;
    resources.caps.forEach((_cap, index) => {
      const mesh = capRefs.current[index];
      const height = cutState.current[index] ?? HALL_CUTS.none;
      if (mesh === null || mesh === undefined) return;
      mesh.visible = height < HALL_HEIGHT - 0.01;
      mesh.position.y = height - 0.015;
    });
    if (moving) invalidate();
  });

  return (
    <group name="grand-hall">
      {[...geometry.geometries].map(([key, part]) => {
        const material = resources.materials.get(key);
        if (material === undefined) return null;
        return <mesh key={key} name={`grand-hall-${key}`} geometry={part} material={material} frustumCulled={false} />;
      })}
      {[...walls.geometries].map(([key, part]) => {
        const material = resources.materials.get(key);
        if (material === undefined) return null;
        return <mesh key={`walls-${key}`} name={`grand-hall-walls-${key}`} geometry={part} material={material} frustumCulled={false} />;
      })}
      <group ref={chandelierGroup} name="grand-hall-chandeliers" visible={false}>
        {[...chandeliers.geometries].map(([key, part]) => (
          <mesh key={key} name={`chandelier-${key}`} geometry={part} material={resources.chandelierMaterials.get(key)} />
        ))}
        <primitive object={resources.halos} />
      </group>
      {resources.caps.map((cap, index) => {
        const centre: [number, number, number] = [
          cap.wall.origin[0] + cap.wall.tangent[0] * cap.wall.length / 2 - cap.wall.normal[0] * 0.32,
          0,
          cap.wall.origin[2] + cap.wall.tangent[2] * cap.wall.length / 2 - cap.wall.normal[2] * 0.32,
        ];
        const rotationY = Math.atan2(-cap.wall.tangent[2], cap.wall.tangent[0]);
        return (
          <mesh
            key={cap.wall.id}
            ref={(mesh) => { capRefs.current[index] = mesh; }}
            name={`grand-hall-section-${cap.wall.id}`}
            geometry={cap.geometry}
            material={resources.capMaterial}
            position={centre}
            rotation={[0, rotationY, 0]}
            visible={false}
          />
        );
      })}
    </group>
  );
}
