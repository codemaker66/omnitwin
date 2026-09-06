import { describe, expect, it } from "vitest";
import { buildPlannerTruthSummary, buildProceduralTruthSummary, type PlannerSceneSourceEvidence } from "../truth-mode-summary.js";

const source: PlannerSceneSourceEvidence = {
  configId: "demo", spaceId: "grand-hall", layerMode: "splat", captureSource: "staged",
  loadedChunks: 1, totalChunks: 12, proceduralGeometryVisible: false,
};
const input = { surface: "planner_3d" as const, placedObjectCount: 162, measuredRuntimeAssetsLoaded: false,
  configId: "demo", spaceId: "grand-hall", layerMode: "splat" as const, sceneSource: source };

describe("planner source evidence summary", () => {
  it("describes displayed staged capture separately from authored furniture without promoting verification or alignment", () => {
    const summary = buildPlannerTruthSummary(input);
    expect(summary.displayedCaptureSource).toBe("staged");
    expect(summary.truthStatusLabel).toBe("Staged capture · unverified");
    expect(summary.evidenceSummary).toContain("Staged capture-derived room imagery is displayed");
    expect(summary.evidenceSummary).toContain("Placed furniture is planner-authored content");
    expect(summary.evidenceSummary).not.toContain("Current venue visuals come from procedural");
    expect(summary.sourceStates).toEqual(["known_unknown", "human_edited"]);
    expect(summary.measuredRuntimeAssetsLoaded).toBe(false);
    expect(summary.verificationState).toBe("unverified");
    expect(summary.confidenceTier).toBeNull();
    expect(summary.knownIssues.find((issue) => issue.id === "capture-alignment-unverified")?.message).toContain("not established");
    expect(summary.knownIssues.find((issue) => issue.id === "no-runtime-asset")).toBeDefined();
    expect(summary.knownIssues.find((issue) => issue.id === "procedural-shell")).toBeUndefined();
  });

  it("withdraws visibility for another room/config/layer, loading before arrival, failed/no capture and a 2D view", () => {
    for (const override of [
      { spaceId: "other-room" }, { configId: "other-draft" }, { layerMode: "mesh" as const },
      { sceneSource: null }, { sceneSource: { ...source, loadedChunks: 0 } },
      { sceneSource: { ...source, totalChunks: 0 } },
      { sceneSource: { ...source, captureSource: "none" as const } },
      { surface: "planner_2d" as const },
    ]) {
      const summary = buildPlannerTruthSummary({ ...input, ...override });
      expect(summary.displayedCaptureSource).toBeNull();
      expect(summary.truthStatusLabel).not.toMatch(/Staged capture/);
      expect(summary.measuredRuntimeAssetsLoaded).toBe(false);
    }
    expect(buildPlannerTruthSummary({ ...input, surface: "planner_2d" }).evidenceSummary).toContain("Captured room imagery is not displayed");
  });

  it("names actual hybrid and fallback geometry without claiming every visual is procedural", () => {
    const hybrid = buildPlannerTruthSummary({ ...input, sceneSource: { ...source, proceduralGeometryVisible: true } });
    expect(hybrid.evidenceSummary).toContain("alongside procedural planning geometry");
    expect(hybrid.sourceStates).toContain("procedural_runtime");
    const fallback = buildPlannerTruthSummary({ ...input, sceneSource: { ...source, captureSource: "none", loadedChunks: 0, proceduralGeometryVisible: true } });
    expect(fallback.truthStatusLabel).toBe("Procedural preview");
    expect(fallback.evidenceSummary).toContain("Captured room imagery is not currently displayed");
  });

  it("keeps registered capture distinct from a signed measured runtime, and preserves the existing explicit measured-runtime branch", () => {
    const registered = buildPlannerTruthSummary({ ...input, sceneSource: { ...source, captureSource: "package" } });
    expect(registered.displayedCaptureSource).toBe("package");
    expect(registered.truthStatusLabel).toBe("Packaged capture · unverified");
    expect(registered.evidenceSummary).toContain("Room imagery from a stored capture package");
    expect(registered.evidenceSummary).not.toContain("registered");
    expect(registered.measuredRuntimeAssetsLoaded).toBe(false);
    const measured = { ...input, measuredRuntimeAssetsLoaded: true };
    expect(buildPlannerTruthSummary(measured)).toEqual(buildProceduralTruthSummary(measured));
  });
});
