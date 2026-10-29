// ---------------------------------------------------------------------------
// GPU memory pressure: a view's graphics device ran out of memory
//
// An uncaptured GPUOutOfMemoryError is not a lost device: three r186 forwards
// it through renderer.onError and the view draws on (NativeCanvas, with
// lib/native-gpu-error-watch.ts judging whether it is broken). Rather than
// wait to be judged broken, the view frees memory: the frame governor gives
// up a rung at once, resolution first (RenderGovernor), and the Grand Hall's
// wall detail lets its tiles go (hall-detail.ts). An error repeated on every
// frame tells the listeners at most once per GPU_MEMORY_PRESSURE_INTERVAL_MS,
// so quality steps down a rung at a time rather than all at once
// (planner-qol's F-X1, L3c's hand-on of 26 Oct 2026).
// ---------------------------------------------------------------------------

/** The shortest time between two reports to a renderer's listeners, ms. */
export const GPU_MEMORY_PRESSURE_INTERVAL_MS = 1_000;

interface Channel {
  readonly listeners: Set<() => void>;
  last: number;
}

const channels = new WeakMap<object, Channel>();

function channelFor(renderer: object): Channel {
  let channel = channels.get(renderer);
  if (channel === undefined) {
    channel = { listeners: new Set(), last: Number.NEGATIVE_INFINITY };
    channels.set(renderer, channel);
  }
  return channel;
}

/** Whether an uncaptured GPU error (three r186's `{ api, type, message }`) is the device running out of memory. */
export function isGpuOutOfMemory(event: unknown): boolean {
  return typeof event === "object" && event !== null && "type" in event && event.type === "GPUOutOfMemoryError";
}

/**
 * Tells `renderer`'s listeners its device ran out of memory, unless they were
 * told less than GPU_MEMORY_PRESSURE_INTERVAL_MS ago. True if they were told.
 */
export function reportGpuMemoryPressure(renderer: object, now: number = performance.now()): boolean {
  const channel = channels.get(renderer);
  if (channel === undefined || channel.listeners.size === 0 || now - channel.last < GPU_MEMORY_PRESSURE_INTERVAL_MS) return false;
  channel.last = now;
  for (const listener of [...channel.listeners]) listener();
  return true;
}

/** Calls `listener` when `renderer`'s device runs out of memory; returns the unsubscribe. */
export function onGpuMemoryPressure(renderer: object, listener: () => void): () => void {
  const channel = channelFor(renderer);
  channel.listeners.add(listener);
  return () => { channel.listeners.delete(listener); };
}
