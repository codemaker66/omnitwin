import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { TruthModeSummary } from "@omnitwin/types";

vi.mock("../../../../api/truth-mode.js", () => ({ getTruthModeSummary: vi.fn() }));

const truthApi = vi.mocked(await import("../../../../api/truth-mode.js"));
const { CockpitTruthRail } = await import("../CockpitTruthRail.js");
const { useEditorStore } = await import("../../../../stores/editor-store.js");

function makeSummary(): TruthModeSummary {
  return {
    targetType: "configuration",
    targetId: "cfg-1",
    source: "Observed capture + planner objects",
    confidence: "high",
    assumption: "180 guests assumed",
    evidenceStatus: "current",
    reviewGate: "Egress pathway review pending",
    staleState: "current",
    safeWording: ["Planning evidence", "Human review required"],
    humanReviewRequired: true,
    counts: { evidenceItems: 12, checkResults: 8, assumptions: 3, reviewGates: 3, staleEvents: 0 },
  };
}

beforeEach(() => { useEditorStore.setState({ configId: null }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CockpitTruthRail", () => {
  it("shows SAFE fallback rows + footer and never fetches when no config is loaded", () => {
    render(<CockpitTruthRail />);
    expect(screen.getByText(/not a measured source/i)).toBeTruthy();
    expect(screen.getByText(/human review required before operational reliance/i)).toBeTruthy();
    expect(truthApi.getTruthModeSummary).not.toHaveBeenCalled();
  });

  it("loads the truth summary for the active config", async () => {
    truthApi.getTruthModeSummary.mockResolvedValue(makeSummary());
    useEditorStore.setState({ configId: "cfg-1" });
    render(<CockpitTruthRail />);
    await waitFor(() => { expect(screen.getByText("Observed capture + planner objects")).toBeTruthy(); });
    expect(truthApi.getTruthModeSummary).toHaveBeenCalledWith({ targetType: "configuration", targetId: "cfg-1" });
  });

  it("falls back to SAFE rows when the summary request fails", async () => {
    truthApi.getTruthModeSummary.mockRejectedValue(new Error("401"));
    useEditorStore.setState({ configId: "cfg-1" });
    render(<CockpitTruthRail />);
    await waitFor(() => { expect(screen.getByText(/not a measured source/i)).toBeTruthy(); });
  });
});
