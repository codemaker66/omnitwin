import { describe, it, expect } from "vitest";
import { runGuestFlowReplayV0 } from "@omnitwin/types";
import { buildGuestFlowReplayInputFromLayout } from "../guest-flow-layout-input.js";
import {
  buildFlowPanelModel,
  formatSeconds,
  densityHotspotLabel,
  doorRecordFromAssumptions,
} from "../cockpit-flow-panel-model.js";

// A real artifact from the real engine — the model maps it, it never invents.
const ARTIFACT = runGuestFlowReplayV0(
  buildGuestFlowReplayInputFromLayout({ roomWidthM: 21, roomLengthM: 10.5, placedItems: [], plannedGuestCount: 40 }),
);

describe("formatSeconds", () => {
  it("formats sub-minute, exact-minute and mixed durations", () => {
    expect(formatSeconds(0)).toBe("0 s");
    expect(formatSeconds(30)).toBe("30 s");
    expect(formatSeconds(120)).toBe("2 min");
    expect(formatSeconds(90)).toBe("1 min 30 s");
  });
  it("never returns a negative duration", () => {
    expect(formatSeconds(-10)).toBe("0 s");
  });
});

describe("densityHotspotLabel", () => {
  it("reads naturally for none / one / many", () => {
    expect(densityHotspotLabel(0)).toBe("none flagged");
    expect(densityHotspotLabel(1)).toBe("1 hotspot");
    expect(densityHotspotLabel(4)).toBe("4 hotspots");
  });
});

describe("buildFlowPanelModel", () => {
  const model = buildFlowPanelModel(ARTIFACT);

  it("leads with the simulated agent count", () => {
    const agents = model.summary.find((row) => row.key === "agents");
    expect(agents?.value).toBe("40");
  });

  it("carries the simulator's assumptions verbatim, not new claims", () => {
    expect(model.assumptions).toHaveLength(ARTIFACT.assumptions.length);
    expect(model.disclosure).toBe(ARTIFACT.disclosureLabel);
  });

  it("conflict counts sum to the conflict list length", () => {
    const total = model.conflictCounts.info + model.conflictCounts.attention + model.conflictCounts.review;
    expect(total).toBe(model.conflicts.length);
  });

  it("mirrors the artifact's queue zones", () => {
    expect(model.queues).toHaveLength(ARTIFACT.queueZones.length);
  });

  it("only uses the three known severities", () => {
    for (const conflict of model.conflicts) {
      expect(["info", "attention", "review"]).toContain(conflict.severity);
    }
  });
});

// Redteam fix-first 2: a bottleneck score out of 100 for doors "assumed
// mid-wall" is a verdict on an input nobody recorded.
describe("buildFlowPanelModel — doors nobody recorded", () => {
  const surveyedDoor = { id: "door-west", label: "West door", xM: -10, zM: 0, widthM: 1.8 };

  it("withholds the bottleneck score when the doors were assumed mid-wall", () => {
    const model = buildFlowPanelModel(ARTIFACT);
    expect(model.doors).toBe("not-recorded");
    expect(model.summary.some((row) => row.key === "bottleneck")).toBe(false);
  });

  it("withholds it when only some doors were given", () => {
    const partial = runGuestFlowReplayV0(buildGuestFlowReplayInputFromLayout({
      roomWidthM: 21, roomLengthM: 10.5, placedItems: [], plannedGuestCount: 40, entrances: [surveyedDoor],
    }));
    expect(buildFlowPanelModel(partial).doors).toBe("not-recorded");
  });

  it("states it when every door position was given", () => {
    const surveyed = runGuestFlowReplayV0(buildGuestFlowReplayInputFromLayout({
      roomWidthM: 21, roomLengthM: 10.5, placedItems: [], plannedGuestCount: 40,
      entrances: [surveyedDoor], exits: [{ ...surveyedDoor, id: "door-east", label: "East door", xM: 10 }],
    }));
    const model = buildFlowPanelModel(surveyed);
    expect(model.doors).toBe("recorded");
    expect(model.summary.find((row) => row.key === "bottleneck")?.value).toMatch(/^\d+ \/ 100$/);
  });

  it("treats a missing door assumption as not recorded", () => {
    expect(doorRecordFromAssumptions([])).toBe("not-recorded");
    expect(doorRecordFromAssumptions([{ key: "door_positions", value: "assumed mid-wall", source: "caller-provided" }])).toBe("not-recorded");
  });
});
