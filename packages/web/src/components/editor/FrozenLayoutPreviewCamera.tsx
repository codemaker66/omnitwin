import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { toRenderSpace } from "../../constants/scale.js";
import type { FrozenLayoutRoomModel } from "../../lib/frozen-layout-room.js";
import { applyCameraTourPose } from "../../lib/camera-tour-controls.js";
import { useEditorStore } from "../../stores/editor-store.js";

export interface FrozenLayoutPreviewCameraProps {
  readonly active: boolean;
  readonly room: FrozenLayoutRoomModel | null;
}

interface PreviewViewport {
  readonly left: number; readonly top: number; readonly width: number; readonly height: number;
  readonly canvasWidth: number; readonly canvasHeight: number;
}

const PREVIEW_DOCKS = ".reference-left-dock, .reference-inspector-dock, .cockpit-preview-lock, .cockpit-bottom, .planner-tool-pill, .layout-timeline-preview-caption";

/** Read actual visible dock rectangles; no device-width or timeline-height guess. */
export function readFrozenPreviewViewport(canvas: HTMLCanvasElement, width: number, height: number): PreviewViewport {
  const canvasRect = canvas.getBoundingClientRect();
  let left = 0, top = 0, right = width, bottom = height;
  const shell = canvas.closest(".cockpit-shell");
  for (const element of shell?.querySelectorAll(PREVIEW_DOCKS) ?? []) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
    if (rect.right <= canvasRect.left || rect.left >= canvasRect.left + width
      || rect.bottom <= canvasRect.top || rect.top >= canvasRect.top + height) continue;
    if (element.matches(".reference-left-dock")) left = Math.max(left, rect.right - canvasRect.left + 8);
    else if (element.matches(".reference-inspector-dock, .cockpit-preview-lock")) right = Math.min(right, rect.left - canvasRect.left - 8);
    else if (element.matches(".cockpit-bottom, .layout-timeline-preview-caption")) bottom = Math.min(bottom, rect.top - canvasRect.top - 8);
    else top = Math.max(top, rect.bottom - canvasRect.top + 8);
  }
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), canvasWidth: width, canvasHeight: height };
}

/** Fit actual frozen polygon bounds, including height, without live room data. */
export function fitFrozenLayoutPreviewCamera(camera: PerspectiveCamera, room: FrozenLayoutRoomModel, viewport?: PreviewViewport): Vector3 {
  const points = room.geometry.wallPolygon.map(([x, z]) => new Vector3(toRenderSpace(x), 0, toRenderSpace(z)));
  const min = new Vector3(Infinity, 0, Infinity);
  const max = new Vector3(-Infinity, room.geometry.ceilingHeight, -Infinity);
  for (const point of points) { min.min(point); max.max(point); }
  const centre = min.clone().add(max).multiplyScalar(0.5);
  const back = new Vector3(0.65, 1.4, 1).normalize();
  const right = new Vector3().crossVectors(camera.up, back).normalize();
  const up = new Vector3().crossVectors(back, right).normalize();
  const tanFullVertical = Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
  const tanVertical = tanFullVertical * (viewport === undefined ? 1 : viewport.height / viewport.canvasHeight);
  const tanHorizontal = tanFullVertical * camera.aspect * (viewport === undefined ? 1 : viewport.width / viewport.canvasWidth);
  let distance = 1;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const offset = new Vector3(x, y, z).sub(centre);
    const depth = offset.dot(back);
    distance = Math.max(distance,
      depth + Math.abs(offset.dot(right)) * 1.15 / tanHorizontal,
      depth + Math.abs(offset.dot(up)) * 1.15 / tanVertical);
  }
  camera.position.copy(centre).addScaledVector(back, distance);
  camera.lookAt(centre);
  camera.near = Math.min(0.1, distance / 100);
  camera.far = Math.max(200, distance + max.distanceTo(min) * 2);
  if (viewport !== undefined) camera.setViewOffset(viewport.canvasWidth, viewport.canvasHeight,
    viewport.canvasWidth / 2 - viewport.left - viewport.width / 2,
    viewport.canvasHeight / 2 - viewport.top - viewport.height / 2,
    viewport.canvasWidth, viewport.canvasHeight);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return centre;
}

interface LiveCameraSnapshot {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls | null;
  readonly target: Vector3 | null;
  readonly configId: string | null;
  readonly spaceId: string | null;
}

/** Mounted after live camera owners. It never changes live geometry or pose stores. */
export function FrozenLayoutPreviewCamera({ active, room }: FrozenLayoutPreviewCameraProps): null {
  const { camera, controls, size, gl, invalidate } = useThree();
  const saved = useRef<LiveCameraSnapshot | null>(null);
  const currentSize = useRef(size);
  currentSize.current = size;

  function restore(): void {
    const snapshot = saved.current;
    saved.current = null;
    if (snapshot === null || !(camera instanceof PerspectiveCamera)) return;
    const editor = useEditorStore.getState();
    if (snapshot.configId !== editor.configId || snapshot.spaceId !== editor.spaceId) return;
    const previous = snapshot.camera;
    camera.position.copy(previous.position);
    camera.quaternion.copy(previous.quaternion);
    camera.up.copy(previous.up);
    camera.fov = previous.fov;
    camera.zoom = previous.zoom;
    camera.near = previous.near;
    camera.far = previous.far;
    camera.focus = previous.focus;
    camera.filmGauge = previous.filmGauge;
    camera.filmOffset = previous.filmOffset;
    camera.view = previous.view === null ? null : { ...previous.view };
    // Preserve lens settings while accommodating a resize during the preview.
    camera.aspect = currentSize.current.width / Math.max(1, currentSize.current.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (snapshot.controls !== null && snapshot.target !== null) {
      snapshot.controls.target.copy(snapshot.target);
      // The live rig/Interior chooses its owner on the next frame. Calling
      // Orbit.update here would clamp a restored upward-looking interior pose.
      snapshot.controls.enabled = false;
    }
    invalidate();
  }
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useLayoutEffect(() => {
    if (!active) { restoreRef.current(); return; }
    if (!(camera instanceof PerspectiveCamera)) return;
    const orbit = controls instanceof OrbitControls ? controls : null;
    if (saved.current === null) {
      const editor = useEditorStore.getState();
      saved.current = { camera: camera.clone(), controls: orbit, target: orbit?.target.clone() ?? null,
        configId: editor.configId, spaceId: editor.spaceId };
      if (orbit !== null) {
        applyCameraTourPose(camera, orbit, {
          position: camera.position.toArray(), target: orbit.target.toArray(),
        });
        camera.quaternion.copy(saved.current.camera.quaternion);
      }
    } else if (saved.current.controls === null && orbit !== null) {
      saved.current = { ...saved.current, controls: orbit, target: orbit.target.clone() };
    }
    let previousViewport = "";
    function framePreview(): void {
      if (!(camera instanceof PerspectiveCamera)) return;
      const viewport = readFrozenPreviewViewport(gl.domElement, size.width, size.height);
      const key = JSON.stringify(viewport);
      if (key === previousViewport) return;
      previousViewport = key;
      // A gap retains no room to fit; its geometry is withheld by the scene.
      if (room !== null) {
        camera.up.set(0, 1, 0);
        camera.fov = 45;
        camera.zoom = 1;
        camera.filmOffset = 0;
        camera.clearViewOffset();
        camera.aspect = size.width / Math.max(1, size.height);
        const target = fitFrozenLayoutPreviewCamera(camera, room, viewport);
        if (orbit !== null) applyCameraTourPose(camera, orbit, {
          position: camera.position.toArray(), target: target.toArray(),
        });
      } else if (orbit !== null) {
        orbit.enabled = false;
      }
      invalidate();
    }
    framePreview();
    const shell = gl.domElement.closest(".cockpit-shell");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(framePreview);
    observer?.observe(gl.domElement);
    for (const element of shell?.querySelectorAll(PREVIEW_DOCKS) ?? []) observer?.observe(element);
    const mutation = typeof MutationObserver === "undefined" || shell === null ? null : new MutationObserver(framePreview);
    if (mutation !== null && shell !== null) {
      mutation.observe(shell, { subtree: true, childList: true });
      for (const element of [shell, ...shell.querySelectorAll(PREVIEW_DOCKS)]) {
        mutation.observe(element, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
      }
    }
    return () => { observer?.disconnect(); mutation?.disconnect(); };
  }, [active, camera, controls, room, size.width, size.height, gl, invalidate]);

  useLayoutEffect(() => () => { restoreRef.current(); }, [camera]);
  return null;
}
