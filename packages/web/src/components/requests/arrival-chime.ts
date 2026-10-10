import { isUnownedRequest, type VenueRequest } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The arrival chime (goal 19 S4; D3 "Sound", D8). Opt-in, per device, from a
// visible control on the board. One plain bell when a request lands that
// nobody owns and that this person did not raise, and one when a request is
// escalated to this administrator; never on a tick, never repeated. The
// sample is a plain bell until Blake records the building's own room tone
// (HUMAN.md 6). Audio off loses nothing: the ring and the words are the
// signal, so nothing here is a correctness mechanism.
//
// The AudioContext is made inside the toggle's own press, because browsers
// unlock audio on a gesture; a chime that arrives later plays on that
// unlocked context. Sound is not motion: reduced motion does not silence it.
//
// WHICH ARRIVALS CHIME is a pure decision over two snapshots, so "once per
// arrival" is a fact about data rather than a hope about a timer: a request
// chimes when it is first seen, and an escalation when escalatedAt first
// appears, and the first snapshot after mount chimes for nothing at all.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.chime-on-arrivals";
const listeners = new Set<() => void>();
let context: AudioContext | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether this device chimes on arrivals. Off until somebody turns it on. */
export function isChimeEnabled(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setChimeEnabled(value: boolean): void {
  try {
    storage()?.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // A full or blocked store: the setting lives for this page only.
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeChime(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function audioContext(): AudioContext | null {
  if (context !== null) return context;
  if (typeof AudioContext === "undefined") return null;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  return context;
}

/** Make the context inside a gesture, so the chimes that come later may play. */
export function unlockChime(): void {
  const ctx = audioContext();
  if (ctx !== null && ctx.state === "suspended") void ctx.resume();
}

/**
 * One plain bell, about 400 ms: a fundamental and a soft fifth above it,
 * each fading as a struck bell does. Returns false when the chime is off or
 * the device cannot play, so a caller can tell a silence from a chime.
 */
export function playArrivalChime(): boolean {
  if (!isChimeEnabled()) return false;
  const ctx = audioContext();
  if (ctx === null) return false;
  const now = ctx.currentTime;
  for (const [frequency, peak, seconds] of [[880, 0.12, 0.42], [1320, 0.05, 0.3]] as const) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + seconds);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + seconds + 0.02);
  }
  return true;
}

// --- Which arrivals deserve a chime ---------------------------------------

/** The last snapshot as the policy remembers it: request id → escalatedAt. */
export type ChimeMemory = ReadonlyMap<string, string | null>;

export interface ChimeDecision {
  /** Requests that landed since the last snapshot, unowned, not this person's own ask. */
  readonly arrivals: readonly string[];
  /** Requests escalated to this administrator since the last snapshot. */
  readonly escalations: readonly string[];
}

export function rememberForChime(requests: readonly VenueRequest[]): ChimeMemory {
  return new Map(requests.map((request) => [request.id, request.escalatedAt]));
}

/**
 * Pure: which of the requests in a fresh snapshot chime for this person. The
 * first snapshot after mount (no memory yet) chimes for nothing, so opening
 * the board on a busy afternoon is silent; a request already known chimes
 * only when it is newly escalated and this person is an administrator; a
 * request both new and escalated chimes once, as an arrival.
 */
export function chimeWorthy(
  previous: ChimeMemory | null,
  current: readonly VenueRequest[],
  me: { readonly id: string; readonly role: string },
): ChimeDecision {
  if (previous === null) return { arrivals: [], escalations: [] };
  const arrivals: string[] = [];
  const escalations: string[] = [];
  for (const request of current) {
    if (!previous.has(request.id)) {
      if (isUnownedRequest(request) && request.requestedByUserId !== me.id) arrivals.push(request.id);
      continue;
    }
    if (me.role === "admin" && request.escalatedAt !== null && previous.get(request.id) === null) {
      escalations.push(request.id);
    }
  }
  return { arrivals, escalations };
}

/** Test seam: forget the audio context between cases. */
export function __resetChimeForTests(): void {
  context = null;
}
