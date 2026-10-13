import { beforeEach, describe, expect, it } from "vitest";
import { useHallViewStore } from "../hall-view-store.js";

describe("hall view store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useHallViewStore.setState({ viewRequest: null, activePreset: "room", surfaces: null });
  });

  it("remembers the chosen light on this device", () => {
    useHallViewStore.getState().setMood("candlelight");
    expect(useHallViewStore.getState().mood).toBe("candlelight");
    expect(window.localStorage.getItem("venviewer.hall-mood.v1")).toBe("candlelight");
  });

  it("issues each view request once, with a fresh nonce", () => {
    const store = useHallViewStore.getState();
    store.requestView("plan");
    const first = useHallViewStore.getState().viewRequest;
    expect(first?.preset).toBe("plan");
    store.requestView("plan");
    const second = useHallViewStore.getState().viewRequest;
    expect(second?.nonce).not.toBe(first?.nonce);
    store.clearViewRequest(first?.nonce ?? -1);
    expect(useHallViewStore.getState().viewRequest).toEqual(second);
    store.clearViewRequest(second?.nonce ?? -1);
    expect(useHallViewStore.getState().viewRequest).toBeNull();
  });

  it("counts the hall's surfaces in, and never past their total", () => {
    const store = useHallViewStore.getState();
    store.startSurfaces(3);
    store.settleSurface(true);
    store.settleSurface(false);
    expect(useHallViewStore.getState().surfaces).toEqual({ total: 3, loaded: 1, failed: 1 });
    store.settleSurface(true);
    store.settleSurface(true);
    expect(useHallViewStore.getState().surfaces).toEqual({ total: 3, loaded: 2, failed: 1 });
    store.endSurfaces();
    expect(useHallViewStore.getState().surfaces).toBeNull();
    // A late arrival after the hall has gone changes nothing.
    store.settleSurface(true);
    expect(useHallViewStore.getState().surfaces).toBeNull();
  });
});
