// ---------------------------------------------------------------------------
// HallExterior — Trades Hall's own Glassford Street front round the hall
//
// The measured front (hall-exterior.ts), built a frame's spare time at a time
// once the city stands, drawn in the section's finish and the city's light,
// and cut wherever the cutaway cuts the window wall (hall-exterior-material.ts,
// hall-exterior-cut.ts). The whole front also stands, uncut, as a caster on
// the sun's shadow layer, so its columns, cornices and the pediment shade the
// hall's windows and the street as the building does. If the build fails it
// says so (`onFailed`), and the city takes back its own front (HallContext);
// cut short by leaving the page, it says nothing.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import type { BufferGeometry } from "three";
import { useHallFinish } from "./hall-finish.js";
import { HALL_SUN_CASTER_LAYER, requestHallSunRedraw, type HallSun } from "./hall-sun.js";
import { runSliced } from "./hall-slices.js";
import { parseSectionPreset } from "./hall-section.js";
import { FRONT_DETAIL_FULL, FRONT_DETAIL_LIGHT, hallFrontSteps } from "./hall-exterior.js";
import { createFrontCasterMaterial, createFrontMaterial } from "./hall-exterior-material.js";
import type { StreetLightMaps } from "./hall-street-light.js";

export interface HallExteriorProps {
  /** The city's sun and shadow map, which the front reads and casts into. */
  readonly sun: HallSun;
  /** The city's street-light maps, whose lamps light the front after dusk. */
  readonly lightMaps: StreetLightMaps;
  /** Called once if the front cannot be built (never when the build is cut short by leaving). */
  readonly onFailed?: () => void;
}

export function HallExterior({ sun, lightMaps, onFailed }: HallExteriorProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const failed = useRef(onFailed);
  failed.current = onFailed;
  const finish = useHallFinish();
  const preset = useMemo(() => parseSectionPreset(typeof window === "undefined" ? null : window.location.search), []);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const material = useMemo(() => createFrontMaterial(sun, lightMaps, preset), [lightMaps, preset, sun]);
  const caster = useMemo(createFrontCasterMaterial, []);
  // A phone's finish draws the round things with fewer segments. The build
  // depends on that alone: a new renderer (a lost device, restored) keeps it.
  const detail = finish.photoQuality < 1 ? FRONT_DETAIL_LIGHT : FRONT_DETAIL_FULL;

  useEffect(() => {
    let live = true;
    runSliced(hallFrontSteps(detail), { live: () => live })
      .then((front) => {
        if (live) setGeometry(front.geometry);
        else front.geometry.dispose();
      })
      .catch(() => {
        // Cut short by leaving the page (no longer live): nothing to say. Still
        // live, the build failed: the city takes back its own front.
        if (live) failed.current?.();
      });
    return () => {
      live = false;
    };
  }, [detail]);

  // Each built front is disposed once another replaces it or the front leaves.
  useEffect(() => () => {
    geometry?.dispose();
  }, [geometry]);

  // Once the front stands in the scene, both maps that see it redraw: the
  // city's, and the hall's (its windows' shade). Asked before its meshes
  // mounted, a frame that came first could draw them without it (as the
  // city's own arrival, HallContext).
  useEffect(() => {
    if (geometry === null) return;
    sun.redraw();
    requestHallSunRedraw();
    invalidate();
  }, [geometry, invalidate, sun]);

  useEffect(() => () => {
    material.dispose();
    caster.dispose();
  }, [caster, material]);

  if (geometry === null) return null;
  return (
    <group name="grand-hall-front">
      <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => undefined} />
      <mesh geometry={geometry} material={caster} layers={HALL_SUN_CASTER_LAYER} castShadow frustumCulled={false} raycast={() => undefined} />
    </group>
  );
}
