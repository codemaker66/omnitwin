import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { createSunCaster } from "../hall-sun.js";
import { createStreetLightMaps } from "../hall-street-light.js";
import type { HallFinish } from "../hall-finish.js";

// A computer's finish, as the hall reads it.
vi.mock("../hall-finish.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-finish.js")>();
  return { ...original, useHallFinish: (): HallFinish => original.FULL_HALL_FINISH };
});

// The front's build, held in the test's hand: it settles when the test says.
const build = vi.hoisted(() => ({ fail: (_reason: Error): void => undefined }));
vi.mock("../hall-slices.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-slices.js")>();
  return {
    ...original,
    runSliced: (): Promise<never> => new Promise((_resolve, reject) => { build.fail = reject; }),
  };
});

const { HallExterior } = await import("../HallExterior.js");

const sun = createSunCaster({ name: "test-city-sun", box: { min: [-1, -1, -1], max: [1, 1, 1] }, mapSize: 16, reach: 0 });
const lightMaps = createStreetLightMaps();

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("the measured front's build", () => {
  it("says once that it failed, so the city can take back its own front", async () => {
    const onFailed = vi.fn();
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} onFailed={onFailed} />);
    await act(async () => { build.fail(new Error("the build threw")); await Promise.resolve(); });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(mounted.scene.getObjectByName("grand-hall-front")).toBeUndefined();
  });

  it("says nothing when it is cut short by the front leaving", async () => {
    const onFailed = vi.fn();
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} onFailed={onFailed} />);
    mounted.unmount();
    mounted = null;
    await act(async () => { build.fail(new Error("cut short")); await Promise.resolve(); });
    expect(onFailed).not.toHaveBeenCalled();
  });
});
