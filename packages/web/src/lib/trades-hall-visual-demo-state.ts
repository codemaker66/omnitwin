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
  readonly maxDensityLabel: string;
  readonly staffConflicts: number;
  readonly opsTasks: number;
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
      maxDensityLabel: "0.6 p/m2",
      staffConflicts: 0,
      opsTasks: 6,
      reviewState: "ok",
    },
    {
      id: "ceremony",
      label: "Ceremony",
      timeLabel: "16:30",
      durationLabel: "45m",
      maxDensityLabel: "1.2 p/m2",
      staffConflicts: 1,
      opsTasks: 8,
      reviewState: "review",
    },
    {
      id: "room-flip",
      label: "Room flip",
      timeLabel: "17:15",
      durationLabel: "50m",
      maxDensityLabel: "1.4 p/m2",
      staffConflicts: 2,
      opsTasks: 12,
      reviewState: "review",
    },
    {
      id: "dinner",
      label: "Dinner",
      timeLabel: "18:05",
      durationLabel: "1h 40m",
      maxDensityLabel: "2.1 p/m2",
      staffConflicts: 1,
      opsTasks: 14,
      reviewState: "review",
    },
    {
      id: "speeches",
      label: "Speeches",
      timeLabel: "19:45",
      durationLabel: "30m",
      maxDensityLabel: "2.3 p/m2",
      staffConflicts: 1,
      opsTasks: 6,
      reviewState: "ok",
    },
    {
      id: "bar-queue",
      label: "Bar queue",
      timeLabel: "20:15",
      durationLabel: "50m",
      maxDensityLabel: "2.5 p/m2",
      staffConflicts: 2,
      opsTasks: 9,
      reviewState: "review",
    },
    {
      id: "dancing",
      label: "Dancing",
      timeLabel: "21:05",
      durationLabel: "1h 20m",
      maxDensityLabel: "2.4 p/m2",
      staffConflicts: 1,
      opsTasks: 8,
      reviewState: "review",
    },
    {
      id: "breakdown",
      label: "Breakdown",
      timeLabel: "22:25",
      durationLabel: "30m",
      maxDensityLabel: "0.8 p/m2",
      staffConflicts: 0,
      opsTasks: 5,
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
      value: "180 agents",
      detail: "2.1 p/m2 peak - simulated",
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
  guestFlowSummary: {
    agentsLabel: "180 agents",
    peakDensityLabel: "2.1 p/m2 peak",
    caveat: "Simulated internal fixture - not event evidence.",
  },
  selectedTable: {
    label: "Table 12",
    guests: 8,
    notes: ["Vegetarian notes", "Camera POV saved"],
  },
} as const;

export function visualPhaseById(phaseId: string): VisualEventPhase {
  const fallback = TRADES_HALL_VISUAL_DEMO_STATE.eventPhases.find(
    (phase) => phase.id === TRADES_HALL_VISUAL_DEMO_STATE.defaultPhaseId,
  );
  if (fallback === undefined) {
    throw new Error("Trades Hall visual demo state is missing its default phase.");
  }
  return TRADES_HALL_VISUAL_DEMO_STATE.eventPhases.find((phase) => phase.id === phaseId) ?? fallback;
}
