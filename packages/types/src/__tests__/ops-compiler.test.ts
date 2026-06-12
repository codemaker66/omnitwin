import { describe, expect, it } from "vitest";
import {
  BeoDocumentSchema,
  HandoffPackSchema,
  OpsHandoffPackBundleSchema,
  PickListItemSchema,
  SafeOpsTextSchema,
  SnapshotDiffSchema,
  opsHandoffPayloadDigest,
  type OpsHandoffPackBundle,
} from "../ops-compiler.js";

const NOW = "2026-06-12T09:00:00.000Z";
const HANDOFF_PACK_ID = "00000000-0000-4000-8000-000000000201";
const CONFIG_ID = "00000000-0000-4000-8000-000000000202";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000203";
const TASK_GROUP_ID = "00000000-0000-4000-8000-000000000204";
const OPS_TASK_ID = "00000000-0000-4000-8000-000000000205";
const PICK_LIST_ID = "00000000-0000-4000-8000-000000000206";
const PICK_LIST_ITEM_ID = "00000000-0000-4000-8000-000000000207";
const SUPPLIER_INSTRUCTION_ID = "00000000-0000-4000-8000-000000000208";
const LOAD_IN_ID = "00000000-0000-4000-8000-000000000209";
const BREAKDOWN_ID = "00000000-0000-4000-8000-000000000210";
const ROOM_FLIP_ID = "00000000-0000-4000-8000-000000000211";
const BEO_ID = "00000000-0000-4000-8000-000000000212";
const DIFF_ID = "00000000-0000-4000-8000-000000000213";
const HASH = "c".repeat(64);

function fixtureBundle(): OpsHandoffPackBundle {
  return {
    pack: HandoffPackSchema.parse({
      id: HANDOFF_PACK_ID,
      eventId: null,
      configId: CONFIG_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotHash: HASH,
      version: 1,
      status: "compiled",
      sourceLabel: "Approved configuration snapshot v1",
      summary: "Grand Hall handoff compiled from approved snapshot v1.",
      createdBy: null,
      compiledAt: NOW,
      updatedAt: NOW,
    }),
    taskGroups: [{
      id: TASK_GROUP_ID,
      handoffPackId: HANDOFF_PACK_ID,
      title: "Setup tasks",
      kind: "setup",
      sortOrder: 0,
      createdAt: NOW,
    }],
    opsTasks: [{
      id: OPS_TASK_ID,
      handoffPackId: HANDOFF_PACK_ID,
      taskGroupId: TASK_GROUP_ID,
      phaseId: null,
      kind: "setup",
      title: "Set 12 x Round Table",
      detail: "Place in Centre during Furniture.",
      status: "todo",
      sortOrder: 0,
      dueLabel: null,
      sourceRef: "furniture|centre|Round Table|0",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    furniturePickList: {
      id: PICK_LIST_ID,
      handoffPackId: HANDOFF_PACK_ID,
      title: "Grand Hall furniture pick list",
      totalItems: 12,
      createdAt: NOW,
    },
    pickListItems: [PickListItemSchema.parse({
      id: PICK_LIST_ITEM_ID,
      pickListId: PICK_LIST_ID,
      name: "Round Table",
      category: "table",
      quantity: 12,
      sourcePhase: null,
      sourceZone: null,
      notes: null,
      sortOrder: 0,
      createdAt: NOW,
    })],
    supplierInstructions: [{
      id: SUPPLIER_INSTRUCTION_ID,
      handoffPackId: HANDOFF_PACK_ID,
      supplierId: null,
      category: "operations",
      title: "Supplier coordination check",
      detail: "Confirm supplier scope before dispatch.",
      arrivalWindow: null,
      sourceRef: "snapshot",
      sortOrder: 0,
      createdAt: NOW,
    }],
    loadInSequence: [{
      id: LOAD_IN_ID,
      handoffPackId: HANDOFF_PACK_ID,
      kind: "load_in",
      stepNumber: 1,
      title: "Load in Furniture",
      detail: "One row from the approved snapshot is grouped in this phase.",
      sortOrder: 0,
      createdAt: NOW,
    }],
    breakdownSequence: [{
      id: BREAKDOWN_ID,
      handoffPackId: HANDOFF_PACK_ID,
      kind: "breakdown",
      stepNumber: 1,
      title: "Break down Furniture",
      detail: "One row from the approved snapshot is grouped in this phase.",
      sortOrder: 0,
      createdAt: NOW,
    }],
    roomFlipPlans: [{
      id: ROOM_FLIP_ID,
      handoffPackId: HANDOFF_PACK_ID,
      phaseId: null,
      fromPhaseLabel: "Ceremony",
      toPhaseLabel: "Dinner",
      durationMinutes: 45,
      taskCount: 1,
      reviewGateCount: 1,
      notes: "Room flip is an internal planning handoff phase.",
      createdAt: NOW,
    }],
    beoDocument: BeoDocumentSchema.parse({
      id: BEO_ID,
      handoffPackId: HANDOFF_PACK_ID,
      title: "Grand Hall BEO internal handoff",
      body: "BEO internal operations handoff from approved planning data.",
      sourceSnapshotHash: HASH,
      safeStatus: "internal_operations_handoff",
      createdAt: NOW,
    }),
    snapshotDiff: SnapshotDiffSchema.parse({
      id: DIFF_ID,
      handoffPackId: HANDOFF_PACK_ID,
      previousSnapshotHash: null,
      currentSnapshotHash: HASH,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      summary: "No previous approved snapshot is available for comparison.",
      payload: { added: [], removed: [], changed: [] },
      createdAt: NOW,
    }),
  };
}

describe("Ops Compiler contracts", () => {
  it("parses a complete handoff bundle", () => {
    const parsed = OpsHandoffPackBundleSchema.parse(fixtureBundle());
    expect(parsed.pack.status).toBe("compiled");
    expect(parsed.opsTasks).toHaveLength(1);
    expect(parsed.furniturePickList.totalItems).toBe(12);
  });

  it("blocks unsafe operations wording", () => {
    expect(SafeOpsTextSchema.safeParse("Internal planning handoff").success).toBe(true);
    expect(SafeOpsTextSchema.safeParse("This room is certified safe.").success).toBe(false);
  });

  it("produces deterministic handoff digests", () => {
    const left = opsHandoffPayloadDigest({
      snapshotHash: HASH,
      taskTitles: ["Set 12 x Round Table"],
      pickList: [{ name: "Round Table", quantity: 12 }],
      supplierInstructionTitles: ["Supplier coordination check"],
    });
    const right = opsHandoffPayloadDigest({
      supplierInstructionTitles: ["Supplier coordination check"],
      pickList: [{ quantity: 12, name: "Round Table" }],
      taskTitles: ["Set 12 x Round Table"],
      snapshotHash: HASH,
    });
    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
  });
});
