import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import { TilesAttributionOverlay, TilesPlugin, TilesRenderer } from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import type { Tile } from "3d-tiles-renderer/core";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { useArrivalStore } from "./arrival-store.js";
import { TRADES_HALL_ANCHOR } from "./trades-hall-anchor.js";
import {
  ARRIVAL_ERROR_TARGET,
  ARRIVAL_TILES_STALL_MS,
  GOOGLE_MAPS_ATTRIBUTION_LOGO_URL,
} from "./arrival-config.js";

// -----------------------------------------------------------------------------
// GoogleTilesStage — live Photorealistic 3D Tiles, reoriented so the Trades
// Hall anchor sits at the scene origin with +Y up. Event wiring, not polling:
//   load-error      → fail("tiles")   (spec §6 — single fallback)
//   tiles-load-end  → tilesReady()    (FIRST idle: everything requested for
//                                      the start-pose camera has loaded — the
//                                      start view has resolved, so the flight
//                                      may begin)
//   needs-update    → invalidate()    (demand-frameloop discipline)
// Plus the ONE failure with no event of its own — a request that simply never
// answers — caught by a silence watchdog re-armed on every proof of network
// progress (see the wiring effect, and ARRIVAL_TILES_STALL_MS in
// arrival-config.ts for why it measures silence rather than total time).
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
//
// errorTarget is the tile-density knob (Task 14). It is a plain instance
// property, not a constructor arg: the r3f <TilesRenderer> collects every prop
// it does not consume itself into `options` and assigns them onto the tiles
// instance from a layout effect (`useDeepOptions`, node_modules/
// 3d-tiles-renderer/src/r3f/components/TilesRenderer.jsx:264,326 →
// utilities/useOptions.js), and its prop type is `Partial<TilesRendererImpl>`,
// so `errorTarget` is a first-class typed prop rather than an escape hatch.
// The args-identity hazard above does NOT apply to it: useDeepOptions keys on
// useObjectDep(options), which compares the option VALUES one level deep, and
// ARRIVAL_ERROR_TARGET is a module-scope number — equal to itself on every
// render, so the assignment effect runs once. See arrival-config.ts for why
// the seeded value is a flagged placeholder and not a measurement.
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

/**
 * What a developer sees when the tiles never answer at all — the stall
 * watchdog's one diagnostic.
 *
 * This failure has NO event of its own: `tiles-load-end` never fires because
 * nothing finished, and `load-error` never fires because nothing failed —
 * the request is simply outstanding. Without this line the only symptom is a
 * homepage where the flight never happens, which looks exactly like a
 * homepage where the flight was never enabled. So the watchdog says which one
 * it is, names where to look, and rules out the wrong suspect: a rejected key
 * is the loud, well-documented failure here, and it does NOT look like this.
 */
const STALLED_TILESET_DIAGNOSTIC =
  "Arrival: Google Photorealistic 3D Tiles went silent for " +
  `${String(Math.round(ARRIVAL_TILES_STALL_MS / 1000))}s — no tileset, no tile download, no ` +
  "error — so the hero flight was abandoned and the static hero photo is carrying the page; " +
  "the homepage is fine. Nothing failed and nothing finished: the request is still " +
  "outstanding, which is what a hung connection, a captive-portal/proxy that swallows " +
  "tile.googleapis.com, or a request blocked by an extension or CSP looks like from here. " +
  "Check the Network panel for a pending request to tile.googleapis.com. (A wrong or " +
  "over-quota key does NOT look like this — that answers immediately and reports itself " +
  "through load-error.)";

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

    // THE STALL WATCHDOG (branch review, "minor"; Task 12b's own "most likely
    // field report"). Every other tiles failure announces itself — a bad key,
    // a dead tile and a lost context all end in `load-error`. A HUNG request
    // announces nothing: no `tiles-load-end` because nothing finished, no
    // `load-error` because nothing failed, so the phase machine sits in
    // "loading" forever, the flight silently never happens, and not one line
    // is written anywhere. This is the only failure class with no event of
    // its own, so it is the only one that needs a clock.
    //
    // A DEAD-MAN'S SWITCH, NOT A DEADLINE: re-armed by every event that
    // proves bytes are moving (see PROGRESS EVENTS below), so it measures
    // SILENCE. That is what makes ARRIVAL_TILES_STALL_MS safe to pick — a
    // slow-but-working connection re-arms it constantly and can never trip
    // it; see arrival-config.ts for the full justification of the number and
    // of the rejected fixed-deadline alternative.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const disarmStall = (): void => {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };
    const onStall = (): void => {
      stallTimer = null;
      if (!loggedFailure.current) {
        loggedFailure.current = true;
        // eslint-disable-next-line no-console
        console.error(STALLED_TILESET_DIAGNOSTIC);
      }
      // The same single fallback every other tiles failure takes (spec §6) —
      // a stall is not a new reason, it is the "tiles" reason arriving by
      // silence instead of by event.
      fail("tiles");
    };
    const armStall = (): void => {
      disarmStall();
      stallTimer = setTimeout(onStall, ARRIVAL_TILES_STALL_MS);
    };
    const onProgress = (): void => {
      // Only while the readiness signal is still outstanding: once
      // tilesReady() has fired the phase machine has moved on, and a later
      // slow patch mid-flight is not a hang — failing then would take the
      // hero away from a visitor who is already watching it work.
      if (!announced) {
        armStall();
      }
    };

    const onLoadEnd = (): void => {
      if (!announced) {
        announced = true;
        disarmStall();
        tilesReady();
      }
      invalidate();
    };
    const onError = (event: TilesLoadErrorEvent): void => {
      disarmStall();
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
    // PROGRESS EVENTS — the four the installed 0.5.2 dispatches that can only
    // mean the network moved (node_modules/3d-tiles-renderer/src/core/
    // renderer/tiles/TilesRendererBase.js: 1628 tiles-load-start when the
    // queue goes non-empty, 1654 tile-download-start when a fetch actually
    // begins, 811 load-tileset when a tileset JSON has parsed, 1775
    // load-model when a tile has finished). Deliberately NOT `needs-update`,
    // `update-before`/`update-after` or `tile-visibility-change`: those fire
    // from the render loop and from camera movement, so treating them as
    // progress would re-arm the watchdog every frame and make it incapable of
    // ever firing — a watchdog that cannot bark.
    tiles.addEventListener("tiles-load-start", onProgress);
    tiles.addEventListener("tile-download-start", onProgress);
    tiles.addEventListener("load-tileset", onProgress);
    tiles.addEventListener("load-model", onProgress);
    armStall();
    return () => {
      disarmStall();
      tiles.removeEventListener("tiles-load-end", onLoadEnd);
      tiles.removeEventListener("load-error", onError);
      tiles.removeEventListener("needs-update", onNeedsUpdate);
      tiles.removeEventListener("tiles-load-start", onProgress);
      tiles.removeEventListener("tile-download-start", onProgress);
      tiles.removeEventListener("load-tileset", onProgress);
      tiles.removeEventListener("load-model", onProgress);
    };
  }, [tiles, invalidate]);

  return (
    <TilesRenderer ref={setTiles} errorTarget={ARRIVAL_ERROR_TARGET}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin plugin={ReorientationPlugin} args={REORIENTATION_ARGS} />
      <TilesAttributionOverlay />
    </TilesRenderer>
  );
}
