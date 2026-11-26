import type { SpaceDimensions } from "@omnitwin/types";
import { focusOwnsArrows } from "./planner-keys.js";

/**
 * Computes default camera position for a cinematic planning perspective.
 *
 * Desktop opens in a high, diagonal, room-composition view so layouts read as
 * a premium planning board immediately. Saved POVs still provide human eye
 * mode; the default authoring pose is intentionally god-view-first.
 */
export function computeDefaultCameraPosition(
  dimensions: SpaceDimensions,
  aspect = 1.78,
): readonly [number, number, number] {
  const { width, length } = dimensions;
  const maxDim = Math.max(width, length);
  const minDim = Math.min(width, length);

  if (aspect < 1.2) {
    const alongAxis = maxDim * 0.31;
    const lateral = minDim * 0.18;
    const lift = Math.max(dimensions.height * 0.34, 2.2);
    if (width >= length) {
      return [alongAxis, lift, lateral];
    }
    return [lateral, lift, alongAxis];
  }

  const alongAxis = maxDim * 0.1;
  const lateral = -minDim * 0.18;
  const lift = Math.max(dimensions.height * 1.8, maxDim * 0.92);

  if (width >= length) {
    return [alongAxis, lift, lateral];
  }
  return [lateral, lift, alongAxis];
}

/**
 * Computes the orbit target.
 * Landscape: low centre-of-room target so the default authoring pose reads the
 * entire layout surface and wall rhythm.
 * Portrait: slightly higher target so the elevated interior pose reads the
 * ceiling and chandeliers without aiming above the room.
 */
export function computeCameraTarget(
  dimensions: SpaceDimensions,
  aspect = 1.78,
): readonly [number, number, number] {
  if (aspect < 1.2) return [0, dimensions.height * 0.32, 0];
  return [0, dimensions.height * 0.1, 0];
}

export function horizontalFovFromVertical(vFovDeg: number, aspect: number): number {
  const v = (vFovDeg * Math.PI) / 180;
  return 2 * Math.atan(Math.tan(v / 2) * aspect);
}

export function computeFramingDistance(
  dimensions: SpaceDimensions,
  aspect: number,
  vFovDeg: number,
  margin = 1.15,
): number {
  const v = (vFovDeg * Math.PI) / 180;
  const h = horizontalFovFromVertical(vFovDeg, aspect);
  const halfW = (Math.max(dimensions.width, dimensions.length) * margin) / 2;
  const halfH = (dimensions.height * margin) / 2;
  return Math.max(halfH / Math.tan(v / 2), halfW / Math.tan(h / 2));
}

export function computeDistanceLimits(
  dimensions: SpaceDimensions,
): { readonly minDistance: number; readonly maxDistance: number } {
  const maxDim = Math.max(dimensions.width, dimensions.length, dimensions.height);
  return {
    minDistance: 1.5,
    maxDistance: Math.max(15, maxDim * 1.6),
  };
}

/** Where a pan may carry the orbit target, in the room's own coordinates (metres). */
export interface PanBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Where a room's outline lies on the floor: its box, in the room's own coordinates (metres). */
export interface FloorFootprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Where a pan may carry the orbit target. Across the room it is the floor
 * plan with a fifth of each side as margin: the box of the room's outline
 * where `footprint` gives it (an outline need not be centred on the room's
 * origin), else the width and length centred on that origin. Up and down it
 * runs as far below the floor and above the ceiling as it reaches across the
 * room from the floor plan's centre. OrbitControls pans in the screen's
 * plane, so from an ordinary view a drag up or down the screen lowers or
 * lifts the target as it carries it across the room: a bound near the floor
 * would stop such a drag following the cursor almost at once, in a low room
 * at once, where slack as deep as the room is wide keeps it following, and
 * still ends the escape to the far plane (T-724).
 */
export function computePanBounds(dimensions: SpaceDimensions, footprint: FloorFootprint | null = null): PanBounds {
  const minX = footprint?.minX ?? -dimensions.width / 2;
  const maxX = footprint?.maxX ?? dimensions.width / 2;
  const minZ = footprint?.minZ ?? -dimensions.length / 2;
  const maxZ = footprint?.maxZ ?? dimensions.length / 2;
  const marginX = (maxX - minX) * 0.2;
  const marginZ = (maxZ - minZ) * 0.2;
  const reach = Math.max((maxX - minX) / 2 + marginX, (maxZ - minZ) / 2 + marginZ);
  return {
    minX: minX - marginX,
    maxX: maxX + marginX,
    minY: -reach,
    maxY: dimensions.height + reach,
    minZ: minZ - marginZ,
    maxZ: maxZ + marginZ,
  };
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Holds the orbit target inside `bounds` after a pan and moves the camera by
 * the same correction, so the view keeps its offset and angle: at a bound the
 * view stops, and the rest of the pan slides along it. `from` is where the
 * target stood before the pan. A target that code placed outside the bounds (a
 * glide to a far view) is never pulled in: on each axis a pan may bring it
 * back towards the room but carry it no further out than `from`. Returns
 * whether anything moved.
 */
export function holdOrbitTarget(target: Point3, camera: Point3, bounds: PanBounds, from: Readonly<Point3>): boolean {
  const x = holdAxis(target.x, from.x, bounds.minX, bounds.maxX);
  const y = holdAxis(target.y, from.y, bounds.minY, bounds.maxY);
  const z = holdAxis(target.z, from.z, bounds.minZ, bounds.maxZ);
  if (x === target.x && y === target.y && z === target.z) return false;
  camera.x += x - target.x;
  camera.y += y - target.y;
  camera.z += z - target.z;
  target.x = x;
  target.y = y;
  target.z = z;
  return true;
}

function holdAxis(value: number, from: number, min: number, max: number): number {
  return Math.min(Math.max(value, Math.min(min, from)), Math.max(max, from));
}

export const MIN_POLAR_ANGLE = 0.1;
export const MAX_POLAR_ANGLE = Math.PI * 0.48;
export const DAMPING_FACTOR = 0.2;
/**
 * Metres per second at the reference zoom distance.
 *
 * Halved from 20 when the scene moved to true metres. The distance-based
 * `speedScale` is a ratio, so it cancels when the whole world shrinks — pan
 * kept its speed in world units while the room became half as wide, which
 * would have made it feel twice as fast to cross.
 */
export const PAN_SPEED = 10;
export const EDGE_SCROLL_ZONE = 40;
export const DAMPING_SETTLE_FRAMES = 24;
export const ZOOM_IMPULSE = 0.025;
export const ZOOM_FRICTION = 0.16;
export const ZOOM_VELOCITY_THRESHOLD = 0.001;
export const MAX_ZOOM_FRAME_DELTA_SECONDS = 1 / 30;

/**
 * Converts a frame delta to the zoom integrator's ~60 fps scale, capping the
 * first frame after an idle period. The planner renders on demand, so that
 * frame can carry seconds of idle time; uncapped, one wheel tick would inherit
 * it and slam the camera to a distance limit.
 */
export function computeZoomFrameScale(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return Math.min(deltaSeconds, MAX_ZOOM_FRAME_DELTA_SECONDS) * 60;
}

/**
 * How far held arrow keys pan the camera this frame, in the room's metres,
 * for a pan speed scaled by the zoom distance. Capped as zoom is: the first
 * frame after an idle period can carry seconds of it, and uncapped one press
 * threw the view to the room's edge.
 */
export function computeKeyboardPanStep(deltaSeconds: number, speedScale: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return PAN_SPEED * speedScale * Math.min(deltaSeconds, MAX_ZOOM_FRAME_DELTA_SECONDS);
}

/** The pointer id of a finger's pointer event; null for a mouse, a pen or anything else. */
function fingerId(event: Event): number | null {
  return event instanceof PointerEvent && event.pointerType === "touch" ? event.pointerId : null;
}

/**
 * Turns OrbitControls' zoom on only while a finger is down. Its zoom is the
 * two-finger pinch's dolly; every wheel and trackpad already has the rig's own
 * inertial zoom, and with both on a wheel on a touch-first device zoomed
 * twice. Listens in the capture phase on `target` (the window), so the zoom is
 * on before OrbitControls reads the finger. A blur forgets every finger: a
 * touch the browser drops without a cancel (an alert, an app switch) would
 * otherwise leave the zoom on for good. Returns the unsubscribe.
 */
export function zoomWhileFingersDown(target: EventTarget, setZoom: (on: boolean) => void): () => void {
  const fingers = new Set<number>();
  const down = (event: Event): void => {
    const id = fingerId(event);
    if (id === null) return;
    if (fingers.size === 0) setZoom(true);
    fingers.add(id);
  };
  const up = (event: Event): void => {
    const id = fingerId(event);
    if (id === null || !fingers.delete(id)) return;
    if (fingers.size === 0) setZoom(false);
  };
  const forget = (): void => {
    if (fingers.size === 0) return;
    fingers.clear();
    setZoom(false);
  };
  target.addEventListener("pointerdown", down, true);
  target.addEventListener("pointerup", up, true);
  target.addEventListener("pointercancel", up, true);
  target.addEventListener("blur", forget);
  return () => {
    target.removeEventListener("pointerdown", down, true);
    target.removeEventListener("pointerup", up, true);
    target.removeEventListener("pointercancel", up, true);
    target.removeEventListener("blur", forget);
  };
}

/**
 * The orbit camera pans on the arrows alone. W A S D walk in Walk and nowhere
 * else, so D is Draw and never also a pan (F-22; T-671 slice 5).
 */
export const PAN_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

/**
 * Whether keys pressed at this element belong to it rather than the camera:
 * text fields, widgets that move with the arrows (unless pressed with the
 * pointer: a click on a key gives the arrows back to the room, F-21), dialogs
 * and anything marked to keep the keyboard.
 */
export function isCameraKeyboardInputLocked(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (focusOwnsArrows(target)) return true;
  return target.closest("[role='dialog'], [data-camera-keyboard-lock='true']") !== null;
}

export interface CameraKeyboardPlannerState {
  readonly catalogueDrawerOpen: boolean;
  readonly catalogueSelectionActive: boolean;
  readonly catalogueDragActive: boolean;
  readonly cameraReferenceDraftOpen: boolean;
  readonly guidelineActive: boolean;
  readonly markupActive: boolean;
  readonly measurementActive: boolean;
  readonly selectedItemCount: number;
  readonly marqueeActive: boolean;
}

export function isCameraKeyboardPanSuspendedByPlannerState(state: CameraKeyboardPlannerState): boolean {
  return (
    state.catalogueDrawerOpen ||
    state.catalogueSelectionActive ||
    state.catalogueDragActive ||
    state.cameraReferenceDraftOpen ||
    state.guidelineActive ||
    state.markupActive ||
    state.measurementActive ||
    state.selectedItemCount > 0 ||
    state.marqueeActive
  );
}

export function computeKeyboardPanDirection(
  pressedKeys: ReadonlySet<string>,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (pressedKeys.has("ArrowUp")) dz -= 1;
  if (pressedKeys.has("ArrowDown")) dz += 1;
  if (pressedKeys.has("ArrowLeft")) dx -= 1;
  if (pressedKeys.has("ArrowRight")) dx += 1;

  if (dx === 0 && dz === 0) return [0, 0];

  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
}

export function computeEdgeScrollDirection(
  mouseX: number,
  mouseY: number,
  viewportWidth: number,
  viewportHeight: number,
  zone: number,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (mouseX < zone) dx = -1;
  else if (mouseX > viewportWidth - zone) dx = 1;

  if (mouseY < zone) dz = -1;
  else if (mouseY > viewportHeight - zone) dz = 1;

  if (dx === 0 && dz === 0) return [0, 0];

  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
}
