// -----------------------------------------------------------------------------
// prefs-store — Voice, Sound, Captions and Still (spec section 6 and section
// 10): Voice on, Sound off and Captions on by default, persisted in
// localStorage under a versioned key so a returning reader finds the runes
// where they left them. Storage is best effort behind try/catch: a private
// window or a denied origin degrades to session-only, never to an error.
//
// Reduced motion is `still || the OS setting`. The visible Still switch is
// reduced motion regardless of the OS; the OS media query is subscribed once,
// at creation, and lands in `osReducedMotion`, so every rAF loop reads one
// selector and never touches matchMedia itself.
// -----------------------------------------------------------------------------
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { z } from "zod";
import { DEFAULT_PREFS, type PrefsState } from "./run-types.js";

export const PREFS_STORAGE_KEY = "trades-house-quiz-prefs.v1";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PersistedPrefsSchema = z.object({
  v: z.literal(1),
  voice: z.boolean(),
  sound: z.boolean(),
  captions: z.boolean(),
  still: z.boolean(),
});

/** What the store needs of a storage; `localStorage` satisfies it, so does a Map-backed double. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What the store needs of a media query list; `MediaQueryList` satisfies it. */
export interface PrefsMediaQueryList {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
}
export type PrefsMatchMedia = (query: string) => PrefsMediaQueryList;

export interface PrefsStore extends PrefsState {
  /** The OS's prefers-reduced-motion, subscribed once; `still` overrides it either way. */
  readonly osReducedMotion: boolean;
  readonly setVoice: (on: boolean) => void;
  readonly setSound: (on: boolean) => void;
  readonly setCaptions: (on: boolean) => void;
  readonly setStill: (on: boolean) => void;
  /** Back to the defaults, persisted. */
  readonly reset: () => void;
}

/** Reduced motion for every loop on the stage: the Still switch, or the OS. */
export function selectReducedMotion(state: Pick<PrefsStore, "still" | "osReducedMotion">): boolean {
  return state.still || state.osReducedMotion;
}

function pickPrefs(state: PrefsState): PrefsState {
  return { voice: state.voice, sound: state.sound, captions: state.captions, still: state.still };
}

/** The persisted prefs, or the defaults when the record is absent, foreign or unreadable. */
export function readPersistedPrefs(storage: PrefsStorage | null): PrefsState {
  if (storage === null) return DEFAULT_PREFS;
  try {
    const raw = storage.getItem(PREFS_STORAGE_KEY);
    if (raw === null) return DEFAULT_PREFS;
    const parsed = PersistedPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? pickPrefs(parsed.data) : DEFAULT_PREFS;
  } catch {
    // Storage denied, or a record that is not JSON: the defaults, silently.
    return DEFAULT_PREFS;
  }
}

export function writePersistedPrefs(storage: PrefsStorage | null, prefs: PrefsState): void {
  if (storage === null) return;
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ v: 1, ...pickPrefs(prefs) }));
  } catch {
    // Quota or a private window: the choice holds for the session only.
  }
}

function defaultStorage(): PrefsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Reading `window.localStorage` itself throws where cookies are blocked.
    return null;
  }
}

function defaultMatchMedia(): PrefsMatchMedia | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return (query) => window.matchMedia(query);
}

function subscribeReducedMotion(
  store: StoreApi<PrefsStore>,
  matchMedia: PrefsMatchMedia | null,
): void {
  if (matchMedia === null) return;
  try {
    const list = matchMedia(REDUCED_MOTION_QUERY);
    store.setState({ osReducedMotion: list.matches });
    list.addEventListener("change", (event) => {
      store.setState({ osReducedMotion: event.matches });
    });
  } catch {
    // No media queries here (a worker, a bare test double): Still alone rules.
  }
}

export interface CreatePrefsStoreOptions {
  /** Omit for localStorage; null for none. */
  readonly storage?: PrefsStorage | null;
  /** Omit for window.matchMedia; null for none. */
  readonly matchMedia?: PrefsMatchMedia | null;
}

/**
 * Builds a prefs store over the given storage and media query, so tests can
 * hand in doubles and the page uses the default below.
 */
export function createPrefsStore(
  options: CreatePrefsStoreOptions = {},
): UseBoundStore<StoreApi<PrefsStore>> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const matchMedia = options.matchMedia === undefined ? defaultMatchMedia() : options.matchMedia;
  const initial = readPersistedPrefs(storage);

  const store = create<PrefsStore>()((set, get) => {
    const commit = (patch: Partial<PrefsState>): void => {
      set(patch);
      writePersistedPrefs(storage, pickPrefs(get()));
    };
    return {
      ...initial,
      osReducedMotion: false,
      setVoice: (on) => { commit({ voice: on }); },
      setSound: (on) => { commit({ sound: on }); },
      setCaptions: (on) => { commit({ captions: on }); },
      setStill: (on) => { commit({ still: on }); },
      reset: () => { commit({ ...DEFAULT_PREFS }); },
    };
  });

  subscribeReducedMotion(store, matchMedia);
  return store;
}

/** The page's store: localStorage and the OS media query, subscribed once here. */
export const usePrefsStore = createPrefsStore();

/** Reduced motion as a hook, for components; loops read `selectReducedMotion` off `getState()`. */
export function useQuizReducedMotion(): boolean {
  return usePrefsStore(selectReducedMotion);
}
