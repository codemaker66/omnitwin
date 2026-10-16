import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPhase } from "@omnitwin/types";
import { applyRibbonPhaseWrites, phaseInputsFor } from "../when-ribbon-phases.js";

// The phase handles' writes (goal 19 S6): what the ribbon reads as its own,
// and how a set of writes reaches the two phase doors, in order, stopping at
// the first failure with the earlier writes already landed.

const { createMock, updateMock } = vi.hoisted(() => ({ createMock: vi.fn(), updateMock: vi.fn() }));
vi.mock("../../../../api/events.js", () => ({ createEventPhase: createMock, updateEventPhase: updateMock }));

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ROOM = "00000000-0000-4000-8000-0000000000a2";
const START = "2030-05-10T17:00:00.000Z";

function phase(id: string, overrides: Partial<EventPhase> = {}): EventPhase {
  return {
    id, eventId: EVENT, spaceId: ROOM, templateKey: null, name: "Phase", sortOrder: 0, startsAt: START, durationMinutes: 60,
    guestCount: null, opsTasksCount: 0, reviewGatesCount: 0, densityStatus: "not_checked", densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked", staffConflictsLabel: "Staff conflicts not checked", notes: null,
    ...overrides,
  } as EventPhase;
}

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
});

describe("phaseInputsFor", () => {
  it("keeps timed phases in this room or in no room, with their end worked out, and drops the rest", () => {
    const inputs = phaseInputsFor([
      phase("p1", { templateKey: "arrival", durationMinutes: 30 }),
      phase("p2", { spaceId: null, name: "Setup" }),
      phase("p3", { spaceId: OTHER_ROOM }),
      phase("p4", { startsAt: null }),
    ], ROOM);
    expect(inputs).toEqual([
      { id: "p1", templateKey: "arrival", name: "Phase", startsAt: START, endsAt: "2030-05-10T17:30:00.000Z" },
      { id: "p2", templateKey: null, name: "Setup", startsAt: START, endsAt: "2030-05-10T18:00:00.000Z" },
    ]);
  });
});

describe("applyRibbonPhaseWrites", () => {
  it("creates, updates and collapses in order and returns the phases as the server now holds them", async () => {
    const existing = [phase("p1", { templateKey: "arrival" }), phase("p2", { templateKey: "breakdown" })];
    createMock.mockResolvedValue(phase("p3", { templateKey: null, name: "Setup" }));
    updateMock.mockImplementation((id: string, patch: { startsAt: string; durationMinutes: number; name: string }) =>
      Promise.resolve(phase(id, { templateKey: id === "p1" ? "arrival" : "breakdown", ...patch })));
    const saved = await applyRibbonPhaseWrites(EVENT, ROOM, [
      { op: "create", phaseId: null, templateKey: "setup", name: "Setup", startsAt: START, durationMinutes: 45 },
      { op: "update", phaseId: "p1", templateKey: "arrival", name: "Arrival", startsAt: "2030-05-10T17:45:00.000Z", durationMinutes: 30 },
      { op: "delete", phaseId: "p2", templateKey: "breakdown", name: "Clear-down", startsAt: "2030-05-10T22:00:00.000Z", durationMinutes: 0 },
    ], existing);
    // Setup goes out key-less: the table's CHECK constraint pins template_key.
    expect(createMock).toHaveBeenCalledWith(EVENT, {
      templateKey: null, spaceId: ROOM, name: "Setup", startsAt: START, durationMinutes: 45, opsTasksCount: 0, reviewGatesCount: 0,
    });
    expect(updateMock.mock.calls).toEqual([
      ["p1", { name: "Arrival", startsAt: "2030-05-10T17:45:00.000Z", durationMinutes: 30 }],
      ["p2", { name: "Clear-down", startsAt: "2030-05-10T22:00:00.000Z", durationMinutes: 0 }],
    ]);
    expect(saved.map((row) => [row.id, row.name, row.durationMinutes])).toEqual([["p1", "Arrival", 30], ["p2", "Clear-down", 0], ["p3", "Setup", 60]]);
  });

  it("stops at the first failure, after the earlier writes have landed", async () => {
    createMock.mockResolvedValue(phase("p3", { templateKey: null, name: "Setup" }));
    updateMock.mockRejectedValue(new Error("offline"));
    await expect(applyRibbonPhaseWrites(EVENT, ROOM, [
      { op: "create", phaseId: null, templateKey: "setup", name: "Setup", startsAt: START, durationMinutes: 45 },
      { op: "update", phaseId: "p1", templateKey: "arrival", name: "Arrival", startsAt: START, durationMinutes: 30 },
    ], [phase("p1", { templateKey: "arrival" })])).rejects.toThrow("offline");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("skips an update or delete that has no phase to point at", async () => {
    const saved = await applyRibbonPhaseWrites(EVENT, ROOM, [
      { op: "delete", phaseId: null, templateKey: "setup", name: "Setup", startsAt: START, durationMinutes: 0 },
    ], []);
    expect(saved).toEqual([]);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
