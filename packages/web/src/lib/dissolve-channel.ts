/** An opacity channel owns its own monotonic millisecond timeline. */
export interface DissolveChannel {
  value: number;
  target: 0 | 1;
  lastStepMs: number | null;
}

const DISSOLVE_SNAP = 0.012;

function canAdvance(channel: DissolveChannel, nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0
    && (channel.lastStepMs === null || nowMs >= channel.lastStepMs);
}

export function createDissolveChannel(value: 0 | 1, nowMs: number): DissolveChannel {
  return {
    value,
    target: value,
    lastStepMs: Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : null,
  };
}

/**
 * Advance with the full elapsed time owned by this channel. Unlike a spring
 * integrator, exponential opacity easing stays bounded for any positive gap.
 * The caller supplies the same monotonic clock at target changes and frames;
 * an R3F demand-frame delta may include idle time before the target existed.
 *
 * True means redraw: either the channel remains in motion or its final value
 * changed this step. Keep that final redraw so a separate mesh-opacity poll
 * observes the exact target; the next unchanged call returns false.
 */
export function stepDissolveChannel(
  channel: DissolveChannel,
  ease: number,
  nowMs: number,
  reduced = false,
): boolean {
  let elapsedSeconds = 0;
  if (canAdvance(channel, nowMs)) {
    if (channel.lastStepMs !== null) elapsedSeconds = (nowMs - channel.lastStepMs) / 1_000;
    channel.lastStepMs = nowMs;
  }

  const delta = channel.target - channel.value;
  if (delta === 0) return false;
  if (reduced || Math.abs(delta) <= DISSOLVE_SNAP) {
    channel.value = channel.target;
    return true;
  }

  channel.value += delta * (1 - Math.pow(1 - ease, elapsedSeconds * 60));
  // A slow frame can cross the snap boundary. Finish now instead of waiting
  // for another equally slow frame merely to replace a sub-snap remainder.
  if (Math.abs(channel.target - channel.value) <= DISSOLVE_SNAP) {
    channel.value = channel.target;
  }
  return true;
}

/** Retarget continuously, without charging preceding idle to the new target. */
export function setDissolveTarget(
  channel: DissolveChannel,
  target: 0 | 1,
  ease: number,
  nowMs: number,
): void {
  if (channel.target === target) return;
  const validBoundary = canAdvance(channel, nowMs);
  // Account for elapsed time under the OLD target before starting its reversal.
  stepDissolveChannel(channel, ease, nowMs);
  channel.target = target;
  // A malformed/backwards clock cannot tell us when the new target began.
  // Establish its epoch on the next valid frame rather than spending old idle.
  if (!validBoundary) channel.lastStepMs = null;
}
