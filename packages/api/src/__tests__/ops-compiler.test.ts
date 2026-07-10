import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ConfigurationSheetSnapshot, EventPhaseGraph } from "@omnitwin/types";
import {
  compileOpsHandoffDraft,
  eventArchitectOpsCompilationReviewGate,
  eventGraphBindsConfiguration,
} from "../services/ops-compiler.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const CONFIG_ID = "00000000-0000-4000-8000-000000000301";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000302";
const PREVIOUS_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000303";
const USER_ID = "00000000-0000-4000-8000-000000000304";
const EVENT_ID = "00000000-0000-4000-8000-000000000305";
const PHASE_ID = "00000000-0000-4000-8000-000000000306";
const VENUE_ID = "00000000-0000-4000-8000-000000000307";
const NOW = "2026-06-12T09:00:00.000Z";
const HASH = "d".repeat(64);
const PREVIOUS_HASH = "e".repeat(64);

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function adminToken(): string {
  return signToken({
    id: USER_ID,
    email: "admin@test.com",
    role: "admin",
    venueId: VENUE_ID,
  });
}

function snapshot(overrides: Partial<ConfigurationSheetSnapshot> = {}): ConfigurationSheetSnapshot {
  return {
    id: SNAPSHOT_ID,
    configurationId: CONFIG_ID,
    version: 2,
    payload: {
      config: {
        id: CONFIG_ID,
        name: "Grand Hall dinner",
        guestCount: 120,
        layoutStyle: "dinner-rounds",
      },
      venue: {
        name: "Trades Hall of Glasgow",
        address: "85 Glassford Street",
        timezone: "Europe/London",
      },
      space: {
        name: "Grand Hall",
        widthM: 21,
        lengthM: 10.5,
        heightM: 7,
      },
      timing: null,
      instructions: {
        specialInstructions: "Keep VIP table note visible to staff.",
        dayOfContact: null,
        phaseDeadlines: [],
        accessNotes: "Use service entrance before guest arrival.",
        accessibility: null,
        dietary: {
          vegetarian: 12,
          vegan: 4,
          glutenFree: 3,
          nutFree: 1,
          halal: 0,
          kosher: 0,
          otherAllergies: "Nut allergy on table 4.",
        },
        doorSchedule: null,
      },
      phases: [
        {
          phase: "furniture",
          zones: [
            {
              zone: "Centre",
              rows: [
                {
                  key: "furniture|Centre|Round Table|0",
                  name: "Round Table",
                  category: "table",
                  qty: 12,
                  afterDepth: 0,
                  isAccessory: false,
                  notes: "VIP table at the north edge.",
                  positions: [],
                },
              ],
            },
          ],
        },
        {
          phase: "dress",
          zones: [
            {
              zone: "Centre",
              rows: [
                {
                  key: "dress|Centre|Ivory Tablecloth|1",
                  name: "Ivory Tablecloth",
                  category: "linen",
                  qty: 12,
                  afterDepth: 1,
                  isAccessory: true,
                  notes: "",
                  positions: [],
                },
              ],
            },
          ],
        },
      ],
      totals: {
        entries: [
          { name: "Round Table", category: "table", qty: 12 },
          { name: "Ivory Tablecloth", category: "linen", qty: 12 },
        ],
        totalRows: 2,
        totalItems: 24,
      },
      diagramUrl: null,
      webViewUrl: "https://example.test/hallkeeper/configuration",
      generatedAt: NOW,
      approval: {
        version: 2,
        approvedAt: NOW,
        approverName: "Venue reviewer",
      },
    },
    diagramUrl: null,
    pdfUrl: null,
    sourceHash: HASH,
    createdAt: NOW,
    createdBy: USER_ID,
    approvedAt: NOW,
    approvedBy: USER_ID,
    ...overrides,
  };
}

function previousSnapshot(): ConfigurationSheetSnapshot {
  return snapshot({
    id: PREVIOUS_SNAPSHOT_ID,
    version: 1,
    sourceHash: PREVIOUS_HASH,
    payload: {
      ...snapshot().payload,
      totals: {
        entries: [
          { name: "Round Table", category: "table", qty: 10 },
          { name: "Lectern", category: "lectern", qty: 1 },
        ],
        totalRows: 2,
        totalItems: 11,
      },
    },
  });
}

function eventGraph(): EventPhaseGraph {
  return {
    event: {
      id: EVENT_ID,
      venueId: VENUE_ID,
      createdBy: USER_ID,
      name: "Blake and Alex wedding",
      eventType: "wedding",
      status: "in_planning",
      startsAt: null,
      endsAt: null,
      guestCount: 120,
      clientName: "Blake",
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    phases: [
      {
        id: "00000000-0000-4000-8000-000000000311",
        eventId: EVENT_ID,
        templateKey: "ceremony",
        name: "Ceremony",
        sortOrder: 0,
        startsAt: null,
        durationMinutes: 45,
        guestCount: 120,
        opsTasksCount: 0,
        reviewGatesCount: 0,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: PHASE_ID,
        eventId: EVENT_ID,
        templateKey: "room-flip",
        name: "Room Flip",
        sortOrder: 1,
        startsAt: null,
        durationMinutes: 45,
        guestCount: 120,
        opsTasksCount: 2,
        reviewGatesCount: 1,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000312",
        eventId: EVENT_ID,
        templateKey: "dinner",
        name: "Dinner",
        sortOrder: 2,
        startsAt: null,
        durationMinutes: 90,
        guestCount: 120,
        opsTasksCount: 0,
        reviewGatesCount: 0,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    scenarios: [],
    layoutVariants: [],
    configurationLinks: [],
    phaseLayoutSnapshots: [],
  };
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("ops compiler services", () => {
  it("requires an explicit same-venue event binding before event-bound compilation", () => {
    const graph = eventGraph();
    expect(eventGraphBindsConfiguration(graph, CONFIG_ID, VENUE_ID)).toBe(false);
    expect(eventGraphBindsConfiguration({
      ...graph,
      configurationLinks: [{
        id: "00000000-0000-4000-8000-000000000313",
        eventId: EVENT_ID,
        configurationId: CONFIG_ID,
        layoutVariantId: null,
        linkType: "approved_snapshot_source",
        createdAt: NOW,
      }],
    }, CONFIG_ID, VENUE_ID)).toBe(true);
    expect(eventGraphBindsConfiguration({
      ...graph,
      configurationLinks: [{
        id: "00000000-0000-4000-8000-000000000313",
        eventId: EVENT_ID,
        configurationId: CONFIG_ID,
        layoutVariantId: null,
        linkType: "approved_snapshot_source",
        createdAt: NOW,
      }],
    }, CONFIG_ID, "00000000-0000-4000-8000-000000000399")).toBe(false);
  });

  it("keeps Event Architect blocked until a separate reviewed evidence artifact exists", () => {
    expect(eventArchitectOpsCompilationReviewGate(null)).toBeNull();
    expect(eventArchitectOpsCompilationReviewGate({
      status: "requires_human_review",
      reason: "planning_assumptions_and_simplified_crowd_model",
      requiredData: [
        "surveyed_door_positions",
        "reviewed_route_model",
        "venue_operations_signoff",
      ],
      blockingForOpsCompilation: true,
    })).toEqual({
      source: "event_architect_guest_flow",
      reason: "planning_assumptions_and_simplified_crowd_model",
      requiredData: [
        "surveyed_door_positions",
        "reviewed_route_model",
        "venue_operations_signoff",
      ],
      resolution: "reviewed_evidence_artifact_required",
    });
  });

  it("compiles deterministic handoff output", () => {
    const left = compileOpsHandoffDraft({
      snapshot: snapshot(),
      previousSnapshot: previousSnapshot(),
      eventGraph: eventGraph(),
      clientNotes: "Bride arrival is expected at 17:00.",
    });
    const right = compileOpsHandoffDraft({
      snapshot: snapshot(),
      previousSnapshot: previousSnapshot(),
      eventGraph: eventGraph(),
      clientNotes: "Bride arrival is expected at 17:00.",
    });

    expect(right.digest).toBe(left.digest);
    expect(right.opsTasks.map((task) => task.title)).toEqual(left.opsTasks.map((task) => task.title));
  });

  it("keeps counts and generated sections correct", () => {
    const draft = compileOpsHandoffDraft({
      snapshot: snapshot(),
      previousSnapshot: null,
      eventGraph: eventGraph(),
      clientNotes: null,
    });

    expect(draft.pickListItems).toHaveLength(2);
    expect(draft.pickListItems.reduce((sum, item) => sum + item.quantity, 0)).toBe(24);
    expect(draft.opsTasks.some((task) => task.kind === "setup")).toBe(true);
    expect(draft.opsTasks.some((task) => task.kind === "breakdown")).toBe(true);
    expect(draft.roomFlipPlans).toHaveLength(1);
  });

  it("computes snapshot diffs from the previous approved version", () => {
    const draft = compileOpsHandoffDraft({
      snapshot: snapshot(),
      previousSnapshot: previousSnapshot(),
      eventGraph: null,
      clientNotes: null,
    });

    expect(draft.snapshotDiff.addedCount).toBe(1);
    expect(draft.snapshotDiff.removedCount).toBe(1);
    expect(draft.snapshotDiff.changedCount).toBe(1);
    expect(draft.snapshotDiff.payload.added).toContain("12 x Ivory Tablecloth");
    expect(draft.snapshotDiff.payload.removed).toContain("1 x Lectern");
    expect(draft.snapshotDiff.payload.changed).toContain("Round Table: 10 -> 12");
  });

  it("keeps supplier pack wording inside safe internal planning language", () => {
    const draft = compileOpsHandoffDraft({
      snapshot: snapshot({
        payload: {
          ...snapshot().payload,
          instructions: {
            ...snapshot().payload.instructions!,
            accessNotes: "This is certified safe and production ready.",
          },
        },
      }),
      previousSnapshot: null,
      eventGraph: null,
      clientNotes: "Layout is legally compliant.",
    });

    const source = `${draft.supplierInstructions.map((item) => item.detail).join(" ")} ${draft.beoBody}`;
    expect(source).not.toMatch(/\bcertified safe\b/iu);
    expect(source).not.toMatch(/\bproduction ready\b/iu);
    expect(source).not.toMatch(/\blegally compliant\b/iu);
  });

  it("does not mutate the hallkeeper sheet snapshot", () => {
    const original = snapshot();
    const before = JSON.stringify(original);
    compileOpsHandoffDraft({
      snapshot: original,
      previousSnapshot: previousSnapshot(),
      eventGraph: eventGraph(),
      clientNotes: null,
    });
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("ops handoff routes", () => {
  it("requires auth before compiling a handoff pack", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/ops/handoff-packs/from-configuration/${CONFIG_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates compile configuration IDs before database access", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/ops/handoff-packs/from-configuration/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates compile body before database access", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/ops/handoff-packs/from-configuration/${CONFIG_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { eventId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates handoff pack IDs before database access", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/ops/handoff-packs/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("mounts the ops route prefix", async () => {
    const source = await readFile(resolve("src/index.ts"), "utf-8");
    expect(source).toContain('prefix: "/ops"');
  });

  it("keeps compiler route and service wording inside safe boundaries", async () => {
    const routeSource = await readFile(resolve("src/routes/ops-handoff.ts"), "utf-8");
    const serviceSource = await readFile(resolve("src/services/ops-compiler.ts"), "utf-8");
    const source = `${routeSource}\n${serviceSource}`;
    expect(source).not.toMatch(/\bfire approved\b/iu);
    expect(source).not.toMatch(/\bcertified safe\b/iu);
    expect(source).not.toMatch(/\blegally compliant\b/iu);
    expect(source).not.toMatch(/\bsurvey-grade\b/iu);
    expect(source).not.toMatch(/\bapproved for occupancy\b/iu);
    expect(source).not.toMatch(/\bguaranteed accessible\b/iu);
    expect(source).not.toMatch(/\bBlack Label\b/u);
    expect(source).not.toMatch(/\bphotoreal digital twin\b/iu);
    expect(source).toContain('code: "BLOCKING_REVIEW_GATE"');
    expect(source).toContain('code: "EVENT_CONFIGURATION_BINDING_REQUIRED"');
  });
});
