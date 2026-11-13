import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { setLensShift } from "../../../lib/lens-shift.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT } from "../hall-spec.js";
import {
  hallStageFraming, mixLens, STAGE_CHANDELIER_CEILING_M, STAGE_NEAR_CUT_M, STAGE_PICTURE_RATIO, stageLens, stagePoseAt,
  type HallStageFraming, type StageLens,
} from "../hall-stage.js";

type Vec3 = readonly [number, number, number];

/** Canvases the planner's stage is drawn on: laptops, desktops and a wide one, with the shelf's height already off. */
const CANVASES: readonly (readonly [number, number])[] = [[1440, 748], [1920, 928], [1366, 616], [2560, 1288], [3440, 1288], [1180, 668]];
const SKY = 48;

function cameraAt(width: number, height: number, position: Vec3, target: Vec3, lens: StageLens): PerspectiveCamera {
  const camera = new PerspectiveCamera(lens.fov, width / height, 0.1, 200);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateMatrixWorld();
  setLensShift(camera, { x: 0, y: lens.shiftY });
  return camera;
}

/** Where a point of the hall is drawn, CSS px from the canvas's top left. */
function drawn(camera: PerspectiveCamera, width: number, height: number, point: Vec3): { x: number; y: number } {
  const ndc = new Vector3(point[0], point[1], point[2]).project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

function framed(width: number, height: number): HallStageFraming {
  const framing = hallStageFraming(width, height, SKY);
  if (framing === null) throw new Error(`no stage for ${String(width)} x ${String(height)}`);
  return framing;
}

/** A point on the sight line `ray` radians below level from the stage's camera, `run` metres out. */
function along(framing: HallStageFraming, ray: number, run: number): Vec3 {
  const [x, y, z] = framing.position;
  return [x, y - Math.tan(ray) * run, z - run];
}

function held(width: number, height: number): { framing: HallStageFraming; camera: PerspectiveCamera } {
  const framing = framed(width, height);
  return { framing, camera: cameraAt(width, height, framing.position, framing.heldTarget, stageLens(framing, 0)) };
}

describe("the hall as a stage", () => {
  it.each(CANVASES)("stands the floor's near corners on the picture's foot corners (%i x %i)", (width, height) => {
    const { camera } = held(width, height);
    const left = drawn(camera, width, height, [-HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH]);
    const right = drawn(camera, width, height, [HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH]);
    expect(left.x).toBeCloseTo(0, 0);
    expect(right.x).toBeCloseTo(width, 0);
    // The foot stands a few centimetres above the floor's edge, so the edge itself is just under it: within half a percent of the canvas.
    for (const corner of [left, right]) {
      expect(corner.y).toBeGreaterThan(height - 0.5);
      expect(corner.y).toBeLessThan(height * 1.005);
    }
  });

  it.each(CANVASES)("meets the far wall's top with the night, and keeps the sky asked for (%i x %i)", (width, height) => {
    const { framing, camera } = held(width, height);
    const top = drawn(camera, width, height, [0, HALL_HEIGHT, -HALL_HALF_WIDTH]);
    expect(top.y).toBeGreaterThanOrEqual(framing.picture.top);
    expect(top.y).toBeLessThan(framing.picture.top + 0.03 * framing.picture.height);
    expect(framing.picture.top).toBeGreaterThanOrEqual(SKY - 1e-9);
    expect(framing.picture.top + framing.picture.height).toBeCloseTo(height, 9);
    // Nothing of the hall stands above the night's edge: the end walls' tops fall away from the far wall's.
    for (const z of [-HALL_HALF_WIDTH, 0, HALL_HALF_WIDTH]) {
      expect(drawn(camera, width, height, [-HALL_HALF_LENGTH, HALL_HEIGHT, z]).y).toBeGreaterThanOrEqual(framing.picture.top - 0.5);
    }
  });

  it.each(CANVASES)("keeps every upright upright (%i x %i)", (width, height) => {
    const { camera } = held(width, height);
    for (const [x, z] of [[-HALL_HALF_LENGTH, 0], [HALL_HALF_LENGTH, HALL_HALF_WIDTH], [3, -HALL_HALF_WIDTH], [0, 2]] as const) {
      const foot = drawn(camera, width, height, [x, 0, z]);
      const head = drawn(camera, width, height, [x, HALL_HEIGHT, z]);
      expect(head.x).toBeCloseTo(foot.x, 6);
    }
    // And every line along the far wall level.
    const a = drawn(camera, width, height, [-HALL_HALF_LENGTH, 4, -HALL_HALF_WIDTH]);
    const b = drawn(camera, width, height, [HALL_HALF_LENGTH, 4, -HALL_HALF_WIDTH]);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it("keeps the film frame's proportion where there is room, and gives the rest to the night", () => {
    const tall = framed(1440, 748);
    expect(tall.picture.height).toBeCloseTo(1440 / STAGE_PICTURE_RATIO, 9);
    expect(tall.picture.top).toBeCloseTo(748 - 1440 / STAGE_PICTURE_RATIO, 9);
    // A short canvas keeps its sky and takes a wider picture.
    const short = framed(1366, 616);
    expect(short.picture.top).toBe(SKY);
    expect(short.picture.height).toBe(616 - SKY);
  });

  it("looks at the floor's near edge at 45 degrees, from above the walls and under the chandeliers' ceiling", () => {
    for (const [width, height] of CANVASES) {
      const { position } = framed(width, height);
      expect(position[0]).toBe(0);
      expect(position[1] / (position[2] - HALL_HALF_WIDTH)).toBeCloseTo(1, 9);
      expect(position[1]).toBeGreaterThan(HALL_HEIGHT);
      expect(position[1]).toBeLessThan(STAGE_CHANDELIER_CEILING_M);
    }
  });

  it.each(CANVASES)("shows the same picture when let go, top and bottom (%i x %i)", (width, height) => {
    const framing = framed(width, height);
    const free = cameraAt(width, height, framing.position, framing.freeTarget, stageLens(framing, framing.freePitch));
    const { camera } = held(width, height);
    for (const point of [[0, 0, HALL_HALF_WIDTH], [0, HALL_HEIGHT, -HALL_HALF_WIDTH], [0, 0, 0]] as const) {
      expect(drawn(free, width, height, point).x).toBeCloseTo(width / 2, 6);
    }
    // The canvas's foot and top lie on the same two sight lines through either lens.
    for (const lens of [free, camera]) {
      expect(drawn(lens, width, height, along(framing, framing.bottomRay, 12)).y).toBeCloseTo(height, 6);
      expect(drawn(lens, width, height, along(framing, framing.topRay, 20)).y).toBeCloseTo(0, 6);
    }
    // Let go, the camera looks at the middle of the floor, which the orbit turns about.
    expect(framing.freeTarget).toEqual([0, 0, 0]);
  });

  it("squares up without moving the picture's top or bottom", () => {
    const [width, height] = [1920, 928];
    const framing = framed(width, height);
    for (const squared of [0, 0.2, 0.5, 0.8, 1]) {
      const pose = stagePoseAt(framing, squared);
      const camera = cameraAt(width, height, framing.position, pose.target, pose.lens);
      expect(drawn(camera, width, height, along(framing, framing.bottomRay, 12)).y).toBeCloseTo(height, 6);
      expect(drawn(camera, width, height, along(framing, framing.topRay, 20)).y).toBeCloseTo(0, 6);
    }
    stagePoseAt(framing, 0).target.forEach((value) => { expect(value).toBeCloseTo(0, 9); });
    const levelled = stagePoseAt(framing, 1);
    levelled.target.forEach((value, axis) => { expect(value).toBeCloseTo(framing.heldTarget[axis] ?? NaN, 9); });
    expect(levelled.lens).toEqual(stageLens(framing, 0));
    // Past either end it stays at the end.
    expect(stagePoseAt(framing, 2)).toEqual(levelled);
  });

  it.each(CANVASES)("fits the plan's cut walls in the picture, under the night (%i x %i)", (width, height) => {
    const framing = framed(width, height);
    const camera = cameraAt(width, height, framing.plan.position, framing.plan.target, framing.plan.lens);
    // HALL_CUTS.plan, and the walls' thickness beyond the floor on each long side.
    const far = drawn(camera, width, height, [0, 3.12, -HALL_HALF_WIDTH - 0.95]);
    const nearSide = drawn(camera, width, height, [0, 3.12, HALL_HALF_WIDTH + 1.14]);
    expect(far.y).toBeGreaterThan(framing.picture.top);
    expect(nearSide.y).toBeLessThan(height);
    expect(drawn(camera, width, height, [HALL_HALF_LENGTH + 1.21, 3.12, 0]).x).toBeLessThan(width);
    // The hall's middle stands at the picture's middle, not the canvas's.
    const middle = framing.picture.top + framing.picture.height / 2;
    expect(Math.abs(drawn(camera, width, height, [0, 0, 0]).y - middle)).toBeLessThan(1);
  });

  it("offers no stage on an upright canvas, a sliver, or none at all", () => {
    expect(hallStageFraming(390, 560, SKY)).toBeNull();
    expect(hallStageFraming(844, 154, SKY)).toBeNull();
    expect(hallStageFraming(1440, 40, SKY)).toBeNull();
    expect(hallStageFraming(0, 0, SKY)).toBeNull();
  });

  it("lowers the fourth wall under the floor", () => {
    expect(STAGE_NEAR_CUT_M).toBeLessThan(0);
  });

  it("carries a lens part of the way between two views", () => {
    const from: StageLens = { fov: 55, shiftY: 0 };
    const to: StageLens = { fov: 35, shiftY: 0.5 };
    expect(mixLens(from, to, 0)).toEqual(from);
    expect(mixLens(from, to, 1)).toEqual(to);
    expect(mixLens(from, to, 0.5)).toEqual({ fov: 45, shiftY: 0.25 });
    expect(mixLens(from, to, 7)).toEqual(to);
    expect(mixLens(from, to, -1)).toEqual(from);
  });
});
