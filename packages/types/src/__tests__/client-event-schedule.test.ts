import { describe, expect, it } from "vitest";
import { ClientEventScheduleQuerySchema, ClientEventScheduleSchema } from "../client-event-schedule.js";

const VENUE = "00000000-0000-4000-8000-000000000001";
const EVENT = "00000000-0000-4000-8000-000000000002";
const PHASE = "00000000-0000-4000-8000-000000000003";
const CONFIGURATION = "00000000-0000-4000-8000-000000000004";
const ROOM = "00000000-0000-4000-8000-000000000005";

function schedule() {
  return {
    event: { id: EVENT, venueId: VENUE, name: "Dinner", eventType: "dinner", status: "in_planning",
      startsAt: "2026-10-25T18:00:00.000Z", endsAt: null, guestCount: 24 },
    venue: { id: VENUE, name: "Test venue", timezone: "Europe/London" },
    scheduleState: "working",
    phases: [{ id: PHASE, name: "Arrival", startsAt: null, durationMinutes: 30, space: null }],
    layouts: [{ id: CONFIGURATION, name: "Dinner layout", space: { id: ROOM, name: "Hall" } }],
  };
}

describe("client event schedule contract", () => {
  it("preserves honest working, untimed and unassigned-room states", () => {
    expect(ClientEventScheduleSchema.parse(schedule())).toEqual(schedule());
    expect(ClientEventScheduleSchema.parse({ ...schedule(), phases: [], layouts: [] }).phases).toEqual([]);
  });

  it("rejects internal material at every projected object boundary", () => {
    const original = schedule();
    for (const candidate of [
      { ...original, notes: "Private" },
      { ...original, event: { ...original.event, notes: "Private" } },
      { ...original, venue: { ...original.venue, address: "Private" } },
      { ...original, phases: [{ ...original.phases[0], staffConflictsLabel: "Private" }] },
      { ...original, layouts: [{ ...original.layouts[0], snapshot: { notes: "Private" } }] },
      { ...original, layouts: [{ ...original.layouts[0], space: { id: ROOM, name: "Hall", metadata: "Private" } }] },
    ]) expect(ClientEventScheduleSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects mismatched venue and repeated phase/layout identities", () => {
    const original = schedule();
    for (const candidate of [
      { ...original, venue: { ...original.venue, id: ROOM } },
      { ...original, phases: [original.phases[0], original.phases[0]] },
      { ...original, layouts: [original.layouts[0], original.layouts[0]] },
    ]) expect(ClientEventScheduleSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects unsupported timing, state and query claims", () => {
    const original = schedule();
    expect(ClientEventScheduleSchema.safeParse({ ...original, scheduleState: "approved" }).success).toBe(false);
    expect(ClientEventScheduleSchema.safeParse({ ...original, venue: { ...original.venue, timezone: "not-a-zone" } }).success).toBe(false);
    expect(ClientEventScheduleSchema.safeParse({ ...original, phases: [{ ...original.phases[0], durationMinutes: -1 }] }).success).toBe(false);
    expect(ClientEventScheduleQuerySchema.parse({})).toEqual({});
    expect(ClientEventScheduleQuerySchema.parse({ configurationId: CONFIGURATION })).toEqual({ configurationId: CONFIGURATION });
    for (const query of [{ configurationId: "not-a-uuid" }, { configurationId: [CONFIGURATION] }, { audience: "admin" }]) {
      expect(ClientEventScheduleQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
