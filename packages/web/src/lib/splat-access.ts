/** Where Gaussian splats may run.
 *
 * Founder hold, 19 September 2026: never on the public site; no query, saved
 * planner state or role overrides it. Blake, 28 September 2026 (T-639):
 * preview deployments may show them so he can judge the Real Hall on his own
 * devices. Production builds always return false. */
export interface SplatAccessEnv {
  readonly DEV: boolean;
  /** Vercel's VERCEL_ENV baked in at build time: "production", "preview" or
   *  "development"; empty outside Vercel. */
  readonly VITE_DEPLOY_ENV?: string | undefined;
}

export function gaussianSplatsAvailable(
  env: SplatAccessEnv = { DEV: import.meta.env.DEV, VITE_DEPLOY_ENV: import.meta.env.VITE_DEPLOY_ENV },
): boolean {
  return env.DEV || env.VITE_DEPLOY_ENV === "preview";
}
