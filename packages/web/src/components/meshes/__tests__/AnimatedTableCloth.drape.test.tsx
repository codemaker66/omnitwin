import { act } from "@testing-library/react";
import { advance, useThree } from "@react-three/fiber";
import { useLayoutEffect, type ReactElement } from "react";
import { DoubleSide, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import { buildShowcaseTour } from "../../../lib/camera-tour.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../../../lib/catalogue.js";
import { CLOTH_DRAPE_LIFT, clothDrapeDelaySeconds } from "../../../lib/cloth-drape.js";
import { setPlannerFeaturesForTesting, type PlannerFeatureOverrides } from "../../../lib/planner-features.js";
import { TABLE_CLOTH_OPACITY } from "../../../lib/table-dressing.js";
import { publishFurniturePresentation, type PresentationFrame, type PresentedPiece } from "../../../floor/presentation-channel.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { AnimatedTableCloth } from "../AnimatedTableCloth.js";
import { TableClothMesh } from "../TableClothMesh.js";
import { mountTestRoot, type TestRoot } from "./r3f-test-root.js";

// ---------------------------------------------------------------------------
// Blake's decision 3, how a cloth goes on, mounted in a real R3F root: which
// animation runs for each key and for Present, and the drape itself — its
// fall, its ripple across a set, its frame requests and its hand-off to the
// static cloth.
// ---------------------------------------------------------------------------

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => motion.reduced }));

const LINEN = "#f4f1ea";

function catalogueItem(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item;
}

const round = catalogueItem("round-table-6ft");
const trestle = catalogueItem("trestle-6ft");

/** The spiral times itself by performance.now(), the drape by the frame clock: a frame moves both. */
let wallMs = 0;
function frameAt(seconds: number): void {
  wallMs = seconds * 1000;
  act(() => { advance(seconds, true); });
}

function CountInvalidations({ onInvalidate }: { readonly onInvalidate: () => void }): null {
  const set = useThree((state) => state.set);
  useLayoutEffect(() => { set({ invalidate: onInvalidate }); }, [set, onInvalidate]);
  return null;
}

function named(root: TestRoot, name: string): Object3D[] {
  return root.scene.getObjectsByProperty("name", name);
}

function only(root: TestRoot, name: string): Object3D {
  const found = named(root, name);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`Expected one ${name}, found ${String(found.length)}`);
  return found[0];
}

function clothMesh(object: Object3D | undefined): Mesh<BufferGeometry, MeshStandardMaterial> {
  const meshes: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  object?.traverse((child) => {
    if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
      meshes.push(child as Mesh<BufferGeometry, MeshStandardMaterial>);
    }
  });
  const [mesh] = meshes;
  if (mesh === undefined) throw new Error("Missing cloth mesh");
  return mesh;
}

function cloth(onComplete: () => void, item: CatalogueItem = round, key?: string): ReactElement {
  return <AnimatedTableCloth key={key} tableItem={item} colorOverride={LINEN} onComplete={onComplete} />;
}

let mounted: TestRoot[] = [];
function mount(element: ReactElement): TestRoot {
  const root = mountTestRoot(element);
  mounted.push(root);
  return root;
}

function withKeys(overrides: PlannerFeatureOverrides): void {
  setPlannerFeaturesForTesting(overrides);
}

/** What the Grand Assembly publishes while it presents the furniture. */
const ASSEMBLY_FRAME: PresentationFrame = { pieces: new Map<string, PresentedPiece>(), others: "placed" };

function presentTour(): void {
  useBookmarkStore.getState().startTour(buildShowcaseTour(TRADES_HALL_GRAND_HALL_DIMENSIONS));
}

beforeEach(async () => {
  // A fresh ripple for each case: the previous case's pass is over.
  await Promise.resolve();
  wallMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => wallMs);
});

afterEach(() => {
  for (const root of mounted) root.unmount();
  mounted = [];
  setPlannerFeaturesForTesting(null);
  useBookmarkStore.getState().clearTour();
  publishFurniturePresentation(null);
  motion.reduced = false;
  vi.restoreAllMocks();
});

describe("AnimatedTableCloth: which animation a cloth goes on with", () => {
  it("both keys off: today's spiral, summoned from 2 m and at rest at 3.2 s", () => {
    withKeys({});
    const done = vi.fn();
    const root = mount(cloth(done));
    frameAt(100);
    expect(named(root, "table-cloth-drape")).toHaveLength(0);
    const spiral = only(root, "table-cloth-spiral");
    expect(spiral.position.y).toBeCloseTo(2, 6);
    frameAt(101);
    expect(spiral.position.y).toBeGreaterThan(0.3);
    frameAt(103.19);
    expect(done).not.toHaveBeenCalled();
    frameAt(103.25);
    expect(done).toHaveBeenCalledTimes(1);
    expect(spiral.position.y).toBe(0);
    expect(clothMesh(spiral).material.opacity).toBe(TABLE_CLOTH_OPACITY);
  });

  it("both keys off: the spiral still plays under reduced motion, as today", () => {
    withKeys({});
    motion.reduced = true;
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(only(root, "table-cloth-spiral").position.y).toBeCloseTo(2, 6);
  });

  it("clothDrape: the drape, 8 cm up and unseen on its first frame", () => {
    withKeys({ clothDrape: true });
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(named(root, "table-cloth-spiral")).toHaveLength(0);
    const drape = only(root, "table-cloth-drape");
    expect(drape.position.y).toBeCloseTo(CLOTH_DRAPE_LIFT, 9);
    expect(clothMesh(drape).material.opacity).toBe(0);
  });

  it("clothDrape while Present's showcase tour plays: the spiral", () => {
    withKeys({ clothDrape: true });
    presentTour();
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(named(root, "table-cloth-drape")).toHaveLength(0);
    expect(only(root, "table-cloth-spiral").position.y).toBeCloseTo(2, 6);
  });

  it("clothDrape while the Grand Assembly presents the furniture: the spiral", () => {
    withKeys({ clothDrape: true });
    publishFurniturePresentation(ASSEMBLY_FRAME);
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(named(root, "table-cloth-drape")).toHaveLength(0);
    expect(named(root, "table-cloth-spiral")).toHaveLength(1);
  });

  it("clothDrapeOnly: the drape while Present plays too", () => {
    withKeys({ clothDrapeOnly: true });
    presentTour();
    publishFurniturePresentation(ASSEMBLY_FRAME);
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(named(root, "table-cloth-spiral")).toHaveLength(0);
    expect(only(root, "table-cloth-drape").position.y).toBeCloseTo(CLOTH_DRAPE_LIFT, 9);
  });

  it("clothDrapeOnly wins over clothDrape", () => {
    withKeys({ clothDrape: true, clothDrapeOnly: true });
    presentTour();
    const root = mount(cloth(vi.fn()));
    frameAt(100);
    expect(named(root, "table-cloth-spiral")).toHaveLength(0);
    expect(named(root, "table-cloth-drape")).toHaveLength(1);
  });

  it.each<[string, PlannerFeatureOverrides, boolean]>([
    ["clothDrape", { clothDrape: true }, false],
    ["clothDrape, with Present playing", { clothDrape: true }, true],
    ["clothDrapeOnly", { clothDrapeOnly: true }, false],
  ])("reduced motion under %s: the cloth is at rest at once, with no motion and no fade", (_name, keys, presenting) => {
    withKeys(keys);
    motion.reduced = true;
    if (presenting) presentTour();
    const done = vi.fn();
    const invalidate: Mock<() => void> = vi.fn();
    const root = mount(<><CountInvalidations onInvalidate={invalidate} />{cloth(done)}</>);
    // Done as it mounts, before any frame is drawn.
    expect(done).toHaveBeenCalledTimes(1);
    expect(named(root, "table-cloth-spiral")).toHaveLength(0);
    const drape = only(root, "table-cloth-drape");
    expect(drape.position.y).toBe(0);
    expect(clothMesh(drape).material.opacity).toBe(TABLE_CLOTH_OPACITY);
    invalidate.mockClear();
    frameAt(100);
    frameAt(100.016);
    expect(drape.position.y).toBe(0);
    expect(clothMesh(drape).material.opacity).toBe(TABLE_CLOTH_OPACITY);
    expect(done).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps the animation it went on with when Present starts part-way", () => {
    withKeys({ clothDrape: true });
    const done = vi.fn();
    const root = mount(cloth(done));
    frameAt(100);
    presentTour();
    root.render(cloth(done));
    frameAt(100.2);
    expect(named(root, "table-cloth-spiral")).toHaveLength(0);
    frameAt(100.46);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("AnimatedTableCloth: the drape", () => {
  it("rests by 450 ms without dipping below, and asks for frames only while it moves", () => {
    withKeys({ clothDrape: true });
    const done = vi.fn();
    const invalidate: Mock<() => void> = vi.fn();
    const root = mount(<><CountInvalidations onInvalidate={invalidate} />{cloth(done)}</>);
    const drape = only(root, "table-cloth-drape");
    const material = clothMesh(drape).material;
    invalidate.mockClear();

    // 120 Hz frames after the first, set half a frame off so none falls on the 450 ms rest itself.
    let previousLift = CLOTH_DRAPE_LIFT;
    for (let frame = 0; frame <= 72; frame++) {
      const elapsed = frame === 0 ? 0 : (2 * frame - 1) / 240;
      const calls = invalidate.mock.calls.length;
      frameAt(100 + elapsed);
      const lift = drape.position.y;
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(previousLift);
      previousLift = lift;
      if (elapsed < 0.45) {
        expect(done).not.toHaveBeenCalled();
        expect(invalidate.mock.calls.length).toBe(calls + 1);
        if (elapsed >= 0.12) expect(material.opacity).toBe(TABLE_CLOTH_OPACITY);
        else expect(material.opacity).toBeLessThan(TABLE_CLOTH_OPACITY);
      } else {
        // The last frame: at rest, and at a settled cloth's opacity.
        expect(done).toHaveBeenCalledTimes(1);
        expect(lift).toBe(0);
        expect(material.opacity).toBe(TABLE_CLOTH_OPACITY);
        expect(invalidate.mock.calls.length).toBe(calls);
      }
    }
  });

  it.each<[string, CatalogueItem]>([["a round", round], ["a trestle", trestle]])(
    "ends on %s exactly as the static cloth that takes over from it",
    (_name, item) => {
      withKeys({ clothDrape: true });
      const root = mount(cloth(vi.fn(), item));
      frameAt(100);
      frameAt(100.5);
      const drape = only(root, "table-cloth-drape");
      const settled = clothMesh(drape);
      const still = clothMesh(mount(<TableClothMesh tableItem={item} colorOverride={LINEN} />).scene);

      expect(drape.position.toArray()).toEqual([0, 0, 0]);
      expect(drape.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(drape.scale.toArray()).toEqual([1, 1, 1]);
      expect(settled.position.toArray()).toEqual(still.position.toArray());
      for (const attribute of ["position", "normal", "uv"] as const) {
        expect(settled.geometry.getAttribute(attribute).array).toEqual(still.geometry.getAttribute(attribute).array);
      }
      expect(settled.geometry.getIndex()?.array).toEqual(still.geometry.getIndex()?.array);

      const drawn = settled.material;
      const resting = still.material;
      expect(drawn.opacity).toBe(resting.opacity);
      expect(drawn.transparent).toBe(resting.transparent);
      expect(drawn.depthWrite).toBe(resting.depthWrite);
      expect(drawn.side).toBe(DoubleSide);
      expect(drawn.side).toBe(resting.side);
      expect(drawn.color.getHex()).toBe(resting.color.getHex());
      expect(drawn.roughness).toBe(resting.roughness);
      expect(drawn.metalness).toBe(resting.metalness);
      expect(drawn.clippingPlanes).toBe(resting.clippingPlanes);
    },
  );

  it("ripples a set: 20 ms a cloth, none later than 300 ms, each at rest 450 ms after its own start", () => {
    withKeys({ clothDrape: true });
    const count = 18;
    const done = Array.from({ length: count }, () => vi.fn());
    const root = mount(<>{done.map((onComplete, index) => cloth(onComplete, round, String(index)))}</>);
    const drapes = named(root, "table-cloth-drape");
    expect(drapes).toHaveLength(count);
    const materials = drapes.map((drape) => clothMesh(drape).material);

    // The first frame starts every cloth's clock; later frames fall on odd
    // milliseconds, never on a start (every 20 ms) or a rest (450 ms after one).
    const firstSeen = new Array<number | null>(count).fill(null);
    const restedAt = new Array<number | null>(count).fill(null);
    frameAt(100);
    for (let ms = 1; ms <= 799; ms += 2) {
      frameAt(100 + ms / 1000);
      materials.forEach((material, index) => {
        if (firstSeen[index] === null && material.opacity > 0) firstSeen[index] = ms;
        if (restedAt[index] === null && (done[index]?.mock.calls.length ?? 0) > 0) restedAt[index] = ms;
      });
    }

    for (let index = 0; index < count; index++) {
      const startMs = clothDrapeDelaySeconds(index) * 1000;
      expect(startMs).toBeCloseTo(Math.min(index * 20, 300), 6);
      expect(firstSeen[index]).toBeGreaterThan(startMs);
      expect(firstSeen[index]).toBeLessThanOrEqual(startMs + 2);
      expect(restedAt[index]).toBeGreaterThanOrEqual(startMs + 450);
      expect(restedAt[index]).toBeLessThanOrEqual(startMs + 452);
      expect(done[index]).toHaveBeenCalledTimes(1);
      expect(drapes[index]?.position.y).toBe(0);
    }
  });

  it("starts a new ripple for a cloth that goes on after the set", async () => {
    withKeys({ clothDrape: true });
    const first = [vi.fn(), vi.fn(), vi.fn()];
    const root = mount(<>{first.map((onComplete, index) => cloth(onComplete, round, String(index)))}</>);
    frameAt(100);
    frameAt(100.101);
    await Promise.resolve();

    const later = vi.fn();
    root.render(<>{[...first.map((onComplete, index) => cloth(onComplete, round, String(index))), cloth(later, round, "later")]}</>);
    const drapes = named(root, "table-cloth-drape");
    expect(drapes).toHaveLength(4);
    const lateMaterial = clothMesh(drapes[3]).material;
    frameAt(100.103);
    expect(lateMaterial.opacity).toBe(0);
    frameAt(100.105);
    // Seen 2 ms after it went on: the head of its own ripple, not fourth in the old one (60 ms).
    expect(lateMaterial.opacity).toBeGreaterThan(0);
    frameAt(100.552);
    expect(later).not.toHaveBeenCalled();
    frameAt(100.554);
    expect(later).toHaveBeenCalledTimes(1);
    for (const onComplete of first) expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
