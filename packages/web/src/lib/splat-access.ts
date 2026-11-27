/** Where Gaussian splats may run.
 *
 * Founder hold, 19 September 2026: never on the public site; no query, saved
 * planner state or role overrides it. Blake, 28 September 2026 (T-639):
 * preview deployments may show them so he can judge the Real Hall on his own
 * devices. Production builds always return false, and so does the product
 * domain itself whatever the build: a preview build aliased to venviewer.com
 * must not lift the hold there.
 *
 * Blake, 26 October 2026: "no hold, we are meant to be building this as a full
 * release". Lifting this hold generally is the release lead's to sequence; until
 * then one narrow exemption stands outside this function: the allowlisted
 * device-day timing cuts named by `?splatBundle=` for their own room
 * (data/device-day-splat-bundles.ts), which the planner draws in any build. */
export interface SplatAccessEnv {
  readonly DEV: boolean;
  /** Vercel's VERCEL_ENV baked in at build time: "production", "preview" or
   *  "development"; empty outside Vercel. */
  readonly VITE_DEPLOY_ENV?: string | undefined;
  /** The page's host name. When omitted, the current page's
   *  (`window.location.hostname`); none outside a browser. */
  readonly HOST?: string | undefined;
}

/** venviewer.com and every host under it, in any letter case, with or without
 * the root's trailing dot. */
function isProductHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/u, "");
  return name === "venviewer.com" || name.endsWith(".venviewer.com");
}

function currentHost(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

export function gaussianSplatsAvailable(
  env: SplatAccessEnv = { DEV: import.meta.env.DEV, VITE_DEPLOY_ENV: import.meta.env.VITE_DEPLOY_ENV },
): boolean {
  const host = env.HOST ?? currentHost();
  if (host !== undefined && isProductHost(host)) return false;
  return env.DEV || env.VITE_DEPLOY_ENV === "preview";
}
