import { describe, expect, it } from "vitest";
import type { GuestFlowReplayInput } from "@omnitwin/types";
import { generateGuestFlowReplayV0, replayDisclosureSummary } from "../services/guest-flow-replay.js";

const INPUT: GuestFlowReplayInput = {
  scenarioType: "bar_queue",
  layout: {
    configurationId: "00000000-0000-4000-8000-000000005001",
    snapshotHash: "d".repeat(64),
    placedObjectCount: 24,
  },
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 18, y: 0 },
    { x: 18, y: 10 },
    { x: 0, y: 10 },
  ],
  obstacles: [{
    id: "bar",
    label: "Bar",
    polygon: [
      { x: 8, y: 3 },
      { x: 11, y: 3 },
      { x: 11, y: 4.5 },
      { x: 8, y: 4.5 },
    ],
  }],
  entrances: [{ id: "entry", label: "Entry", point: { x: 1, y: 5 }, widthM: 1.2 }],
  exits: [{ id: "exit", label: "Exit", point: { x: 17, y: 5 }, widthM: 1.2 }],
  destinations: [{ id: "bar-service", label: "Bar service", point: { x: 15, y: 5 }, weight: 1 }],
  staffLanes: [],
  phase: { phaseId: null, label: "Bar Queue", durationMinutes: 45 },
  assumptions: [{ key: "arrival_rate", label: "Arrival rate", value: "steady", source: "operator assumption" }],
  agentCount: 30,
  seed: 42,
};

describe("guest flow replay service", () => {
  it("generates deterministic simulated planning support", () => {
    const first = generateGuestFlowReplayV0(INPUT);
    const second = generateGuestFlowReplayV0(INPUT);

    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.evidenceStatus).toBe("simulated_planning_support");
    expect(first.navmesh.algorithm).toBe("grid_navmesh_fallback_v0");
    expect(first.navmesh.limitations.join(" ")).toMatch(/human review/i);
    expect(replayDisclosureSummary(first)).toContain("Human review required");
  });

  it("does not emit unsafe approval language", () => {
    const summary = replayDisclosureSummary(generateGuestFlowReplayV0(INPUT));

    expect(summary).not.toMatch(/certified safe|legally compliant|approved for occupancy/iu);
  });
});
