import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import type { InstancedMesh, Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import {
  activeFurnitureSettleCount,
  beginFurnitureSettle,
  clearAllFurnitureSettles,
  dropInFurniture,
  furnitureMotionPose,
} from "../../../lib/furniture-motion.js";
import { createPlacedItem, type PlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FurnitureMotion } from "../FurnitureMotion.js";
import { FurnitureContactShadows, shadowUnderMotion } from "../FurnitureContactShadows.js";
import { TableCandles } from "../TableCandles.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function isInstancedMesh(object: Object3D): object is InstancedMesh {
  return (object as Partial<Pick<InstancedMesh, "isInstancedMesh">>).isInstancedMesh === true;
}

function instanced(scene: Object3D, name: string): InstancedMesh {
  const found: InstancedMesh[] = [];
  scene.traverse((object) => {
    if (object.name === name && isInstancedMesh(object)) found.push(object);
  });
  const mesh = found[0];
  if (mesh === undefined) throw new Error(`No ${name} drawn`);
  return mesh;
}

/** Translation x, y, z and the x scale of instance 0 (every piece here is unrotated). */
function slot0(mesh: InstancedMesh): { x: number; y: number; z: number; width: number } {
  const m = mesh.instanceMatrix.array;
  return { x: m[12] ?? Number.NaN, y: m[13] ?? Number.NaN, z: m[14] ?? Number.NaN, width: m[0] ?? Number.NaN };
}

let mounted: StubRoot | null = null;
let seconds = 100;
function frame(): void {
  act(() => { advance(seconds, true); });
  seconds += 1 / 60;
}
function untilAtRest(): void {
  for (let frames = 0; activeFurnitureSettleCount() > 0 && frames < 600; frames += 1) frame();
  // The frame after the last motion returns every follower to store truth.
  frame();
  expect(activeFurnitureSettleCount()).toBe(0);
}

afterEach(() => {
  clearAllFurnitureSettles();
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

describe("shadowUnderMotion", () => {
  const still = { x: 0, z: 0, lift: 0, squash: 0, leanX: 0, leanZ: 0 };

  it("is the placed shadow for a piece on the floor, and follows a glide", () => {
    expect(shadowUnderMotion(still)).toEqual({ dx: 0, dz: 0, darkness: 1, spread: 1 });
    const gliding = shadowUnderMotion({ ...still, x: -0.12, z: 0.07 });
    expect(gliding.dx).toBe(-0.12);
    expect(gliding.dz).toBe(0.07);
  });

  it("lightens and widens with height, at its lightest and widest from 5 cm up", () => {
    const half = shadowUnderMotion({ ...still, lift: 0.025 });
    expect(half.darkness).toBeCloseTo(0.725, 6);
    expect(half.spread).toBeCloseTo(1.125, 6);
    for (const lift of [0.05, 0.14]) {
      const high = shadowUnderMotion({ ...still, lift });
      expect(high.darkness).toBeCloseTo(0.45, 6);
      expect(high.spread).toBeCloseTo(1.25, 6);
    }
  });

  it("widens with the base as a piece squashes into its landing", () => {
    expect(shadowUnderMotion({ ...still, squash: -0.04 }).spread).toBeCloseTo(1.02, 6);
  });
});

describe("contact shadows of furniture in motion", () => {
  function mountChair(): { chair: PlacedItem; shadows: InstancedMesh } {
    const chair = createPlacedItem(catalogueId("banquet-chair"), 2, 1);
    usePlacementStore.setState({ placedItems: [chair] });
    mounted = mountInStubRoot(<><FurnitureMotion /><FurnitureContactShadows /></>);
    frame();
    frame();
    return { chair, shadows: instanced(mounted.scene, "furniture-contact-shadows") };
  }

  it("lie lighter and wider under a piece dropping in, and land with it", () => {
    const { chair, shadows } = mountChair();
    const look = shadows.geometry.getAttribute("look");
    const placedDarkness = look.getX(0);
    const placedWidth = slot0(shadows).width;
    expect(placedDarkness).toBeGreaterThan(0);

    dropInFurniture(chair.id);
    frame();
    expect(furnitureMotionPose(chair.id)?.lift ?? 0).toBeGreaterThan(0.05);
    expect(look.getX(0)).toBeCloseTo(placedDarkness * 0.45, 5);
    expect(slot0(shadows).width).toBeGreaterThan(placedWidth);

    untilAtRest();
    expect(look.getX(0)).toBeCloseTo(placedDarkness, 6);
    expect(slot0(shadows).width).toBeCloseTo(placedWidth, 6);
  });

  it("lie under a piece gliding to the grid, then under where it is placed", () => {
    const { chair, shadows } = mountChair();
    beginFurnitureSettle(chair.id, -0.12, 0.07);
    frame();
    const pose = furnitureMotionPose(chair.id);
    if (pose === null) throw new Error("The settle ended in one frame");
    expect(Math.abs(pose.x)).toBeGreaterThan(0.01);
    expect(slot0(shadows).x).toBeCloseTo(chair.x + pose.x, 5);
    expect(slot0(shadows).z).toBeCloseTo(chair.z + pose.z, 5);

    untilAtRest();
    expect(slot0(shadows).x).toBeCloseTo(chair.x, 6);
    expect(slot0(shadows).z).toBeCloseTo(chair.z, 6);
  });
});

describe("candles on a table in motion", () => {
  function mountTable(): { table: PlacedItem; wax: InstancedMesh; linen: InstancedMesh; pool: InstancedMesh } {
    const table = createPlacedItem(catalogueId("round-table-6ft"), 2, 1);
    usePlacementStore.setState({ placedItems: [table] });
    mounted = mountInStubRoot(<><FurnitureMotion /><TableCandles /></>);
    // The candles' warm-up frames, then one as placed.
    for (let frames = 0; frames < 6; frames += 1) frame();
    const { scene } = mounted;
    return {
      table,
      wax: instanced(scene, "table-candles"),
      linen: instanced(scene, "table-candle-linen-glow"),
      pool: instanced(scene, "table-candle-floor-pool"),
    };
  }

  it("ride the table as it drops in, while the pool of light stays on the floor", () => {
    const { table, wax, linen, pool } = mountTable();
    const placedWax = slot0(wax);
    const placedLinen = slot0(linen);
    const placedPool = slot0(pool);

    dropInFurniture(table.id);
    frame();
    const lift = furnitureMotionPose(table.id)?.lift ?? 0;
    expect(lift).toBeGreaterThan(0.05);
    // Lifted with the table (its squash moves the top by well under a centimetre).
    expect(slot0(wax).y).toBeGreaterThan(placedWax.y + lift - 0.01);
    expect(slot0(linen).y).toBeGreaterThan(placedLinen.y + lift - 0.01);
    expect(slot0(pool).y).toBeCloseTo(placedPool.y, 6);

    untilAtRest();
    expect(slot0(wax).y).toBeCloseTo(placedWax.y, 6);
    expect(slot0(linen).y).toBeCloseTo(placedLinen.y, 6);
  });

  it("glide with a table settling to the grid, the pool of light with them", () => {
    const { table, wax, pool } = mountTable();
    beginFurnitureSettle(table.id, -0.12, 0.07);
    frame();
    const pose = furnitureMotionPose(table.id);
    if (pose === null) throw new Error("The settle ended in one frame");
    expect(slot0(wax).x).toBeCloseTo(table.x + pose.x, 5);
    expect(slot0(wax).z).toBeCloseTo(table.z + pose.z, 5);
    expect(slot0(pool).x).toBeCloseTo(table.x + pose.x, 5);
    expect(slot0(pool).z).toBeCloseTo(table.z + pose.z, 5);

    untilAtRest();
    expect(slot0(wax).x).toBeCloseTo(table.x, 6);
    expect(slot0(pool).x).toBeCloseTo(table.x, 6);
  });
});
