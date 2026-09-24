// ---------------------------------------------------------------------------
// Material opacity shared by surface fades and the ornament stand-ins
//
// three ignores `opacity` unless a material is `transparent`, so a material
// shows its authored opacity only when it is transparent, and is opaque
// otherwise. A surface fade scales that authored opacity, which keeps
// translucent pieces such as window glass translucent at rest. A material
// blends while its opacity is below `OPAQUE_OPACITY` and draws opaque at or
// above it.
// ---------------------------------------------------------------------------

export const OPAQUE_OPACITY = 0.999;

/** The opacity a material renders at as authored. */
export function authoredOpacity(transparent: boolean, opacity: number): number {
  return transparent ? opacity : 1;
}

/** True when a material with this authored state still blends on a fully opaque surface. */
export function isTranslucentAtRest(transparent: boolean, opacity: number): boolean {
  return authoredOpacity(transparent, opacity) < OPAQUE_OPACITY;
}
