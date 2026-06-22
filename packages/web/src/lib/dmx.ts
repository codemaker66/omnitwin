import { LIGHTING_FIXTURE_FAMILIES, type LightingFixtureFamily } from "./photometrics.js";

// ---------------------------------------------------------------------------
// dmx — indicative DMX patch + power planning (Epic 6 DMX module).
//
// First real slice of the Lighting lens's calc core. Given a RIG (fixture
// families × counts), it packs fixtures sequentially onto 512-channel DMX
// universes (a fixture is never split across a universe boundary), reports the
// addressing + universe utilisation, and estimates electrical load. The catalogue
// has no placeable lighting fixtures yet, so the rig is specified by the planner
// — which is how a lighting designer works before fixtures are hung.
//
// IN scope (per the Epic 6 research): fixture DMX footprint, patched address
// (universe + start/end), universe capacity + overflow, indicative power.
// OUT of scope: cues, timing, effects, pixel content, console programming.
//
// SAFE: per-fixture channel footprints and watts are INDICATIVE defaults that
// vary by fixture and mode. This is planning, NOT console programming or
// electrical certification — see DMX_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

/** Channels in one DMX512 universe. */
export const DMX_UNIVERSE_SIZE = 512;

/** Indicative DMX channel footprint per fixture family (a common mode). */
export const FIXTURE_FAMILY_DMX_CHANNELS: Readonly<Record<LightingFixtureFamily, number>> = {
  profile: 5,
  spot: 14,
  wash: 13,
  fresnel: 6,
  par: 7,
  "beam-hybrid": 20,
  "batten-strip": 12,
  "blinder-strobe": 4,
};

/** Indicative power draw per fixture family, watts. */
export const FIXTURE_FAMILY_WATTS: Readonly<Record<LightingFixtureFamily, number>> = {
  profile: 550,
  spot: 470,
  wash: 575,
  fresnel: 650,
  par: 200,
  "beam-hybrid": 380,
  "batten-strip": 300,
  "blinder-strobe": 1000,
};

export const DEFAULT_MAINS_VOLTAGE = 230;
export const DEFAULT_POWER_FACTOR = 0.9;

/** Human-readable label for a fixture family. */
export function fixtureFamilyLabel(family: LightingFixtureFamily): string {
  switch (family) {
    case "profile": return "Profile";
    case "spot": return "Spot";
    case "wash": return "Wash";
    case "fresnel": return "Fresnel";
    case "par": return "PAR";
    case "beam-hybrid": return "Beam / hybrid";
    case "batten-strip": return "Batten / strip";
    case "blinder-strobe": return "Blinder / strobe";
  }
}

export interface RigGroup {
  readonly family: LightingFixtureFamily;
  readonly count: number;
}

/** Build the rig group list from an editable family→count map (count > 0 only). */
export function rigGroupsFromCounts(counts: Partial<Record<LightingFixtureFamily, number>>): RigGroup[] {
  const groups: RigGroup[] = [];
  for (const family of LIGHTING_FIXTURE_FAMILIES) {
    const raw = counts[family] ?? 0;
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (count > 0) groups.push({ family, count });
  }
  return groups;
}

export interface PatchedFixture {
  readonly family: LightingFixtureFamily;
  readonly label: string;
  readonly universe: number;
  readonly startAddress: number;
  readonly endAddress: number;
  readonly channels: number;
}

export interface PatchedUniverse {
  readonly universe: number;
  readonly fixtures: readonly PatchedFixture[];
  readonly channelsUsed: number;
  readonly channelsFree: number;
}

export interface UnpatchableFixture {
  readonly family: LightingFixtureFamily;
  readonly channels: number;
}

export interface DmxPatch {
  readonly universes: readonly PatchedUniverse[];
  readonly fixtures: readonly PatchedFixture[];
  readonly totalFixtures: number;
  readonly totalChannels: number;
  readonly universeCount: number;
  /** Fixtures whose footprint exceeds a single universe (cannot be patched). */
  readonly unpatchable: readonly UnpatchableFixture[];
}

export interface DmxPatchOptions {
  /** Universe number to start patching from (default 1). */
  readonly startUniverse?: number;
}

/**
 * Sequentially patch a rig onto DMX universes. A fixture never straddles a
 * universe boundary: if it doesn't fit in the channels remaining in the current
 * universe, it starts the next one. Pure and deterministic.
 */
export function buildDmxPatch(groups: readonly RigGroup[], options: DmxPatchOptions = {}): DmxPatch {
  const startUniverse = options.startUniverse !== undefined && options.startUniverse > 0
    ? Math.floor(options.startUniverse)
    : 1;

  const fixtures: PatchedFixture[] = [];
  const unpatchable: UnpatchableFixture[] = [];
  let universe = startUniverse;
  let nextAddress = 1;

  for (const group of groups) {
    const channels = FIXTURE_FAMILY_DMX_CHANNELS[group.family];
    const label = fixtureFamilyLabel(group.family);
    const count = Number.isFinite(group.count) && group.count > 0 ? Math.floor(group.count) : 0;
    for (let i = 0; i < count; i += 1) {
      if (channels > DMX_UNIVERSE_SIZE) {
        unpatchable.push({ family: group.family, channels });
        continue;
      }
      if (nextAddress + channels - 1 > DMX_UNIVERSE_SIZE) {
        universe += 1;
        nextAddress = 1;
      }
      const startAddress = nextAddress;
      const endAddress = startAddress + channels - 1;
      fixtures.push({ family: group.family, label, universe, startAddress, endAddress, channels });
      nextAddress = endAddress + 1;
    }
  }

  // Aggregate per universe (only universes that received fixtures).
  const byUniverse = new Map<number, PatchedFixture[]>();
  for (const fixture of fixtures) {
    const list = byUniverse.get(fixture.universe) ?? [];
    list.push(fixture);
    byUniverse.set(fixture.universe, list);
  }
  const universes: PatchedUniverse[] = [...byUniverse.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, list]) => {
      const channelsUsed = list.reduce((sum, f) => sum + f.channels, 0);
      return { universe: number, fixtures: list, channelsUsed, channelsFree: DMX_UNIVERSE_SIZE - channelsUsed };
    });

  const totalChannels = fixtures.reduce((sum, f) => sum + f.channels, 0);
  return {
    universes,
    fixtures,
    totalFixtures: fixtures.length,
    totalChannels,
    universeCount: universes.length,
    unpatchable,
  };
}

export interface RigPower {
  readonly totalWatts: number;
  readonly amps: number;
  readonly voltage: number;
  readonly powerFactor: number;
}

export interface RigPowerOptions {
  readonly voltage?: number;
  readonly powerFactor?: number;
}

/**
 * Indicative single-phase electrical load for a rig: P = Σ(watts × count),
 * I = P / (V · PF). Defaults: 230 V, PF 0.9. Pure.
 */
export function estimateRigPower(groups: readonly RigGroup[], options: RigPowerOptions = {}): RigPower {
  const voltage = options.voltage !== undefined && options.voltage > 0 ? options.voltage : DEFAULT_MAINS_VOLTAGE;
  const powerFactor = options.powerFactor !== undefined && options.powerFactor > 0 ? options.powerFactor : DEFAULT_POWER_FACTOR;
  let totalWatts = 0;
  for (const group of groups) {
    const count = Number.isFinite(group.count) && group.count > 0 ? Math.floor(group.count) : 0;
    totalWatts += FIXTURE_FAMILY_WATTS[group.family] * count;
  }
  const amps = voltage > 0 && powerFactor > 0 ? totalWatts / (voltage * powerFactor) : 0;
  return { totalWatts, amps, voltage, powerFactor };
}

export const DMX_PLANNING_DISCLAIMER =
  "Indicative DMX patch and power planning from per-fixture defaults — not console programming, cue data, or "
  + "electrical certification. Channel footprints and power draw vary by fixture and mode; verify with your "
  + "lighting designer and a competent electrician before energising.";
