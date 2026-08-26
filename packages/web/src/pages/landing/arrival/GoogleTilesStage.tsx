import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import { TilesAttributionOverlay, TilesPlugin, TilesRenderer } from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { useArrivalStore } from "./arrival-store.js";
import { TRADES_HALL_ANCHOR } from "./trades-hall-anchor.js";

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
// phase and no prop may hide it.
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
// useMemo'd on [apiToken]. Both keep the SAME array reference across renders
// unless their real inputs change, so each plugin constructs exactly once.
// Separately, `args` types as a tuple (ConstructorParameters<Plugin>), not
// the bare options object the package's JS-only README shows; a one-element
// array constructs the plugin identically to passing the object directly for
// these single-arg constructors (TilesRenderer.jsx:187-196), which is why the
// tuple form below is the honestly-typed choice, not merely "also works".
// -----------------------------------------------------------------------------

interface GoogleTilesStageProps {
  readonly apiToken: string;
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
  const authArgs = useMemo<ConstructorParameters<typeof GoogleCloudAuthPlugin>>(
    () => [{ apiToken }],
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
    const onError = (): void => {
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
