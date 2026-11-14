// ---------------------------------------------------------------------------
// When a set-down starts, so it is heard on the frame its piece is seen to
// land (T-700).
//
// A contact is stepped on one frame and seen when that frame reaches the
// screen. The output adds its own latency, and a render reaches its audible
// onset `onsetSeconds` after it starts (carpet's bottoming thud, R37). The
// start is set so the onset is heard as the frame is shown, and never before
// now: a set-down is never heard before its piece is seen to land.
// ---------------------------------------------------------------------------

/** The slice of an AudioContext the set-down scheduler reads. */
export interface AudioClock {
  readonly currentTime: number;
  readonly outputLatency: number;
  readonly sampleRate: number;
}

/**
 * How late a light piece's exact render may start and still play: within
 * 45 ms of its contact frame (ruling R80). Impact sounds that lag their sight
 * by a few tens of milliseconds are heard as one event, and ITU-R BT.1359 puts
 * the detection threshold for lagging audio at about 125 ms. Past this the
 * voice is silent. A heavy piece keeps the 20 ms choice between its exact
 * render and a variant.
 */
export const HEARD_WINDOW_S = 0.045;

/** A 240 Hz display's frame: the soonest a stepped frame is shown. */
const SOONEST_PRESENT_S = 1 / 240;
/** A 30 fps frame: the latest the scheduler waits for one. */
const LATEST_PRESENT_S = 1 / 30;

/**
 * How long until the frame just stepped is on screen: the last frame's length,
 * held to 1/240-1/30 s. A length that is not a number reads as the longest,
 * so the sound is late rather than early.
 */
export function presentDelayFor(frameDeltaSeconds: number): number {
  if (Number.isNaN(frameDeltaSeconds)) return LATEST_PRESENT_S;
  return Math.min(LATEST_PRESENT_S, Math.max(SOONEST_PRESENT_S, frameDeltaSeconds));
}

/**
 * The context time to start a set-down's render so that its onset is heard as
 * the contact frame is shown:
 *
 *   currentTime + max(0, presentDelay - outputLatency - onsetSeconds)
 *
 * When the output's latency and the onset already exceed the wait, it starts
 * now and is heard late by the difference. It never starts before now, even
 * when a latency is not a number.
 */
export function setDownStartTime(clock: AudioClock, presentDelaySeconds: number, onsetSeconds: number): number {
  const lead = presentDelaySeconds - clock.outputLatency - onsetSeconds;
  return clock.currentTime + (lead > 0 ? lead : 0);
}
