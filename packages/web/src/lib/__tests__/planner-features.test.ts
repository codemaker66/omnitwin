import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLANNER_FEATURE_SPECS,
  PLANNER_FEATURES_STORAGE_KEY,
  formatPlannerFeatureList,
  parsePlannerFeatureList,
  plannerFeatureEnabled,
  plannerFeatures,
  resolvePlannerFeatures,
  setPlannerFeaturesForTesting,
} from "../planner-features.js";

function visit(search: string): void {
  window.history.replaceState({}, "", `/plan${search}`);
}

beforeEach(() => {
  setPlannerFeaturesForTesting(null);
  window.localStorage.clear();
  visit("");
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
  window.localStorage.clear();
  visit("");
});

describe("planner features: everyone's switches", () => {
  it("has every lane's key, including P's touch arbiter and lean motion pipeline", () => {
    expect(Object.keys(PLANNER_FEATURE_SPECS)).toEqual(expect.arrayContaining([
      "touchArbiter", "leanMotionPipeline", "seatsOnTheCard",
      "setupCards", "truthfulGhost", "tableNumbers", "editingKeys", "fillKeepOuts", "liveAisles",
      "storeCounts", "putBack", "lineUp", "moveVerb", "tableSets", "replace",
    ]));
  });

  it("keeps every slice off until it is green", () => {
    for (const enabled of Object.values(plannerFeatures())) expect(enabled).toBe(false);
  });

  it("names a lane and a quality-of-life item for every key", () => {
    for (const spec of Object.values(PLANNER_FEATURE_SPECS)) {
      expect(["E", "P"]).toContain(spec.lane);
      expect(spec.item).toMatch(/^Q-\d{2}[ab]?$/u);
    }
  });
});

describe("planner features: the ?pf= list", () => {
  it("reads names as on and -names as off, ignoring unknown names", () => {
    expect(parsePlannerFeatureList(" touchArbiter, -setupCards,nonsense,")).toEqual({ touchArbiter: true, setupCards: false });
  });

  it("lets the last mention of a key win", () => {
    expect(parsePlannerFeatureList("tableNumbers,-tableNumbers")).toEqual({ tableNumbers: false });
  });

  it("writes overrides back in the keys' own order", () => {
    expect(formatPlannerFeatureList({ replace: true, touchArbiter: false })).toBe("-touchArbiter,replace");
  });

  it("lays overrides over everyone's switches", () => {
    const features = resolvePlannerFeatures({ liveAisles: true });
    expect(features.liveAisles).toBe(true);
    expect(features.touchArbiter).toBe(false);
  });
});

describe("planner features: this device", () => {
  it("turns a key on from the address and remembers it", () => {
    visit("?pf=touchArbiter");
    expect(plannerFeatureEnabled("touchArbiter")).toBe(true);
    expect(window.localStorage.getItem(PLANNER_FEATURES_STORAGE_KEY)).toBe("touchArbiter");
    visit("");
    expect(plannerFeatureEnabled("touchArbiter")).toBe(true);
  });

  it("forgets the remembered list on an empty ?pf=", () => {
    window.localStorage.setItem(PLANNER_FEATURES_STORAGE_KEY, "touchArbiter");
    visit("?pf=");
    expect(plannerFeatureEnabled("touchArbiter")).toBe(false);
    expect(window.localStorage.getItem(PLANNER_FEATURES_STORAGE_KEY)).toBeNull();
  });

  it("reads the address again when it changes", () => {
    visit("?pf=setupCards");
    expect(plannerFeatureEnabled("setupCards")).toBe(true);
    visit("?pf=-setupCards");
    expect(plannerFeatureEnabled("setupCards")).toBe(false);
  });

  it("still answers when storage throws", () => {
    const storage = window.localStorage;
    const failing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: failing });
    try {
      visit("?pf=putBack");
      expect(plannerFeatureEnabled("putBack")).toBe(true);
      visit("");
      expect(plannerFeatureEnabled("putBack")).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    }
  });

  it("lets a test force switches regardless of the address", () => {
    visit("?pf=-replace");
    setPlannerFeaturesForTesting({ replace: true });
    expect(plannerFeatureEnabled("replace")).toBe(true);
    setPlannerFeaturesForTesting(null);
    expect(plannerFeatureEnabled("replace")).toBe(false);
  });
});
