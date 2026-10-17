import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHallTimeStore } from "../hall-time-store.js";

const NOW = Date.UTC(2026, 9, 16, 13, 0);
const EVENT = Date.UTC(2026, 10, 14, 18, 30);

describe("hall time store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useHallTimeStore.setState({ mode: "now", at: 0, scrubbing: false, openedFor: null, chosen: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a plan without an event on the clock", () => {
    useHallTimeStore.getState().openFor("cfg-1|", null);
    const state = useHallTimeStore.getState();
    expect(state.mode).toBe("now");
    expect(state.at).toBe(NOW);
    expect(state.openedFor).toBe("cfg-1|");
    expect(state.chosen).toBe(false);
  });

  it("opens a plan at its event's start", () => {
    useHallTimeStore.getState().openFor("cfg-1|ev-1", EVENT);
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: EVENT, openedFor: "cfg-1|ev-1" });
  });

  it("takes an event start that arrives after the plan opened", () => {
    const { openFor } = useHallTimeStore.getState();
    openFor("cfg-1|ev-1", null);
    openFor("cfg-1|ev-1", EVENT);
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: EVENT });
  });

  it("keeps a time the planner chose over a late event start", () => {
    const store = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", null);
    store.setTime(NOW + 3_600_000);
    store.openFor("cfg-1|ev-1", EVENT);
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: NOW + 3_600_000, chosen: true });
  });

  it("counts following the clock as a choice", () => {
    const store = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", null);
    store.followNow();
    store.openFor("cfg-1|ev-1", EVENT);
    expect(useHallTimeStore.getState().mode).toBe("now");
  });

  it("opens the next plan afresh, forgetting the last plan's choice", () => {
    const store = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", EVENT);
    store.setTime(NOW + 7_200_000);
    store.openFor("cfg-2|", null);
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "now", at: NOW, openedFor: "cfg-2|", chosen: false });
  });

  it("leaves the state untouched when nothing changes", () => {
    const store = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", EVENT);
    const before = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", EVENT);
    expect(useHallTimeStore.getState()).toBe(before);
  });

  it("treats an unreadable start as no event, and ignores an unreadable time", () => {
    const store = useHallTimeStore.getState();
    store.openFor("cfg-1|ev-1", Number.NaN);
    expect(useHallTimeStore.getState().mode).toBe("now");
    store.setTime(Number.POSITIVE_INFINITY);
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "now", chosen: false });
  });

  it("marks a drag as scrubbing until the hand leaves", () => {
    const store = useHallTimeStore.getState();
    store.setTime(EVENT, true);
    expect(useHallTimeStore.getState()).toMatchObject({ at: EVENT, scrubbing: true });
    store.endScrub();
    expect(useHallTimeStore.getState()).toMatchObject({ at: EVENT, scrubbing: false, mode: "set" });
  });
});
