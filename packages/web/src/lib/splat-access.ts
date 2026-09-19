/** Founder hold, 19 September 2026. Only local development may open splats.
 * No query, saved planner state, role or deployment environment override.
 */
export function gaussianSplatsAvailable(): boolean {
  return import.meta.env.DEV;
}
