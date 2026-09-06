// -----------------------------------------------------------------------------
// timers — the one wall-clock timer shape the audio module injects. A
// schedule returns its own cancel, so no module needs a platform handle type
// (DOM and Node disagree on what setTimeout returns) and a test can drive
// time by hand.
// -----------------------------------------------------------------------------

/** Arm `callback` after `ms` on the wall clock; the returned function cancels it. */
export type Schedule = (callback: () => void, ms: number) => () => void;

export const scheduleOnWallClock: Schedule = (callback, ms) => {
  const handle = globalThis.setTimeout(callback, ms);
  return () => {
    globalThis.clearTimeout(handle);
  };
};
