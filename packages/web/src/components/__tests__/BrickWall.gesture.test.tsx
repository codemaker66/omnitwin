import { act } from "@testing-library/react";
import { InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrickWall } from "../BrickWall.js";
import { SurfaceVisibilityGroup } from "../SurfaceVisibilityGroup.js";
import { useVisibilityStore } from "../../stores/visibility-store.js";
import { mountFrameRoot, type FrameRoot } from "./r3f-frame-root.js";

// ---------------------------------------------------------------------------
// The planner hides the detailed room shell, bricks included, while the camera
// moves (BrickWall `active={false}`), and the wall's dressing stays on screen.
// A clicked wall must come back where its click animation would be, in step
// with its dressing: a wall that is never hidden, stepped with the same frame
// deltas, is the oracle.
// ---------------------------------------------------------------------------

const initialVisibility = useVisibilityStore.getState();
let roots: FrameRoot[] = [];

beforeEach(() => {
  useVisibilityStore.setState(initialVisibility, true);
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  useVisibilityStore.setState(initialVisibility, true);
});

function Wall({ active, dressed = false }: { readonly active: boolean; readonly dressed?: boolean }): React.ReactElement {
  return (
    <>
      <BrickWall
        wallWidth={8}
        wallHeight={4}
        position={[0, 2, -5]}
        rotation={[0, 0, 0]}
        color="#b08a68"
        name="wall-back"
        active={active}
      />
      {dressed && (
        <SurfaceVisibilityGroup surfaceKey="wall-back" name="wall-back-dressing">
          <mesh name="dressing-panel" position={[0, 2, -4.9]}>
            <boxGeometry args={[1, 1, 0.05]} />
            <meshStandardMaterial />
          </mesh>
        </SurfaceVisibilityGroup>
      )}
    </>
  );
}

function mount(dressed = false): FrameRoot {
  const root = mountFrameRoot(<Wall active dressed={dressed} />);
  roots.push(root);
  root.frame();
  return root;
}

/** Hides or shows the wall with its shell, as `RoomShellLayer` does for a camera gesture. */
function setShown(root: FrameRoot, active: boolean, dressed = false): void {
  root.rerender(<Wall active={active} dressed={dressed} />);
}

const isBrickWall = (object: Object3D): object is InstancedMesh => object instanceof InstancedMesh && object.name === "wall-back";

function bricks(root: FrameRoot): InstancedMesh {
  const found: InstancedMesh[] = [];
  root.scene.traverse((object) => {
    if (isBrickWall(object)) found.push(object);
  });
  const [mesh] = found;
  if (mesh === undefined) throw new Error("Missing brick wall");
  return mesh;
}

function brickOpacity(root: FrameRoot): number {
  const { material } = bricks(root);
  if (!(material instanceof MeshStandardMaterial)) throw new Error("Unexpected brick material");
  return material.opacity;
}

function matrices(root: FrameRoot): number[] {
  return Array.from(bricks(root).instanceMatrix.array);
}

function step(frameRoots: readonly FrameRoot[], count: number, delta = 0.05): void {
  for (let i = 0; i < count; i++) for (const root of frameRoots) root.frame(delta);
}

function clickWall(): void {
  act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
}

describe("BrickWall hidden with its shell during a camera gesture", () => {
  it("stays away when shown again after being clicked away, without replaying", () => {
    const root = mount();
    clickWall();
    step([root], 120);
    const mesh = bricks(root);
    expect(mesh.visible).toBe(false);
    const version = mesh.instanceMatrix.version;

    for (let gesture = 0; gesture < 3; gesture++) {
      setShown(root, false);
      step([root], 30);
      setShown(root, true);
      const invalidations = root.invalidations();
      step([root], 120);
      expect(mesh.visible).toBe(false);
      expect(mesh.instanceMatrix.version).toBe(version);
      expect(root.invalidations()).toBe(invalidations);
    }
  });

  it("resumes an animation hidden part-way exactly where an always-shown wall is", () => {
    const reference = mount();
    const hidden = mount();
    clickWall();
    step([reference, hidden], 20);

    setShown(hidden, false);
    const version = bricks(hidden).instanceMatrix.version;
    const invalidations = hidden.invalidations();
    step([reference, hidden], 30);
    // While hidden the wall writes no brick matrices and requests no frames.
    expect(bricks(hidden).instanceMatrix.version).toBe(version);
    expect(hidden.invalidations()).toBe(invalidations);

    setShown(hidden, true);
    for (let i = 0; i < 40; i++) {
      step([reference, hidden], 1);
      expect(matrices(hidden)).toEqual(matrices(reference));
      expect(brickOpacity(hidden)).toBe(brickOpacity(reference));
    }
    step([reference, hidden], 20);
    expect(bricks(reference).visible).toBe(false);
    expect(bricks(hidden).visible).toBe(false);
  });

  it("rebuilds brick by brick when clicked back after a gesture", () => {
    const reference = mount();
    const hidden = mount();
    clickWall();
    step([reference, hidden], 120);
    setShown(hidden, false);
    step([reference, hidden], 10);
    setShown(hidden, true);
    step([reference, hidden], 1);

    clickWall();
    const frames = new Set<string>();
    for (let i = 0; i < 5; i++) {
      step([reference, hidden], 1);
      expect(matrices(hidden)).toEqual(matrices(reference));
      frames.add(matrices(hidden).join(","));
    }
    // Every frame moved the bricks: animated, not snapped back.
    expect(frames.size).toBe(5);
    expect(bricks(hidden).visible).toBe(true);
    expect(brickOpacity(hidden)).toBeCloseTo(0.15, 9);

    step([reference, hidden], 100);
    expect(brickOpacity(hidden)).toBe(1);
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(false);
  });
});

describe("SurfaceVisibilityGroup dressing of a wall hidden with its shell", () => {
  function dressingOpacity(root: FrameRoot): number {
    const panel = root.scene.getObjectByName("dressing-panel");
    if (!(panel instanceof Mesh) || !(panel.material instanceof MeshStandardMaterial)) throw new Error("Missing dressing");
    return panel.material.opacity;
  }

  it("keeps the dressing's click fade in step with the bricks through a gesture", () => {
    const root = mount(true);
    clickWall();
    step([root], 30);
    expect(dressingOpacity(root)).toBeCloseTo(0.7, 9);

    setShown(root, false, true);
    step([root], 30);
    // The dressing stays on screen and keeps fading while the bricks are hidden.
    expect(dressingOpacity(root)).toBeCloseTo(0.4, 9);

    setShown(root, true, true);
    step([root], 20);
    // Four seconds into the five-second disassembly for both.
    expect(dressingOpacity(root)).toBeCloseTo(0.2, 9);
    expect(brickOpacity(root)).toBeCloseTo(0.6, 9);

    step([root], 20);
    expect(root.scene.getObjectByName("wall-back-dressing")?.visible).toBe(false);
    expect(bricks(root).visible).toBe(false);

    // Clicking back after another gesture rebuilds both together from nothing.
    setShown(root, false, true);
    step([root], 10);
    setShown(root, true, true);
    clickWall();
    step([root], 10);
    expect(dressingOpacity(root)).toBeCloseTo(0.1, 9);
    expect(brickOpacity(root)).toBeCloseTo(0.3, 9);
    step([root], 90);
    expect(dressingOpacity(root)).toBe(1);
    expect(brickOpacity(root)).toBe(1);
  });
});
