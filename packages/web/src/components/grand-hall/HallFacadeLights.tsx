// ---------------------------------------------------------------------------
// HallFacadeLights — the lit openings across Glassford Street
//
// One additive draw of the surveyed windows, shopfronts, signs and the light
// on the pavement before them (hall-facade-lights.ts). Hidden by day; it
// draws for its first frames while the city loads (lit by nothing, so nothing
// shows) so its shader compiles then, not when the dial first crosses dusk.
// Drawn inside the city's group, so `?setting=none` leaves it out with it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh } from "three";
import { hallSkyUniforms } from "./hall-sky-runtime.js";
import { buildFacadeLightGeometry, createFacadeLightMaterial, type FacadeLight } from "./hall-facade-lights.js";
import { DUSK_SPAN } from "./hall-street-light.js";

/** Frames it draws for, unlit, so its shader compiles with the city. */
const WARM_FRAMES = 4;

export interface HallFacadeLightsProps {
  readonly lights: readonly FacadeLight[];
}

const ignoreRays = (): undefined => undefined;

/** Whether the facades light at this sun altitude: from the start of dusk down. */
export function facadesLit(sunAltitude: number): boolean {
  return sunAltitude < DUSK_SPAN.from;
}

export function HallFacadeLights({ lights }: HallFacadeLightsProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const warmFrames = useRef(WARM_FRAMES);
  const mesh = useMemo(() => {
    const object = new Mesh(buildFacadeLightGeometry(lights), createFacadeLightMaterial());
    object.name = "grand-hall-facade-lights";
    // Light on the walls and pavement draws after the city it lies on.
    object.renderOrder = 2;
    object.raycast = ignoreRays;
    return object;
  }, [lights]);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);

  useFrame(() => {
    const lit = facadesLit(hallSkyUniforms.sunAltitude.value);
    const warming = !lit && warmFrames.current > 0;
    if (warming) {
      warmFrames.current -= 1;
      invalidate();
    }
    mesh.visible = lit || warming;
  });

  return <primitive object={mesh} />;
}
