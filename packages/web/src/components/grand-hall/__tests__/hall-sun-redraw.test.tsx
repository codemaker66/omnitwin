import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import { DirectionalLight, type LightShadow, type Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { activeFurnitureSettleCount, dropInFurniture, publishFurnitureSettleFrame } from "../../../lib/furniture-motion.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FurnitureMotion } from "../../editor/FurnitureMotion.js";
import { HallContext } from "../HallContext.js";
import { CONTEXT_MODEL_URL } from "../hall-context.js";
import { STREET_LAMPS_URL, STREET_LIGHT_URL } from "../hall-street-light.js";
import { HallSunLight, MOON_INTENSITY, MOTION_REDRAW_MS } from "../HallSunLight.js";
import { hallSkyAt } from "../hall-sky.js";
import { hallSkyState, hallSkyUniforms, publishHallSky } from "../hall-sky-runtime.js";
import { createSunCaster, requestHallSunRedraw, withoutSunMapDraw } from "../hall-sun.js";
import { FULL_HALL_FINISH, type HallFinish } from "../hall-finish.js";

/** The device's finish as the hall reads it: a computer's unless a test says a phone's. */
const finish = vi.hoisted(() => ({ current: null as HallFinish | null }));
vi.mock("../hall-finish.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-finish.js")>();
  return { ...original, useHallFinish: (): HallFinish => finish.current ?? original.FULL_HALL_FINISH };
});

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  // Leave the motion registry's "last frame moved" flag at rest for the next test.
  publishFurnitureSettleFrame([]);
  usePlacementStore.setState({ placedItems: [] });
  vi.unstubAllGlobals();
  finish.current = null;
});

/** The hall's sun as HallSunLight puts it in the scene. */
function hallSunLight(scene: Object3D): DirectionalLight {
  const light = scene.getObjectByName("grand-hall-sun");
  if (!(light instanceof DirectionalLight)) throw new Error("HallSunLight did not add the hall's sun");
  return light;
}

function hallSunShadow(scene: Object3D): LightShadow {
  return hallSunLight(scene).shadow;
}

/** The clock the redraw rate is measured by, held in the test's hand. */
function holdClock(start: number): { readonly set: (ms: number) => void } {
  let now = start;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return { set: (ms) => { now = ms; } };
}

/** One packed triangle of the city model ('VVCX', version 1, int16 cm vertices, uint32 indices). */
function cityModel(): ArrayBuffer {
  const vertices = [0, 0, 0, 1000, 0, 0, 0, 250, -1200];
  const buffer = new ArrayBuffer(16 + vertices.length * 2 + 3 * 4);
  const view = new DataView(buffer);
  "VVCX".split("").forEach((letter, i) => { view.setUint8(i, letter.charCodeAt(0)); });
  view.setUint32(4, 1, true);
  view.setUint32(8, 3, true);
  view.setUint32(12, 3, true);
  vertices.forEach((value, i) => { view.setInt16(16 + i * 2, value, true); });
  [0, 1, 2].forEach((value, i) => { view.setUint32(16 + vertices.length * 2 + i * 4, value, true); });
  return buffer;
}

// First in the file: nothing before it has made the hall's sun.
describe("asking for the hall's sun map to be redrawn", () => {
  it("does nothing where the hall has no sun, and never makes one", () => {
    expect(requestHallSunRedraw()).toBe(false);
    expect(requestHallSunRedraw()).toBe(false);
  });
});

describe("a sun caster", () => {
  it("is made from three's own shadow node, whose map it draws only when asked", () => {
    // The guard once tested a flag only three's typings name, and refused every node.
    const sun = createSunCaster({ name: "test-sun", box: { min: [-1, 0, -1], max: [1, 1, 1] }, mapSize: 64, reach: 0 });
    expect(sun.factor).toBe(sun.shadow);
    expect(sun.light.shadow.autoUpdate).toBe(false);
    sun.dispose();
  });
});

describe("a capture of the room on its own stage", () => {
  /**
   * What three r186's ShadowNode.updateBefore does on each render that
   * samples the map (nodes/lighting/ShadowNode.js 792-822): a pending map is
   * drawn from the scene being rendered, and the request is cleared.
   */
  function renderSampling(shadow: LightShadow, scene: string, drawnFrom: string[]): void {
    if (!shadow.needsUpdate && !shadow.autoUpdate) return;
    drawnFrom.push(scene);
    shadow.needsUpdate = false;
  }

  it("leaves a pending map for the next full render to draw from the whole scene", () => {
    const sun = createSunCaster({ name: "test-sun", box: { min: [-1, 0, -1], max: [1, 1, 1] }, mapSize: 64, reach: 0 });
    const shadow = sun.light.shadow;
    const drawnFrom: string[] = [];
    sun.redraw();
    const result = withoutSunMapDraw(sun, () => { renderSampling(shadow, "room stage", drawnFrom); return "environment"; });
    renderSampling(shadow, "whole scene", drawnFrom);
    expect(result).toBe("environment");
    expect(drawnFrom).toEqual(["whole scene"]);

    // Without the hold, the capture spent the request on its own stage.
    const unheld: string[] = [];
    sun.redraw();
    renderSampling(shadow, "room stage", unheld);
    renderSampling(shadow, "whole scene", unheld);
    expect(unheld).toEqual(["room stage"]);
    sun.dispose();
  });

  it("asks for no redraw when none was pending, and hands a pending one back if the capture fails", () => {
    const sun = createSunCaster({ name: "test-sun", box: { min: [-1, 0, -1], max: [1, 1, 1] }, mapSize: 64, reach: 0 });
    const shadow = sun.light.shadow;
    shadow.needsUpdate = false;
    withoutSunMapDraw(sun, () => undefined);
    expect(shadow.needsUpdate).toBe(false);

    sun.redraw();
    expect(() => withoutSunMapDraw(sun, () => { throw new Error("device lost"); })).toThrow("device lost");
    expect(shadow.needsUpdate).toBe(true);
    expect(withoutSunMapDraw(null, () => 3)).toBe(3);
    sun.dispose();
  });
});

describe("the hall's sun and furniture in motion", () => {
  it("follows a moving piece at most every 33 ms, always draws the pose it rests in, then stops", () => {
    const clock = holdClock(1_000);
    mounted = mountInStubRoot(<HallSunLight />);
    hallSunLight(mounted.scene).intensity = 5;
    const shadow = hallSunShadow(mounted.scene);
    shadow.needsUpdate = false;

    act(() => { publishFurnitureSettleFrame(["chair"]); });
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;
    // The next pose, 16 ms on, waits for a frame a little later.
    clock.set(1_016);
    act(() => { publishFurnitureSettleFrame(["chair"]); });
    expect(shadow.needsUpdate).toBe(false);
    clock.set(1_000 + MOTION_REDRAW_MS + 1);
    act(() => { advance(1, true); });
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;
    // The frame that returns the piece to rest is drawn at once, however soon.
    clock.set(1_000 + MOTION_REDRAW_MS + 5);
    act(() => { publishFurnitureSettleFrame([]); });
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;
    // Nothing moving: nothing to redraw.
    act(() => { publishFurnitureSettleFrame([]); });
    expect(shadow.needsUpdate).toBe(false);

    mounted.unmount();
    mounted = null;
    act(() => { publishFurnitureSettleFrame(["chair"]); });
    expect(shadow.needsUpdate).toBe(false);
  });

  it("draws nothing while its light is dark, and the last pose once it shines again", () => {
    const clock = holdClock(5_000);
    mounted = mountInStubRoot(<HallSunLight />);
    const light = hallSunLight(mounted.scene);
    light.intensity = 0;
    light.shadow.needsUpdate = false;
    act(() => { publishFurnitureSettleFrame(["chair"]); });
    act(() => { publishFurnitureSettleFrame([]); });
    act(() => { advance(1, true); });
    expect(light.shadow.needsUpdate).toBe(false);
    light.intensity = 0.5;
    clock.set(5_000 + MOTION_REDRAW_MS + 1);
    act(() => { advance(2, true); });
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it("draws a dropped-in piece's shadow at every pose it is drawn at, down to the floor", () => {
    const catalogueItem = getCatalogueItemBySlug("banquet-chair");
    if (catalogueItem === undefined) throw new Error("Missing catalogue fixture banquet-chair");
    const item = createPlacedItem(catalogueItem.id, 1.5, -2);
    usePlacementStore.setState({ placedItems: [item] });
    mounted = mountInStubRoot(
      <>
        <HallSunLight />
        <FurnitureMotion />
        <group name={`furniture-${item.id}`} />
      </>,
    );
    hallSunLight(mounted.scene).intensity = 5;
    const shadow = hallSunShadow(mounted.scene);
    const group = mounted.scene.getObjectByName(`furniture-${item.id}`);
    if (group === undefined) throw new Error("Missing the item's group");
    let seconds = 100;
    const clock = holdClock(seconds * 1000);
    const frame = (): void => { clock.set(seconds * 1000); act(() => { advance(seconds, true); }); seconds += 1 / 60; };
    frame();
    shadow.needsUpdate = false;

    dropInFurniture(item.id, 0.14);
    const redrawn: boolean[] = [];
    const heights: number[] = [];
    while (activeFurnitureSettleCount() > 0 && redrawn.length < 600) {
      frame();
      redrawn.push(shadow.needsUpdate);
      heights.push(group.position.y);
      shadow.needsUpdate = false;
    }
    expect(activeFurnitureSettleCount()).toBe(0);
    // In the air while drawn; at sixty frames a second the map followed every
    // other frame at least, and the last frame drew the piece at rest.
    expect(Math.max(...heights)).toBeGreaterThan(0.05);
    expect(redrawn.length).toBeGreaterThan(3);
    expect(redrawn.every((drawn, index) => drawn || redrawn[index + 1] === true || index === redrawn.length - 1)).toBe(true);
    expect(redrawn[redrawn.length - 1]).toBe(true);
    expect(group.position.y).toBe(0);

    frame();
    expect(shadow.needsUpdate).toBe(false);
  });
});

describe("the city arriving round the hall", () => {
  it("redraws the hall's own map once the model stands in the scene", async () => {
    const buffer = cityModel();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buffer) })));
    mounted = mountInStubRoot(
      <>
        <HallSunLight />
        <HallContext />
      </>,
    );
    const shadow = hallSunShadow(mounted.scene);
    shadow.needsUpdate = false;
    expect(mounted.scene.getObjectByName("grand-hall-city")).toBeUndefined();

    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(mounted.scene.getObjectByName("grand-hall-city")).toBeDefined();
    expect(shadow.needsUpdate).toBe(true);
  });

  /** The published street lamps' map and table, and the one-triangle city, each at its own address. */
  function stubCityFiles(lampsOk: boolean): void {
    const city = cityModel();
    const read = (url: string): Buffer => readFileSync(path.resolve("public", url.replace(/^\//u, "").replace(/\?.*$/u, "")));
    const light = read(STREET_LIGHT_URL);
    const table: unknown = JSON.parse(read(STREET_LAMPS_URL).toString("utf8"));
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === CONTEXT_MODEL_URL) return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(city) });
      if (!lampsOk) return Promise.resolve({ ok: false, status: 404 });
      if (url === STREET_LIGHT_URL) {
        return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(light.buffer.slice(light.byteOffset, light.byteOffset + light.byteLength)) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(table) });
    }));
  }

  it("draws the council's street lamps once their map and table arrive", async () => {
    stubCityFiles(true);
    mounted = mountInStubRoot(<HallContext />);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    const city = mounted.scene.getObjectByName("grand-hall-city");
    expect(city?.getObjectByName("grand-hall-street-lamps")).toBeDefined();
    expect(city?.getObjectByName("grand-hall-street-beams")).toBeDefined();
    expect(city?.getObjectByName("grand-hall-street-halos")).toBeDefined();
  });

  it("draws no cones of light on a phone, only the fittings and halos", async () => {
    finish.current = { ...FULL_HALL_FINISH, photoQuality: 0.5 };
    stubCityFiles(true);
    mounted = mountInStubRoot(<HallContext />);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    const city = mounted.scene.getObjectByName("grand-hall-city");
    expect(city?.getObjectByName("grand-hall-street-lamps")).toBeDefined();
    expect(city?.getObjectByName("grand-hall-street-halos")).toBeDefined();
    expect(city?.getObjectByName("grand-hall-street-beams")).toBeUndefined();
  });

  it("stands the city without its lamps when they cannot load", async () => {
    stubCityFiles(false);
    mounted = mountInStubRoot(<HallContext />);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(mounted.scene.getObjectByName("grand-hall-city")).toBeDefined();
    expect(mounted.scene.getObjectByName("grand-hall-street-lamps")).toBeUndefined();
  });
});

describe("the moon in the room (Blake, 22 October 2026: a faint wash)", () => {
  it("adds under 0.05 of the baked light to a level floor at the full moon of 26 October, a tenth of what it did", () => {
    mounted = mountInStubRoot(<HallSunLight />);
    // 20:30 GMT, the moon nearly full and well up over Glassford Street.
    const sky = hallSkyAt(Date.parse("2026-10-26T20:30:00Z"));
    expect(sky.moon.strength).toBeGreaterThan(0.05);
    try {
      act(() => { publishHallSky(sky, false); advance(1, true); });
      const radiance = hallSkyUniforms.lightRadiance.value;
      const onFloor = (0.2126 * radiance.r + 0.7152 * radiance.g + 0.0722 * radiance.b) * Math.max(sky.moon.direction[1], 0);
      // As it was (1.1 on the room), 0.42: more than the floor's whole night light (median 0.38), and it read white.
      expect(onFloor).toBeLessThan(0.05);
      expect(onFloor).toBeGreaterThan(0.02);
      expect(hallSunLight(mounted.scene).intensity).toBeCloseTo(sky.moon.strength * MOON_INTENSITY / 0.07, 6);
    } finally {
      hallSkyState.sky = null;
      hallSkyUniforms.lightRadiance.value.setRGB(0, 0, 0);
    }
  });
});
