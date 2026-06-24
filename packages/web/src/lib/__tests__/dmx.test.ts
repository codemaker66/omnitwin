import { describe, it, expect } from "vitest";
import {
  buildDmxPatch,
  estimateRigPower,
  rigGroupsFromCounts,
  fixtureFamilyLabel,
  fixtureWattsFromGroups,
  DMX_UNIVERSE_SIZE,
  FIXTURE_FAMILY_DMX_CHANNELS,
  FIXTURE_FAMILY_WATTS,
} from "../dmx.js";

describe("buildDmxPatch", () => {
  it("patches fixtures sequentially with contiguous addresses", () => {
    const patch = buildDmxPatch([{ family: "par", count: 3 }]); // PAR = 7 channels
    expect(patch.totalFixtures).toBe(3);
    expect(patch.totalChannels).toBe(21);
    expect(patch.universeCount).toBe(1);
    expect(patch.fixtures.map((f) => [f.startAddress, f.endAddress])).toEqual([[1, 7], [8, 14], [15, 21]]);
    expect(patch.universes[0]?.channelsUsed).toBe(21);
    expect(patch.universes[0]?.channelsFree).toBe(DMX_UNIVERSE_SIZE - 21);
  });

  it("rolls a fixture to the next universe rather than splitting it", () => {
    // PAR = 7 ch → 73 fit in a universe (511 ch); the 74th starts universe 2.
    const patch = buildDmxPatch([{ family: "par", count: 74 }]);
    expect(patch.universeCount).toBe(2);
    expect(patch.universes[0]?.fixtures).toHaveLength(73);
    expect(patch.universes[0]?.channelsUsed).toBe(511);
    expect(patch.universes[1]?.fixtures).toHaveLength(1);
    expect(patch.universes[1]?.fixtures[0]?.startAddress).toBe(1);
    expect(patch.universes[1]?.fixtures[0]?.universe).toBe(2);
  });

  it("patches mixed families in order across one universe", () => {
    const patch = buildDmxPatch([{ family: "profile", count: 2 }, { family: "wash", count: 1 }]); // 5,5,13
    expect(patch.totalFixtures).toBe(3);
    expect(patch.totalChannels).toBe(FIXTURE_FAMILY_DMX_CHANNELS.profile * 2 + FIXTURE_FAMILY_DMX_CHANNELS.wash);
    expect(patch.fixtures.map((f) => f.endAddress)).toEqual([5, 10, 23]);
    expect(patch.universeCount).toBe(1);
  });

  it("honours a custom start universe", () => {
    const patch = buildDmxPatch([{ family: "par", count: 1 }], { startUniverse: 5 });
    expect(patch.universes[0]?.universe).toBe(5);
  });

  it("uses an explicit channel footprint + label (imported fixture) over the family default", () => {
    // beam-hybrid defaults to 20 ch; the imported GDTF mode is 40 ch.
    const patch = buildDmxPatch([{ family: "beam-hybrid", count: 2, channels: 40, label: "Robe MegaPointe" }]);
    expect(patch.totalChannels).toBe(80);
    expect(patch.fixtures.map((f) => [f.startAddress, f.endAddress])).toEqual([[1, 40], [41, 80]]);
    expect(patch.fixtures[0]?.label).toBe("Robe MegaPointe");
  });

  it("is empty for an empty rig", () => {
    const patch = buildDmxPatch([]);
    expect(patch.totalFixtures).toBe(0);
    expect(patch.universeCount).toBe(0);
    expect(patch.universes).toHaveLength(0);
  });
});

describe("estimateRigPower", () => {
  it("sums watts and derives single-phase amps (I = P / (V·PF))", () => {
    const power = estimateRigPower([{ family: "par", count: 10 }]); // 10 × 200 W = 2000 W
    expect(power.totalWatts).toBe(2000);
    expect(power.voltage).toBe(230);
    expect(power.powerFactor).toBe(0.9);
    expect(power.amps).toBeCloseTo(2000 / (230 * 0.9), 3);
  });

  it("respects custom voltage and power factor", () => {
    const power = estimateRigPower([{ family: "par", count: 10 }], { voltage: 110, powerFactor: 1 });
    expect(power.amps).toBeCloseTo(2000 / 110, 3);
  });
});

describe("rigGroupsFromCounts", () => {
  it("keeps only positive whole counts, in family order", () => {
    const groups = rigGroupsFromCounts({ par: 12, wash: 0, profile: 4, spot: -3 });
    expect(groups).toEqual([
      { family: "profile", count: 4 },
      { family: "par", count: 12 },
    ]);
  });
});

describe("fixtureFamilyLabel", () => {
  it("labels every family", () => {
    expect(fixtureFamilyLabel("par")).toBe("PAR");
    expect(fixtureFamilyLabel("beam-hybrid")).toBe("Beam / hybrid");
  });
});

describe("fixtureWattsFromGroups", () => {
  it("expands a rig into one watt entry per fixture", () => {
    const watts = fixtureWattsFromGroups([{ family: "par", count: 3 }, { family: "wash", count: 1 }]);
    expect(watts).toHaveLength(4);
    expect(watts.filter((w) => w === FIXTURE_FAMILY_WATTS.par)).toHaveLength(3);
    expect(watts).toContain(FIXTURE_FAMILY_WATTS.wash);
  });
});
