import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import {
  CRAFTED_TEXTURE_IDS,
  craftedTextureFormat,
  paintCraftedTexture,
  type CraftedTextureId,
  type CraftedTexturePaintAnswer,
  type CraftedTexturePaintRequest,
  type Texel,
} from "./crafted-texture-recipes.js";

export { damaskFigure, damaskFigureField, type CraftedTextureId } from "./crafted-texture-recipes.js";

// ---------------------------------------------------------------------------
// Crafted furniture textures
//
// The maps the crafted pieces wear (crafted-texture-recipes.ts paints them),
// made once per page and shared by every crafted model; materials reference
// them and never dispose them. Every map carries a stable semantic name, which
// the instancing harvest uses to batch identical materials across items.
//
// Painting the larger maps takes the CPU a while (the damask's two 512 px maps
// about 80 ms on a desktop, several times that on a phone), so a worker paints
// them (crafted-texture.worker.ts). A map is made at once at its full size and
// format, showing its rest (its level or its mean), and takes its pixels when
// they arrive: the same GPU texture, uploaded again, so nothing is reallocated
// and no pipeline changes. The planner draws on demand, so every canvas
// showing a crafted piece is asked for a frame then (CraftedFurniture watches
// for it). The maps the pieces built in one pass ask for go first; every other
// map follows, so a piece picked later finds its own painted. Where module
// workers do not run, or the worker cannot start, never answers or fails, a
// map is painted where it is asked for, as before, and one no piece has asked
// for waits until one does.
//
// Geometry UVs are in metres (crafted-geometry.ts), so each map's repeat is
// its real tile size and one map serves every part at the same texel density.
// ---------------------------------------------------------------------------

/** Paints maps off the main thread. */
export interface CraftedTexturePainter {
  paint(id: CraftedTextureId): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}

/**
 * Maps this small are always painted where they are asked for: cheaper than
 * the round trip, and the feet's shade (the contact spot) never shows unpainted.
 */
const PAINTED_IN_PLACE = 64;

/**
 * How long a worker that has not answered yet is waited for, milliseconds: its
 * script may have stalled on a poor connection, and the maps are then painted
 * in place. A first answer takes well under a second even on a phone.
 */
export const FIRST_ANSWER_MS = 10_000;

/**
 * Whether `new Worker(url, { type: "module" })` is understood: a browser that
 * reads the option reads its `type` (hall-detail.ts asks the same; the
 * throwaway worker is terminated at once, or its URL refused, harmlessly).
 */
function moduleWorkers(): boolean {
  let read = false;
  const probe: WorkerOptions = { get type(): WorkerType { read = true; return "module"; } };
  try {
    new Worker("blob://", probe).terminate();
  } catch {
    // The URL is refused; the option was still read where module workers exist.
  }
  return read;
}

/**
 * The painting worker, started on the first map and closed once every map
 * sent it is in (its thread and its heap let go; a later map starts it
 * again); null where module workers do not run. If it cannot start, has not
 * answered within FIRST_ANSWER_MS, or dies, every waiting map is rejected (and
 * so painted in place) and no later map waits on it.
 */
export function workerPainter(): CraftedTexturePainter | null {
  if (typeof Worker === "undefined" || !moduleWorkers()) return null;
  let worker: Worker | null = null;
  let broken = false;
  let next = 1;
  const waiting = new Map<number, {
    readonly bytes: number;
    readonly resolve: (pixels: Uint8Array<ArrayBuffer>) => void;
    readonly reject: (reason: Error) => void;
  }>();
  const failAll = (reason: Error): void => {
    for (const entry of waiting.values()) entry.reject(reason);
    waiting.clear();
  };
  const stop = (reason: Error): void => {
    broken = true;
    worker?.terminate();
    worker = null;
    failAll(reason);
  };
  const start = (): Worker => {
    const created = new Worker(new URL("./crafted-texture.worker.ts", import.meta.url), { type: "module" });
    let heard = false;
    setTimeout(() => {
      if (!heard && worker === created) stop(new Error("The crafted texture painter did not answer"));
    }, FIRST_ANSWER_MS);
    created.onmessage = (event: MessageEvent<CraftedTexturePaintAnswer>) => {
      heard = true;
      const answer = event.data;
      const entry = waiting.get(answer.id);
      if (entry === undefined) return;
      waiting.delete(answer.id);
      if (!answer.ok) entry.reject(new Error(answer.error));
      else if (answer.pixels.byteLength !== entry.bytes) entry.reject(new Error("A crafted texture came back at the wrong size"));
      else entry.resolve(new Uint8Array(answer.pixels));
      if (waiting.size === 0 && worker === created) {
        created.terminate();
        worker = null;
      }
    };
    created.onerror = () => { stop(new Error("The crafted texture painter stopped")); };
    created.onmessageerror = () => { stop(new Error("The crafted texture painter could not read a message")); };
    return created;
  };
  return {
    paint(id) {
      if (broken) return Promise.reject(new Error("The crafted texture painter has stopped"));
      if (worker === null) {
        try {
          worker = start();
        } catch (error) {
          // Refused outright (a script from another origin, a sandboxed frame): painted in place from here on.
          const reason = error instanceof Error ? error : new Error(String(error));
          stop(reason);
          return Promise.reject(reason);
        }
      }
      const running = worker;
      const request: CraftedTexturePaintRequest = { id: next, texture: id };
      next += 1;
      const { size } = craftedTextureFormat(id);
      return new Promise((resolve, reject) => {
        waiting.set(request.id, { bytes: size * size * 4, resolve, reject });
        running.postMessage(request);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      failAll(new Error("The crafted texture painter was closed"));
    },
  };
}

let painterFactory: () => CraftedTexturePainter | null = workerPainter;
/** The painter in use: undefined until the first map, null where maps are painted in place. */
let painter: CraftedTexturePainter | null | undefined;
const cache = new Map<CraftedTextureId, DataTexture>();
/** Maps asked of the painter and not yet painted. */
const unpainted = new Set<CraftedTextureId>();
/** Maps a piece has asked for; the others were only sent ahead of need. */
const asked = new Set<CraftedTextureId>();
/** Maps the painter failed before any piece asked for them: painted in place when one does. */
const deferred = new Set<CraftedTextureId>();
/** What to call when painted pixels arrive, with how many pieces watch through each. */
const watchers = new Map<() => void, number>();
/** Counts the times every map was forgotten (tests): an answer to a map from before is ignored. */
let generation = 0;

/** Reports what should not happen without stopping what called it: the page's error handling sees it. */
function report(error: unknown): void {
  globalThis.reportError(error instanceof Error ? error : new Error(String(error)));
}

/**
 * Calls `wake` whenever a map's painted pixels are copied in, so a canvas that
 * draws on demand draws them; answers the call that stops it. A canvas's
 * pieces all pass its one `invalidate`, which is called once per map however
 * many of them are watching.
 */
export function onCraftedTexturePainted(wake: () => void): () => void {
  watchers.set(wake, (watchers.get(wake) ?? 0) + 1);
  let watching = true;
  return () => {
    if (!watching) return;
    watching = false;
    const left = (watchers.get(wake) ?? 1) - 1;
    if (left > 0) watchers.set(wake, left);
    else watchers.delete(wake);
  };
}

/** A map's pixels at rest: one texel throughout. */
function restPixels(size: number, rest: Texel): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(size * size * 4);
  pixels.set(rest, 0);
  for (let filled = 4; filled < pixels.length; filled *= 2) pixels.copyWithin(filled, 0, Math.min(filled, pixels.length - filled));
  return pixels;
}

function makeTexture(id: CraftedTextureId, pixels: Uint8Array<ArrayBuffer>): DataTexture {
  const { size, tileMetres, colour } = craftedTextureFormat(id);
  const texture = new DataTexture(pixels, size, size);
  texture.name = `crafted:${id}`;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / tileMetres, 1 / tileMetres);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  texture.needsUpdate = true;
  cache.set(id, texture);
  return texture;
}

/** Gives a map its painted pixels, for the renderer to upload again, and asks every watching canvas for a frame. */
function fill(texture: DataTexture, pixels: Uint8Array<ArrayBuffer>): void {
  texture.image.data = pixels;
  texture.needsUpdate = true;
  for (const wake of watchers.keys()) {
    try {
      wake();
    } catch (error) {
      // One canvas failing to wake must not keep the map from the others.
      report(error);
    }
  }
}

function prepare(id: CraftedTextureId): DataTexture {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const { size, rest } = craftedTextureFormat(id);
  const active = painter;
  if (active === null || active === undefined || size <= PAINTED_IN_PLACE) return makeTexture(id, paintCraftedTexture(id));
  const texture = makeTexture(id, restPixels(size, rest));
  unpainted.add(id);
  const made = generation;
  active.paint(id)
    .then(
      (pixels) => { if (made === generation) fill(texture, pixels); },
      () => {
        if (made !== generation) return;
        // The painter failed: painted here, as where no worker runs, once a piece wants it.
        if (asked.has(id)) fill(texture, paintCraftedTexture(id));
        else deferred.add(id);
      },
    )
    .catch(report)
    .finally(() => { if (made === generation) unpainted.delete(id); });
  return texture;
}

/** The shared map for a crafted texture id. */
export function craftedTexture(id: CraftedTextureId): Texture {
  asked.add(id);
  const cached = cache.get(id);
  if (cached !== undefined) {
    if (deferred.delete(id)) fill(cached, paintCraftedTexture(id));
    return cached;
  }
  const first = painter === undefined;
  if (first) painter = painterFactory();
  const texture = prepare(id);
  if (first && painter !== null) {
    // Every other map follows, ahead of need, once the pieces built in this
    // pass have asked for theirs, so theirs are painted first.
    const sending = painter;
    queueMicrotask(() => {
      if (painter !== sending) return;
      for (const other of CRAFTED_TEXTURE_IDS) prepare(other);
    });
  }
  return texture;
}

/** Maps asked of the painter and not yet painted: the preview studio waits for none. */
export function craftedTexturesPending(): number {
  return unpainted.size;
}

/**
 * Who paints from here on, forgetting every map made so far: for tests. A
 * factory answering null paints in place; null restores the worker.
 */
export function setCraftedTexturePainter(factory: (() => CraftedTexturePainter | null) | null): void {
  generation += 1;
  painter?.dispose();
  painter = undefined;
  painterFactory = factory ?? workerPainter;
  cache.clear();
  unpainted.clear();
  asked.clear();
  deferred.clear();
}

/** Metres covered by one tile of a crafted texture. */
export function craftedTextureTileMetres(id: CraftedTextureId): number {
  return craftedTextureFormat(id).tileMetres;
}
