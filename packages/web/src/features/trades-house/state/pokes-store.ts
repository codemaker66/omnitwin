// -----------------------------------------------------------------------------
// pokes-store — what has been poked this run: per scene, per prop, the
// PokeableState the reducer last returned, plus the run-persistent facts from
// the persistence table (spec section 5: initial, chainSwing, char, potStruck,
// sluiceLifted, childSeen, and nothing else). Cleared on BEGIN. The number of
// distinct things touched is derived here and never stored, so the rare rows
// that key on it can never drift from the counts. Motion state never enters
// this store: springs live in refs.
// -----------------------------------------------------------------------------
import { create } from "zustand";
import type { PERSIST_KEYS } from "../stage/stage-manifest.js";
import { IDLE_POKEABLE, type PokeableState } from "../react/react-types.js";
import type { PersistedFacts, PokesState } from "./run-types.js";

/** The persistence table's keys; the store accepts no other. */
export type PersistKey = (typeof PERSIST_KEYS)[number];

export interface PokesStore extends PokesState {
  /** Record the state `react()` returned for a prop. */
  readonly poke: (sceneIndex: number, propId: string, next: PokeableState) => void;
  readonly setPersisted: (key: PersistKey, value: number | boolean) => void;
  /** BEGIN: a new run starts with nothing poked and nothing remembered. */
  readonly clear: () => void;
}

export const EMPTY_POKES: PokesState = { byScene: {}, persisted: {} };
const EMPTY_SCENE: Readonly<Record<string, PokeableState>> = {};

/** A scene's poke states, keyed by prop id; empty for a scene never touched. */
export function scenePokes(
  state: PokesState,
  sceneIndex: number,
): Readonly<Record<string, PokeableState>> {
  return state.byScene[sceneIndex] ?? EMPTY_SCENE;
}

/** One prop's state, idle when it has never been poked. */
export function pokeStateFor(state: PokesState, sceneIndex: number, propId: string): PokeableState {
  return scenePokes(state, sceneIndex)[propId] ?? IDLE_POKEABLE;
}

/** Distinct things touched in one scene: the count the "distinctProps:n" rows read. */
export function distinctProps(state: PokesState, sceneIndex: number): number {
  return Object.values(scenePokes(state, sceneIndex)).filter((poke) => poke.count > 0).length;
}

/** Distinct things touched across the run, for scene 12's mark and the run record. */
export function distinctPropsTouched(state: PokesState): number {
  return Object.keys(state.byScene).reduce(
    (total, key) => total + distinctProps(state, Number(key)),
    0,
  );
}

/** A selector for one scene's distinct count; the value is a primitive, so it is cheap to subscribe. */
export function selectDistinctProps(sceneIndex: number): (state: PokesState) => number {
  return (state) => distinctProps(state, sceneIndex);
}

/** A persisted fact holds when it is `true` or a non-zero number (an angle the chain was left at). */
export function factHolds(value: number | boolean): boolean {
  return typeof value === "boolean" ? value : Number.isFinite(value) && value !== 0;
}

/**
 * The ids a "conditional:<id>" row may fire on: every persisted fact that
 * holds, its key in kebab case, because the persistence table's keys are
 * camelCase (`chainSwing`) and StageRowSchema admits only lowercase ids
 * (`conditional:chain-swing`). One mapping, here, for the whole stage.
 */
export function conditionalsFrom(persisted: PersistedFacts): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(persisted)) {
    if (factHolds(value)) ids.add(key.replace(/[A-Z]/gu, (upper) => `-${upper.toLowerCase()}`));
  }
  return ids;
}

export const usePokesStore = create<PokesStore>()((set) => ({
  ...EMPTY_POKES,
  poke: (sceneIndex, propId, next) => {
    set((state) => ({
      byScene: {
        ...state.byScene,
        [sceneIndex]: { ...scenePokes(state, sceneIndex), [propId]: next },
      },
    }));
  },
  setPersisted: (key, value) => {
    set((state) => ({ persisted: { ...state.persisted, [key]: value } }));
  },
  clear: () => {
    set({ byScene: {}, persisted: {} });
  },
}));
