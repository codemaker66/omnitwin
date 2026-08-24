import { useEffect, useRef, useState } from "react";
import { LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import {
  TWIN_EQUIRECT_LODS,
  twinEquirectPath,
  type TwinEquirectLod,
} from "@omnitwin/types";

// -----------------------------------------------------------------------------
// useEquirectTexture — streams one scan node's world-frame equirect pano into
// a THREE.Texture, preview first. The 512×256 paints the sphere within a few
// tens of KB; the 4096×2048 base swaps in silently once it arrives (the pano
// simply sharpens — no spinner, no pop). With `maxLod` 8192 the supersampled
// zoom tier streams after the base lands and swaps the same way — raising
// maxLod mid-node NEVER resets the live texture (the slot ref below carries
// it across the effect re-run), so zooming sharpens, it never blurs down.
// Textures are disposed on LOD swap, node change and unmount — nothing leaks
// across a walk.
//
// Hop smoothness: where the platform provides createImageBitmap, the full
// pano is decoded OFF the main thread (fetch → blob → bitmap) so the swap
// never hitches the look springs; environments without it (happy-dom, old
// engines) keep the plain Image path unchanged. Pair with useTwinPrefetch,
// which cache-warms neighbour 4096 bases so travel starts from the HTTP
// cache (the 8192 tier is strictly on-demand — never prefetched).
//
// Sampling setup: the PanoStage equirect shader computes u from atan2, so
// wrapS is RepeatWrapping (the winding seam samples continuously) and
// mipmaps are OFF (LinearFilter) — the az branch cut would otherwise smear a
// derivative-picked low mip down one seam column.
// -----------------------------------------------------------------------------

export interface EquirectTextureState {
  readonly texture: Texture | null;
  /** 0 = nothing loaded yet; otherwise the LOD currently applied. */
  readonly lod: 0 | TwinEquirectLod;
}

/** Ceiling of the stream: the 4096 base always; 8192 only on zoom intent. */
export type EquirectMaxLod = 4096 | 8192;

/** Camera fov (degrees) below which a node wants the 8192 zoom tier. */
export const EQUIRECT_ZOOM_FOV_DEG = 50;

/**
 * The zoom-tier gate, pure so the capability × intent table is unit-testable:
 * 8192 requires zoom intent, a GPU whose maxTextureSize can hold the 8192×4096
 * upload, AND a device that can afford the ~134 MB it costs — a low-memory or
 * mobile GPU never requests it (finding [32]). `deviceCanAfford` defaults true
 * so a caller that omits it keeps the capability × intent behaviour.
 */
export function resolveEquirectMaxLod(
  maxTextureSize: number,
  zoomIntent: boolean,
  deviceCanAfford = true,
): EquirectMaxLod {
  return zoomIntent && maxTextureSize >= 8192 && deviceCanAfford ? 8192 : 4096;
}

/**
 * Load one pano image. Resolves null on error; never rejects. Under happy-dom
 * the Image callbacks simply never fire, so the promise stays pending forever
 * — the hook treats that as "still loading" and the effect's cancel flag keeps
 * teardown safe, so tests without real image loading cannot throw.
 */
function loadPanoImage(
  url: string,
  signal: AbortSignal,
): Promise<HTMLImageElement | null> {
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    let settled = false;
    const finish = (result: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const handleAbort = (): void => {
      image.src = "";
      finish(null);
    };
    image.onload = () => {
      finish(image);
    };
    image.onerror = () => {
      finish(null);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    image.src = url;
  });
}

/**
 * Decode a pano off the main thread where possible. `imageOrientation:
 * "flipY"` + `texture.flipY = false` is upload-equivalent to the classic
 * Image path (three flips HTMLImageElement uploads itself) — the shader sees
 * identical texels either way. Returns null on any failure so the caller
 * falls back to the Image path.
 */
async function loadPanoBitmap(
  url: string,
  signal: AbortSignal,
): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function" || typeof fetch !== "function") {
    return null;
  }
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (signal.aborted) return null;
    return await createImageBitmap(blob, { imageOrientation: "flipY" });
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Shared texture registry — the fix for "flash, blur, then we're there".
// One ref-counted texture per (base, node, lod), shared by the sphere stage,
// the parallax stage and the neighbour warmer, so: (a) the GPU holds ONE copy
// per pano; (b) neighbours can be decoded AND uploaded to the GPU at rest
// (warmEquirectBase + renderer.initTexture), so a hop begins with both sides
// already sharp — the "photo loading" phase is gone, not deferred.
// -----------------------------------------------------------------------------

interface RegistryEntry {
  texture: Texture;
  refs: number;
}

interface PendingTextureLoad {
  readonly controller: AbortController;
  promise: Promise<Texture | null>;
  texture: Texture | null;
  waiters: number;
  settled: boolean;
}

const registry = new Map<string, RegistryEntry>();
const registryKey = (base: string, nodeId: string, lod: TwinEquirectLod): string =>
  `${base}|${nodeId}|${String(lod)}`;
/** In-flight loads, so concurrent acquirers await one fetch+decode. */
const pending = new Map<string, PendingTextureLoad>();
const bitmapByTexture = new WeakMap<Texture, ImageBitmap>();
const disposedTextures = new WeakSet<Texture>();

/** Dispose both sides of a bitmap-backed texture exactly once. Three frees
 * the GPU allocation; the browser-owned ImageBitmap must be closed as well. */
function disposeManagedTexture(texture: Texture): void {
  if (disposedTextures.has(texture)) return;
  disposedTextures.add(texture);
  const bitmap = bitmapByTexture.get(texture);
  if (bitmap !== undefined) {
    bitmap.close();
    bitmapByTexture.delete(texture);
  }
  texture.dispose();
}

function cleanupPending(key: string, entry: PendingTextureLoad): void {
  if (!entry.settled || entry.waiters > 0) return;
  if (pending.get(key) === entry) pending.delete(key);
  if (entry.texture !== null) {
    disposeManagedTexture(entry.texture);
    entry.texture = null;
  }
}

function createPendingTextureLoad(
  key: string,
  nodeId: string,
  base: string,
  lod: TwinEquirectLod,
): PendingTextureLoad {
  const controller = new AbortController();
  const entry: PendingTextureLoad = {
    controller,
    promise: Promise.resolve(null),
    texture: null,
    waiters: 0,
    settled: false,
  };
  entry.promise = buildLodTexture(nodeId, base, lod, controller.signal)
    .then((texture) => {
      entry.texture = texture;
      return texture;
    })
    .finally(() => {
      entry.settled = true;
      cleanupPending(key, entry);
    });
  pending.set(key, entry);
  return entry;
}

async function waitForPendingTexture(
  entry: PendingTextureLoad,
  signal: AbortSignal | undefined,
): Promise<Texture | null> {
  if (signal === undefined) return entry.promise;
  if (signal.aborted) return null;

  // The executor runs synchronously, so the listener reference is always the
  // reassigned closure by the time the finally block removes it.
  let handleAbort: () => void = () => undefined;
  const aborted = new Promise<null>((resolve) => {
    handleAbort = () => {
      resolve(null);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
  try {
    return await Promise.race([entry.promise, aborted]);
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

/** Acquire a shared texture (refcounted). Pair every acquire with a release. */
async function acquireTexture(
  nodeId: string,
  base: string,
  lod: TwinEquirectLod,
  signal?: AbortSignal,
): Promise<Texture | null> {
  if (signal?.aborted === true) return null;
  const key = registryKey(base, nodeId, lod);
  const held = registry.get(key);
  if (held !== undefined) {
    held.refs += 1;
    return held.texture;
  }
  const entry = pending.get(key) ?? createPendingTextureLoad(key, nodeId, base, lod);
  entry.waiters += 1;
  try {
    const texture = await waitForPendingTexture(entry, signal);
    if (texture === null) return null;

    const raced = registry.get(key);
    if (raced !== undefined) {
      raced.refs += 1;
      if (raced.texture !== texture) disposeManagedTexture(texture);
      if (entry.texture === texture) entry.texture = null;
      return raced.texture;
    }

    registry.set(key, { texture, refs: 1 });
    if (entry.texture === texture) entry.texture = null;
    return texture;
  } finally {
    entry.waiters -= 1;
    if (entry.waiters === 0 && !entry.settled) {
      if (pending.get(key) === entry) pending.delete(key);
      entry.controller.abort();
    }
    cleanupPending(key, entry);
  }
}

function releaseTexture(nodeId: string, base: string, lod: TwinEquirectLod): void {
  const key = registryKey(base, nodeId, lod);
  const held = registry.get(key);
  if (held === undefined) {
    return;
  }
  held.refs -= 1;
  if (held.refs <= 0) {
    registry.delete(key);
    disposeManagedTexture(held.texture);
  }
}

/** TEST-ONLY: drop every cached texture so each test starts from a cold
 *  registry (textures are shared module state by design). */
export function __resetEquirectRegistryForTests(): void {
  for (const entry of registry.values()) {
    disposeManagedTexture(entry.texture);
  }
  for (const entry of pending.values()) {
    entry.controller.abort();
    if (entry.texture !== null) disposeManagedTexture(entry.texture);
  }
  registry.clear();
  pending.clear();
}

/** True when a node's base tier is already decoded and registry-resident —
 *  the hop can use it immediately instead of holding at the 512 preview. */
export function isEquirectBaseWarm(nodeId: string, base: string): boolean {
  return registry.has(registryKey(base, nodeId, TWIN_EQUIRECT_LODS[1]));
}

/**
 * Neighbour pre-residency: decode a node's base AND push it to the GPU while
 * the walk is at rest. Returns a release handle; the caller keeps the set of
 * handles for the current node's neighbours and releases them on move.
 */
export async function warmEquirectBase(
  nodeId: string,
  base: string,
  initTexture: (texture: Texture) => void,
): Promise<() => void> {
  const texture = await acquireTexture(nodeId, base, TWIN_EQUIRECT_LODS[1]);
  if (texture === null) {
    return () => undefined;
  }
  initTexture(texture);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      releaseTexture(nodeId, base, TWIN_EQUIRECT_LODS[1]);
    }
  };
}

/** Load one LOD into an sRGB, repeat-wrapping, mipless texture (or null). */
async function buildLodTexture(
  nodeId: string,
  base: string,
  lod: TwinEquirectLod,
  signal: AbortSignal,
): Promise<Texture | null> {
  const url = `${base}/${twinEquirectPath(nodeId, lod)}`;
  // Capability check happens BEFORE any await: without the bitmap path the
  // Image must be constructed synchronously with the effect (the test suite
  // pins that timing, and it keeps first paint one microtask earlier).
  const canBitmap =
    typeof createImageBitmap === "function" && typeof fetch === "function";
  const bitmap = canBitmap ? await loadPanoBitmap(url, signal) : null;
  if (signal.aborted) {
    bitmap?.close();
    return null;
  }
  const source = bitmap ?? (await loadPanoImage(url, signal));
  if (source === null) {
    return null;
  }
  const texture = new Texture(source);
  if (bitmap !== null) {
    texture.flipY = false; // orientation already baked by createImageBitmap
    bitmapByTexture.set(texture, bitmap);
  }
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Per-node stream bookkeeping shared across effect re-runs, so a maxLod
 *  upgrade continues the ladder instead of restarting it. */
interface StreamSlot {
  key: string;
  applied: 0 | TwinEquirectLod;
  live: Texture | null;
  /** Releases the live texture's registry ref (shared — never dispose here). */
  release: (() => void) | null;
}

/**
 * Stream a node's equirect pano: 512 preview first (fast paint), then the
 * 4096 base swaps in; with `maxLod` 8192 the zoom tier follows the base.
 * `base` is the bundle base including the venue segment, e.g.
 * `/twin/trades-hall`. LODs above `maxLod` are never requested.
 */
export function useEquirectTexture(
  nodeId: string,
  base: string,
  maxLod: TwinEquirectLod = 4096,
  onStreamError?: (nodeId: string) => void,
): EquirectTextureState {
  const [state, setState] = useState<EquirectTextureState>({ texture: null, lod: 0 });
  const slotRef = useRef<StreamSlot>({ key: "", applied: 0, live: null, release: null });
  const onStreamErrorRef = useRef(onStreamError);
  onStreamErrorRef.current = onStreamError;

  useEffect(() => {
    const key = JSON.stringify([base, nodeId]);
    const slot = slotRef.current;
    let cancelled = false;
    const controller = new AbortController();

    if (slot.key !== key) {
      // Node (or bundle) change: release the previous pano and restart the
      // ladder. A maxLod-only change skips this — the live texture stays on
      // stage while the next tier streams.
      slot.release?.();
      slot.key = key;
      slot.applied = 0;
      slot.live = null;
      slot.release = null;
      setState((previous) =>
        previous.texture === null && previous.lod === 0
          ? previous
          : { texture: null, lod: 0 },
      );
    }

    const stream = async (): Promise<void> => {
      for (const lod of TWIN_EQUIRECT_LODS) {
        if (lod > maxLod || lod <= slot.applied) {
          continue;
        }
        const texture = await acquireTexture(nodeId, base, lod, controller.signal);
        if (cancelled || slotRef.current.key !== key) {
          if (texture !== null) {
            releaseTexture(nodeId, base, lod);
          }
          return;
        }
        if (texture === null) {
          continue;
        }
        slot.release?.();
        slot.live = texture;
        slot.release = () => {
          releaseTexture(nodeId, base, lod);
        };
        slot.applied = lod;
        setState({ texture, lod });
      }
      // A failed preview followed by a successful base is still usable. Report
      // only after the whole permitted ladder has failed and only while this
      // exact stream is current; aborts and superseded nodes are not errors.
      if (!cancelled && slotRef.current.key === key && slot.applied === 0) {
        onStreamErrorRef.current?.(nodeId);
      }
    };

    void stream();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nodeId, base, maxLod]);

  // The live texture is owned by the slot (it must survive maxLod re-runs),
  // so its final release belongs to unmount, not the stream effect above.
  useEffect(() => {
    const slot = slotRef.current;
    return () => {
      slot.release?.();
      slot.live = null;
      slot.release = null;
      slot.applied = 0;
      slot.key = "";
    };
  }, []);

  return state;
}
