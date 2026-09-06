import { isCameraKeyboardInputLocked } from "../../lib/camera-rig.js";

export type InteriorCameraInputPolicy = "walk" | "planner";

export function interiorInputBlocked(policy: InteriorCameraInputPolicy, target: EventTarget | null): boolean {
  if (policy === "walk") return false;
  if (isCameraKeyboardInputLocked(target)) return true;
  return typeof document !== "undefined"
    && document.querySelector('[aria-modal="true"], dialog[open]') !== null;
}

export function interiorLookButton(policy: InteriorCameraInputPolicy, button: number, pointerType = "mouse"): boolean {
  return policy === "walk" || button === 2 || pointerType === "touch";
}

export function interiorMovementKey(key: string): boolean {
  return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key.toLowerCase());
}
