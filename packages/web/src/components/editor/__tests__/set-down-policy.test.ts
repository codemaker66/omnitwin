import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdaptiveRenderPolicy,
  BACK_TO_EXACT_ON_TIME,
  RENDER_MODE_STORAGE_KEY,
  SWITCH_MISSES,
  SWITCH_WINDOW_CONTACTS,
  WELL_INSIDE_SHARE,
  type ContactRecord,
  type RenderStorage,
} from "../set-down-policy.js";

// ---------------------------------------------------------------------------
// The adaptive render policy (T-700, ruling R100): each class of piece renders
// at its drop until this device shows it cannot, then renders ahead, and comes
// back only after a run of renders well inside their time. The release lead's
// conditions 1 (a fast first switch, kept on the device) and 3 (both ways, with
// hysteresis) are pinned here; the driver's tests drive it through a renderer.
// ---------------------------------------------------------------------------

const ON_TIME: ContactRecord = { timing: "on-time", workMs: 12, windowMs: 83 };
const LATE: ContactRecord = { timing: "late", workMs: 95, windowMs: 83 };
const MISS: ContactRecord = { timing: "miss", workMs: null, windowMs: 66 };

/** A Storage stand-in that keeps what is written, as a page's localStorage does. */
function memoryStorage(initial: Record<string, string> = {}): RenderStorage & { readonly kept: Map<string, string> } {
  const kept = new Map(Object.entries(initial));
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => { kept.set(key, value); },
  };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe("the adaptive render policy (R100)", () => {
  it("starts light and table pieces at their drop, and heavy pieces always ahead (R48)", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage());
    expect(policy.mode("light")).toBe("exact");
    expect(policy.mode("table")).toBe("exact");
    expect(policy.mode("heavy")).toBe("ahead");
  });

  it("switches a class that misses 2 of its first 5 contacts at once, and keeps only class and mode (condition 1)", () => {
    const storage = memoryStorage();
    const policy = new AdaptiveRenderPolicy(() => storage);
    expect(policy.recordContact("light", ON_TIME)).toBe("exact");
    expect(policy.recordContact("light", MISS)).toBe("exact");
    expect(policy.recordContact("light", ON_TIME)).toBe("exact");
    // The second miss, the class's fourth contact: no window to fill first.
    expect(policy.recordContact("light", MISS)).toBe("ahead");
    expect(policy.mode("light")).toBe("ahead");
    expect(policy.mode("table"), "each class decides alone").toBe("exact");
    expect(storage.kept.get(RENDER_MODE_STORAGE_KEY)).toBe(JSON.stringify({ light: "ahead", table: "exact" }));
    expect([...storage.kept.keys()]).toEqual([RENDER_MODE_STORAGE_KEY]);
  });

  it("does not switch for late voices, which play, nor for misses further apart than its window", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage());
    for (let i = 0; i < 30; i++) policy.recordContact("table", LATE);
    expect(policy.mode("table")).toBe("exact");
    policy.recordContact("table", MISS);
    for (let i = 0; i < SWITCH_WINDOW_CONTACTS - 1; i++) policy.recordContact("table", ON_TIME);
    // The first miss has left the window of the last 20 contacts.
    expect(policy.recordContact("table", MISS)).toBe("exact");
    expect(policy.recordContact("table", MISS), "two misses inside the window switch").toBe("ahead");
    expect(SWITCH_MISSES).toBe(2);
  });

  it("comes back to exact renders only after 10 on-time contacts in a row, each well inside its window (condition 3)", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage());
    policy.recordContact("light", MISS);
    policy.recordContact("light", MISS);
    expect(policy.mode("light")).toBe("ahead");
    for (let i = 0; i < BACK_TO_EXACT_ON_TIME - 1; i++) expect(policy.recordContact("light", ON_TIME)).toBe("ahead");
    // A late contact breaks the run.
    expect(policy.recordContact("light", LATE)).toBe("ahead");
    for (let i = 0; i < BACK_TO_EXACT_ON_TIME - 1; i++) policy.recordContact("light", ON_TIME);
    // On time, but its render took more than half the time it had: not well inside, so the run starts again.
    const tight: ContactRecord = { timing: "on-time", workMs: 83 * WELL_INSIDE_SHARE + 1, windowMs: 83 };
    expect(policy.recordContact("light", tight)).toBe("ahead");
    for (let i = 0; i < BACK_TO_EXACT_ON_TIME - 1; i++) expect(policy.recordContact("light", ON_TIME)).toBe("ahead");
    expect(policy.recordContact("light", ON_TIME)).toBe("exact");
    // Back at its drop, a single miss does not flap it straight back.
    expect(policy.recordContact("light", MISS)).toBe("exact");
  });

  it("counts an on-time contact with no Worker time as outside the run", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage());
    policy.recordContact("light", MISS);
    policy.recordContact("light", MISS);
    for (let i = 0; i < BACK_TO_EXACT_ON_TIME; i++) policy.recordContact("light", { timing: "on-time", workMs: null, windowMs: 83 });
    expect(policy.mode("light")).toBe("ahead");
  });

  it("never takes heavy pieces off render-ahead", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage({ [RENDER_MODE_STORAGE_KEY]: JSON.stringify({ heavy: "exact" }) }));
    for (let i = 0; i < 40; i++) policy.recordContact("heavy", ON_TIME);
    expect(policy.mode("heavy")).toBe("ahead");
  });

  it("starts the next visit in the mode this device settled on", () => {
    const storage = memoryStorage();
    const first = new AdaptiveRenderPolicy(() => storage);
    first.recordContact("table", MISS);
    first.recordContact("table", MISS);
    const next = new AdaptiveRenderPolicy(() => storage);
    expect(next.mode("table")).toBe("ahead");
    expect(next.mode("light")).toBe("exact");
  });

  it("uses the page's localStorage by default", () => {
    const policy = new AdaptiveRenderPolicy();
    policy.recordContact("light", MISS);
    policy.recordContact("light", MISS);
    expect(localStorage.getItem(RENDER_MODE_STORAGE_KEY)).toBe(JSON.stringify({ light: "ahead", table: "exact" }));
    expect(new AdaptiveRenderPolicy().mode("light")).toBe("ahead");
  });

  it("ignores a kept value it does not understand, and a storage that throws", () => {
    for (const kept of ["not json", "[\"ahead\"]", JSON.stringify({ light: "sometimes", table: 3, chair: "ahead" }), "null"]) {
      const policy = new AdaptiveRenderPolicy(() => memoryStorage({ [RENDER_MODE_STORAGE_KEY]: kept }));
      expect(policy.mode("light"), kept).toBe("exact");
      expect(policy.mode("table"), kept).toBe("exact");
    }
    const throwing: RenderStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
    };
    const policy = new AdaptiveRenderPolicy(() => throwing);
    expect(policy.mode("light")).toBe("exact");
    policy.recordContact("light", MISS);
    expect(() => policy.recordContact("light", MISS)).not.toThrow();
    expect(policy.mode("light"), "the switch holds for the visit though it cannot be kept").toBe("ahead");
    const unreachable = new AdaptiveRenderPolicy(() => { throw new Error("SecurityError"); });
    expect(unreachable.mode("table")).toBe("exact");
  });

  it("keeps each class's last 20 Worker times", () => {
    const policy = new AdaptiveRenderPolicy(() => memoryStorage());
    for (let i = 1; i <= 25; i++) policy.recordWork("light", i);
    policy.recordWork("heavy", 40);
    policy.recordWork("light", Number.NaN);
    expect(policy.recentWork("light")).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
    expect(policy.recentWork("heavy")).toEqual([40]);
    expect(policy.recentWork("table")).toEqual([]);
  });
});
