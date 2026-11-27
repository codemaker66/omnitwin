// ---------------------------------------------------------------------------
// A surveyed room's surfaces as three geometries
//
// room-geometry.ts builds plain arrays; this wraps them, uncopied, as one
// BufferGeometry per surface: position, normal and uv (the photograph's
// coordinates), and on the walls `aWallNormal`, each vertex's own wall's
// normal (x, z), which the walls' material reads (room-materials.ts). Indices
// are 16-bit where the vertices allow, as the Grand Hall's are.
//
// The walls stay one draw, and each wall can still be taken away
// (room-visibility.ts says which): `show` packs the indices of the walls to
// draw to the front of the walls' index and sets the draw range to cover
// them. The ceiling's draw range is all or nothing. A draw range is what
// three both draws and raycasts, so a wall or ceiling that is not drawn is
// not met by a measuring ray either.
//
// Why this way, of the three there were:
//
//   - One mesh a wall: a draw, a render object and a set of uniforms a wall
//     in every pass, a dozen where one does, and three raycasts a mesh
//     whether or not it is visible, so each would need its own gate.
//   - Geometry groups: no buffer writes, but groups are drawn only for a
//     material array, and every other mesh of the planner has one material.
//   - A draw range over a repacked index: one mesh, one material, one draw,
//     as before. The cost is writing the index again when the set of walls
//     changes, a few times in an orbit (the Saloon's is 75,651 indices,
//     0.3 MB).
//
// The walls' index is therefore its own 32-bit copy from the start. three
// r186's WebGPU backend replaces a 16-bit index array with a 32-bit copy at
// its first upload (WebGPUAttributeUtils.createAttribute), after which
// writes to the first array would reach nothing; a 32-bit array stays the
// attribute's own, and its bytes are always a multiple of four, which
// WebGPU's writeBuffer asks of a whole-array update.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry } from "three";
import type { RoomGeometry, SurfaceGeometry } from "./room-geometry.js";
import { packShownWalls } from "./room-visibility.js";

export interface RoomBuffers {
  readonly walls: BufferGeometry;
  readonly ceiling: BufferGeometry;
  readonly floor: BufferGeometry;
  /**
   * Draws the walls flagged 1 (one flag a wall, in record order) and no
   * others, and the ceiling or not. What is not drawn is not raycast.
   */
  show(walls: ArrayLike<number>, ceiling: boolean): void;
  /** Frees the three geometries' GPU buffers. */
  dispose(): void;
}

/** One surface's arrays as a geometry without an index, with its bounds worked out. */
function surfaceAttributes(surface: SurfaceGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(surface.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(surface.uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** One surface's arrays as a geometry, with its bounds worked out. */
export function surfaceBufferGeometry(surface: SurfaceGeometry): BufferGeometry {
  const geometry = surfaceAttributes(surface);
  const vertices = surface.positions.length / 3;
  geometry.setIndex(new BufferAttribute(vertices > 65535 ? surface.indices : Uint16Array.from(surface.indices), 1));
  return geometry;
}

export function createRoomBuffers(room: RoomGeometry): RoomBuffers {
  const walls = surfaceAttributes(room.walls);
  walls.setAttribute("aWallNormal", new BufferAttribute(room.walls.wallNormals, 2));
  // Every wall's indices as built stay in room.walls.indices; this copy is the one drawn, and rewritten.
  const drawn = new Uint32Array(room.walls.indices);
  const wallsIndex = new BufferAttribute(drawn, 1);
  walls.setIndex(wallsIndex);
  walls.setDrawRange(0, drawn.length);
  const ceiling = surfaceBufferGeometry(room.ceiling);
  const floor = surfaceBufferGeometry(room.floor);
  return {
    walls,
    ceiling,
    floor,
    show: (shownWalls, shownCeiling) => {
      const count = packShownWalls(room.walls.indices, room.walls.runs, shownWalls, drawn);
      wallsIndex.needsUpdate = true;
      walls.setDrawRange(0, count);
      ceiling.setDrawRange(0, shownCeiling ? Infinity : 0);
    },
    dispose: () => {
      walls.dispose();
      ceiling.dispose();
      floor.dispose();
    },
  };
}
