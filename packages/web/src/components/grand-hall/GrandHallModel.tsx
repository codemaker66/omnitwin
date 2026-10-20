// ---------------------------------------------------------------------------
// GrandHallModel — the Grand Hall as a real-time room
//
// Draws the hall as surveyed — the walls' scanned relief, the drawn oak floor,
// the coffered ceiling and the dome, each coloured by the scan's photographs
// with baked light — with the scan's gilt and bronze chandeliers and their
// flame bulbs, and the dollhouse cutaway (with the walls' cut bodies) that
// lets the planner look in from above. Under the real sky its windows open
// onto the drawn city through panes of glass that reflect the room, behind
// the measured glazing bars (hall-glazing.ts). Its real lights are HallLightRig,
// mounted beside it; its reflections are its own, captured from the room
// itself (hall-capture.ts).
// The relief and the photographs stream in after the first frame (flat walls
// in their average colour until then). Everything here renders on demand:
// frames are requested only while a mood blends or the cutaway eases.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Vector3, type Material, type Mesh, type Texture } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { color, lights, mix, normalWorld, uniform, vec3 } from "three/tsl";
import { hallGeometry, hallThresholdGeometry, hallWallGeometry } from "./hall-geometry.js";
import { loadWallRelief, type WallRelief } from "./hall-relief.js";
import { hallChandeliers } from "./hall-chandeliers.js";
import { paintHallTextures, disposeHallTextures, type HallTextures } from "./hall-textures.js";
import { HALL_PHOTO_COUNT, HallPhotos } from "./hall-photos.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useHallFinish, type HallFinish } from "./hall-finish.js";
import { createHallCasterMaterials, createHallMaterials, disposeHallMaterials, HallGlazingUniforms, HallSectionUniforms, type HallCasterMaterials } from "./hall-materials.js";
import { buildGlazingPanes, createGlassMaterial, GLASS_PRESETS, parseGlassPreset, withGlazingClosed } from "./hall-glazing.js";
import { HALL_MOODS, HallMoodUniforms, hallFrameStep, moodEase, type HallMoodName, type HallMoodSpec } from "./hall-mood.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WALLS, HALL_ELEVATION, type HallWall } from "./hall-spec.js";
import { resetSceneGrade, setSceneGrade } from "../../lib/scene-grade.js";
import { setCandleLight } from "../../lib/event-light.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { HALL_CAPTURE_POINT, HallEnvironmentCapture } from "./hall-capture.js";
import { createHallSection, parseSectionPreset, SECTION_PRESETS, type HallSection, type SectionPreset } from "./hall-section.js";
import { SELECTION_PICK_IGNORED } from "../../lib/raycast-gate.js";
import { hallSkyState } from "./hall-sky-runtime.js";
import { HALL_SUN_CASTER_LAYER, hallSun, hallSunMapSize, withoutSunMapDraw, type HallSun } from "./hall-sun.js";

/** The dark the drawn hall stands in (the planner's background around it). */
export const HALL_VOID = "#120e0b";

/** The room itself is never selected, so a press does not test its triangles. */
const HALL_USER_DATA = { [SELECTION_PICK_IGNORED]: true };

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
  /**
   * Lit by the real sun and moon (HallSky, HallSunLight): every surface takes
   * their direct, shadowed light, and the room casts its shadows.
   */
  readonly sunlit?: boolean;
  /**
   * The scene pass is multisampled (a phone's profile): the windows' glass,
   * cut from the walls under the real sky, gets a smooth edge from alpha to
   * coverage.
   */
  readonly multisampled?: boolean;
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

/** How far below the camera's eye a wall it stands behind is cut. */
const EYE_CLEARANCE = 0.6;

/**
 * The cut height for one wall seen from `camera` in `view`. In the overview,
 * walls the camera stands behind drop to the dado rail and the far walls keep
 * their full height, so the room reads tall while the floor stays open. A wall
 * the camera stands behind also stays below its eye: a phone orbiting at eye
 * height crosses the long walls a metre or two out, where the eased cut alone
 * still stood above the camera and its dark body filled the view.
 */
export function wallCutHeight(view: Exclude<HallView, "auto">, wall: HallWall, camera: readonly [number, number, number]): number {
  if (view === "walk") return HALL_CUTS.none;
  if (view === "plan") return HALL_CUTS.plan;
  // Distance of the camera behind the wall's plane (positive outside the room).
  const behind = -((camera[0] - wall.origin[0]) * wall.normal[0] + (camera[2] - wall.origin[2]) * wall.normal[2]);
  const t = Math.max(0, Math.min(1, (behind + 1.5) / 4));
  const eased = t * t * (3 - 2 * t);
  const cut = HALL_HEIGHT + 0.2 + (HALL_CUTS.near - HALL_HEIGHT - 0.2) * eased;
  if (behind <= 0) return cut;
  return Math.max(0.05, Math.min(cut, camera[1] - EYE_CLEARANCE));
}

interface HallResources {
  readonly textures: HallTextures;
  readonly photos: HallPhotos;
  readonly mood: HallMoodUniforms;
  readonly section: HallSectionUniforms;
  /** Whether the windows' glass is open onto the drawn city (hall-glazing.ts). */
  readonly glazing: HallGlazingUniforms;
  readonly materials: ReturnType<typeof createHallMaterials>;
  readonly chandelierMaterials: ReadonlyMap<string, Material>;
  /** How far the chandeliers' metal is lit by its own lamps (1 with the reflection map). */
  readonly selfLit: { value: number };
  /** The bulbs' brightness: 1 on screen, CAPTURED_BULBS in the room's reflections. */
  readonly bulbScale: { value: number };
  /** The walls' bodies (cut in the shader) and the plinth. */
  readonly cutaway: HallSection;
  /** Stand-ins the sun's shadow camera draws for the room, where the sun lights it. */
  readonly casters: HallCasterMaterials | null;
}

/** The chandeliers' own light on their metal where no reflection map gives it anything to mirror. */
const SELF_LIT_WITHOUT_REFLECTIONS = 2.5;

/**
 * The bulbs' brightness in the room's captured reflections. The capture point
 * stands beneath the dome fitting, whose bulbs would otherwise fill the
 * reflections' sky and burn out every gilt surface facing it; at this level
 * they glint in the metal and varnish, and the furniture's direct light
 * stays the point lights' alone.
 */
const CAPTURED_BULBS = 0.5;

/**
 * One number that moves with a mood's light (the channels' strengths and the
 * exposure), so reflections are recaptured only when the light has changed.
 */
function moodSignature(mood: HallMoodSpec): number {
  return mood.ambientIntensity + mood.chandelierIntensity * 1.3 + mood.daylightIntensity * 1.7
    + mood.uplightIntensity * 1.1 + mood.skyIntensity * 0.7 + mood.exposure * 2.3 + mood.glow;
}

/**
 * Whether light of `signature` differs enough to show from `captured`, the
 * light the reflections were last captured in. With none recorded (no
 * capture yet, or the last one in a mood's light rather than the sky's) it
 * always does.
 */
export function reflectionsOutdated(signature: number, captured: number | null): boolean {
  return captured === null || Math.abs(signature - captured) > 0.01;
}

/**
 * Frames a capture waits for the main pass to draw a pending sun map, so it
 * reflects the map of the whole scene at this moment rather than the last
 * one; past this it goes ahead with whatever map there is.
 */
const CAPTURE_SUN_MAP_WAITS = 2;

function createResources(quality: number, initialMood: HallMoodSpec, sun: HallSun | null, multisampled: boolean, sectionPreset: SectionPreset): HallResources {
  const textures = paintHallTextures(quality);
  const photos = new HallPhotos();
  const mood = new HallMoodUniforms();
  mood.apply(initialMood, initialMood, 1);
  const section = new HallSectionUniforms();
  const glazing = new HallGlazingUniforms();
  const materials = createHallMaterials(textures, photos, mood, section, sun, { glazing, alphaToCoverage: multisampled });
  const casters = sun === null ? null : createHallCasterMaterials(photos);

  // As scanned: pale silver-gilt fittings on dark bronze stems, and white
  // bulbs, which warm with the mood's chandelier light.
  const warm = mood.chandelier.rgb;
  const ambient = mood.ambient.rgb.mul(mood.ambientIntensity);
  // Flame bulbs: warm white, warming further with the mood's chandelier light.
  const bulbWhite = mix(vec3(1.0, 0.95, 0.86), warm, 0.2);
  // Gilt brass, as the panoramas show it: a metal's colour is its
  // reflectance, here in linear light, close to gold leaf's (1, 0.77, 0.34).
  const gilt = vec3(0.98, 0.75, 0.36);
  // Lit by its own lamps; faces turned down, away from them and from the lit
  // room above, fall dark, as the fittings' undersides do in the scan. The
  // scan's foliage reads as a mass through that contrast, deep shadow between
  // bright leaves.
  const facingUp = normalWorld.y.mul(0.65).add(0.35).max(0.05);
  // Without the reflection map (a software rasteriser) the metal has nothing
  // to mirror, so its own light carries more of its brightness; the finish
  // sets this (below).
  const selfLit = uniform(1);
  const giltMetal = new MeshStandardNodeMaterial({ roughness: 0.22, metalness: 1 });
  giltMetal.colorNode = gilt;
  // Each gilt surface sits centimetres from a bulb, light no reflection map
  // seen from the room's centre can carry; this stands in for it.
  giltMetal.emissiveNode = gilt.mul(bulbWhite.mul(mood.glow.mul(0.42)).add(ambient.mul(0.12))).mul(facingUp).mul(selfLit);
  const darkBronze = color("#4f4234").rgb;
  const bronze = new MeshStandardNodeMaterial({ roughness: 0.42, metalness: 1 });
  bronze.colorNode = darkBronze;
  bronze.emissiveNode = darkBronze.mul(ambient.mul(0.35)).mul(selfLit);
  // The metal takes the room's reflections and its own lamps' light, not the
  // point light standing in for each whole fitting (HallLightRig): a few
  // centimetres from it, inverse-square falloff turned the gilt white.
  const fittingLights = lights([]);
  giltMetal.lightsNode = fittingLights;
  bronze.lightsNode = fittingLights;
  // Bright enough for the pipeline's bloom to halo each bulb: the glow is the
  // camera's, so a phone's pass draws it as a desktop's does, with no sprites.
  const bulbScale = uniform(1);
  const bulb = new MeshBasicNodeMaterial();
  bulb.colorNode = bulbWhite.mul(mood.glow.mul(4).add(0.6)).mul(bulbScale);
  const chandelierMaterials = new Map<string, Material>([["gilt", giltMetal], ["bronze", bronze], ["bulb", bulb]]);
  return { textures, photos, mood, section, glazing, materials, chandelierMaterials, selfLit, bulbScale, cutaway: createHallSection(section, mood, sectionPreset), casters };
}

function disposeResources(resources: HallResources): void {
  disposeHallTextures(resources.textures);
  resources.photos.dispose();
  disposeHallMaterials(resources.materials);
  for (const material of resources.chandelierMaterials.values()) material.dispose();
  resources.cutaway.dispose();
  resources.casters?.glazed.dispose();
  resources.casters?.solid.dispose();
}

let paneGeometry: ReturnType<typeof buildGlazingPanes> | null = null;

/** The windows' panes, built once and shared: they never change. */
function glazingPanes(): ReturnType<typeof buildGlazingPanes> {
  paneGeometry ??= buildGlazingPanes();
  return paneGeometry;
}

export function GrandHallModel({ mood, view, finish: finishOverride, overviewChandeliers = true, moodSeconds = 1.6, sunlit = false, multisampled = false }: GrandHallModelProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => hallGeometry(), []);
  const [relief, setRelief] = useState<WallRelief | null>(null);
  const walls = useMemo(() => hallWallGeometry(relief), [relief]);
  const chandeliers = useMemo(() => hallChandeliers(), []);
  const deviceFinish = useHallFinish();
  const { photoQuality: quality, liveLight } = finishOverride ?? deviceFinish;
  const sun = useMemo(() => (sunlit ? hallSun(hallSunMapSize(quality, liveLight)) : null), [liveLight, quality, sunlit]);
  // The section's finish: `?section=` (Ashlar by default; nothing is remembered).
  const sectionPreset = useMemo(() => SECTION_PRESETS[parseSectionPreset(typeof window === "undefined" ? null : window.location.search)], []);
  const resources = useMemo(() => createResources(quality, HALL_MOODS[mood], sun, multisampled, sectionPreset), [multisampled, quality, sectionPreset, sun]);
  const thresholds = useMemo(() => hallThresholdGeometry(), []);
  // The mood resources were created with is applied directly; later moods blend.
  const blend = useRef<{ from: HallMoodSpec; to: HallMoodSpec; t: number; started: boolean } | null>(null);
  const settledMood = useRef<HallMoodName>(mood);
  /** The published sky last applied, and the sky's light the reflections were last captured in. */
  const skyVersion = useRef(-1);
  const capturedSignature = useRef<number | null>(null);
  /** Frames the waiting capture has given the sun's pending map. */
  const captureWaits = useRef(0);
  const cutState = useRef<number[]>([HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none, HALL_CUTS.none]);
  const cutsEasing = useRef(false);
  const resolvedView = useRef<Exclude<HallView, "auto">>(view === "auto" ? "overview" : view);
  const chandelierGroup = useRef<import("three").Group | null>(null);
  const chandeliersShown = useRef(false);
  // Hidden fittings draw vanishingly small for their first frames, so their
  // shaders compile while the room loads, not when the camera first comes
  // down to them (a half-second stall in the middle of a zoom otherwise).
  const chandelierWarmFrames = useRef(4);
  const room = useRef<import("three").Group | null>(null);
  const lookDirection = useMemo(() => new Vector3(), []);
  // The room's own environment, recaptured whenever a surface or a mood settles.
  // A finish without live light (a software rasteriser) has no reflection map:
  // six cube faces and their blur passes would run on the CPU at every settle.
  const captureNeeded = useRef(true);
  const environment = useMemo(() => {
    const renderer = getNativeRenderer(gl);
    return renderer === null || !liveLight ? null : new HallEnvironmentCapture(renderer, new Color(HALL_VOID));
  }, [gl, liveLight]);

  useEffect(() => () => { disposeResources(resources); }, [resources]);

  // The windows: under the real sky their glass opens onto the drawn city and
  // its panes reflect the room (hall-glazing.ts). The panes need the room's
  // captured reflections, so they appear with the first capture.
  const panes = useRef<Mesh | null>(null);
  const [reflection, setReflection] = useState<Texture | null>(null);
  const glassPreset = useMemo(() => GLASS_PRESETS[parseGlassPreset(typeof window === "undefined" ? null : window.location.search)], []);
  const glass = useMemo(() => (sunlit && reflection !== null
    ? createGlassMaterial({ environment: reflection, capturePoint: HALL_CAPTURE_POINT, photos: resources.photos, section: resources.section, preset: glassPreset })
    : null), [glassPreset, reflection, resources, sunlit]);
  useEffect(() => () => { glass?.material.dispose(); }, [glass]);
  useEffect(() => {
    resources.glazing.set(sunlit);
    invalidate();
  }, [invalidate, resources, sunlit]);
  useEffect(() => { setReflection(null); }, [environment]);

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
      // A photograph arriving changes what the light falls on, and the walls'
      // glazing (its alpha) decides where the sun comes through.
      if (loaded) { captureNeeded.current = true; sun?.redraw(); invalidate(); }
    });
    loadWallRelief().then((loaded) => {
      if (!live) return;
      setRelief(loaded);
      useHallViewStore.getState().settleSurface(true);
      captureNeeded.current = true;
      sun?.redraw();
      invalidate();
    }, () => {
      // Without the relief the walls stay flat photographs.
      if (live) useHallViewStore.getState().settleSurface(false);
    });
    return () => {
      live = false;
      useHallViewStore.getState().endSurfaces();
    };
  }, [invalidate, quality, resources, sun]);

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
    // The real sky, where it drives the hall, replaces the moods: its light is
    // applied as published; reflections are recaptured once the sun is at rest
    // and only if the light has changed enough to show.
    const sky = hallSkyState.sky;
    if (sky !== null && skyVersion.current !== hallSkyState.version) {
      skyVersion.current = hallSkyState.version;
      blend.current = null;
      resources.mood.apply(sky.mood, sky.mood, 1);
      state.gl.toneMappingExposure = resources.mood.exposure;
      setSceneGrade(resources.mood.whiteBalance, resources.mood.saturation);
      setCandleLight(resources.mood.candles);
      if (!hallSkyState.moving && reflectionsOutdated(moodSignature(sky.mood), capturedSignature.current)) {
        captureNeeded.current = true;
      }
    }
    const active = sky === null ? blend.current : null;
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
    // The capture renders the room on a private stage, which must never draw
    // the sun's shared map (hall-sun.ts): a map waiting to be redrawn is left
    // to this frame's main pass, and the capture follows on the next.
    const roomGroup = room.current;
    if (environment !== null && captureNeeded.current && blend.current === null && !hallSkyState.moving && roomGroup !== null) {
      if (sun !== null && sun.light.shadow.needsUpdate && captureWaits.current < CAPTURE_SUN_MAP_WAITS) {
        captureWaits.current += 1;
      } else {
        captureNeeded.current = false;
        captureWaits.current = 0;
        for (let index = 0; index < cutState.current.length; index++) resources.section.set(index, HALL_CUTS.none);
        const fittings = chandelierGroup.current;
        const shownBefore = fittings?.visible ?? false;
        const scaleBefore = fittings?.scale.x ?? 1;
        if (fittings !== null) { fittings.visible = true; fittings.scale.setScalar(1); }
        resources.bulbScale.value = CAPTURED_BULBS;
        try {
          const captured = withGlazingClosed(resources.glazing, panes.current, () => withoutSunMapDraw(sun, () => environment.capture(roomGroup)));
          state.scene.environment = captured;
          state.scene.environmentIntensity = resources.mood.reflections;
          if (reflection !== captured) setReflection(captured);
          // The light it was captured in, so a later sky recaptures only once it differs.
          capturedSignature.current = sky === null ? null : moodSignature(sky.mood);
        } catch {
          // Without its own reflections the room keeps the previous environment.
        } finally {
          resources.bulbScale.value = 1;
          if (fittings !== null) { fittings.visible = shownBefore; fittings.scale.setScalar(scaleBefore); }
        }
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
      const shown = chandeliersShown.current;
      const show = effective === "walk" || (effective === "overview" && overviewChandeliers
        && (shown ? camera[1] < 11.5 : camera[1] < 10.5));
      if (shown !== show) { chandeliersShown.current = show; moving = true; }
      const warming = !show && chandelierWarmFrames.current > 0;
      if (warming) { chandelierWarmFrames.current -= 1; moving = true; }
      group.visible = show || warming;
      group.scale.setScalar(show ? 1 : 1e-4);
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
    // The walls' bodies follow the cuts in their shader (hall-wall-body.ts).
    if (moving) invalidate();
  });

  return (
    <group ref={room} name="grand-hall" userData={HALL_USER_DATA}>
      {[...geometry.geometries].map(([key, part]) => {
        const material = resources.materials.get(key);
        if (material === undefined) return null;
        return <mesh key={key} name={`grand-hall-${key}`} geometry={part} material={material} frustumCulled={false} receiveShadow={sun !== null} />;
      })}
      {[...walls.geometries].map(([key, part]) => {
        const material = resources.materials.get(key);
        if (material === undefined) return null;
        return <mesh key={`walls-${key}`} name={`grand-hall-walls-${key}`} geometry={part} material={material} frustumCulled={false} receiveShadow={sun !== null} />;
      })}
      {resources.casters !== null && (
        <group name="grand-hall-sun-casters">
          {[...geometry.geometries, ...walls.geometries].filter(([key]) => key !== "floor").map(([key, part], index) => (
            <mesh
              key={`caster-${String(index)}-${key}`}
              geometry={part}
              material={key === "wallPhoto" || key === "wallPhotoGloss" ? resources.casters?.glazed : resources.casters?.solid}
              layers={HALL_SUN_CASTER_LAYER}
              castShadow
              frustumCulled={false}
              raycast={() => undefined}
            />
          ))}
        </group>
      )}
      <group ref={chandelierGroup} name="grand-hall-chandeliers" visible={false}>
        {[...chandeliers.geometries].map(([key, part]) => (
          <mesh key={key} name={`chandelier-${key}`} geometry={part} material={resources.chandelierMaterials.get(key)} />
        ))}
      </group>
      {glass !== null && (
        <mesh
          ref={panes}
          name="grand-hall-glazing-panes"
          geometry={glazingPanes()}
          material={glass.material}
          frustumCulled={false}
          raycast={() => undefined}
        />
      )}
      <mesh name="grand-hall-plinth" geometry={resources.cutaway.plinth} material={resources.cutaway.materials.plinth} />
      <mesh name="grand-hall-wall-body" geometry={resources.cutaway.body} material={resources.cutaway.materials.body} raycast={() => undefined} />
      {[...thresholds.geometries].map(([key, part]) => {
        const material = resources.materials.get(key);
        if (material === undefined) return null;
        return <mesh key={`thresholds-${key}`} name="grand-hall-thresholds" geometry={part} material={material} frustumCulled={false} receiveShadow={sun !== null} />;
      })}
    </group>
  );
}
