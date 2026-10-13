// ---------------------------------------------------------------------------
// HallLightRig — the Grand Hall's real lights and reflection environment
//
// The architecture's diffuse light is baked into the room, so these lights
// exist for what a bake cannot give: the chandeliers' and windows' highlights
// in varnish, gilt and glass, and light on furniture that moves. The rig is
// kept apart from the room so it stays mounted, unchanged, whichever way the
// planner shows the hall (drawn, captured or both): changing lights would
// recompile every furniture material mid-session. A software rasteriser gets a
// soft fill in place of the chandeliers' lights and the reflection map
// (hall-finish.ts).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, type DirectionalLight, type HemisphereLight, type PointLight } from "three";
import { HALL_MOODS, HallMoodUniforms, hallFrameStep, moodEase, type HallMoodName, type HallMoodSpec } from "./hall-mood.js";
import { HallEnvironment } from "./HallEnvironment.js";
import { HALL_CHANDELIERS } from "./hall-spec.js";
import { CHANDELIER_POWER, chandelierScale } from "./hall-lighting-model.js";
import { useHallFinish, type HallFinish } from "./hall-finish.js";

export interface HallLightRigProps {
  readonly mood: HallMoodName;
  /** Seconds a mood takes to blend into the next (the room uses the same). */
  readonly moodSeconds?: number;
  /** Overrides the device's own finish (the lab shows the full one). */
  readonly finish?: HallFinish;
  /**
   * A stand-in room as the reflection environment. The drawn hall captures its
   * own (hall-capture.ts), so the stand-in serves only when it is not drawn.
   */
  readonly standInEnvironment?: boolean;
}

/** The lit plaster and ceiling above, the floorboards below (see hall-environment.ts). */
const FILL_ABOVE = new Color(0.62, 0.48, 0.3);
const FILL_BELOW = new Color(0.16, 0.08, 0.04);
const fillAmbient = new Color();
const fillWarm = new Color();

/** A soft fill standing in for the reflection environment's diffuse light. */
function setFill(light: HemisphereLight, mood: HallMoodUniforms): void {
  fillAmbient.copy(mood.ambient.value).multiplyScalar(mood.ambientIntensity.value * 2.2);
  fillWarm.copy(mood.chandelier.value).multiplyScalar(mood.chandelierIntensity.value * 0.7);
  light.color.copy(fillAmbient).add(fillWarm).multiply(FILL_ABOVE);
  fillWarm.multiplyScalar(0.4 / 0.7);
  light.groundColor.copy(fillAmbient).add(fillWarm).multiply(FILL_BELOW);
  light.intensity = Math.PI * mood.reflections;
}

export function HallLightRig({ mood, moodSeconds = 1.6, finish, standInEnvironment = true }: HallLightRigProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const deviceFinish = useHallFinish();
  const { liveLight } = finish ?? deviceFinish;
  // The first mood seeds the rig; later moods blend in below.
  const settled = useRef<HallMoodName>(mood);
  const uniforms = useMemo(() => {
    const created = new HallMoodUniforms();
    created.apply(HALL_MOODS[settled.current], HALL_MOODS[settled.current], 1);
    return created;
  }, []);
  const blend = useRef<{ from: HallMoodSpec; to: HallMoodSpec; t: number; started: boolean } | null>(null);
  const lights = useRef<(PointLight | null)[]>([]);
  const daylight = useRef<DirectionalLight | null>(null);
  const fill = useRef<HemisphereLight | null>(null);

  useEffect(() => {
    if (mood === settled.current) return;
    blend.current = { from: uniforms.snapshot(HALL_MOODS[settled.current]), to: HALL_MOODS[mood], t: 0, started: false };
    settled.current = mood;
    invalidate();
  }, [invalidate, mood, uniforms]);

  useFrame((_, delta) => {
    const active = blend.current;
    if (active !== null) {
      active.t = Math.min(1, active.t + hallFrameStep(delta, !active.started) / Math.max(0.05, moodSeconds));
      active.started = true;
      uniforms.apply(active.from, active.to, moodEase(active.t));
      if (active.t >= 1) blend.current = null;
      else invalidate();
    }
    HALL_CHANDELIERS.forEach((chandelier, index) => {
      const light = lights.current[index];
      if (light === null || light === undefined) return;
      light.color.copy(uniforms.chandelier.value);
      const scale = chandelierScale(chandelier);
      light.intensity = Math.PI * CHANDELIER_POWER * scale * scale * uniforms.chandelierIntensity.value;
    });
    if (daylight.current !== null) {
      daylight.current.color.copy(uniforms.daylight.value);
      daylight.current.intensity = uniforms.daylightIntensity.value * 1.4;
    }
    if (fill.current !== null) setFill(fill.current, uniforms);
  });

  return (
    <group name="grand-hall-lights">
      {liveLight ? HALL_CHANDELIERS.map((chandelier, index) => (
        <pointLight
          key={chandelier.id}
          ref={(light) => { lights.current[index] = light; }}
          position={[chandelier.position[0], chandelier.position[1] - 0.2, chandelier.position[2]]}
          decay={2}
          distance={0}
        />
      )) : <hemisphereLight ref={fill} />}
      {/* Aimed at the centre of the room, where its unadded target stays. */}
      <directionalLight ref={daylight} position={[1.5, 6, -14]} />
      {liveLight && standInEnvironment && <HallEnvironment mood={mood} />}
    </group>
  );
}
