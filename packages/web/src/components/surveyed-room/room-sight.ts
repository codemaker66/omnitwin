// ---------------------------------------------------------------------------
// Keeping what a surveyed room draws in step with the side its camera is on
//
// room-visibility.ts says which walls and whether the ceiling a camera's side
// lets it see; room-buffers.ts draws a set of them. This reads the camera in
// the room's own frame, asks, and tells the buffers only when the answer has
// changed, so a camera that stays on one side writes nothing.
//
// `update` belongs in the frame loop, before the frame is drawn. A camera
// moved later in the same frame (by an owner whose turn comes after the
// room's) is drawn once as from where it was; `stale` says so afterwards, and
// the room then asks for one more frame, so the view never rests on the wrong
// set of walls whatever order the frame's subscribers run in.
// ---------------------------------------------------------------------------

import { Vector3, type Camera, type Object3D } from "three";
import type { RoomBuffers } from "./room-buffers.js";
import { ceilingShown, wallsShown, type RoomPlanes } from "./room-visibility.js";

export class RoomSight {
  private readonly planes: RoomPlanes;
  private readonly buffers: Pick<RoomBuffers, "show">;
  /** What is drawn now: one flag a wall, and the ceiling. Everything, until told otherwise. */
  private readonly shown: Uint8Array;
  private ceiling = true;
  /** What the camera last read asks for. */
  private readonly asked: Uint8Array;
  private readonly eye = new Vector3();

  constructor(planes: RoomPlanes, buffers: Pick<RoomBuffers, "show">) {
    this.planes = planes;
    this.buffers = buffers;
    this.shown = new Uint8Array(planes.walls.length).fill(1);
    this.asked = new Uint8Array(planes.walls.length);
  }

  /** Reads what `camera`'s side asks of the walls into `asked`, and returns what it asks of the ceiling. */
  private read(camera: Camera, room: Object3D): boolean {
    // The camera in the room's own frame, wherever the room stands in the scene.
    room.worldToLocal(camera.getWorldPosition(this.eye));
    wallsShown(this.planes, this.eye.x, this.eye.z, this.asked);
    return ceilingShown(this.planes, this.eye.y);
  }

  private differs(ceiling: boolean): boolean {
    if (ceiling !== this.ceiling) return true;
    for (let wall = 0; wall < this.shown.length; wall++) {
      if (this.shown[wall] !== this.asked[wall]) return true;
    }
    return false;
  }

  /** Draws what `camera`'s side lets it see of `room`; true when that changed what is drawn. */
  update(camera: Camera, room: Object3D): boolean {
    const ceiling = this.read(camera, room);
    if (!this.differs(ceiling)) return false;
    this.shown.set(this.asked);
    this.ceiling = ceiling;
    this.buffers.show(this.shown, ceiling);
    return true;
  }

  /** Whether `camera` has changed sides since `update`: what is drawn is then as from where it was. */
  stale(camera: Camera, room: Object3D): boolean {
    return this.differs(this.read(camera, room));
  }
}
