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
//        /?arrivalPhase=arrived&arrivalTiles=stub  (see THE TILES SEAM below)
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

// -----------------------------------------------------------------------------
// THE TILES SEAM — the second half of the same problem, added because the
// first half was not enough to make Google's attribution testable.
//
// WHAT WAS BROKEN. Google's Map Tiles API Policies require TWO attributions,
// and commit e51b9475 fixed a shipped state where one of them (the brand mark)
// was never emitted at all, because `logoUrl` was not passed to
// GoogleCloudAuthPlugin. The E2E case written to stop that returning was
// double-gated: it needed a paid Google key AND a non-poster GPU, because
// useArrivalGate blocks device tier "poster" before it even looks at the key
// (use-arrival-gate.ts) and headless Chromium is SwiftShader.
//
// MEASURED, 2026-08-28, on a machine with an RTX 4090, `chromium.launch()`
// straight out of this repo's @playwright/test 1.59.1:
//
//   default (no launchOptions)        -> "ANGLE (Google, Vulkan 1.3.0
//                                        (SwiftShader Device (Subzero) …))"
//   --enable-gpu                      -> "ANGLE (NVIDIA, NVIDIA GeForce
//                                        RTX 4090 … D3D11)"
//
// So the launch flag DOES reach the discrete GPU here — and that is still not a
// fix, because a CI runner has no discrete GPU to reach. An attribution
// assertion gated on the reported renderer is an assertion that does not run
// in CI, which is the one place it has to run. (The `--use-angle=default` that
// once accompanied that flag was removed on 2026-08-28: re-measured on GPU-less
// Linux it leaves the browser with NO WebGL context at all, which would have
// taken the ToS guard below down in CI. e2e/arrival.spec.ts's test.use block
// carries the full two-platform table.)
//
// WHAT THIS SEAM DOES. It supplies a FIXED, SYNTHETIC token so
// GoogleTilesStage — with its real GoogleCloudAuthPlugin, its real
// TilesAttributionOverlay and its real logoUrl wiring — mounts on any machine,
// with no key and at any device tier, so the E2E can answer tile.googleapis.com
// itself and assert what the overlay actually renders. See
// e2e/arrival.spec.ts's attribution case.
//
// THREE THINGS KEEP IT SAFE, and they are deliberate:
//   1. Same double guard as the phase seam — `import.meta.env.DEV` here AND at
//      the call site, so the whole module tree-shakes out of a production
//      build.
//   2. The token is a CONSTANT, not the query value. A seam that handed back
//      whatever the URL said would be a way to smuggle a real, billable
//      credential in through a link; this one can only ever produce a string
//      Google rejects.
//   3. It cannot mount anything ON ITS OWN. useArrivalGate reads
//      googleTilesApiKey() directly, so on a keyless machine `?arrivalTiles`
//      alone still fails the gate with "no-key" and the hero returns null —
//      the phase pin above is what bypasses the gate, and the two must be
//      combined deliberately.
// -----------------------------------------------------------------------------

/** The query parameter that mounts GoogleTilesStage without a real key. */
export const ARRIVAL_HARNESS_TILES_PARAM = "arrivalTiles";

/** The only accepted value — spelled out so a typo cannot silently enable it. */
const ARRIVAL_HARNESS_TILES_VALUE = "stub";

/**
 * The synthetic token handed to GoogleCloudAuthPlugin under the seam.
 *
 * Shaped to be unmistakable in a network log and impossible to confuse with a
 * credential: a real Google API key is 39 characters beginning "AIza", and
 * this is neither. Google answers it with HTTP 400 `API_KEY_INVALID` (the body
 * pinned in google-tiles-auth-contract.test.ts), so a stray page load with
 * this seam on and no route stub in place degrades down the hero's ordinary
 * tiles-failure path and bills nobody.
 */
export const ARRIVAL_HARNESS_TILES_TOKEN = "E2E-HARNESS-TOKEN-NOT-A-GOOGLE-CREDENTIAL";

/**
 * The synthetic tiles token when this page load asked for it, else null.
 *
 * Returns null unconditionally outside a dev build. `search` is passed in
 * rather than read from `window` for the same reason as above.
 */
export function arrivalHarnessTilesToken(search: string): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const raw = new URLSearchParams(search).get(ARRIVAL_HARNESS_TILES_PARAM);
  return raw === ARRIVAL_HARNESS_TILES_VALUE ? ARRIVAL_HARNESS_TILES_TOKEN : null;
}
