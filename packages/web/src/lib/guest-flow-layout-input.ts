// ---------------------------------------------------------------------------
// guest-flow-layout-input — the live-layout spine for the Flow/Evidence lenses.
//
// The guest-flow SIMULATION (`runGuestFlowReplayV0` in @omnitwin/types) is real:
// it builds a navmesh from a room polygon + obstacles, runs A* + a deterministic
// crowd model, and emits trajectories, a density heatmap, route conflicts and
// queue zones. Until now the cockpit fed it ONE hardcoded demo input
// (`TRADES_HALL_GUEST_FLOW_REPLAY_INPUT`), so rearranging furniture never
// changed the flow.
//
// This module is the missing seam: it turns the ACTUAL placed layout into a
// schema-valid `GuestFlowReplayInput` — real tables/stages/bar become flow
// obstacles, destinations are derived from the layout (seating cluster, bar,
// stage), and the planned guest count drives the agent count. The sim does the
// rest. Rearranging the room now changes the simulated flow.
//
// COORDINATE FRAME. The sim works in a 2D metre frame `{x, y}`. The editable
// scene is centred on the origin and spans the room dimensions (render units =
// metres × RENDER_SCALE on X/Z). The cockpit overlay projection
// (`projectReplayPointToFloor`) maps a sim point back onto the scene floor with
// the replay Y axis FLIPPED onto scene Z. For an obstacle to land exactly under
// the furniture that produced it, the transform must therefore be
//   sim.x =  xMetres,  sim.y = -zMetres
// which is exactly the inverse of the projection (proven by the round-trip
// test). Author everything here in origin-centred scene metres and pass it
// through `toSim` — that single seam keeps the input and the overlay aligned.
//
// SAFE LANGUAGE. The output drives SIMULATED planning support, never a measured
// or certified evacuation route. Door positions and guest count are planning
// assumptions until replaced with surveyed venue data; every assumption is
// recorded in `assumptions` and surfaced by the lens. See
// GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER and the artifact's own disclosure label.
// ---------------------------------------------------------------------------

import {
  GuestFlowReplayInputSchema,
  type CrowdFlowScenarioType,
  type FurnitureCategory,
  type GuestFlowReplayInput,
} from "@omnitwin/types";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { RENDER_SCALE } from "../constants/scale.js";
import { footprintCorners, type FurnitureFootprint } from "./circulation.js";

// ---------------------------------------------------------------------------
// Tunable planning constants (exported so the UI and tests share one source).
// ---------------------------------------------------------------------------

/**
 * Canonical slug of the bar counter. The catalogue has no dedicated "bar"
 * category (it is stored as `other`), so the bar is identified by slug — both
 * as a flow obstacle and as a "bar queue" destination.
 */
export const BAR_CATALOGUE_SLUG = "bar-counter";

/**
 * Furniture categories whose footprint meaningfully blocks circulation, so
 * guests route AROUND them. Chairs are excluded on purpose: they cluster at
 * their table (the table footprint already represents the group) and including
 * them would fragment the navmesh with sub-agent-radius gaps — the same choice
 * the circulation engine makes. The bar is added by slug on top of this set.
 */
export const GUEST_FLOW_OBSTACLE_CATEGORIES: ReadonlySet<FurnitureCategory> =
  new Set<FurnitureCategory>(["table", "stage", "barrier"]);

/** Deterministic default seed — the sim is a pure function of input + seed. */
export const DEFAULT_GUEST_FLOW_SEED = 1;

/** Fallback agent count when no planned guest count is supplied. */
export const DEFAULT_ASSUMED_GUEST_COUNT = 80;

/** Sim hard cap on agents (mirrors GuestFlowReplayInputSchema `.max(500)`). */
export const MAX_GUEST_FLOW_AGENTS = 500;

/** Default door clear width when none is surveyed (planning assumption). */
const DEFAULT_DOOR_WIDTH_M = 1.6;

/** How far a default door sits inside the wall so it lands on a walkable cell. */
const DOOR_WALL_INSET_M = 0.6;

// Relative destination weights. Only the ratio matters — the sim normalises.
const SEATING_WEIGHT = 3;
const BAR_WEIGHT = 2;
const STAGE_WEIGHT = 2;
const FALLBACK_WEIGHT = 1;

/** Standard disclaimer for any surface that shows layout-derived guest flow. */
export const GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER =
  "Guest-flow input derived from the live planned layout. Routes, densities and queues are "
  + "simulated planning support — not a measured or certified evacuation route. Door positions and "
  + "guest count are planning assumptions until replaced with surveyed venue data; human review required.";

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

/** A surveyed (or hand-placed) door, authored in origin-centred scene metres. */
export interface GuestFlowDoorOverride {
  readonly id: string;
  readonly label: string;
  /** Scene-metre X (room origin-centred), NOT render units. */
  readonly xM: number;
  /** Scene-metre Z (room origin-centred), NOT render units. */
  readonly zM: number;
  /** Clear width in metres, or null when unknown. */
  readonly widthM?: number | null;
}

export interface GuestFlowPhaseOption {
  readonly phaseId: string | null;
  readonly label: string;
  readonly durationMinutes: number;
}

export interface BuildGuestFlowLayoutInputOptions {
  /** Room width (X span) in metres. */
  readonly roomWidthM: number;
  /** Room length (Z span) in metres. */
  readonly roomLengthM: number;
  /** The live placed furniture (render-space coordinates). */
  readonly placedItems: readonly PlacedItem[];
  readonly scenarioType?: CrowdFlowScenarioType;
  readonly phase?: GuestFlowPhaseOption;
  /** Planned guest count → agent count; clamped to [1, 500]. */
  readonly plannedGuestCount?: number | null;
  readonly configurationId?: string | null;
  readonly snapshotHash?: string | null;
  readonly seed?: number;
  /** Surveyed entrances; when omitted, an assumed mid-wall entrance is used. */
  readonly entrances?: readonly GuestFlowDoorOverride[];
  /** Surveyed exits; when omitted, an assumed mid-wall exit is used. */
  readonly exits?: readonly GuestFlowDoorOverride[];
  /** Override the obstacle category set (defaults to GUEST_FLOW_OBSTACLE_CATEGORIES). */
  readonly obstacleCategories?: ReadonlySet<FurnitureCategory>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface SceneMetrePoint {
  readonly xM: number;
  readonly zM: number;
}

interface ResolvedItem {
  readonly placed: PlacedItem;
  readonly item: CatalogueItem;
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * The single scene-metre → sim seam. Flips Z so a sim point round-trips back to
 * its scene position through `projectReplayPointToFloor` (see the file header).
 */
function toSim(point: SceneMetrePoint): { readonly x: number; readonly y: number } {
  return { x: round3(point.xM), y: round3(-point.zM) };
}

function resolvePlacedItems(placedItems: readonly PlacedItem[]): ResolvedItem[] {
  const resolved: ResolvedItem[] = [];
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    resolved.push({ placed, item });
  }
  return resolved;
}

function isObstacle(item: CatalogueItem, categories: ReadonlySet<FurnitureCategory>): boolean {
  return categories.has(item.category) || item.slug === BAR_CATALOGUE_SLUG;
}

/** Render-space placed item → metre-space oriented footprint (reuses circulation). */
function footprintFromPlaced(placed: PlacedItem, item: CatalogueItem): FurnitureFootprint {
  return {
    id: placed.id,
    label: item.name,
    cx: placed.x / RENDER_SCALE,
    cz: placed.z / RENDER_SCALE,
    width: item.width,
    depth: item.depth,
    rotation: placed.rotationY,
  };
}

/** Mean centre (scene metres) of a non-empty set of resolved items. */
function averageCentreScene(items: readonly ResolvedItem[]): SceneMetrePoint {
  const sum = items.reduce(
    (acc, { placed }) => ({ xM: acc.xM + placed.x / RENDER_SCALE, zM: acc.zM + placed.z / RENDER_SCALE }),
    { xM: 0, zM: 0 },
  );
  const n = Math.max(1, items.length);
  return { xM: sum.xM / n, zM: sum.zM / n };
}

function doorFromOverride(door: GuestFlowDoorOverride): {
  readonly id: string;
  readonly label: string;
  readonly point: { readonly x: number; readonly y: number };
  readonly widthM: number | null;
} {
  return {
    id: door.id,
    label: door.label,
    point: toSim({ xM: door.xM, zM: door.zM }),
    widthM: door.widthM ?? DEFAULT_DOOR_WIDTH_M,
  };
}

function clampAgentCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ASSUMED_GUEST_COUNT;
  return Math.max(1, Math.min(MAX_GUEST_FLOW_AGENTS, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a schema-valid `GuestFlowReplayInput` from the live planned layout.
 *
 * The result is parsed through `GuestFlowReplayInputSchema`, so it is guaranteed
 * consumable by `runGuestFlowReplayV0` (proven by the end-to-end test). Pure and
 * deterministic: identical options produce an identical input.
 */
export function buildGuestFlowReplayInputFromLayout(
  options: BuildGuestFlowLayoutInputOptions,
): GuestFlowReplayInput {
  const {
    roomWidthM,
    roomLengthM,
    placedItems,
    scenarioType = "guest_arrival",
    phase = { phaseId: null, label: "Arrival", durationMinutes: 30 },
    seed = DEFAULT_GUEST_FLOW_SEED,
    obstacleCategories = GUEST_FLOW_OBSTACLE_CATEGORIES,
  } = options;

  const halfWidth = roomWidthM / 2;
  const halfLength = roomLengthM / 2;

  const roomPolygon = [
    toSim({ xM: -halfWidth, zM: -halfLength }),
    toSim({ xM: halfWidth, zM: -halfLength }),
    toSim({ xM: halfWidth, zM: halfLength }),
    toSim({ xM: -halfWidth, zM: halfLength }),
  ];

  const resolved = resolvePlacedItems(placedItems);

  const obstacles = resolved
    .filter(({ item }) => isObstacle(item, obstacleCategories))
    .map(({ placed, item }) => ({
      id: placed.id,
      label: item.name,
      polygon: footprintCorners(footprintFromPlaced(placed, item)).map((corner) =>
        toSim({ xM: corner.x, zM: corner.z }),
      ),
    }));

  // Destinations derived from the layout: where guests actually go.
  const tables = resolved.filter(({ item }) => item.category === "table");
  const bars = resolved.filter(({ item }) => item.slug === BAR_CATALOGUE_SLUG);
  const stages = resolved.filter(({ item }) => item.category === "stage");

  const destinations: {
    readonly id: string;
    readonly label: string;
    readonly point: { readonly x: number; readonly y: number };
    readonly weight: number;
  }[] = [];
  if (tables.length > 0) {
    destinations.push({ id: "dest-seating", label: "Table seating", point: toSim(averageCentreScene(tables)), weight: SEATING_WEIGHT });
  }
  if (bars.length > 0) {
    destinations.push({ id: "dest-bar", label: "Bar queue", point: toSim(averageCentreScene(bars)), weight: BAR_WEIGHT });
  }
  if (destinations.length === 0 && stages.length > 0) {
    destinations.push({ id: "dest-stage", label: "Stage front", point: toSim(averageCentreScene(stages)), weight: STAGE_WEIGHT });
  }
  if (destinations.length === 0) {
    // Empty / featureless layout — a single gathering point keeps the sim valid.
    destinations.push({ id: "dest-room-centre", label: "Room centre", point: { x: 0, y: 0 }, weight: FALLBACK_WEIGHT });
  }

  // Doors: surveyed when provided, otherwise honest mid-wall assumptions.
  const entrancesProvided = (options.entrances?.length ?? 0) > 0;
  const exitsProvided = (options.exits?.length ?? 0) > 0;
  const entrances = entrancesProvided
    ? (options.entrances ?? []).map(doorFromOverride)
    : [{
        id: "entrance-main",
        label: "Assumed main entrance",
        point: toSim({ xM: -halfWidth + DOOR_WALL_INSET_M, zM: 0 }),
        widthM: DEFAULT_DOOR_WIDTH_M,
      }];
  const exits = exitsProvided
    ? (options.exits ?? []).map(doorFromOverride)
    : [{
        id: "exit-main",
        label: "Assumed exit",
        point: toSim({ xM: halfWidth - DOOR_WALL_INSET_M, zM: 0 }),
        widthM: DEFAULT_DOOR_WIDTH_M,
      }];

  const plannedGuestCount = typeof options.plannedGuestCount === "number" && options.plannedGuestCount > 0
    ? options.plannedGuestCount
    : null;
  const guestProvided = plannedGuestCount !== null;
  const agentCount = clampAgentCount(plannedGuestCount ?? DEFAULT_ASSUMED_GUEST_COUNT);

  const doorProvenance = entrancesProvided && exitsProvided
    ? "surveyed (provided door positions)"
    : entrancesProvided || exitsProvided
      ? "partially surveyed — some door positions assumed mid-wall"
      : "assumed mid-wall — replace with surveyed door positions";

  const assumptions = [
    { key: "door_positions", label: "Door positions", value: doorProvenance, source: (entrancesProvided || exitsProvided) ? "caller-provided" : "planning assumption" },
    { key: "guest_count", label: "Guest count", value: agentCount, source: guestProvided ? "event guest count" : "planning assumption (default)" },
    { key: "walking_speed_model", label: "Walking speed model", value: "deterministic v0 (~1.15 m/s nominal)", source: "Venviewer guest-flow v0" },
    { key: "arrival_window_minutes", label: "Arrival window (minutes)", value: phase.durationMinutes, source: "event phase duration" },
  ];

  return GuestFlowReplayInputSchema.parse({
    scenarioType,
    layout: {
      configurationId: options.configurationId ?? null,
      snapshotHash: options.snapshotHash ?? null,
      placedObjectCount: placedItems.length,
    },
    roomPolygon,
    obstacles,
    entrances,
    exits,
    destinations,
    staffLanes: [],
    phase,
    assumptions,
    agentCount,
    seed,
  });
}
