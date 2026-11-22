// ---------------------------------------------------------------------------
// A surveyed room's surfaces as three geometries
//
// room-geometry.ts builds plain arrays; this wraps them, uncopied, as one
// BufferGeometry per surface: position, normal and uv (the photograph's
// coordinates), and on the walls `aWallNormal`, each vertex's own wall's
// normal (x, z), which the walls' material reads (room-materials.ts). Indices
// are 16-bit where the vertices allow, as the Grand Hall's are.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry } from "three";
import type { RoomGeometry, SurfaceGeometry } from "./room-geometry.js";

export interface RoomBuffers {
  readonly walls: BufferGeometry;
  readonly ceiling: BufferGeometry;
  readonly floor: BufferGeometry;
  /** Frees the three geometries' GPU buffers. */
  dispose(): void;
}

/** One surface's arrays as a geometry, with its bounds worked out. */
export function surfaceBufferGeometry(surface: SurfaceGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(surface.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(surface.uvs, 2));
  const vertices = surface.positions.length / 3;
  geometry.setIndex(new BufferAttribute(vertices > 65535 ? surface.indices : Uint16Array.from(surface.indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRoomBuffers(room: RoomGeometry): RoomBuffers {
  const walls = surfaceBufferGeometry(room.walls);
  walls.setAttribute("aWallNormal", new BufferAttribute(room.walls.wallNormals, 2));
  const ceiling = surfaceBufferGeometry(room.ceiling);
  const floor = surfaceBufferGeometry(room.floor);
  return {
    walls,
    ceiling,
    floor,
    dispose: () => {
      walls.dispose();
      ceiling.dispose();
      floor.dispose();
    },
  };
}
