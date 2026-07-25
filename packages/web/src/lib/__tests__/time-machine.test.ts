import { describe, expect, it } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import type { AuditLogEntry } from "../../api/action-log.js";
import type { ReplayObject } from "../action-log-replay.js";
import { documentAtOrdinal, planRestore, timelineMarkers } from "../time-machine.js";

// ---------------------------------------------------------------------------
// The Time Machine — G4's payoff. Deep undo, version restore and replay are
// NOT three features: they are three questions asked of one engine.
//
//   "what did the room look like at ordinal N?"        -> documentAtOrdinal
//   "show me the points I can travel to"               -> timelineMarkers
//   "put the room back to N"                           -> planRestore
//
// The load-bearing design decision: restoring NEVER rewrites history. It
// APPENDS one `layout.restore` Action whose delta moves the live document to
// the historical state, and whose inverse brings it back. The trail stays
// append-only, so restoring is itself an auditable, reversible act — and a
// restore can be undone like any other gesture.
// ---------------------------------------------------------------------------

const TABLE: ReplayObject = { id: "obj-table", kind: "table-round", positionX: 1 };
const CHAIR: ReplayObject = { id: "obj-chair", kind: "chair", positionX: 4 };

const CTX = {
  actor: { kind: "operator" as const, ref: "user-1" },
  surface: "planner",
  makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  now: () => "2026-07-25T12:00:00.000Z",
};

function entry(ordinal: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place", added: [], removed: [], updated: [] },
    inverse: { label: "Place", added: [], removed: [], updated: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-25T10:00:00.000Z",
    receivedAt: "2026-07-25T10:00:01.000Z",
    ...overrides,
  };
}

function place(ordinal: number, object: ReplayObject, index = 0): AuditLogEntry {
  return entry(ordinal, {
    intent: "object.place",
    payload: { label: `Place ${String(object.kind)}`, added: [{ object, index }], removed: [], updated: [] },
    inverse: { label: `Place ${String(object.kind)}`, added: [], removed: [{ object, index }], updated: [] },
  });
}

function move(ordinal: number, id: string, from: number, to: number): AuditLogEntry {
  return entry(ordinal, {
    intent: "object.update",
    payload: { label: "Move", added: [], removed: [], updated: [{ id, before: { positionX: from }, after: { positionX: to } }] },
    inverse: { label: "Move", added: [], removed: [], updated: [{ id, before: { positionX: to }, after: { positionX: from } }] },
  });
}

/** A recorded trail: place a table, place a chair, move the table twice. */
const TRAIL: readonly AuditLogEntry[] = [
  place(10, TABLE),
  place(20, CHAIR, 1),
  move(30, "obj-table", 1, 5),
  move(40, "obj-table", 5, 9),
];

describe("documentAtOrdinal", () => {
  it("reconstructs the room as it stood at any recorded point", () => {
    expect(documentAtOrdinal(TRAIL, 0).objects).toEqual([]);
    expect(documentAtOrdinal(TRAIL, 10).objects).toEqual([TABLE]);
    expect(documentAtOrdinal(TRAIL, 20).objects.map((o) => o.id)).toEqual(["obj-table", "obj-chair"]);
    expect(documentAtOrdinal(TRAIL, 30).objects[0]).toEqual({ ...TABLE, positionX: 5 });
    expect(documentAtOrdinal(TRAIL, 40).objects[0]).toEqual({ ...TABLE, positionX: 9 });
  });

  it("is inclusive of the named ordinal and ignores everything after it", () => {
    const at30 = documentAtOrdinal(TRAIL, 30);
    expect(at30.objects[0]).toEqual({ ...TABLE, positionX: 5 }); // the 30 move IS applied
    expect(at30.appliedThrough).toBe(30);
  });

  it("lands between recorded ordinals without inventing state", () => {
    // Server ordinals are sparse (other configurations interleave). Asking
    // for 25 must give exactly the state after 20 — never a partial 30.
    expect(documentAtOrdinal(TRAIL, 25).objects.map((o) => o.id)).toEqual(["obj-table", "obj-chair"]);
    expect(documentAtOrdinal(TRAIL, 25).appliedThrough).toBe(20);
  });

  it("beyond the newest ordinal equals the full replay", () => {
    expect(documentAtOrdinal(TRAIL, 9_999).objects).toEqual(documentAtOrdinal(TRAIL, 40).objects);
  });

  it("honours recorded undo/redo — history is replayed, not recomputed", () => {
    const withUndo = [...TRAIL, entry(50, { intent: "history.undo", payload: { label: "Move" }, inverse: { intent: "history.redo" } })];
    // The undo reverts the ordinal-40 move, so the table returns to 5.
    expect(documentAtOrdinal(withUndo, 50).objects[0]).toEqual({ ...TABLE, positionX: 5 });
  });

  it("reports the same issues the replayer would, and never throws on a broken trail", () => {
    const broken = [place(20, TABLE), place(10, CHAIR)]; // out of server order
    const result = documentAtOrdinal(broken, 20);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.objects).toEqual([]);
  });
});

describe("the base state — the trail is not self-sufficient on its own", () => {
  // loadConfiguration writes the saved objects straight into the store with
  // an empty history and emits NO Action for them (editor-store.ts). So for
  // any configuration reopened in a later session the trail holds only the
  // NEW gestures. Replaying from empty then reconstructs a room missing all
  // pre-existing furniture — and silently reports the follow-up edits as
  // touching absent objects. The engine must therefore accept the loaded
  // objects as an explicit starting point.
  const LOADED: readonly ReplayObject[] = [TABLE];
  const MOVE_ONLY: readonly AuditLogEntry[] = [move(10, "obj-table", 1, 7)];

  it("without a base, a reopened configuration replays as a room missing its furniture (documented, not desired)", () => {
    const blind = documentAtOrdinal(MOVE_ONLY, 10);
    expect(blind.objects).toEqual([]);
    expect(blind.issues.some((issue) => issue.includes("not present"))).toBe(true);
  });

  it("with the loaded objects as the base, the same trail reconstructs correctly", () => {
    const anchored = documentAtOrdinal(MOVE_ONLY, 10, LOADED);
    expect(anchored.objects).toEqual([{ ...TABLE, positionX: 7 }]);
    expect(anchored.issues).toEqual([]);
  });

  it("travelling to before the first recorded gesture returns the base itself", () => {
    expect(documentAtOrdinal(MOVE_ONLY, 0, LOADED).objects).toEqual(LOADED);
  });

  it("the base never leaks between calls", () => {
    documentAtOrdinal(MOVE_ONLY, 10, LOADED);
    expect(LOADED).toEqual([TABLE]); // caller's array untouched
  });
});

describe("timelineMarkers", () => {
  it("offers one travellable point per recorded gesture, newest first, with human labels", () => {
    const markers = timelineMarkers(TRAIL);
    expect(markers.map((m) => m.ordinal)).toEqual([40, 30, 20, 10]);
    expect(markers[0]?.title).toBe("Move");
    expect(markers[3]?.title).toBe("Place table-round");
    expect(markers[0]?.actorLabel).toBe("Operator");
    expect(markers[0]?.when).toContain("10:00");
  });

  it("marks which points are structural (add/remove) versus adjustments", () => {
    const markers = timelineMarkers(TRAIL);
    expect(markers.find((m) => m.ordinal === 10)?.structural).toBe(true);
    expect(markers.find((m) => m.ordinal === 30)?.structural).toBe(false);
  });

  it("excludes log-management records — a fold summary is not a place you can travel to", () => {
    const withFold = [entry(5, { intent: "log.summarized", payload: { folded: 900 }, inverse: null }), ...TRAIL];
    expect(timelineMarkers(withFold).some((m) => m.ordinal === 5)).toBe(false);
  });
});

describe("planRestore", () => {
  it("emits ONE append-only Action whose delta moves the live room to the historical state", () => {
    const current = documentAtOrdinal(TRAIL, 40).objects; // table at 9, chair present
    const target = documentAtOrdinal(TRAIL, 10).objects; // table at 1, no chair

    const action = planRestore(current, target, CTX, { targetOrdinal: 10 });
    if (action === null) throw new Error("expected a restore action");

    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.intent).toBe("layout.restore");
    expect(action.provenance).toEqual({ surface: "planner", tool: "time-machine" });

    const payload = action.payload as {
      targetOrdinal: number;
      removed: { object: { id: string } }[];
      updated: { id: string; after: Record<string, unknown> }[];
    };
    expect(payload.targetOrdinal).toBe(10);
    expect(payload.removed.map((r) => r.object.id)).toEqual(["obj-chair"]); // the chair goes
    expect(payload.updated[0]?.after).toEqual({ positionX: 1 }); // the table moves back
  });

  it("carries a true inverse — a restore is itself undoable", () => {
    const current = documentAtOrdinal(TRAIL, 40).objects;
    const target = documentAtOrdinal(TRAIL, 10).objects;
    const action = planRestore(current, target, CTX, { targetOrdinal: 10 });
    if (action === null) throw new Error("expected a restore action");

    const inverse = action.inverse as {
      added: { object: { id: string } }[];
      updated: { id: string; after: Record<string, unknown> }[];
    };
    expect(inverse.added.map((a) => a.object.id)).toEqual(["obj-chair"]); // the chair comes back
    expect(inverse.updated[0]?.after).toEqual({ positionX: 9 }); // the table returns to 9
  });

  it("returns null when the room already matches the target — no empty audit noise", () => {
    const current = documentAtOrdinal(TRAIL, 40).objects;
    expect(planRestore(current, current, CTX, { targetOrdinal: 40 })).toBeNull();
  });

  it("the restore action is itself replayable — the trail stays self-sufficient", async () => {
    const { replayActions } = await import("../action-log-replay.js");
    const current = documentAtOrdinal(TRAIL, 40).objects;
    const target = documentAtOrdinal(TRAIL, 10).objects;
    const action = planRestore(current, target, CTX, { targetOrdinal: 10 });
    if (action === null) throw new Error("expected a restore action");

    // Append the restore to the trail as the server would, then replay the
    // WHOLE thing from zero: the reconstruction must equal the target.
    const appended: AuditLogEntry[] = [
      ...TRAIL,
      entry(50, { intent: action.intent, payload: action.payload, inverse: action.inverse }),
    ];
    const replayed = replayActions(appended);
    expect(replayed.issues).toEqual([]);
    expect(replayed.objects).toEqual(target);
  });

  it("deep undo is the same engine: N gestures back, beyond the in-memory cap", () => {
    // A 250-gesture trail — far past the 100-entry undo timeline. Travelling
    // to gesture 5 must still be exact, because the trail is the truth.
    const long: AuditLogEntry[] = [place(1, TABLE)];
    for (let i = 2; i <= 250; i += 1) long.push(move(i, "obj-table", i - 1, i));
    const deep = documentAtOrdinal(long, 5);
    expect(deep.objects[0]).toEqual({ ...TABLE, positionX: 5 });

    const action = planRestore(documentAtOrdinal(long, 250).objects, deep.objects, CTX, { targetOrdinal: 5 });
    if (action === null) throw new Error("expected a restore action");
    expect((action.payload as { updated: { after: { positionX: number } }[] }).updated[0]?.after.positionX).toBe(5);
  });
});
