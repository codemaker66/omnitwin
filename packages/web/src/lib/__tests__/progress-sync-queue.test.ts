import { describe, it, expect } from "vitest";
import {
  isReplayStatusTerminal,
  opsStillNeedingReplay,
  partitionReplay,
  resolveReplayDisposition,
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

describe("partitionReplay", () => {
  it("splits queued ops into replay (server differs) and converged (server matches)", () => {
    const queued = [
      op("a", true),  // server unchecked → replay
      op("b", false), // server unchecked → converged
      op("c", true),  // server checked   → converged
      op("d", false), // server checked   → replay
    ];
    const { replay, converged } = partitionReplay(queued, new Set(["c", "d"]));
    expect(replay.map((o) => o.rowKey)).toEqual(["a", "d"]);
    expect(converged.map((o) => o.rowKey)).toEqual(["b", "c"]);
  });

  it("is a true partition — every queued op lands in exactly one bucket", () => {
    const queued = [op("a", true), op("b", false), op("c", true)];
    const serverChecked = new Set(["b"]);
    const { replay, converged } = partitionReplay(queued, serverChecked);
    expect(replay.length + converged.length).toBe(queued.length);
    const allKeys = [...replay, ...converged].map((o) => o.rowKey).sort();
    expect(allKeys).toEqual(["a", "b", "c"]);
  });

  it("returns everything as converged when the server already matches all intents", () => {
    const queued = [op("a", true), op("b", true)];
    const { replay, converged } = partitionReplay(queued, new Set(["a", "b"]));
    expect(replay).toEqual([]);
    expect(converged.map((o) => o.rowKey)).toEqual(["a", "b"]);
  });

  it("handles an empty queue", () => {
    const { replay, converged } = partitionReplay([], new Set(["x"]));
    expect(replay).toEqual([]);
    expect(converged).toEqual([]);
  });
});

describe("isReplayStatusTerminal", () => {
  it("treats 4xx (except 408/429) as terminal — the op can never succeed", () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422]) {
      expect(isReplayStatusTerminal(status)).toBe(true);
    }
  });

  it("treats 408 (timeout) and 429 (rate limited) as retriable", () => {
    expect(isReplayStatusTerminal(408)).toBe(false);
    expect(isReplayStatusTerminal(429)).toBe(false);
  });

  it("treats 5xx as retriable — the server may recover", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isReplayStatusTerminal(status)).toBe(false);
    }
  });

  it("treats non-error statuses as non-terminal", () => {
    for (const status of [200, 201, 204, 304, 399]) {
      expect(isReplayStatusTerminal(status)).toBe(false);
    }
  });
});

describe("resolveReplayDisposition", () => {
  it("acks a successful replay", () => {
    expect(resolveReplayDisposition({ ok: true, status: 200 })).toBe("ack");
  });

  it("keeps a network failure (no status) for the next flush", () => {
    expect(resolveReplayDisposition({ ok: false, status: null })).toBe("keep");
  });

  it("drops (acks) a terminal 4xx so it can't poison the queue forever", () => {
    expect(resolveReplayDisposition({ ok: false, status: 403 })).toBe("ack");
    expect(resolveReplayDisposition({ ok: false, status: 404 })).toBe("ack");
  });

  it("keeps a retriable failure (5xx / 408 / 429) queued", () => {
    expect(resolveReplayDisposition({ ok: false, status: 500 })).toBe("keep");
    expect(resolveReplayDisposition({ ok: false, status: 408 })).toBe("keep");
    expect(resolveReplayDisposition({ ok: false, status: 429 })).toBe("keep");
  });
});
