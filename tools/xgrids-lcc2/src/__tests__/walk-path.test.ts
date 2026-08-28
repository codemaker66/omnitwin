import { describe, expect, it } from "vitest";
import {
  denseWalkRegion,
  medoidPose,
  parseWalkPoses,
  decimateWalk,
  walkEyeHeight,
  type WalkPose,
} from "../walk-path.js";

/** A 6 x 4 m room walked in a loop at 1.5 m eye height, in XGRIDS Z-up metres. */
function roomWalk(): WalkPose[] {
  const poses: WalkPose[] = [];
  for (let i = 0; i < 120; i += 1) {
    const t = (i / 120) * Math.PI * 2;
    poses.push({
      position: [Math.cos(t) * 2.4, Math.sin(t) * 1.6, 1.5 + Math.sin(t * 3) * 0.05],
      rotation: [0, 0, 0, 1],
    });
  }
  return poses;
}

describe("parseWalkPoses", () => {
  it("reads position and rotation out of the XGRIDS pose file", () => {
    const raw = JSON.stringify({
      poses: [
        { ts: "1780235430.24", T: [1, 2, 3], R: [0.84, -0.53, 0.005, 0.004], RGB: null },
        { ts: "1780235430.44", T: [1.1, 2.1, 3.1], R: [0.84, -0.53, 0.005, 0.004], RGB: null },
      ],
      fusionPoses: null,
    });
    const poses = parseWalkPoses(raw);
    expect(poses).toHaveLength(2);
    expect(poses[0]?.position).toEqual([1, 2, 3]);
  });

  it("skips a pose whose position is not three finite numbers", () => {
    const raw = JSON.stringify({
      poses: [
        { T: [1, 2, 3], R: [0, 0, 0, 1] },
        { T: [1, "nope", 3], R: [0, 0, 0, 1] },
        { T: [4, 5, 6], R: [0, 0, 0, 1] },
      ],
    });
    expect(parseWalkPoses(raw)).toHaveLength(2);
  });

  it("returns nothing rather than throwing on malformed input", () => {
    expect(parseWalkPoses("{ not json")).toEqual([]);
    expect(parseWalkPoses(JSON.stringify({ poses: null }))).toEqual([]);
  });
});

describe("medoidPose", () => {
  it("picks a pose from the middle of the walk, never an extremity", () => {
    const medoid = medoidPose(roomWalk());
    expect(medoid).not.toBeNull();
    // The loop's centre is the origin; the medoid must be nearer it than any
    // point on the loop is to the far side.
    const [x, y] = medoid?.position ?? [99, 99, 99];
    expect(Math.hypot(x, y)).toBeLessThan(3);
  });

  it("is a real recorded pose, not an average of them", () => {
    const walk = roomWalk();
    const medoid = medoidPose(walk);
    expect(walk.some((pose) => pose.position === medoid?.position)).toBe(true);
  });

  it("returns null for an empty walk", () => {
    expect(medoidPose([])).toBeNull();
  });
});

describe("walkEyeHeight", () => {
  it("is the median height walked, not the extremes", () => {
    expect(walkEyeHeight(roomWalk())).toBeCloseTo(1.5, 1);
  });

  it("ignores a single spurious height", () => {
    const walk = roomWalk();
    walk.push({ position: [0, 0, -40], rotation: [0, 0, 0, 1] });
    expect(walkEyeHeight(walk)).toBeCloseTo(1.5, 1);
  });
});

describe("denseWalkRegion", () => {
  it("bounds the walk", () => {
    const region = denseWalkRegion(roomWalk());
    expect(region).not.toBeNull();
    expect(region?.max[0]).toBeLessThan(3);
    expect(region?.min[0]).toBeGreaterThan(-3);
  });

  it("drops a stray pose, so one step through a doorway cannot widen the room", () => {
    const walk = roomWalk();
    walk.push({ position: [40, 0, 1.5], rotation: [0, 0, 0, 1] });
    const region = denseWalkRegion(walk);
    expect(region?.max[0]).toBeLessThan(6);
  });

  it("does NOT isolate one room from a walk that covered a whole floor", () => {
    // An honest statement of the limit. Robert Adam's operator walked ~19 x 18 m
    // of building, so a third of that walk is corridor and adjacent rooms — far
    // too much to be a tail. Trimming percentiles cannot separate them, and
    // neither can measuring the mesh; it needs a crop or a human. Asserting the
    // limit here stops a future reader assuming containment has handled it.
    const walk = roomWalk();
    for (let i = 0; i < 60; i += 1) {
      walk.push({ position: [8 + i * 0.2, 0, 1.5], rotation: [0, 0, 0, 1] });
    }
    const region = denseWalkRegion(walk);
    expect(region?.max[0]).toBeGreaterThan(6);
  });

  it("returns null when there is no walk to bound", () => {
    expect(denseWalkRegion([])).toBeNull();
  });
});

describe("decimateWalk", () => {
  it("thins a long walk to the requested budget", () => {
    const walk = Array.from({ length: 5000 }, (_, i) => ({
      position: [i * 0.01, 0, 1.5] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    }));
    expect(decimateWalk(walk, 100).length).toBeLessThanOrEqual(100);
  });

  it("keeps the first and last pose so the path still spans the walk", () => {
    const walk = roomWalk();
    const thinned = decimateWalk(walk, 10);
    expect(thinned[0]).toEqual(walk[0]);
    expect(thinned.at(-1)).toEqual(walk.at(-1));
  });

  it("leaves a walk already within budget alone", () => {
    const walk = roomWalk().slice(0, 8);
    expect(decimateWalk(walk, 100)).toHaveLength(8);
  });
});
