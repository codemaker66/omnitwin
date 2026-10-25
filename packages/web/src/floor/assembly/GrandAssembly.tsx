// ---------------------------------------------------------------------------
// GrandAssembly — plays the Grand Assembly (Accio) in the drawn Grand Hall.
//
// PlannerScene mounts it only where this device asks for it (`?assembly=accio`,
// flag.ts) and the drawn hall is on screen. When a saved layout opens (or a
// replay is asked for, recall.ts) it holds the room empty with the camera at
// the Assembly's opening view, waits a beat for the hall's surfaces, then
// plays: every frame it draws the show's frame through the presentation
// channel (instanced models, shadows and candles follow it), moves the
// `furniture-<id>` groups (cloths, settings, name plates) by the same change,
// raises the windows' light, and places the camera. It owns the camera
// through CameraRig's `suspended` prop (onCamera) and hands it back at the
// final framing, inside the orbit's limits.
//
// The placement store is never written. Skip (a click, a tap or Escape) and
// cancel (the layout changes, another opens, the planner leaves) both snap
// every piece to its saved transform at once; reduced motion skips the show.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Mesh, PlaneGeometry, Vector3, type Object3D } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { float, min, smoothstep, uniform, uv, vec3 } from "three/tsl";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { publishFurnitureSettleFrame } from "../../lib/furniture-motion.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { presentedPiece, publishFurniturePresentation, type PresentationFrame } from "../presentation-channel.js";
import { ACCIO_CAMERA_LANDSCAPE, ACCIO_CAMERA_PORTRAIT, accioWindows, type AccioWindow } from "./accio.js";
import { assemblySeed, createAssemblyShow, type AssemblyShow } from "./show.js";
import type { CameraPose } from "./engine.js";
import { EMPTY_ROOM, consumeAssemblyRequest, releaseHold, takeHold, useAssemblyRecallStore } from "./recall.js";

/** A beat of the empty hall before the first piece comes, ms. */
const EMPTY_BEAT_MS = 450;
/** The longest the Assembly waits for the hall's surfaces before it plays anyway, ms. */
const SURFACES_WAIT_MS = 4500;
/** The longest step a frame advances the show, seconds: a dropped frame, never a pause. */
const LONGEST_STEP = 0.1;
/** Below this landscape aspect the Assembly frames the hall down its length, as the planner does. */
const PORTRAIT_BELOW = 1.2;
/** A show that plays to its end holds its last frame this long before the planner's working layers return, seconds of show time. */
const HELD_ENDING = 1.2;

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "holding"; readonly since: number; readonly configId: string | null; readonly portrait: boolean }
  | { readonly kind: "playing"; readonly show: AssemblyShow; time: number; readonly manual: boolean; fresh: boolean };

export interface AssemblyPlayOptions {
  readonly seed: number;
  /** Wait for setTime instead of following the frame loop (captures). */
  readonly manual: boolean;
  readonly reducedMotion?: boolean;
  readonly portrait?: boolean;
}

/** What a capture harness drives (capture-bridge.ts, development only). */
export interface AssemblyDirector {
  /** A show over the furniture as placed now, from its first tick. */
  play(options: AssemblyPlayOptions): AssemblyShow | null;
  /** Draw the show at this time on the next frame (manual shows). */
  setTime(seconds: number): void;
  skip(): void;
  cancel(): void;
  show(): AssemblyShow | null;
  /** The last frame's playback step and writes, ms. */
  lastApplyMs(): number;
  /** Frames drawn since the Assembly mounted. */
  frames(): number;
}

function orbitTarget(controls: unknown): Vector3 | null {
  if (typeof controls !== "object" || controls === null || !("target" in controls)) return null;
  const { target } = controls;
  return target instanceof Vector3 ? target : null;
}

/** No planner glide may move the camera the Assembly holds, or carry it off when it hands back. */
function dropQueuedGlides(): void {
  const bookmarks = useBookmarkStore.getState();
  if (bookmarks.transition !== null || bookmarks.pendingNavigationId !== null) {
    useBookmarkStore.setState({ transition: null, pendingNavigationId: null });
  }
}

function restGroup(group: Object3D): void {
  group.matrixAutoUpdate = true;
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(1, 1, 1);
  group.updateMatrix();
  group.visible = true;
}

// --- The windows' light -----------------------------------------------------------

function levelUniform() {
  return uniform(0);
}

interface WindowLight {
  readonly window: AccioWindow;
  readonly level: ReturnType<typeof levelUniform>;
  readonly meshes: readonly Mesh[];
}

/** Warm gold: the light the pieces are summoned out of. */
const WINDOW_LIGHT = [1.0, 0.7, 0.34] as const;
/** The pane's brightness at full light, and the glow it throws into the reveal. */
const PANE_LEVEL = 2.0;
const HALO_LEVEL = 0.55;

function createWindowLights(windows: readonly AccioWindow[]): WindowLight[] {
  return windows.map((window) => {
    const level = levelUniform();
    const coords = uv();
    const edge = min(min(coords.x, coords.y), min(float(1).sub(coords.x), float(1).sub(coords.y)));
    const pane = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    pane.colorNode = vec3(...WINDOW_LIGHT).mul(smoothstep(0, 0.16, edge).mul(level).mul(PANE_LEVEL));
    pane.name = "assembly-window-light";
    const radial = coords.sub(0.5).length().mul(2);
    const halo = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    halo.colorNode = vec3(...WINDOW_LIGHT).mul(float(1).sub(smoothstep(0, 1, radial)).pow(2).mul(level).mul(HALO_LEVEL));
    halo.name = "assembly-window-halo";
    const height = window.top - window.sill;
    const middle = (window.top + window.sill) / 2;
    const paneMesh = new Mesh(new PlaneGeometry(window.width * 0.92, height), pane);
    paneMesh.position.set(window.x, middle, window.glassZ + 0.03);
    const haloMesh = new Mesh(new PlaneGeometry(window.width * 1.35, height * 1.2), halo);
    haloMesh.position.set(window.x, middle, window.glassZ + 0.42);
    for (const mesh of [paneMesh, haloMesh]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.raycast = () => undefined;
      mesh.renderOrder = 2;
    }
    return { window, level, meshes: [paneMesh, haloMesh] };
  });
}

function disposeWindowLights(lights: readonly WindowLight[]): void {
  for (const light of lights) {
    for (const mesh of light.meshes) {
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
  }
}

// --- The director ---------------------------------------------------------------------

export interface GrandAssemblyProps {
  /** Told when the Assembly takes the camera from the planner's rig, and when it gives it back. */
  readonly onCamera: (owned: boolean) => void;
}

export function GrandAssembly({ onCamera }: GrandAssemblyProps): ReactElement {
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const scene = useThree((state) => state.scene);
  const stage = useRef<Stage>({ kind: "idle" });
  const groups = useRef(new Map<string, Object3D>());
  const touched = useRef(new Set<string>());
  const applyMs = useRef(0);
  const framesDrawn = useRef(0);
  /** The windows' light is drawn, at nothing, for its first frames, so its shaders compile before any show. */
  const warmFrames = useRef(4);
  /** The framing to hold until CameraRig has taken the camera back. */
  const handback = useRef<CameraPose | null>(null);
  /** The held ending, on the show's clock: the planner's working layers return at `until`. */
  const ending = useRef<{ time: number; readonly until: number; readonly manual: boolean } | null>(null);

  /** The planner's chrome, working overlays and the replay control come back. */
  const returnPlanner = useCallback((): void => {
    ending.current = null;
    useCockpitStore.getState().setCameraInteractionActive(false);
    useAssemblyRecallStore.setState({ active: false });
  }, []);
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const request = useAssemblyRecallStore((state) => state.request);
  const lights = useMemo(() => createWindowLights(accioWindows()), []);
  useEffect(() => () => { disposeWindowLights(lights); }, [lights]);

  const findGroup = useCallback((id: string): Object3D | undefined => {
    const cached = groups.current.get(id);
    if (cached !== undefined && cached.parent !== null) return cached;
    const found = scene.getObjectByName(`furniture-${id}`);
    if (found === undefined) groups.current.delete(id);
    else groups.current.set(id, found);
    return found;
  }, [scene]);

  /** The `furniture-<id>` groups follow the frame as the channel's followers do. */
  const moveGroups = useCallback((frame: PresentationFrame | null): void => {
    const moved = touched.current;
    if (frame === null) {
      for (const id of moved) {
        const group = findGroup(id);
        if (group !== undefined) restGroup(group);
      }
      moved.clear();
      return;
    }
    for (const item of usePlacementStore.getState().placedItems) {
      const shown = presentedPiece(frame, item.id);
      if (shown === null) {
        if (!moved.delete(item.id)) continue;
        const group = findGroup(item.id);
        if (group !== undefined) restGroup(group);
        continue;
      }
      const group = findGroup(item.id);
      if (group === undefined) continue;
      group.matrixAutoUpdate = false;
      if (shown === "hidden") {
        group.visible = false;
      } else {
        group.visible = true;
        group.matrix.copy(shown.delta);
      }
      group.matrixWorldNeedsUpdate = true;
      moved.add(item.id);
    }
  }, [findGroup]);

  const placeCamera = useCallback((pose: CameraPose): void => {
    const state = get();
    state.camera.position.set(...pose.position);
    orbitTarget(state.controls)?.set(...pose.target);
    state.camera.lookAt(...pose.target);
    state.camera.updateMatrixWorld();
  }, [get]);

  const setLights = useCallback((show: AssemblyShow | null): void => {
    for (const light of lights) {
      const level = show?.light(light.window.id) ?? 0;
      light.level.value = level;
      // Drawn whenever a show is on, even at nothing (it is additive), so its
      // shaders are ready before the light first rises.
      for (const mesh of light.meshes) mesh.visible = show !== null;
    }
  }, [lights]);

  const isPortrait = useCallback((): boolean => {
    const { size } = get();
    return size.width / Math.max(1, size.height) < PORTRAIT_BELOW;
  }, [get]);

  /**
   * Everything to its saved transform now; the camera to `cameraTo`, or left
   * where it is. A show that played to its end (`held`) keeps the room clear
   * of the planner's working layers for a beat; skip and cancel return them
   * at once, since the person wants to work.
   */
  const finish = useCallback((cameraTo: CameraPose | null, held: { readonly time: number; readonly manual: boolean } | null = null): void => {
    const wasActive = stage.current.kind !== "idle";
    stage.current = { kind: "idle" };
    // A glide queued while the Assembly held the camera would carry it off its final framing.
    if (wasActive) dropQueuedGlides();
    publishFurniturePresentation(null);
    moveGroups(null);
    setLights(null);
    publishFurnitureSettleFrame([]);
    if (cameraTo !== null) placeCamera(cameraTo);
    if (wasActive) {
      // Hand the camera back where it is. CameraRig resumes in a React commit
      // between frames that re-aims its orbit at the planner's opening target
      // (and, while suspended, it drops any glide queued for it); the frames
      // until that commit has landed (its controls enabled again) keep this
      // framing, so the planner carries on from it without a jump.
      const state = get();
      const target = orbitTarget(state.controls);
      handback.current = {
        position: [state.camera.position.x, state.camera.position.y, state.camera.position.z],
        target: target === null ? cameraTo?.target ?? [0, 0, 0] : [target.x, target.y, target.z],
      };
      onCameraRef.current(false);
      if (held === null) returnPlanner();
      else ending.current = { time: held.time, until: held.time + HELD_ENDING, manual: held.manual };
    }
    invalidate();
  }, [get, invalidate, moveGroups, placeCamera, returnPlanner, setLights]);

  const finalFraming = useCallback((portrait: boolean): CameraPose | null => {
    const keys = portrait ? ACCIO_CAMERA_PORTRAIT : ACCIO_CAMERA_LANDSCAPE;
    const last = keys[keys.length - 1];
    return last === undefined ? null : { position: [...last.position], target: [...last.target] };
  }, []);

  const skip = useCallback((): void => {
    const current = stage.current;
    if (current.kind === "idle") {
      // During the held ending: the planner, at once.
      if (ending.current !== null) returnPlanner();
      return;
    }
    if (current.kind === "holding") {
      finish(finalFraming(current.portrait));
      return;
    }
    current.show.skip();
    finish(current.show.camera());
  }, [finalFraming, finish, returnPlanner]);

  const cancel = useCallback((): void => {
    const current = stage.current;
    if (current.kind === "idle") return;
    if (current.kind === "playing") current.show.cancel();
    finish(null);
  }, [finish]);

  const begin = useCallback((): void => {
    // The Assembly owns the camera now: a glide under way or queued is dropped.
    handback.current = null;
    ending.current = null;
    dropQueuedGlides();
    useSelectionStore.getState().clearSelection();
    // The planner's working overlays and chrome step back, as for a camera move.
    useCockpitStore.getState().setCameraInteractionActive(true);
    useAssemblyRecallStore.setState({ active: true });
    onCameraRef.current(true);
  }, []);

  const play = useCallback((options: AssemblyPlayOptions): AssemblyShow | null => {
    const items = usePlacementStore.getState().placedItems;
    const portrait = options.portrait ?? isPortrait();
    const show = createAssemblyShow(items, { seed: options.seed, reducedMotion: options.reducedMotion, portrait });
    if (stage.current.kind === "idle") begin();
    stage.current = { kind: "playing", show, time: 0, manual: options.manual, fresh: true };
    if (show.done()) {
      finish(null);
      return show;
    }
    invalidate();
    return show;
  }, [begin, finish, invalidate, isPortrait]);

  // A layout opened, or a replay asked for: hold the room empty at the opening view.
  useEffect(() => {
    if (request === null) return;
    consumeAssemblyRequest(request);
    takeHold();
    if (prefersReducedMotion()) {
      // Reduced motion: the layout is simply there.
      releaseHold();
      return;
    }
    if (stage.current.kind === "playing") stage.current.show.cancel();
    const portrait = isPortrait();
    if (stage.current.kind === "idle") begin();
    stage.current = { kind: "holding", since: performance.now(), configId: request.configId ?? useEditorStore.getState().configId, portrait };
    publishFurniturePresentation(EMPTY_ROOM);
    moveGroups(EMPTY_ROOM);
    const opening = (portrait ? ACCIO_CAMERA_PORTRAIT : ACCIO_CAMERA_LANDSCAPE)[0];
    if (opening !== undefined) placeCamera({ position: [...opening.position], target: [...opening.target] });
    invalidate();
  }, [begin, invalidate, isPortrait, moveGroups, placeCamera, request]);

  // Skip: Escape (as an operation in the planner's Escape order), a click or a tap.
  useEscapeLayer("operation", { open: () => stage.current.kind !== "idle" || ending.current !== null, onEscape: skip });
  useEffect(() => {
    const canvasHost = (): HTMLElement | null => get().gl.domElement.parentElement;
    let swallowing: number | null = null;
    let swallowClick = false;
    const swallow = (event: Event): void => {
      event.stopPropagation();
      event.preventDefault();
    };
    const down = (event: PointerEvent): void => {
      if (stage.current.kind === "idle") {
        // A press during the held ending brings the planner back and is the planner's own.
        if (ending.current !== null) returnPlanner();
        return;
      }
      skip();
      // A press on the room only skips: it does not also select or start a drag.
      const host = canvasHost();
      if (host !== null && event.target instanceof Node && host.contains(event.target)) {
        swallow(event);
        swallowing = event.pointerId;
      }
    };
    const up = (event: PointerEvent): void => {
      if (swallowing !== event.pointerId) return;
      swallow(event);
      swallowing = null;
      swallowClick = true;
    };
    const click = (event: MouseEvent): void => {
      if (!swallowClick) return;
      swallowClick = false;
      swallow(event);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("click", click, true);
    };
  }, [get, returnPlanner, skip]);

  // Leaving (another room, walking, the timeline, a route change): the true state at once.
  const cancelOnLeave = useRef(cancel);
  cancelOnLeave.current = cancel;
  const returnOnLeave = useRef(returnPlanner);
  returnOnLeave.current = returnPlanner;
  useEffect(() => () => {
    cancelOnLeave.current();
    // A held ending still under way: its layers come back with the planner.
    if (ending.current !== null) returnOnLeave.current();
  }, []);

  // Development: the capture harness's handle (window.__assembly).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const director: AssemblyDirector = {
      play,
      setTime: (seconds) => {
        const current = stage.current;
        if (current.kind === "idle" && ending.current !== null) {
          ending.current.time = seconds;
          invalidate();
          return;
        }
        if (current.kind !== "playing") return;
        current.time = seconds;
        invalidate();
      },
      skip,
      cancel,
      show: () => (stage.current.kind === "playing" ? stage.current.show : null),
      lastApplyMs: () => applyMs.current,
      frames: () => framesDrawn.current,
    };
    let uninstall: (() => void) | null = null;
    let live = true;
    void import("./capture-bridge.js").then(({ installAssemblyBridge }) => {
      if (live) uninstall = installAssemblyBridge(director, get);
    });
    return () => {
      live = false;
      uninstall?.();
    };
  }, [cancel, get, invalidate, play, skip]);

  useFrame((_state, delta) => {
    framesDrawn.current += 1;
    if (warmFrames.current > 0) {
      warmFrames.current -= 1;
      // Additive light at level 0 adds nothing to the picture.
      for (const light of lights) for (const mesh of light.meshes) mesh.visible = warmFrames.current > 0 || stage.current.kind !== "idle";
      invalidate();
    }
    const current = stage.current;
    const held = handback.current;
    if (current.kind === "idle" && held !== null) {
      // Runs after the orbit's own update: this frame draws the held framing.
      placeCamera(held);
      const { controls } = get();
      const resumed = typeof controls === "object" && controls !== null && "enabled" in controls && controls.enabled === true;
      if (resumed) handback.current = null;
      else invalidate();
    }
    const closing = ending.current;
    if (current.kind === "idle" && closing !== null) {
      if (!closing.manual) closing.time += Math.min(delta, LONGEST_STEP);
      if (closing.time >= closing.until) {
        returnPlanner();
      } else {
        // The room holds still, clear of the planner's working layers.
        const cockpit = useCockpitStore.getState();
        if (!cockpit.cameraInteractionActive) cockpit.setCameraInteractionActive(true);
        if (!closing.manual) invalidate();
      }
    }
    if (current.kind === "idle") return;
    const started = performance.now();
    const cockpit = useCockpitStore.getState();
    if (!cockpit.cameraInteractionActive) cockpit.setCameraInteractionActive(true);
    if (current.kind === "holding") {
      // The windows' light is drawn, at nothing, while the room is held: its shaders compile now.
      for (const light of lights) {
        light.level.value = 0;
        for (const mesh of light.meshes) mesh.visible = true;
      }
      // Pieces arriving in the store while the room is held are held too.
      moveGroups(EMPTY_ROOM);
      const surfaces = useHallViewStore.getState().surfaces;
      const surfacesIn = surfaces !== null && (surfaces.total <= 0 || surfaces.loaded + surfaces.failed >= surfaces.total);
      const waited = started - current.since;
      const ready = usePlacementStore.getState().placedItems.length > 0
        && ((surfacesIn && waited >= EMPTY_BEAT_MS) || waited >= SURFACES_WAIT_MS);
      if (ready) play({ seed: assemblySeed(current.configId), manual: false, portrait: current.portrait });
      invalidate();
      return;
    }
    const { show } = current;
    // The layout changed under the show (an edit, a co-editor, another layout): its true state at once.
    if (usePlacementStore.getState().placedItems !== show.items) {
      cancel();
      return;
    }
    if (!current.manual) {
      // The waking frame's delta is the idle gap before it, not time the show has played.
      current.time += current.fresh ? 0 : Math.min(delta, LONGEST_STEP);
    }
    current.fresh = false;
    show.advanceTo(current.time);
    const frame = show.frame();
    if (frame === null) {
      finish(show.camera(), { time: current.time, manual: current.manual });
      applyMs.current = performance.now() - started;
      return;
    }
    publishFurniturePresentation(frame);
    moveGroups(frame);
    setLights(show);
    const camera = show.camera();
    if (camera !== null) placeCamera(camera);
    // The room's sun or moon shadows follow the pieces while they move (HallSunLight).
    publishFurnitureSettleFrame(show.playback.live());
    applyMs.current = performance.now() - started;
    if (!current.manual) invalidate();
  });

  return (
    <group name="grand-assembly">
      {lights.flatMap((light) => light.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />))}
    </group>
  );
}

export default GrandAssembly;
