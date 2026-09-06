// The prefs round-trip through a fake storage, the defaults (Voice on, Sound
// off, Captions on), and reduced motion as Still or the OS, with the media
// query subscribed once.
import { describe, expect, it } from "vitest";
import {
  createPrefsStore,
  PREFS_STORAGE_KEY,
  readPersistedPrefs,
  REDUCED_MOTION_QUERY,
  selectReducedMotion,
  usePrefsStore,
  type PrefsMatchMedia,
  type PrefsStorage,
} from "../prefs-store.js";
import { DEFAULT_PREFS } from "../run-types.js";

class FakeStorage implements PrefsStorage {
  readonly records = new Map<string, string>();
  getItem(key: string): string | null {
    return this.records.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.records.set(key, value);
  }
}

class DeniedStorage implements PrefsStorage {
  getItem(): string | null {
    throw new Error("SecurityError: storage denied");
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

interface FakeMedia {
  readonly matchMedia: PrefsMatchMedia;
  readonly queries: string[];
  fire(matches: boolean): void;
}

function fakeMedia(matches: boolean): FakeMedia {
  const queries: string[] = [];
  const listeners: ((event: { readonly matches: boolean }) => void)[] = [];
  return {
    queries,
    matchMedia: (query) => {
      queries.push(query);
      return {
        matches,
        addEventListener: (_type, listener) => {
          listeners.push(listener);
        },
      };
    },
    fire: (next) => {
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

describe("prefs-store: defaults", () => {
  it("Voice on, Sound off, Captions on, Still off", () => {
    const store = createPrefsStore({ storage: new FakeStorage(), matchMedia: null });
    const state = store.getState();
    expect(state.voice).toBe(true);
    expect(state.sound).toBe(false);
    expect(state.captions).toBe(true);
    expect(state.still).toBe(false);
    expect(state.osReducedMotion).toBe(false);
    expect(DEFAULT_PREFS).toEqual({ voice: true, sound: false, captions: true, still: false });
  });

  it("the page's store starts on the defaults in a fresh browser", () => {
    const state = usePrefsStore.getState();
    expect(state.voice).toBe(true);
    expect(state.sound).toBe(false);
    expect(state.captions).toBe(true);
  });

  it("no storage at all is the defaults, not an error", () => {
    expect(readPersistedPrefs(null)).toEqual(DEFAULT_PREFS);
    const store = createPrefsStore({ storage: null, matchMedia: null });
    store.getState().setSound(true);
    expect(store.getState().sound).toBe(true);
  });
});

describe("prefs-store: persistence", () => {
  it("round-trips through storage under the versioned key", () => {
    const storage = new FakeStorage();
    const first = createPrefsStore({ storage, matchMedia: null });
    first.getState().setSound(true);
    first.getState().setStill(true);
    first.getState().setCaptions(false);

    const record: unknown = JSON.parse(storage.records.get(PREFS_STORAGE_KEY) ?? "null");
    expect(record).toEqual({ v: 1, voice: true, sound: true, captions: false, still: true });

    const second = createPrefsStore({ storage, matchMedia: null });
    const state = second.getState();
    expect(state.sound).toBe(true);
    expect(state.still).toBe(true);
    expect(state.captions).toBe(false);
    expect(state.voice).toBe(true);
  });

  it("a record that is not JSON, not this version, or not this shape yields the defaults", () => {
    for (const raw of ["not json", '{"v":2,"voice":true,"sound":true,"captions":true,"still":true}', '{"v":1,"voice":"yes"}', "null"]) {
      const storage = new FakeStorage();
      storage.setItem(PREFS_STORAGE_KEY, raw);
      expect(createPrefsStore({ storage, matchMedia: null }).getState().sound).toBe(false);
      expect(readPersistedPrefs(storage)).toEqual(DEFAULT_PREFS);
    }
  });

  it("a storage that throws leaves the defaults and the setters still work for the session", () => {
    const store = createPrefsStore({ storage: new DeniedStorage(), matchMedia: null });
    expect(store.getState().voice).toBe(true);
    store.getState().setVoice(false);
    expect(store.getState().voice).toBe(false);
  });

  it("reset restores and persists the defaults", () => {
    const storage = new FakeStorage();
    const store = createPrefsStore({ storage, matchMedia: null });
    store.getState().setSound(true);
    store.getState().reset();
    expect(store.getState().sound).toBe(false);
    expect(JSON.parse(storage.records.get(PREFS_STORAGE_KEY) ?? "null")).toEqual({ v: 1, ...DEFAULT_PREFS });
  });

  it("the OS setting is never persisted", () => {
    const storage = new FakeStorage();
    const store = createPrefsStore({ storage, matchMedia: fakeMedia(true).matchMedia });
    store.getState().setVoice(false);
    expect(storage.records.get(PREFS_STORAGE_KEY)).not.toContain("osReducedMotion");
  });
});

describe("prefs-store: reduced motion", () => {
  it("is Still or the OS setting", () => {
    const os = fakeMedia(true);
    const withOs = createPrefsStore({ storage: new FakeStorage(), matchMedia: os.matchMedia });
    expect(selectReducedMotion(withOs.getState())).toBe(true);
    expect(withOs.getState().still).toBe(false);

    const withoutOs = createPrefsStore({ storage: new FakeStorage(), matchMedia: fakeMedia(false).matchMedia });
    expect(selectReducedMotion(withoutOs.getState())).toBe(false);
    withoutOs.getState().setStill(true);
    expect(selectReducedMotion(withoutOs.getState())).toBe(true);
  });

  it("follows the OS when it changes, and Still still wins", () => {
    const os = fakeMedia(false);
    const store = createPrefsStore({ storage: new FakeStorage(), matchMedia: os.matchMedia });
    expect(selectReducedMotion(store.getState())).toBe(false);
    os.fire(true);
    expect(selectReducedMotion(store.getState())).toBe(true);
    os.fire(false);
    expect(selectReducedMotion(store.getState())).toBe(false);
    store.getState().setStill(true);
    os.fire(false);
    expect(selectReducedMotion(store.getState())).toBe(true);
  });

  it("subscribes the media query exactly once, at creation", () => {
    const os = fakeMedia(false);
    const store = createPrefsStore({ storage: new FakeStorage(), matchMedia: os.matchMedia });
    store.getState().setSound(true);
    store.getState().setStill(true);
    selectReducedMotion(store.getState());
    selectReducedMotion(store.getState());
    expect(os.queries).toEqual([REDUCED_MOTION_QUERY]);
  });

  it("a matchMedia that throws leaves Still in charge", () => {
    const store = createPrefsStore({
      storage: new FakeStorage(),
      matchMedia: () => {
        throw new Error("no media queries here");
      },
    });
    expect(selectReducedMotion(store.getState())).toBe(false);
    store.getState().setStill(true);
    expect(selectReducedMotion(store.getState())).toBe(true);
  });
});
