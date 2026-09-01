// ---------------------------------------------------------------------------
// Furniture motion — transient spring-settle offsets for placed furniture.
//
// The store is truth: on move release the SNAPPED position is written
// immediately (undo, autosave and the footprint engines all see the final
// value at once). What animates is a purely visual offset — the difference
// between where the hand left the object and where it snapped — decaying to
// zero through the gridSettle spring. The outer `furniture-<id>` group is a
// free channel for this: React manages the inner mesh's position and never
// writes the outer group's, so the offset can be applied imperatively
// without fighting reconciliation (the same division of labour the splat
// dissolve engine uses).
//
// Interruption rule: grabbing an object mid-settle clears its channel first,
// snapping the visual to store truth before the grab offset is measured.
// Decisive, and it keeps drag maths blind to the animation layer.
// ---------------------------------------------------------------------------

import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "./springs.js";

interface SettleChannel {
  readonly x: SpringState;
  readonly z: SpringState;
}

const channels = new Map<string, SettleChannel>();

/**
 * Begin a settle: the object is visually at store-position + offset and the
 * spring carries the offset to zero. Re-seeding an id retargets in place —
 * velocity survives, which is what makes rapid re-drags feel continuous.
 */
export function beginFurnitureSettle(id: string, offsetX: number, offsetZ: number): void {
  const existing = channels.get(id);
  if (existing !== undefined) {
    existing.x.value += offsetX;
    existing.z.value += offsetZ;
    return;
  }
  channels.set(id, {
    x: { value: offsetX, velocity: 0 },
    z: { value: offsetZ, velocity: 0 },
  });
}

/** Drop one object's settle (grab-interrupt) — visual snaps to store truth. */
export function clearFurnitureSettle(id: string): void {
  channels.delete(id);
}

/** Drop everything (room change, scene unmount). */
export function clearAllFurnitureSettles(): void {
  channels.clear();
}

export function activeFurnitureSettleCount(): number {
  return channels.size;
}

/** Current visual offset for an id, or null once settled/absent. */
export function furnitureSettleOffset(id: string): { x: number; z: number } | null {
  const channel = channels.get(id);
  if (channel === undefined) return null;
  return { x: channel.x.value, z: channel.z.value };
}

/**
 * Advance every live settle by one frame. Settled channels are pruned so the
 * demand loop can go back to sleep. Returns the ids that still carry an
 * offset this frame (the caller applies them, then invalidates while any
 * remain).
 */
export function stepFurnitureSettles(dtSeconds: number): readonly string[] {
  if (channels.size === 0) return [];
  const live: string[] = [];
  for (const [id, channel] of channels) {
    stepSpring(channel.x, 0, dtSeconds, SPRING_PRESETS.gridSettle);
    stepSpring(channel.z, 0, dtSeconds, SPRING_PRESETS.gridSettle);
    if (isSpringSettled(channel.x, 0) && isSpringSettled(channel.z, 0)) {
      channels.delete(id);
    } else {
      live.push(id);
    }
  }
  return live;
}
