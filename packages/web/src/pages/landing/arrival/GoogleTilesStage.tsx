import { useEffect, useState, type ReactElement } from "react";
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
//   tiles-load-end  → tilesReady()    (first idle at/above TILES_READY_PROGRESS)
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
// -----------------------------------------------------------------------------

/** How much of the start-pose tileset must be in before the dive begins. */
export const TILES_READY_PROGRESS = 0.85;

interface GoogleTilesStageProps {
  readonly apiToken: string;
}

export function GoogleTilesStage({ apiToken }: GoogleTilesStageProps): ReactElement {
  const invalidate = useThree((s) => s.invalidate);
  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null);

  useEffect(() => {
    if (tiles === null) {
      return;
    }
    const { tilesReady, fail } = useArrivalStore.getState();
    let announced = false;
    const onLoadEnd = (): void => {
      if (!announced && tiles.loadProgress >= TILES_READY_PROGRESS) {
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
      {/*
        TilesPlugin's `args` prop types as `Params extends any[]` — a tuple
        matching the plugin's ConstructorParameters, not the bare options
        object the package's own README shows (that snippet is untyped .jsx).
        At runtime TilesPlugin does `Array.isArray(args) ? new plugin(...args)
        : new plugin(args)` (node_modules/3d-tiles-renderer/src/r3f/components/
        TilesRenderer.jsx:187-196), so a one-element array here constructs the
        plugin identically to passing the object directly — this is the
        honestly-typed form, not a behavior change.
      */}
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={[{ apiToken }]} />
      <TilesPlugin
        plugin={ReorientationPlugin}
        args={[
          {
            lat: MathUtils.degToRad(TRADES_HALL_ANCHOR.latDeg),
            lon: MathUtils.degToRad(TRADES_HALL_ANCHOR.lonDeg),
            height: TRADES_HALL_ANCHOR.heightM,
            azimuth: MathUtils.degToRad(TRADES_HALL_ANCHOR.azimuthDeg),
          },
        ]}
      />
      <TilesAttributionOverlay />
    </TilesRenderer>
  );
}
