// ---------------------------------------------------------------------------
// toolbar-sounds — Web Audio API programmatic sound effects for toolbar
// ---------------------------------------------------------------------------

/** Global mute state for toolbar sounds. */
let muted = true;

/** Lazily created AudioContext (browsers require user gesture before creation). */
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (muted) return null;
  if (audioCtx === null) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Toggle global mute for toolbar sounds. Returns new muted state. */
export function toggleToolbarMute(): boolean {
  muted = !muted;
  return muted;
}

/** Returns true if toolbar sounds are muted. */
export function isToolbarMuted(): boolean {
  return muted;
}

/** Set toolbar sound mute state directly. */
export function setToolbarMuted(value: boolean): void {
  muted = value;
}

/**
 * Plays a short pitched tick — used for arc open/close stagger.
 *
 * @param frequency  Base frequency in Hz (800-1300 range).
 * @param delay      Delay in seconds before playing.
 * @param volume     Gain (0-1), default very low.
 */
export function playTick(frequency: number, delay: number = 0, volume: number = 0.04): void {
  const ctx = getAudioContext();
  if (ctx === null) return;

  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}

/**
 * Plays ascending tick series for arc opening.
 * Each tool produces a tick pitched slightly higher (base + index * step).
 *
 * @param count       Number of tools.
 * @param staggerMs   Delay between ticks in ms.
 */
export function playArcOpenSound(count: number, staggerMs: number = 40): void {
  const baseFreq = 800;
  const step = 100;
  for (let i = 0; i < count; i++) {
    playTick(baseFreq + i * step, (i * staggerMs) / 1000);
  }
}

/**
 * Plays descending tick series for arc closing (reverse order, slightly faster).
 */
export function playArcCloseSound(count: number, staggerMs: number = 35): void {
  const baseFreq = 800;
  const step = 100;
  for (let i = 0; i < count; i++) {
    const toolIndex = count - 1 - i;
    playTick(baseFreq + toolIndex * step, (i * staggerMs) / 1000);
  }
}

/**
 * Plays a crisp activation click — short transient at tool-specific pitch.
 *
 * @param toolIndex  Tool position in arc (0-4), maps to pitch.
 */
export function playActivationClick(toolIndex: number): void {
  const ctx = getAudioContext();
  if (ctx === null) return;

  const now = ctx.currentTime;
  const freq = 2000 + toolIndex * 400;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.04);

  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}
