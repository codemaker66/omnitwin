import { useEffect, useState } from "react";
import { clockOffsetMs, correctedNowMs, subscribeClock } from "../../../lib/clock-offset.js";

// ---------------------------------------------------------------------------
// The board's clock (goal 19 D3 law 3, D9, D10).
//
// One corrected clock, read through lib/clock-offset.ts. The board does not
// poll: it schedules its next tick to the millisecond, at the earlier of the
// next state boundary any slot will cross and the next whole minute (the
// countdown words change by the minute). A tick is one state update, so a
// day with thirty slots costs one render per boundary, never one per second.
//
// The epoch phase (D3 law 1): a CSS animation starts when it is applied, so
// a phase sampled once at mount aligns only the breaths that began then. A
// breath that begins later (a slab crossing a boundary, a ring mounted by a
// new request, a board unfreezing) samples its own phase at that moment,
// through useBreathPhase, and declares `animation-delay: calc(-1ms *
// var(--lt-epoch-phase-ms))` on its own element. Every cadence divides
// 60 s, so every breath on every screen lands on the venue's minute grid;
// when the clock correction itself moves by half a second the phase is
// sampled again and the breath shifts once onto the corrected grid.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
/** The socket has been down this long: the board is no longer live. */
export const OFFLINE_AFTER_MS = 60_000;
/** The last read is this old: the board may be showing a stale day. */
export const STALE_AFTER_MS = 2 * MINUTE_MS;
/** A clock correction that moves by this much re-aligns the breaths. */
const CLOCK_REALIGN_MS = 500;

/** The next instant the board must redraw: the earlier of the next boundary
 *  and the next whole minute, always strictly after now. */
export function nextTickMs(nowMs: number, nextBoundaryMs: number | null): number {
  const nextMinute = (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;
  const candidate = nextBoundaryMs !== null && nextBoundaryMs > nowMs ? Math.min(nextBoundaryMs, nextMinute) : nextMinute;
  return Math.max(candidate, nowMs + 1);
}

export function useBoardClock(nextBoundaryMs: number | null): number {
  const [nowMs, setNowMs] = useState(() => correctedNowMs());

  useEffect(() => {
    let timer: number | null = null;
    const arm = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      const now = correctedNowMs();
      timer = window.setTimeout(() => {
        setNowMs(correctedNowMs());
        arm();
      }, nextTickMs(now, nextBoundaryMs) - now);
    };
    arm();
    // A new clock observation may move "now" by seconds: redraw at once.
    const leave = subscribeClock(() => { setNowMs(correctedNowMs()); });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      leave();
    };
  }, [nextBoundaryMs]);

  return nowMs;
}

/** The phase of an instant inside the 60-second epoch, in milliseconds. */
export function epochPhaseMs(nowMs: number = correctedNowMs()): number {
  return nowMs - Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
}

interface BreathSample {
  readonly key: string;
  readonly bucket: number;
  readonly phase: number;
}

/**
 * The epoch phase for one breathing element, sampled when its breath begins
 * and again whenever `key` changes (a new motion, a freeze lifting) or the
 * clock correction moves by half a second. Sampled during render, so the
 * element's animation and its phase are committed together.
 */
export function useBreathPhase(key: string): number {
  const bucket = Math.round(clockOffsetMs() / CLOCK_REALIGN_MS);
  const [sample, setSample] = useState<BreathSample>(() => ({ key, bucket, phase: epochPhaseMs() }));
  if (sample.key !== key || sample.bucket !== bucket) {
    const next = { key, bucket, phase: epochPhaseMs() };
    setSample(next);
    return next.phase;
  }
  return sample.phase;
}

export type BoardFreshness =
  | { readonly kind: "live" }
  | { readonly kind: "offline"; readonly sinceMs: number }
  | { readonly kind: "stale"; readonly readAtMs: number };

/**
 * Whether the board may still claim to be live. While the socket is up every
 * committed change refetches, so a quiet afternoon is live however old its
 * read; a read older than two minutes is stale only when the socket is down
 * (for less than the minute that makes it offline) or the last refresh
 * failed. Offline wins over stale, because it explains it.
 */
export function boardFreshness(
  nowMs: number,
  readAtMs: number | null,
  disconnectedSinceMs: number | null,
  refreshFailed = false,
): BoardFreshness {
  if (disconnectedSinceMs !== null && nowMs - disconnectedSinceMs >= OFFLINE_AFTER_MS) {
    return { kind: "offline", sinceMs: disconnectedSinceMs };
  }
  if (readAtMs !== null && nowMs - readAtMs >= STALE_AFTER_MS && (disconnectedSinceMs !== null || refreshFailed)) {
    return { kind: "stale", readAtMs };
  }
  return { kind: "live" };
}

export interface ConnectionState {
  /** When the socket went down (or the board mounted without one); null while up. */
  readonly droppedAtMs: number | null;
  /** The socket has been up at least once since mount: a drop now is a drop,
   *  and every breath stops the instant it happens (D3 law 6). */
  readonly everConnected: boolean;
}

/** Remembers when the socket went down and whether it was ever up. */
export function useConnectionState(connected: boolean): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ droppedAtMs: null, everConnected: false });
  useEffect(() => {
    if (connected) {
      setState({ droppedAtMs: null, everConnected: true });
      return;
    }
    // The instant of the drop is the one that matters; later ticks keep it.
    setState((current) => ({ droppedAtMs: current.droppedAtMs ?? correctedNowMs(), everConnected: current.everConnected }));
  }, [connected]);
  return state;
}
