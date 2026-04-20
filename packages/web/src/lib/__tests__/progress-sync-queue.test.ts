import { describe, it, expect } from "vitest";
import {
  opsStillNeedingReplay,
  type QueuedProgressOp,
} from "../progress-sync-queue.js";

// ---------------------------------------------------------------------------
// progress-sync-queue — pure replay-decision logic
//
// After the tablet comes back online, the queue is drained by
// re-issuing each PATCH. But if another device already toggled the
// same row while we were offline, the server may already reflect
// our desired state. `opsStillNeedingReplay` filters the queue to
// just the ops that would CHANGE server state.
// ---------------------------------------------------------------------------

function op(rowKey: string, desiredChecked: boolean): QueuedProgressOp {
  return {
    configId: "cfg-1",
    rowKey,
    desiredChecked,
    queuedAt: "2026-04-18T10:00:00.000Z",
  };
}

describe("opsStillNeedingReplay", () => {
  it("returns empty when no ops are queued", () => {
    expect(opsStillNeedingReplay([], new Set())).toEqual([]);
  });

  it("keeps ops whose desired state differs from server state", () => {
    const queued = [op("r1", true), op("r2", false)];
    // Server has r1 unchecked (needs check) and r2 unchecked (already matches).
    const result = opsStillNeedingReplay(queued, new Set<string>());
    expect(result.map((o) => o.rowKey)).toEqual(["r1"]);
  });

  it("drops ops already matching server state", () => {
    const queued = [op("r1", true), op("r2", true)];
    const serverChecked = new Set(["r1", "r2"]);
    const result = opsStillNeedingReplay(queued, serverChecked);
    expect(result).toEqual([]);
  });

  it("keeps uncheck ops when server still shows checked", () => {
    const queued = [op("r1", false)];
    const serverChecked = new Set(["r1"]);
    const result = opsStillNeedingReplay(queued, serverChecked);
    expect(result.map((o) => o.rowKey)).toEqual(["r1"]);
  });

  it("handles a mix correctly", () => {
    const queued = [
      op("a", true),  // server unchecked → needs replay
      op("b", false), // server unchecked → no-op
      op("c", true),  // server checked   → no-op
      op("d", false), // server checked   → needs replay
    ];
    const serverChecked = new Set(["c", "d"]);
    const result = opsStillNeedingReplay(queued, serverChecked);
    expect(result.map((o) => o.rowKey).sort()).toEqual(["a", "d"]);
  });

  it("preserves input order (stable filter)", () => {
    const queued = [op("z", true), op("y", true), op("x", true)];
    const result = opsStillNeedingReplay(queued, new Set<string>());
    expect(result.map((o) => o.rowKey)).toEqual(["z", "y", "x"]);
  });
});
