import type {
  TruthConfidenceTier,
  TruthEvidenceSourceState,
  TruthStalenessState,
  TruthVerificationState,
} from "@omnitwin/types";

export type TruthModeSurface = "planner_2d" | "planner_3d" | "spark_fixture";

export type TruthIssueSeverity = "info" | "warning" | "critical";

export interface TruthModeKnownIssue {
  readonly id: string;
  readonly severity: TruthIssueSeverity;
  readonly message: string;
}

export interface TruthModeSceneSummary {
  readonly modeLabel: string;
  readonly truthStatusLabel: string;
  readonly sourceStates: readonly TruthEvidenceSourceState[];
  readonly verificationState: TruthVerificationState;
  readonly confidenceTier: TruthConfidenceTier | null;
  readonly stalenessState: TruthStalenessState | null;
  readonly generatedOrProceduralContent: boolean;
  readonly measuredRuntimeAssetsLoaded: boolean;
  readonly knownIssues: readonly TruthModeKnownIssue[];
  readonly evidenceSummary: string;
  readonly verificationSummary: string;
  readonly confidenceSummary: string;
}

export interface BuildProceduralTruthSummaryInput {
  readonly surface: TruthModeSurface;
  readonly placedObjectCount: number;
  readonly measuredRuntimeAssetsLoaded?: boolean;
}

const SURFACE_LABELS: Readonly<Record<TruthModeSurface, string>> = {
  planner_2d: "2D planning",
  planner_3d: "3D planning",
  spark_fixture: "Spark fixture",
};

export function isTruthModeUiEnabled(searchParams: URLSearchParams, isDev: boolean = import.meta.env.DEV): boolean {
  if (isDev) return true;
  const truth = searchParams.get("truth");
  const truthMode = searchParams.get("truthMode");
  return truth === "1" || truth === "true" || truthMode === "1" || truthMode === "true";
}

export function buildProceduralTruthSummary(input: BuildProceduralTruthSummaryInput): TruthModeSceneSummary {
  const measuredRuntimeAssetsLoaded = input.measuredRuntimeAssetsLoaded === true;
  const sourceStates: TruthEvidenceSourceState[] = ["procedural_runtime"];
  if (input.placedObjectCount > 0) {
    sourceStates.push("human_edited");
  }

  const knownIssues: TruthModeKnownIssue[] = [
    {
      id: "procedural-shell",
      severity: "warning",
      message: "This view uses procedural placeholder venue geometry rather than a measured runtime asset.",
    },
  ];

  if (!measuredRuntimeAssetsLoaded) {
    knownIssues.push({
      id: "no-runtime-asset",
      severity: "warning",
      message: "No signed measured RuntimeVenueManifest asset is loaded in this view.",
    });
  }

  if (input.placedObjectCount > 0) {
    knownIssues.push({
      id: "planner-authored-objects",
      severity: "info",
      message: "Placed event objects are planner-authored edits, not capture evidence.",
    });
  }

  return {
    modeLabel: SURFACE_LABELS[input.surface],
    truthStatusLabel: measuredRuntimeAssetsLoaded ? "Runtime asset loaded" : "Procedural preview",
    sourceStates,
    verificationState: "unverified",
    confidenceTier: null,
    stalenessState: null,
    generatedOrProceduralContent: true,
    measuredRuntimeAssetsLoaded,
    knownIssues,
    evidenceSummary: measuredRuntimeAssetsLoaded
      ? "Measured runtime assets are present, but this foundation view has not loaded detailed provenance yet."
      : "Current venue visuals come from procedural runtime geometry. No measured capture-derived runtime asset is loaded here.",
    verificationSummary: "No review record or signed QA certificate is loaded for this scene.",
    confidenceSummary: "No confidence band is available for this scene yet.",
  };
}

export function formatEvidenceState(state: TruthEvidenceSourceState): string {
  switch (state) {
    case "scan_observed": return "Scan observed";
    case "sensor_fused": return "Sensor fused";
    case "denoised": return "Denoised";
    case "hole_filled": return "Hole filled";
    case "ai_inferred": return "AI inferred";
    case "ai_generated": return "AI generated";
    case "human_edited": return "Human edited";
    case "artist_proxy": return "Artist proxy";
    case "procedural_runtime": return "Procedural runtime";
    case "known_unknown": return "Known unknown";
    case "measured_empty": return "Measured empty";
  }
}

export function formatConfidenceTier(tier: TruthConfidenceTier | null): string {
  if (tier === null) return "Not available";
  switch (tier) {
    case "survey_grade": return "Survey grade";
    case "ops_grade": return "Operations grade";
    case "layout_grade": return "Layout grade";
    case "appearance_only": return "Appearance only";
    case "unknown": return "Unknown";
  }
}

export function formatStalenessState(state: TruthStalenessState | null): string {
  if (state === null) return "Not available";
  switch (state) {
    case "fresh": return "Fresh";
    case "review_due": return "Review due";
    case "stale": return "Stale";
    case "unknown": return "Unknown";
  }
}
