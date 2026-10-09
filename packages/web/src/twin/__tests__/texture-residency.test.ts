import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Box2, Texture, Vector2, type Box3, type Vector3 } from "three";
import {
  advanceTextureResidency,
  ensureTextureResident,
  isTextureResident,
  RESIDENCY_SLICE_BYTES,
  RESIDENCY_STRIP_BYTES,
  whenTextureResident,
  type ResidencyRenderer,
} from "../texture-residency.js";

// jsdom has no ImageBitmap; the module streams only real bitmaps, so tests
// install a stand-in class under the global name.
class FakeImageBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close(): void {}
}

/** A WebGL 2 fence surface the test signals by hand. */
class FakeFenceContext {
  readonly SYNC_GPU_COMMANDS_COMPLETE = 0x9117;
  readonly SYNC_STATUS = 0x9114;
  readonly SIGNALED = 0x9119;
  readonly UNSIGNALED = 0x9118;
  lost = false;
  flushes = 0;
  readonly live = new Set<object>();
  readonly signalled = new Set<object>();
  fenceSync(): object {
    const fence = {};
    this.live.add(fence);
    return fence;
  }
  deleteSync(fence: object): void {
    this.live.delete(fence);
  }
  isSync(fence: object): boolean {
    return this.live.has(fence);
  }
  getSyncParameter(fence: object): number {
    return this.signalled.has(fence) ? this.SIGNALED : this.UNSIGNALED;
  }
  flush(): void {
    this.flushes += 1;
  }
  isContextLost(): boolean {
    return this.lost;
  }
  signalAll(): void {
    for (const fence of this.live) this.signalled.add(fence);
  }
}

interface Copy {
  readonly rows: readonly [number, number];
  readonly width: number;
  readonly at: readonly [number, number];
  readonly dst: Texture;
}

function fakeRenderer(context: unknown = new FakeFenceContext()): {
  readonly renderer: ResidencyRenderer;
  readonly init: Mock<(texture: Texture) => void>;
  readonly copies: Copy[];
  readonly dataReadyAtInit: boolean[];
} {
  const copies: Copy[] = [];
  const dataReadyAtInit: boolean[] = [];
  const init = vi.fn<(texture: Texture) => void>((texture) => {
    dataReadyAtInit.push(texture.source.dataReady);
  });
  const renderer: ResidencyRenderer = {
    initTexture: init,
    copyTextureToTexture: (
      _source: Texture,
      dst: Texture,
      region?: Box2 | Box3 | null,
      position?: Vector2 | Vector3 | null,
    ) => {
      if (!(region instanceof Box2) || !(position instanceof Vector2)) {
        throw new Error("expected a 2D region and position");
      }
      copies.push({
        rows: [region.min.y, region.max.y],
        width: region.max.x - region.min.x,
        at: [position.x, position.y],
        dst,
      });
    },
    getContext: () => context,
  };
  return { renderer, init, copies, dataReadyAtInit };
}

function bitmapTexture(width: number, height: number): Texture {
  const texture = new Texture(new FakeImageBitmap(width, height));
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
}

const always = (): boolean => true;
const never = (): boolean => false;

beforeEach(() => {
  vi.stubGlobal("ImageBitmap", FakeImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("texture-residency — what it streams", () => {
  it("uploads a non-bitmap texture whole, once", () => {
    const { renderer, init, copies } = fakeRenderer();
    const texture = new Texture();
    expect(advanceTextureResidency(renderer, texture, always)).toBe(true);
    expect(advanceTextureResidency(renderer, texture, always)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(copies).toEqual([]);
    expect(isTextureResident(renderer, texture)).toBe(true);
  });

  it("uploads a bitmap that fits one step whole", () => {
    const { renderer, init, copies } = fakeRenderer();
    const texture = bitmapTexture(2048, 1024); // exactly RESIDENCY_SLICE_BYTES
    expect(2048 * 1024 * 4).toBe(RESIDENCY_SLICE_BYTES);
    expect(advanceTextureResidency(renderer, texture, always)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(copies).toEqual([]);
  });

  it.each([
    ["flipped", (texture: Texture) => { texture.flipY = true; }],
    ["mipmapped", (texture: Texture) => { texture.generateMipmaps = true; }],
  ])("uploads a %s bitmap whole rather than in strips", (_label, mutate) => {
    const { renderer, init, copies, dataReadyAtInit } = fakeRenderer();
    const texture = bitmapTexture(4096, 2048);
    mutate(texture);
    expect(advanceTextureResidency(renderer, texture, always)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(dataReadyAtInit).toEqual([true]);
    expect(copies).toEqual([]);
  });
});

describe("texture-residency — streaming a 4096x2048 base", () => {
  it("allocates without data, then copies 2 MiB strips, 8 MiB per step", () => {
    const { renderer, init, copies, dataReadyAtInit } = fakeRenderer();
    const texture = bitmapTexture(4096, 2048);
    expect(advanceTextureResidency(renderer, texture, always)).toBe(false);
    expect(init).toHaveBeenCalledTimes(1);
    expect(dataReadyAtInit).toEqual([false]);
    expect(texture.source.dataReady).toBe(true); // restored for a later full upload
    expect(RESIDENCY_STRIP_BYTES / (4096 * 4)).toBe(128);
    expect(copies.map((copy) => copy.rows)).toEqual([
      [0, 128],
      [128, 256],
      [256, 384],
      [384, 512],
    ]);
    expect(copies.every((copy) => copy.width === 4096 && copy.dst === texture)).toBe(true);
    expect(copies.map((copy) => copy.at)).toEqual([
      [0, 0],
      [0, 128],
      [0, 256],
      [0, 384],
    ]);
    expect(isTextureResident(renderer, texture)).toBe(false);
  });

  it("waits for the GPU fence between steps", () => {
    const context = new FakeFenceContext();
    const { renderer, copies } = fakeRenderer(context);
    const texture = bitmapTexture(4096, 2048);
    advanceTextureResidency(renderer, texture, always);
    expect(context.live.size).toBe(1);
    expect(context.flushes).toBe(1);
    expect(advanceTextureResidency(renderer, texture, always)).toBe(false);
    expect(copies).toHaveLength(4); // nothing sent while the fence is pending
    context.signalAll();
    expect(advanceTextureResidency(renderer, texture, always)).toBe(false);
    expect(copies).toHaveLength(8);
    expect(context.live.size).toBe(1); // the spent fence was deleted
  });

  it("covers every row exactly once and then reports resident", () => {
    const context = new FakeFenceContext();
    const { renderer, init, copies } = fakeRenderer(context);
    const texture = bitmapTexture(4096, 2048);
    let steps = 1;
    while (!advanceTextureResidency(renderer, texture, always)) {
      context.signalAll();
      steps += 1;
    }
    expect(steps).toBe(4); // 32 MiB in four 8 MiB steps
    expect(copies).toHaveLength(16);
    let next = 0;
    for (const copy of copies) {
      expect(copy.rows[0]).toBe(next);
      next = copy.rows[1];
    }
    expect(next).toBe(2048);
    expect(init).toHaveBeenCalledTimes(1);
    expect(isTextureResident(renderer, texture)).toBe(true);
    expect(context.live.size).toBe(0);
  });

  it("sends a single strip when the slice has no time to spare", () => {
    const { renderer, copies } = fakeRenderer();
    advanceTextureResidency(renderer, bitmapTexture(4096, 2048), never);
    expect(copies).toHaveLength(1);
  });

  it("halves the strip height for the 8192 zoom tier", () => {
    const { renderer, copies } = fakeRenderer();
    advanceTextureResidency(renderer, bitmapTexture(8192, 4096), always);
    expect(copies.map((copy) => copy.rows)).toEqual([
      [0, 64],
      [64, 128],
      [128, 192],
      [192, 256],
    ]);
  });

  it("paces by bytes alone where WebGL 2 fences are unavailable", () => {
    const { renderer, copies } = fakeRenderer({});
    const texture = bitmapTexture(4096, 2048);
    advanceTextureResidency(renderer, texture, always);
    advanceTextureResidency(renderer, texture, always);
    expect(copies).toHaveLength(8);
  });

  it("does not wait forever on a fence from a lost context", () => {
    const context = new FakeFenceContext();
    const { renderer, copies } = fakeRenderer(context);
    const texture = bitmapTexture(4096, 2048);
    advanceTextureResidency(renderer, texture, always);
    context.lost = true;
    advanceTextureResidency(renderer, texture, always);
    expect(copies).toHaveLength(8);
  });
});

describe("texture-residency — finishing now, renderers and disposal", () => {
  it("finishes a streamed upload synchronously, ignoring the pending fence", () => {
    const context = new FakeFenceContext();
    const { renderer, init, copies } = fakeRenderer(context);
    const texture = bitmapTexture(4096, 2048);
    advanceTextureResidency(renderer, texture, always);
    ensureTextureResident(renderer, texture);
    expect(copies).toHaveLength(16);
    expect(copies.at(-1)?.rows).toEqual([1920, 2048]);
    expect(init).toHaveBeenCalledTimes(1);
    expect(context.live.size).toBe(0);
    expect(isTextureResident(renderer, texture)).toBe(true);
  });

  it("uploads an unseen texture whole when it must draw now", () => {
    const { renderer, init, copies, dataReadyAtInit } = fakeRenderer();
    const texture = bitmapTexture(4096, 2048);
    ensureTextureResident(renderer, texture);
    ensureTextureResident(renderer, texture);
    expect(init).toHaveBeenCalledTimes(1);
    expect(dataReadyAtInit).toEqual([true]);
    expect(copies).toEqual([]);
  });

  it("does not mark a texture resident when its upload throws", () => {
    const { renderer, init } = fakeRenderer();
    init.mockImplementationOnce(() => {
      throw new Error("GPU out of memory");
    });
    const texture = new Texture();
    expect(() => {
      ensureTextureResident(renderer, texture);
    }).toThrow("GPU out of memory");
    expect(isTextureResident(renderer, texture)).toBe(false);
  });

  it("tracks residency per renderer", () => {
    const first = fakeRenderer();
    const second = fakeRenderer();
    const texture = new Texture();
    ensureTextureResident(first.renderer, texture);
    expect(isTextureResident(first.renderer, texture)).toBe(true);
    expect(isTextureResident(second.renderer, texture)).toBe(false);
  });

  it("forgets a disposed texture and deletes its pending fence", () => {
    const context = new FakeFenceContext();
    const { renderer } = fakeRenderer(context);
    const streamed = bitmapTexture(4096, 2048);
    const whole = new Texture();
    advanceTextureResidency(renderer, streamed, always);
    ensureTextureResident(renderer, whole);
    streamed.dispose();
    whole.dispose();
    expect(context.live.size).toBe(0);
    expect(isTextureResident(renderer, whole)).toBe(false);
  });
});

describe("texture-residency — streaming in idle slices", () => {
  let idle: Map<number, IdleRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    idle = new Map();
    nextId = 0;
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      nextId += 1;
      idle.set(nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelIdleCallback", (id: number) => {
      idle.delete(id);
    });
  });

  function runIdle(timeRemaining = 50): void {
    const callbacks = [...idle.values()];
    idle.clear();
    for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => timeRemaining });
  }

  it("spends one step per idle slice and reports residency once", () => {
    const context = new FakeFenceContext();
    const { renderer, copies } = fakeRenderer(context);
    const texture = bitmapTexture(4096, 2048);
    const onResident = vi.fn();
    const onError = vi.fn();
    whenTextureResident(renderer, texture, onResident, onError);
    expect(copies).toEqual([]); // nothing until the browser is idle
    for (let slice = 0; slice < 4; slice += 1) {
      runIdle();
      context.signalAll();
    }
    expect(copies).toHaveLength(16);
    expect(onResident).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(idle.size).toBe(0);
  });

  it("sends one strip from a slice that is nearly spent", () => {
    const { renderer, copies } = fakeRenderer();
    whenTextureResident(renderer, bitmapTexture(4096, 2048), vi.fn(), vi.fn());
    runIdle(1);
    expect(copies).toHaveLength(1);
  });

  it("stops when cancelled", () => {
    const { renderer, copies } = fakeRenderer();
    const onResident = vi.fn();
    const cancel = whenTextureResident(renderer, bitmapTexture(4096, 2048), onResident, vi.fn());
    runIdle();
    cancel();
    expect(idle.size).toBe(0);
    runIdle();
    expect(copies).toHaveLength(4);
    expect(onResident).not.toHaveBeenCalled();
  });

  it("reports a failed step instead of retrying it", () => {
    const { renderer, init } = fakeRenderer();
    init.mockImplementationOnce(() => {
      throw new Error("GPU out of memory");
    });
    const onResident = vi.fn();
    const onError = vi.fn();
    whenTextureResident(renderer, bitmapTexture(4096, 2048), onResident, onError);
    runIdle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onResident).not.toHaveBeenCalled();
    expect(idle.size).toBe(0);
  });

  it("falls back to zero-delay timeouts without requestIdleCallback", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    try {
      const { renderer, copies } = fakeRenderer({});
      const onResident = vi.fn();
      whenTextureResident(renderer, bitmapTexture(4096, 2048), onResident, vi.fn());
      vi.advanceTimersToNextTimer();
      expect(copies).toHaveLength(1); // one strip per timeout
      vi.runAllTimers();
      expect(copies).toHaveLength(16);
      expect(onResident).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
