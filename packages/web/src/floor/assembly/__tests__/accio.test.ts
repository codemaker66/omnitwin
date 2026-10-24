import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import type { PlacedItem } from "../../../lib/placement.js";
import { HALL_CHANDELIERS, HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "../../../components/grand-hall/hall-spec.js";
import { MAX_POLAR_ANGLE, computeDistanceLimits } from "../../../lib/camera-rig.js";
import { diffLayouts, type AssemblyPiece } from "../choreography.js";
import { ASSEMBLY_TICK_RATE, createAssemblyPlayback, emptyPose, type AssemblyPlayback, type PiecePose } from "../engine.js";
import {
  ACCIO_BEATS,
  ACCIO_BIRTH_SIZE,
  ACCIO_CAMERA_LANDSCAPE,
  ACCIO_CAMERA_PORTRAIT,
  ACCIO_REVEAL_MARGIN,
  accioModel,
  accioWindows,
  type AccioModel,
} from "../accio.js";
import { composePieceMatrix, savedPieceMatrix } from "../pose-matrix.js";
import { describePiece } from "../show.js";
import { DINNER_ANCHOR, DINNER_SEATS_PER_TABLE, dinnerTableId, grandHallDinner180 } from "../fixture.js";

const layout: readonly PlacedItem[] = grandHallDinner180();
const pieces: readonly AssemblyPiece[] = diffLayouts([], layout, describePiece).arriving;

function accio(seed: number, reducedMotion = false): { readonly run: AssemblyPlayback; readonly model: AccioModel } {
  const model = accioModel();
  return { run: createAssemblyPlayback(pieces, model, seed, { reducedMotion }), model };
}

function snapshot(run: AssemblyPlayback): PiecePose[] {
  return pieces.map((piece) => {
    const pose = emptyPose();
    run.pose(piece.id, pose);
    return { ...pose };
  });
}

/** Runs to the end of the clip, or further if anything still moves. */
function runToRest(run: AssemblyPlayback): void {
  run.advanceTo(run.clipSeconds);
  let guard = 0;
  while (!run.done() && guard < 40) {
    run.advanceTo(run.time() + 0.5);
    guard += 1;
  }
}

interface Trace {
  /** When each piece is first drawn, and when it has come down at its place. */
  readonly start: Map<string, number>;
  readonly landed: Map<string, number>;
  /** The most pieces in the air at once, and when. */
  readonly peak: number;
  readonly peakAt: number;
  /** How squarely the worst-turned round's top faces the camera while it is more than 1.4 m up (cosine). */
  readonly leastFacing: number;
  /** Breaches of the glass or of a reveal, described. */
  readonly breaches: string[];
}

/** Flies the whole show at the tick rate and records what a viewer would see. */
function trace(seed: number): Trace {
  const { run, model } = accio(seed);
  const start = new Map<string, number>();
  const landed = new Map<string, number>();
  const breaches: string[] = [];
  const pose = emptyPose();
  let peak = 0;
  let peakAt = 0;
  let leastFacing = Number.POSITIVE_INFINITY;
  const viewer = new Vector3(...(run.finalCamera()?.position ?? [0, 0, 0]));
  const normal = new Vector3();
  const axis = new Vector3();
  const toViewer = new Vector3();
  for (let tick = 1; tick <= 10 * ASSEMBLY_TICK_RATE; tick++) {
    const seconds = tick / ASSEMBLY_TICK_RATE;
    run.advanceTo(seconds);
    let aloft = 0;
    for (const piece of pieces) {
      run.pose(piece.id, pose);
      if (!pose.visible) continue;
      if (!start.has(piece.id)) start.set(piece.id, seconds);
      const down = pose.y - piece.y < 0.01 && Math.hypot(pose.x - piece.x, pose.z - piece.z) < 0.05;
      if (down && !landed.has(piece.id)) landed.set(piece.id, seconds);
      if (!down) aloft += 1;
      if (piece.role === "table" && pose.y - piece.y > 1.4) {
        // Its top, tipped by its tilt, against the way to the camera.
        const angle = Math.hypot(pose.tiltX, pose.tiltZ);
        normal.set(0, 1, 0);
        if (angle > 1e-9) normal.applyAxisAngle(axis.set(pose.tiltX / angle, 0, pose.tiltZ / angle), angle);
        toViewer.set(viewer.x - pose.x, viewer.y - (pose.y + pose.pivot), viewer.z - pose.z).normalize();
        leastFacing = Math.min(leastFacing, normal.dot(toViewer));
      }
      const flight = model.flight(piece.id);
      if (flight === null || run.isDone(piece.id)) continue;
      // How far the piece reaches across at its present size.
      const reach = flight.reach * pose.grow;
      if (pose.z < flight.window.glassZ + 0.1) breaches.push(`${piece.id} at the glass (${pose.z.toFixed(3)}) at ${seconds.toFixed(3)} s`);
      if (pose.z - reach < flight.window.faceZ) {
        const across = Math.abs(pose.x - flight.window.x) + reach;
        if (across > flight.window.width / 2 + 1e-6) breaches.push(`${piece.id} wider than its reveal (${across.toFixed(3)}) at ${seconds.toFixed(3)} s`);
      }
    }
    if (aloft > peak) { peak = aloft; peakAt = seconds; }
    if (run.done()) break;
  }
  return { start, landed, peak, peakAt, leastFacing, breaches };
}

const SEED = 20261026;
const flown = trace(SEED);

describe("the 180-seat Grand Hall dinner", () => {
  it("is 18 rounds of 10 with stable ids, Table 1 at the fireplace end", () => {
    const tables = pieces.filter((piece) => piece.role === "table");
    const chairs = pieces.filter((piece) => piece.role === "chair");
    expect(tables).toHaveLength(18);
    expect(chairs).toHaveLength(18 * DINNER_SEATS_PER_TABLE);
    const first = layout[0];
    expect(first?.id).toBe(dinnerTableId(1));
    expect(first?.label).toBe("Table 1");
    expect(first?.x).toBe(DINNER_ANCHOR.x);
    expect(first?.z).toBe(DINNER_ANCHOR.z);
    for (const chair of chairs) {
      expect(Math.abs(chair.x) + 0.29).toBeLessThan(HALL_HALF_LENGTH);
      expect(Math.abs(chair.z) + 0.29).toBeLessThan(HALL_HALF_WIDTH);
    }
  });

  it("diffs the empty room to every piece arriving, and a layout to itself as unchanged", () => {
    expect(pieces).toHaveLength(198);
    const same = diffLayouts(layout, layout, describePiece);
    expect(same.arriving).toHaveLength(0);
    expect(same.unchanged).toHaveLength(198);
    const moved = layout.map((item, index) => (index === 3 ? { ...item, x: item.x + 0.1 } : item));
    expect(diffLayouts(layout, moved, describePiece).moving).toEqual([layout[3]?.id]);
  });
});

describe("Accio, second pass", () => {
  // Development: `ASSEMBLY_NUMBERS=<file>` records the show's numbers for the ledger.
  it.runIf(process.env["ASSEMBLY_NUMBERS"] !== undefined)("records its numbers", () => {
    const { run, model } = accio(SEED);
    runToRest(run);
    const flightOf = (piece: AssemblyPiece): number => (flown.landed.get(piece.id) ?? 0) - (flown.start.get(piece.id) ?? 0);
    const streams: Record<string, { pieces: number; first: number; last: number }> = {};
    for (const piece of pieces) {
      const window = model.flight(piece.id)?.window.id ?? "none";
      const start = run.graph.byPiece.get(piece.id)?.start ?? 0;
      const stream = streams[window] ?? { pieces: 0, first: Number.POSITIVE_INFINITY, last: 0 };
      streams[window] = { pieces: stream.pieces + 1, first: Math.min(stream.first, start), last: Math.max(stream.last, start) };
    }
    // When each part of the show comes to rest.
    const parts = accio(SEED).run;
    let piecesAt = 0;
    let lightsAt = 0;
    let cameraAt = 0;
    let lastCamera = "";
    for (let tick = 1; tick <= 12 * ASSEMBLY_TICK_RATE && !parts.done(); tick++) {
      parts.advanceTo(tick / ASSEMBLY_TICK_RATE);
      if (parts.live().length > 0 || pieces.some((piece) => !parts.isDone(piece.id))) piecesAt = parts.time();
      if (parts.lights.some((light) => parts.light(light.id) > 0)) lightsAt = parts.time();
      const camera = JSON.stringify(parts.camera());
      if (camera !== lastCamera) cameraAt = parts.time();
      lastCamera = camera;
    }
    writeFileSync(process.env["ASSEMBLY_NUMBERS"] ?? "", JSON.stringify({
      seed: SEED,
      restOf: { pieces: piecesAt, lights: lightsAt, camera: cameraAt, all: parts.settledAt() },
      settledAt: run.settledAt(),
      peakInFlight: flown.peak,
      peakAt: flown.peakAt,
      lastStart: Math.max(...flown.start.values()),
      lastLanding: Math.max(...flown.landed.values()),
      leastFacing: flown.leastFacing,
      tableFlights: pieces.filter((piece) => piece.role === "table").map((piece) => Number(flightOf(piece).toFixed(2))),
      chairFlightMax: Math.max(...pieces.filter((piece) => piece.role === "chair").map(flightOf)),
      streams,
      dressing: [...run.graph.dressing.values()].map((value) => Number(value.toFixed(2))),
      breaches: flown.breaches.slice(0, 10),
    }, null, 2));
  });

  it("starts with the top table and sends the rounds out in waves from it", () => {
    const { run } = accio(SEED);
    expect(run.graph.anchorId).toBe(dinnerTableId(1));
    const tables = pieces.filter((piece) => piece.role === "table");
    const anchorStart = flown.start.get(dinnerTableId(1)) ?? Number.NaN;
    for (const table of tables) expect(flown.start.get(table.id) ?? Number.NaN).toBeGreaterThanOrEqual(anchorStart);
    const distance = (piece: AssemblyPiece): number => Math.hypot(piece.x - DINNER_ANCHOR.x, piece.z - DINNER_ANCHOR.z);
    // A round a whole ring further out never leaves before a nearer one.
    for (const near of tables) {
      for (const far of tables) {
        if (distance(far) - distance(near) < 3.4) continue;
        expect(flown.start.get(far.id) ?? 0).toBeGreaterThan(flown.start.get(near.id) ?? 0);
      }
    }
  });

  it("sends each table's chairs only after that table has landed", () => {
    for (const piece of pieces) {
      if (piece.role !== "chair" || piece.tableId === null) continue;
      const tableDown = flown.landed.get(piece.tableId);
      expect(tableDown).toBeDefined();
      expect(flown.start.get(piece.id) ?? 0).toBeGreaterThan(tableDown ?? Number.POSITIVE_INFINITY);
    }
  });

  it("spaces the pieces along each window's stream", () => {
    const { run, model } = accio(SEED);
    const streams = new Map<string, { readonly start: number; readonly round: boolean }[]>();
    for (const piece of pieces) {
      const flight = model.flight(piece.id);
      const start = run.graph.byPiece.get(piece.id)?.start;
      expect(flight).not.toBeNull();
      if (flight === null || start === undefined) continue;
      const list = streams.get(flight.window.id) ?? [];
      list.push({ start, round: piece.role !== "chair" });
      streams.set(flight.window.id, list);
    }
    expect(streams.size).toBe(5);
    for (const list of streams.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let index = 1; index < list.length; index++) {
        const gap = (list[index]?.start ?? 0) - (list[index - 1]?.start ?? 0);
        expect(gap).toBeGreaterThanOrEqual(ACCIO_BEATS.chairGap - 1e-9);
      }
      const rounds = list.filter((entry) => entry.round);
      for (let index = 1; index < rounds.length; index++) {
        expect((rounds[index]?.start ?? 0) - (rounds[index - 1]?.start ?? 0)).toBeGreaterThanOrEqual(ACCIO_BEATS.tableGap - 1e-9);
      }
    }
  });

  it("never has the busy middle the first pass had: far fewer pieces in the air at once", () => {
    // The first pass had 191 of 198 in flight at 3.2 s.
    expect(flown.peak).toBeLessThan(80);
  });

  it("brings every piece out of its window's light, never through the glass or wider than its reveal", () => {
    expect(flown.breaches).toEqual([]);
    const { run, model } = accio(SEED);
    run.advanceTo(0);
    for (const piece of pieces) {
      const flight = model.flight(piece.id);
      expect(flight).not.toBeNull();
      if (flight === null) continue;
      expect(flight.sz).toBeGreaterThan(flight.window.glassZ);
      expect(flight.sz).toBeLessThan(flight.window.faceZ);
      expect(Math.abs(flight.sx - flight.window.x) + flight.reach * ACCIO_BIRTH_SIZE)
        .toBeLessThan(flight.window.width / 2 - ACCIO_REVEAL_MARGIN + 1e-9);
    }
  });

  it("shows the camera every round's top while it is aloft, so it reads as a table and never as a drum", () => {
    // The top faces the camera within 70 degrees throughout: never its skirt edge on.
    expect(flown.leastFacing).toBeGreaterThan(Math.cos((70 * Math.PI) / 180));
  });

  it("settles every piece exactly at its saved transform within the 8 s clip", () => {
    const { run } = accio(SEED);
    runToRest(run);
    expect(run.done()).toBe(true);
    expect(run.settledAt() ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(run.clipSeconds - 0.5);
    const drawn = new Matrix4();
    const saved = new Matrix4();
    for (const [index, pose] of snapshot(run).entries()) {
      const piece = pieces[index];
      if (piece === undefined) continue;
      expect(pose.visible).toBe(true);
      composePieceMatrix(pose, piece.scale, drawn);
      savedPieceMatrix(piece.x, piece.y, piece.z, piece.rotationY, piece.scale, saved);
      drawn.elements.forEach((value, element) => { expect(value).toBeCloseTo(saved.elements[element] ?? Number.NaN, 6); });
    }
    expect(run.camera()).toEqual(run.finalCamera());
  });

  it("gives the same transforms at the same time for the same seed, however time is stepped", () => {
    const a = accio(1234).run;
    const b = accio(1234).run;
    const c = accio(1234).run;
    for (const seconds of [0.6, 1.4, 2.6, 3.9, 5.2, 6.4]) {
      a.advanceTo(seconds);
      for (let frame = Math.round(b.time() * 30) + 1; frame <= Math.round(seconds * 30); frame++) b.advanceTo(frame / 30);
      c.advanceTo(seconds);
      expect(snapshot(b)).toEqual(snapshot(a));
      expect(snapshot(c)).toEqual(snapshot(a));
      expect(b.camera()).toEqual(a.camera());
    }
    // Back to an earlier time replays from the start: the same poses again.
    const first = accio(1234).run;
    first.advanceTo(2.6);
    const replayed = accio(1234).run;
    replayed.advanceTo(5.2);
    replayed.advanceTo(2.6);
    expect(snapshot(replayed)).toEqual(snapshot(first));
  });

  it("plays differently for another seed", () => {
    const a = accio(1).run;
    const b = accio(2).run;
    a.advanceTo(2.5);
    b.advanceTo(2.5);
    expect(snapshot(b)).not.toEqual(snapshot(a));
  });

  it("hides a piece before it starts, then draws it", () => {
    const { run } = accio(SEED);
    run.advanceTo(0.1);
    const pose = emptyPose();
    for (const piece of pieces) {
      run.pose(piece.id, pose);
      expect(pose.visible).toBe(false);
    }
    run.advanceTo(2);
    run.pose(dinnerTableId(1), pose);
    expect(pose.visible).toBe(true);
  });

  it("completes at once under reduced motion, the camera left where it is", () => {
    const { run } = accio(SEED, true);
    expect(run.done()).toBe(true);
    expect(run.settledAt()).toBe(0);
    expect(run.camera()).toBeNull();
    const pose = emptyPose();
    for (const piece of pieces) {
      run.pose(piece.id, pose);
      expect(pose).toMatchObject({ visible: true, x: piece.x, z: piece.z, yaw: piece.rotationY, grow: 1 });
    }
  });

  it("skips to the true state with the camera at its final framing, and cancels leaving the camera alone", () => {
    const skipped = accio(SEED).run;
    skipped.advanceTo(2.2);
    skipped.skip();
    expect(skipped.done()).toBe(true);
    expect(skipped.camera()).toEqual(skipped.finalCamera());
    const pose = emptyPose();
    for (const piece of pieces) {
      skipped.pose(piece.id, pose);
      expect(pose).toMatchObject({ visible: true, x: piece.x, y: piece.y, z: piece.z, yaw: piece.rotationY, grow: 1, squash: 0 });
    }
    expect(skipped.light("arch-centre")).toBe(0);
    const cancelled = accio(SEED).run;
    cancelled.advanceTo(2.2);
    cancelled.cancel();
    expect(cancelled.done()).toBe(true);
    expect(cancelled.camera()).toBeNull();
  });

  it("raises each window's light before its first piece and lets it fall after its last", () => {
    const { run, model } = accio(SEED);
    expect(run.lights.map((light) => light.id).sort()).toEqual(accioWindows().map((window) => window.id).sort());
    for (const light of run.lights) {
      const own = pieces.filter((piece) => model.flight(piece.id)?.window.id === light.id);
      const first = Math.min(...own.map((piece) => run.graph.byPiece.get(piece.id)?.start ?? Number.POSITIVE_INFINITY));
      const last = Math.max(...own.map((piece) => run.graph.byPiece.get(piece.id)?.start ?? 0));
      expect(light.on).toBeLessThan(first);
      expect(light.off).toBeGreaterThan(last);
    }
  });

  it("steps on a fixed 240 Hz clock", () => {
    const { run } = accio(SEED);
    run.advanceTo(1 / 60);
    expect(run.time() * ASSEMBLY_TICK_RATE).toBe(4);
  });

  it("ends on a framing of the whole room inside the orbit's limits, no chandelier in the middle of it", () => {
    const limits = computeDistanceLimits({ width: 21.135, length: 10.59, height: 6.7 });
    for (const [keys, aspect] of [[ACCIO_CAMERA_LANDSCAPE, 16 / 9], [ACCIO_CAMERA_PORTRAIT, 393 / 852]] as const) {
      const last = keys[keys.length - 1];
      expect(last).toBeDefined();
      if (last === undefined) continue;
      const position = new Vector3(...last.position);
      const target = new Vector3(...last.target);
      const offset = position.clone().sub(target);
      expect(offset.length()).toBeGreaterThan(limits.minDistance);
      expect(offset.length()).toBeLessThan(limits.maxDistance);
      expect(Math.acos(offset.y / offset.length())).toBeLessThan(MAX_POLAR_ANGLE);
      const camera = new PerspectiveCamera(55, aspect, 0.1, 200);
      camera.position.copy(position);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      for (const chandelier of HALL_CHANDELIERS) {
        const middle = new Vector3(chandelier.position[0], (chandelier.bottom + chandelier.position[1]) / 2, chandelier.position[2]).project(camera);
        if (middle.z > 1 || middle.z < -1) continue;
        // Not in the middle half of the frame.
        expect(Math.abs(middle.x) > 0.5 || Math.abs(middle.y) > 0.4, chandelier.id).toBe(true);
      }
      if (aspect > 1) {
        // Every round's place is in frame.
        for (const piece of pieces) {
          if (piece.role !== "table") continue;
          const seen = new Vector3(piece.x, 0.76, piece.z).project(camera);
          expect(Math.abs(seen.x) < 1 && Math.abs(seen.y) < 1, piece.id).toBe(true);
        }
      }
    }
  });
});
