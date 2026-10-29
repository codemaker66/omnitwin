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
// private stage for the capture and handed straight back to its parent. The
// room's pipelines for the cube can be compiled ahead of the first capture
// (compile), so it draws none synchronously (F-01, lib/native-precompile.ts).
// ---------------------------------------------------------------------------

import { Color, PerspectiveCamera, Scene, Vector3, type Object3D, type Texture } from "three";
import { PMREMGenerator, type RenderTarget, type WebGPURenderer } from "three/webgpu";
import { compileEach, compileWithin } from "../../lib/native-precompile.js";

/** Where the environment is captured: the middle of the floor at seated eye height. */
export const HALL_CAPTURE_POINT = new Vector3(0, 1.3, 0);

/** Cube face size of the capture; reflections are blurred by roughness anyway. */
const CAPTURE_SIZE = 256;

/** The capture's near and far planes, metres (prepare and capture draw with them). */
const CAPTURE_NEAR = 0.05;
const CAPTURE_FAR = 60;

export class HallEnvironmentCapture {
  private readonly renderer: WebGPURenderer;
  private readonly generator: PMREMGenerator;
  private readonly stage = new Scene();
  private target: RenderTarget | null = null;

  constructor(renderer: WebGPURenderer, background: Color) {
    this.renderer = renderer;
    this.generator = new PMREMGenerator(renderer);
    this.stage.background = background;
  }

  /**
   * The environment texture before the first capture: the void, filtered
   * into the target every capture refills. Installed as the scene's
   * environment before the room's first frame, so its materials are built
   * against the texture they keep. Installing a new texture with the first
   * capture made three rebuild every material of the scene pass once more, a
   * frame after the capture: 2.2-3.0 s of main thread at 4x CPU on the phone
   * profile, on master as on the branch (review R2, 23 October 2026).
   */
  prepare(): Texture {
    if (this.target === null) {
      this.target = this.generator.fromScene(this.stage, 0, CAPTURE_NEAR, CAPTURE_FAR, { size: CAPTURE_SIZE, position: HALL_CAPTURE_POINT, renderTarget: null });
    }
    return this.target.texture;
  }

  /**
   * Captures `room` (whatever it shows right now) and returns the filtered
   * environment texture, which stays the same object across captures.
   */
  capture(room: Object3D, point: Vector3 = HALL_CAPTURE_POINT): Texture {
    const parent = room.parent;
    this.stage.add(room);
    try {
      this.target = this.generator.fromScene(this.stage, 0, CAPTURE_NEAR, CAPTURE_FAR, { size: CAPTURE_SIZE, position: point, renderTarget: this.target });
    } finally {
      this.stage.remove(room);
      if (parent !== null) parent.add(room);
    }
    return this.target.texture;
  }

  /**
   * Compiles the pipelines a capture of `room` draws (the cube's target, no
   * MRT, every layer, every visible piece) without drawing it. The room is on
   * the stage while the compiles start, as a capture draws it there (its
   * lights are the room's own), and handed back before any is awaited. Run
   * only while nothing else draws (lib/native-precompile.ts): the target and
   * MRT stay set until it resolves, or until `signal` aborts.
   */
  async compile(room: Object3D, signal: AbortSignal | null = null, point: Vector3 = HALL_CAPTURE_POINT): Promise<void> {
    this.prepare();
    const target = this.target;
    if (target === null) return;
    const camera = new PerspectiveCamera(90, 1, CAPTURE_NEAR, CAPTURE_FAR);
    camera.layers.enableAll();
    camera.position.copy(point);
    camera.updateMatrixWorld();
    const parent = room.parent;
    await compileWithin(this.renderer, target, null, signal, async () => {
      this.stage.add(room);
      await compileEach(this.renderer, room, camera, this.stage, signal, () => {
        this.stage.remove(room);
        if (parent !== null) parent.add(room);
      });
    });
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.generator.dispose();
  }
}
