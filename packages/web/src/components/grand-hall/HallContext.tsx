// ---------------------------------------------------------------------------
// HallContext — the Merchant City around the drawn Grand Hall
//
// Loads the contour model (hall-context.ts) after the room, draws it as lit
// card under the real sky, and keeps its own sun shadow aimed with the light
// the hall is lit by (sun by day, moon by night). The model also stands, as a
// plain caster on the shadow layer, in the hall's own sun shadow, so the
// blocks across Glassford Street shade the windows as the real ones do. If
// the model cannot load, the hall stands under the sky alone.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { BufferGeometry } from "three";
import { useHallFinish } from "./hall-finish.js";
import { HALL_SUN_CASTER_LAYER, createSunCaster, type ShadowBox } from "./hall-sun.js";
import { CONTEXT_MODEL_URL, createContextCasterMaterial, createContextMaterial, parseContextModel } from "./hall-context.js";
import { hallSkyState, hallSkyUniforms } from "./hall-sky-runtime.js";

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
  const material = useMemo(() => createContextMaterial(sun), [sun]);
  const caster = useMemo(createContextCasterMaterial, []);
  const aimed = useRef<[number, number, number] | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: BufferGeometry | null = null;
    fetch(CONTEXT_MODEL_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Grand Hall city model: HTTP ${String(response.status)}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!live) return;
        loaded = parseContextModel(buffer);
        setGeometry(loaded);
        sun.redraw();
        invalidate();
      })
      .catch(() => {
        // Without the city the hall stands under the sky alone.
      });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [invalidate, sun]);

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
    </group>
  );
}
