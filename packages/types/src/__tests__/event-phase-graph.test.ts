import { describe, expect, it } from "vitest";
import {
  CreateEventPhaseSchema,
  CreateEventSchema,
  CreateLayoutVariantSchema,
  DEFAULT_EVENT_PHASE_TEMPLATE,
  EVENT_STATUSES,
  EventPhaseGraphSchema,
  PhaseLayoutSnapshotSchema,
  defaultEventPhaseInputs,
} from "../event-phase-graph.js";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const VENUE_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const PHASE_ID = "00000000-0000-4000-8000-000000000004";
const VARIANT_ID = "00000000-0000-4000-8000-000000000005";
const CONFIG_ID = "00000000-0000-4000-8000-000000000006";
const LINK_ID = "00000000-0000-4000-8000-000000000007";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000008";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000009";
const NOW = "2026-06-11T10:00:00.000Z";

describe("event phase graph contracts", () => {
  it("pins event statuses in build-program order", () => {
    expect(EVENT_STATUSES).toEqual([
      "draft",
      "proposed",
      "confirmed",
      "in_planning",
      "ready_for_ops",
      "executed",
      "closed",
      "cancelled",
    ]);
  });

  it("creates the requested default phase template", () => {
    expect(DEFAULT_EVENT_PHASE_TEMPLATE.map((entry) => entry.label)).toEqual([
      "Arrival",
      "Ceremony",
      "Room Flip",
      "Dinner",
      "Speeches",
      "Bar Queue",
      "Dancing",
      "Breakdown",
    ]);

    const inputs = defaultEventPhaseInputs();
    expect(inputs).toHaveLength(8);
    for (const input of inputs) {
      expect(CreateEventPhaseSchema.safeParse(input).success).toBe(true);
      expect(input.opsTasksCount).toBe(0);
      expect(input.reviewGatesCount).toBe(0);
    }
  });

  it("parses event creation with safe planning defaults", () => {
    const parsed = CreateEventSchema.parse({
      venueId: VENUE_ID,
      name: "Smith wedding",
    });
    expect(parsed.status).toBe("draft");
    expect(parsed.guestCount).toBe(0);
  });

  it("keeps layout variants linked to configurations without implying approval", () => {
    const parsed = CreateLayoutVariantSchema.parse({
      configurationId: CONFIG_ID,
      name: "Dinner option A",
      guestCount: 120,
    });
    expect(parsed.status).toBe("draft");
    expect(parsed.configurationId).toBe(CONFIG_ID);
  });

  it("requires valid snapshot hashes when a phase snapshot is frozen", () => {
    expect(PhaseLayoutSnapshotSchema.safeParse({
      id: SNAPSHOT_ID,
      eventPhaseId: PHASE_ID,
      layoutVariantId: VARIANT_ID,
      configurationId: CONFIG_ID,
      snapshotHash: "f".repeat(64),
      status: "frozen",
      objectCount: 42,
      guestCount: 120,
      payload: { source: "configuration" },
      createdAt: NOW,
      frozenAt: NOW,
    }).success).toBe(true);

    expect(PhaseLayoutSnapshotSchema.safeParse({
      id: SNAPSHOT_ID,
      eventPhaseId: PHASE_ID,
      layoutVariantId: VARIANT_ID,
      configurationId: CONFIG_ID,
      snapshotHash: "not-a-hash",
      status: "frozen",
      objectCount: 42,
      guestCount: 120,
      payload: null,
      createdAt: NOW,
      frozenAt: NOW,
    }).success).toBe(false);
  });

  it("parses a phase graph with not-checked density and staff-conflict placeholders", () => {
    const parsed = EventPhaseGraphSchema.parse({
      event: {
        id: EVENT_ID,
        venueId: VENUE_ID,
        createdBy: USER_ID,
        name: "Smith wedding",
        eventType: "wedding",
        status: "in_planning",
        startsAt: NOW,
        endsAt: null,
        guestCount: 120,
        clientName: "Smith family",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      phases: [{
        id: PHASE_ID,
        eventId: EVENT_ID,
        templateKey: "dinner",
        name: "Dinner",
        sortOrder: 3,
        startsAt: null,
        durationMinutes: 90,
        guestCount: 120,
        opsTasksCount: 0,
        reviewGatesCount: 1,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      scenarios: [{
        id: SCENARIO_ID,
        eventId: EVENT_ID,
        phaseId: PHASE_ID,
        name: "Dinner arrival placeholder",
        status: "ready_for_inputs",
        assumptions: { source: "planner" },
        seed: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      layoutVariants: [{
        id: VARIANT_ID,
        eventId: EVENT_ID,
        configurationId: CONFIG_ID,
        name: "Dinner option A",
        status: "draft",
        guestCount: 120,
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      configurationLinks: [{
        id: LINK_ID,
        eventId: EVENT_ID,
        configurationId: CONFIG_ID,
        layoutVariantId: VARIANT_ID,
        linkType: "variant_configuration",
        createdAt: NOW,
      }],
      phaseLayoutSnapshots: [],
    });

    expect(parsed.phases[0]?.densityLabel).toBe("Density not checked");
    expect(parsed.phases[0]?.staffConflictsLabel).toBe("Staff conflicts not checked");
  });
});
