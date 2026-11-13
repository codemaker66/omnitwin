import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackSide, BoxGeometry, FrontSide, Mesh } from "three";
import { ConstNode, MathNode, MeshBasicNodeMaterial, OperatorNode, VarNode } from "three/webgpu";
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
    // The whole front, uncut, on the sun's shadow layer only.
    expect(caster?.castShadow).toBe(true);
    expect(caster?.layers.mask).toBe(1 << HALL_SUN_CASTER_LAYER);
    expect(nodeMaterial(caster).side).toBe(FrontSide);
    const disposed = [vi.spyOn(outsideMaterial, "dispose"), vi.spyOn(cutMaterial, "dispose")];
    mounted.unmount();
    mounted = null;
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("caps the cut's pull in its vertex stage: a share of the eye's distance, never more than CUT_EYEWARD_MAX", async () => {
    mounted = mountInStubRoot(<HallExterior sun={sun} lightMaps={lightMaps} />);
    await act(async () => { build.done({ geometry: new BoxGeometry(1, 1, 1) }); await Promise.resolve(); });
    const meshes = (mounted.scene.getObjectByName("grand-hall-front")?.children ?? []).filter((child): child is Mesh => child instanceof Mesh);
    // TSL wraps each operand in a VarNode.
    const unwrap = (node: unknown): unknown => (node instanceof VarNode ? unwrap(node.node) : node);
    const isConst = (node: unknown, value: number): boolean => { const inner = unwrap(node); return inner instanceof ConstNode && inner.value === value; };
    const isMath = (node: unknown, method: string): boolean => { const inner = unwrap(node); return inner instanceof MathNode && inner.method === method; };
    // The eye's position scaled by 1 - min(CUT_EYEWARD, CUT_EYEWARD_MAX / length(positionView)): uncapped (a
    // flat share), or added rather than taken away, the cut would reach past the glass far off, or behind it.
    let capped = 0;
    nodeMaterial(meshes[1]).vertexNode?.traverse((node) => {
      if (!(node instanceof OperatorNode) || node.op !== "-" || !isConst(node.aNode, 1)) return;
      const share = unwrap(node.bNode);
      if (!(share instanceof MathNode) || share.method !== "min") return;
      const inputs = [unwrap(share.aNode), unwrap(share.bNode)];
      const cap = inputs.some((input) => input instanceof OperatorNode && input.op === "/" && isConst(input.aNode, CUT_EYEWARD_MAX) && isMath(input.bNode, "length"));
      if (cap && inputs.some((input) => isConst(input, CUT_EYEWARD))) capped += 1;
    });
    expect(capped).toBe(1);
  });
});
