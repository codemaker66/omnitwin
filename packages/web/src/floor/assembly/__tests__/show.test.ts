import { describe, expect, it, vi } from "vitest";
import { Matrix4 } from "three";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { createAssemblyShow, assemblyPieces, assemblySeed } from "../show.js";
import { emptyPose } from "../engine.js";
import { composePieceMatrix, savedPieceMatrix } from "../pose-matrix.js";
import { grandHallDinner180 } from "../fixture.js";

const layout = grandHallDinner180();
const pieces = assemblyPieces(layout);
const seed = assemblySeed("config-grand-hall-dinner");

/** Steps a show to its end, frame by frame at 60 fps; returns its frames' piece counts. */
function playOut(show: ReturnType<typeof createAssemblyShow>): number[] {
  const sizes: number[] = [];
  for (let frame = 0; frame <= 12 * 60; frame++) {
    show.advanceTo(frame / 60);
    const drawn = show.frame();
    if (drawn === null) break;
    sizes.push(drawn.pieces.size);
  }
  return sizes;
}

describe("the Grand Assembly show", () => {
  it("opens on the empty room: every piece hidden, nothing else touched", () => {
    const show = createAssemblyShow(layout, { seed });
    show.advanceTo(0);
    const frame = show.frame();
    expect(frame?.others).toBe("placed");
    expect(frame?.pieces.size).toBe(pieces.length);
    for (const piece of frame?.pieces.values() ?? []) {
      expect(piece.visible).toBe(false);
      expect(piece.shadow).toBe(0);
    }
  });

  it("draws each moving piece as delta · placed, exactly its pose", () => {
    const show = createAssemblyShow(layout, { seed });
    show.advanceTo(2.4);
    const frame = show.frame();
    const pose = emptyPose();
    const placed = new Matrix4();
    const drawn = new Matrix4();
    const expected = new Matrix4();
    let moving = 0;
    for (const piece of pieces) {
      const presented = frame?.pieces.get(piece.id);
      if (presented === undefined || !presented.visible) continue;
      moving += 1;
      show.playback.pose(piece.id, pose);
      composePieceMatrix(pose, piece.scale, expected);
      drawn.multiplyMatrices(presented.delta, savedPieceMatrix(piece.x, piece.y, piece.z, piece.rotationY, piece.scale, placed));
      drawn.elements.forEach((value, index) => { expect(value).toBeCloseTo(expected.elements[index] ?? Number.NaN, 9); });
    }
    expect(moving).toBeGreaterThan(10);
  });

  it("leaves pieces at rest out of the frame, and releases the furniture (null) once all rest", () => {
    const show = createAssemblyShow(layout, { seed });
    const sizes = playOut(show);
    expect(show.done()).toBe(true);
    expect(show.frame()).toBeNull();
    // Fewer and fewer pieces are drawn presented as they come to rest.
    expect(sizes[sizes.length - 1] ?? Number.POSITIVE_INFINITY).toBeLessThan(sizes[0] ?? 0);
  });

  it("keeps a landed table in the frame, as placed, until its candles have lit", () => {
    const show = createAssemblyShow(layout, { seed });
    const table = pieces.find((piece) => piece.role === "table");
    expect(table).toBeDefined();
    if (table === undefined) return;
    const dressing = show.playback.graph.dressing.get(table.id) ?? Number.NaN;
    // Just before its candles start: the table has long landed.
    show.advanceTo(dressing - 0.05);
    expect(show.playback.isDone(table.id)).toBe(true);
    const presented = show.frame()?.pieces.get(table.id);
    expect(presented?.visible).toBe(true);
    expect(presented?.wax).toBe(0);
    const identity = new Matrix4();
    presented?.delta.elements.forEach((value, index) => { expect(value).toBeCloseTo(identity.elements[index] ?? Number.NaN, 9); });
  });

  it("never writes the placement store", () => {
    usePlacementStore.setState({ placedItems: layout });
    const listener = vi.fn();
    const unsubscribe = usePlacementStore.subscribe(listener);
    const show = createAssemblyShow(usePlacementStore.getState().placedItems, { seed });
    playOut(show);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(usePlacementStore.getState().placedItems).toBe(layout);
  });

  it("plays a layout the same way every time: its seed comes from the layout", () => {
    expect(assemblySeed("config-grand-hall-dinner")).toBe(seed);
    expect(assemblySeed("another-layout")).not.toBe(seed);
    const a = createAssemblyShow(layout, { seed });
    const b = createAssemblyShow(layout, { seed });
    for (const seconds of [1, 2.5, 4, 5.5]) {
      a.advanceTo(seconds);
      b.advanceTo(seconds);
      const one = a.frame();
      const two = b.frame();
      expect([...(two?.pieces.keys() ?? [])]).toEqual([...(one?.pieces.keys() ?? [])]);
      for (const [id, piece] of one?.pieces ?? []) expect(two?.pieces.get(id)).toEqual(piece);
      expect(b.camera()).toEqual(a.camera());
    }
  });

  it("completes at once under reduced motion: no frame at all", () => {
    const show = createAssemblyShow(layout, { seed, reducedMotion: true });
    expect(show.done()).toBe(true);
    expect(show.frame()).toBeNull();
    expect(show.camera()).toBeNull();
  });

  it("skips to the true state with the camera at its final framing; cancels leaving the camera", () => {
    const skipped = createAssemblyShow(layout, { seed });
    skipped.advanceTo(3);
    skipped.skip();
    expect(skipped.frame()).toBeNull();
    expect(skipped.camera()).toEqual(skipped.playback.finalCamera());
    const cancelled = createAssemblyShow(layout, { seed });
    cancelled.advanceTo(3);
    cancelled.cancel();
    expect(cancelled.frame()).toBeNull();
    expect(cancelled.camera()).toBeNull();
  });

  it("frames the hall down its length on a portrait screen", () => {
    const wide = createAssemblyShow(layout, { seed });
    const tall = createAssemblyShow(layout, { seed, portrait: true });
    expect(tall.playback.finalCamera()).not.toEqual(wide.playback.finalCamera());
  });

  it("knows the hall's five windows", () => {
    expect(createAssemblyShow([], { seed }).windows).toHaveLength(5);
  });
});
