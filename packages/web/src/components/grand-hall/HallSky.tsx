// ---------------------------------------------------------------------------
// HallSky — the real sky over the Grand Hall, at the moment the planner shows
//
// Reads the moment from the hall time store (the clock by default), carries
// the shown time toward it on a spring so a chosen hour arrives as the sun
// sweeping across the sky rather than a cut, and publishes the sky for each
// frame's time (hall-sky-runtime.ts). Draws the sky dome around the camera.
// While nothing moves it does no work: the frame loop is on demand, and
// following the clock re-evaluates twice a minute.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, type Mesh } from "three";
import { stepSpring, type SpringConfig, type SpringState } from "../../lib/springs.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { hallSkyAt } from "./hall-sky.js";
import { clearHallSky, publishHallSky } from "./hall-sky-runtime.js";
import { SKY_DOME_RADIUS, createSkyDomeGeometry, createSkyDomeMaterial } from "./hall-sky-dome.js";

/** A chosen hour: the sun sweeps there in about a second, critically damped. */
const SWEEP: SpringConfig = { stiffness: 38, damping: 12.3 };
/** A dragged time: close behind the hand, still without a jerk. */
const SCRUB: SpringConfig = { stiffness: 420, damping: 41 };
/** Further than this the moment is a new day: arrive at once. */
const JUMP_MINUTES = 36 * 60;
/** Closer than this the shown time has arrived, minutes. */
const ARRIVED_MINUTES = 0.05;

export interface HallSkyProps {
  /** Draw the sky dome (the light is published either way). */
  readonly dome?: boolean;
}

export function HallSky({ dome = true }: HallSkyProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(createSkyDomeGeometry, []);
  const material = useMemo(createSkyDomeMaterial, []);
  const mesh = useRef<Mesh | null>(null);
  /** The shown time, minutes since the epoch, and its rate. */
  const shown = useRef<SpringState | null>(null);
  const lastPublished = useRef<{ minutes: number; moving: boolean } | null>(null);
  const wasMoving = useRef(false);

  // The sky and the city around the hall lie beyond the planner's usual 200 m.
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || !dome) return undefined;
    const lens = camera;
    const previous = lens.far;
    lens.far = Math.max(previous, SKY_DOME_RADIUS * 1.5);
    lens.updateProjectionMatrix();
    invalidate();
    return () => {
      lens.far = previous;
      lens.updateProjectionMatrix();
    };
  }, [camera, dome, invalidate]);

  useEffect(() => useHallTimeStore.subscribe(() => { invalidate(); }), [invalidate]);
  useEffect(() => {
    // Following the clock: look again twice a minute.
    const timer = window.setInterval(() => {
      if (useHallTimeStore.getState().mode === "now") invalidate();
    }, 30_000);
    return () => { window.clearInterval(timer); };
  }, [invalidate]);
  useEffect(() => () => {
    clearHallSky();
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state, delta) => {
    const { mode, at, scrubbing } = useHallTimeStore.getState();
    const target = (mode === "now" ? Date.now() : at) / 60_000;
    let current = shown.current;
    if (current === null || Math.abs(target - current.value) > JUMP_MINUTES) {
      current = { value: target, velocity: 0 };
      shown.current = current;
    } else {
      // The first frame of a move does not spend the on-demand loop's idle gap.
      const dt = wasMoving.current ? Math.min(delta, 0.1) : 1 / 60;
      stepSpring(current, target, dt, scrubbing ? SCRUB : SWEEP);
    }
    const moving = Math.abs(target - current.value) > ARRIVED_MINUTES || Math.abs(current.velocity) > 0.5;
    if (!moving) {
      current.value = target;
      current.velocity = 0;
    }
    wasMoving.current = moving;
    const settling = moving || scrubbing;
    const last = lastPublished.current;
    if (last === null || Math.abs(current.value - last.minutes) > 0.01 || last.moving !== settling) {
      publishHallSky(hallSkyAt(current.value * 60_000), settling);
      lastPublished.current = { minutes: current.value, moving: settling };
    }
    mesh.current?.position.copy(state.camera.position);
    if (moving) invalidate();
  });

  if (!dome) return null;
  return (
    <mesh
      ref={mesh}
      name="grand-hall-sky"
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
      raycast={() => undefined}
    />
  );
}
