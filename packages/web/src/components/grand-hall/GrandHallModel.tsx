// ---------------------------------------------------------------------------
// GrandHallModel — the Grand Hall as a real-time room
//
// Draws the hall as surveyed — the walls' scanned relief, the drawn oak floor,
// the coffered ceiling and the dome, each coloured by the scan's photographs
// with baked light — with the gilt chandeliers and their globes, and the
// dollhouse cutaway (with the walls' cut bodies) that lets the planner look
// in from above. Its real lights are HallLightRig, mounted beside it; its
// reflections are its own, captured from the room itself (hall-capture.ts).
// The relief and the photographs stream in after the first frame (flat walls
// in their average colour until then). Everything here renders on demand:
// frames are requested only while a mood blends or the cutaway eases.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Vector3, type Material } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { vec3 } from "three/tsl";
import { hallGeometry, hallWallGeometry } from "./hall-geometry.js";
import { loadWallRelief, type WallRelief } from "./hall-relief.js";
import { hallChandeliers } from "./hall-chandeliers.js";
import { paintHallTextures, disposeHallTextures, type HallTextures } from "./hall-textures.js";
import { HALL_PHOTO_COUNT, HallPhotos } from "./hall-photos.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useHallFinish } from "./hall-finish.js";
import { createHallMaterials, disposeHallMaterials, HallSectionUniforms } from "./hall-materials.js";
import { HALL_MOODS, HallMoodUniforms, hallFrameStep, moodEase, type HallMoodName, type HallMoodSpec } from "./hall-mood.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WALLS, HALL_ELEVATION, type HallWall } from "./hall-spec.js";
import { resetSceneGrade, setSceneGrade } from "../../lib/scene-grade.js";
import { setCandleLight } from "../../lib/event-light.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { HallEnvironmentCapture } from "./hall-capture.js";
import { createHallSection, type HallSection } from "./hall-section.js";

/** The dark the drawn hall stands in (the planner's background around it). */
export const HALL_VOID = "#120e0b";

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
  /** Photograph resolution; by default the device's own (hall-finish.ts). */
  readonly quality?: number;
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

interface HallResources {
  readonly textures: HallTextures;
  readonly photos: HallPhotos;
  readonly mood: HallMoodUniforms;
  readonly section: HallSectionUniforms;
  readonly materials: ReturnType<typeof createHallMaterials>;
  readonly chandelierMaterials: ReadonlyMap<string, Material>;
  /** The cut walls' bodies, caps and the plinth. */
  readonly cutaway: HallSection;
}

function createResources(quality: number, initialMood: HallMoodSpec): HallResources {
  const textures = paintHallTextures(quality);
  const photos = new HallPhotos();
  const mood = new HallMoodUniforms();
  mood.apply(initialMood, initialMood, 1);
  const section = new HallSectionUniforms();
  const materials = createHallMaterials(textures, photos, mood, section);

  const warm = mood.chandelier.rgb;
  // Gilt brass reflectance in linear light (a metal's colour is its F0).
  const gold = vec3(0.83, 0.68, 0.38);
  // Gilt brass: a metal that reflects the room, with a share of the lamps'
  // warmth so its scrollwork never falls to black.
  const frame = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 1 });
  frame.colorNode = gold;
  frame.emissiveNode = gold.mul(warm.mul(mood.glow.mul(0.16)).add(mood.ambient.rgb.mul(mood.ambientIntensity.mul(0.45))));
  // The globes: warm white, bright enough for the pipeline's bloom to halo.
  const bulb = new MeshBasicNodeMaterial();
  bulb.colorNode = vec3(1.0, 0.8, 0.58).mul(mood.glow.mul(7).add(0.9));
  const chandelierMaterials = new Map<string, Material>([["frame", frame], ["bulb", bulb]]);
  return { textures, photos, mood, section, materials, chandelierMaterials, cutaway: createHallSection() };
}

function disposeResources(resources: HallResources): void {
  disposeHallTextures(resources.textures);
  resources.photos.dispose();
  disposeHallMaterials(resources.materials);
  for (const material of resources.chandelierMaterials.values()) material.dispose();
  resources.cutaway.dispose();
}

export function GrandHallModel({ mood, view, quality: qualityOverride, overviewChandeliers = true, moodSeconds = 1.6 }: GrandHallModelProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => hallGeometry(), []);
  const [relief, setRelief] = useState<WallRelief | null>(null);
  const walls = useMemo(() => hallWallGeometry(relief), [relief]);
  const chandeliers = useMemo(() => hallChandeliers(), []);
  const deviceFinish = useHallFinish();
  const quality = qualityOverride ?? deviceFinish.photoQuality;
  const resources = useMemo(() => createResources(quality, HALL_MOODS[mood]), [quality]);
  // The mood resources were created with is applied directly; later moods blend.
  const blend = useRef<{ from: HallMoodSpec; to: HallMoodSpec; t: number; started: boolean } | null>(null);
  const settledMood = useRef<HallMoodName>(mood);
  const cutState = useRef<number[]>([HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none]);
  const cutsEasing = useRef(false);
  const skinRefs = useRef<(import("three").Mesh | null)[]>([]);
  const capRefs = useRef<(import("three").Group | null)[]>([]);
  const resolvedView = useRef<Exclude<HallView, "auto">>(view === "auto" ? "overview" : view);
  const chandelierGroup = useRef<import("three").Group | null>(null);
  const room = useRef<import("three").Group | null>(null);
  const lookDirection = useMemo(() => new Vector3(), []);
  // The room's own environment, recaptured whenever a surface or a mood settles.
  const captureNeeded = useRef(true);
  const environment = useMemo(() => {
    const renderer = getNativeRenderer(gl);
    return renderer === null ? null : new HallEnvironmentCapture(renderer, new Color(HALL_VOID));
  }, [gl]);

  useEffect(() => () => { disposeResources(resources); }, [resources]);

  useEffect(() => {
    if (environment === null) return undefined;
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    captureNeeded.current = true;
    invalidate();
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
      environment.dispose();
    };
  }, [environment, invalidate, scene]);

  // The scan's photographs and the walls' relief stream in after the first
  // frame; the planner's caption counts them in.
  useEffect(() => {
    let live = true;
    const surfaces = useHallViewStore.getState();
    surfaces.startSurfaces(HALL_PHOTO_COUNT + 1);
    resources.photos.load(quality, (_kind, loaded) => {
      if (!live) return;
      useHallViewStore.getState().settleSurface(loaded);
      if (loaded) { captureNeeded.current = true; invalidate(); }
    });
    loadWallRelief().then((loaded) => {
      if (!live) return;
      setRelief(loaded);
      useHallViewStore.getState().settleSurface(true);
      captureNeeded.current = true;
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

  // The mood's exposure and grade apply from the first frame and are restored on exit.
  useEffect(() => {
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = resources.mood.exposure;
    setSceneGrade(resources.mood.whiteBalance, resources.mood.saturation);
    setCandleLight(resources.mood.candles);
    invalidate();
    return () => {
      gl.toneMappingExposure = previous;
      resetSceneGrade();
      setCandleLight(0);
    };
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
      setSceneGrade(resources.mood.whiteBalance, resources.mood.saturation);
      setCandleLight(resources.mood.candles);
      if (active.t >= 1) { blend.current = null; captureNeeded.current = true; }
      else moving = true;
    }
    // Recapture the room's environment once nothing is blending: whole, with
    // its chandeliers lit and no cutaway, then restore this frame's cuts below.
    const roomGroup = room.current;
    if (environment !== null && captureNeeded.current && blend.current === null && roomGroup !== null) {
      captureNeeded.current = false;
      for (let index = 0; index < cutState.current.length; index++) resources.section.set(index, HALL_CUTS.none);
      const chandeliersShown = chandelierGroup.current?.visible ?? false;
      if (chandelierGroup.current !== null) chandelierGroup.current.visible = true;
      try {
        state.scene.environment = environment.capture(roomGroup);
        state.scene.environmentIntensity = resources.mood.reflections;
      } catch {
        // Without its own reflections the room keeps the previous environment.
      } finally {
        if (chandelierGroup.current !== null) chandelierGroup.current.visible = chandeliersShown;
      }
      moving = true;
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
    resources.cutaway.pieces.forEach((_piece, index) => {
      const height = cutState.current[index] ?? HALL_CUTS.none;
      const cut = height < HALL_HEIGHT - 0.01;
      // Uncut walls keep their full body; cut ones stop at the cut.
      const top = cut ? Math.max(0.05, height) : HALL_HEIGHT + 0.3;
      const skin = skinRefs.current[index];
      if (skin !== null && skin !== undefined) skin.scale.y = top;
      const cap = capRefs.current[index];
      if (cap !== null && cap !== undefined) {
        cap.visible = cut;
        cap.position.y = top;
      }
    });
    if (moving) invalidate();
  });

  return (
    <group ref={room} name="grand-hall">
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
      </group>
      <mesh name="grand-hall-plinth" geometry={resources.cutaway.plinth} material={resources.cutaway.materials.plinth} />
      {resources.cutaway.pieces.map((piece, index) => (
        <group key={piece.wall.id} name={`grand-hall-section-${piece.wall.id}`} position={[piece.centre[0], 0, piece.centre[1]]} rotation={[0, piece.rotationY, 0]}>
          <mesh
            ref={(mesh) => { skinRefs.current[index] = mesh; }}
            name={`grand-hall-section-skin-${piece.wall.id}`}
            geometry={piece.skin}
            material={resources.cutaway.materials.skin}
            scale={[1, HALL_HEIGHT + 0.3, 1]}
          />
          <group ref={(group) => { capRefs.current[index] = group; }} visible={false}>
            <mesh name={`grand-hall-section-cap-${piece.wall.id}`} geometry={piece.cap} material={resources.cutaway.materials.cap} />
            <mesh name={`grand-hall-section-edge-${piece.wall.id}`} geometry={piece.edge} material={resources.cutaway.materials.edge} />
          </group>
        </group>
      ))}
    </group>
  );
}
