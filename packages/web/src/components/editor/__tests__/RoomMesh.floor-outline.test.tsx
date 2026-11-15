import {
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it } from "vitest";
import { toRenderSpace } from "../../../constants/scale.js";
import { roomGeometries, type RoomGeometry } from "../../../data/room-geometries.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { PlannerInteractionFloor } from "../PlannerInteractionFloor.js";
import { RoomMesh } from "../RoomMesh.js";

// ---------------------------------------------------------------------------
// The drawn floor of every room stands on the room's own outline, the one its
// walls are computed from. Each outline is [x, z] in metres. The floor and each
// feature are three Shapes laid flat by the mesh's -90 degree turn about x, and
// these checks carry the Shape's own points (and the geometry three builds
// from it) through that mounted mesh's world matrix: no sign is written by hand.
// ---------------------------------------------------------------------------

type Outline = readonly (readonly [number, number])[];

/** A room no Trades Hall room is: front-to-back asymmetric, with a feature. */
const ROOM_WITH_FEATURE: RoomGeometry = {
  wallPolygon: [[1, 2], [5, 2], [5, 4], [3, 4], [3, 7], [1, 7]],
  ceilingHeight: 3,
  features: [{ type: "platform", label: "Test Dais", height: 0.4, polygon: [[1.5, 2.5], [2.5, 2.5], [2.5, 3.5]] }],
  hasDome: false,
  domeRadius: 0,
};

const ROOMS: readonly (readonly [string, RoomGeometry])[] = [
  ...Object.entries(roomGeometries),
  ["Test room with a feature", ROOM_WITH_FEATURE],
];

/** Rooms that are their own mirror image front to back, which hid the defect. */
const FRONT_BACK_SYMMETRIC = ["Grand Hall", "Saloon"];

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(geometry: RoomGeometry): Object3D {
  mounted = mountInStubRoot(
    <>
      <RoomMesh geometry={geometry} detail="detailed" includeLighting={false} />
      <PlannerInteractionFloor geometry={geometry} dimensions={{ width: 1, length: 1, height: 1 }} />
    </>,
  );
  mounted.scene.updateWorldMatrix(true, true);
  return mounted.scene;
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

function meshes(root: Object3D, test: (mesh: Mesh) => boolean): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object) && test(object)) found.push(object);
  });
  return found;
}

function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (found === undefined) throw new Error(`No ${name} in the mounted room`);
  return found;
}

const r = (value: number): number => Number(value.toFixed(6)) || 0;
const key = (x: number, z: number): string => `[${String(r(x))}, ${String(r(z))}]`;

function shapeOf(geometry: BufferGeometry): Shape {
  if (!(geometry instanceof ShapeGeometry) && !(geometry instanceof ExtrudeGeometry)) {
    throw new Error("Expected a ShapeGeometry or an ExtrudeGeometry");
  }
  const { shapes } = geometry.parameters;
  const shape = Array.isArray(shapes) ? shapes[0] : shapes;
  if (shape === undefined) throw new Error("Geometry has no shape");
  return shape;
}

/** The mesh's Shape points carried through the mesh's own world matrix. */
function drawnPoints(mesh: Mesh): Vector3[] {
  const points = shapeOf(mesh.geometry).getPoints();
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first !== undefined && last !== undefined && first.equals(last)) points.pop();
  return points.map((point) => new Vector3(point.x, point.y, 0).applyMatrix4(mesh.matrixWorld));
}

/** The drawn outline as world [x, z] keys, in the outline's order. */
function drawnOutline(mesh: Mesh): string[] {
  return drawnPoints(mesh).map((world) => key(world.x, world.z));
}

function expectedOutline(polygon: Outline): string[] {
  return polygon.map(([x, z]) => key(toRenderSpace(x), toRenderSpace(z)));
}

/** The first point where two outlines part, or null when they agree. */
function firstMismatch(label: string, drawn: readonly string[], outline: readonly string[]): string | null {
  for (let i = 0; i < Math.max(drawn.length, outline.length); i++) {
    if (drawn[i] !== outline[i]) {
      return `${label}: outline point ${String(i)} is ${outline[i] ?? "missing"} but is drawn at ${drawn[i] ?? "nowhere"}`;
    }
  }
  return null;
}

function worldVertices(mesh: Mesh): Vector3[] {
  const position = mesh.geometry.getAttribute("position");
  const vertices: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  }
  return vertices;
}

function triangles(mesh: Mesh): [Vector3, Vector3, Vector3][] {
  const vertices = worldVertices(mesh);
  const index = mesh.geometry.getIndex();
  const order = index === null ? vertices.map((_v, i) => i) : Array.from(index.array);
  const result: [Vector3, Vector3, Vector3][] = [];
  for (let i = 0; i + 2 < order.length; i += 3) {
    const a = vertices[order[i] ?? -1], b = vertices[order[i + 1] ?? -1], c = vertices[order[i + 2] ?? -1];
    if (a !== undefined && b !== undefined && c !== undefined) result.push([a, b, c]);
  }
  return result;
}

/** Every vertex of a flat floor as "world x, world z -> u, v". */
function vertexTexturePairs(mesh: Mesh): string[] {
  const uv = mesh.geometry.getAttribute("uv");
  return worldVertices(mesh)
    .map((world, i) => `${key(world.x, world.z)} -> ${key(uv.getX(i), uv.getY(i))}`)
    .sort();
}

/** The floor exactly as master drew it, under the mounted floor's own turn. */
function floorAsMasterDrewIt(polygon: Outline, floor: Mesh): Mesh {
  const shape = new Shape();
  polygon.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(toRenderSpace(x), toRenderSpace(z));
    else shape.lineTo(toRenderSpace(x), toRenderSpace(z));
  });
  shape.closePath();
  const mesh = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial());
  mesh.position.copy(floor.position);
  mesh.rotation.copy(floor.rotation);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function floors(root: Object3D): Mesh[] {
  return meshes(root, (mesh) => mesh.name === "floor");
}

describe("RoomMesh draws each room's floor on its own outline", () => {
  it.each(ROOMS)("%s: both floors, the walls and the interaction floor share one outline", (room, geometry) => {
    const root = mount(geometry);
    const outline = expectedOutline(geometry.wallPolygon);
    const drawnFloors = floors(root);
    // The detailed shell's floor and the lean shell's floor.
    expect(drawnFloors).toHaveLength(2);

    for (const floor of drawnFloors) {
      // The triangles three built reach exactly the outline's corners (what
      // shows: a room that is its own mirror image front to back passes this
      // even when mirrored)...
      const drawnCorners = [...new Set(worldVertices(floor).map((v) => key(v.x, v.z)))].sort();
      const missing = [...new Set(outline)].filter((corner) => !drawnCorners.includes(corner));
      expect(missing, `${room}: outline corners the drawn floor does not reach`).toEqual([]);
      expect(drawnCorners, `${room}, floor corners`).toEqual([...new Set(outline)].sort());
      // ...and each of the Shape's own points lands on its own outline point.
      expect(firstMismatch(`${room}, floor`, drawnOutline(floor), outline)).toBeNull();
    }

    // The walls stand on the drawn floor's edges.
    const detailedFloor = drawnFloors[0];
    if (detailedFloor === undefined) throw new Error("No floor");
    const drawn = drawnPoints(detailedFloor);
    const edgeMidpoints = new Set(drawn.map((a, i) => {
      const b = drawn[(i + 1) % drawn.length] ?? a;
      return key((a.x + b.x) / 2, (a.z + b.z) / 2);
    }));
    const walls = meshes(named(root, "room-mesh-lean-shell"), (mesh) => mesh.name.startsWith("wall-"));
    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) {
      const at = new Vector3().setFromMatrixPosition(wall.matrixWorld);
      expect(edgeMidpoints.has(key(at.x, at.z)), `${room}: a wall at ${key(at.x, at.z)} stands off the drawn floor`).toBe(true);
    }

    // Clicks and placement already used the true outline through their own shape and turn.
    const interaction = meshes(root, (mesh) => mesh.name === "planner-interaction-floor")[0];
    if (interaction === undefined) throw new Error("No interaction floor");
    expect(firstMismatch(`${room}, interaction floor`, drawnOutline(interaction), outline)).toBeNull();
  });

  it.each(ROOMS)("%s: the floor faces up after the turn", (room, geometry) => {
    for (const floor of floors(mount(geometry))) {
      const facing = triangles(floor).map(([a, b, c]) => new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)));
      expect(facing.length).toBeGreaterThan(0);
      expect(facing.filter((normal) => !(normal.y > 0)), `${room}: floor triangles facing down`).toEqual([]);
    }
  });

  it("draws a feature on its own outline, standing as a closed solid whose faces face out", () => {
    const root = mount(ROOM_WITH_FEATURE);
    const feature = ROOM_WITH_FEATURE.features[0];
    if (feature === undefined) throw new Error("No feature");
    const mesh = meshes(root, (m) => m.name === "feature-test-dais")[0];
    if (mesh === undefined) throw new Error("No feature mesh");
    expect(mesh.geometry).toBeInstanceOf(ExtrudeGeometry);
    const outline = expectedOutline(feature.polygon);
    expect(firstMismatch("Test Dais", drawnOutline(mesh), outline)).toBeNull();
    const footprint = [...new Set(worldVertices(mesh).map((v) => key(v.x, v.z)))].sort();
    expect(footprint).toEqual([...outline].sort());
    // A closed mesh's signed volume is positive exactly when its faces face out.
    const signedVolume = triangles(mesh).reduce((sum, [a, b, c]) => sum + a.dot(new Vector3().crossVectors(b, c)) / 6, 0);
    expect(signedVolume).toBeGreaterThan(0);
  });

  it("names the rooms that are their own mirror image front to back", () => {
    const symmetric = ROOMS.filter(([, geometry]) => {
      const points = expectedOutline(geometry.wallPolygon);
      const mirrored = expectedOutline(geometry.wallPolygon.map(([x, z]) => [x, -z] as const));
      return [...points].sort().join() === [...mirrored].sort().join();
    }).map(([room]) => room);
    expect(symmetric).toEqual(FRONT_BACK_SYMMETRIC);
  });

  // A ShapeGeometry's UVs are its shape's (x, y). The turn carries shape (x, y)
  // to world (x, -y) on the floor, so a floor point at world (x, z) has UV
  // (x, -z) whichever sign the shape was built with: the texture is pinned to
  // the world, not to the outline. Building the shape from (x, -z) instead of
  // (x, z) only changes which world points the floor covers, and for a room
  // that is its own mirror image front to back that set is the same.
  it.each(ROOMS)("%s: a floor point's texture coordinate is fixed by where it stands", (room, geometry) => {
    for (const floor of floors(mount(geometry))) {
      const uv = floor.geometry.getAttribute("uv");
      worldVertices(floor).forEach((world, i) => {
        expect(key(uv.getX(i), uv.getY(i)), `${room}: UV at ${key(world.x, world.z)}`).toBe(key(world.x, -world.z));
      });
    }
  });

  it.each(ROOMS.filter(([room]) => FRONT_BACK_SYMMETRIC.includes(room)))(
    "%s: the floor and its texture are exactly as master drew them",
    (_room, geometry) => {
      for (const floor of floors(mount(geometry))) {
        const before = floorAsMasterDrewIt(geometry.wallPolygon, floor);
        try {
          expect(vertexTexturePairs(floor)).toEqual(vertexTexturePairs(before));
        } finally {
          before.geometry.dispose();
          (before.material as MeshBasicMaterial).dispose();
        }
      }
    },
  );
});
