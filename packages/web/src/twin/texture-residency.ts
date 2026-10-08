// -----------------------------------------------------------------------------
// texture-residency — put a large pano on the GPU in bounded steps.
//
// WHY. A 4096x2048 base is ~33.5 MB of RGBA and `renderer.initTexture` pushes
// it in ONE synchronous texSubImage2D. The main thread waits while the GPU
// process consumes it, so the call costs whatever that process's upload rate
// is. Measured on 8 October 2026 with a synthetic 4096x2048 bitmap
// (D:/claude/perf-20260929/strip-bench), main-thread time per call:
//   RTX 4090, Chrome/ANGLE D3D11 — whole upload 15-36 ms.
//   The PR GPU gate (WSL2, ANGLE GL on Mesa D3D12) — whole upload 129-386 ms.
// The gate's Twin hop test traced exactly that: each neighbour pre-warm slice
// and the arriving node's base swap was a 136-165 ms task, so its 150 ms
// "longest main-thread block" budget passed or failed on machine load alone.
//
// HOW. The texture's storage is allocated without data (three's
// `source.dataReady = false`), then rows are copied from the same ImageBitmap
// with `copyTextureToTexture` sub-rectangles. Each step uploads at most
// RESIDENCY_SLICE_BYTES and then waits for a GPU fence before the next, so the
// command stream never queues enough to stall the caller. Same harness:
//   2 MiB strips, 8 MiB per step, fenced — gate 5.5-6.5 ms per step and no
//     long task, 200 ms to fully resident; RTX 4090 3-11 ms per step.
//   16 MiB per step on the gate — 42-82 ms; 32 MiB — 105-162 ms.
//   Unfenced 2 MiB strips, one per frame — mostly 1.4 ms, but one 51-71 ms
//     call per texture once the queue backs up.
// The streamed texels were byte-identical to the single upload on both.
//
// A texture this module cannot stream (no ImageBitmap, flipped, mipmapped,
// not RGBA8, or small enough for one step) takes the ordinary `initTexture`
// path. State is per renderer: a texture is resident on the renderer that
// uploaded it, never on a replacement after context loss.
// -----------------------------------------------------------------------------

import {
  Box2,
  RGBAFormat,
  Texture,
  UnsignedByteType,
  Vector2,
  type WebGLRenderer,
} from "three";
import { canUploadInSlice } from "./neighbour-warm.js";

/** One copy's worth of rows: 128 rows of a 4096 base, 64 of an 8192 zoom. */
export const RESIDENCY_STRIP_BYTES = 2 * 1024 * 1024;

/** Upload budget for one step before it fences and yields. */
export const RESIDENCY_SLICE_BYTES = 8 * 1024 * 1024;

const BYTES_PER_TEXEL = 4;

/** The WebGL 2 fence calls the pacing needs. */
type FenceContext = Pick<
  WebGL2RenderingContext,
  | "fenceSync"
  | "deleteSync"
  | "isSync"
  | "getSyncParameter"
  | "flush"
  | "isContextLost"
  | "SYNC_GPU_COMMANDS_COMPLETE"
  | "SYNC_STATUS"
  | "SIGNALED"
>;

/** The renderer surface this module drives — a WebGLRenderer in production. */
export type ResidencyRenderer = Pick<WebGLRenderer, "initTexture" | "copyTextureToTexture"> & {
  getContext(): unknown;
};

interface Streaming {
  readonly kind: "streaming";
  /** Never initialised on any renderer, so three copies it with texSubImage2D. */
  readonly source: Texture;
  readonly width: number;
  readonly height: number;
  readonly rowsPerStrip: number;
  readonly gl: FenceContext | null;
  nextRow: number;
  fence: WebGLSync | null;
}

type Residency = { readonly kind: "resident" } | Streaming;

const RESIDENT: Residency = { kind: "resident" };
const byTexture = new WeakMap<Texture, Map<ResidencyRenderer, Residency>>();
const region = new Box2();
const position = new Vector2();

function isFenceContext(value: unknown): value is FenceContext {
  return typeof value === "object" && value !== null
    && "fenceSync" in value && typeof value.fenceSync === "function"
    && "deleteSync" in value && typeof value.deleteSync === "function"
    && "isSync" in value && typeof value.isSync === "function"
    && "getSyncParameter" in value && typeof value.getSyncParameter === "function"
    && "flush" in value && typeof value.flush === "function"
    && "isContextLost" in value && typeof value.isContextLost === "function";
}

function residencyFor(texture: Texture): Map<ResidencyRenderer, Residency> {
  const known = byTexture.get(texture);
  if (known !== undefined) return known;
  const states = new Map<ResidencyRenderer, Residency>();
  byTexture.set(texture, states);
  const onDispose = (): void => {
    texture.removeEventListener("dispose", onDispose);
    for (const state of states.values()) {
      if (state.kind === "streaming") deleteFence(state);
    }
    byTexture.delete(texture);
  };
  texture.addEventListener("dispose", onDispose);
  return states;
}

function deleteFence(state: Streaming): void {
  if (state.fence !== null && state.gl !== null && !state.gl.isContextLost()) {
    state.gl.deleteSync(state.fence);
  }
  state.fence = null;
}

/** True once the previous step's copies have finished on the GPU. */
function fenceCleared(state: Streaming): boolean {
  const { fence, gl } = state;
  if (fence === null || gl === null) return true;
  // A fence from a lost context never signals; treat it as spent.
  if (gl.isContextLost() || !gl.isSync(fence)) {
    state.fence = null;
    return true;
  }
  if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
  deleteFence(state);
  return true;
}

function streamableSize(texture: Texture): { width: number; height: number } | null {
  const image: unknown = texture.image;
  if (typeof ImageBitmap === "undefined" || !(image instanceof ImageBitmap)) return null;
  if (texture.flipY || texture.generateMipmaps || texture.mipmaps.length > 0) return null;
  if (texture.format !== RGBAFormat || texture.type !== UnsignedByteType) return null;
  const { width, height } = image;
  if (width <= 0 || height <= 0 || width * height * BYTES_PER_TEXEL <= RESIDENCY_SLICE_BYTES) {
    return null;
  }
  return { width, height };
}

function begin(renderer: ResidencyRenderer, texture: Texture): Residency {
  const size = streamableSize(texture);
  if (size === null) {
    renderer.initTexture(texture);
    return RESIDENT;
  }
  // Allocate storage only. Restored at once, so a later full re-upload (after
  // a context restore, say) still sends the real pixels.
  texture.source.dataReady = false;
  try {
    renderer.initTexture(texture);
  } finally {
    texture.source.dataReady = true;
  }
  const source = new Texture(texture.image);
  source.flipY = false;
  const gl = renderer.getContext();
  return {
    kind: "streaming",
    source,
    width: size.width,
    height: size.height,
    rowsPerStrip: Math.max(1, Math.floor(RESIDENCY_STRIP_BYTES / (size.width * BYTES_PER_TEXEL))),
    gl: isFenceContext(gl) ? gl : null,
    nextRow: 0,
    fence: null,
  };
}

function copyStrip(renderer: ResidencyRenderer, texture: Texture, state: Streaming): number {
  const rows = Math.min(state.rowsPerStrip, state.height - state.nextRow);
  region.min.set(0, state.nextRow);
  region.max.set(state.width, state.nextRow + rows);
  position.set(0, state.nextRow);
  renderer.copyTextureToTexture(state.source, texture, region, position);
  state.nextRow += rows;
  return rows * state.width * BYTES_PER_TEXEL;
}

/** Does `renderer` hold every texel of `texture`? */
export function isTextureResident(renderer: ResidencyRenderer, texture: Texture): boolean {
  return byTexture.get(texture)?.get(renderer)?.kind === "resident";
}

/**
 * Advance `texture` towards residency by at most one bounded step: up to
 * RESIDENCY_SLICE_BYTES of strips, the first unconditionally and each later one
 * only while `hasTime()` holds. Does nothing while the previous step is still
 * on the GPU. Returns true once the texture is fully resident.
 */
export function advanceTextureResidency(
  renderer: ResidencyRenderer,
  texture: Texture,
  hasTime: () => boolean,
): boolean {
  const states = residencyFor(texture);
  let state = states.get(renderer);
  if (state === undefined) {
    state = begin(renderer, texture);
    states.set(renderer, state);
  }
  if (state.kind === "resident") return true;
  if (!fenceCleared(state)) return false;
  let sent = 0;
  do {
    sent += copyStrip(renderer, texture, state);
  } while (state.nextRow < state.height && sent < RESIDENCY_SLICE_BYTES && hasTime());
  if (state.nextRow >= state.height) {
    states.set(renderer, RESIDENT);
    return true;
  }
  if (state.gl !== null) {
    state.fence = state.gl.fenceSync(state.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    state.gl.flush();
  }
  return false;
}

/**
 * Stream `texture` to residency one step per browser idle slice, then call
 * `onResident`; `onError` instead if a step throws. Returns a cancel handle.
 *
 * No idle timeout: callers ask only once the walk has settled or for a tier
 * whose predecessor is still on screen, so a genuine idle is at hand — never
 * force a step into an animating frame. Without requestIdleCallback (Safari)
 * each zero-delay timeout sends one strip.
 */
export function whenTextureResident(
  renderer: ResidencyRenderer,
  texture: Texture,
  onResident: () => void,
  onError: () => void,
): () => void {
  let cancelled = false;
  let cancelPending: (() => void) | null = null;
  const step = (hasTime: () => boolean): void => {
    cancelPending = null;
    if (cancelled) return;
    let resident: boolean;
    try {
      resident = advanceTextureResidency(renderer, texture, hasTime);
    } catch {
      onError();
      return;
    }
    if (resident) onResident();
    else schedule();
  };
  function schedule(): void {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback((deadline) => {
        step(() => canUploadInSlice(deadline));
      });
      cancelPending = () => {
        if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
      };
    } else {
      const handle = window.setTimeout(() => {
        step(() => false);
      }, 0);
      cancelPending = () => {
        window.clearTimeout(handle);
      };
    }
  }
  schedule();
  return () => {
    cancelled = true;
    cancelPending?.();
    cancelPending = null;
  };
}

/**
 * Make `texture` fully resident now, finishing any streamed upload in this
 * call. For a texture that must draw this frame; it costs what one
 * `initTexture` would.
 */
export function ensureTextureResident(renderer: ResidencyRenderer, texture: Texture): void {
  const states = residencyFor(texture);
  const state = states.get(renderer);
  if (state === undefined) {
    renderer.initTexture(texture);
  } else if (state.kind === "streaming") {
    deleteFence(state);
    while (state.nextRow < state.height) copyStrip(renderer, texture, state);
  }
  states.set(renderer, RESIDENT);
}
