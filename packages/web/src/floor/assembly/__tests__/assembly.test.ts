import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import { getCatalogueItem } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "../../../components/grand-hall/hall-spec.js";
import {
  ASSEMBLY_DIRECTIONS,
  diffLayouts,
  type AssemblyDirection,
  type AssemblyPiece,
  type DescribePiece,
} from "../choreography.js";
import { ASSEMBLY_TICK_RATE, createAssemblyPlayback, emptyPose, type AssemblyPlayback, type PiecePose } from "../engine.js";
import { directionModel } from "../directions.js";
import { composePieceMatrix, savedPieceMatrix } from "../pose-matrix.js";
import { DINNER_ANCHOR, DINNER_SEATS_PER_TABLE, dinnerTableId, grandHallDinner180 } from "../fixture.js";

const describePiece: DescribePiece = (item) => {
  const catalogue = getCatalogueItem(item.catalogueItemId);
  if (catalogue === undefined) return null;
  const role = catalogue.category === "table" ? "table" : catalogue.category === "chair" ? "chair" : "piece";
  return { role, height: catalogue.height, radius: Math.max(catalogue.width, catalogue.depth) / 2 };
};

const layout: readonly PlacedItem[] = grandHallDinner180();
const pieces: readonly AssemblyPiece[] = diffLayouts([], layout, describePiece).arriving;

function playback(direction: AssemblyDirection, seed: number, reducedMotion = false): AssemblyPlayback {
  return createAssemblyPlayback(pieces, directionModel(direction, pieces), seed, { reducedMotion });
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

describe("the 180-seat Grand Hall dinner", () => {
  it("is 18 rounds of 10 with stable ids, Table 1 at the fireplace end", () => {
    const tables = layout.filter((item) => describePiece(item)?.role === "table");
    const chairs = layout.filter((item) => describePiece(item)?.role === "chair");
    expect(tables).toHaveLength(18);
    expect(chairs).toHaveLength(18 * DINNER_SEATS_PER_TABLE);
    const first = layout[0];
    expect(first?.id).toBe(dinnerTableId(1));
    expect(first?.label).toBe("Table 1");
    expect(first?.x).toBe(DINNER_ANCHOR.x);
    expect(first?.z).toBe(DINNER_ANCHOR.z);
    expect(grandHallDinner180()).toEqual(layout);
  });

  it("keeps every chair inside the hall and no two chairs touching", () => {
    const chairs = layout.filter((item) => describePiece(item)?.role === "chair");
    for (const chair of chairs) {
      // Chair centre plus half its depth (0.29 m) stays off every wall.
      expect(Math.abs(chair.x) + 0.29).toBeLessThan(HALL_HALF_LENGTH);
      expect(Math.abs(chair.z) + 0.29).toBeLessThan(HALL_HALF_WIDTH);
    }
    let nearest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < chairs.length; a++) {
      for (let b = a + 1; b < chairs.length; b++) {
        const one = chairs[a];
        const two = chairs[b];
        if (one === undefined || two === undefined) continue;
        nearest = Math.min(nearest, Math.hypot(one.x - two.x, one.z - two.z));
      }
    }
    // Turini chairs are 0.42 m wide: neighbours round a table sit 0.78 m apart.
    expect(nearest).toBeGreaterThan(0.6);
  });
});

describe("the layout diff and choreography graph", () => {
  it("diffs the empty room to every saved piece arriving, and a saved layout to itself as unchanged", () => {
    expect(pieces).toHaveLength(198);
    const same = diffLayouts(layout, layout, describePiece);
    expect(same.arriving).toHaveLength(0);
    expect(same.unchanged).toHaveLength(198);
    const moved = layout.map((item, index) => (index === 3 ? { ...item, x: item.x + 0.1 } : item));
    const diff = diffLayouts(layout, moved, describePiece);
    expect(diff.moving).toEqual([layout[3]?.id]);
    expect(diffLayouts(layout, layout.slice(11), describePiece).leaving).toHaveLength(11);
  });

  it.each(ASSEMBLY_DIRECTIONS)("%s: anchor first, chairs after their table, candles after the last chair", (direction) => {
    const { graph } = playback(direction, 7);
    expect(graph.anchorId).toBe(dinnerTableId(1));
    const anchor = graph.byPiece.get(dinnerTableId(1));
    expect(anchor?.beat).toBe("anchor");
    const tableNodes = graph.nodes.filter((node) => node.beat === "table" || node.beat === "anchor");
    expect(tableNodes).toHaveLength(18);
    for (const node of tableNodes) expect(node.start).toBeGreaterThanOrEqual(anchor?.start ?? 0);
    let lastChair = 0;
    for (const node of graph.nodes) {
      if (node.beat !== "chair") continue;
      const table = node.after === null ? undefined : graph.byPiece.get(node.after);
      expect(table).toBeDefined();
      expect(node.start).toBeGreaterThan(table?.start ?? Number.POSITIVE_INFINITY);
      lastChair = Math.max(lastChair, node.start);
    }
    for (const start of graph.dressing.values()) expect(start).toBeGreaterThan(lastChair);
    // Nodes are listed in start order.
    for (let index = 1; index < graph.nodes.length; index++) {
      expect(graph.nodes[index]?.start ?? 0).toBeGreaterThanOrEqual(graph.nodes[index - 1]?.start ?? 0);
    }
  });

  it.each(["accio", "unfolding"] as const)("%s: tables start in waves outward from the anchor", (direction) => {
    const { graph } = playback(direction, 7);
    const tables = pieces.filter((piece) => piece.role === "table");
    const distance = (piece: AssemblyPiece): number => Math.hypot(piece.x - DINNER_ANCHOR.x, piece.z - DINNER_ANCHOR.z);
    const byDistance = [...tables].sort((a, b) => distance(a) - distance(b));
    const waves = byDistance.map((piece) => graph.byPiece.get(piece.id)?.wave ?? -1);
    for (let index = 1; index < waves.length; index++) expect(waves[index] ?? 0).toBeGreaterThanOrEqual(waves[index - 1] ?? 0);
    // A seeded scatter never lets a table start before one a whole ring nearer.
    for (const near of byDistance) {
      for (const far of byDistance) {
        if (distance(far) - distance(near) < 3.4) continue;
        expect(graph.byPiece.get(far.id)?.start ?? 0).toBeGreaterThan(graph.byPiece.get(near.id)?.start ?? 0);
      }
    }
  });

  it("procession: no round passes over one already set", () => {
    const run = playback("procession", 7);
    const tables = pieces.filter((piece) => piece.role === "table");
    const pose = emptyPose();
    for (let frame = 1; frame <= run.clipSeconds * 30; frame++) {
      run.advanceTo(frame / 30);
      const set = tables.filter((table) => run.isDone(table.id));
      for (const table of tables) {
        if (run.isDone(table.id)) continue;
        run.pose(table.id, pose);
        if (!pose.visible) continue;
        for (const other of set) {
          // A set round's chairs reach 1.55 m from its centre; a round on edge is 0.4 m thick.
          expect(Math.hypot(pose.x - other.x, pose.z - other.z)).toBeGreaterThan(1.9);
        }
      }
    }
  });
});

describe.each(ASSEMBLY_DIRECTIONS)("%s playback", (direction) => {
  it("gives the same transforms at the same time for the same seed, however time is stepped", () => {
    const a = playback(direction, 1234);
    const b = playback(direction, 1234);
    const c = playback(direction, 1234);
    for (const seconds of [0.5, 1.2, 2.4, 3.7, 5.1]) {
      a.advanceTo(seconds);
      // b in 30 fps frames, c in one jump: the fixed tick makes them equal.
      for (let frame = Math.round(b.time() * 30) + 1; frame <= Math.round(seconds * 30); frame++) b.advanceTo(frame / 30);
      c.advanceTo(seconds);
      expect(snapshot(b)).toEqual(snapshot(a));
      expect(snapshot(c)).toEqual(snapshot(a));
      expect(b.camera()).toEqual(a.camera());
    }
    // Replaying from an earlier time rebuilds the same state.
    a.advanceTo(1.0);
    const replayed = snapshot(a);
    const fresh = playback(direction, 1234);
    fresh.advanceTo(1.0);
    expect(replayed).toEqual(snapshot(fresh));
  });

  it("differs for another seed", () => {
    if (direction === "procession") return; // the Procession's order and routes are fixed by the doors
    const a = playback(direction, 1);
    const b = playback(direction, 2);
    a.advanceTo(2.0);
    b.advanceTo(2.0);
    expect(snapshot(b)).not.toEqual(snapshot(a));
  });

  it("settles every piece at exactly its saved transform, with a held ending", () => {
    const run = playback(direction, 99);
    runToRest(run);
    expect(run.done()).toBe(true);
    const settled = run.settledAt() ?? Number.POSITIVE_INFINITY;
    // At least 0.7 s of stillness before the clip ends.
    expect(settled).toBeLessThanOrEqual(run.clipSeconds - 0.7);
    const pose = emptyPose();
    const drawn = new Matrix4();
    const saved = new Matrix4();
    for (const piece of pieces) {
      expect(run.pose(piece.id, pose)).toBe(true);
      expect(pose.visible).toBe(true);
      expect(Math.abs(pose.x - piece.x)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(pose.y - piece.y)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(pose.z - piece.z)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(pose.yaw - piece.rotationY)).toBeLessThanOrEqual(1e-6);
      composePieceMatrix(pose, piece.scale, drawn);
      savedPieceMatrix(piece.x, piece.y, piece.z, piece.rotationY, piece.scale, saved);
      drawn.elements.forEach((value, index) => { expect(Math.abs(value - (saved.elements[index] ?? 0))).toBeLessThanOrEqual(1e-6); });
    }
    const dressing = { wax: 0, flame: 0, glow: 0 };
    for (const piece of pieces.filter((candidate) => candidate.role === "table")) {
      run.dressing(piece.id, dressing);
      expect(dressing).toEqual({ wax: 1, flame: 1, glow: 1 });
    }
  });

  it("hides every piece before its start and shows motion in the middle", () => {
    const run = playback(direction, 5);
    const pose = emptyPose();
    for (const piece of pieces) {
      run.pose(piece.id, pose);
      expect(pose.visible).toBe(false);
    }
    run.advanceTo(2.5);
    expect(run.live().length).toBeGreaterThan(10);
  });

  it("completes at once under reduced motion, leaving the camera alone", () => {
    const run = playback(direction, 3, true);
    expect(run.done()).toBe(true);
    expect(run.time()).toBe(0);
    expect(run.camera()).toBeNull();
    const pose = emptyPose();
    for (const piece of pieces) {
      run.pose(piece.id, pose);
      expect(pose.visible).toBe(true);
      expect(pose.x).toBe(piece.x);
      expect(pose.z).toBe(piece.z);
      expect(pose.yaw).toBe(piece.rotationY);
    }
  });

  it("snaps to the true state on skip (camera to its last pose) and on cancel (camera left)", () => {
    const skipped = playback(direction, 11);
    skipped.advanceTo(1.6);
    expect(skipped.done()).toBe(false);
    skipped.skip();
    expect(skipped.done()).toBe(true);
    const finalKey = directionModel(direction, pieces).camera.keys.at(-1);
    expect(skipped.camera()).toEqual({ position: [...(finalKey?.position ?? [])], target: [...(finalKey?.target ?? [])] });
    const cancelled = playback(direction, 11);
    cancelled.advanceTo(1.6);
    cancelled.cancel();
    expect(cancelled.done()).toBe(true);
    expect(cancelled.camera()).toBeNull();
    const pose = emptyPose();
    for (const run of [skipped, cancelled]) {
      for (const piece of pieces) {
        run.pose(piece.id, pose);
        expect([pose.x, pose.y, pose.z, pose.yaw, pose.sx, pose.sy, pose.sz]).toEqual([piece.x, piece.y, piece.z, piece.rotationY, 1, 1, 1]);
      }
    }
  });

  it("steps on its own clock of 240 ticks a second", () => {
    const run = playback(direction, 1);
    run.advanceTo(1 / 30);
    expect(run.time() * ASSEMBLY_TICK_RATE).toBe(8);
  });
});
