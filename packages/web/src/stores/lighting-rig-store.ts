import { create } from "zustand";
import { type LightingFixtureFamily } from "../lib/photometrics.js";
import { rigGroupsFromCounts, type RigGroup } from "../lib/dmx.js";

// ---------------------------------------------------------------------------
// lighting-rig-store — the planner's editable lighting rig (Epic 6 Lighting lens).
//
// The catalogue has no placeable lighting fixtures yet, so the rig is specified
// here as fixture FAMILY → COUNT, exactly how a lighting designer blocks out a
// rig before fixtures are hung. The DMX patch + power estimate (lib/dmx.ts) are
// derived from this. Starts from a small, clearly-editable STARTER rig (like the
// Costs lens's example rates) so the lens is illustrative on first open.
//
// A planner can also IMPORT real manufacturer fixtures (parsed from GDTF, see
// lib/gdtf.ts). An imported fixture carries its REAL DMX channel footprint (and,
// best-effort, weight), so it overrides the indicative per-family default in the
// DMX patch and feeds the Rigging lens. Imported fixtures live alongside the
// family counts; rigGroupsForRig merges both into the DMX/power pipeline.
// ---------------------------------------------------------------------------

export type RigCounts = Record<LightingFixtureFamily, number>;

/** A real fixture imported into the rig (e.g. parsed from a GDTF file). */
export interface ImportedRigFixture {
  /** Stable id derived from manufacturer + model + mode (paste twice → count 2). */
  readonly id: string;
  readonly manufacturer: string;
  readonly name: string;
  /** Mapped planning family — drives indicative power watts + grouping. */
  readonly family: LightingFixtureFamily;
  /** REAL DMX channel footprint of the chosen mode (overrides the family default). */
  readonly channels: number;
  /** Best-effort fixture weight from the file, or null when absent. */
  readonly weightKg: number | null;
  /** Which DMX mode the footprint came from. */
  readonly modeName: string;
  readonly count: number;
}

/** The fields a caller supplies when importing — id + count are derived. */
export type ImportedFixtureSpec = Omit<ImportedRigFixture, "id" | "count">;

function importedFixtureId(spec: ImportedFixtureSpec): string {
  return `${spec.manufacturer}|${spec.name}|${spec.modeName}`.toLowerCase().replace(/\s+/g, "-");
}

function normalizeCount(count: number, fallback: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : fallback;
}

const EMPTY_COUNTS: RigCounts = {
  profile: 0,
  spot: 0,
  wash: 0,
  fresnel: 0,
  par: 0,
  "beam-hybrid": 0,
  "batten-strip": 0,
  "blinder-strobe": 0,
};

/** A modest illustrative starter rig — edit to your lighting design. */
export const DEFAULT_RIG_COUNTS: RigCounts = {
  ...EMPTY_COUNTS,
  par: 12,
  wash: 4,
  profile: 2,
};

interface RigState {
  readonly counts: RigCounts;
  readonly imported: readonly ImportedRigFixture[];
}

interface RigActions {
  readonly setCount: (family: LightingFixtureFamily, count: number) => void;
  /** Add an imported fixture; if an identical one exists, bump its count instead. */
  readonly addImportedFixture: (spec: ImportedFixtureSpec, count?: number) => void;
  /** Set an imported fixture's count; ≤ 0 removes it. */
  readonly setImportedCount: (id: string, count: number) => void;
  readonly removeImportedFixture: (id: string) => void;
  readonly reset: () => void;
  readonly clear: () => void;
}

export const useLightingRigStore = create<RigState & RigActions>((set) => ({
  counts: { ...DEFAULT_RIG_COUNTS },
  imported: [],
  setCount: (family, count) => {
    set((state) => ({
      counts: { ...state.counts, [family]: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0 },
    }));
  },
  addImportedFixture: (spec, count = 1) => {
    set((state) => {
      const id = importedFixtureId(spec);
      const add = normalizeCount(count, 1);
      const existing = state.imported.find((f) => f.id === id);
      if (existing) {
        return { imported: state.imported.map((f) => (f.id === id ? { ...f, count: f.count + add } : f)) };
      }
      const channels = normalizeCount(spec.channels, 1);
      return { imported: [...state.imported, { ...spec, channels, id, count: add }] };
    });
  },
  setImportedCount: (id, count) => {
    set((state) => ({
      imported: count > 0
        ? state.imported.map((f) => (f.id === id ? { ...f, count: Math.floor(count) } : f))
        : state.imported.filter((f) => f.id !== id),
    }));
  },
  removeImportedFixture: (id) => {
    set((state) => ({ imported: state.imported.filter((f) => f.id !== id) }));
  },
  reset: () => { set({ counts: { ...DEFAULT_RIG_COUNTS }, imported: [] }); },
  clear: () => { set({ counts: { ...EMPTY_COUNTS }, imported: [] }); },
}));

/** A clean display label for an imported fixture, avoiding a doubled brand when
 *  the model name already contains the manufacturer (e.g. a GDTF LongName). */
export function fixtureDisplayLabel(manufacturer: string, name: string): string {
  const m = manufacturer.trim();
  const n = name.trim();
  if (m === "" || n.toLowerCase().includes(m.toLowerCase())) return n;
  return `${m} ${n}`;
}

/** Merge family counts + imported fixtures into DMX/power groups. Imported
 *  fixtures carry their real channel footprint + label; family counts use the
 *  indicative defaults. Pure. */
export function rigGroupsForRig(counts: RigCounts, imported: readonly ImportedRigFixture[]): RigGroup[] {
  const fromImported: RigGroup[] = imported
    .filter((f) => f.count > 0)
    .map((f) => ({ family: f.family, count: f.count, channels: f.channels, label: fixtureDisplayLabel(f.manufacturer, f.name) }));
  return [...rigGroupsFromCounts(counts), ...fromImported];
}

/** Total weight of imported fixtures that carry a known weight (kg). Pure. */
export function importedRigWeightKg(imported: readonly ImportedRigFixture[]): number {
  return imported.reduce((sum, f) => sum + (f.weightKg !== null ? f.weightKg * f.count : 0), 0);
}
