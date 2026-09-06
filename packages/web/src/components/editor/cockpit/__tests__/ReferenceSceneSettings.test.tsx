import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TruthModeSummary } from "@omnitwin/types";
import { ReferenceSceneSettings } from "../ReferenceSceneSettings.js";
import { SectionSlider } from "../../../SectionSlider.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useSectionStore } from "../../../../stores/section-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { getTruthModeSummary } from "../../../../api/truth-mode.js";

vi.mock("../../../../api/truth-mode.js", () => ({ getTruthModeSummary: vi.fn() }));
vi.mock("../../../../hooks/use-cockpit-replay.js", () => ({
  useCockpitReplay: () => ({ artifact: null, bounds: null, status: "idle" }),
}));
const truthApi = vi.mocked(getTruthModeSummary);

function disclose(label: string, open = true): void {
  const details = screen.getByText(label, { selector: "summary" }).closest("details");
  if (details === null) throw new Error(`Missing disclosure: ${label}`);
  details.open = open;
  fireEvent(details, new Event("toggle"));
}

const summary: TruthModeSummary = {
  targetType: "configuration", targetId: "cfg-settings",
  source: "Recorded survey and planner objects", confidence: "high",
  assumption: "Guest count awaits review", evidenceStatus: "current",
  reviewGate: "Venue review pending", staleState: "current",
  safeWording: ["Planning evidence", "Human review required"], humanReviewRequired: true,
  counts: { evidenceItems: 12, checkResults: 8, assumptions: 3, reviewGates: 2, staleEvents: 0 },
};

beforeEach(() => {
  truthApi.mockReset();
  useCockpitStore.getState().reset();
  useSectionStore.setState({ height: 7, maxHeight: 7 });
  useEditorStore.setState({ configId: "cfg-settings" });
  useLayoutTimelinePreviewStore.getState().clear();
});
afterEach(() => { cleanup(); useLayoutTimelinePreviewStore.getState().clear(); });

describe("ReferenceSceneSettings", () => {
  it("discloses genuine embedded plan navigation and withdraws it during preview", () => {
    const { container } = render(<ReferenceSceneSettings />);
    expect(screen.queryByTestId("cockpit-minimap-embedded")).toBeNull();
    disclose("Plan navigation");
    expect(screen.getByTestId("cockpit-minimap-embedded")).toBeTruthy();
    expect(container.querySelector("[data-floating-widget-id='cockpit-minimap']")).toBeNull();
    expect(useCockpitStore.getState().focusRequest).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Recentre the planner camera/ }), { detail: 0 });
    expect(useCockpitStore.getState().focusRequest).toMatchObject({ x: 0, z: 0 });
    expect(truthApi).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Opening frozen phase"); });
    expect(screen.queryByTestId("cockpit-minimap-embedded")).toBeNull();
    expect(screen.queryByText("Plan navigation")).toBeNull();
  });

  it("restores all six overlay controls through the real cockpit store", () => {
    render(<ReferenceSceneSettings />);
    disclose("Scene overlays");
    const overlays = [
      ["Guest flow", "guestFlow"], ["Route clearance", "routeClearance"],
      ["Heritage buffer", "heritageBuffer"], ["Density heatmap", "densityHeatmap"],
      ["Lighting probes", "lightingProbes"], ["Agents replay", "agentReplay"],
    ] as const;
    for (const [label, key] of overlays) {
      const checkbox = screen.getByRole("checkbox", { name: label });
      expect((checkbox as HTMLInputElement).checked).toBe(true);
      fireEvent.click(checkbox);
      expect(useCockpitStore.getState().overlayVisibility[key]).toBe(false);
      fireEvent.click(checkbox);
      expect(useCockpitStore.getState().overlayVisibility[key]).toBe(true);
    }
    expect(truthApi).not.toHaveBeenCalled();
  });

  it("uses the active room height and restores the full model section", () => {
    useSectionStore.setState({ height: 9, maxHeight: 9 });
    render(<ReferenceSceneSettings />);
    disclose("Model section height");
    fireEvent.change(screen.getByRole("slider", { name: "Section plane height" }), { target: { value: "40" } });
    expect(useSectionStore.getState().height).toBeCloseTo(3.6);
    expect(screen.getByText("3.6 m / 9.0 m")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show full model height" }));
    expect(useSectionStore.getState().height).toBe(9);
  });

  it("fetches recorded evidence only on demand and preserves the real source, gates and counts", async () => {
    let resolveSummary: ((value: TruthModeSummary) => void) | undefined;
    truthApi.mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));
    render(<ReferenceSceneSettings />);
    expect(truthApi).not.toHaveBeenCalled();
    disclose("Recorded evidence");
    expect(screen.getByText("Loading evidence").querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { resolveSummary?.(summary); });
    await waitFor(() => { expect(screen.getByText(summary.source)).toBeTruthy(); });
    expect(truthApi).toHaveBeenCalledTimes(1);
    expect(truthApi).toHaveBeenCalledWith({ targetType: "configuration", targetId: "cfg-settings" });
    expect(screen.getByText(summary.source)).toBeTruthy();
    expect(screen.getByText(summary.reviewGate)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/human review required before operational reliance/i)).toBeTruthy();
    expect(screen.getByText("Live evidence").querySelector("[data-activity-indicator]")).toBeNull();
    disclose("Recorded evidence", false);
    expect(screen.queryByTestId("cockpit-truth-rail")).toBeNull();
  });

  it("keeps failed evidence requests in the existing honest fallback and stops activity", async () => {
    truthApi.mockRejectedValue(new Error("Unavailable"));
    render(<ReferenceSceneSettings />);
    disclose("Recorded evidence");
    await waitFor(() => { expect(screen.getByText("Planning fallback")).toBeTruthy(); });
    expect(screen.getByText(/not a measured source of record/i)).toBeTruthy();
    expect(screen.queryByText("Live evidence")).toBeNull();
    expect(screen.getByTestId("cockpit-truth-rail").querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("withdraws settings and live evidence during a frozen preview", async () => {
    truthApi.mockResolvedValue(summary);
    render(<ReferenceSceneSettings />);
    disclose("Scene overlays");
    disclose("Model section height");
    disclose("Recorded evidence");
    await waitFor(() => { expect(screen.getByText(summary.source)).toBeTruthy(); });
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Opening frozen phase"); });
    expect(screen.getByRole("status").textContent).toContain("Return to the saved plan");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByTestId("cockpit-truth-rail")).toBeNull();
    expect(useSectionStore.getState().height).toBe(7);
    expect(useCockpitStore.getState().overlayVisibility.guestFlow).toBe(true);
  });

  it("preserves the standalone slider and blocks a preview-era change event", () => {
    render(<SectionSlider />);
    const slider = screen.getByRole("slider", { name: "Section plane height" });
    expect(slider.style.writingMode).toBe("vertical-lr");
    fireEvent.change(slider, { target: { value: "50" } });
    expect(useSectionStore.getState().height).toBe(3.5);
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Opening frozen phase"); });
    fireEvent.change(slider, { target: { value: "20" } });
    expect(useSectionStore.getState().height).toBe(3.5);
  });
});
