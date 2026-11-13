// ---------------------------------------------------------------------------
// HallContext — the Merchant City around the drawn Grand Hall
//
// Loads the contour model (hall-context.ts) after the room, draws it as lit
// card under the real sky, and keeps its own sun shadow aimed with the light
// the hall is lit by (sun by day, moon by night). The model also stands, as a
// plain caster on the shadow layer, in the hall's own sun shadow, so the
// blocks across Glassford Street shade the windows as the real ones do. If
// the model cannot load, the hall stands under the sky alone.
//
// The street lamps' light maps and table (hall-street-light.ts) load beside
// the model. The city's shader is built against one-texel "no lamp" maps in
// the same formats, and the real ones replace them when they arrive, so
// nothing recompiles; if either file fails, the city shows without its lamps.
// The lit openings across Glassford Street (hall-facade-lights.ts) load
// beside them, and either can fail without the other.
//
// With the modelled front (on unless this device chose `?facade=0`,
// hall-facade-access.ts) the city comes from the model whose Trades Hall
// front is cut away, with the lamps baked against it, and the measured front
// (HallExterior, whose code is fetched only then) stands in its place, in the
// city's light and lamps and casting into its shadow map. If the front cannot
// be drawn (its code will not load, or its build fails), the city fetches v2's
// model and lamps again, so the street keeps a front.
// ---------------------------------------------------------------------------

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { BufferGeometry, Texture } from "three";
import { useHallFinish } from "./hall-finish.js";
import { HALL_SUN_CASTER_LAYER, createSunCaster, requestHallSunRedraw, type ShadowBox } from "./hall-sun.js";
import { CONTEXT_MODEL_FRONT_URL, CONTEXT_MODEL_URL, createContextCasterMaterial, createContextMaterial, parseContextModel } from "./hall-context.js";
import { hallFacadeRequested } from "../../lib/hall-facade-access.js";
import type { HallExteriorProps } from "./HallExterior.js";
import { hallSkyState, hallSkyUniforms } from "./hall-sky-runtime.js";
import {
  STREET_LAMPS_FRONT_URL, STREET_LAMPS_URL, STREET_LIGHT_FRONT_URL, STREET_LIGHT_URL, applyStreetLightField, createStreetLightMaps,
  createStreetLightTextures, parseStreetLamps, parseStreetLight, resetStreetLightField, type StreetLamp,
} from "./hall-street-light.js";
import { HallStreetLights } from "./HallStreetLights.js";
import { FACADE_LIGHTS_FRONT_URL, FACADE_LIGHTS_URL, parseFacadeLights, type FacadeLight } from "./hall-facade-lights.js";
import { HallFacadeLights } from "./HallFacadeLights.js";

/** What stands for the front when its code cannot be fetched: it hands the city its own front back. */
function FrontUnavailable({ onFailed }: HallExteriorProps): null {
  useEffect(() => { onFailed?.(); }, [onFailed]);
  return null;
}

/** Where the front's code comes from: a seam for tests, its own chunk otherwise. */
export const frontChunk = {
  load(): Promise<typeof import("./HallExterior.js") | undefined> { return import("./HallExterior.js"); },
};

/**
 * The measured front's code, fetched only when the front is asked for. If it
 * cannot be fetched (a stale deploy, the network), the city takes back its
 * own front rather than the planner losing its scene to the error. A build
 * fetches it through Vite's preload helper, which resolves to nothing instead
 * of rejecting once the page has claimed its one stale-chunk reload
 * (route-error-boundary.tsx): that counts as a failure too.
 */
const HallExterior = lazy<ComponentType<HallExteriorProps>>(() => frontChunk.load()
  .then((module) => ({ default: module?.HallExterior ?? FrontUnavailable }))
  .catch(() => ({ default: FrontUnavailable })));

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Grand Hall city: HTTP ${String(response.status)} for ${url}`);
  return response;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchOk(url);
  const json: unknown = await response.json();
  return json;
}

/** The part of the city its sun shadow covers; beyond it the haze has the model. */
const CITY_BOX: ShadowBox = { min: [-190, -4.2, -190], max: [190, 60, 190] };
/** Refit the city's map once the light has turned by more than about 0.05°. */
const TURN_EPSILON = 4e-7;
/** While the sun is moving: about a degree. */
const MOVING_TURN = 1.5e-4;

export function HallContext(): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const finish = useHallFinish();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const sun = useMemo(() => createSunCaster({
    name: "grand-hall-city-sun",
    box: CITY_BOX,
    mapSize: finish.photoQuality < 1 ? 1024 : 2048,
    reach: 0,
  }), [finish]);
  const lightMaps = useMemo(createStreetLightMaps, []);
  const material = useMemo(() => createContextMaterial(sun, lightMaps), [lightMaps, sun]);
  const caster = useMemo(createContextCasterMaterial, []);
  const aimed = useRef<[number, number, number] | null>(null);
  // Each with the file it came from: only the current source's are drawn, so the front's lamps never stand
  // against the city's own front while that front's are on their way, or if they fail.
  const [lamps, setLamps] = useState<{ readonly source: string; readonly table: readonly StreetLamp[] } | null>(null);
  const [facades, setFacades] = useState<{ readonly source: string; readonly lights: readonly FacadeLight[] } | null>(null);
  // Asked once per mount, as the sky is: the URL, else this device's last choice.
  const asked = useMemo(() => typeof window !== "undefined" && hallFacadeRequested(window.location.search), []);
  // A front that cannot be drawn (its code would not load, or its build
  // failed) gives the city back its own: v2's model and lamps, fetched again.
  const [frontFailed, setFrontFailed] = useState(false);
  const front = asked && !frontFailed;
  const failFront = useCallback(() => { setFrontFailed(true); }, []);
  const lightSource = front ? STREET_LIGHT_FRONT_URL : STREET_LIGHT_URL;
  const lampSource = front ? STREET_LAMPS_FRONT_URL : STREET_LAMPS_URL;
  const facadeSource = front ? FACADE_LIGHTS_FRONT_URL : FACADE_LIGHTS_URL;

  useEffect(() => {
    let live = true;
    fetchOk(front ? CONTEXT_MODEL_FRONT_URL : CONTEXT_MODEL_URL)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (live) setGeometry(parseContextModel(buffer));
      })
      .catch(() => {
        // Without the city the hall stands under the sky alone.
      });
    return () => {
      live = false;
    };
  }, [front, sun]);

  // Each model is disposed once another replaces it (the city's own front
  // back after a failed one) or the city leaves.
  useEffect(() => () => {
    geometry?.dispose();
  }, [geometry]);

  // The street lamps, beside the model and independent of it.
  useEffect(() => {
    let live = true;
    const placeholders: readonly [Texture, Texture] = [lightMaps.pool.value, lightMaps.head.value];
    let loaded: { pool: Texture; head: Texture } | null = null;
    Promise.all([
      fetchOk(lightSource).then((response) => response.arrayBuffer()),
      fetchJson(lampSource),
    ])
      .then(([buffer, json]) => {
        if (!live) return;
        const field = parseStreetLight(buffer);
        const table = parseStreetLamps(json, field);
        loaded = createStreetLightTextures(field);
        applyStreetLightField(field);
        lightMaps.pool.value = loaded.pool;
        lightMaps.head.value = loaded.head;
        setLamps({ source: lampSource, table });
        invalidate();
      })
      .catch(() => {
        // Without its lamps the city still stands, as it does by day.
      });
    return () => {
      live = false;
      [lightMaps.pool.value, lightMaps.head.value] = placeholders;
      resetStreetLightField();
      loaded?.pool.dispose();
      loaded?.head.dispose();
    };
  }, [invalidate, lampSource, lightMaps, lightSource]);

  // The lit openings across the street, beside the lamps and independent of them.
  useEffect(() => {
    let live = true;
    fetchJson(facadeSource)
      .then((json) => {
        if (!live) return;
        setFacades({ source: facadeSource, lights: parseFacadeLights(json) });
        invalidate();
      })
      .catch(() => {
        // Without them the windows look onto the city's own random windows.
      });
    return () => {
      live = false;
    };
  }, [facadeSource, invalidate]);

  useEffect(() => {
    const placeholders: readonly Texture[] = [lightMaps.pool.value, lightMaps.head.value];
    return () => { for (const placeholder of placeholders) placeholder.dispose(); };
  }, [lightMaps]);

  // Once the model stands in the scene, both maps that see it redraw: the
  // city's own, and the hall's, in which the blocks across Glassford Street
  // shade the windows. Asked before the model mounted, the hall's map could
  // be drawn by a frame that came first, without it.
  useEffect(() => {
    if (geometry === null) return;
    sun.redraw();
    requestHallSunRedraw();
    invalidate();
  }, [geometry, invalidate, sun]);

  useEffect(() => () => {
    material.dispose();
    caster.dispose();
    sun.dispose();
  }, [caster, material, sun]);

  useFrame(() => {
    const direction = hallSkyUniforms.lightDirection.value;
    const last = aimed.current;
    const turned = last === null ? 1 : 1 - (direction.x * last[0] + direction.y * last[1] + direction.z * last[2]);
    // While the time travels the coarse shadow follows every degree or so;
    // once it rests it is refitted exactly.
    if (turned > (hallSkyState.moving ? MOVING_TURN : TURN_EPSILON)) {
      sun.aim([direction.x, direction.y, direction.z]);
      aimed.current = [direction.x, direction.y, direction.z];
      invalidate();
    }
  });

  if (geometry === null) return null;
  return (
    <group name="grand-hall-city">
      <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => undefined} />
      <mesh geometry={geometry} material={caster} layers={HALL_SUN_CASTER_LAYER} castShadow frustumCulled={false} raycast={() => undefined} />
      {lamps?.source === lampSource && <HallStreetLights lamps={lamps.table} sun={sun} />}
      {facades?.source === facadeSource && <HallFacadeLights lights={facades.lights} />}
      {front && (
        <Suspense fallback={null}>
          <HallExterior sun={sun} lightMaps={lightMaps} onFailed={failFront} />
        </Suspense>
      )}
    </group>
  );
}
