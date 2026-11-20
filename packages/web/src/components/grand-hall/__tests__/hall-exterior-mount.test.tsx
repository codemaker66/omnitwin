import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackSide, BoxGeometry, FrontSide, LessEqualDepth, Mesh, PerspectiveCamera } from "three";
import { ConstNode, JoinNode, MathNode, MeshBasicNodeMaterial, OperatorNode, VarNode } from "three/webgpu";
import { cameraProjectionMatrix, positionView, positionWorld } from "three/tsl";
import { CUT_EYEWARD, CUT_EYEWARD_MAX } from "../hall-exterior-material.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { createSunCaster, HALL_SUN_CASTER_LAYER } from "../hall-sun.js";
import { createStreetLightMaps } from "../hall-street-light.js";
import type { HallFinish } from "../hall-finish.js";

// A computer's finish, as the hall reads it.
vi.mock("../hall-finish.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-finish.js")>();
  return { ...original, useHallFinish: (): HallFinish => original.FULL_HALL_FINISH };
});

// The front's build, held in the test's hand: it settles when the test says.
const build = vi.hoisted(() => ({
  fail: (_reason: Error): void => undefined,
  done: (_front: { readonly geometry: unknown }): void => undefined,
}));
vi.mock("../hall-slices.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-slices.js")>();
  return {
    ...original,
    runSliced: (): Promise<unknown> => new Promise((resolve, reject) => { build.fail = reject; build.done = resolve; }),
  };
});

const { HallExterior } = await import("../HallExterior.js");

const sun = createSunCaster({ name: "test-city-sun", box: { min: [-1, -1, -1], max: [1, 1, 1] }, mapSize: 16, reach: 0 });
const lightMaps = createStreetLightMaps();

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("the measured front's build", () => {
  it("says once that it failed, so the city can take back its own front", async () => {
    const onFailed = vi.fn();
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} onFailed={onFailed} />);
    await act(async () => { build.fail(new Error("the build threw")); await Promise.resolve(); });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(mounted.scene.getObjectByName("grand-hall-front")).toBeUndefined();
  });

  it("says nothing when it is cut short by the front leaving", async () => {
    const onFailed = vi.fn();
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} onFailed={onFailed} />);
    mounted.unmount();
    mounted = null;
    await act(async () => { build.fail(new Error("cut short")); await Promise.resolve(); });
    expect(onFailed).not.toHaveBeenCalled();
  });
});

function nodeMaterial(mesh: Mesh | undefined): MeshBasicNodeMaterial {
  const material = mesh?.material;
  if (!(material instanceof MeshBasicNodeMaterial)) throw new Error("the front's mesh has no node material");
  return material;
}

describe("the measured front as drawn", () => {
  it("draws its outside, then its cut a hair toward the eye, and its shadow's stand-in, and lets go of both passes on leaving", async () => {
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} />);
    await act(async () => { build.done({ geometry: new BoxGeometry(1, 1, 1) }); await Promise.resolve(); });
    const meshes = (mounted.scene.getObjectByName("grand-hall-front")?.children ?? []).filter((child): child is Mesh => child instanceof Mesh);
    expect(meshes).toHaveLength(3);
    const [outside, cut, caster] = meshes;
    // The outside: the solids' outer faces, where they are.
    const outsideMaterial = nodeMaterial(outside);
    expect(outsideMaterial.side).toBe(FrontSide);
    expect(outsideMaterial.vertexNode).toBeNull();
    // The cut: their inner faces, drawn toward the eye so a face on their plane never ties them, after the scene's opaque pieces.
    const cutMaterial = nodeMaterial(cut);
    expect(cutMaterial.side).toBe(BackSide);
    expect(cutMaterial.vertexNode).not.toBeNull();
    expect(cut?.renderOrder).toBe(1);
    // Drawn after the outside, it keeps an exact tie because the depth test passes equal depths (past the cap's reach
    // far off, ties are all the pull leaves it): a strict test would hand them back to the outside.
    expect(cutMaterial.depthFunc).toBe(LessEqualDepth);
    // The whole front, uncut, on the sun's shadow layer only.
    expect(caster?.castShadow).toBe(true);
    expect(caster?.layers.mask).toBe(1 << HALL_SUN_CASTER_LAYER);
    expect(nodeMaterial(caster).side).toBe(FrontSide);
    const disposed = [vi.spyOn(outsideMaterial, "dispose"), vi.spyOn(cutMaterial, "dispose")];
    mounted.unmount();
    mounted = null;
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("draws each inside face toward the eye by min(CUT_EYEWARD x its distance, CUT_EYEWARD_MAX), where it already projects", async () => {
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} />);
    await act(async () => { build.done({ geometry: new BoxGeometry(1, 1, 1) }); await Promise.resolve(); });
    const meshes = (mounted.scene.getObjectByName("grand-hall-front")?.children ?? []).filter((child): child is Mesh => child instanceof Mesh);
    const vertex = nodeMaterial(meshes[1]).vertexNode;
    expect(vertex).not.toBeNull();
    // A camera as the planner's (55° up and down, 16:9, near 0.1 m, far 900 m), its projection in three's column order.
    const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 900);
    camera.updateProjectionMatrix();
    const projection: readonly number[] = [...camera.projectionMatrix.elements];
    // The vertex stage evaluated as the GPU would: the eye's position (positionView), the world's (positionWorld, set far
    // from it so a pull measured from the world's origin shows) and the projection. A node it cannot evaluate fails the
    // test, so a reshaped expression is looked at again rather than passed. Each mutation the reviews named fails here:
    // the clip vector or its w scaled instead of the point (no pull), the point divided (pushed away), or a distance
    // taken from the world's origin.
    type Value = number | readonly number[];
    const each = (a: Value, b: Value, op: (x: number, y: number) => number): Value => {
      if (typeof a === "number" && typeof b === "number") return op(a, b);
      if (typeof a === "number" && typeof b !== "number") return b.map((y) => op(a, y));
      if (typeof a !== "number" && typeof b === "number") return a.map((x) => op(x, b));
      if (typeof a !== "number" && typeof b !== "number" && a.length === b.length) return a.map((x, i) => op(x, b[i] ?? Number.NaN));
      throw new Error("operands of mismatched sizes");
    };
    const evaluate = (node: unknown, view: readonly number[], world: readonly number[]): Value => {
      // TSL exports these three as variables round their shader calls, and the material holds the exports themselves:
      // match them before a variable is unwrapped, or each would be met as the bare call inside.
      if (node === positionView) return view;
      if (node === positionWorld) return world;
      if (node === cameraProjectionMatrix) return projection;
      if (node instanceof VarNode) return evaluate(node.node, view, world);
      if (node instanceof ConstNode && typeof node.value === "number") return node.value;
      if (node instanceof JoinNode) return node.nodes.flatMap((part) => { const value = evaluate(part, view, world); return typeof value === "number" ? [value] : [...value]; });
      if (node instanceof MathNode) {
        const a = evaluate(node.aNode, view, world);
        if (node.method === "length" && typeof a !== "number") return Math.hypot(...a);
        if (node.method === "min") return each(a, evaluate(node.bNode, view, world), Math.min);
      }
      if (node instanceof OperatorNode) {
        const a = evaluate(node.aNode, view, world);
        const b = evaluate(node.bNode, view, world);
        if (node.op === "*" && typeof a !== "number" && a.length === 16 && typeof b !== "number" && b.length === 4) {
          return [0, 1, 2, 3].map((row) => b.reduce((sum, value, column) => sum + (a[column * 4 + row] ?? Number.NaN) * value, 0));
        }
        if (node.op === "*") return each(a, b, (x, y) => x * y);
        if (node.op === "/") return each(a, b, (x, y) => x / y);
        if (node.op === "-") return each(a, b, (x, y) => x - y);
        if (node.op === "+") return each(a, b, (x, y) => x + y);
      }
      throw new Error(`the cut's vertex stage holds a node this test cannot evaluate: ${(node as { constructor?: { name?: string } } | null)?.constructor?.name ?? String(node)}`);
    };
    const clip = (point: readonly number[]): number[] => [0, 1, 2, 3].map((row) => [...point, 1].reduce((sum, value, column) => sum + (projection[column * 4 + row] ?? Number.NaN) * value, 0));
    for (const distance of [5, 10, 40, 500]) {
      const view = [0.05 * distance, -0.03 * distance, -distance];
      const eye = Math.hypot(...view);
      const pull = Math.min(CUT_EYEWARD * eye, CUT_EYEWARD_MAX);
      const drawn = evaluate(vertex, view, [123, 45, -67]);
      if (typeof drawn === "number") throw new Error("the vertex stage gave a number, not a clip position");
      // Exactly the projection of the point moved toward the eye by the pull: 1.25 mm at 5 m, the cap of 2.5 mm from 10 m on.
      const expected = clip(view.map((x) => x * (1 - pull / eye)));
      expect(drawn).toHaveLength(4);
      for (const [i, value] of drawn.entries()) expect(Math.abs(value - (expected[i] ?? Number.NaN))).toBeLessThan(1e-9 * Math.max(1, Math.abs(expected[i] ?? 0)));
      // A point moved straight toward the eye projects where it did, and its depth is nearer.
      const [dx, dy, dz, dw] = drawn;
      const [px, py, pz, pw] = clip(view);
      if (dx === undefined || dy === undefined || dz === undefined || dw === undefined || px === undefined || py === undefined || pz === undefined || pw === undefined) throw new Error("clip coordinates missing");
      expect(dx / dw).toBeCloseTo(px / pw, 12);
      expect(dy / dw).toBeCloseTo(py / pw, 12);
      expect(dz / dw).toBeLessThan(pz / pw);
      // What that means, read back from the depth the GPU tests (z / w, through the projection's z row to the eye's
      // depth): the drawn point lies nearer by exactly the pull. The element-by-element check above is the one that
      // decides (every mutation of the stage fails there first); this and the w read-back follow from it, and w alone
      // would pass a stage that scales the whole clip vector, which moves nothing.
      const [zz, zw] = [projection[10] ?? Number.NaN, projection[14] ?? Number.NaN];
      const eyeDepth = (ndc: number): number => -zw / (ndc + zz);
      expect(eye * (1 - eyeDepth(dz / dw) / eyeDepth(pz / pw))).toBeCloseTo(pull, 8);
      expect(eye * (1 - dw / pw)).toBeCloseTo(pull, 12);
    }
  });
});
