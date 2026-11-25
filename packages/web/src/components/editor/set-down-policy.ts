import type { FurnitureMass } from "../../lib/furniture-motion.js";

// ---------------------------------------------------------------------------
// The adaptive render policy (T-700, ruling R100): which pieces this device
// renders ahead of their landing.
//
// A set-down is rendered in the Worker when its piece starts down, and must be
// ready by the frame it lands: 50-83 ms at 60 fps. A desktop renders one in
// 7.5-24 ms; a phone is about 3-5 times slower, so a slow device can miss.
// Rather than gate on any one phone's timings, each device learns its own,
// per class of piece (light, table, heavy, as the motion weighs them):
//
// - Heavy pieces always render ahead, at pickup (ruling R48).
// - A light or table class renders at its drop until it misses: 2 misses in
//   its last 20 contacts switch it to render-ahead. The window decides from
//   the class's first contact and never waits to fill, so a class that misses
//   2 of its first 5 contacts switches at once (condition 1). 2 in 20 is 10 %,
//   twice the release bar of under 5 % misses.
// - It comes back to rendering at the drop only after 10 on-time contacts in a
//   row, each render's Worker time within half the time it had (condition 3),
//   so a device near the edge does not flap.
// - The mode is kept on the device, the class and its mode only, so the next
//   visit starts where this one settled. Every read and write is guarded: a
//   storage that is blocked or full only means the next visit learns again.
//
// A late voice (R80: heard within 45 ms of its contact) is not a miss: it
// plays. It does break a run back to exact renders.
// ---------------------------------------------------------------------------

/** A class of piece, as the motion weighs it (massForCategory). */
export type RenderClass = FurnitureMass;

/** "exact": rendered at the drop. "ahead": also rendered at pickup, or while the placement ghost shows. */
export type RenderMode = "exact" | "ahead";

/** How a contact's exact render arrived: ready at the contact frame, within R80's 45 ms after it, or not. */
export type ContactTiming = "on-time" | "late" | "miss";

/** What one contact says about this device's renders. */
export interface ContactRecord {
  readonly timing: ContactTiming;
  /** The Worker's own time for the exact render, ms, or null when it had not answered. */
  readonly workMs: number | null;
  /** From the render's request to its contact frame, ms: the time it had. */
  readonly windowMs: number;
}

/** The slice of Storage the policy uses. */
export interface RenderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Where each class's mode is kept on the device. */
export const RENDER_MODE_STORAGE_KEY = "venviewer.planner-set-down-render";
/** How many of a class's latest contacts decide a switch to render-ahead. */
export const SWITCH_WINDOW_CONTACTS = 20;
/** Misses within that window that switch it. */
export const SWITCH_MISSES = 2;
/** On-time contacts in a row that bring a class back to rendering at the drop. */
export const BACK_TO_EXACT_ON_TIME = 10;
/** "Well inside its window": a Worker time at most this share of the time the render had. */
export const WELL_INSIDE_SHARE = 0.5;

type AdaptiveClass = Exclude<RenderClass, "heavy">;
const ADAPTIVE: readonly AdaptiveClass[] = ["light", "table"];

interface ClassState {
  mode: RenderMode;
  /** The latest contacts' timings, oldest first, at most SWITCH_WINDOW_CONTACTS. */
  readonly recent: ContactTiming[];
  /** On-time contacts in a row, well inside their windows, while rendering ahead. */
  onTimeRun: number;
}

function pageStorage(): RenderStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function isAdaptive(cls: RenderClass): cls is AdaptiveClass {
  return cls !== "heavy";
}

function isRenderMode(value: unknown): value is RenderMode {
  return value === "exact" || value === "ahead";
}

export class AdaptiveRenderPolicy {
  private readonly storage: () => RenderStorage | null;
  private readonly classes: Record<AdaptiveClass, ClassState>;

  constructor(storage: () => RenderStorage | null = pageStorage) {
    this.storage = storage;
    const kept = this.read();
    this.classes = {
      light: { mode: kept.light ?? "exact", recent: [], onTimeRun: 0 },
      table: { mode: kept.table ?? "exact", recent: [], onTimeRun: 0 },
    };
  }

  /** How this device renders the class's pieces now. */
  mode(cls: RenderClass): RenderMode {
    return isAdaptive(cls) ? this.classes[cls].mode : "ahead";
  }

  /** One contact of the class's; returns its mode after it. */
  recordContact(cls: RenderClass, contact: ContactRecord): RenderMode {
    if (!isAdaptive(cls)) return "ahead";
    const state = this.classes[cls];
    if (state.mode === "exact") {
      state.recent.push(contact.timing);
      if (state.recent.length > SWITCH_WINDOW_CONTACTS) state.recent.shift();
      if (state.recent.filter((timing) => timing === "miss").length >= SWITCH_MISSES) this.switchTo(state, "ahead");
      return state.mode;
    }
    const wellInside = contact.timing === "on-time" && contact.workMs !== null && contact.workMs <= WELL_INSIDE_SHARE * contact.windowMs;
    state.onTimeRun = wellInside ? state.onTimeRun + 1 : 0;
    if (state.onTimeRun >= BACK_TO_EXACT_ON_TIME) this.switchTo(state, "exact");
    return state.mode;
  }

  private switchTo(state: ClassState, mode: RenderMode): void {
    state.mode = mode;
    state.recent.length = 0;
    state.onTimeRun = 0;
    this.write();
  }

  /** The modes kept on this device, each class's only if it reads as one. */
  private read(): Partial<Record<AdaptiveClass, RenderMode>> {
    let text: string | null;
    try {
      text = this.storage()?.getItem(RENDER_MODE_STORAGE_KEY) ?? null;
    } catch {
      return {}; // Storage blocked: this visit learns afresh.
    }
    if (text === null) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {}; // Not ours to read.
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const kept: Partial<Record<AdaptiveClass, RenderMode>> = {};
    for (const cls of ADAPTIVE) {
      const mode: unknown = Reflect.get(parsed, cls);
      if (isRenderMode(mode)) kept[cls] = mode;
    }
    return kept;
  }

  private write(): void {
    const modes: Record<AdaptiveClass, RenderMode> = { light: this.classes.light.mode, table: this.classes.table.mode };
    try {
      this.storage()?.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify(modes));
    } catch {
      // Storage blocked or full: the switch holds for this visit.
    }
  }
}
