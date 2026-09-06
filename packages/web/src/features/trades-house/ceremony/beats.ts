// -----------------------------------------------------------------------------
// beats — the ceremony's timestamps, written to the DOM as `data-beat-at`.
//
// Every beat of the choice ceremony (press, commit, retreat, reply, ledger,
// latch, continue) stamps the element it happened on with the time it
// happened, taken from the rAF clock or performance.now() (one origin, so the
// stamps are comparable). The reduced-motion e2e reads them back and asserts
// that the beats keep their timestamps within 10% when every movement is
// removed — "every beat keeps its timestamp" (spec section 5) is a measurable
// law only because the stamps exist. Nothing here reads a clock; the time is
// always passed in.
// -----------------------------------------------------------------------------
import type { BeatStamp } from "./ceremony-types.js";

export type BeatName = BeatStamp["name"];

/** The attribute the e2e queries: `[data-beat-at]`. */
export const BEAT_ATTRIBUTE = "data-beat-at";

export const BEAT_NAMES: readonly BeatName[] = [
  "press", "commit", "retreat", "reply", "ledger", "latch", "continue",
];

const BEAT_NAME_SET: ReadonlySet<string> = new Set(BEAT_NAMES);

function isBeatName(value: string): value is BeatName {
  return BEAT_NAME_SET.has(value);
}

/** `"commit:1234.5"`: the name, a colon, the ms to one decimal. */
export function formatBeat(name: BeatName, atMs: number): string {
  if (!Number.isFinite(atMs) || atMs < 0) {
    throw new RangeError(`A beat needs a finite, non-negative time; got ${String(atMs)}`);
  }
  return `${name}:${atMs.toFixed(1)}`;
}

/** The inverse of formatBeat; null for anything that is not a stamp. */
export function parseBeat(value: string | null | undefined): BeatStamp | null {
  if (value === null || value === undefined) return null;
  const colon = value.indexOf(":");
  if (colon <= 0) return null;
  const name = value.slice(0, colon);
  const atMs = Number(value.slice(colon + 1));
  if (!isBeatName(name) || !Number.isFinite(atMs) || atMs < 0) return null;
  return { name, atMs };
}

/**
 * Write the stamp onto an element and return it. A null target (a ref that
 * has not mounted, a test without a DOM) still returns the stamp so the
 * caller's own record is never lost.
 */
export function stampBeat(
  target: Element | null | undefined,
  name: BeatName,
  nowMs: number,
): BeatStamp {
  const formatted = formatBeat(name, nowMs);
  target?.setAttribute(BEAT_ATTRIBUTE, formatted);
  return { name, atMs: nowMs };
}

/** Every stamp under `root`, earliest first. This is what the e2e evaluates. */
export function readBeats(root: ParentNode): BeatStamp[] {
  const stamps: BeatStamp[] = [];
  root.querySelectorAll(`[${BEAT_ATTRIBUTE}]`).forEach((element) => {
    const stamp = parseBeat(element.getAttribute(BEAT_ATTRIBUTE));
    if (stamp !== null) stamps.push(stamp);
  });
  return stamps.sort((a, b) => a.atMs - b.atMs);
}

/**
 * The ms from the latest `from` beat to the latest `to` beat, or null when
 * either is missing or `to` precedes `from`. The e2e compares this against
 * CEREMONY_TIMING (commit → retreat 40, commit → reply 120) within 10%.
 */
export function beatGapMs(stamps: readonly BeatStamp[], from: BeatName, to: BeatName): number | null {
  let fromAt: number | null = null;
  let toAt: number | null = null;
  for (const stamp of stamps) {
    if (stamp.name === from && (fromAt === null || stamp.atMs > fromAt)) fromAt = stamp.atMs;
    if (stamp.name === to && (toAt === null || stamp.atMs > toAt)) toAt = stamp.atMs;
  }
  if (fromAt === null || toAt === null || toAt < fromAt) return null;
  return toAt - fromAt;
}

/** An in-memory record of the beats, for the page and for tests. */
export interface BeatLog {
  readonly stamps: readonly BeatStamp[];
  /** Stamp the element (when given) and append to the log. */
  record(name: BeatName, nowMs: number, target?: Element | null): BeatStamp;
  clear(): void;
}

export function createBeatLog(): BeatLog {
  const stamps: BeatStamp[] = [];
  return {
    get stamps(): readonly BeatStamp[] {
      return stamps;
    },
    record(name, nowMs, target) {
      const stamp = stampBeat(target, name, nowMs);
      stamps.push(stamp);
      return stamp;
    },
    clear() {
      stamps.length = 0;
    },
  };
}
