import { describe, it, expect } from "vitest";
import {
  buildAccessibilityCallouts,
  buildDoorScheduleSummary,
  severityRank,
  type AccessibilityCalloutSeverity,
} from "../event-sheet-rendering.js";
import type {
  AccessibilityRequirements,
  DoorSchedule,
} from "../event-requirements.js";

// ---------------------------------------------------------------------------
// event-sheet-rendering — shared pure builders for the PDF + tablet
// renderers. These helpers decide what an operations-critical callout
// looks like (critical / warning / info) and the chronological order of
// door events. Every renderer depends on them; drift would produce
// inconsistent hallkeeper communication.
// ---------------------------------------------------------------------------

const EMPTY_ACCESSIBILITY: AccessibilityRequirements = {
  hearingLoopRequired: false,
  hearingLoopZone: null,
  wheelchairSpaces: 0,
  stepFreeRouteRequired: false,
  signLanguageInterpreter: false,
  largePrintProgrammes: 0,
  notes: "",
};

const EMPTY_DOOR_SCHEDULE: DoorSchedule = {
  entries: [],
};

// ---------------------------------------------------------------------------
// severityRank
// ---------------------------------------------------------------------------

describe("severityRank", () => {
  it("ranks critical lowest (rendered first)", () => {
    expect(severityRank("critical")).toBe(0);
  });

  it("ranks warning second", () => {
    expect(severityRank("warning")).toBe(1);
  });

  it("ranks info last", () => {
    expect(severityRank("info")).toBe(2);
  });

  it("preserves ordering invariant: critical < warning < info", () => {
    const severities: AccessibilityCalloutSeverity[] = ["info", "critical", "warning"];
    const sorted = [...severities].sort((a, b) => severityRank(a) - severityRank(b));
    expect(sorted).toEqual(["critical", "warning", "info"]);
  });
});

// ---------------------------------------------------------------------------
// buildAccessibilityCallouts
// ---------------------------------------------------------------------------

describe("buildAccessibilityCallouts", () => {
  it("returns empty array for null input", () => {
    expect(buildAccessibilityCallouts(null)).toEqual([]);
  });

  it("returns empty array when no flags are set (nominal empty state)", () => {
    expect(buildAccessibilityCallouts(EMPTY_ACCESSIBILITY)).toEqual([]);
  });

  it("emits a critical hearing-loop callout with the zone when set", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      hearingLoopRequired: true,
      hearingLoopZone: "Centre",
    });
    expect(callouts).toHaveLength(1);
    expect(callouts[0]).toEqual({
      severity: "critical",
      label: "Hearing loop",
      detail: "Required in Centre",
    });
  });

  it("flags a missing hearing-loop zone as planner-action-required", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      hearingLoopRequired: true,
      hearingLoopZone: null,
    });
    expect(callouts[0]?.detail).toBe("Zone not set — planner action required");
  });

  it("emits a critical wheelchair-spaces callout when count > 0", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      wheelchairSpaces: 3,
    });
    expect(callouts).toEqual([{
      severity: "critical",
      label: "Wheelchair spaces",
      detail: "3 required",
    }]);
  });

  it("emits a warning for step-free routing", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      stepFreeRouteRequired: true,
    });
    expect(callouts[0]?.severity).toBe("warning");
  });

  it("emits an info for large-print programmes", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      largePrintProgrammes: 5,
    });
    expect(callouts).toEqual([{
      severity: "info",
      label: "Large-print programmes",
      detail: "5 copies",
    }]);
  });

  it("emits an info for free-text notes (trimmed)", () => {
    const callouts = buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      notes: "  Please brief the bar team on shellfish cross-contamination.  ",
    });
    expect(callouts).toHaveLength(1);
    expect(callouts[0]?.severity).toBe("info");
    expect(callouts[0]?.detail).toBe("Please brief the bar team on shellfish cross-contamination.");
  });

  it("skips notes that are whitespace-only", () => {
    expect(buildAccessibilityCallouts({
      ...EMPTY_ACCESSIBILITY,
      notes: "   \n\t  ",
    })).toEqual([]);
  });

  it("sorts critical → warning → info across a mixed set", () => {
    const callouts = buildAccessibilityCallouts({
      hearingLoopRequired: true,
      hearingLoopZone: "Centre",
      wheelchairSpaces: 2,
      stepFreeRouteRequired: true,
      signLanguageInterpreter: true,
      largePrintProgrammes: 10,
      notes: "Coeliac at table 3.",
    });
    const severities = callouts.map((c) => c.severity);
    // All criticals first (3), then warnings (1), then infos (2).
    expect(severities).toEqual([
      "critical", "critical", "critical",
      "warning",
      "info", "info",
    ]);
  });

  it("preserves declaration order WITHIN each severity tier", () => {
    const callouts = buildAccessibilityCallouts({
      hearingLoopRequired: true,
      hearingLoopZone: "Centre",
      wheelchairSpaces: 1,
      signLanguageInterpreter: true,
      stepFreeRouteRequired: false,
      largePrintProgrammes: 0,
      notes: "",
    });
    // Critical tier: hearing loop → wheelchair → interpreter (declaration order).
    const labels = callouts.map((c) => c.label);
    expect(labels).toEqual([
      "Hearing loop",
      "Wheelchair spaces",
      "Sign-language interpreter",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildDoorScheduleSummary
// ---------------------------------------------------------------------------

describe("buildDoorScheduleSummary", () => {
  it("returns null for null input", () => {
    expect(buildDoorScheduleSummary(null)).toBeNull();
  });

  it("returns null for an empty schedule (no door entries)", () => {
    expect(buildDoorScheduleSummary(EMPTY_DOOR_SCHEDULE)).toBeNull();
  });

  it("passes through a single door with chronologically-sorted events", () => {
    const schedule: DoorSchedule = {
      entries: [{
        label: "Main entrance",
        events: [
          { at: "2026-06-15T19:00:00.000Z", kind: "lock", note: "End of arrivals" },
          { at: "2026-06-15T17:30:00.000Z", kind: "open", note: "Guest arrivals" },
          { at: "2026-06-15T22:00:00.000Z", kind: "lock", note: "Last guests out" },
        ],
      }],
    };
    const summary = buildDoorScheduleSummary(schedule);
    expect(summary).not.toBeNull();
    const door = summary?.entries[0];
    expect(door?.label).toBe("Main entrance");
    const times = door?.events.map((e) => e.at) ?? [];
    expect(times).toEqual([
      "2026-06-15T17:30:00.000Z",
      "2026-06-15T19:00:00.000Z",
      "2026-06-15T22:00:00.000Z",
    ]);
  });

  it("preserves planner-authored door order (multiple doors)", () => {
    const schedule: DoorSchedule = {
      entries: [
        { label: "Main entrance", events: [] },
        { label: "Service door", events: [] },
        { label: "Fire exit 2", events: [] },
      ],
    };
    const summary = buildDoorScheduleSummary(schedule);
    const labels = summary?.entries.map((e) => e.label) ?? [];
    expect(labels).toEqual(["Main entrance", "Service door", "Fire exit 2"]);
  });

  it("sorts each door's events independently", () => {
    const schedule: DoorSchedule = {
      entries: [
        {
          label: "Main",
          events: [
            { at: "2026-06-15T20:00:00.000Z", kind: "lock", note: "" },
            { at: "2026-06-15T18:00:00.000Z", kind: "open", note: "" },
          ],
        },
        {
          label: "Service",
          events: [
            { at: "2026-06-15T16:00:00.000Z", kind: "open", note: "Vendor access" },
            { at: "2026-06-15T14:00:00.000Z", kind: "open", note: "Catering" },
          ],
        },
      ],
    };
    const summary = buildDoorScheduleSummary(schedule);
    expect(summary?.entries[0]?.events.map((e) => e.at)).toEqual([
      "2026-06-15T18:00:00.000Z",
      "2026-06-15T20:00:00.000Z",
    ]);
    expect(summary?.entries[1]?.events.map((e) => e.at)).toEqual([
      "2026-06-15T14:00:00.000Z",
      "2026-06-15T16:00:00.000Z",
    ]);
  });

  it("preserves event kind and note through the summary transform", () => {
    const schedule: DoorSchedule = {
      entries: [{
        label: "Main",
        events: [
          { at: "2026-06-15T18:00:00.000Z", kind: "open", note: "Guests arrive" },
        ],
      }],
    };
    const event = buildDoorScheduleSummary(schedule)?.entries[0]?.events[0];
    expect(event?.kind).toBe("open");
    expect(event?.note).toBe("Guests arrive");
  });
});
