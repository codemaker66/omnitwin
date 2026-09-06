import type {
  TruthConfidenceTier,
  TruthEvidenceSourceState,
  TruthStalenessState,
  TruthVerificationState,
} from "@omnitwin/types";
import type { RuntimeAssetSource } from "./runtime-package-resolution.js";
import type { CockpitLayerMode } from "./cockpit-modes.js";

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
  readonly displayedCaptureSource: "staged" | "package" | null;
  readonly knownIssues: readonly TruthModeKnownIssue[];
  readonly evidenceSummary: string;
  readonly verificationSummary: string;
  readonly confidenceSummary: string;
}

/** Renderer-owned visibility evidence, not a registration or QA certificate. */
export interface PlannerSceneSourceEvidence {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly layerMode: CockpitLayerMode;
  readonly captureSource: RuntimeAssetSource;
  readonly loadedChunks: number;
  readonly totalChunks: number;
  readonly proceduralGeometryVisible: boolean;
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

function assertNever(value: never): never {
  throw new Error(`Unhandled Truth Mode value: ${String(value)}`);
}

export function isTruthModeUiEnabled(searchParams: URLSearchParams, isDev: boolean): boolean {
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
    displayedCaptureSource: null,
    knownIssues,
    evidenceSummary: measuredRuntimeAssetsLoaded
      ? "Measured runtime assets are present, but this foundation view has not loaded detailed provenance yet."
      : "Current venue visuals come from procedural runtime geometry. No measured capture-derived runtime asset is loaded here.",
    verificationSummary: "No review record or signed QA certificate is loaded for this scene.",
    confidenceSummary: "No confidence band is available for this scene yet.",
  };
}

/** Preserve the existing measured-runtime path; staged tiles never promote it. */
export function buildPlannerTruthSummary(input: BuildProceduralTruthSummaryInput & {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly layerMode: CockpitLayerMode;
  readonly sceneSource: PlannerSceneSourceEvidence | null;
}): TruthModeSceneSummary {
  const base = buildProceduralTruthSummary(input);
  if (input.measuredRuntimeAssetsLoaded === true || input.surface === "spark_fixture") return base;
  const reported = input.sceneSource;
  const source = input.surface === "planner_3d" && reported !== null
    && reported.configId === input.configId && reported.spaceId === input.spaceId
    && reported.layerMode === input.layerMode ? reported : null;
  const capture = source !== null && source.layerMode !== "mesh"
    && (source.captureSource === "staged" || source.captureSource === "package") && source.loadedChunks > 0 && source.totalChunks > 0
    ? source.captureSource : null;
  const procedural = source?.proceduralGeometryVisible === true || input.surface === "planner_2d";
  const authored = input.placedObjectCount > 0;
  const sourceStates: TruthEvidenceSourceState[] = [];
  if (capture !== null || !procedural) sourceStates.push("known_unknown");
  if (procedural) sourceStates.push("procedural_runtime");
  if (authored) sourceStates.push("human_edited");
  const knownIssues = base.knownIssues.filter((issue) => issue.id !== "procedural-shell");
  if (capture !== null) knownIssues.unshift({
    id: "capture-alignment-unverified", severity: "warning",
    message: "Capture-to-plan alignment and measurement accuracy are not established by evidence loaded in this view.",
  });
  const evidenceSummary = input.surface === "planner_2d"
    ? "This view displays 2D planning geometry and planner-authored objects. Captured room imagery is not displayed in this view."
    : capture !== null
      ? `${capture === "staged" ? "Staged capture-derived room imagery" : "Room imagery from a stored capture package"} is displayed${procedural ? " alongside procedural planning geometry" : ""}. ${authored ? "Placed furniture is planner-authored content, not capture evidence. " : ""}Displaying the capture does not establish accepted alignment, measurement accuracy or certification.`
      : procedural
        ? "This view displays procedural planning geometry. Captured room imagery is not currently displayed."
        : "The current 3D view has not reported any displayed capture chunks or procedural venue geometry. Asset availability alone does not establish what is displayed.";
  return {
    ...base,
    truthStatusLabel: input.surface === "planner_2d" ? "2D planning geometry"
      : capture === "staged" ? "Staged capture · unverified"
        : capture === "package" ? "Packaged capture · unverified"
          : procedural ? "Procedural preview" : "Venue source not displayed",
    sourceStates, knownIssues, evidenceSummary,
    generatedOrProceduralContent: procedural || authored,
    displayedCaptureSource: capture,
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
    default: return assertNever(state);
  }
}

export function formatConfidenceTier(tier: TruthConfidenceTier | null): string {
  if (tier === null) return "Not available";
  switch (tier) {
    case "survey_grade": return "Survey evidence tier";
    case "ops_grade": return "Operations grade";
    case "layout_grade": return "Layout grade";
    case "appearance_only": return "Appearance only";
    case "unknown": return "Unknown";
    default: return assertNever(tier);
  }
}

export function formatStalenessState(state: TruthStalenessState | null): string {
  if (state === null) return "Not available";
  switch (state) {
    case "fresh": return "Fresh";
    case "review_due": return "Review due";
    case "stale": return "Stale";
    case "unknown": return "Unknown";
    default: return assertNever(state);
  }
}
