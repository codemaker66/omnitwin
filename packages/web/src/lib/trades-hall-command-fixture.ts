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
  readonly completionLabel: string;
  readonly staffConflicts: number;
  readonly opsTasks: number;
  readonly reviewState: "ok" | "review";
}

export interface VisualTruthSection {
  readonly id: "source" | "verification" | "confidence" | "assumptions";
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly state: "current" | "review" | "partial" | "simulated";
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

export interface VisualFloatingLabel {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface TradesHallCommandFixture {
  readonly venue: {
    readonly productName: string;
    readonly name: string;
    readonly eventName: string;
    readonly shellLabel: string;
  };
  readonly runtimeAsset: {
    readonly emptyLabel: string;
    readonly loadedLabel: string;
    readonly loadingLabel: string;
  };
  readonly saveStatus: {
    readonly label: string;
    readonly detail: string;
  };
  readonly commandModes: readonly VisualCommandModeOption[];
  readonly eventPhases: readonly VisualEventPhase[];
  readonly defaultPhaseId: string;
  readonly truthSections: readonly VisualTruthSection[];
  readonly reviewGates: readonly VisualReviewGate[];
  readonly evidenceStatuses: readonly VisualEvidenceStatus[];
  readonly insightCards: readonly VisualInsightCard[];
  readonly overlayOptions: readonly VisualOverlayOption[];
  readonly measurementLabels: readonly VisualFloatingLabel[];
  readonly heritageLabels: readonly VisualFloatingLabel[];
  readonly flowSummary: {
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

export const TRADES_HALL_COMMAND_FIXTURE: TradesHallCommandFixture = {
  venue: {
    productName: "Venviewer",
    name: "Trades Hall Glasgow / Grand Hall",
    eventName: "Wedding Ceremony -> Dinner Flip",
    shellLabel: "Internal visual command shell",
  },
  runtimeAsset: {
    emptyLabel: "No real asset loaded yet",
    loadedLabel: "Runtime asset loaded, not yet verified/signed.",
    loadingLabel: "Loading runtime asset",
  },
  saveStatus: {
    label: "Draft saved",
    detail: "Internal fixture state",
  },
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
      completionLabel: "30m",
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
      completionLabel: "1h 15m",
      staffConflicts: 1,
      opsTasks: 8,
      reviewState: "review",
    },
    {
      id: "room-flip",
      label: "Room Flip",
      timeLabel: "17:15",
      durationLabel: "50m",
      maxDensityLabel: "1.4 p/m2",
      completionLabel: "2h 05m",
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
      completionLabel: "3h 45m",
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
      completionLabel: "4h 15m",
      staffConflicts: 1,
      opsTasks: 6,
      reviewState: "ok",
    },
    {
      id: "bar-queue",
      label: "Bar Queue",
      timeLabel: "20:15",
      durationLabel: "50m",
      maxDensityLabel: "2.5 p/m2",
      completionLabel: "5h 05m",
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
      completionLabel: "6h 25m",
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
      completionLabel: "6h 55m",
      staffConflicts: 0,
      opsTasks: 5,
      reviewState: "ok",
    },
  ],
  defaultPhaseId: "dinner",
  truthSections: [
    {
      id: "source",
      label: "Source",
      value: "Observed capture + semantic mesh + planner object",
      detail: "Runtime bundle status is separate from fixture overlays.",
      state: "current",
    },
    {
      id: "verification",
      label: "Verification",
      value: "Machine checked / Not legally certified",
      detail: "Human review required before external reliance.",
      state: "review",
    },
    {
      id: "confidence",
      label: "Confidence",
      value: "Layout-grade geometry available",
      detail: "Procedural context until a signed runtime bundle exists.",
      state: "partial",
    },
    {
      id: "assumptions",
      label: "Assumptions",
      value: "180 guests, 2 service staff lanes, bar service rate pending",
      detail: "Fixture values are simulated planning data.",
      state: "simulated",
    },
  ],
  reviewGates: [
    { label: "Raised platform", owner: "Structural engineer review", state: "review" },
    { label: "Egress pathway", owner: "Professional review", state: "review" },
    { label: "Heritage buffer", owner: "Venue manager review", state: "pending" },
  ],
  evidenceStatuses: [
    { label: "Capacity check", state: "current" },
    { label: "Route geometry", state: "current" },
    { label: "Guest flow replay", state: "simulated" },
    { label: "Lighting context", state: "partial" },
  ],
  insightCards: [
    {
      id: "guestFlow",
      label: "Guest Flow Replay",
      value: "180 agents",
      detail: "2.1 p/m2 peak - Simulated guest flow",
      overlayKey: "guestFlow",
      tone: "cyan",
    },
    {
      id: "evidencePack",
      label: "Layout Evidence Pack",
      value: "12 checks",
      detail: "3 review gates - Purpose-fit evidence",
      overlayKey: "routeClearance",
      tone: "violet",
    },
    {
      id: "opsCompiler",
      label: "Ops Compiler",
      value: "42",
      detail: "setup tasks - internal fixture",
      overlayKey: "heritageBuffer",
      tone: "amber",
    },
    {
      id: "revenueScenario",
      label: "Revenue Scenario",
      value: "+GBP 4.8k",
      detail: "scenario estimate, not a quote",
      overlayKey: "densityHeatmap",
      tone: "green",
    },
  ],
  overlayOptions: [
    { id: "guestFlow", label: "Guest flow replay", description: "Simulated guest flow" },
    { id: "routeClearance", label: "Route clearance", description: "1.20 m planning cue" },
    { id: "heritageBuffer", label: "Heritage buffer", description: "Human review required" },
    { id: "densityHeatmap", label: "Density heatmap", description: "Simulated bar queue" },
    { id: "lightingProbes", label: "Lighting probes", description: "Partial lighting context" },
    { id: "agentReplay", label: "Agents replay", description: "Ghosted movement preview" },
  ],
  measurementLabels: [
    { id: "clearance-a", label: "1.20 m", detail: "route clearance" },
    { id: "clearance-b", label: "2.35 m", detail: "service lane" },
  ],
  heritageLabels: [
    { id: "fireplace", label: "Heritage exclusion", detail: "Do not place" },
    { id: "windows", label: "Heritage buffer", detail: "Human review required" },
  ],
  flowSummary: {
    agentsLabel: "180 agents",
    peakDensityLabel: "2.1 p/m2 peak",
    caveat: "Simulated guest flow - not event evidence.",
  },
  selectedTable: {
    label: "Table 12",
    guests: 8,
    notes: ["Vegetarian notes", "Camera POV saved"],
  },
} as const;

export function visualPhaseById(phaseId: string): VisualEventPhase {
  const fallback = TRADES_HALL_COMMAND_FIXTURE.eventPhases.find(
    (phase) => phase.id === TRADES_HALL_COMMAND_FIXTURE.defaultPhaseId,
  );
  if (fallback === undefined) {
    throw new Error("Trades Hall command fixture is missing its default phase.");
  }
  return TRADES_HALL_COMMAND_FIXTURE.eventPhases.find((phase) => phase.id === phaseId) ?? fallback;
}
