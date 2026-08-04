export function shouldRenderPlannerMotionOverlays(cameraInteractionActive: boolean): boolean {
  return !cameraInteractionActive;
}
