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
import { HallSunLight } from "../HallSunLight.js";
import { createSunCaster, requestHallSunRedraw, withoutSunMapDraw } from "../hall-sun.js";

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  // Leave the motion registry's "last frame moved" flag at rest for the next test.
  publishFurnitureSettleFrame([]);
  usePlacementStore.setState({ placedItems: [] });
  vi.unstubAllGlobals();
});

/** The hall's sun as HallSunLight puts it in the scene. */
function hallSunShadow(scene: Object3D): LightShadow {
  const light = scene.getObjectByName("grand-hall-sun");
  if (!(light instanceof DirectionalLight)) throw new Error("HallSunLight did not add the hall's sun");
  return light.shadow;
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
  it("redraws the map on each frame a piece moves and on the frame it comes to rest, then stops", () => {
    mounted = mountInStubRoot(<HallSunLight />);
    const shadow = hallSunShadow(mounted.scene);
    shadow.needsUpdate = false;

    act(() => { publishFurnitureSettleFrame(["chair"]); });
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;
    act(() => { publishFurnitureSettleFrame(["chair"]); });
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;
    // The frame that returns the piece to rest.
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
    const shadow = hallSunShadow(mounted.scene);
    const group = mounted.scene.getObjectByName(`furniture-${item.id}`);
    if (group === undefined) throw new Error("Missing the item's group");
    let seconds = 100;
    const frame = (): void => { act(() => { advance(seconds, true); }); seconds += 1 / 60; };
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
    // In the air while drawn, and every one of those frames redrew the map,
    // the last of them the piece at rest on the floor.
    expect(Math.max(...heights)).toBeGreaterThan(0.05);
    expect(redrawn.length).toBeGreaterThan(3);
    expect(redrawn.every(Boolean)).toBe(true);
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
});
