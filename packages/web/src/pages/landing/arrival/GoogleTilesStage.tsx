import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import { TilesAttributionOverlay, TilesPlugin, TilesRenderer } from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import type { Tile } from "3d-tiles-renderer/core";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { useArrivalStore } from "./arrival-store.js";
import { TRADES_HALL_ANCHOR } from "./trades-hall-anchor.js";
import { GOOGLE_MAPS_ATTRIBUTION_LOGO_URL } from "./arrival-config.js";

// -----------------------------------------------------------------------------
// GoogleTilesStage — live Photorealistic 3D Tiles, reoriented so the Trades
// Hall anchor sits at the scene origin with +Y up. Event wiring, not polling:
//   load-error      → fail("tiles")   (spec §6 — single fallback)
//   tiles-load-end  → tilesReady()    (FIRST idle: everything requested for
//                                      the start-pose camera has loaded — the
//                                      start view has resolved, so the flight
//                                      may begin)
//   needs-update    → invalidate()    (demand-frameloop discipline)
// The attribution overlay is a Google ToS requirement — it ships in every
// phase and no prop may hide it. It renders whatever tiles.getAttributions()
// returns, which is only as complete as what the plugins below feed it:
// GoogleCloudAuthPlugin's logoUrl (see arrival-config.ts) is what makes the
// brand/logo credit (not just the text/copyright line) appear at all —
// omitting it is a silent compliance gap, not a visible error, since
// getAttributions() simply skips the logo `if (this.logoUrl)` is falsy
// (node_modules/3d-tiles-renderer/src/core/plugins/
// GoogleCloudAuthPlugin.js:120-125).
//
// Ref timing (verified against the installed 0.5.2 source, not just its
// docs): 3d-tiles-renderer/r3f's <TilesRenderer> creates the underlying
// TilesRendererImpl in a useEffect and only THEN applies it to `ref` — via
// useApplyRefs, whose own effect depends on the resolved instance
// (node_modules/3d-tiles-renderer/src/r3f/components/TilesRenderer.jsx:262-323,
// utilities/useApplyRefs.js). It never exists synchronously during render. A
// plain `useRef` read inside a `useEffect` keyed on unrelated deps (e.g.
// `[invalidate]`) would run once on mount, see a still-null ref, and NEVER
// re-run once the instance actually arrives — so this stage tracks the
// instance as state, and the wiring effect keys off *it*, guaranteeing a
// single, correctly-timed subscribe/cleanup pair.
//
// ReorientationPlugin takes {lat, lon, height, azimuth, elevation, roll} as
// constructor args and performs the origin transform itself once the root
// tileset loads (node_modules/3d-tiles-renderer/src/three/plugins/
// ReorientationPlugin.js:22-136) — no manual transformLatLonHeightToOrigin
// call is needed. lat/lon/azimuth/elevation/roll are RADIANS, height is
// METRES (same file, JSDoc on the class, lines 12-20); TRADES_HALL_ANCHOR
// stays in degrees per its own contract, converted here at the call site.
//
// Args identity matters. TilesPlugin's construct/dispose effect keys on
// useObjectDep(args), a FIRST-LEVEL identity comparison, not deep equality
// (node_modules/3d-tiles-renderer/src/r3f/utilities/useObjectDep.js:3-44 —
// for an array dep it compares args[0] !== previousArgs[0] by reference). An
// `args` value built fresh every render (an inline array/object literal in
// JSX) looks "changed" on every render, so 3d-tiles-renderer disposes and
// reconstructs the plugin each time: a brand-new GoogleCloudAuth session-token
// fetch (billable, and it discards accumulated attributions) for
// GoogleCloudAuthPlugin, and a transform reset-then-reapply for
// ReorientationPlugin — on EVERY render, including the guaranteed second
// render when setTiles(instance) resolves. REORIENTATION_ARGS is therefore
// hoisted to module scope (it depends only on the module-level
// TRADES_HALL_ANCHOR, never on props); the GoogleCloudAuthPlugin args are
// useMemo'd on [apiToken] alone — logoUrl rides along inside the same
// options object because GOOGLE_MAPS_ATTRIBUTION_LOGO_URL is ITSELF a
// module-scope constant (arrival-config.ts), not a prop or piece of state,
// so it can never be the reason this memo should recompute; adding it to
// the dep array would be a lie about what varies. Both keep the SAME array
// reference across renders unless their real inputs change, so each plugin
// constructs exactly once.
// Separately, `args` types as a tuple (ConstructorParameters<Plugin>), not
// the bare options object the package's JS-only README shows; a one-element
// array constructs the plugin identically to passing the object directly for
// these single-arg constructors (TilesRenderer.jsx:187-196), which is why the
// tuple form below is the honestly-typed choice, not merely "also works".
// -----------------------------------------------------------------------------

interface GoogleTilesStageProps {
  readonly apiToken: string;
}

/** The renderer's own `load-error` payload — node_modules/3d-tiles-renderer/
 *  src/core/renderer/tiles/TilesRendererBase.d.ts:25. `tile` is null when it
 *  is the ROOT tileset that failed, which is the request that carries the
 *  API key. */
type TilesLoadErrorEvent = {
  tile: Tile | null;
  error: Error;
  url: string | URL;
} & { type: "load-error" };

/**
 * What a developer sees when the tiles will not load — Task 12b.
 *
 * The fallback itself needed no fixing: an invalid, mistyped, revoked,
 * wrongly-restricted or over-quota key makes Google answer the root-tileset
 * request with 400/403/429 and a JSON `{ error: … }` body, GoogleCloudAuth's
 * getSessionToken() then reads `json.root` (undefined) and dereferences
 * `tile.content` on it, and that TypeError — asynchronous, inside a .then —
 * is caught by TilesRendererBase.update()'s own .catch and re-emitted as
 * `load-error` (TilesRendererBase.js:823-832), which is exactly the event
 * this component already subscribes to. Measured in a real browser: no
 * uncaught exception, no unhandled rejection, the store reaches "fallback"
 * and the photograph carries the page.
 *
 * What DID need fixing is that the library's own `console.error(error)` on
 * the line above that dispatch was the only trace, and it reads
 * "TypeError: Cannot read properties of undefined (reading 'content')" from
 * inside a bundled dependency — naming neither Google, nor the key, nor the
 * hero. It was misread as an uncaught crash and filed as this task. So: say
 * it once, in English, next to the useless one.
 *
 * Deliberately not distinguishing 400 from 403 from 429 in the wording. The
 * plugin throws away the Response before this event exists, so the status is
 * genuinely not knowable here — and guessing at one cause would be worse
 * than naming all of them, since the reader has to check the key anyway.
 */
function describeTilesFailure(event: TilesLoadErrorEvent): string {
  if (event.tile === null) {
    return (
      "Arrival: Google Photorealistic 3D Tiles would not start, so the hero flight was " +
      "abandoned and the static hero photo is carrying the page — the homepage is fine. " +
      "The ROOT tileset request failed, and that is the request carrying the API key, so " +
      "check VITE_GOOGLE_MAPS_TILES_KEY first: absent, mistyped, revoked, restricted to " +
      "the wrong referrer or API, or over quota all fail here identically. (The " +
      "TypeError below is 3d-tiles-renderer failing to parse a session token out of " +
      "Google's JSON error body — it is a symptom, not the cause.) Request:"
    );
  }
  return (
    "Arrival: a Google 3D Tiles tile failed to load, so the hero flight was abandoned and " +
    "the static hero photo is carrying the page — the homepage is fine. The session itself " +
    "started, so this is usually the network; if it repeats from the same session, the key " +
    "may have been revoked or its quota exhausted mid-flight. Request:"
  );
}

/** Stable across every render — derives only from the module-level anchor. */
const REORIENTATION_ARGS: ConstructorParameters<typeof ReorientationPlugin> = [
  {
    lat: MathUtils.degToRad(TRADES_HALL_ANCHOR.latDeg),
    lon: MathUtils.degToRad(TRADES_HALL_ANCHOR.lonDeg),
    height: TRADES_HALL_ANCHOR.heightM,
    azimuth: MathUtils.degToRad(TRADES_HALL_ANCHOR.azimuthDeg),
  },
];

export function GoogleTilesStage({ apiToken }: GoogleTilesStageProps): ReactElement {
  const invalidate = useThree((s) => s.invalidate);
  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null);
  // Once per MOUNT, not once per subscription: the wiring effect below
  // re-runs whenever the tiles instance changes, and a collapsing tileset can
  // emit load-error per tile per frame. A `let` inside the effect (as
  // `announced` is, deliberately, since the store guards tilesReady()) would
  // let the diagnostic repeat; nothing guards a console line.
  const loggedFailure = useRef(false);
  const authArgs = useMemo<ConstructorParameters<typeof GoogleCloudAuthPlugin>>(
    // logoUrl is GOOGLE_MAPS_ATTRIBUTION_LOGO_URL, a module-scope constant
    // (see arrival-config.ts for provenance/NEEDS_CONTEXT) — it belongs
    // inside this same factory, not a second useMemo or a fresh literal, so
    // the tuple's first-level identity keeps depending on [apiToken] alone
    // (see header comment above: a changed `args` reference disposes and
    // reconstructs the plugin, costing a fresh billable Google session).
    () => [{ apiToken, logoUrl: GOOGLE_MAPS_ATTRIBUTION_LOGO_URL }],
    [apiToken],
  );

  useEffect(() => {
    if (tiles === null) {
      return;
    }
    const { tilesReady, fail } = useArrivalStore.getState();
    let announced = false;
    const onLoadEnd = (): void => {
      if (!announced) {
        announced = true;
        tilesReady();
      }
      invalidate();
    };
    const onError = (event: TilesLoadErrorEvent): void => {
      if (!loggedFailure.current) {
        loggedFailure.current = true;
        // eslint-disable-next-line no-console
        console.error(describeTilesFailure(event), String(event.url), event.error);
      }
      fail("tiles");
    };
    const onNeedsUpdate = (): void => {
      invalidate();
    };
    tiles.addEventListener("tiles-load-end", onLoadEnd);
    tiles.addEventListener("load-error", onError);
    tiles.addEventListener("needs-update", onNeedsUpdate);
    return () => {
      tiles.removeEventListener("tiles-load-end", onLoadEnd);
      tiles.removeEventListener("load-error", onError);
      tiles.removeEventListener("needs-update", onNeedsUpdate);
    };
  }, [tiles, invalidate]);

  return (
    <TilesRenderer ref={setTiles}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin plugin={ReorientationPlugin} args={REORIENTATION_ARGS} />
      <TilesAttributionOverlay />
    </TilesRenderer>
  );
}
