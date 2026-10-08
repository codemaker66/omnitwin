import { useEffect, useState } from "react";
import { correctedNowMs, subscribeClock } from "../../../lib/clock-offset.js";

// ---------------------------------------------------------------------------
// The board's clock (goal 19 D3 law 3, D9, D10).
//
// One corrected clock, read through lib/clock-offset.ts. The board does not
// poll: it schedules its next tick to the millisecond, at the earlier of the
// next state boundary any slot will cross and the next whole minute (the
// countdown words change by the minute). A tick is one state update, so a
// day with thirty slots costs one render per boundary, never one per second.
//
// The epoch phase is read once per mount: every breath on the board declares
// `animation-delay: calc(-1ms * var(--lt-epoch-phase-ms))`, and because
// every cadence divides 60 s, two screens mounted at different moments
// breathe together on the venue's minute grid.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
/** The socket has been down this long: the board is no longer live. */
export const OFFLINE_AFTER_MS = 60_000;
/** The last read is this old: the board may be showing a stale day. */
export const STALE_AFTER_MS = 2 * MINUTE_MS;

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

/** The phase of the mount inside the 60-second epoch, in milliseconds. */
export function useEpochPhaseMs(): number {
  const [phase] = useState(() => {
    const now = correctedNowMs();
    return now - Math.floor(now / MINUTE_MS) * MINUTE_MS;
  });
  return phase;
}

export type BoardFreshness =
  | { readonly kind: "live" }
  | { readonly kind: "offline"; readonly sinceMs: number }
  | { readonly kind: "stale"; readonly readAtMs: number };

/**
 * Whether the board may still claim to be live: the socket has been up (or
 * down for less than a minute) and the day was read in the last two
 * minutes. Offline wins over stale, because it explains it.
 */
export function boardFreshness(
  nowMs: number,
  readAtMs: number | null,
  disconnectedSinceMs: number | null,
): BoardFreshness {
  if (disconnectedSinceMs !== null && nowMs - disconnectedSinceMs >= OFFLINE_AFTER_MS) {
    return { kind: "offline", sinceMs: disconnectedSinceMs };
  }
  if (readAtMs !== null && nowMs - readAtMs >= STALE_AFTER_MS) {
    return { kind: "stale", readAtMs };
  }
  return { kind: "live" };
}

/** Remembers when the socket went down, and forgets it when it comes back. */
export function useDisconnectedSince(connected: boolean): number | null {
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (connected) {
      setSince(null);
      return;
    }
    // The instant of the drop is the one that matters; later ticks keep it.
    setSince((current) => current ?? correctedNowMs());
  }, [connected]);
  return since;
}
