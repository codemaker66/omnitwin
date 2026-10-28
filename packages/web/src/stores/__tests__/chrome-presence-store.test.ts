import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/planner-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/planner-keys.js")>();
  return { ...actual, closeOpenLayers: vi.fn(() => 0) };
});

// ---------------------------------------------------------------------------
// Chrome the person folds away (T-680): what this device remembers, what it
// forgets, and that a broken or blocked storage never costs the planner.
// The store reads storage when it loads, so each case loads a fresh copy.
// ---------------------------------------------------------------------------

const KEY = "venviewer.planner-chrome-folds";
const ALL_OPEN = { left: false, right: false, top: false, bottom: false };

async function freshStore(): Promise<typeof import("../chrome-presence-store.js")> {
  vi.resetModules();
  return import("../chrome-presence-store.js");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the chrome presence store", () => {
  it("starts open with nothing stored", async () => {
    const { useChromePresenceStore } = await freshStore();
    const state = useChromePresenceStore.getState();
    expect(state.folded).toEqual(ALL_OPEN);
    expect(state.cleared).toBe(false);
    expect(state.hintPending).toBe(false);
  });

  it("remembers a fold", async () => {
    const { useChromePresenceStore } = await freshStore();
    useChromePresenceStore.getState().fold("left");
    expect(window.localStorage.getItem(KEY)).toBe('{"v":1,"folded":{"left":true,"right":false,"top":false,"bottom":false},"hints":0}');

    const reloaded = await freshStore();
    expect(reloaded.useChromePresenceStore.getState().folded).toEqual({ ...ALL_OPEN, left: true });
  });

  it("reads malformed storage as everything open", async () => {
    const { readRememberedFolds } = await freshStore();
    const malformed = ["{", "null", "[]", JSON.stringify({ v: 2, folded: ALL_OPEN }), JSON.stringify({ v: 1, folded: { left: "yes" } }), JSON.stringify({ v: 1, folded: { left: true } })];
    for (const raw of malformed) {
      expect(readRememberedFolds({ getItem: () => raw }).folds, raw).toEqual(ALL_OPEN);
    }
    expect(readRememberedFolds({ getItem: () => { throw new Error("blocked"); } }).folds).toEqual(ALL_OPEN);
    expect(readRememberedFolds(null)).toEqual({ folds: ALL_OPEN, hints: 0 });
  });

  it("keeps a hint count it can trust", async () => {
    const { readRememberedFolds } = await freshStore();
    const stored = (hints: unknown): string => JSON.stringify({ v: 1, folded: ALL_OPEN, hints });
    expect(readRememberedFolds({ getItem: () => stored(2) }).hints).toBe(2);
    expect(readRememberedFolds({ getItem: () => stored(40) }).hints).toBe(3);
    expect(readRememberedFolds({ getItem: () => stored(-1) }).hints).toBe(0);
    expect(readRememberedFolds({ getItem: () => stored(1.5) }).hints).toBe(0);
  });

  // Replacing the whole object, as convener-voice.test.ts does: a spy on
  // happy-dom's localStorage outlives vi.restoreAllMocks and blocks every
  // later case's storage, so the spy pattern proves nothing here.
  async function withStorage(replacement: PropertyDescriptor, run: () => Promise<void>): Promise<void> {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", { configurable: true, ...replacement });
    try {
      await run();
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  }

  it("survives storage that throws", async () => {
    const boom = (): never => { throw new Error("blocked"); };
    await withStorage({ value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } }, async () => {
      const { useChromePresenceStore } = await freshStore();
      expect(() => { useChromePresenceStore.getState().fold("right"); }).not.toThrow();
      expect(() => { useChromePresenceStore.getState().clearAll(); }).not.toThrow();
      expect(useChromePresenceStore.getState().folded.right).toBe(true);
      expect(useChromePresenceStore.getState().cleared).toBe(true);
    });
  });

  it("survives storage that cannot even be reached", async () => {
    await withStorage({ get: () => { throw new Error("SecurityError"); } }, async () => {
      const { useChromePresenceStore } = await freshStore();
      expect(useChromePresenceStore.getState().folded).toEqual(ALL_OPEN);
      expect(() => { useChromePresenceStore.getState().fold("top"); }).not.toThrow();
      expect(useChromePresenceStore.getState().folded.top).toBe(true);
    });
  });

  it("clearAll keeps the folds and restoreAll returns them", async () => {
    const { useChromePresenceStore } = await freshStore();
    const store = useChromePresenceStore.getState();
    store.fold("top");
    store.clearAll();
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    expect(useChromePresenceStore.getState().folded).toEqual({ ...ALL_OPEN, top: true });
    useChromePresenceStore.getState().restoreAll();
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(useChromePresenceStore.getState().folded).toEqual({ ...ALL_OPEN, top: true });
  });

  it("never remembers cleared", async () => {
    const { useChromePresenceStore } = await freshStore();
    useChromePresenceStore.getState().clearAll();
    expect(window.localStorage.getItem(KEY)).not.toContain("cleared");
    const reloaded = await freshStore();
    expect(reloaded.useChromePresenceStore.getState().cleared).toBe(false);
  });

  it("counts the hint to three", async () => {
    const { useChromePresenceStore, CLEAR_HINT_LIMIT } = await freshStore();
    const due: boolean[] = [];
    for (let i = 0; i < CLEAR_HINT_LIMIT + 1; i += 1) {
      useChromePresenceStore.getState().clearAll();
      due.push(useChromePresenceStore.getState().hintPending);
      useChromePresenceStore.getState().restoreAll();
    }
    expect(due).toEqual([true, true, true, false]);
    expect(useChromePresenceStore.getState().hintsShown).toBe(3);
    const reloaded = await freshStore();
    reloaded.useChromePresenceStore.getState().clearAll();
    expect(reloaded.useChromePresenceStore.getState().hintPending).toBe(false);
  });

  it("fold and clearAll close open popovers and panels", async () => {
    const { useChromePresenceStore } = await freshStore();
    const keys = await import("../../lib/planner-keys.js");
    useChromePresenceStore.getState().fold("bottom");
    expect(keys.closeOpenLayers).toHaveBeenLastCalledWith(["popover", "panel"]);
    vi.mocked(keys.closeOpenLayers).mockClear();
    useChromePresenceStore.getState().unfold("bottom");
    expect(keys.closeOpenLayers).not.toHaveBeenCalled();
    useChromePresenceStore.getState().clearAll();
    expect(keys.closeOpenLayers).toHaveBeenCalledWith(["popover", "panel"]);
  });

  it("resetCleared clears without touching folds", async () => {
    const { useChromePresenceStore } = await freshStore();
    useChromePresenceStore.getState().fold("right");
    useChromePresenceStore.getState().clearAll();
    useChromePresenceStore.getState().resetCleared();
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(useChromePresenceStore.getState().hintPending).toBe(false);
    expect(useChromePresenceStore.getState().folded).toEqual({ ...ALL_OPEN, right: true });
  });

  it("toggles one unit and the whole chrome", async () => {
    const { useChromePresenceStore } = await freshStore();
    useChromePresenceStore.getState().toggleFold("left");
    expect(useChromePresenceStore.getState().folded.left).toBe(true);
    useChromePresenceStore.getState().toggleFold("left");
    expect(useChromePresenceStore.getState().folded.left).toBe(false);
    useChromePresenceStore.getState().toggleCleared();
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    useChromePresenceStore.getState().toggleCleared();
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });
});
