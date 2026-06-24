import { afterEach, describe, expect, it } from "vitest";
import {
  useLightingRigStore,
  DEFAULT_RIG_COUNTS,
  rigGroupsForRig,
  importedRigWeightKg,
  fixtureDisplayLabel,
  type ImportedFixtureSpec,
} from "../lighting-rig-store.js";

const MEGAPOINTE: ImportedFixtureSpec = {
  manufacturer: "Robe",
  name: "MegaPointe",
  family: "beam-hybrid",
  channels: 40,
  weightKg: 25,
  modeName: "Mode 1 (Standard)",
};

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

describe("lighting-rig-store — imported fixtures", () => {
  it("adds an imported fixture with a derived id and count 1", () => {
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE);
    const { imported } = useLightingRigStore.getState();
    expect(imported).toHaveLength(1);
    expect(imported[0]?.count).toBe(1);
    expect(imported[0]?.channels).toBe(40);
    expect(imported[0]?.id).toBe("robe|megapointe|mode-1-(standard)");
  });

  it("bumps the count when the same fixture+mode is added again", () => {
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE);
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE, 2);
    const { imported } = useLightingRigStore.getState();
    expect(imported).toHaveLength(1);
    expect(imported[0]?.count).toBe(3);
  });

  it("sets a count and removes when set to zero", () => {
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE);
    const id = useLightingRigStore.getState().imported[0]?.id ?? "";
    useLightingRigStore.getState().setImportedCount(id, 6);
    expect(useLightingRigStore.getState().imported[0]?.count).toBe(6);
    useLightingRigStore.getState().setImportedCount(id, 0);
    expect(useLightingRigStore.getState().imported).toHaveLength(0);
  });

  it("clear and reset both drop imported fixtures", () => {
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE);
    useLightingRigStore.getState().clear();
    expect(useLightingRigStore.getState().imported).toHaveLength(0);
    useLightingRigStore.getState().addImportedFixture(MEGAPOINTE);
    useLightingRigStore.getState().reset();
    expect(useLightingRigStore.getState().imported).toHaveLength(0);
  });
});

describe("rigGroupsForRig", () => {
  it("appends imported fixtures with their real channels + label after the family groups", () => {
    useLightingRigStore.getState().clear();
    useLightingRigStore.getState().setCount("par", 4);
    const { counts } = useLightingRigStore.getState();
    const groups = rigGroupsForRig(counts, [{ ...MEGAPOINTE, id: "x", count: 2 }]);
    // Family groups first (par), then the imported fixture carrying its footprint.
    expect(groups[0]).toEqual({ family: "par", count: 4 });
    expect(groups[1]).toEqual({ family: "beam-hybrid", count: 2, channels: 40, label: "Robe MegaPointe" });
  });
});

describe("fixtureDisplayLabel", () => {
  it("prefixes the manufacturer, but not when the name already contains it", () => {
    expect(fixtureDisplayLabel("Robe", "MegaPointe")).toBe("Robe MegaPointe");
    expect(fixtureDisplayLabel("Robe", "Robe MegaPointe Beam")).toBe("Robe MegaPointe Beam");
  });
});

describe("importedRigWeightKg", () => {
  it("sums weight × count, ignoring fixtures with unknown weight", () => {
    expect(importedRigWeightKg([
      { ...MEGAPOINTE, id: "a", count: 4 },
      { ...MEGAPOINTE, id: "b", weightKg: null, count: 10 },
    ])).toBe(100);
  });
});
