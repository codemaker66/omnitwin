import { describe, expect, it } from "vitest";
import { markWelcomeSeen, shouldShowWelcome, welcomeStorageKey } from "../welcome.js";

// ---------------------------------------------------------------------------
// First-run welcome gating (T-520): shown once per user per device, sturdy
// against storage that throws (private browsing), keyed per user so a shared
// front-desk machine still greets each coordinator once.
// ---------------------------------------------------------------------------

const USER_A = "00000000-0000-4000-8000-0000000000aa";
const USER_B = "00000000-0000-4000-8000-0000000000bb";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => {
      throw new Error("denied");
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error("denied");
    },
  };
}

describe("welcome gating", () => {
  it("shows on the first visit and never after dismissal", () => {
    const storage = memoryStorage();
    expect(shouldShowWelcome(USER_A, storage)).toBe(true);
    markWelcomeSeen(USER_A, storage);
    expect(shouldShowWelcome(USER_A, storage)).toBe(false);
  });

  it("keys per user — a shared machine greets each coordinator once", () => {
    const storage = memoryStorage();
    markWelcomeSeen(USER_A, storage);
    expect(shouldShowWelcome(USER_A, storage)).toBe(false);
    expect(shouldShowWelcome(USER_B, storage)).toBe(true);
    expect(welcomeStorageKey(USER_A)).not.toBe(welcomeStorageKey(USER_B));
  });

  it("storage that throws never crashes — teaching wins, dismissal degrades", () => {
    const storage = throwingStorage();
    expect(shouldShowWelcome(USER_A, storage)).toBe(true);
    expect(() => {
      markWelcomeSeen(USER_A, storage);
    }).not.toThrow();
  });
});
