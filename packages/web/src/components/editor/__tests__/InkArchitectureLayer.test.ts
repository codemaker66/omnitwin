import { act, cleanup, renderHook } from "@testing-library/react";
import { LineBasicMaterial, LineSegments } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toRenderSpace } from "../../../constants/scale.js";
import { buildInkSegments, INK_FLOOR_LIFT, InkArchitectureLayer } from "../InkArchitectureLayer.js";

const motion = vi.hoisted(() => ({ invalidate: vi.fn(), reduced: false }));
vi.mock("@react-three/fiber", () => ({
  useThree: <T>(selector: (state: { invalidate: () => void }) => T): T => selector(motion),
}));
vi.mock("../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => motion.reduced }));

// CARD A2: the blueprint ink layer is the planner's first paint. The segment
// builder is pure — polygon (metres) + ceiling height in, render-space line
// segment positions out — so the geometry is testable without a canvas.

const SQUARE: readonly (readonly [number, number])[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function triples(positions: Float32Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push([positions[i] ?? NaN, positions[i + 1] ?? NaN, positions[i + 2] ?? NaN]);
  }
  return out;
}

describe("buildInkSegments", () => {
  it("draws floor loop, ceiling loop, and corner verticals for a closed polygon", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    // 4 edges → 4 floor + 4 ceiling + 4 vertical segments, 2 vertices each,
    // 3 floats per vertex.
    expect(positions.length).toBe(12 * 2 * 3);
  });

  it("maps metres into render space and lifts the floor loop off the slab", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    const points = triples(positions);
    // The buffer stores 32-bit floats — compare against fround'd expectations.
    const ceilingY = Math.fround(toRenderSpace(3.2));
    const lift = Math.fround(INK_FLOOR_LIFT);

    // Every vertex sits on the floor lift or the ceiling plane.
    for (const [, y] of points.map((p) => [p[0], p[1]] as const)) {
      expect(y === lift || y === ceilingY).toBe(true);
    }

    // The far corner (10 m, 10 m) lands at render-space (20, 20).
    const corner = Math.fround(toRenderSpace(10));
    expect(points.some(([x, , z]) => x === corner && z === corner)).toBe(true);
  });

  it("connects each corner's floor and ceiling with a vertical", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    const points = triples(positions);
    const ceilingY = Math.fround(toRenderSpace(3.2));
    const lift = Math.fround(INK_FLOOR_LIFT);
    const corner = Math.fround(toRenderSpace(10));

    const floorCorner = points.some(([x, y, z]) => x === corner && y === lift && z === corner);
    const ceilingCorner = points.some(([x, y, z]) => x === corner && y === ceilingY && z === corner);
    expect(floorCorner).toBe(true);
    expect(ceilingCorner).toBe(true);
  });

  it("returns no segments for degenerate polygons", () => {
    expect(buildInkSegments([], 3).length).toBe(0);
    expect(buildInkSegments([[0, 0]], 3).length).toBe(0);
    expect(buildInkSegments([[0, 0], [5, 0]], 3).length).toBe(0);
  });
});

describe("ink fade timing", () => {
  const pending = new Map<number, FrameRequestCallback>();
  let time = 0;
  let nextId = 0;

  beforeEach(() => {
    time = 0;
    nextId = 0;
    pending.clear();
    motion.reduced = false;
    motion.invalidate.mockClear();
    vi.spyOn(performance, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      pending.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => { pending.delete(id); });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function frame(elapsed: number): void {
    time += elapsed;
    const callbacks = [...pending.values()];
    pending.clear();
    act(() => { for (const callback of callbacks) callback(time); });
  }

  function mount(targetOpacity: number) {
    const hook = renderHook(({ target }) => InkArchitectureLayer({
      polygon: SQUARE, ceilingHeightM: 3.2, targetOpacity: target,
    }), { initialProps: { target: targetOpacity } });
    const props: unknown = hook.result.current?.props;
    if (typeof props !== "object" || props === null || !("object" in props)
      || !(props.object instanceof LineSegments) || !(props.object.material instanceof LineBasicMaterial)) {
      throw new Error("The ink layer did not create its line segments");
    }
    return { ...hook, lines: props.object, material: props.object.material };
  }

  it("finishes a fade on the delayed RAF instead of submitting extra full-scene frames", () => {
    const ink = mount(1);
    frame(16.6666666667);
    expect(ink.material.opacity).toBeCloseTo(0.16);
    expect(pending.size).toBe(1);
    frame(5_000);
    expect(ink.material.opacity).toBe(1);
    expect(pending.size).toBe(0);

    ink.rerender({ target: 0 });
    motion.invalidate.mockClear();
    frame(5_000);
    expect(ink.material.opacity).toBe(0);
    expect(ink.lines.visible).toBe(false);
    expect(motion.invalidate).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
  });

  it("preserves partial-coverage targets and cancels an unfinished fade on unmount", () => {
    const ink = mount(0.4);
    frame(5_000);
    expect(ink.material.opacity).toBe(0.4);
    expect(ink.lines.visible).toBe(true);
    expect(pending.size).toBe(0);
    ink.rerender({ target: 0.8 });
    frame(16.6666666667);
    expect(ink.material.opacity).toBeGreaterThan(0.4);
    expect(ink.material.opacity).toBeLessThan(0.8);
    expect(pending.size).toBe(1);
    ink.unmount();
    expect(pending.size).toBe(0);
  });

  it("applies reduced motion immediately without scheduling a frame", () => {
    motion.reduced = true;
    const ink = mount(0.4);
    expect(ink.material.opacity).toBe(0.4);
    expect(pending.size).toBe(0);
    ink.rerender({ target: 0 });
    expect(ink.lines.visible).toBe(false);
    expect(pending.size).toBe(0);
  });
});
