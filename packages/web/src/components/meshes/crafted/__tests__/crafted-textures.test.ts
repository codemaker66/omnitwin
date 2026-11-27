import type { DataTexture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRAFTED_TEXTURE_IDS,
  craftedTextureFormat,
  isCraftedTextureId,
  paintCraftedTexture,
  type CraftedTextureId,
  type CraftedTexturePaintAnswer,
  type CraftedTexturePaintRequest,
} from "../crafted-texture-recipes.js";
import {
  craftedTexture,
  craftedTexturesPending,
  FIRST_ANSWER_MS,
  onCraftedTexturePainted,
  setCraftedTexturePainter,
  workerPainter,
  type CraftedTexturePainter,
} from "../crafted-textures.js";

/** Maps the painter is sent; the felt and the feet's shade are painted in place. */
const SENT = CRAFTED_TEXTURE_IDS.filter((id) => craftedTextureFormat(id).size > 64);

/** A module worker that answers as crafted-texture.worker.ts does, when the test says. */
class FakePainterWorker {
  static started: FakePainterWorker[] = [];
  onmessage: ((event: MessageEvent<CraftedTexturePaintAnswer>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  readonly requests: CraftedTexturePaintRequest[] = [];

  constructor(url: string | URL, options?: WorkerOptions) {
    // Reading the type is how a browser that runs module workers shows it.
    if (options?.type !== "module") throw new Error("expected a module worker");
    if (String(url) !== "blob://") FakePainterWorker.started.push(this);
  }

  postMessage(request: CraftedTexturePaintRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the oldest request, as the worker would unless `answer` says otherwise. */
  answer(answer: (request: CraftedTexturePaintRequest) => CraftedTexturePaintAnswer = painted): void {
    const request = this.requests.shift();
    if (request === undefined) throw new Error("nothing to answer");
    this.onmessage?.(new MessageEvent("message", { data: answer(request) }));
  }
}

function painted(request: CraftedTexturePaintRequest): CraftedTexturePaintAnswer {
  return { id: request.id, ok: true, pixels: paintCraftedTexture(request.texture).buffer };
}

function onlyWorker(): FakePainterWorker {
  const [worker, ...others] = FakePainterWorker.started;
  if (worker === undefined || others.length > 0) throw new Error(`expected one painter worker, found ${String(FakePainterWorker.started.length)}`);
  return worker;
}

/** A painter whose answers the test gives, in its own time. */
function heldPainter(): CraftedTexturePainter & {
  readonly asked: CraftedTextureId[];
  answer(id: CraftedTextureId, pixels?: Uint8Array<ArrayBuffer>): void;
  fail(id: CraftedTextureId): void;
} {
  const asked: CraftedTextureId[] = [];
  const held = new Map<CraftedTextureId, { resolve: (pixels: Uint8Array<ArrayBuffer>) => void; reject: (reason: Error) => void }>();
  return {
    asked,
    paint(id) {
      asked.push(id);
      return new Promise((resolve, reject) => { held.set(id, { resolve, reject }); });
    },
    dispose() { held.clear(); },
    answer(id, pixels) { held.get(id)?.resolve(pixels ?? paintCraftedTexture(id)); },
    fail(id) { held.get(id)?.reject(new Error("painter failed")); },
  };
}

function pixelsOf(texture: DataTexture): Uint8Array {
  const data = texture.image.data;
  if (!(data instanceof Uint8Array)) throw new Error("expected RGBA bytes");
  return data;
}

/** Lets the painter's settled promises run their handlers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

afterEach(() => {
  setCraftedTexturePainter(null);
  vi.unstubAllGlobals();
  FakePainterWorker.started = [];
});

/** An sRGB byte in linear light. */
function toLinear(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear light as an sRGB byte, unrounded. */
function toSrgb(linear: number): number {
  return 255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);
}

describe("crafted texture recipes", () => {
  it.each(CRAFTED_TEXTURE_IDS)("paints %s at the size it declares, resting where its painting settles", (id) => {
    const { size, colour, rest } = craftedTextureFormat(id);
    const pixels = paintCraftedTexture(id);
    expect(pixels.length).toBe(size * size * 4);
    // The worker transfers the whole buffer, which the page checks against the map's size.
    expect(pixels.byteOffset).toBe(0);
    expect(pixels.buffer.byteLength).toBe(size * size * 4);
    expect(isCraftedTextureId(id)).toBe(true);
    // A normal map rests level; any other at its mean, in linear light for
    // colour, so the moment it is painted shows detail arriving, not a new tone.
    if (id.endsWith("-normal")) {
      expect(rest).toEqual([128, 128, 255, 255]);
      return;
    }
    [0, 1, 2, 3].forEach((channel) => {
      const linear = colour && channel < 3;
      let sum = 0;
      for (let i = channel; i < pixels.length; i += 4) {
        const byte = pixels[i] ?? 0;
        sum += linear ? toLinear(byte) : byte;
      }
      const mean = linear ? toSrgb(sum / (size * size)) : sum / (size * size);
      expect(Math.abs(mean - (rest[channel] ?? 0))).toBeLessThanOrEqual(1);
    });
  });

  it("knows its own maps and nothing else", () => {
    expect(isCraftedTextureId("damask-colour")).toBe(true);
    expect(isCraftedTextureId("toString")).toBe(false);
    expect(isCraftedTextureId(7)).toBe(false);
  });
});

describe("crafted textures", () => {
  it("paints a map where it is asked for when no worker can", () => {
    setCraftedTexturePainter(() => null);
    const texture = craftedTexture("damask-colour") as DataTexture;
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("damask-colour")));
    expect(craftedTexturesPending()).toBe(0);
  });

  it("makes a map at once at its full size, at rest, and fills the same texture when its pixels come", async () => {
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    const texture = craftedTexture("damask-colour") as DataTexture;
    const { size, rest } = craftedTextureFormat("damask-colour");
    expect(texture.image.width).toBe(size);
    expect(texture.image.height).toBe(size);
    const resting = pixelsOf(texture);
    for (let i = 0; i < resting.length; i += 4) {
      if (resting[i] !== rest[0] || resting[i + 1] !== rest[1] || resting[i + 2] !== rest[2] || resting[i + 3] !== rest[3]) {
        throw new Error(`texel ${String(i / 4)} is not at rest`);
      }
    }
    const version = texture.version;
    painter.answer("damask-colour");
    await settle();
    expect(craftedTexture("damask-colour")).toBe(texture);
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("damask-colour")));
    expect(texture.version).toBeGreaterThan(version);
  });

  it("asks first for the maps the pieces built in one pass want, then every other large map, and paints the small ones in place", async () => {
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    craftedTexture("parquet-colour");
    craftedTexture("brass-lattice");
    // The rest follow once this pass is done, behind these two.
    expect(painter.asked).toEqual(["parquet-colour", "brass-lattice"]);
    await settle();
    expect(painter.asked.slice(0, 2)).toEqual(["parquet-colour", "brass-lattice"]);
    expect([...painter.asked].sort()).toEqual([...SENT].sort());
    expect(craftedTexturesPending()).toBe(SENT.length);
    // The feet's shade is never left unpainted.
    const spot = craftedTexture("contact-spot") as DataTexture;
    expect(Array.from(pixelsOf(spot))).toEqual(Array.from(paintCraftedTexture("contact-spot")));
  });

  it("paints a map in place when the painter fails it", async () => {
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    const texture = craftedTexture("mahogany-grain") as DataTexture;
    painter.fail("mahogany-grain");
    await settle();
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("mahogany-grain")));
    expect(craftedTexturesPending()).toBe(CRAFTED_TEXTURE_IDS.filter((id) => craftedTextureFormat(id).size > 64).length - 1);
  });

  it("asks a watching canvas for one frame per painted map, however many of its pieces watch", async () => {
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    let frames = 0;
    const invalidate = (): void => { frames += 1; };
    const stopFirst = onCraftedTexturePainted(invalidate);
    const stopSecond = onCraftedTexturePainted(invalidate);
    craftedTexture("damask-colour");
    painter.answer("damask-colour");
    await settle();
    expect(frames).toBe(1);
    // A failed map a piece wants is painted in place, and that too needs a frame.
    craftedTexture("parquet-colour");
    painter.fail("parquet-colour");
    await settle();
    expect(frames).toBe(2);
    // One piece unmounting, even twice over, leaves the other watching.
    stopFirst();
    stopFirst();
    painter.answer("mahogany-grain");
    await settle();
    expect(frames).toBe(3);
    stopSecond();
    painter.answer("check-fabric");
    await settle();
    expect(frames).toBe(3);
  });

  it("leaves a failed map no piece has asked for unpainted until one does", async () => {
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    let frames = 0;
    const stop = onCraftedTexturePainted(() => { frames += 1; });
    try {
      craftedTexture("damask-colour");
      await settle();
      painter.fail("brass-lattice");
      await settle();
      // Not painted on the main thread for nothing, and not waited for either.
      expect(frames).toBe(0);
      expect(craftedTexturesPending()).toBe(SENT.length - 1);
      const lattice = craftedTexture("brass-lattice") as DataTexture;
      expect(Array.from(pixelsOf(lattice))).toEqual(Array.from(paintCraftedTexture("brass-lattice")));
      expect(frames).toBe(1);
    } finally {
      stop();
    }
  });

  it("wakes every watching canvas when one of them throws, and reports it", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const painter = heldPainter();
    setCraftedTexturePainter(() => painter);
    let woken = 0;
    const stopLost = onCraftedTexturePainted(() => { throw new Error("lost canvas"); });
    const stopFine = onCraftedTexturePainted(() => { woken += 1; });
    try {
      craftedTexture("damask-colour");
      painter.answer("damask-colour");
      await settle();
      expect(woken).toBe(1);
      expect(reported).toHaveBeenCalledTimes(1);
      expect(String(reported.mock.calls[0]?.[0])).toContain("lost canvas");
    } finally {
      stopLost();
      stopFine();
    }
  });

  it("uses no worker in this test environment, so the maps are painted as before", () => {
    // happy-dom has no Worker: the default painter declines and the maps are painted in place.
    const texture = craftedTexture("check-fabric") as DataTexture;
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("check-fabric")));
    expect(craftedTexturesPending()).toBe(0);
  });
});

/** An answer the real recipes could not have given: every byte 7. */
function marked(request: CraftedTexturePaintRequest): CraftedTexturePaintAnswer {
  const { size } = craftedTextureFormat(request.texture);
  return { id: request.id, ok: true, pixels: new Uint8Array(size * size * 4).fill(7).buffer };
}

function sentTexture(worker: FakePainterWorker, index: number): DataTexture {
  const id = worker.requests[index]?.texture;
  if (id === undefined) throw new Error(`no request ${String(index)}`);
  return craftedTexture(id) as DataTexture;
}

describe("the worker painter", () => {
  it("fills each map with the worker's own pixels, the wanted one first, then closes the worker", async () => {
    vi.stubGlobal("Worker", FakePainterWorker);
    const texture = craftedTexture("damask-colour") as DataTexture;
    await settle();
    const worker = onlyWorker();
    expect(worker.requests.map((request) => request.texture)).toEqual(["damask-colour", ...SENT.filter((id) => id !== "damask-colour")]);
    while (worker.requests.length > 1) worker.answer(marked);
    await settle();
    // Not closed while a map is still out.
    expect(worker.terminated).toBe(false);
    worker.answer(marked);
    await settle();
    expect(craftedTexturesPending()).toBe(0);
    expect(pixelsOf(texture).every((byte) => byte === 7)).toBe(true);
    // Nothing is left to paint: its thread and heap are let go.
    expect(worker.terminated).toBe(true);
  });

  it("paints a map in place when its answer is refused or the wrong size, and keeps the others' answers", async () => {
    vi.stubGlobal("Worker", FakePainterWorker);
    craftedTexture("damask-colour");
    await settle();
    const worker = onlyWorker();
    const [short, refused, kept] = [0, 1, 2].map((index) => sentTexture(worker, index));
    if (short === undefined || refused === undefined || kept === undefined) throw new Error("expected three maps sent");
    worker.answer((request) => ({ id: request.id, ok: true, pixels: new ArrayBuffer(16) }));
    worker.answer((request) => ({ id: request.id, ok: false, error: "out of memory" }));
    worker.answer(marked);
    await settle();
    for (const texture of [short, refused]) {
      const id = texture.name.slice("crafted:".length);
      if (!isCraftedTextureId(id)) throw new Error(`unexpected name ${texture.name}`);
      expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture(id)));
    }
    expect(pixelsOf(kept).every((byte) => byte === 7)).toBe(true);
    expect(craftedTexturesPending()).toBe(SENT.length - 3);
  });

  it("paints every waiting map in place when the worker dies, and sends it nothing more", async () => {
    vi.stubGlobal("Worker", FakePainterWorker);
    const texture = craftedTexture("parquet-colour") as DataTexture;
    const worker = onlyWorker();
    worker.onerror?.(new Event("error"));
    await settle();
    expect(worker.terminated).toBe(true);
    expect(craftedTexturesPending()).toBe(0);
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("parquet-colour")));
  });

  it("refuses at once after its worker dies, and starts a closed worker again when asked", async () => {
    vi.stubGlobal("Worker", FakePainterWorker);
    const drained = workerPainter();
    if (drained === null) throw new Error("expected a painter where module workers run");
    const first = drained.paint("linen-normal");
    onlyWorker().answer();
    await expect(first).resolves.toHaveLength(craftedTextureFormat("linen-normal").size ** 2 * 4);
    expect(FakePainterWorker.started[0]?.terminated).toBe(true);
    const second = drained.paint("velvet-normal");
    expect(FakePainterWorker.started).toHaveLength(2);
    FakePainterWorker.started[1]?.answer();
    await expect(second).resolves.toHaveLength(craftedTextureFormat("velvet-normal").size ** 2 * 4);

    FakePainterWorker.started = [];
    const dying = workerPainter();
    if (dying === null) throw new Error("expected a painter where module workers run");
    const waiting = dying.paint("mahogany-grain");
    onlyWorker().onerror?.(new Event("error"));
    await expect(waiting).rejects.toThrow("stopped");
    await expect(dying.paint("plywood-grain")).rejects.toThrow("has stopped");
    expect(FakePainterWorker.started).toHaveLength(1);
  });

  it("paints in place when the browser refuses the worker outright", async () => {
    class RefusedWorker extends FakePainterWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url) !== "blob://") throw new Error("A script from another origin");
      }
    }
    vi.stubGlobal("Worker", RefusedWorker);
    const texture = craftedTexture("damask-colour") as DataTexture;
    await settle();
    expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("damask-colour")));
    expect(craftedTexturesPending()).toBe(0);
  });

  it("gives up on a worker that has not answered in time and paints in place", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("Worker", FakePainterWorker);
      const texture = craftedTexture("damask-colour") as DataTexture;
      await settle();
      const worker = onlyWorker();
      vi.advanceTimersByTime(FIRST_ANSWER_MS - 1);
      await settle();
      expect(worker.terminated).toBe(false);
      vi.advanceTimersByTime(1);
      await settle();
      expect(worker.terminated).toBe(true);
      expect(Array.from(pixelsOf(texture))).toEqual(Array.from(paintCraftedTexture("damask-colour")));
      expect(craftedTexturesPending()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a worker that has answered, however long the rest take", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("Worker", FakePainterWorker);
      craftedTexture("damask-colour");
      await settle();
      const worker = onlyWorker();
      worker.answer(marked);
      vi.advanceTimersByTime(FIRST_ANSWER_MS * 3);
      await settle();
      expect(worker.terminated).toBe(false);
      expect(craftedTexturesPending()).toBe(SENT.length - 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the painting worker's script", () => {
  it("answers a map with its pixels, the buffer transferred, and refuses what is not a map", async () => {
    const posted: { message: CraftedTexturePaintAnswer; transfer: Transferable[] | undefined }[] = [];
    // What arrives is whatever the page sent, checked by the worker itself.
    const scope: {
      onmessage: ((event: MessageEvent<unknown>) => void) | null;
      postMessage: (message: CraftedTexturePaintAnswer, transfer?: Transferable[]) => void;
    } = {
      onmessage: null,
      postMessage: (message, transfer) => { posted.push({ message, transfer }); },
    };
    vi.stubGlobal("self", scope);
    await import("../crafted-texture.worker.js");
    scope.onmessage?.(new MessageEvent("message", { data: { id: 4, texture: "linen-normal" } }));
    scope.onmessage?.(new MessageEvent("message", { data: { id: 5, texture: "toString" } }));
    const [painted, refused] = posted;
    if (painted?.message.ok !== true) throw new Error("expected the linen painted");
    expect(painted.message.id).toBe(4);
    expect(Array.from(new Uint8Array(painted.message.pixels))).toEqual(Array.from(paintCraftedTexture("linen-normal")));
    expect(painted.transfer).toEqual([painted.message.pixels]);
    expect(refused?.message).toEqual({ id: 5, ok: false, error: "Not a crafted texture: toString" });
  });
});
