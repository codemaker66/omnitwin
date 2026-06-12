import { runGuestFlowReplayV0, type EventPhaseGraph, type GuestFlowReplayArtifact, type GuestFlowReplayInput } from "@omnitwin/types";

export type VisualCommandMode = "design" | "guests" | "flow" | "evidence" | "lighting" | "ops" | "costs" | "share";

export type VisualOverlayKey =
  | "guestFlow"
  | "routeClearance"
  | "heritageBuffer"
  | "densityHeatmap"
  | "lightingProbes"
  | "agentReplay";

export type VisualInsightKey = "guestFlow" | "evidencePack" | "opsCompiler" | "revenueScenario";

export interface VisualCommandModeOption {
  readonly id: VisualCommandMode;
  readonly label: string;
}

export interface VisualEventPhase {
  readonly id: string;
  readonly label: string;
  readonly timeLabel: string;
  readonly durationLabel: string;
  readonly guestCountLabel: string;
  readonly maxDensityLabel: string;
  readonly staffConflictsLabel: string;
  readonly opsTasks: number;
  readonly reviewGates: number;
  readonly reviewState: "ok" | "review";
}

export interface VisualReviewGate {
  readonly label: string;
  readonly owner: string;
  readonly state: "review" | "pending";
}

export interface VisualEvidenceStatus {
  readonly label: string;
  readonly state: "current" | "draft" | "simulated" | "partial";
}

export interface VisualInsightCard {
  readonly id: VisualInsightKey;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly overlayKey: VisualOverlayKey;
  readonly tone: "cyan" | "violet" | "amber" | "green";
}

export interface VisualOverlayOption {
  readonly id: VisualOverlayKey;
  readonly label: string;
  readonly description: string;
}

export interface TradesHallVisualDemoState {
  readonly venueName: string;
  readonly venueContext: string;
  readonly eventName: string;
  readonly shellLabel: string;
  readonly internalFixtureLabel: string;
  readonly commandModes: readonly VisualCommandModeOption[];
  readonly eventPhases: readonly VisualEventPhase[];
  readonly defaultPhaseId: string;
  readonly reviewGates: readonly VisualReviewGate[];
  readonly evidenceStatuses: readonly VisualEvidenceStatus[];
  readonly insightCards: readonly VisualInsightCard[];
  readonly overlayOptions: readonly VisualOverlayOption[];
  readonly guestFlowReplay: GuestFlowReplayArtifact;
  readonly guestFlowSummary: {
    readonly agentsLabel: string;
    readonly peakDensityLabel: string;
    readonly caveat: string;
  };
  readonly selectedTable: {
    readonly label: string;
    readonly guests: number;
    readonly notes: readonly string[];
  };
}

const TRADES_HALL_GUEST_FLOW_REPLAY_INPUT: GuestFlowReplayInput = {
  scenarioType: "guest_arrival",
  layout: {
    configurationId: null,
    snapshotHash: null,
    placedObjectCount: 28,
  },
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 22, y: 0 },
    { x: 22, y: 12 },
    { x: 0, y: 12 },
  ],
  obstacles: [
    {
      id: "dinner-table-cluster",
      label: "Dinner table cluster",
      polygon: [
        { x: 8.4, y: 4.2 },
        { x: 13.6, y: 4.2 },
        { x: 13.6, y: 7.8 },
        { x: 8.4, y: 7.8 },
      ],
    },
    {
      id: "top-table-zone",
      label: "Top table zone",
      polygon: [
        { x: 15.6, y: 7.2 },
        { x: 18.6, y: 7.2 },
        { x: 18.6, y: 9.4 },
        { x: 15.6, y: 9.4 },
      ],
    },
  ],
  entrances: [
    { id: "west-door", label: "West entrance", point: { x: 1.2, y: 5.8 }, widthM: 1.6 },
    { id: "south-door", label: "South entrance", point: { x: 6.2, y: 1.1 }, widthM: 1.2 },
  ],
  exits: [
    { id: "east-door", label: "East exit", point: { x: 21, y: 6.2 }, widthM: 1.6 },
  ],
  destinations: [
    { id: "dinner-zone", label: "Dinner seating", point: { x: 18.8, y: 5.9 }, weight: 0.75 },
    { id: "bar-zone", label: "Bar queue", point: { x: 16.8, y: 2.4 }, weight: 0.25 },
  ],
  staffLanes: [
    { id: "service-lane", label: "Service lane", line: [{ x: 5.5, y: 2.2 }, { x: 18.2, y: 2.2 }] },
  ],
  phase: {
    phaseId: null,
    label: "Arrival",
    durationMinutes: 30,
  },
  assumptions: [
    { key: "arrival_window", label: "Arrival window", value: "30 minutes", source: "internal demo input" },
    { key: "walking_speed", label: "Walking speed", value: "simple deterministic v0", source: "custom Venviewer v0" },
  ],
  agentCount: 72,
  seed: 4301,
};

const TRADES_HALL_GUEST_FLOW_REPLAY = runGuestFlowReplayV0(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT);

export const TRADES_HALL_VISUAL_DEMO_STATE: TradesHallVisualDemoState = {
  venueName: "Trades Hall Glasgow / Grand Hall",
  venueContext: "Internal visual runtime command shell",
  eventName: "Wedding ceremony -> dinner flip",
  shellLabel: "Internal command shell demo",
  internalFixtureLabel: "Fixture values are simulated planning data until a signed runtime bundle exists.",
  commandModes: [
    { id: "design", label: "Design" },
    { id: "guests", label: "Guests" },
    { id: "flow", label: "Flow" },
    { id: "evidence", label: "Evidence" },
    { id: "lighting", label: "Lighting" },
    { id: "ops", label: "Ops" },
    { id: "costs", label: "Costs" },
    { id: "share", label: "Share" },
  ],
  eventPhases: [
    {
      id: "arrival",
      label: "Arrival",
      timeLabel: "16:00",
      durationLabel: "30m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 6,
      reviewGates: 0,
      reviewState: "ok",
    },
    {
      id: "ceremony",
      label: "Ceremony",
      timeLabel: "16:30",
      durationLabel: "45m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 8,
      reviewGates: 1,
      reviewState: "review",
    },
    {
      id: "room-flip",
      label: "Room flip",
      timeLabel: "17:15",
      durationLabel: "50m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 12,
      reviewGates: 1,
      reviewState: "review",
    },
    {
      id: "dinner",
      label: "Dinner",
      timeLabel: "18:05",
      durationLabel: "1h 40m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 14,
      reviewGates: 1,
      reviewState: "review",
    },
    {
      id: "speeches",
      label: "Speeches",
      timeLabel: "19:45",
      durationLabel: "30m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 6,
      reviewGates: 0,
      reviewState: "ok",
    },
    {
      id: "bar-queue",
      label: "Bar queue",
      timeLabel: "20:15",
      durationLabel: "50m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 9,
      reviewGates: 1,
      reviewState: "review",
    },
    {
      id: "dancing",
      label: "Dancing",
      timeLabel: "21:05",
      durationLabel: "1h 20m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 8,
      reviewGates: 1,
      reviewState: "review",
    },
    {
      id: "breakdown",
      label: "Breakdown",
      timeLabel: "22:25",
      durationLabel: "30m",
      guestCountLabel: "Guest count not set",
      maxDensityLabel: "Density not checked",
      staffConflictsLabel: "Staff conflicts not checked",
      opsTasks: 5,
      reviewGates: 0,
      reviewState: "ok",
    },
  ],
  defaultPhaseId: "dinner",
  reviewGates: [
    { label: "Raised platform", owner: "Structural review", state: "review" },
    { label: "Egress pathway", owner: "Professional review", state: "review" },
    { label: "Heritage buffer", owner: "Venue manager", state: "pending" },
  ],
  evidenceStatuses: [
    { label: "Capacity check", state: "current" },
    { label: "Route geometry", state: "draft" },
    { label: "Guest flow replay", state: "simulated" },
    { label: "Lighting context", state: "partial" },
  ],
  insightCards: [
    {
      id: "guestFlow",
      label: "Guest Flow Replay",
      value: `${TRADES_HALL_GUEST_FLOW_REPLAY.metrics.agentCount.toLocaleString("en-GB")} agents`,
      detail: `${TRADES_HALL_GUEST_FLOW_REPLAY.metrics.routeConflictCount.toLocaleString("en-GB")} conflict marker(s) - simulated`,
      overlayKey: "guestFlow",
      tone: "cyan",
    },
    {
      id: "evidencePack",
      label: "Layout Evidence Pack",
      value: "12 checks",
      detail: "3 review gates - purpose-fit draft",
      overlayKey: "routeClearance",
      tone: "violet",
    },
    {
      id: "opsCompiler",
      label: "Ops Compiler",
      value: "42 tasks",
      detail: "Internal setup-task fixture",
      overlayKey: "heritageBuffer",
      tone: "amber",
    },
    {
      id: "revenueScenario",
      label: "Revenue Scenario",
      value: "+GBP 4.8k",
      detail: "Scenario estimate, not a quote",
      overlayKey: "densityHeatmap",
      tone: "green",
    },
  ],
  overlayOptions: [
    {
      id: "guestFlow",
      label: "Guest flow replay",
      description: "Simulated path overlay",
    },
    {
      id: "routeClearance",
      label: "Route clearance",
      description: "Draft 1.20 m clearance cues",
    },
    {
      id: "heritageBuffer",
      label: "Heritage buffer",
      description: "Venue review zones",
    },
    {
      id: "densityHeatmap",
      label: "Density heatmap",
      description: "Simulated crowd concentration",
    },
    {
      id: "lightingProbes",
      label: "Lighting probes",
      description: "Partial lighting-context cue",
    },
    {
      id: "agentReplay",
      label: "Agents replay",
      description: "Simulated guest silhouettes",
    },
  ],
  guestFlowReplay: TRADES_HALL_GUEST_FLOW_REPLAY,
  guestFlowSummary: {
    agentsLabel: `${TRADES_HALL_GUEST_FLOW_REPLAY.metrics.agentCount.toLocaleString("en-GB")} simulated agents`,
    peakDensityLabel: `${TRADES_HALL_GUEST_FLOW_REPLAY.metrics.maxDensity.toFixed(2)} p/m2 simulated peak`,
    caveat: TRADES_HALL_GUEST_FLOW_REPLAY.disclosureLabel,
  },
  selectedTable: {
    label: "Table 12",
    guests: 8,
    notes: ["Vegetarian notes", "Camera POV saved"],
  },
} as const;

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remaining)}m`;
}

function timeLabel(value: string | null): string {
  if (value === null) return "Time not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time not set";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function guestCountLabel(phaseGuestCount: number | null, eventGuestCount: number): string {
  if (phaseGuestCount !== null) return `${phaseGuestCount.toLocaleString("en-GB")} guests`;
  if (eventGuestCount > 0) return `${eventGuestCount.toLocaleString("en-GB")} event guests`;
  return "Guest count not set";
}

export function visualEventPhasesFromGraph(graph: EventPhaseGraph): readonly VisualEventPhase[] {
  return graph.phases.map((phase) => ({
    id: phase.id,
    label: phase.name,
    timeLabel: timeLabel(phase.startsAt),
    durationLabel: durationLabel(phase.durationMinutes),
    guestCountLabel: guestCountLabel(phase.guestCount, graph.event.guestCount),
    maxDensityLabel: phase.densityLabel,
    staffConflictsLabel: phase.staffConflictsLabel,
    opsTasks: phase.opsTasksCount,
    reviewGates: phase.reviewGatesCount,
    reviewState: phase.reviewGatesCount > 0 ? "review" : "ok",
  }));
}

export function visualPhaseById(
  phaseId: string,
  phases: readonly VisualEventPhase[] = TRADES_HALL_VISUAL_DEMO_STATE.eventPhases,
): VisualEventPhase {
  const fallback = phases.find((phase) => phase.id === TRADES_HALL_VISUAL_DEMO_STATE.defaultPhaseId) ?? phases[0];
  if (fallback === undefined) {
    throw new Error("Trades Hall visual phase graph is empty.");
  }
  return phases.find((phase) => phase.id === phaseId) ?? fallback;
}
