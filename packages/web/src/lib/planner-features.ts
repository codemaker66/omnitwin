// ---------------------------------------------------------------------------
// The planner's feature switches (card-dock plan, slices-revised §5).
//
// The engine (E) and perf/touch (P) lanes merge their slices behind these
// keys, off until each is green with its evidence in. Turning one on for
// everyone is a change to its `on` below and nothing else, and turning it off
// again is the way back if a device shows a problem.
//
// A tester switches keys for this device with `?pf=`: a comma list where
// `name` turns a key on and `-name` turns it off. The list is remembered here
// until the next `?pf=`, and an empty `?pf=` forgets it. The answer is cached
// against the address, so hot paths may ask every frame.
// ---------------------------------------------------------------------------

interface PlannerFeatureSpec {
  /** The lane that builds it and decides when it is green. */
  readonly lane: "E" | "P" | "planner-qol";
  /**
   * The quality-of-life item it delivers: Q-NN in design/qol-pass.md, PQ-N in
   * planner-qol's own list, or D-N for one of Blake's decisions.
   */
  readonly item: string;
  /** Whether everyone has it. */
  readonly on: boolean;
}

export const PLANNER_FEATURE_SPECS = {
  /** One state machine owns every touch on the room: a swipe looks round, a tap places, a hold lifts. */
  touchArbiter: { lane: "P", item: "Q-01", on: true },
  /** No bloom while a hand moves the view on the phone profile; both pipelines precompiled. */
  leanMotionPipeline: { lane: "P", item: "Q-02", on: true },
  /**
   * Placing a dining table opens no chair dialog; its seats ride on the card.
   * Green, but held off until the card dock (setupCards) is on: without the
   * cards on screen the seats could not be chosen before a table is placed.
   */
  seatsOnTheCard: { lane: "P", item: "Q-07", on: false },
  /** Round of N and Dance floor set down as one step, and as v1's first list rows. */
  setupCards: { lane: "E", item: "Q-08a", on: false },
  /** The ghost is the whole set, refused before the drop with its reason, pushed clear by up to 0.15 m. */
  truthfulGhost: { lane: "E", item: "Q-05", on: false },
  /** Every dining table placed is "Table N", the lowest free number. */
  tableNumbers: { lane: "E", item: "Q-46", on: false },
  /** Ctrl D duplicates, Ctrl C and Ctrl V copy and paste, Ctrl A selects all. */
  editingKeys: { lane: "E", item: "Q-11", on: false },
  /** Fill the room keeps what is placed, works round it, and states the figure it computed. */
  fillKeepOuts: { lane: "E", item: "Q-10", on: false },
  /** The ghost shows the aisles to its three nearest neighbours in the planner's bands. */
  liveAisles: { lane: "E", item: "Q-06", on: false },
  /** Staff see store figures on the cards, and an empty store refuses (Blake's B2: hard). */
  storeCounts: { lane: "E", item: "Q-14", on: false },
  /** A piece released on the rail goes back in store. */
  putBack: { lane: "E", item: "Q-15", on: false },
  /** Line up puts several pieces' centres on one line. */
  lineUp: { lane: "E", item: "Q-18", on: false },
  /** Move on the caption, then a tap on the destination. */
  moveVerb: { lane: "E", item: "Q-47", on: false },
  /** Top table and Long table as sets of trestles. */
  tableSets: { lane: "E", item: "Q-08b", on: false },
  /** A card dropped on a selection replaces it. */
  replace: { lane: "E", item: "Q-16", on: false },
  // planner-qol (Blake's decisions 3–5)
  /** A cloth goes on in a 450 ms drape; Present and the showcase keep the 3.2 s spiral. */
  clothDrape: { lane: "planner-qol", item: "PQ-7", on: false },
  /** The 450 ms drape everywhere, Present and the showcase too: no spiral. Wins over clothDrape. */
  clothDrapeOnly: { lane: "planner-qol", item: "PQ-7", on: false },
  /** Each role sees its own lenses, named: clients and guests four, the hallkeeper four, the venue team all eleven. */
  lensesByRole: { lane: "planner-qol", item: "PQ-11", on: false },
  /** The technical lenses sit below a "Venue tools" divider, for whoever sees them. */
  lensesDivider: { lane: "planner-qol", item: "PQ-11", on: false },
  /** A wall's brick-down takes 450 ms, not 5 s, and under reduced motion the wall goes at once. */
  wallsQuick: { lane: "planner-qol", item: "PQ-15", on: false },
} as const satisfies Readonly<Record<string, PlannerFeatureSpec>>;

export type PlannerFeature = keyof typeof PLANNER_FEATURE_SPECS;

export type PlannerFeatures = Readonly<Record<PlannerFeature, boolean>>;

export type PlannerFeatureOverrides = Readonly<Partial<Record<PlannerFeature, boolean>>>;

export const PLANNER_FEATURES_PARAM = "pf";

export const PLANNER_FEATURES_STORAGE_KEY = "venviewer.planner-features";

const FEATURE_NAMES = Object.keys(PLANNER_FEATURE_SPECS) as readonly PlannerFeature[];

export function isPlannerFeature(name: string): name is PlannerFeature {
  return Object.hasOwn(PLANNER_FEATURE_SPECS, name);
}

/** Reads a `?pf=` list: `name` turns a key on, `-name` off. Unknown names are ignored; the last mention wins. */
export function parsePlannerFeatureList(list: string): PlannerFeatureOverrides {
  const overrides: Partial<Record<PlannerFeature, boolean>> = {};
  for (const raw of list.split(",")) {
    const token = raw.trim();
    const off = token.startsWith("-");
    const name = off ? token.slice(1) : token;
    if (isPlannerFeature(name)) overrides[name] = !off;
  }
  return overrides;
}

/** The list form of a set of overrides, in the keys' own order. */
export function formatPlannerFeatureList(overrides: PlannerFeatureOverrides): string {
  return FEATURE_NAMES
    .filter((name) => overrides[name] !== undefined)
    .map((name) => (overrides[name] === true ? name : `-${name}`))
    .join(",");
}

/** The switches in force: everyone's, then these overrides on top. */
export function resolvePlannerFeatures(overrides: PlannerFeatureOverrides): PlannerFeatures {
  const features = {} as Record<PlannerFeature, boolean>;
  for (const name of FEATURE_NAMES) features[name] = overrides[name] ?? PLANNER_FEATURE_SPECS[name].on;
  return features;
}

/** This device's overrides: from the address when it names any, else the last ones remembered here. */
function deviceOverrides(search: string): PlannerFeatureOverrides {
  const asked = new URLSearchParams(search).get(PLANNER_FEATURES_PARAM);
  if (asked !== null) {
    const overrides = parsePlannerFeatureList(asked);
    const list = formatPlannerFeatureList(overrides);
    try {
      if (list === "") window.localStorage.removeItem(PLANNER_FEATURES_STORAGE_KEY);
      else window.localStorage.setItem(PLANNER_FEATURES_STORAGE_KEY, list);
    } catch { /* a convenience only */ }
    return overrides;
  }
  try {
    const remembered = window.localStorage.getItem(PLANNER_FEATURES_STORAGE_KEY);
    return remembered === null ? {} : parsePlannerFeatureList(remembered);
  } catch {
    return {};
  }
}

let cached: { readonly search: string; readonly features: PlannerFeatures } | null = null;
let forcedForTests: PlannerFeatures | null = null;

/** Every switch as it stands on this device. */
export function plannerFeatures(): PlannerFeatures {
  if (forcedForTests !== null) return forcedForTests;
  const search = typeof window === "undefined" ? "" : window.location.search;
  if (cached?.search !== search) {
    cached = { search, features: resolvePlannerFeatures(typeof window === "undefined" ? {} : deviceOverrides(search)) };
  }
  return cached.features;
}

/** Whether one switch is on for this device. */
export function plannerFeatureEnabled(feature: PlannerFeature): boolean {
  return plannerFeatures()[feature];
}

/**
 * Tests: the switches as everyone has them with these on top, ignoring the
 * address and storage. Null returns to the device's own.
 */
export function setPlannerFeaturesForTesting(overrides: PlannerFeatureOverrides | null): void {
  forcedForTests = overrides === null ? null : resolvePlannerFeatures(overrides);
  cached = null;
}
