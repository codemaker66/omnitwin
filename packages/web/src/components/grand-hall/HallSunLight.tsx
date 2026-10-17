// ---------------------------------------------------------------------------
// HallSunLight — the sun (or, at night, the moon) shining into the Grand Hall
//
// Follows the published sky (hall-sky-runtime.ts): the light takes the sun's
// direction, colour and strength by day and the moon's once the sun has set,
// and refits and redraws its shadow map only when the light has visibly
// moved or the furniture has changed or is in motion (hall-sun.ts). The
// room's photographed surfaces read the same direction and strength from the
// sky's uniforms, in their own baked-light units, so the furniture and the
// room are lit as one.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { subscribeFurnitureSettleFrames } from "../../lib/furniture-motion.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useHallFinish } from "./hall-finish.js";
import { hallSun, hallSunMapSize } from "./hall-sun.js";
import { hallSkyState, hallSkyUniforms } from "./hall-sky-runtime.js";

/** The light's intensity for the furniture's lit materials at full sun. */
const SUN_INTENSITY = 5.2;
/** The same sun on the room's photographed surfaces, in their baked-light units. */
const SUN_ROOM_RADIANCE = 2.4;
/** Full moonlight (sky strength 0.07) on furniture and room. */
const MOON_INTENSITY = 2.4;
const MOON_ROOM_RADIANCE = 1.1;
/** The sun counts as up while its light is above this share of the overhead sun. */
const SUN_UP = 0.0005;
/** Refit the map once the light has turned by more than about 0.03°. */
const TURN_EPSILON = 1.5e-7;
/** While the sun is moving: about a third of a degree. */
const MOVING_TURN = 1.6e-5;

export function HallSunLight(): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const finish = useHallFinish();
  const sun = useMemo(() => hallSun(hallSunMapSize(finish.photoQuality, finish.liveLight)), [finish]);
  const applied = useRef(-1);
  const aimed = useRef<[number, number, number] | null>(null);
  const items = usePlacementStore((state) => state.placedItems);

  // Furniture placed, moved or removed: its shadows follow on the next frame.
  useEffect(() => {
    sun.redraw();
    invalidate();
  }, [invalidate, items, sun]);

  // Furniture in motion (dropping in, leaning in the hand, settling, setting
  // its weight down) is posed each frame outside the store. FurnitureMotion
  // publishes every such frame, and then the one that returns the pieces to
  // rest, before that frame renders, so the map is drawn at the pose drawn.
  useEffect(() => subscribeFurnitureSettleFrames(() => { sun.redraw(); }), [sun]);

  useFrame(() => {
    const sky = hallSkyState.sky;
    if (sky === null || applied.current === hallSkyState.version) return;
    applied.current = hallSkyState.version;
    const sunUp = sky.sun.strength > SUN_UP;
    const body = sunUp ? sky.sun : sky.moon;
    const strength = body.strength;
    sun.light.color.setRGB(body.color[0], body.color[1], body.color[2]);
    sun.light.intensity = strength * (sunUp ? SUN_INTENSITY : MOON_INTENSITY / 0.07);
    const room = strength * (sunUp ? SUN_ROOM_RADIANCE : MOON_ROOM_RADIANCE / 0.07);
    hallSkyUniforms.lightRadiance.value.setRGB(body.color[0] * room, body.color[1] * room, body.color[2] * room);
    const [x, y, z] = body.direction;
    hallSkyUniforms.lightDirection.value.set(x, y, z);
    const last = aimed.current;
    const turned = last === null ? 1 : 1 - (x * last[0] + y * last[1] + z * last[2]);
    // While the time travels the room's shadow follows every third of a
    // degree; once it rests it is refitted exactly.
    if (strength > 0 && turned > (hallSkyState.moving ? MOVING_TURN : TURN_EPSILON)) {
      sun.aim(body.direction);
      aimed.current = [x, y, z];
    }
  });

  // The light is shared with the room's materials: never disposed on unmount.
  return (
    <>
      <primitive object={sun.light} dispose={null} />
      <primitive object={sun.light.target} dispose={null} />
    </>
  );
}
