export interface HumanPovLookAngles {
  readonly yaw: number;
  readonly pitch: number;
}

export interface HumanPovPointerDelta {
  readonly deltaX: number;
  readonly deltaY: number;
}

export const HUMAN_POV_LOOK_SENSITIVITY = 0.0032;

export const HUMAN_POV_MAX_PITCH_RAD = Math.PI * 0.42;

export const HUMAN_POV_TARGET_DISTANCE_M = 6;

export function computeHumanPovLookAngles(
  start: HumanPovLookAngles,
  delta: HumanPovPointerDelta,
  sensitivity = HUMAN_POV_LOOK_SENSITIVITY,
  maxPitch = HUMAN_POV_MAX_PITCH_RAD,
): HumanPovLookAngles {
  return {
    yaw: start.yaw - delta.deltaX * sensitivity,
    pitch: clamp(start.pitch - delta.deltaY * sensitivity, -maxPitch, maxPitch),
  };
}

export function isHumanPovPointerButton(button: number): boolean {
  return button === 2;
}

export function isHumanPovExitKey(code: string): boolean {
  return code === "Escape";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
