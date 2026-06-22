import { afterEach, describe, expect, it } from "vitest";
import { useLightingRigStore, DEFAULT_RIG_COUNTS } from "../lighting-rig-store.js";

afterEach(() => { useLightingRigStore.getState().reset(); });

describe("lighting-rig-store", () => {
  it("starts from the illustrative starter rig", () => {
    const { counts } = useLightingRigStore.getState();
    expect(counts.par).toBe(DEFAULT_RIG_COUNTS.par);
    expect(counts.wash).toBe(DEFAULT_RIG_COUNTS.wash);
    expect(counts.profile).toBe(DEFAULT_RIG_COUNTS.profile);
    expect(counts.spot).toBe(0);
  });

  it("sets counts, flooring decimals and clamping negatives to zero", () => {
    useLightingRigStore.getState().setCount("spot", 6);
    expect(useLightingRigStore.getState().counts.spot).toBe(6);
    useLightingRigStore.getState().setCount("spot", 4.9);
    expect(useLightingRigStore.getState().counts.spot).toBe(4);
    useLightingRigStore.getState().setCount("spot", -3);
    expect(useLightingRigStore.getState().counts.spot).toBe(0);
  });

  it("clears the whole rig to zero", () => {
    useLightingRigStore.getState().clear();
    const { counts } = useLightingRigStore.getState();
    expect(counts.par).toBe(0);
    expect(counts.wash).toBe(0);
    expect(counts.profile).toBe(0);
  });

  it("reset restores the starter rig", () => {
    useLightingRigStore.getState().clear();
    useLightingRigStore.getState().reset();
    expect(useLightingRigStore.getState().counts.par).toBe(DEFAULT_RIG_COUNTS.par);
  });
});
