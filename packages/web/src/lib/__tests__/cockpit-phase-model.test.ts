import { describe, expect, it } from "vitest";
import type { EventPhaseGraph, EventPhase } from "@omnitwin/types";
import { buildCockpitPhases } from "../cockpit-phase-model.js";

const now = "2026-06-11T10:00:00.000Z";

function phase(overrides: Partial<EventPhase>): EventPhase {
  return {
    id: "p1",
    eventId: "e1",
    templateKey: null,
    name: "Ceremony",
    sortOrder: 0,
    startsAt: null,
    durationMinutes: 45,
    guestCount: null,
    opsTasksCount: 6,
    reviewGatesCount: 0,
    densityStatus: "not_checked",
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staff conflicts not checked",
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function graphWith(phases: readonly EventPhase[]): EventPhaseGraph {
  return {
    event: {
      id: "e1", venueId: "v1", createdBy: null, name: "Wedding",
      eventType: "wedding", status: "in_planning", startsAt: now, endsAt: null,
      guestCount: 120, clientName: null, notes: null, createdAt: now, updatedAt: now,
    },
    phases: [...phases],
    scenarios: [],
    layoutVariants: [],
    configurationLinks: [],
    phaseLayoutSnapshots: [],
  };
}

describe("buildCockpitPhases", () => {
  it("returns an empty list when there is no graph", () => {
    expect(buildCockpitPhases(null)).toEqual([]);
  });

  it("maps phases with 1-based index, duration label, and review state", () => {
    const cards = buildCockpitPhases(graphWith([
      phase({ id: "a", name: "Arrival", durationMinutes: 30, reviewGatesCount: 0 }),
      phase({ id: "d", name: "Dinner", durationMinutes: 100, reviewGatesCount: 2 }),
    ]));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual(expect.objectContaining({ id: "a", index: 1, name: "Arrival", durationLabel: "30m", reviewState: "ok" }));
    expect(cards[1]).toEqual(expect.objectContaining({ id: "d", index: 2, name: "Dinner", durationLabel: "1h 40m", reviewState: "review" }));
  });

  it("formats time labels, falling back when no start time is set", () => {
    const [withTime, withoutTime] = buildCockpitPhases(graphWith([
      phase({ id: "t", startsAt: "2026-06-11T18:00:00.000Z" }),
      phase({ id: "n", startsAt: null }),
    ]));
    expect(withTime?.timeLabel).toMatch(/^\d{2}:\d{2}$/);
    expect(withoutTime?.timeLabel).toBe("Time not set");
  });
});
