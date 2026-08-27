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
import { useExplodeOverlayStore } from "../explode-overlay-store.js";
import { explodeOffsetY } from "../storey-explode.js";
import { twinPlacementMatrix } from "../twin-placement.js";

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
//
// IMPORTANT: react-dom (this file's render()) has NO idea what a `<group
// matrix={...}>` JSX element means — react-three-fiber's reconciler is what
// turns that into a real THREE.Object3D parent/child relationship, and it is
// not in play here. So `placementMatrix` passed as a PROP never actually
// gets applied to `scene`/its chunks via the rendered JSX in this suite; most
// tests below use identity and never notice. The ONE test that needs a real,
// non-identity placement to be meaningful (frame-unification, Important 2)
// builds the real THREE.js parent chain itself, by hand, with a comment
// explaining why it — alone — needs to.
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

/**
 * storeySamplesFromNodes applies `placementMatrix` DIRECTLY to the raw pose
 * triple (Important 2's frame-unification fix) — with the IDENTITY
 * placementMatrix these simplified tests pass, that is a no-op, no axis
 * permutation. So the "height" here goes straight into t[1] (three's own Y
 * slot), matching how buildTwoStoreyScene's boxes are ALSO placed directly
 * in un-rotated three-space via `.position.set(x, y, z)` — both sides need
 * to already agree on which slot is "up" when nothing is rotating either of
 * them. (A REAL manifest pose is never this: it is E57-frame, and only
 * agrees with three's Y after going through the real placementMatrix, which
 * always carries the twin-basis rotation — see the frame-unification test
 * below, which uses a real rotating placementMatrix and therefore a real
 * E57-shaped fixture instead of this shortcut.)
 *
 * Chosen so the resulting boundary (midpoint of means, 4.5) splits
 * buildTwoStoreyScene's boxes (world Y 1 and 8) into buckets 0 and 1 exactly.
 */
function node(id: string, floor: number, yMeters: number): TwinScanNode {
  return { id, index: 0, pose: { q: [1, 0, 0, 0], t: [0, yMeters, 0] }, floor, roomSlug: null };
}

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

    // Settled offsets: a REAL call to the exported explodeOffsetY (Task 9),
    // at full progress (1) with the component's own STOREY_SEPARATION_M —
    // this is the actual integration point ExplodedHall's useFrame uses,
    // not a hand-rolled stand-in for it.
    for (const entry of result) {
      entry.group.position.y = explodeOffsetY(entry.bucket, 1, STOREY_SEPARATION_M);
    }
    low.getWorldPosition(scratch);
    expect(scratch.y).toBe(1); // ground floor: unmoved
    mid.getWorldPosition(scratch);
    expect(scratch.y).toBe(6 + STOREY_SEPARATION_M); // bucket 1: +1 * separation
    high.getWorldPosition(scratch);
    expect(scratch.y).toBe(12 + 2 * STOREY_SEPARATION_M); // bucket 2: +2 * separation
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

  it("warns in dev mode when the same container is bucketed twice, without crashing (Important 1)", () => {
    // The hazard this guards: a caller passing a shared/cached scene (never
    // cloned per mount) rather than a fresh one — bucketing it more than
    // once is exactly the shape that takes. HallHandoff.tsx never does this
    // (cloneHandoffMaterials clones per mount), so this only fires for a
    // FUTURE caller who bypasses that contract.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    box.position.set(0, 3, 0);
    const container = new Group();
    container.add(box);

    bucketAndReparentChunks(container, []);
    expect(warnSpy).not.toHaveBeenCalled();

    bucketAndReparentChunks(container, []);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("per-mount clone");

    warnSpy.mockRestore();
  });

  it("buckets identically under a non-zero placement, because sample and chunk share one frame (Important 2, Task 8 trip-wire)", () => {
    // twinPlacementMatrix — the REAL production composition (a genuine yaw
    // AND a large translate, not just a translate) — applied to a
    // deliberately unrealistic-looking offset: if storeySamplesFromNodes and
    // chunkWorldCentroid ever again computed Y in two DIFFERENT frames, this
    // heading+offset combination would misbucket badly, not subtly.
    //
    // react-dom cannot wire a JSX `<group matrix={...}>` prop into a real
    // THREE.js parent/child relationship (see this file's header), so this
    // test builds that relationship BY HAND: scene becomes a real child of a
    // real Group carrying nonZeroPlacement, exactly as HallHandoffMesh's own
    // placement group would in the real app.
    const nonZeroPlacement = twinPlacementMatrix({ headingRad: 0.4, positionM: [10, 100, -10] });

    useArrivalStore.setState({ phase: "exploded" });
    const { scene, lowerBox, upperBox } = buildTwoStoreyScene();
    const placementGroup = new Group();
    placementGroup.matrixAutoUpdate = false;
    placementGroup.matrix.copy(nonZeroPlacement);
    placementGroup.add(scene);
    placementGroup.updateMatrixWorld(true);

    // The manifest's node poses are chosen to match each chunk's own LOCAL
    // position exactly — so storeySamplesFromNodes and chunkWorldCentroid
    // transform an IDENTICAL input through the IDENTICAL matrix, and any
    // future frame mismatch would show up as a wrong bucket assignment here,
    // for ANY placementMatrix — not just today's real (zero) one.
    const nodes: readonly TwinScanNode[] = [
      {
        id: "scan_lo",
        index: 0,
        pose: {
          q: [1, 0, 0, 0],
          t: [lowerBox.position.x, lowerBox.position.y, lowerBox.position.z],
        },
        floor: 0,
        roomSlug: null,
      },
      {
        id: "scan_hi",
        index: 1,
        pose: {
          q: [1, 0, 0, 0],
          t: [upperBox.position.x, upperBox.position.y, upperBox.position.z],
        },
        floor: 1,
        roomSlug: null,
      },
    ];

    // Independently compute each chunk's ORIGINAL (pre-explode) world Y via
    // the same matrix, without going through the component at all.
    const originalLowerY = lowerBox.position.clone().applyMatrix4(nonZeroPlacement).y;
    const originalUpperY = upperBox.position.clone().applyMatrix4(nonZeroPlacement).y;
    // Don't assume the rotation preserves which one is numerically "lower" —
    // derive it, so this test is robust to whatever the yaw does to order.
    const groundIsLower = originalLowerY <= originalUpperY;
    const groundBox = groundIsLower ? lowerBox : upperBox;
    const movingBox = groundIsLower ? upperBox : lowerBox;
    const groundOriginalY = groundIsLower ? originalLowerY : originalUpperY;
    const movingOriginalY = groundIsLower ? originalUpperY : originalLowerY;

    render(
      <ExplodedHall scene={scene} placementMatrix={nonZeroPlacement} nodes={nodes} />,
    );
    stepUntilSettled();

    const scratch = new Vector3();
    groundBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(groundOriginalY, 1); // ground storey: unmoved
    movingBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(movingOriginalY + STOREY_SEPARATION_M, 1); // +1 separation
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

  it("excludes a storey's label when its anchor is behind the camera (Minor 2)", () => {
    // The test camera sits at (-40, 20, 40) looking at (0, 5, 0) — a point
    // roughly on the opposite ray from the camera's own position is behind
    // it. Single floor (no boundaries): everything lands in bucket 0, which
    // never moves, so its pre-explode position IS its post-explode position.
    useArrivalStore.setState({ phase: "exploded" });
    const behindBox = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    behindBox.position.set(-120, 50, 120);
    const scene = new Group();
    scene.add(behindBox);
    const nodes: readonly TwinScanNode[] = [node("scan_only", 0, 0)];

    render(<ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={nodes} />);
    stepUntilSettled();

    const overlay = useExplodeOverlayStore.getState();
    expect(overlay.settled).toBe(true); // the spring itself still settles…
    expect(overlay.labels).toEqual([]); // …but nothing is placed on screen
  });
});

describe("ExplodedHall — reduced motion (spec §2, Important 4)", () => {
  it("jumps straight to fully exploded in a single frame — no intermediate progress", () => {
    useArrivalStore.setState({ phase: "exploded", reducedMotion: true });
    const { scene, lowerBox, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );

    latestFrame()(undefined, 0.1); // one ordinary tick, not a settling loop
    const scratch = new Vector3();
    lowerBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(1, 5);
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8 + STOREY_SEPARATION_M, 5);
    expect(useExplodeOverlayStore.getState().settled).toBe(true);
  });

  it("jumps straight back to assembled in a single frame on reassemble", () => {
    useArrivalStore.setState({ phase: "exploded", reducedMotion: true });
    const { scene, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    latestFrame()(undefined, 0.1); // exploded instantly

    useArrivalStore.setState({ phase: "arrived" });
    latestFrame()(undefined, 0.1); // one tick to reassemble
    const scratch = new Vector3();
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeCloseTo(8, 5);
    expect(useExplodeOverlayStore.getState().settled).toBe(true);
  });

  it("does NOT jump when reducedMotion is false (contrast case)", () => {
    useArrivalStore.setState({ phase: "exploded", reducedMotion: false });
    const { scene, upperBox } = buildTwoStoreyScene();
    render(
      <ExplodedHall scene={scene} placementMatrix={new Matrix4()} nodes={TWO_FLOOR_NODES} />,
    );
    latestFrame()(undefined, 0.1);
    const scratch = new Vector3();
    upperBox.getWorldPosition(scratch);
    expect(scratch.y).toBeGreaterThan(8);
    expect(scratch.y).toBeLessThan(8 + STOREY_SEPARATION_M); // still mid-flight
  });
});
