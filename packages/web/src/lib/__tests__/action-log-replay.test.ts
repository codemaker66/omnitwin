import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../api/action-log.js";
import { replayActions, verifyReplayable } from "../action-log-replay.js";

// G4 Slice 3: replay-from-log verification. A read-back audit page is
// "replayable" when it can drive a faithful reconstruction: server-ordered
// (strictly increasing ordinals), every entry a valid Action envelope, and
// every document mutation carrying a real inverse (history.*/log.* records
// are meta and exempt). This is the dev verification the programme's DoD
// names — full session replay is slice 4.

function entry(
  ordinal: number,
  overrides: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place Round table" },
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:00:00.000Z",
    receivedAt: "2026-07-18T10:00:01.000Z",
    ...overrides,
  };
}

describe("verifyReplayable", () => {
  it("accepts a well-ordered page of valid mutations and metas", () => {
    const verdict = verifyReplayable([
      entry(1),
      entry(2, { intent: "history.undo", inverse: { intent: "history.redo" } }),
      entry(3, { intent: "log.summarized", inverse: null }),
      entry(7, { intent: "markup.draw" }), // ordinal gaps are fine (other pages)
    ]);
    expect(verdict.replayable).toBe(true);
    expect(verdict.issues).toEqual([]);
    expect(verdict.counts).toEqual({ total: 4, mutations: 2, metas: 1, logManagement: 1 });
  });

  it("rejects out-of-order or duplicate ordinals — server order is the replay order", () => {
    const outOfOrder = verifyReplayable([entry(2), entry(1)]);
    expect(outOfOrder.replayable).toBe(false);
    expect(outOfOrder.issues.some((issue) => issue.includes("ordinal"))).toBe(true);

    const duplicated = verifyReplayable([entry(1), entry(1, { id: "11111111-1111-4111-8111-111111111111" })]);
    expect(duplicated.replayable).toBe(false);
  });

  it("rejects a document mutation without a real inverse", () => {
    const verdict = verifyReplayable([entry(1, { inverse: null })]);
    expect(verdict.replayable).toBe(false);
    expect(verdict.issues.some((issue) => issue.includes("inverse"))).toBe(true);
  });

  it("rejects an entry whose reconstructed envelope fails the Action contract", () => {
    const verdict = verifyReplayable([entry(1, { intent: "Not A Valid Intent" })]);
    expect(verdict.replayable).toBe(false);
  });

  it("rejects duplicate action ids — one action must never replay twice", () => {
    const verdict = verifyReplayable([
      entry(1),
      entry(2, { id: "00000000-0000-4000-8000-000000000001" }),
    ]);
    expect(verdict.replayable).toBe(false);
    expect(verdict.issues.some((issue) => issue.includes("duplicate"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replayActions — slice 4: the actual session replay. Applies object.*
// payload deltas in server order; history.undo/redo replay via the gesture
// stack (each action's own recorded inverse — nothing recomputed); other
// surfaces are tallied as skipped, never silently dropped.
// ---------------------------------------------------------------------------

const TABLE = { id: "obj-1", kind: "table-round", positionX: 1 };

function place(ordinal: number): AuditLogEntry {
  return entry(ordinal, {
    intent: "object.place",
    payload: { label: "Place", added: [{ object: TABLE, index: 0 }], removed: [], updated: [] },
    inverse: { label: "Place", added: [], removed: [{ object: TABLE, index: 0 }], updated: [] },
  });
}

function move(ordinal: number, from: number, to: number): AuditLogEntry {
  return entry(ordinal, {
    intent: "object.update",
    payload: { label: "Move", added: [], removed: [], updated: [{ id: "obj-1", before: { positionX: from }, after: { positionX: to } }] },
    inverse: { label: "Move", added: [], removed: [], updated: [{ id: "obj-1", before: { positionX: to }, after: { positionX: from } }] },
  });
}

function meta(ordinal: number, intent: "history.undo" | "history.redo"): AuditLogEntry {
  return entry(ordinal, { intent, payload: { label: "Move" }, inverse: { intent: "history.redo" } });
}

describe("replayActions", () => {
  it("reconstructs the final document from place/update/remove in server order", () => {
    const result = replayActions([
      place(1),
      move(2, 1, 5),
      entry(3, {
        intent: "object.remove",
        payload: { label: "Remove", added: [], removed: [{ object: { ...TABLE, positionX: 5 }, index: 0 }], updated: [] },
        inverse: { label: "Remove", added: [{ object: { ...TABLE, positionX: 5 }, index: 0 }], removed: [], updated: [] },
      }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.objects).toEqual([]);
    expect(result.applied).toBe(3);

    const partial = replayActions([place(1), move(2, 1, 5)]);
    expect(partial.objects).toEqual([{ ...TABLE, positionX: 5 }]);
  });

  it("replays history.undo/redo through each action's own recorded inverse", () => {
    const undone = replayActions([place(1), move(2, 1, 5), meta(3, "history.undo")]);
    expect(undone.objects).toEqual([{ ...TABLE, positionX: 1 }]); // the move reverted
    expect(undone.undone).toBe(1);

    const redone = replayActions([place(1), move(2, 1, 5), meta(3, "history.undo"), meta(4, "history.redo")]);
    expect(redone.objects).toEqual([{ ...TABLE, positionX: 5 }]);
    expect(redone.redone).toBe(1);
  });

  it("tallies non-object surfaces as skipped — reported, never silent", () => {
    const result = replayActions([
      place(1),
      entry(2, { intent: "markup.draw", payload: { stroke: { id: "markup-1" } }, inverse: { strokeId: "markup-1" } }),
      entry(3, { intent: "lighting.rig.set-count", payload: { family: "par", count: 4 }, inverse: { family: "par", count: 12 } }),
      entry(4, { intent: "markup.draw", payload: { stroke: { id: "markup-2" } }, inverse: { strokeId: "markup-2" } }),
    ]);
    expect(result.objects).toEqual([TABLE]);
    expect(result.skipped).toEqual([
      { intent: "markup.draw", count: 2 },
      { intent: "lighting.rig.set-count", count: 1 },
    ]);
  });

  it("reports a fold summary as an issue — those actions are not individually replayable", () => {
    const result = replayActions([
      entry(1, { intent: "log.summarized", payload: { folded: 1000 }, inverse: null }),
      place(2),
    ]);
    expect(result.objects).toEqual([TABLE]); // the tail still applies
    expect(result.issues.some((issue) => issue.includes("summarized"))).toBe(true);
  });

  it("refuses a non-replayable page outright (the gate runs first)", () => {
    const result = replayActions([place(2), place(1)]); // broken server order
    expect(result.applied).toBe(0);
    expect(result.objects).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("applies added entries by index regardless of array order — matching the live engine's sort (reviewer M1)", () => {
    const A = { id: "obj-a", kind: "chair", positionX: 0 };
    const C = { id: "obj-c", kind: "chair", positionX: 2 };
    const result = replayActions([
      place(1), // obj-1 at index 0
      entry(2, {
        intent: "object.place",
        // Deliberately NOT ascending: [{C,1},{A,0}]. The live engine sorts
        // before splicing → [A, C, obj-1]; an order-naive splice would
        // produce [A, obj-1, C] from the very same recorded delta.
        payload: { label: "Place pair", added: [{ object: C, index: 1 }, { object: A, index: 0 }], removed: [], updated: [] },
        inverse: { label: "Place pair", added: [], removed: [{ object: C, index: 1 }, { object: A, index: 0 }], updated: [] },
      }),
    ]);
    expect(result.objects.map((o) => o.id)).toEqual(["obj-a", "obj-c", "obj-1"]);
  });

  it("an undo with nothing to undo is an issue, not a crash", () => {
    const result = replayActions([meta(1, "history.undo"), place(2)]);
    expect(result.objects).toEqual([TABLE]);
    expect(result.issues.some((issue) => issue.includes("undo"))).toBe(true);
  });
});
