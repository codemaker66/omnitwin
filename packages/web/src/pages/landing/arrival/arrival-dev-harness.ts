import type { ArrivalPhase } from "./arrival-store.js";

// -----------------------------------------------------------------------------
// arrival-dev-harness — a DEV-ONLY seam for driving the Arrival hero's phase
// machine from an E2E test. Stripped entirely from production builds.
//
// WHY THIS EXISTS. The Arrival hero's two accessibility controls ("Skip the
// flight", WCAG 2.2.2's pause control for an 11-second automatic animation,
// and "Open the Hall", the only keyboard/AT route into the explode) were both
// being painted UNDERNEATH .fr-hero-panel — an opaque, later positioned
// sibling that fresh.css pulls up over the hero frame's bottom edge. A CSS
// reading cannot prove that class of defect and neither can jsdom: only a real
// browser's hit-testing knows whether an element is covered. Playwright's
// actionability check is exactly that instrument, so the fix needed a way to
// reach those two phases in a real browser, deterministically.
//
// It could not be reached without this. ArrivalHero self-gates to `null`
// before ever mounting when googleTilesApiKey() is null (arrival-config.ts),
// and that key is absent in CI and on every dev machine today — which is why
// every phase-dependent case in e2e/arrival.spec.ts carries a
// `test.skip(!HAS_TILES_KEY)`. A regression test for the hero's controls that
// only runs on a machine holding a paid Google Map Tiles key is not a
// regression test. This seam makes those phases reachable with no key at all,
// and — deliberately — WITHOUT mounting GoogleTilesStage, so the spec measures
// the DOM overlay's geometry against the real fresh.css cascade rather than
// the health of a billable third-party tile service.
//
// HOW IT IS STRIPPED. `import.meta.env.DEV` is replaced by Vite with the
// literal `false` in a production build, so this function's body folds to
// `return null` and Rollup drops the rest. Every call site ALSO guards with
// the same literal (`import.meta.env.DEV ? arrivalHarnessPhase(...) : null`),
// which makes the import itself unreferenced in a production bundle and
// tree-shakes the module away entirely. Two independent guards, because the
// thing being guarded is a bypass of the hero's own no-key/poster-tier gate:
// if it ever shipped live, a query string could mount a keyless canvas on the
// homepage. It must be impossible, not merely unlikely.
//
// Usage: /?arrivalPhase=flight | arrived | exploded | loading | fallback
// -----------------------------------------------------------------------------

/** The query parameter the harness reads. */
export const ARRIVAL_HARNESS_PARAM = "arrivalPhase";

// Keyed by ArrivalPhase itself so both directions stay compile-checked: a new
// phase that this harness cannot drive is a missing-key error, and a stray key
// is an excess-property error under `satisfies` (the same pattern
// arrival-store.ts uses for FAIL_REASON_KEYS).
const HARNESS_PHASES = {
  loading: true,
  flight: true,
  arrived: true,
  exploded: true,
  fallback: true,
} as const satisfies Record<ArrivalPhase, true>;

// Object.hasOwn, never `in`: `in` walks the prototype chain, so
// `?arrivalPhase=toString` would otherwise pass this guard and be handed back
// as if it were a real phase.
function isArrivalPhase(value: string): value is ArrivalPhase {
  return Object.hasOwn(HARNESS_PHASES, value);
}

/**
 * The phase this page load is pinned to, or null for normal operation.
 *
 * Returns null unconditionally outside a dev build. `search` is passed in
 * rather than read from `window` so the parsing is directly unit-testable.
 */
export function arrivalHarnessPhase(search: string): ArrivalPhase | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const raw = new URLSearchParams(search).get(ARRIVAL_HARNESS_PARAM);
  if (raw === null || !isArrivalPhase(raw)) {
    return null;
  }
  return raw;
}
