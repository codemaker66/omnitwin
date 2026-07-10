import type { SpaceDimensions } from "@omnitwin/types";

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

export function computePanBounds(
  dimensions: SpaceDimensions,
): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  const marginX = dimensions.width * 0.2;
  const marginZ = dimensions.length * 0.2;
  return {
    minX: -dimensions.width / 2 - marginX,
    maxX: dimensions.width / 2 + marginX,
    minZ: -dimensions.length / 2 - marginZ,
    maxZ: dimensions.length / 2 + marginZ,
  };
}

export const MIN_POLAR_ANGLE = 0.1;
export const MAX_POLAR_ANGLE = Math.PI * 0.48;
export const DAMPING_FACTOR = 0.2;
export const PAN_SPEED = 20;
export const EDGE_SCROLL_ZONE = 40;
export const DAMPING_SETTLE_FRAMES = 24;
export const ZOOM_IMPULSE = 0.025;
export const ZOOM_FRICTION = 0.16;
export const ZOOM_VELOCITY_THRESHOLD = 0.001;

export const PAN_KEYS: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

export function isCameraKeyboardInputLocked(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;

  if (
    target.closest(
      "input, textarea, select, button, [role='button'], [role='textbox'], [role='toolbar'], [role='menu'], [role='listbox'], [role='option'], [contenteditable]:not([contenteditable='false'])",
    ) !== null
  ) {
    return true;
  }

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

  if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) dz -= 1;
  if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) dz += 1;
  if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) dx -= 1;
  if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) dx += 1;

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
