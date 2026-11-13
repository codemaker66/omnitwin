// ---------------------------------------------------------------------------
// HallStreetLights — the council's street lamps round the Grand Hall
//
// Up to three draws for every lamp in the city (hall-street-light.ts): the
// white card fittings with their lenses, a halo on each lantern and, on
// screens larger than a phone, a cone of light under each. The fittings stand
// by day as small white brackets on the model; the halos and cones are hidden
// until the first lamp lights at dusk, after drawing for their first frames
// (folded away, nothing on screen) so their shaders compile while the city
// loads, not when the dial first crosses dusk. A phone draws no cones: they
// cover much of the screen from the street, and the pools, scallops and halos
// carry the lamps without them. Drawn inside the city's group, so
// `?setting=none` leaves them out with it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, PerspectiveCamera, Sprite } from "three";
import { uniform } from "three/tsl";
import { useHallFinish } from "./hall-finish.js";
import { hallSkyUniforms } from "./hall-sky-runtime.js";
import {
  anyLampLit, buildBeamGeometry, buildFittingGeometry, buildHaloGeometry, createBeamMaterial, createFittingMaterial,
  createHaloMaterial, haloInstances, streetLookUniforms, type StreetLamp,
} from "./hall-street-light.js";
import type { HallSun } from "./hall-sun.js";

/** Frames the hidden halos and cones draw for, folded away, so they compile with the city. */
const WARM_FRAMES = 4;
/** The cones reach this far from the camera, metres (the city's whole reach). */
const BEAM_RANGE = 260;

export interface HallStreetLightsProps {
  readonly lamps: readonly StreetLamp[];
  /** The city's sun: the fittings stand in its shadow, as the city does. */
  readonly sun: HallSun;
}

const ignoreRays = (): undefined => undefined;

export function HallStreetLights({ lamps, sun }: HallStreetLightsProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const finish = useHallFinish();
  const warmFrames = useRef(WARM_FRAMES);
  const parts = useMemo(() => {
    const pixelAngle = uniform(0.001);
    const fittings = new Mesh(buildFittingGeometry(lamps), createFittingMaterial(sun));
    fittings.name = "grand-hall-street-lamps";
    const beams = finish.photoQuality < 1 ? null : new Mesh(buildBeamGeometry(lamps), createBeamMaterial(BEAM_RANGE));
    if (beams !== null) {
      beams.name = "grand-hall-street-beams";
      // Light in the air draws after the city and the hall it lies over.
      beams.renderOrder = 2;
    }
    const halos = new Sprite(createHaloMaterial(pixelAngle));
    // Its own quad, carrying each lantern as an instance, disposed with it.
    halos.geometry = buildHaloGeometry(lamps);
    halos.name = "grand-hall-street-halos";
    halos.count = haloInstances(lamps).count;
    halos.renderOrder = 3;
    for (const object of [fittings, beams, halos]) {
      if (object === null) continue;
      object.frustumCulled = false;
      object.raycast = ignoreRays;
    }
    return { fittings, beams, halos, pixelAngle };
  }, [finish, lamps, sun]);

  useEffect(() => () => {
    parts.fittings.geometry.dispose();
    parts.fittings.material.dispose();
    parts.beams?.geometry.dispose();
    parts.beams?.material.dispose();
    parts.halos.geometry.dispose();
    parts.halos.material.dispose();
  }, [parts]);

  useFrame((state) => {
    const camera = state.camera;
    if (camera instanceof PerspectiveCamera) {
      // The angle one CSS pixel spans at the centre of the view.
      parts.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, state.size.height) / camera.zoom;
    }
    // Unlit lamps fold their halos and cones away in the vertex shader; before
    // the first lamp lights they are not drawn at all.
    const lit = streetLookUniforms.lampsOn.value > 0 && anyLampLit(hallSkyUniforms.sunAltitude.value);
    const warming = !lit && warmFrames.current > 0;
    if (warming) {
      warmFrames.current -= 1;
      invalidate();
    }
    parts.halos.visible = lit || warming;
    if (parts.beams !== null) parts.beams.visible = lit || warming;
  });

  return (
    <>
      <primitive object={parts.fittings} />
      {parts.beams !== null && <primitive object={parts.beams} />}
      <primitive object={parts.halos} />
    </>
  );
}
