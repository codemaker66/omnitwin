import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { TwinScanNode } from "@omnitwin/types";
import { E57_TO_THREE_QUAT, MESH_OFFSET_M, e57PointToThree } from "../twin-basis.js";

// -----------------------------------------------------------------------------
// DollhouseStage — render contract (Twin Phase 2, Task 4).
//
// happy-dom has no WebGL and no real GLB pipeline, so this is a structure
// test, not a loader test: drei's useGLTF is mocked wholesale (the CockpitScene
// Overlays pattern — three intrinsics render as inert custom elements whose
// array props serialise to attributes), and the meshopt decoder module is
// stubbed. What IS pinned here is the load-bearing contract:
//   - useGLTF is called (meshUrl, true, true, extendLoader) and the
//     extendLoader hands the meshopt decoder to the GLTFLoader;
//   - the mesh root group carries E57_TO_THREE_QUAT + MESH_OFFSET_M;
//   - node dots render OUTSIDE that rotated group at e57PointToThree(t);
//   - a clean click on a dot calls onDive(id); a drag (delta > 4 px) does not.
// The real loader path runs headless in the Task-8 e2e against a byte fixture.
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate }),
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
}));

/** The loader surface the extendLoader contract touches. */
interface LoaderLike {
  setMeshoptDecoder: (decoder: unknown) => unknown;
}
type UseGLTFSignature = (
  path: string,
  useDraco?: boolean,
  useMeshopt?: boolean,
  extendLoader?: (loader: LoaderLike) => void,
) => { scene: { isFakeGltfScene: boolean } };

const useGLTFMock = vi.fn<UseGLTFSignature>(() => ({ scene: { isFakeGltfScene: true } }));
vi.mock("@react-three/drei", () => ({ useGLTF: useGLTFMock }));

const fakeDecoder = { ready: Promise.resolve(), supported: true };
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: fakeDecoder,
}));

const {
  DOLLHOUSE_DOT_PULSE_BASE,
  DOLLHOUSE_DOT_RADIUS_M,
  DollhouseStage,
  diveClickGuard,
} = await import("../DollhouseStage.js");

function node(id: string, index: number, x: number, y: number): TwinScanNode {
  return { id, index, pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] }, floor: 0, roomSlug: null };
}

const NODES: readonly TwinScanNode[] = [
  node("scan_000", 0, 0, 0),
  node("scan_001", 1, 2.5, 0),
  node("scan_002", 2, 5, -2.5),
];

const MESH_URL = "/twin/trades-hall/mesh/dollhouse.glb";

function mount(onDive: (id: string) => void = vi.fn()) {
  return render(
    <DollhouseStage meshUrl={MESH_URL} nodes={NODES} currentId="scan_001" onDive={onDive} />,
  );
}

beforeEach(() => {
  invalidate.mockClear();
  useGLTFMock.mockClear();
  frameCallbacks.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("DollhouseStage — mesh frame", () => {
  it("loads the GLB via useGLTF with draco+meshopt enabled and an extendLoader", () => {
    mount();
    expect(useGLTFMock).toHaveBeenCalledTimes(1);
    const [url, useDraco, useMeshopt, extendLoader] = useGLTFMock.mock.calls[0] ?? [];
    expect(url).toBe(MESH_URL);
    expect(useDraco).toBe(true);
    expect(useMeshopt).toBe(true);
    // The extendLoader pins the version-matched three decoder on the loader.
    const setMeshoptDecoder = vi.fn();
    expect(extendLoader).toBeDefined();
    extendLoader?.({ setMeshoptDecoder });
    expect(setMeshoptDecoder).toHaveBeenCalledWith(fakeDecoder);
  });

  it("wraps the GLB scene in a group carrying E57_TO_THREE_QUAT and MESH_OFFSET_M", () => {
    const { container } = mount();
    // Markers ride Object3D.name (a real three property) — data-* props are
    // pierced as nested paths by R3F and crash real nodes.
    const meshRoot = container.querySelector('group[name="twin-mesh-root"]');
    expect(meshRoot).not.toBeNull();
    expect(meshRoot?.getAttribute("quaternion")).toBe(E57_TO_THREE_QUAT.join(","));
    expect(meshRoot?.getAttribute("position")).toBe(MESH_OFFSET_M.join(","));
    // The useGLTF scene mounts inside the rotated group as a <primitive>.
    expect(meshRoot?.querySelector("primitive")).not.toBeNull();
  });
});

describe("DollhouseStage — node dots", () => {
  it("renders one dot per node at e57PointToThree(t), outside the mesh group", () => {
    const { container } = mount();
    const dots = [...container.querySelectorAll('group[name^="twin-dot-"]')];
    expect(dots).toHaveLength(NODES.length);
    for (const [index, twinNode] of NODES.entries()) {
      expect(dots[index]?.getAttribute("name")).toBe(`twin-dot-${twinNode.id}`);
      const expected = e57PointToThree(twinNode.pose.t);
      expect(dots[index]?.getAttribute("position")).toBe(expected.join(","));
    }
    // Dots share the pose frame directly — never the mesh's rotated group.
    const meshRoot = container.querySelector('group[name="twin-mesh-root"]');
    expect(meshRoot?.querySelector('group[name^="twin-dot-"]')).toBeNull();
  });

  it("renders gold spheres at the pinned dot radius", () => {
    const { container } = mount();
    const dot = container.querySelector('group[name^="twin-dot-"]');
    const sphere = dot?.querySelector("spheregeometry");
    expect(sphere?.getAttribute("args")?.startsWith(`${String(DOLLHOUSE_DOT_RADIUS_M)},`)).toBe(
      true,
    );
  });

  it("gives only the current node's dot the pulse-strength emissive", () => {
    const { container } = mount();
    // React lowercases unknown camelCase props when rendering them as DOM
    // attributes, so emissiveIntensity is queryable as emissiveintensity.
    const pulsing = [
      ...container.querySelectorAll(
        `meshstandardmaterial[emissiveintensity="${String(DOLLHOUSE_DOT_PULSE_BASE)}"]`,
      ),
    ];
    expect(pulsing).toHaveLength(1);
    expect(pulsing[0]?.closest('group[name^="twin-dot-"]')?.getAttribute("name")).toBe(
      "twin-dot-scan_001",
    );
  });

  it("calls onDive(id) on a clean click of a dot's hit sphere", () => {
    const onDive = vi.fn();
    const { container } = mount(onDive);
    const dot = container.querySelector('group[name="twin-dot-scan_002"]');
    const hit = dot?.querySelector('mesh[name="twin-dot-hit"]');
    expect(hit).not.toBeNull();
    if (hit !== null && hit !== undefined) {
      fireEvent.click(hit);
    }
    expect(onDive).toHaveBeenCalledExactlyOnceWith("scan_002");
  });

  it("swallows a look-drag that ends over a dot (delta > 4 px)", () => {
    // Same event.delta contract as NavMarkers, exported pure so the guard is
    // testable without synthesising a real R3F raycast event.
    const onDive = vi.fn();
    const stopPropagation = vi.fn();
    diveClickGuard({ delta: 12, stopPropagation }, () => {
      onDive("scan_002");
    });
    expect(onDive).not.toHaveBeenCalled();
    diveClickGuard({ delta: 2, stopPropagation }, () => {
      onDive("scan_002");
    });
    expect(onDive).toHaveBeenCalledExactlyOnceWith("scan_002");
    expect(stopPropagation).toHaveBeenCalledTimes(2);
  });
});
