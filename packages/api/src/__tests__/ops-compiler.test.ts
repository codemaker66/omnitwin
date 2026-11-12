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
import { generateManifestV2, type AccessoryRule, type ManifestObjectV2 } from "../services/manifest-generator-v2.js";

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
        spaceId: null,
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
        spaceId: null,
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
        spaceId: null,
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

  // T-695 api-eventday-sheet-9. A chair set at a table folds into the table's
  // manifest row ("Round Table with 4 chairs"), so the manifest's totals have
  // no line for it; the frozen floor plan still holds every piece. The pick
  // list, its total, the breakdown and the BEO count what the store sends out.
  describe("counts every placed piece, chairs set at tables included", () => {
    const ROOM = { widthM: 21, lengthM: 10.5 };
    const ASSET = {
      table: "00000000-0000-4000-8000-000000000401",
      chiavari: "00000000-0000-4000-8000-000000000402",
      banquet: "00000000-0000-4000-8000-000000000403",
    } as const;
    const CLOTH: AccessoryRule = { name: "Ivory Tablecloth", category: "linen", quantityPerParent: 1, phase: "dress", afterDepth: 1 };

    /** Two round tables of `seatedPerTable` chairs, as the planner groups
     *  them, plus `looseChairs` chairs nobody grouped; frozen as an approval
     *  freezes them. */
    function frozen(chair: "Chiavari Chair" | "Banquet Chair", looseChairs: number, seatedPerTable = 4): ConfigurationSheetSnapshot {
      const objects: ManifestObjectV2[] = [];
      for (let table = 0; table < 2; table += 1) {
        const tableId = `00000000-0000-4000-8000-0000000005${String(table)}0`;
        const x = table * 5 - 2.5;
        objects.push({ id: tableId, assetName: "Round Table", assetCategory: "table", positionX: x, positionY: 0, positionZ: 0, rotationY: 0, chairCount: 0, groupId: tableId });
        for (let seat = 0; seat < seatedPerTable; seat += 1) {
          const angle = (seat * Math.PI) / 2;
          objects.push({
            id: `00000000-0000-4000-8000-0000000005${String(table)}${String(seat + 1)}`, assetName: chair, assetCategory: "chair",
            positionX: x + Math.cos(angle), positionY: 0, positionZ: Math.sin(angle), rotationY: 0, chairCount: 0, groupId: tableId,
          });
        }
      }
      for (let seat = 0; seat < looseChairs; seat += 1) {
        objects.push({ id: `00000000-0000-4000-8000-0000000006${String(seat).padStart(2, "0")}`, assetName: chair, assetCategory: "chair", positionX: seat, positionY: 0, positionZ: 4, rotationY: 0, chairCount: 0, groupId: null });
      }
      const manifest = generateManifestV2(objects, ROOM, new Map([["Round Table", [CLOTH]]]));
      return snapshot({
        payload: {
          ...snapshot().payload,
          phases: manifest.phases,
          totals: manifest.totals,
          floorPlan: {
            coordinateSpace: "real_m_v1",
            outline: [{ x: -10.5, z: -5.25 }, { x: 10.5, z: -5.25 }, { x: 10.5, z: 5.25 }, { x: -10.5, z: 5.25 }],
            objects: objects.map((object) => ({
              objectId: object.id,
              assetDefinitionId: object.assetCategory === "table" ? ASSET.table : chair === "Chiavari Chair" ? ASSET.chiavari : ASSET.banquet,
              name: object.assetName, category: object.assetCategory, x: object.positionX, z: object.positionZ,
              rotationY: 0, scale: 1, widthM: object.assetCategory === "table" ? 1.8 : 0.45, depthM: object.assetCategory === "table" ? 1.8 : 0.45,
              collisionType: object.assetCategory === "table" ? "cylinder" as const : "box" as const,
            })),
          },
        },
      });
    }

    it("lists the chairs on the pick list, and counts them in its total and the BEO", () => {
      const draft = compileOpsHandoffDraft({ snapshot: frozen("Chiavari Chair", 2), previousSnapshot: null, eventGraph: null, clientNotes: null });
      const lines = draft.pickListItems.map((item) => `${String(item.quantity)} x ${item.name} (${item.category})`);
      expect(lines.sort()).toEqual(["10 x Chiavari Chair (chair)", "2 x Ivory Tablecloth (linen)", "2 x Round Table (table)"]);
      expect(draft.pickListItems.reduce((sum, item) => sum + item.quantity, 0)).toBe(14);
      expect(draft.beoBody).toContain("Pick list items: 3; total quantity 14.");
      // Set-up still reads table by table, as the sheet does.
      expect(draft.opsTasks.filter((task) => task.kind === "setup").map((task) => task.title)).toContain("Set 2 x Round Table with 4 chairs");
    });

    it("has the breakdown account for every chair", () => {
      const draft = compileOpsHandoffDraft({ snapshot: frozen("Chiavari Chair", 2), previousSnapshot: null, eventGraph: null, clientNotes: null });
      const breakdown = draft.opsTasks.filter((task) => task.kind === "breakdown").map((task) => task.detail);
      expect(breakdown).toContain("Account for 10 x Chiavari Chair from the approved handoff pack.");
      expect(breakdown).toContain("Account for 2 x Round Table from the approved handoff pack.");
    });

    it("shows a change of chair at the tables in the changes since the last handoff", () => {
      const draft = compileOpsHandoffDraft({
        snapshot: frozen("Chiavari Chair", 0),
        previousSnapshot: { ...frozen("Banquet Chair", 0), id: PREVIOUS_SNAPSHOT_ID, version: 1, sourceHash: PREVIOUS_HASH },
        eventGraph: null,
        clientNotes: null,
      });
      expect(draft.snapshotDiff.payload).toEqual({ added: ["8 x Chiavari Chair"], removed: ["8 x Banquet Chair"], changed: [] });
    });

    // T-695 review C7: counting pieces alone hid a re-seating that keeps every
    // count, which the row-based diff used to show: the tables' rows name the
    // chairs set at them, so they are compared as well.
    it("shows chairs moved from the tables into rows, though every count is the same", () => {
      const draft = compileOpsHandoffDraft({
        snapshot: frozen("Chiavari Chair", 8, 0),
        previousSnapshot: { ...frozen("Chiavari Chair", 0), id: PREVIOUS_SNAPSHOT_ID, version: 1, sourceHash: PREVIOUS_HASH },
        eventGraph: null,
        clientNotes: null,
      });
      expect(draft.snapshotDiff.payload).toEqual({ added: ["2 x Round Table"], removed: ["2 x Round Table with 4 chairs"], changed: [] });
    });

    it("does not report a change twice, or report one at all, when nothing moved", () => {
      const same = compileOpsHandoffDraft({
        snapshot: frozen("Chiavari Chair", 2),
        previousSnapshot: { ...frozen("Chiavari Chair", 2), id: PREVIOUS_SNAPSHOT_ID, version: 1, sourceHash: PREVIOUS_HASH },
        eventGraph: null,
        clientNotes: null,
      });
      expect(same.snapshotDiff.summary).toBe("No furniture count changes since the previous approved snapshot.");
    });

    // A plan frozen before 6 September 2026 has no floor plan, so the model
    // of the chairs set at its tables was never recorded. The comparison
    // stays totals against totals, and (review C6, as ruled) it says chairs
    // at tables can't be compared rather than "No furniture count changes".
    const CHAIRS_NOT_COMPARED = "Chairs at tables can't be compared with a plan frozen before 6 September 2026.";
    const before = (plan: ConfigurationSheetSnapshot): ConfigurationSheetSnapshot =>
      ({ ...plan, id: PREVIOUS_SNAPSHOT_ID, version: 1, sourceHash: PREVIOUS_HASH, payload: { ...plan.payload, floorPlan: null } });

    it("compares a plan frozen before floor plans by its totals on both sides, never totals against pieces", () => {
      const current = frozen("Chiavari Chair", 2);
      const draft = compileOpsHandoffDraft({ snapshot: current, previousSnapshot: before(current), eventGraph: null, clientNotes: null });
      expect(draft.snapshotDiff.payload).toEqual({ added: [], removed: [], changed: [] });
      expect(draft.snapshotDiff.summary).toBe(CHAIRS_NOT_COMPARED);
    });

    it("keeps the other furniture counts beside the chairs note", () => {
      const draft = compileOpsHandoffDraft({
        snapshot: frozen("Chiavari Chair", 4), previousSnapshot: before(frozen("Chiavari Chair", 2)), eventGraph: null, clientNotes: null,
      });
      expect(draft.snapshotDiff.payload.changed).toEqual(["Chiavari Chair: 2 -> 4"]);
      expect(draft.snapshotDiff.summary).toBe(`0 added, 0 removed, 1 quantity changed since the previous approved snapshot. ${CHAIRS_NOT_COMPARED}`);
    });

    it("claims no change against an older plan when no table on either has chairs", () => {
      const draft = compileOpsHandoffDraft({
        snapshot: frozen("Chiavari Chair", 8, 0), previousSnapshot: before(frozen("Chiavari Chair", 8, 0)), eventGraph: null, clientNotes: null,
      });
      expect(draft.snapshotDiff.summary).toBe("No furniture count changes since the previous approved snapshot.");
    });
  });

  // T-695 review H3: phases tied on sortOrder came back in whatever order the
  // database gave, so a room flip's neighbours (its from and to labels) could
  // differ between two compiles of one plan, and the recompile made a new pack.
  it("reads a room flip's neighbours the same way whatever order phases tied on sortOrder arrive in", () => {
    const graph = eventGraph();
    const [ceremony, flip, dinner] = graph.phases;
    if (ceremony === undefined || flip === undefined || dinner === undefined) throw new Error("fixture");
    const drinks = { ...ceremony, id: "00000000-0000-4000-8000-000000000314", templateKey: "arrival" as const, name: "Drinks reception" };
    const compile = (phases: EventPhaseGraph["phases"]) => compileOpsHandoffDraft({
      snapshot: snapshot(), previousSnapshot: null, eventGraph: { ...graph, phases }, clientNotes: null,
    });
    const one = compile([ceremony, drinks, flip, dinner]);
    const other = compile([drinks, ceremony, flip, dinner]);
    expect(other.roomFlipPlans).toEqual(one.roomFlipPlans);
    expect(other.opsTasks.filter((task) => task.kind === "room_flip")).toEqual(one.opsTasks.filter((task) => task.kind === "room_flip"));
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
