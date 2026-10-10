// ---------------------------------------------------------------------------
// The event's own light, shared by everything that shows it
//
// How strongly the tables' candles burn, 0 (unlit, hidden) to 1 (a candlelit
// dinner). The room's mood owns it (the Grand Hall's moods blend it with the
// rest of their light); the candles, their glow on the linen and the pools on
// the floor read it every frame.
// ---------------------------------------------------------------------------

import { uniform } from "three/tsl";

export const eventLight = {
  candles: uniform(0),
} as const;

/** Sets how strongly the candles burn, clamped to 0..1. */
export function setCandleLight(level: number): void {
  eventLight.candles.value = Math.max(0, Math.min(1, level));
}
