import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RuntimeAssetCameraView } from "../../lib/runtime-package-resolution.js";
import {
  GRAND_HALL_NAVIGATION_PROFILE,
  clampGrandHallHumanPosition,
} from "../../lib/grand-hall-navigation-profile.js";
import type { GrandHallCameraMode } from "../../stores/cockpit-store.js";

export interface GrandHallCapturedCameraProps {
  readonly mode: GrandHallCameraMode;
  readonly view: RuntimeAssetCameraView;
  readonly smoothControls: boolean;
}

const DOLLHOUSE_TARGET = [
  0,
  GRAND_HALL_NAVIGATION_PROFILE.frontierBounds.max[1] / 2,
  0,
] as const;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampVectorToBounds(
  vector: Vector3,
  bounds: RuntimeAssetCameraView["cameraBounds"],
): boolean {
  if (bounds === null) return false;
  const x = clampNumber(vector.x, bounds.min[0], bounds.max[0]);
  const y = clampNumber(vector.y, bounds.min[1], bounds.max[1]);
  const z = clampNumber(vector.z, bounds.min[2], bounds.max[2]);
  if (x === vector.x && y === vector.y && z === vector.z) return false;
  vector.set(x, y, z);
  return true;
}

function configurePerspectiveCamera(
  camera: PerspectiveCamera,
  fov: number,
  near: number,
  far: number,
): void {
  camera.fov = fov;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}

function OrbitCapturedCamera({
  view,
  smoothControls,
  dollhouse,
}: {
  readonly view: RuntimeAssetCameraView;
  readonly smoothControls: boolean;
  readonly dollhouse: boolean;
}): ReactElement {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const target = dollhouse ? DOLLHOUSE_TARGET : view.target;
  const clampRuntimeCamera = useCallback((): void => {
    const controls = controlsRef.current;
    const targetChanged = controls === null
      ? false
      : clampVectorToBounds(controls.target, view.targetBounds);
    const cameraChanged = clampVectorToBounds(camera.position, view.cameraBounds);
    if (targetChanged || cameraChanged) controls?.update();
  }, [camera, view.cameraBounds, view.targetBounds]);

  useEffect(() => {
    if (dollhouse) {
      camera.position.set(0, GRAND_HALL_NAVIGATION_PROFILE.frontierBounds.max[1] + 24, 0.01);
    } else {
      camera.position.set(view.position[0], view.position[1], view.position[2]);
    }
    camera.lookAt(target[0], target[1], target[2]);
    if (camera instanceof PerspectiveCamera) {
      configurePerspectiveCamera(camera, dollhouse ? 45 : view.fov, 0.1, 200);
    }
    const controls = controlsRef.current;
    controls?.target.set(target[0], target[1], target[2]);
    clampRuntimeCamera();
    controls?.update();
    invalidate();
  }, [camera, clampRuntimeCamera, dollhouse, invalidate, target, view.fov, view.position]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      regress={smoothControls}
      enableDamping={smoothControls}
      dampingFactor={smoothControls ? view.dampingFactor : 0}
      target={target}
      minDistance={dollhouse ? 8 : view.minDistance}
      maxDistance={view.maxDistance}
      panSpeed={dollhouse ? 0.2 : view.panSpeed}
      rotateSpeed={view.rotateSpeed}
      zoomSpeed={view.zoomSpeed}
      minPolarAngle={dollhouse ? 0 : view.minPolarAngle}
      maxPolarAngle={dollhouse ? Math.PI * 0.42 : view.maxPolarAngle}
      onChange={() => {
        clampRuntimeCamera();
        invalidate();
      }}
    />
  );
}

const NAVIGATION_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"]);

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches("input, textarea, select, button, [role='textbox']"));
}

function HumanDiagnosticCamera(): null {
  const { camera, gl, invalidate } = useThree();
  const pressedKeys = useRef(new Set<string>());
  const dragging = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const nextPosition = useRef(new Vector3());

  useEffect(() => {
    const spawn = GRAND_HALL_NAVIGATION_PROFILE.diagnosticSpawn.position;
    camera.position.set(spawn[0], spawn[1], spawn[2]);
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, 0, 0);
    if (camera instanceof PerspectiveCamera) {
      const config = GRAND_HALL_NAVIGATION_PROFILE.humanCamera;
      configurePerspectiveCamera(camera, config.fov, config.near, config.far);
    }
    invalidate();
  }, [camera, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (!NAVIGATION_KEYS.has(key) || editableTarget(event.target)) return;
      event.preventDefault();
      pressedKeys.current.add(key);
      invalidate();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (pressedKeys.current.delete(event.key.toLowerCase())) invalidate();
    };
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (event.button !== 0) return;
      dragging.current = true;
      activePointerId.current = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: globalThis.PointerEvent): void => {
      if (!dragging.current || activePointerId.current !== event.pointerId) return;
      yaw.current -= event.movementX * 0.0022;
      pitch.current = MathUtils.clamp(
        pitch.current - event.movementY * 0.0022,
        -Math.PI * 0.47,
        Math.PI * 0.47,
      );
      camera.rotation.set(pitch.current, yaw.current, 0);
      invalidate();
    };
    const stopDragging = (event: globalThis.PointerEvent): void => {
      if (activePointerId.current !== event.pointerId) return;
      dragging.current = false;
      activePointerId.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onLostPointerCapture = (event: globalThis.PointerEvent): void => {
      if (activePointerId.current !== event.pointerId) return;
      dragging.current = false;
      activePointerId.current = null;
    };
    const clearDragging = (): void => {
      const pointerId = activePointerId.current;
      dragging.current = false;
      activePointerId.current = null;
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    };
    const clearKeys = (): void => {
      if (pressedKeys.current.size === 0) return;
      pressedKeys.current.clear();
      invalidate();
    };
    const clearInput = (): void => {
      clearKeys();
      clearDragging();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearInput);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);
    canvas.addEventListener("lostpointercapture", onLostPointerCapture);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearInput);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDragging);
      canvas.removeEventListener("pointercancel", stopDragging);
      canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
      pressedKeys.current.clear();
      clearDragging();
    };
  }, [camera, gl, invalidate]);

  useFrame((_state, delta) => {
    const keys = pressedKeys.current;
    if (keys.size === 0) return;
    const forward = Number(keys.has("w") || keys.has("arrowup"))
      - Number(keys.has("s") || keys.has("arrowdown"));
    const strafe = Number(keys.has("d") || keys.has("arrowright"))
      - Number(keys.has("a") || keys.has("arrowleft"));
    if (forward === 0 && strafe === 0) return;
    const length = Math.hypot(forward, strafe) || 1;
    const distance = GRAND_HALL_NAVIGATION_PROFILE.movementSpeedMps * Math.min(delta, 0.05);
    const forwardX = -Math.sin(yaw.current);
    const forwardZ = -Math.cos(yaw.current);
    const rightX = Math.cos(yaw.current);
    const rightZ = -Math.sin(yaw.current);
    nextPosition.current.set(
      camera.position.x + ((forward / length) * forwardX + (strafe / length) * rightX) * distance,
      camera.position.y,
      camera.position.z + ((forward / length) * forwardZ + (strafe / length) * rightZ) * distance,
    );
    const clamped = clampGrandHallHumanPosition([
      nextPosition.current.x,
      nextPosition.current.y,
      nextPosition.current.z,
    ]);
    camera.position.set(clamped[0], clamped[1], clamped[2]);
    invalidate();
  });

  return null;
}

export function GrandHallCapturedCamera({
  mode,
  view,
  smoothControls,
}: GrandHallCapturedCameraProps): ReactElement | null {
  if (mode === "human") return <HumanDiagnosticCamera />;
  return (
    <OrbitCapturedCamera
      view={view}
      smoothControls={smoothControls}
      dollhouse={mode === "dollhouse"}
    />
  );
}
