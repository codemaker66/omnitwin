import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { diveClickGuard } from "../../../../twin/DollhouseStage.js";
import { useArrivalStore } from "../arrival-store.js";

// -----------------------------------------------------------------------------
// ExplodedHall — click, springs, labels, CTAs (Arrival Task 10).
//
// happy-dom has no WebGL and no real R3F reconciler, so — matching HallHandoff
// .test.tsx / ArrivalHero.test.tsx's own convention — this mocks
// @react-three/fiber (useThree/useFrame) and react-router-dom (useNavigate)
// wholesale and exercises the component's ORCHESTRATION: which target the
// spring steps toward, what gets reparented and when, what reaches the
// overlay bridge. `bucketAndReparentChunks` and `handleHallClick` are ALSO
// exported pure(ish) functions and get their own direct, render-free coverage
// — mirroring how DollhouseStage.test.tsx tests diveClickGuard itself rather
// than firing a synthetic raycast through a rendered mesh.
//
// Spring-progress assertions read WORLD POSITION off the ORIGINAL mesh
// instances (kept by reference from before render), not screen-space label
// pixels — attach() preserves object identity across reparenting, so
// `mesh.getWorldPosition()` reflects wherever the mesh currently lives in the
// live scene graph, however many groups deep, without this suite needing to
// reach into the component's private split ref.
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];

const fakeCamera = new PerspectiveCamera(45, 800 / 600, 1, 1000);
fakeCamera.position.set(-40, 20, 40);
fakeCamera.lookAt(0, 5, 0);
fakeCamera.updateMatrixWorld(true);
const fakeSize = { width: 800, height: 600 };

interface FakeThreeState {
  readonly invalidate: () => void;
  readonly camera: PerspectiveCamera;
  readonly size: { width: number; height: number };
}
const fakeThreeState: FakeThreeState = {
  invalidate,
  camera: fakeCamera,
  size: fakeSize,
};

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: FakeThreeState) => unknown) => selector(fakeThreeState),
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const {
  ARRIVAL_STOREY_LABELS,
  EXPLODE_SPRING,
  ExplodedHall,
  STOREY_SEPARATION_M,
  bucketAndReparentChunks,
  handleHallClick,
  useExplodeOverlayStore,
} = await import("../ExplodedHall.js");

/** Latest registered useFrame callback — real R3F replaces the subscription
 *  every render; this mock only appends, so tests must always grab the most
 *  recent one after any store mutation that re-renders the component. */
function latestFrame(): (state: unknown, delta: number) => void {
  const cb = frameCallbacks.at(-1);
  if (cb === undefined) {
    throw new Error("no useFrame callback registered");
  }
  return cb;
}

/** Step the spring comfortably past settling (mirrors HallHandoff.test.tsx's
 *  own "30 * 0.25s clears any of this file's springs" convention). */
function stepUntilSettled(): void {
  const onFrame = latestFrame();
  for (let i = 0; i < 30; i += 1) {
    onFrame(undefined, 0.25);
  }
}

function buildTwoStoreyScene(): { scene: Group; lowerBox: Mesh; upperBox: Mesh } {
  const scene = new Group();
  const lowerBox = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  lowerBox.position.set(2, 1, 3);
  const upperBox = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  upperBox.position.set(-1, 8, 4);
  scene.add(lowerBox, upperBox);
  return { scene, lowerBox, upperBox };
}

function node(id: string, floor: number, zMeters: number): TwinScanNode {
  return { id, index: 0, pose: { q: [1, 0, 0, 0], t: [0, 0, zMeters] }, floor, roomSlug: null };
}

/** e57PointToThree maps E57 t[2] (Z-up height) to three's Y — chosen so the
 *  resulting boundary (midpoint of means, 4.5) splits buildTwoStoreyScene's
 *  boxes (world Y 1 and 8) into buckets 0 and 1 exactly. */
const TWO_FLOOR_NODES: readonly TwinScanNode[] = [
  node("scan_000", 0, 1),
  node("scan_001", 1, 8),
];

beforeEach(() => {
  useArrivalStore.getState().reset();
  useExplodeOverlayStore.getState().reset();
  invalidate.mockClear();
  navigateMock.mockClear();
  frameCallbacks.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("exported tuning constants", () => {
  it("matches the brief's seed spring and separation", () => {
    expect(EXPLODE_SPRING).toEqual({ stiffness: 120, damping: 20 });
    expect(STOREY_SEPARATION_M).toBe(5);
  });

  it("names real rooms, matching TwinViewer.tsx:116's floor convention", () => {
    // Manifest floor -1 (the GROUND floor / entrance) holds Reception Room and
    // Robert Adam Room; floor 0 (the building's FIRST floor) holds Grand Hall
    // and Saloon. storeyFloors() sorts ascending, so bucket 0 is the lower
    // (ground) storey and bucket 1 the upper.
    expect(ARRIVAL_STOREY_LABELS).toHaveLength(2);
    expect(ARRIVAL_STOREY_LABELS[0]).toContain("Reception Room");
    expect(ARRIVAL_STOREY_LABELS[0]).toContain("Robert Adam Room");
    expect(ARRIVAL_STOREY_LABELS[1]).toContain("Grand Hall");
    expect(ARRIVAL_STOREY_LABELS[1]).toContain("Saloon");
  });
});

describe("bucketAndReparentChunks", () => {
  it("buckets three chunks at three heights into three groups, preserving world position", () => {
    const low = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    low.position.set(2, 1, 3);
    const mid = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mid.position.set(5, 6, -1);
    const high = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    high.position.set(-3, 12, 4);
    const container = new Group();
    container.add(low, mid, high);

    // Matches storey-explode.test.ts's own SAMPLES fixture (floors 0/1/2,
    // boundaries [4.25, 9.75]) so this test's expectations are cross-checked
    // against Task 9's own pinned numbers.
    const boundaries = [4.25, 9.75];
    const result = bucketAndReparentChunks(container, boundaries);

    expect(result).toHaveLength(3);

    // Group membership: each chunk landed in the bucket its height implies.
    expect(result[0]?.group.children).toContain(low);
    expect(result[1]?.group.children).toContain(mid);
    expect(result[2]?.group.children).toContain(high);
    expect(low.parent).toBe(result[0]?.group);
    expect(mid.parent).toBe(result[1]?.group);
    expect(high.parent).toBe(result[2]?.group);

    // The original container is empty — every chunk moved out of it.
    expect(container.children).toHaveLength(0);

    // World position preserved: at this instant every storey group is still
    // at its freshly-constructed identity transform, so attach() must have
    // reproduced each chunk's ORIGINAL world position exactly.
    const scratch = new Vector3();
    low.getWorldPosition(scratch);
    expect(scratch.toArray()).toEqual([2, 1, 3]);
    mid.getWorldPosition(scratch);
    expect(scratch.toArray()).toEqual([5, 6, -1]);
    high.getWorldPosition(scratch);
    expect(scratch.toArray()).toEqual([-3, 12, 4]);

    // Settled offsets: applying explodeOffsetY at full progress (1) moves
    // bucket 1 up by one separation and bucket 2 by two, ground floor never.
    const explodeOffsetYByHand = (bucket: number): number => (bucket === 0 ? 0 : bucket * 1 * 6);
    for (const entry of result) {
      entry.group.position.y = explodeOffsetYByHand(entry.bucket);
    }
    low.getWorldPosition(scratch);
    expect(scratch.y).toBe(1); // ground floor: unmoved
    mid.getWorldPosition(scratch);
    expect(scratch.y).toBe(6 + 6); // bucket 1: +1 * separation
    high.getWorldPosition(scratch);
    expect(scratch.y).toBe(12 + 12); // bucket 2: +2 * separation
  });

  it("skips a chunk whose geometry has no position data, rather than crashing", () => {
    const empty = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    const real = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    real.position.set(0, 6, 0);
    const container = new Group();
    container.add(empty, real);

    const result = bucketAndReparentChunks(container, [4.25, 9.75]);

    expect(real.parent).not.toBe(container);
    // The degenerate mesh was left exactly where it was — never attached
    // into any bucket group.
    expect(empty.parent).toBe(container);
    expect(result.every((entry) => !entry.group.children.includes(empty))).toBe(true);
  });

  it("single-floor input (no boundaries) buckets everything into bucket 0", () => {
    const only = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    only.position.set(0, 3, 0);
    const container = new Group();
    container.add(only);

    const result = bucketAndReparentChunks(container, []);
    expect(result).toHaveLength(1);
    expect(result[0]?.group.children).toContain(only);
  });
});

describe("handleHallClick", () => {
  it("explodes when not currently exploded", () => {
    const explode = vi.fn();
    const navigateToTour = vi.fn();
    handleHallClick("arrived", { explode, navigateToTour });
    expect(explode).toHaveBeenCalledTimes(1);
    expect(navigateToTour).not.toHaveBeenCalled();
  });

  it("navigates to the tour when already exploded", () => {
    const explode = vi.fn();
    const navigateToTour = vi.fn();
    handleHallClick("exploded", { explode, navigateToTour });
    expect(navigateToTour).toHaveBeenCalledTimes(1);
    expect(explode).not.toHaveBeenCalled();
  });
});

describe("diveClickGuard contract (re-verified for this component's dependency)", () => {
  it("refuses an 11px drag", () => {
    const onCleanClick = vi.fn();
    const stopPropagation = vi.fn();
    diveClickGuard({ delta: 11, stopPropagation }, onCleanClick);
    expect(onCleanClick).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("allows a clean click", () => {
    const onCleanClick = vi.fn();
    const stopPropagation = vi.fn();
    diveClickGuard({ delta: 1, stopPropagation }, onCleanClick);
    expect(onCleanClick).toHaveBeenCalledTimes(1);
  });
});

describe("ExplodedHall — component", () => {
  it("does not reparent anything before the first explode", () => {
    useArrivalStore.setState({ phase: "arrived" });
    const { scene, lowerBox, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    latestFrame()(undefined, 0.25);
    latestFrame()(undefined, 0.25);

    expect(scene.children).toContain(lowerBox);
    expect(scene.children).toContain(upperBox);
    expect(useExplodeOverlayStore.getState().labels).toEqual([]);
  });

  it("bucket-and-reparents on first entry to exploded, then drives the spring to settle at 1", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene, lowerBox, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );

    stepUntilSettled();

    expect(scene.children).toHaveLength(0); // reparented out

    const scratch = new Vector3();
    lowerBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(1, 1); // bucket 0: never moves
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8 + STOREY_SEPARATION_M, 1); // bucket 1: +1 separation

    const overlay = useExplodeOverlayStore.getState();
    expect(overlay.settled).toBe(true);
    expect(overlay.labels.length).toBeGreaterThan(0);
    for (const label of overlay.labels) {
      expect(Number.isFinite(label.xPx)).toBe(true);
      expect(Number.isFinite(label.yPx)).toBe(true);
    }
  });

  it("reassembles back to the original position when reassembled, and clears labels", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene, lowerBox, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    stepUntilSettled();

    useArrivalStore.setState({ phase: "arrived" });
    stepUntilSettled();

    const scratch = new Vector3();
    lowerBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(1, 1);
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8, 1); // back to its original, un-exploded height

    const overlay = useExplodeOverlayStore.getState();
    expect(overlay.settled).toBe(true);
    expect(overlay.labels).toEqual([]);
  });

  it("re-explodes correctly a second time, proving the split runs only once and survives reuse", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    const scratch = new Vector3();

    stepUntilSettled();
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8 + STOREY_SEPARATION_M, 1);

    useArrivalStore.setState({ phase: "arrived" });
    stepUntilSettled();
    upperBox.getWorldPosition(scratch);
    // Genuinely came back down — not merely "still at the exploded value",
    // which a broken reassemble that left the spring stuck would also read.
    expect(scratch.y).toBeCloseTo(8, 1);

    useArrivalStore.setState({ phase: "exploded" });
    stepUntilSettled();
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8 + STOREY_SEPARATION_M, 1);
  });

  it("reverses smoothly on a mid-animation reassemble — no snap", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );

    // A few steps in — moving, but nowhere near settled.
    latestFrame()(undefined, 0.1);
    latestFrame()(undefined, 0.1);
    const scratch = new Vector3();
    upperBox.getWorldPosition(scratch);
    const yBeforeReversal = scratch.y;
    expect(yBeforeReversal).toBeGreaterThan(8);
    expect(yBeforeReversal).toBeLessThan(8 + STOREY_SEPARATION_M);

    // Reverse the target mid-flight, then take one TINY step.
    useArrivalStore.setState({ phase: "arrived" });
    latestFrame()(undefined, 0.001);
    upperBox.getWorldPosition(scratch);
    const yAfterTinyStep = scratch.y;

    // A snap (spring reset to 0) would jump straight back to 8; a proper
    // spring reversal changes only infinitesimally for an infinitesimal dt.
    expect(Math.abs(yAfterTinyStep - yBeforeReversal)).toBeLessThan(0.05);

    // …and given enough further time, it genuinely does settle back down.
    stepUntilSettled();
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8, 1);
  });

  it("labels track while animating and stop changing once settled", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );

    latestFrame()(undefined, 0.15);
    const labelsA = useExplodeOverlayStore.getState().labels;
    latestFrame()(undefined, 0.15);
    const labelsB = useExplodeOverlayStore.getState().labels;
    expect(labelsB).not.toEqual(labelsA); // tracking: position changed frame to frame

    stepUntilSettled();
    const labelsSettled = useExplodeOverlayStore.getState().labels;
    latestFrame()(undefined, 0.25); // one more frame at rest
    const labelsAfterRest = useExplodeOverlayStore.getState().labels;
    // Settled guard returns before any recompute — the exact same reference.
    expect(labelsAfterRest).toBe(labelsSettled);
  });

  it("invalidates while the spring is unsettled, and stops once settled", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    invalidate.mockClear();

    latestFrame()(undefined, 0.1);
    expect(invalidate).toHaveBeenCalled();
    const midCount = invalidate.mock.calls.length;

    stepUntilSettled();
    const settledCount = invalidate.mock.calls.length;
    expect(settledCount).toBeGreaterThan(midCount);

    latestFrame()(undefined, 0.25);
    expect(invalidate.mock.calls.length).toBe(settledCount); // no further calls
  });

  it("resets the overlay store on unmount", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { scene } = buildTwoStoreyScene();
    const { unmount } = render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    stepUntilSettled();
    expect(useExplodeOverlayStore.getState().labels.length).toBeGreaterThan(0);

    unmount();
    expect(useExplodeOverlayStore.getState()).toMatchObject({ settled: true, labels: [] });
  });
});
