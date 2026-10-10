// ---------------------------------------------------------------------------
// One corrected clock (goal 19 D9).
//
// Every hello, every live frame and every client snapshot carries the
// server's `serverNowMs`. This module keeps the last five offsets
// (serverNowMs − the instant the frame was received) and answers with their
// median, so one late frame cannot swing the clock and a kiosk whose own
// clock is an hour out still derives every state from venue truth. Nothing
// else in the product keeps a second clock: the board, the slabs and the
// ribbon ask `correctedNowMs()`.
//
// A device more than a minute out is told so ("Clock corrected" in the
// status strip); the correction itself is silent.
// ---------------------------------------------------------------------------

const WINDOW = 5;
/** Beyond this the status strip says the clock was corrected. */
export const CLOCK_CORRECTED_THRESHOLD_MS = 60_000;

let samples: readonly number[] = [];
const listeners = new Set<() => void>();

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] ?? upper;
  return (lower + upper) / 2;
}

/** Record one observation of the server's clock against this device's. */
export function observeServerNow(serverNowMs: number, receivedAtMs: number = Date.now()): void {
  if (!Number.isFinite(serverNowMs) || serverNowMs <= 0 || !Number.isFinite(receivedAtMs)) return;
  samples = [...samples.slice(-(WINDOW - 1)), serverNowMs - receivedAtMs];
  for (const listener of [...listeners]) listener();
}

/** The median offset to add to this device's clock; 0 before any frame. */
export function clockOffsetMs(): number {
  return median(samples);
}

/** Now, as the server would say it. */
export function correctedNowMs(deviceNowMs: number = Date.now()): number {
  return deviceNowMs + clockOffsetMs();
}

/** How many observations the median rests on (0 to 5). */
export function clockSampleCount(): number {
  return samples.length;
}

/** True once the device's own clock is known to be more than a minute out. */
export function clockIsCorrected(): boolean {
  return samples.length > 0 && Math.abs(clockOffsetMs()) > CLOCK_CORRECTED_THRESHOLD_MS;
}

/** Hear every new observation (a status strip re-reads the three above). */
export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam: forget every observation. */
export function __resetClockForTests(): void {
  samples = [];
}
