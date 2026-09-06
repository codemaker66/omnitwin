// The pokes store: per scene, per prop; distinct things derived, never stored;
// the persistence table's facts; cleared on BEGIN.
import { beforeEach, describe, expect, it } from "vitest";
import { IDLE_POKEABLE, type PokeableState } from "../../react/react-types.js";
import {
  conditionalsFrom,
  distinctProps,
  distinctPropsTouched,
  factHolds,
  pokeStateFor,
  scenePokes,
  selectDistinctProps,
  usePokesStore,
} from "../pokes-store.js";

function poked(count: number, lastPokeMs = 0): PokeableState {
  return { ...IDLE_POKEABLE, stage: count >= 2 ? "answered" : "touched", count, lastPokeMs, recentMs: [lastPokeMs] };
}

beforeEach(() => {
  usePokesStore.getState().clear();
});

describe("pokes-store", () => {
  it("starts empty and answers idle for anything never poked", () => {
    const state = usePokesStore.getState();
    expect(state.byScene).toEqual({});
    expect(state.persisted).toEqual({});
    expect(pokeStateFor(state, 0, "port-chain")).toBe(IDLE_POKEABLE);
    expect(scenePokes(state, 3)).toEqual({});
    expect(distinctProps(state, 0)).toBe(0);
  });

  it("records the state react() returned, per scene, per prop", () => {
    const { poke } = usePokesStore.getState();
    poke(0, "port-chain", poked(1));
    poke(0, "water", poked(3, 4_000));
    poke(1, "reeds", poked(1));
    const state = usePokesStore.getState();
    expect(pokeStateFor(state, 0, "port-chain").count).toBe(1);
    expect(pokeStateFor(state, 0, "water").count).toBe(3);
    expect(pokeStateFor(state, 1, "reeds").count).toBe(1);
    expect(pokeStateFor(state, 1, "water")).toBe(IDLE_POKEABLE);
  });

  it("a later poke replaces the prop's state without disturbing its neighbours", () => {
    const { poke } = usePokesStore.getState();
    poke(0, "port-chain", poked(1));
    poke(0, "water", poked(1));
    poke(0, "port-chain", poked(2, 9_000));
    const scene = scenePokes(usePokesStore.getState(), 0);
    expect(scene["port-chain"]?.count).toBe(2);
    expect(scene["port-chain"]?.lastPokeMs).toBe(9_000);
    expect(scene.water?.count).toBe(1);
  });

  it("distinct things are derived from the counts of one scene only", () => {
    const { poke } = usePokesStore.getState();
    poke(0, "port-chain", poked(1));
    poke(0, "water", poked(5));
    poke(0, "lantern", { ...IDLE_POKEABLE });
    poke(1, "reeds", poked(1));
    const state = usePokesStore.getState();
    expect(distinctProps(state, 0)).toBe(2);
    expect(distinctProps(state, 1)).toBe(1);
    expect(distinctProps(state, 2)).toBe(0);
    expect(selectDistinctProps(0)(state)).toBe(2);
    expect(distinctPropsTouched(state)).toBe(3);
  });

  it("drumming one thing never raises the distinct count", () => {
    const { poke } = usePokesStore.getState();
    for (let count = 1; count <= 30; count += 1) poke(0, "water", poked(count, count * 100));
    expect(distinctProps(usePokesStore.getState(), 0)).toBe(1);
  });

  it("keeps the persistence table's facts", () => {
    const { setPersisted } = usePokesStore.getState();
    setPersisted("chainSwing", true);
    setPersisted("initial", 7);
    expect(usePokesStore.getState().persisted).toEqual({ chainSwing: true, initial: 7 });
    setPersisted("chainSwing", false);
    expect(usePokesStore.getState().persisted.chainSwing).toBe(false);
  });

  it("clear() is BEGIN: nothing poked, nothing remembered", () => {
    const { poke, setPersisted, clear } = usePokesStore.getState();
    poke(0, "water", poked(2));
    setPersisted("chainSwing", true);
    clear();
    const state = usePokesStore.getState();
    expect(state.byScene).toEqual({});
    expect(state.persisted).toEqual({});
  });
});

describe("pokes-store: conditionals for the rows", () => {
  it("a fact holds when true or a non-zero number", () => {
    expect(factHolds(true)).toBe(true);
    expect(factHolds(false)).toBe(false);
    expect(factHolds(12)).toBe(true);
    expect(factHolds(-0.4)).toBe(true);
    expect(factHolds(0)).toBe(false);
    expect(factHolds(Number.NaN)).toBe(false);
  });

  it("maps the table's camelCase keys to the manifest's kebab ids, holding facts only", () => {
    const ids = conditionalsFrom({ chainSwing: true, childSeen: false, initial: 3, potStruck: 0, char: 1 });
    expect([...ids].sort()).toEqual(["chain-swing", "char", "initial"]);
    expect(conditionalsFrom({})).toEqual(new Set());
  });
});
