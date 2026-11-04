// ---------------------------------------------------------------------------
// HallExterior — Trades Hall's own Glassford Street front round the hall
//
// The measured front (hall-exterior.ts), built a frame's spare time at a time
// once the city stands, drawn in the section's finish and the city's light,
// and cut wherever the cutaway cuts the window wall (hall-exterior-material.ts,
// hall-exterior-cut.ts). The whole front also stands, uncut, as a caster on
// the sun's shadow layer, so its columns, cornices and the pediment shade the
// hall's windows and the street as the building does. If the build fails or
// is cut short by leaving the page, the city stands without it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactElement } from "react";
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
}

export function HallExterior({ sun, lightMaps }: HallExteriorProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const finish = useHallFinish();
  const preset = useMemo(() => parseSectionPreset(typeof window === "undefined" ? null : window.location.search), []);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const material = useMemo(() => createFrontMaterial(sun, lightMaps, preset), [lightMaps, preset, sun]);
  const caster = useMemo(createFrontCasterMaterial, []);

  useEffect(() => {
    let live = true;
    let built: BufferGeometry | null = null;
    // A phone's finish draws the round things with fewer segments.
    const detail = finish.photoQuality < 1 ? FRONT_DETAIL_LIGHT : FRONT_DETAIL_FULL;
    runSliced(hallFrontSteps(detail), { live: () => live })
      .then((front) => {
        if (!live) {
          front.geometry.dispose();
          return;
        }
        built = front.geometry;
        setGeometry(front.geometry);
        // Both maps that see the front redraw: the city's, and the hall's (its windows' shade).
        sun.redraw();
        requestHallSunRedraw();
        invalidate();
      })
      .catch(() => {
        // Cut short by leaving the page, or failed: the city stands without its front.
      });
    return () => {
      live = false;
      built?.dispose();
    };
  }, [finish, invalidate, sun]);

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
