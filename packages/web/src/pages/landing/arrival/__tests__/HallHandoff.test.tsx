import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BufferGeometry, Group, Material, Matrix4, Mesh, MeshStandardMaterial } from "three";
import type { TwinManifest } from "@omnitwin/types";
import {
  TWIN_FIXTURE_MANIFEST,
  TWIN_FIXTURE_MANIFEST_NO_MESH,
} from "../../../../twin/__fixtures__/twin-fixture.js";

// -----------------------------------------------------------------------------
// HallHandoff — the reveal (Arrival Task 7). happy-dom has no WebGL and no
// real GLB pipeline, so this is a structure/orchestration test, not a render
// test: @react-three/fiber, drei's useGLTF, and useTwinManifest are mocked
// wholesale (the DollhouseStage.test.tsx preamble); the caps/prune split are
// spied through their REAL implementation — both degrade gracefully on the
// fake scene's non-indexed geometry, exactly as DollhouseStage.test.tsx's own
// fake scene relies on. Pinned here:
//   - nothing renders while the manifest is loading, on error (warns once,
//     not per render), or once ready with no mesh;
//   - prune runs BEFORE caps (DollhouseStage.tsx:141-145's own order — "the
//     prune rewrites the index the split then partitions"), each exactly
//     once per load, not once per render;
//   - the crossfade ramps opacity from 0 toward 1 and ends
//     transparent === false, opacity === 1 (kills alpha-sort cost), and stops
//     invalidating once settled;
//   - the source material useGLTF would hand to any OTHER consumer is never
//     mutated — only the per-mount clone is (the cache-poisoning gate).
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate }),
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
}));

function buildFakeScene(): { scene: Group; material: MeshStandardMaterial } {
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(new BufferGeometry(), material);
  const scene = new Group();
  scene.add(mesh);
  return { scene, material };
}

let fakeScene = buildFakeScene();

/** The loader surface the extendLoader contract touches. */
interface LoaderLike {
  setMeshoptDecoder: (decoder: unknown) => unknown;
}
type UseGLTFSignature = (
  path: string,
  useDraco?: boolean,
  useMeshopt?: boolean,
  extendLoader?: (loader: LoaderLike) => void,
) => { scene: Group };

const useGLTFMock = vi.fn<UseGLTFSignature>(() => ({ scene: fakeScene.scene }));
vi.mock("@react-three/drei", () => ({ useGLTF: useGLTFMock }));

const fakeDecoder = { ready: Promise.resolve(), supported: true };
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: fakeDecoder,
}));

// Passthrough spies on the shared structural repairs — real behaviour, spied
// call-count/args/order. Both degrade to a no-op on the fake mesh's
// non-indexed geometry (their own defensive "mocked scenes in tests" guards),
// so wrapping the real implementation costs nothing and proves the real
// functions are actually invoked, in the actually-correct order.
const applyCapsSpy = vi.hoisted(() =>
  vi.fn<(root: unknown, rule: unknown, world: unknown) => void>(),
);
vi.mock("../../../../twin/dollhouse-peel.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../../twin/dollhouse-peel.js")>();
  const applyDollhouseCaps: typeof original.applyDollhouseCaps = (root, rule, world) => {
    applyCapsSpy(root, rule, world);
    return original.applyDollhouseCaps(root, rule, world);
  };
  return { ...original, applyDollhouseCaps };
});

const pruneShellSpy = vi.hoisted(() => vi.fn<(root: unknown) => void>());
vi.mock("../../../../twin/dollhouse-shell.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../../twin/dollhouse-shell.js")>();
  const pruneDollhouseShell: typeof original.pruneDollhouseShell = (root, thresholds) => {
    pruneShellSpy(root);
    return original.pruneDollhouseShell(root, thresholds);
  };
  return { ...original, pruneDollhouseShell };
});

type FakeManifestState =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly retry: () => void }
  | { readonly state: "ready"; readonly manifest: TwinManifest };

let manifestState: FakeManifestState = { state: "loading" };
vi.mock("../../../../twin/useTwinManifest.js", () => ({
  useTwinManifest: () => manifestState,
  twinAssetBase: () => "/twin",
}));

const { HallHandoff, HANDOFF_FADE_SPRING, tradesHallMeshUrl } =
  await import("../HallHandoff.js");

// Module-scoped for the whole file (no test here wants the real
// console.warn) — created once via `const` so its concrete overload type is
// inferred rather than annotated (`ReturnType<typeof vi.spyOn>` collapses to
// `any` on the overloaded signature).
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeEach(() => {
  fakeScene = buildFakeScene();
  manifestState = { state: "loading" };
  invalidate.mockClear();
  frameCallbacks.length = 0;
  useGLTFMock.mockClear();
  applyCapsSpy.mockClear();
  pruneShellSpy.mockClear();
  warnSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("HallHandoff — manifest gating", () => {
  it("renders nothing and never touches useGLTF while the manifest is loading", () => {
    manifestState = { state: "loading" };
    const { container } = render(<HallHandoff />);
    expect(container.firstChild).toBeNull();
    expect(useGLTFMock).not.toHaveBeenCalled();
  });

  it("renders nothing and warns exactly once (not per render) on manifest error", () => {
    manifestState = { state: "error", retry: vi.fn() };
    const { container, rerender } = render(<HallHandoff />);
    rerender(<HallHandoff />);
    rerender(<HallHandoff />);
    expect(container.firstChild).toBeNull();
    expect(useGLTFMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the manifest is ready but carries no mesh (schema allows mesh-less bundles)", () => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST_NO_MESH };
    const { container } = render(<HallHandoff />);
    expect(container.firstChild).toBeNull();
    expect(useGLTFMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("HallHandoff — mesh load", () => {
  beforeEach(() => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
  });

  it("loads the GLB via useGLTF with draco+meshopt enabled and an extendLoader, at the trades-hall URL", () => {
    render(<HallHandoff />);
    expect(useGLTFMock).toHaveBeenCalledTimes(1);
    const [url, useDraco, useMeshopt, extendLoader] = useGLTFMock.mock.calls[0] ?? [];
    expect(url).toBe("/twin/trades-hall/mesh/dollhouse.glb");
    expect(useDraco).toBe(true);
    expect(useMeshopt).toBe(true);
    const setMeshoptDecoder = vi.fn();
    expect(extendLoader).toBeDefined();
    extendLoader?.({ setMeshoptDecoder });
    expect(setMeshoptDecoder).toHaveBeenCalledWith(fakeDecoder);
  });

  it("runs prune BEFORE caps, on the shared cached scene, exactly once per load — not per render", () => {
    const { rerender } = render(<HallHandoff />);
    rerender(<HallHandoff />);
    rerender(<HallHandoff />);

    expect(pruneShellSpy).toHaveBeenCalledTimes(1);
    expect(applyCapsSpy).toHaveBeenCalledTimes(1);
    expect(pruneShellSpy.mock.calls[0]?.[0]).toBe(fakeScene.scene);

    const [capsRoot, capsRule, capsWorld] = applyCapsSpy.mock.calls[0] ?? [];
    expect(capsRoot).toBe(fakeScene.scene);
    expect(capsRule).toBeUndefined(); // default trades-hall rule
    expect(capsWorld).toBeInstanceOf(Matrix4); // meshRootWorldMatrix(), explicit

    // Order matters (DollhouseStage.tsx's own comment: "the prune rewrites
    // the index the split then partitions") — prune's call must precede
    // caps's, not just both happen once.
    const pruneOrder = pruneShellSpy.mock.invocationCallOrder[0];
    const capsOrder = applyCapsSpy.mock.invocationCallOrder[0];
    expect(pruneOrder).toBeDefined();
    expect(capsOrder).toBeDefined();
    expect(pruneOrder as number).toBeLessThan(capsOrder as number);
  });

  it("never mutates the source material useGLTF would hand to any other consumer", () => {
    render(<HallHandoff />);
    const onFrame = frameCallbacks[0];
    for (let i = 0; i < 30; i += 1) {
      onFrame?.(undefined, 0.25);
    }
    // The fade only ever touches the CLONE; the cached original must still
    // read at its untouched three.js defaults regardless of how far the
    // fade this mount is driving has progressed.
    expect(fakeScene.material.opacity).toBe(1);
    expect(fakeScene.material.transparent).toBe(false);
  });

  it("ramps opacity toward 1 while fading, then settles opaque and stops invalidating", () => {
    const cloneSpy = vi.spyOn(Material.prototype, "clone");
    render(<HallHandoff />);
    const clone = cloneSpy.mock.results[0]?.value as MeshStandardMaterial;
    expect(clone).toBeInstanceOf(MeshStandardMaterial);
    expect(clone).not.toBe(fakeScene.material);

    const onFrame = frameCallbacks[0];
    expect(onFrame).toBeDefined();

    // One small step: mid-fade, not yet settled.
    onFrame?.(undefined, 0.05);
    expect(clone.transparent).toBe(true);
    expect(clone.opacity).toBeGreaterThan(0);
    expect(clone.opacity).toBeLessThan(1);
    expect(invalidate).toHaveBeenCalled();
    const midFadeInvalidateCount = invalidate.mock.calls.length;

    // Many more steps — comfortably past this spring's settling time —
    // (stepSpring clamps each call to at most 0.25s of simulated time, so
    // 30 * 0.25s = 7.5s simulated settles a stiffness:60/damping:14 spring
    // many times over).
    for (let i = 0; i < 30; i += 1) {
      onFrame?.(undefined, 0.25);
    }
    expect(clone.opacity).toBe(1);
    expect(clone.transparent).toBe(false);

    // Stopped invalidating once settled: one further frame adds nothing.
    const settledInvalidateCount = invalidate.mock.calls.length;
    expect(settledInvalidateCount).toBeGreaterThan(midFadeInvalidateCount);
    onFrame?.(undefined, 0.25);
    expect(invalidate.mock.calls.length).toBe(settledInvalidateCount);

    cloneSpy.mockRestore();
  });
});

describe("HallHandoff — fade spring tuning", () => {
  it("exports the tuned fade spring config", () => {
    expect(HANDOFF_FADE_SPRING).toEqual({ stiffness: 60, damping: 14 });
  });
});

describe("tradesHallMeshUrl", () => {
  it("builds the mesh URL from the trades-hall slug, never the manifest's own venueSlug", () => {
    expect(tradesHallMeshUrl(TWIN_FIXTURE_MANIFEST)).toBe(
      "/twin/trades-hall/mesh/dollhouse.glb",
    );
  });

  it("returns null when the manifest carries no mesh", () => {
    expect(tradesHallMeshUrl(TWIN_FIXTURE_MANIFEST_NO_MESH)).toBeNull();
  });
});
