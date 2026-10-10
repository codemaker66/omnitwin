// ---------------------------------------------------------------------------
// The hall's own reflection and ambient environment
//
// Furniture and the varnished floor should reflect, and be lit by, the room
// they stand in, not a stand-in. Once the photographs are in (and again after
// every mood change) the drawn hall is rendered into a cube from the middle of
// the floor, whole (no cutaway, chandeliers lit) and without any furniture,
// then pre-filtered for reflections of every roughness. One small cube render
// and filter per change, never per frame.
//
// The pre-filter's cube camera sees every layer, so the room is lent to a
// private stage for the capture and handed straight back to its parent.
// ---------------------------------------------------------------------------

import { Color, Scene, Vector3, type Object3D, type Texture } from "three";
import { PMREMGenerator, type RenderTarget, type WebGPURenderer } from "three/webgpu";

/** Where the environment is captured: the middle of the floor at seated eye height. */
export const HALL_CAPTURE_POINT = new Vector3(0, 1.3, 0);

/** Cube face size of the capture; reflections are blurred by roughness anyway. */
const CAPTURE_SIZE = 256;

export class HallEnvironmentCapture {
  private readonly generator: PMREMGenerator;
  private readonly stage = new Scene();
  private target: RenderTarget | null = null;

  constructor(renderer: WebGPURenderer, background: Color) {
    this.generator = new PMREMGenerator(renderer);
    this.stage.background = background;
  }

  /**
   * Captures `room` (whatever it shows right now) and returns the filtered
   * environment texture, which stays the same object across captures.
   */
  capture(room: Object3D, point: Vector3 = HALL_CAPTURE_POINT): Texture {
    const parent = room.parent;
    this.stage.add(room);
    try {
      this.target = this.generator.fromScene(this.stage, 0, 0.05, 60, { size: CAPTURE_SIZE, position: point, renderTarget: this.target });
    } finally {
      this.stage.remove(room);
      if (parent !== null) parent.add(room);
    }
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.generator.dispose();
  }
}
