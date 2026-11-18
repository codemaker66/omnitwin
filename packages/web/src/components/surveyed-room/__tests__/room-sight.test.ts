import { readFileSync } from "node:fs";
import path from "node:path";
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { createRoomBuffers } from "../room-buffers.js";
import { buildRoomFrame } from "../room-frame.js";
import { buildRoomGeometry, type RoomGeometry } from "../room-geometry.js";
import { RoomSight } from "../room-sight.js";
import { roomPlanes } from "../room-visibility.js";
import { parseSurveyRecord } from "../survey-record.js";

const SALOON = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const FRAME = buildRoomFrame(SALOON.room.outline);
const PLANES = roomPlanes(FRAME, SALOON.room.ceilingHeight);
const IDS = SALOON.walls.map((wall) => wall.id);

/** The Saloon with flat walls and ceiling: six indices a wall, twelve walls. */
function saloonGeometry(): RoomGeometry {
  return buildRoomGeometry(SALOON, FRAME, { walls: null, ceiling: null });
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

/** What a sight tells its buffers to draw, each time it does. */
function recorder(): { readonly show: (walls: ArrayLike<number>, ceiling: boolean) => void; readonly calls: { walls: string[]; ceiling: boolean }[] } {
  const calls: { walls: string[]; ceiling: boolean }[] = [];
  return {
    calls,
    show: (walls, ceiling) => { calls.push({ walls: IDS.filter((_, wall) => walls[wall] === 1), ceiling }); },
  };
}

describe("a surveyed room's sight", () => {
  it("writes nothing for a camera inside the room and under its ceiling: everything is drawn from the start", () => {
    const buffers = recorder();
    const sight = new RoomSight(PLANES, buffers);
    expect(sight.update(cameraAt(0, 1.6, 0), new Group())).toBe(false);
    expect(buffers.calls).toEqual([]);
  });

  it("takes away what the camera is behind or above, once, and writes again only when the camera changes sides", () => {
    const buffers = recorder();
    const sight = new RoomSight(PLANES, buffers);
    const room = new Group();
    const camera = cameraAt(0, 9, 15);
    // Everything, the ceiling included, until a camera has been read.
    expect(sight.ceilingDrawn).toBe(true);
    expect(sight.update(camera, room)).toBe(true);
    expect(buffers.calls).toHaveLength(1);
    expect(buffers.calls[0]?.ceiling).toBe(false);
    // What the room's model reads to leave the ceiling's mesh out of the frame altogether.
    expect(sight.ceilingDrawn).toBe(false);
    expect(buffers.calls[0]?.walls).toEqual(["front", "window-front-end", "window-front-return", "window", "window-rear-return", "window-rear-end", "rear"]);
    // An orbit that stays beyond the fireplace side, above the ceiling: the same surfaces, nothing written.
    camera.position.set(2, 11, 12);
    expect(sight.update(camera, room)).toBe(false);
    expect(buffers.calls).toHaveLength(1);
    // Round to the window side.
    camera.position.set(0, 9, -15);
    expect(sight.update(camera, room)).toBe(true);
    expect(buffers.calls[1]?.walls).toEqual(["front", "rear", "fireplace-rear-end", "fireplace-rear-return", "fireplace", "fireplace-front-return", "fireplace-front-end"]);
    // Down into the room: every wall and the ceiling again.
    camera.position.set(0, 1.6, 0);
    expect(sight.update(camera, room)).toBe(true);
    expect(buffers.calls[2]).toEqual({ walls: IDS, ceiling: true });
    expect(sight.ceilingDrawn).toBe(true);
  });

  it("says when the camera has changed sides since it last drew, and writes nothing in saying so", () => {
    const buffers = recorder();
    const sight = new RoomSight(PLANES, buffers);
    const room = new Group();
    const camera = cameraAt(0, 1.6, 0);
    sight.update(camera, room);
    expect(sight.stale(camera, room)).toBe(false);
    // Moved within the room: the same side of everything.
    camera.position.set(3, 2, 1);
    expect(sight.stale(camera, room)).toBe(false);
    // Moved out through the +x end wall after the room's turn in the frame.
    camera.position.set(9, 1.6, 0);
    expect(sight.stale(camera, room)).toBe(true);
    expect(buffers.calls).toEqual([]);
    expect(sight.update(camera, room)).toBe(true);
    expect(sight.stale(camera, room)).toBe(false);
    // Up through the ceiling alone is a change of side too.
    camera.position.set(9, 8, 0);
    expect(sight.stale(camera, room)).toBe(true);
  });

  it("reads the camera in the room's own frame, wherever the room stands and however the camera is parented", () => {
    const buffers = recorder();
    const sight = new RoomSight(PLANES, buffers);
    // The room moved 100 m along x and turned a quarter turn about y.
    const room = new Group();
    room.position.set(100, 0, 0);
    room.rotation.y = Math.PI / 2;
    // In the room's frame (15, 1.6, 0): beyond its +x end. Turned a quarter turn about y, that is world (100, 1.6, -15).
    const rig = new Group();
    rig.position.set(100, 0, -20);
    const camera = cameraAt(0, 1.6, 5);
    rig.add(camera);
    expect(room.worldToLocal(camera.getWorldPosition(new Vector3())).toArray().map((value) => Math.round(value * 1000) / 1000 + 0)).toEqual([15, 1.6, 0]);
    expect(sight.update(camera, room)).toBe(true);
    expect(IDS.filter((id) => !(buffers.calls[0]?.walls ?? []).includes(id))).toEqual(["front", "window-front-return", "fireplace-front-return"]);
    expect(buffers.calls[0]?.ceiling).toBe(true);
  });
});

describe("a surveyed room's buffers", () => {
  it("draw every wall and the ceiling until told otherwise, from an index of the walls' own", () => {
    const geometry = saloonGeometry();
    const buffers = createRoomBuffers(geometry);
    const index = buffers.walls.getIndex();
    // Its own 32-bit copy: the walls as built are never written over, and three's WebGPU backend leaves a 32-bit array in place.
    expect(index?.array).toBeInstanceOf(Uint32Array);
    expect(index?.array).not.toBe(geometry.walls.indices);
    expect([...(index?.array ?? [])]).toEqual([...geometry.walls.indices]);
    expect(buffers.walls.drawRange).toEqual({ start: 0, count: 72 });
    expect(buffers.ceiling.drawRange.count).toBe(Infinity);
    buffers.dispose();
  });

  it("draws only the walls it is shown, packed to the front of the index, and uploads the index again", () => {
    const geometry = saloonGeometry();
    const built = Uint32Array.from(geometry.walls.indices);
    const buffers = createRoomBuffers(geometry);
    const index = buffers.walls.getIndex();
    if (index === null) throw new Error("the walls have no index");
    const version = index.version;
    // The front wall (0) and the rear wall (6) alone.
    const shown = new Uint8Array(12);
    shown[0] = 1;
    shown[6] = 1;
    buffers.show(shown, false);
    expect(buffers.walls.drawRange).toEqual({ start: 0, count: 12 });
    const rear = geometry.walls.runs[6];
    if (rear === undefined) throw new Error("no rear wall");
    expect([...index.array.subarray(0, 12)]).toEqual([...built.subarray(0, 6), ...built.subarray(rear.indexStart, rear.indexStart + 6)]);
    expect(index.version).toBeGreaterThan(version);
    expect(buffers.ceiling.drawRange).toEqual({ start: 0, count: 0 });
    expect(geometry.walls.indices).toEqual(built);
    // And back: all of it, as built.
    buffers.show(new Uint8Array(12).fill(1), true);
    expect(buffers.walls.drawRange.count).toBe(72);
    expect([...index.array]).toEqual([...built]);
    expect(buffers.ceiling.drawRange.count).toBe(Infinity);
    buffers.dispose();
  });

  it("keeps a wall or a ceiling that is not drawn out of a measuring ray's way", () => {
    const geometry = saloonGeometry();
    const buffers = createRoomBuffers(geometry);
    const material = new MeshBasicMaterial();
    const walls = new Mesh(buffers.walls, material);
    const ceiling = new Mesh(buffers.ceiling, material);
    const room = new Group().add(walls, ceiling);
    room.updateMatrixWorld(true);
    // From the middle of the room towards the fireplace wall (z = 3.739), and straight up to the ceiling.
    const toFireplace = new Raycaster(new Vector3(0, 1.5, 0), new Vector3(0, 0, 1));
    const up = new Raycaster(new Vector3(0, 1.5, 0), new Vector3(0, 1, 0));
    expect(toFireplace.intersectObject(room, true)[0]?.distance).toBeCloseTo(3.739, 3);
    expect(up.intersectObject(room, true)[0]?.distance).toBeCloseTo(5.515 - 1.5, 3);
    // Everything but the fireplace wall (9), and no ceiling.
    const shown = new Uint8Array(12).fill(1);
    shown[9] = 0;
    buffers.show(shown, false);
    expect(toFireplace.intersectObject(room, true)).toEqual([]);
    expect(up.intersectObject(room, true)).toEqual([]);
    // The other walls are still met.
    const toWindow = new Raycaster(new Vector3(0, 1.5, 0), new Vector3(0, 0, -1));
    expect(toWindow.intersectObject(room, true)[0]?.distance).toBeCloseTo(3.734, 3);
    buffers.dispose();
    material.dispose();
  });

  it("frees its three geometries", () => {
    const buffers = createRoomBuffers(saloonGeometry());
    const freed = vi.fn();
    for (const geometry of [buffers.walls, buffers.ceiling, buffers.floor]) geometry.addEventListener("dispose", freed);
    buffers.dispose();
    expect(freed).toHaveBeenCalledTimes(3);
  });
});
