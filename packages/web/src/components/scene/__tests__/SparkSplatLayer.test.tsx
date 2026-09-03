import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spark instantiates WASM at import time and cannot load under Node, so the
// two classes this component touches are replaced with recorders. What is
// under test is the plumbing: which options reach the renderer and the mesh.
const spark = vi.hoisted(() => {
  const rendererOptions: Record<string, unknown>[] = [];
  const rendererDisposals: number[] = [];
  const meshOptions: Record<string, unknown>[] = [];
  class SparkRenderer {
    readonly index: number;
    lodSplatScale = 1;
    constructor(options: Record<string, unknown>) {
      this.index = rendererOptions.push(options) - 1;
    }
    dispose(): void {
      rendererDisposals.push(this.index);
    }
  }
  const rendererInstances: SparkRenderer[] = [];
  class SplatMesh {
    numSplats = 0;
    visible = true;
    opacity = 1;
    maxSh = 3;
    position = { set: vi.fn() };
    rotation = { set: vi.fn() };
    scale = { setScalar: vi.fn(), set: vi.fn() };
    readonly initialized: Promise<SplatMesh>;
    constructor(options: Record<string, unknown>) {
      meshOptions.push(options);
      this.initialized = new Promise<SplatMesh>(() => undefined);
    }
    getBoundingBox(): { isEmpty: () => boolean } {
      return { isEmpty: () => true };
    }
    dispose(): void {}
  }
  const meshInstances: SplatMesh[] = [];
  class RecordingSparkRenderer extends SparkRenderer {
    constructor(options: Record<string, unknown>) {
      super(options);
      rendererInstances.push(this);
    }
  }
  class RecordingSplatMesh extends SplatMesh {
    constructor(options: Record<string, unknown>) {
      super(options);
      meshInstances.push(this);
    }
  }
  return {
    rendererOptions,
    rendererDisposals,
    rendererInstances,
    meshOptions,
    meshInstances,
    SparkRenderer: RecordingSparkRenderer,
    SplatMesh: RecordingSplatMesh,
  };
});
vi.mock("@sparkjsdev/spark", () => ({
  SparkRenderer: spark.SparkRenderer,
  SplatMesh: spark.SplatMesh,
}));

const fiber = vi.hoisted(() => {
  const state = { gl: { tag: "webgl-renderer" }, invalidate: vi.fn() };
  return {
    state,
    useThree: (selector: (s: typeof state) => unknown) => selector(state),
    useFrame: vi.fn(),
  };
});
vi.mock("@react-three/fiber", () => ({ useThree: fiber.useThree, useFrame: fiber.useFrame }));

import { SparkSplatLayer } from "../SparkSplatLayer.js";

const URL = "/splats/trades-hall/grand-hall/0_0.sog";

describe("SparkSplatLayer runtime wiring", () => {
  beforeEach(() => {
    spark.rendererOptions.length = 0;
    spark.rendererDisposals.length = 0;
    spark.rendererInstances.length = 0;
    spark.meshOptions.length = 0;
    spark.meshInstances.length = 0;
    fiber.useFrame.mockClear();
    // <primitive> is a fiber element; under a DOM renderer React reports it as
    // an unknown tag, which is noise here, not a finding.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("creates the renderer on the canvas's own WebGL context with Spark's defaults when no runtime is given", () => {
    render(<SparkSplatLayer url={URL} />);

    expect(spark.rendererOptions).toHaveLength(1);
    const options = spark.rendererOptions[0];
    expect(options?.["renderer"]).toBe(fiber.state.gl);
    expect(options?.["onDirty"]).toBe(fiber.state.invalidate);
    expect(options).not.toHaveProperty("minSortIntervalMs");
    expect(options).not.toHaveProperty("maxStdDev");
    expect(options).not.toHaveProperty("lodSplatCount");
    expect(spark.meshOptions[0]).not.toHaveProperty("lod");
  });

  it("hands the runtime's sort interval, tail radius and budget to the renderer, and the tree flag to the mesh", () => {
    render(
      <SparkSplatLayer
        url={URL}
        runtime={{ minSortIntervalMs: 50, maxStdDev: 2.236, lod: true, lodSplatCount: 1_500_000 }}
      />,
    );

    expect(spark.rendererOptions[0]).toMatchObject({
      minSortIntervalMs: 50,
      maxStdDev: 2.236,
      lodSplatCount: 1_500_000,
    });
    expect(spark.meshOptions[0]).toMatchObject({ url: URL, lod: true });
  });

  it("keeps the tree off when the runtime says so", () => {
    render(
      <SparkSplatLayer
        url={URL}
        runtime={{ minSortIntervalMs: 0, maxStdDev: Math.sqrt(8), lod: false, lodSplatCount: 2_500_000 }}
      />,
    );

    expect(spark.meshOptions[0]).toMatchObject({ lod: false });
  });

  it("creates no renderer at all when the host is excluded, whatever the runtime", () => {
    render(
      <SparkSplatLayer
        url={URL}
        includeRendererHost={false}
        runtime={{ minSortIntervalMs: 50, maxStdDev: 2, lod: true, lodSplatCount: 1_000_000 }}
      />,
    );

    expect(spark.rendererOptions).toHaveLength(0);
    expect(spark.meshOptions[0]).toMatchObject({ lod: true });
  });

  it("re-creates the renderer, disposing the old one, when the runtime changes", () => {
    const first = { minSortIntervalMs: 0, maxStdDev: Math.sqrt(8), lod: false, lodSplatCount: 2_500_000 };
    const { rerender } = render(<SparkSplatLayer url={URL} runtime={first} />);
    expect(spark.rendererOptions).toHaveLength(1);

    rerender(<SparkSplatLayer url={URL} runtime={{ ...first, minSortIntervalMs: 100 }} />);

    expect(spark.rendererOptions).toHaveLength(2);
    expect(spark.rendererOptions[1]).toMatchObject({ minSortIntervalMs: 100 });
    expect(spark.rendererDisposals).toEqual([0]);
  });

  it("caps each mesh's spherical harmonics at the runtime's degree, and leaves it alone otherwise", () => {
    render(<SparkSplatLayer url={URL} />);
    expect(spark.meshInstances[0]?.maxSh).toBe(3);

    render(
      <SparkSplatLayer
        url={URL}
        runtime={{ minSortIntervalMs: 0, maxStdDev: Math.sqrt(8), lod: true, lodSplatCount: 2_500_000, maxSh: 1 }}
      />,
    );
    expect(spark.meshInstances[1]?.maxSh).toBe(1);
  });

  /** Runs every callback the component registered with useFrame, as a frame would. */
  function runFrame(): void {
    for (const call of fiber.useFrame.mock.calls) {
      const callback = call[0] as () => void;
      callback();
    }
  }

  it("polls the motion scale each frame and writes it to the renderer only when it changes", () => {
    let scale = 0.4;
    render(<SparkSplatLayer url={URL} lodScaleFn={() => scale} />);
    const renderer = spark.rendererInstances[0];
    expect(renderer?.lodSplatScale).toBe(1);

    runFrame();
    expect(renderer?.lodSplatScale).toBe(0.4);

    scale = 1;
    runFrame();
    expect(renderer?.lodSplatScale).toBe(1);
  });

  it("leaves the renderer's scale untouched when no motion scale is supplied", () => {
    render(<SparkSplatLayer url={URL} />);
    runFrame();
    expect(spark.rendererInstances[0]?.lodSplatScale).toBe(1);
  });

  it("does not re-create the renderer when an equal runtime object is passed again", () => {
    const runtime = { minSortIntervalMs: 33, maxStdDev: 2.236, lod: true, lodSplatCount: 1_500_000 };
    const { rerender } = render(<SparkSplatLayer url={URL} runtime={runtime} />);
    rerender(<SparkSplatLayer url={URL} runtime={{ ...runtime }} />);

    expect(spark.rendererOptions).toHaveLength(1);
    expect(spark.rendererDisposals).toEqual([]);
  });
});
