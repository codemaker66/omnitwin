import { act } from "@testing-library/react";
import {
  InstancedMesh,
  Light,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Texture,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomGeometries, type RoomGeometry } from "../../../data/room-geometries.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useVisibilityStore, type WallKey } from "../../../stores/visibility-store.js";
import { mountFrameRoot, type FrameRoot } from "../../__tests__/r3f-frame-root.js";
import { RoomMesh } from "../RoomMesh.js";

// ---------------------------------------------------------------------------
// Camera gestures swap the planner's detailed room shell for a lean one. The
// drawn content in each state is pinned below (identical before and after the
// shells were kept mounted); the identity checks prove nothing is rebuilt.
// ---------------------------------------------------------------------------

const textures = vi.hoisted(() => ({ created: [] as Texture[], disposals: new Map<Texture, number>() }));
vi.mock("../../../lib/grand-hall-textures.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/grand-hall-textures.js")>();
  const make = (): Texture => {
    const texture = new Texture();
    texture.addEventListener("dispose", () => {
      textures.disposals.set(texture, (textures.disposals.get(texture) ?? 0) + 1);
    });
    textures.created.push(texture);
    return texture;
  };
  return { ...actual, createParquetFloorTexture: vi.fn(make), createDomeInteriorTexture: vi.fn(make) };
});

function grandHall(): RoomGeometry {
  const geometry = roomGeometries["Grand Hall"];
  if (geometry === undefined) throw new Error("Missing Grand Hall geometry");
  return geometry;
}

const WALLS: readonly WallKey[] = ["wall-back", "wall-front", "wall-left", "wall-right"];

/**
 * Detailed shell at rest (standalone room lighting, parquet map, brick walls).
 * The walls' click planes are hidden: raycast (see below), never drawn.
 */
const DETAILED_AT_REST = [
  "AmbientLight:0.3",
  "HemisphereLight:1.2",
  "LineSegments::LineBasicMaterial:true:0.22",
  "Mesh:floor:MeshStandardMaterial+map:false:1",
  ...WALLS.map((key) => `InstancedMesh:${key}:MeshStandardMaterial:true:1`),
].sort();

/** Lean shell: unlit floor and walls, no lights, features or dome. */
const LEAN = [
  "LineSegments::LineBasicMaterial:true:0.22",
  "Mesh:floor:MeshBasicMaterial:false:1",
  ...WALLS.map((key) => `Mesh:${key}:MeshBasicMaterial:true:0.86`),
].sort();

const initialVisibility = useVisibilityStore.getState();
let mounted: FrameRoot | null = null;

beforeEach(() => {
  useVisibilityStore.setState(initialVisibility, true);
  useCockpitStore.setState({ cameraInteractionActive: false });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  textures.created.length = 0;
  textures.disposals.clear();
  useVisibilityStore.setState(initialVisibility, true);
  act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });
});

function mountRoom(element: React.ReactElement, width = 1440): FrameRoot {
  const root = mountFrameRoot(element, width);
  mounted = root;
  // Stand in the middle of the hall: no wall auto-fades.
  root.store.getState().camera.position.set(0, 4, 0);
  root.frame();
  root.frame();
  return root;
}

function setCameraInteraction(root: FrameRoot, active: boolean, frames = 2): void {
  act(() => { useCockpitStore.setState({ cameraInteractionActive: active }); });
  for (let i = 0; i < frames; i++) root.frame();
}

/** What three draws or lights (visible meshes, lines and lights), ornaments excluded. */
function drawnSignature(root: Object3D): string[] {
  const out: string[] = [];
  const visit = (object: Object3D): void => {
    if (!object.visible || object.name === "grand-hall-ornaments") return;
    if (object instanceof Light) out.push(`${object.type}:${String(object.intensity)}`);
    if (object instanceof Mesh || object instanceof LineSegments) {
      const material = object.material as Material;
      const map = material instanceof MeshStandardMaterial && material.map !== null ? "+map" : "";
      const kind = object instanceof InstancedMesh ? "InstancedMesh" : object.type;
      out.push(`${kind}:${object.name}:${material.type}${map}:${String(material.transparent)}:${String(material.opacity)}`);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out.sort();
}

function collect<T extends Object3D>(root: Object3D, test: (object: Object3D) => object is T): T[] {
  const out: T[] = [];
  root.traverse((object) => { if (test(object)) out.push(object); });
  return out;
}

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;
const isLight = (object: Object3D): object is Light => object instanceof Light;

function brickWall(root: Object3D, key: WallKey): InstancedMesh {
  const wall = collect(root, (object): object is InstancedMesh => object instanceof InstancedMesh && object.name === key)[0];
  if (wall === undefined) throw new Error(`Missing brick wall ${key}`);
  return wall;
}

describe("RoomMesh shells across camera gestures", () => {
  it("draws the detailed shell at rest and only the lean shell while the camera moves", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="grand-hall" />);
    expect(drawnSignature(root.scene)).toEqual(DETAILED_AT_REST);
    for (let gesture = 0; gesture < 2; gesture++) {
      setCameraInteraction(root, true);
      expect(drawnSignature(root.scene)).toEqual(LEAN);
      setCameraInteraction(root, false);
      expect(drawnSignature(root.scene)).toEqual(DETAILED_AT_REST);
    }
  });

  it("draws feature meshes with the detailed shell only", () => {
    const withPlatform: RoomGeometry = {
      ...grandHall(),
      features: [{ type: "platform", polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]], height: 0.4, label: "Top Table" }],
    };
    const root = mountRoom(<RoomMesh geometry={withPlatform} variant="generic" />);
    const feature = "Mesh:feature-top-table:MeshStandardMaterial:false:1";
    expect(drawnSignature(root.scene)).toContain(feature);
    setCameraInteraction(root, true);
    expect(drawnSignature(root.scene)).toEqual(LEAN);
    setCameraInteraction(root, false);
    expect(drawnSignature(root.scene)).toContain(feature);
  });

  it("keeps only the lean shell on narrow canvases and never builds the detailed one", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="grand-hall" />, 768);
    expect(drawnSignature(root.scene)).toEqual(LEAN);
    expect(collect(root.scene, (object): object is InstancedMesh => object instanceof InstancedMesh)).toHaveLength(0);
    expect(textures.created).toHaveLength(0);
    setCameraInteraction(root, true);
    expect(drawnSignature(root.scene)).toEqual(LEAN);
    // No brick wall exists here to animate a tapped wall, so the lean walls
    // are not click-controlled.
    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    root.frame();
    expect(drawnSignature(root.scene)).toEqual(LEAN);
  });

  it("keeps brick walls, floor, dome, lights and textures instead of rebuilding them after each gesture", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="grand-hall" />);
    const walls = WALLS.map((key) => {
      const wall = brickWall(root.scene, key);
      return [wall, wall.geometry, wall.material, wall.instanceMatrix];
    });
    const meshes = collect(root.scene, isMesh);
    const lights = collect(root.scene, isLight);
    expect(lights).toHaveLength(2);
    expect(textures.created).toHaveLength(2);

    for (let gesture = 0; gesture < 2; gesture++) {
      setCameraInteraction(root, true);
      setCameraInteraction(root, false);
    }

    expect(WALLS.map((key) => {
      const wall = brickWall(root.scene, key);
      return [wall, wall.geometry, wall.material, wall.instanceMatrix];
    })).toEqual(walls);
    const after = collect(root.scene, isMesh);
    expect(after).toHaveLength(meshes.length);
    after.forEach((mesh, i) => {
      expect(mesh, mesh.name).toBe(meshes[i]);
      expect(mesh.geometry, mesh.name).toBe(meshes[i]?.geometry);
      expect(mesh.material, mesh.name).toBe(meshes[i]?.material);
    });
    expect(collect(root.scene, isLight)).toEqual(lights);
    expect(textures.created).toHaveLength(2);
    expect(textures.disposals.size).toBe(0);

    root.unmount();
    mounted = null;
    expect(textures.created.map((texture) => textures.disposals.get(texture))).toEqual([1, 1]);
  });

  it("raycasts only the shell that is drawn", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="generic" />);
    const hitsTowardBackWall = (): string[] => {
      root.scene.updateMatrixWorld(true);
      return new Raycaster(new Vector3(0.37, 3.1, 0), new Vector3(0, 0, -1))
        .intersectObject(root.scene, true)
        .map((hit) => `${hit.object.name}:${((hit.object as Mesh).material as Material).type}`);
    };
    const rest = hitsTowardBackWall();
    expect(rest).toContain("wall-back-click-plane:MeshBasicMaterial");
    expect(rest).toContain("wall-back:MeshStandardMaterial");
    expect(rest).not.toContain("wall-back:MeshBasicMaterial");

    setCameraInteraction(root, true);
    expect(hitsTowardBackWall()).toEqual(["wall-back:MeshBasicMaterial"]);

    setCameraInteraction(root, false);
    expect(hitsTowardBackWall()).toEqual(rest);
  });

  it("requests a frame whenever the drawn shell changes, as remounting the shells did", () => {
    for (const variant of ["grand-hall", "generic"] as const) {
      const root = mountRoom(<RoomMesh geometry={grandHall()} variant={variant} />);
      for (const active of [true, false, true, false]) {
        const before = root.invalidations();
        // Settling arrives from a timer once the camera has stopped, so
        // nothing else would draw the detailed shell back.
        act(() => { useCockpitStore.setState({ cameraInteractionActive: active }); });
        expect(root.invalidations(), `${variant} interaction ${String(active)}`).toBeGreaterThan(before);
        root.frame();
      }
      root.unmount();
      mounted = null;
    }
  });

  it("keeps click animations in time behind a gesture without fading walls or requesting frames", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="generic" />);
    // Click the back wall away, let the disassembly finish, then start rebuilding it.
    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    for (let i = 0; i < 120; i++) root.frame(0.05);
    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    root.frame(0.05);

    // A gesture that ends near the front wall: the auto-fade driver waits for
    // the detailed shell, and the hidden bricks request no frames of their own.
    setCameraInteraction(root, true, 0);
    root.store.getState().camera.position.set(0, 3, 5);
    const opacity = useVisibilityStore.getState().wallOpacity;
    const invalidations = root.invalidations();
    for (let i = 0; i < 20; i++) root.frame(0.05);
    expect(useVisibilityStore.getState().wallOpacity).toBe(opacity);
    expect(root.invalidations()).toBe(invalidations);
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(true);
    // The rebuilding wall is not drawn whole by the lean shell.
    expect(drawnSignature(root.scene)).toEqual(LEAN.filter((entry) => !entry.includes(":wall-back:")));

    // The rebuild keeps the time of the frames drawn meanwhile, as the wall's
    // ornaments do, so it finishes and releases the wall five seconds after
    // the click, and the lean shell shows the wall again.
    for (let i = 0; i < 80; i++) root.frame(0.05);
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(false);
    expect(useVisibilityStore.getState().wallOpacity).toBe(opacity);
    expect(drawnSignature(root.scene)).toEqual(LEAN);

    // Settling resumes the auto-fade: the front wall fades from the camera.
    setCameraInteraction(root, false, 1);
    for (let i = 0; i < 200; i++) root.frame(0.05);
    expect(useVisibilityStore.getState().wallOpacity["wall-front"]).toBeLessThan(0.5);
    const back = brickWall(root.scene, "wall-back");
    expect(back.visible).toBe(true);
    expect((back.material as MeshStandardMaterial).opacity).toBe(1);
  });

  it("keeps a clicked-away wall away through gestures instead of replaying its disassembly", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="grand-hall" />);
    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    for (let i = 0; i < 120; i++) root.frame(0.05);
    const wall = brickWall(root.scene, "wall-back");
    expect(wall.visible).toBe(false);
    const version = wall.instanceMatrix.version;
    const withoutBackWall = (signature: readonly string[]): string[] => signature.filter((entry) => !entry.includes(":wall-back:"));

    for (let gesture = 0; gesture < 3; gesture++) {
      setCameraInteraction(root, true);
      // No whole wall flashes back while the camera moves.
      expect(drawnSignature(root.scene)).toEqual(withoutBackWall(LEAN));
      setCameraInteraction(root, false, 1);
      const invalidations = root.invalidations();
      for (let i = 0; i < 120; i++) root.frame(0.05);
      expect(drawnSignature(root.scene)).toEqual(withoutBackWall(DETAILED_AT_REST));
      expect(brickWall(root.scene, "wall-back")).toBe(wall);
      expect(wall.visible).toBe(false);
      expect(wall.instanceMatrix.version).toBe(version);
      expect(root.invalidations()).toBe(invalidations);
    }

    // Clicking it back still rebuilds it brick by brick over five seconds.
    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    root.frame(0.05);
    expect(wall.visible).toBe(true);
    expect((wall.material as MeshStandardMaterial).opacity).toBeCloseTo(0.03, 9);
    for (let i = 0; i < 48; i++) root.frame(0.05);
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(true);
    for (let i = 0; i < 60; i++) root.frame(0.05);
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(false);
    expect((wall.material as MeshStandardMaterial).opacity).toBe(1);
    expect(drawnSignature(root.scene)).toEqual(DETAILED_AT_REST);
  });

  it("carries a clicked wall's animation through a gesture in step with its ornaments", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="grand-hall" />);
    const wall = brickWall(root.scene, "wall-back");
    const daylight = root.scene.getObjectByName("arched-window-daylight-pane-rect");
    if (!(daylight instanceof Mesh) || !(daylight.material instanceof MeshStandardMaterial)) {
      throw new Error("Missing window-wall ornament");
    }
    const ornamentOpacity = (): number => (daylight.material as MeshStandardMaterial).opacity;
    const brickOpacity = (): number => (wall.material as MeshStandardMaterial).opacity;

    act(() => { useVisibilityStore.getState().toggleWall("wall-back"); });
    for (let i = 0; i < 30; i++) root.frame(0.05);
    setCameraInteraction(root, true, 0);
    for (let i = 0; i < 30; i++) root.frame(0.05);
    setCameraInteraction(root, false, 0);
    for (let i = 0; i < 20; i++) root.frame(0.05);
    // Four seconds into the five-second disassembly for both: the bricks
    // resumed where the ornaments are (progress 0.2, their fade at 3x), rather
    // than restarting from a whole wall.
    expect(ornamentOpacity()).toBeCloseTo(0.2, 9);
    expect(brickOpacity()).toBeCloseTo(0.6, 9);
    expect(wall.visible).toBe(true);

    for (let i = 0; i < 20; i++) root.frame(0.05);
    expect(wall.visible).toBe(false);
    expect(root.scene.getObjectByName("window-wall-ornament-cluster")?.visible).toBe(false);
  });

  it("leaves a settled wall's rest matrices untouched across a gesture", () => {
    const root = mountRoom(<RoomMesh geometry={grandHall()} variant="generic" />);
    const wall = brickWall(root.scene, "wall-left");
    const version = wall.instanceMatrix.version;
    const matrices = Array.from(wall.instanceMatrix.array);
    setCameraInteraction(root, true);
    setCameraInteraction(root, false);
    expect(brickWall(root.scene, "wall-left")).toBe(wall);
    expect(wall.instanceMatrix.version).toBe(version);
    expect(Array.from(wall.instanceMatrix.array)).toEqual(matrices);
  });
});
