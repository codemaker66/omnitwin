import { describe, expect, it } from "vitest";
import type { ReplayObject } from "../action-log-replay.js";
import { mergeConcurrentEdits, type EditBranch } from "../layout-merge.js";

// ---------------------------------------------------------------------------
// The multiplayer core.
//
// TODAY the planner DROPS one person's edit when two land together: the
// editor/placement bridge returns early while a push is in flight, so a
// remote patch arriving in that window is discarded by design, and nothing
// tells anybody. That is the actual blocker — not the socket, which is
// already built and unused.
//
// This engine is the fix's heart: given a common base and two divergent
// edit branches, produce ONE converged room. Its promises:
//   1. CONVERGENCE — merging in either order gives the identical room.
//   2. NO SILENT LOSS — edits to different fields of the same object BOTH
//      survive; a genuine collision is reported, never quietly dropped.
//   3. DETERMINISM — the same inputs always resolve the same way, so two
//      browsers reach the same answer without talking to each other.
// ---------------------------------------------------------------------------

const TABLE: ReplayObject = { id: "t1", kind: "table-round", positionX: 0, positionZ: 0, rotationY: 0 };
const CHAIR: ReplayObject = { id: "c1", kind: "chair", positionX: 3, positionZ: 0, rotationY: 0 };
const BASE: readonly ReplayObject[] = [TABLE, CHAIR];

function branch(actor: string, at: string, edits: EditBranch["edits"]): EditBranch {
  return { actor, at, edits };
}

describe("mergeConcurrentEdits — nothing is silently lost", () => {
  it("keeps BOTH edits when two people move different objects", () => {
    const mine = branch("ana", "2026-07-28T10:00:00.000Z", [
      { op: "update", id: "t1", fields: { positionX: 5 } },
    ]);
    const theirs = branch("ben", "2026-07-28T10:00:01.000Z", [
      { op: "update", id: "c1", fields: { positionX: 9 } },
    ]);

    const merged = mergeConcurrentEdits(BASE, mine, theirs);
    expect(merged.objects.find((o) => o.id === "t1")?.positionX).toBe(5);
    expect(merged.objects.find((o) => o.id === "c1")?.positionX).toBe(9);
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps BOTH edits when two people change different fields of the SAME object", () => {
    // This is the case today's code loses entirely: one person nudges a
    // table while the other rotates it.
    const mine = branch("ana", "2026-07-28T10:00:00.000Z", [
      { op: "update", id: "t1", fields: { positionX: 5 } },
    ]);
    const theirs = branch("ben", "2026-07-28T10:00:01.000Z", [
      { op: "update", id: "t1", fields: { rotationY: 90 } },
    ]);

    const merged = mergeConcurrentEdits(BASE, mine, theirs);
    const table = merged.objects.find((o) => o.id === "t1");
    expect(table?.positionX).toBe(5);
    expect(table?.rotationY).toBe(90);
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps both insertions — concurrent adds do not collide over a position", () => {
    const mine = branch("ana", "2026-07-28T10:00:00.000Z", [
      { op: "insert", object: { id: "new-a", kind: "table-round", positionX: 1, positionZ: 1 } },
    ]);
    const theirs = branch("ben", "2026-07-28T10:00:01.000Z", [
      { op: "insert", object: { id: "new-b", kind: "table-round", positionX: 2, positionZ: 2 } },
    ]);

    const merged = mergeConcurrentEdits(BASE, mine, theirs);
    expect(merged.objects.map((o) => o.id).sort()).toEqual(["c1", "new-a", "new-b", "t1"]);
  });
});

describe("mergeConcurrentEdits — real collisions are reported, not hidden", () => {
  it("resolves a same-field collision deterministically and REPORTS the losing edit", () => {
    const mine = branch("ana", "2026-07-28T10:00:00.000Z", [
      { op: "update", id: "t1", fields: { positionX: 5 } },
    ]);
    const theirs = branch("ben", "2026-07-28T10:00:02.000Z", [
      { op: "update", id: "t1", fields: { positionX: 9 } },
    ]);

    const merged = mergeConcurrentEdits(BASE, mine, theirs);
    expect(merged.objects.find((o) => o.id === "t1")?.positionX).toBe(9); // later edit holds
    expect(merged.conflicts).toHaveLength(1);
    const conflict = merged.conflicts[0];
    expect(conflict?.objectId).toBe("t1");
    expect(conflict?.field).toBe("positionX");
    expect(conflict?.keptFrom).toBe("ben");
    expect(conflict?.discardedFrom).toBe("ana");
    expect(conflict?.discardedValue).toBe(5);
  });

  it("breaks an exact timestamp tie by actor, so two browsers agree without talking", () => {
    const sameInstant = "2026-07-28T10:00:00.000Z";
    const ana = branch("ana", sameInstant, [{ op: "update", id: "t1", fields: { positionX: 5 } }]);
    const ben = branch("ben", sameInstant, [{ op: "update", id: "t1", fields: { positionX: 9 } }]);

    const one = mergeConcurrentEdits(BASE, ana, ben);
    const other = mergeConcurrentEdits(BASE, ben, ana);
    expect(one.objects.find((o) => o.id === "t1")?.positionX)
      .toBe(other.objects.find((o) => o.id === "t1")?.positionX);
    expect(one.conflicts).toHaveLength(1);
  });

  it("a delete beats a concurrent edit, and says so rather than resurrecting the object", () => {
    const remover = branch("ana", "2026-07-28T10:00:00.000Z", [{ op: "remove", id: "c1" }]);
    const editor = branch("ben", "2026-07-28T10:00:02.000Z", [
      { op: "update", id: "c1", fields: { positionX: 4 } },
    ]);

    const merged = mergeConcurrentEdits(BASE, remover, editor);
    expect(merged.objects.map((o) => o.id)).toEqual(["t1"]);
    const conflict = merged.conflicts.find((c) => c.objectId === "c1");
    expect(conflict?.reason).toContain("removed");
    expect(conflict?.discardedFrom).toBe("ben");
  });

  it("an edit to an object neither branch has is reported, never invented", () => {
    const ghost = branch("ana", "2026-07-28T10:00:00.000Z", [
      { op: "update", id: "does-not-exist", fields: { positionX: 1 } },
    ]);
    const merged = mergeConcurrentEdits(BASE, ghost, branch("ben", "2026-07-28T10:00:01.000Z", []));
    expect(merged.objects.map((o) => o.id)).toEqual(["t1", "c1"]);
    expect(merged.conflicts[0]?.reason).toContain("not present");
  });
});

describe("mergeConcurrentEdits — convergence (the property that makes it multiplayer)", () => {
  it("merging in either order yields the identical room, across many shapes", () => {
    // A deterministic pseudo-random sweep: whatever the two branches did,
    // both browsers must land on the same document. Without this property
    // two screens drift apart and the product is worse than single-player.
    let seed = 20260728;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const field = (): string => (["positionX", "positionZ", "rotationY"] as const)[Math.floor(rand() * 3)] ?? "positionX";

    for (let trial = 0; trial < 200; trial += 1) {
      const make = (actor: string): EditBranch => {
        // Mutable local; `EditBranch["edits"]` is readonly, so build here and
        // hand the finished array to branch().
        const edits: EditBranch["edits"][number][] = [];
        const count = Math.floor(rand() * 3);
        for (let i = 0; i < count; i += 1) {
          const roll = rand();
          if (roll < 0.6) {
            edits.push({ op: "update", id: rand() < 0.5 ? "t1" : "c1", fields: { [field()]: Math.round(rand() * 10) } });
          } else if (roll < 0.8) {
            edits.push({ op: "insert", object: { id: `${actor}-${String(i)}`, kind: "chair", positionX: 0, positionZ: 0 } });
          } else {
            edits.push({ op: "remove", id: rand() < 0.5 ? "t1" : "c1" });
          }
        }
        return branch(actor, `2026-07-28T10:00:0${String(Math.floor(rand() * 9))}.000Z`, edits);
      };

      const ana = make("ana");
      const ben = make("ben");
      const forward = mergeConcurrentEdits(BASE, ana, ben);
      const backward = mergeConcurrentEdits(BASE, ben, ana);

      const shape = (objects: readonly ReplayObject[]): string =>
        JSON.stringify([...objects].sort((a, b) => a.id.localeCompare(b.id)));
      expect(shape(backward.objects), `trial ${String(trial)}`).toEqual(shape(forward.objects));
      expect(backward.conflicts.length, `trial ${String(trial)} conflicts`).toBe(forward.conflicts.length);
    }
  });

  it("an empty branch changes nothing — merging with a silent peer is a no-op", () => {
    const quiet = branch("ben", "2026-07-28T10:00:01.000Z", []);
    const merged = mergeConcurrentEdits(BASE, branch("ana", "2026-07-28T10:00:00.000Z", []), quiet);
    expect(merged.objects).toEqual(BASE);
    expect(merged.conflicts).toEqual([]);
  });

  it("never mutates the base or the branches it was given", () => {
    const mine = branch("ana", "2026-07-28T10:00:00.000Z", [{ op: "update", id: "t1", fields: { positionX: 5 } }]);
    const theirs = branch("ben", "2026-07-28T10:00:01.000Z", [{ op: "remove", id: "c1" }]);
    mergeConcurrentEdits(BASE, mine, theirs);
    expect(BASE).toEqual([TABLE, CHAIR]);
    expect(TABLE.positionX).toBe(0);
    expect(mine.edits).toHaveLength(1);
  });
});
