import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import { DirectionalLight, PointLight, type Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { reflectionsOutdated } from "../GrandHallModel.js";
import { HallLightRig } from "../HallLightRig.js";
import { FULL_HALL_FINISH } from "../hall-finish.js";
import { HALL_MOODS } from "../hall-mood.js";
import { hallSkyAt } from "../hall-sky.js";
import { clearHallSky, publishHallSky } from "../hall-sky-runtime.js";

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearHallSky();
});

function rigLights(scene: Object3D): { daylight: DirectionalLight; chandelier: PointLight } {
  const rig = scene.getObjectByName("grand-hall-lights");
  const daylight = rig?.children.find((child): child is DirectionalLight => child instanceof DirectionalLight);
  const chandelier = rig?.children.find((child): child is PointLight => child instanceof PointLight);
  if (daylight === undefined || chandelier === undefined) throw new Error("The rig's lights did not mount");
  return { daylight, chandelier };
}

describe("the hall's light rig under the real sky", () => {
  it("blends back to the chosen mood once the sky goes, rather than keeping the sky's last light", () => {
    mounted = mountInStubRoot(<HallLightRig mood="candlelight" moodSeconds={0.2} finish={FULL_HALL_FINISH} standInEnvironment={false} />);
    const { daylight, chandelier } = rigLights(mounted.scene);
    let seconds = 100;
    const frame = (): void => { act(() => { advance(seconds, true); }); seconds += 1 / 60; };
    frame();
    const chosen = { daylight: daylight.intensity, chandelier: chandelier.intensity };
    expect(chosen.daylight).toBeCloseTo(HALL_MOODS.candlelight.daylightIntensity * 1.4, 6);

    // Midsummer noon over Glasgow.
    const sky = hallSkyAt(Date.UTC(2026, 5, 21, 12, 0));
    expect(sky.mood.daylightIntensity).not.toBeCloseTo(HALL_MOODS.candlelight.daylightIntensity, 2);
    act(() => { publishHallSky(sky, false); });
    frame();
    expect(daylight.intensity).toBeCloseTo(sky.mood.daylightIntensity * 1.4, 6);

    // A timeline preview takes the sky down; the rig stays.
    act(() => { clearHallSky(); });
    frame();
    frame();
    frame();
    // Blending, not jumping.
    const low = Math.min(chosen.daylight, sky.mood.daylightIntensity * 1.4);
    const high = Math.max(chosen.daylight, sky.mood.daylightIntensity * 1.4);
    expect(daylight.intensity).toBeGreaterThan(low + 1e-4);
    expect(daylight.intensity).toBeLessThan(high - 1e-4);
    for (let i = 0; i < 60; i++) frame();
    expect(daylight.intensity).toBeCloseTo(chosen.daylight, 6);
    expect(chandelier.intensity).toBeCloseTo(chosen.chandelier, 6);
  });

  it("takes the sky again when it returns", () => {
    mounted = mountInStubRoot(<HallLightRig mood="evening" moodSeconds={0.2} finish={FULL_HALL_FINISH} standInEnvironment={false} />);
    const { daylight } = rigLights(mounted.scene);
    let seconds = 100;
    const frame = (): void => { act(() => { advance(seconds, true); }); seconds += 1 / 60; };
    const sky = hallSkyAt(Date.UTC(2026, 5, 21, 12, 0));
    act(() => { publishHallSky(sky, false); });
    frame();
    act(() => { clearHallSky(); });
    for (let i = 0; i < 30; i++) frame();
    expect(daylight.intensity).toBeCloseTo(HALL_MOODS.evening.daylightIntensity * 1.4, 6);
    act(() => { publishHallSky(sky, false); });
    frame();
    expect(daylight.intensity).toBeCloseTo(sky.mood.daylightIntensity * 1.4, 6);
  });
});

describe("the room's reflections under the real sky", () => {
  it("are captured for the first sky whatever its light, and again only once the light differs enough to show", () => {
    // Before any capture there is nothing to compare: the first sky captures.
    expect(reflectionsOutdated(4.2, null)).toBe(true);
    expect(reflectionsOutdated(4.2, 4.2)).toBe(false);
    expect(reflectionsOutdated(4.2, 4.205)).toBe(false);
    expect(reflectionsOutdated(4.2, 4.25)).toBe(true);
    expect(reflectionsOutdated(4.25, 4.2)).toBe(true);
  });
});
