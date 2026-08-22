import { describe, expect, it, vi } from "vitest";
import {
  NEIGHBOUR_WARM_BUDGET,
  NEIGHBOUR_WARM_SLICE_MS,
  NEIGHBOUR_WARM_TIMEOUT_MS,
  canUploadInSlice,
  planNeighbourWarm,
  runNeighbourWarmQueue,
  type IdleDeadlineLike,
  type WarmAcquisition,
  type WarmCandidate,
} from "../neighbour-warm.js";

const at = (x: number, y = 0, z = 0): readonly [number, number, number] => [x, y, z];

/** Candidates laid out along +x at 1, 2, 3 … metres, deliberately shuffled. */
function ladder(count: number): WarmCandidate[] {
  const built: WarmCandidate[] = [];
  for (let i = count; i >= 1; i -= 1) {
    built.push({ id: `scan_${String(i).padStart(3, "0")}`, position: at(i) });
  }
  return built;
}

describe("planNeighbourWarm — ordering", () => {
  it("orders nearest-first by Euclidean distance from the node underfoot", () => {
    const plan = planNeighbourWarm(at(0), ladder(3), 3);
    expect(plan).toEqual(["scan_001", "scan_002", "scan_003"]);
  });

  it("measures in three dimensions, not just the floor plane", () => {
    const plan = planNeighbourWarm(
      at(0),
      [
        { id: "far-up", position: [1, 10, 0] },
        { id: "near", position: [2, 0, 0] },
      ],
      2,
    );
    expect(plan).toEqual(["near", "far-up"]);
  });

  it("breaks exact ties by id so the queue is deterministic across renders", () => {
    const tied: WarmCandidate[] = [
      { id: "scan_009", position: at(0, 0, 5) },
      { id: "scan_002", position: at(5) },
      { id: "scan_005", position: at(0, 5) },
    ];
    expect(planNeighbourWarm(at(0), tied, 3)).toEqual([
      "scan_002",
      "scan_005",
      "scan_009",
    ]);
    expect(planNeighbourWarm(at(0), [...tied].reverse(), 3)).toEqual([
      "scan_002",
      "scan_005",
      "scan_009",
    ]);
  });
});

describe("planNeighbourWarm — the budget cap", () => {
  it("never returns more ids than the budget, whatever the node's degree", () => {
    // The Trades Hall nav graph runs to degree 8; an uncapped queue would
    // upload eight 4096x2048 bases on one arrival.
    expect(planNeighbourWarm(at(0), ladder(8), 3)).toHaveLength(3);
    expect(planNeighbourWarm(at(0), ladder(8), 1)).toEqual(["scan_001"]);
  });

  it("caps at NEIGHBOUR_WARM_BUDGET by default", () => {
    const plan = planNeighbourWarm(at(0), ladder(8));
    expect(plan).toHaveLength(NEIGHBOUR_WARM_BUDGET);
    expect(NEIGHBOUR_WARM_BUDGET).toBeLessThan(8);
  });

  it("keeps the NEAREST ids when it truncates, not the first ones handed in", () => {
    // ladder() hands them in farthest-first, so a cap that merely slices the
    // input would keep the three FARTHEST nodes.
    expect(planNeighbourWarm(at(0), ladder(8), 3)).toEqual([
      "scan_001",
      "scan_002",
      "scan_003",
    ]);
  });

  it("treats a zero or negative budget as warm nothing", () => {
    expect(planNeighbourWarm(at(0), ladder(4), 0)).toEqual([]);
    expect(planNeighbourWarm(at(0), ladder(4), -2)).toEqual([]);
  });

  it("returns fewer than the budget when the node has fewer neighbours", () => {
    expect(planNeighbourWarm(at(0), ladder(2), 3)).toEqual(["scan_001", "scan_002"]);
  });
});

describe("planNeighbourWarm — hygiene", () => {
  it("drops duplicate ids so one neighbour is never queued twice", () => {
    const plan = planNeighbourWarm(
      at(0),
      [
        { id: "scan_001", position: at(1) },
        { id: "scan_001", position: at(1) },
        { id: "scan_002", position: at(2) },
      ],
      3,
    );
    expect(plan).toEqual(["scan_001", "scan_002"]);
  });

  it("drops candidates with a non-finite pose rather than sorting on NaN", () => {
    const plan = planNeighbourWarm(
      at(0),
      [
        { id: "broken", position: [Number.NaN, 0, 0] },
        { id: "scan_002", position: at(2) },
      ],
      3,
    );
    expect(plan).toEqual(["scan_002"]);
  });

  it("is empty for a node with no neighbours", () => {
    expect(planNeighbourWarm(at(0), [], 3)).toEqual([]);
  });
});

describe("canUploadInSlice — the deadline gate", () => {
  it("refuses a slice with too little time left for a 33 MB upload", () => {
    expect(canUploadInSlice({ didTimeout: false, timeRemaining: () => 0 })).toBe(false);
    expect(canUploadInSlice({ didTimeout: false, timeRemaining: () => 3 })).toBe(false);
    expect(
      canUploadInSlice({
        didTimeout: false,
        timeRemaining: () => NEIGHBOUR_WARM_SLICE_MS - 0.5,
      }),
    ).toBe(false);
  });

  it("admits a slice with the full budget left", () => {
    expect(
      canUploadInSlice({
        didTimeout: false,
        timeRemaining: () => NEIGHBOUR_WARM_SLICE_MS,
      }),
    ).toBe(true);
    expect(canUploadInSlice({ didTimeout: false, timeRemaining: () => 50 })).toBe(true);
  });

  it("admits a timed-out slice so a permanently busy page still pre-warms", () => {
    expect(canUploadInSlice({ didTimeout: true, timeRemaining: () => 0 })).toBe(true);
  });

  it("keeps the starvation escape rare relative to the slice budget", () => {
    expect(NEIGHBOUR_WARM_TIMEOUT_MS).toBeGreaterThan(NEIGHBOUR_WARM_SLICE_MS * 10);
  });
});

// -----------------------------------------------------------------------------
// Queue harness — a hand-driven idle scheduler, so the whole runner is
// exercised with no browser, no rAF and no GPU.
// -----------------------------------------------------------------------------

interface Harness {
  readonly acquired: string[];
  readonly uploaded: string[];
  readonly released: string[];
  /** Run the next queued idle slice with the given deadline. */
  readonly slice: (deadline?: IdleDeadlineLike) => Promise<void>;
  readonly pendingSlices: () => number;
  readonly cancelled: () => number;
  /** Resolve the acquire currently in flight. */
  readonly settle: (id: string) => Promise<void>;
  readonly dispose: () => void;
}

const ROOMY: IdleDeadlineLike = { didTimeout: false, timeRemaining: () => 49 };

function harness(
  ids: readonly string[],
  opts: { readonly failing?: readonly string[] } = {},
): Harness {
  const acquired: string[] = [];
  const uploaded: string[] = [];
  const released: string[] = [];
  const slices: ((deadline: IdleDeadlineLike) => void)[] = [];
  const resolvers = new Map<string, (value: WarmAcquisition<string> | null) => void>();
  let cancelled = 0;

  const dispose = runNeighbourWarmQueue<string>({
    ids,
    acquire: (id) => {
      acquired.push(id);
      return new Promise<WarmAcquisition<string> | null>((resolve) => {
        resolvers.set(id, resolve);
      });
    },
    upload: (texture) => {
      uploaded.push(texture);
    },
    requestSlice: (run) => {
      slices.push(run);
      return slices.length;
    },
    cancelSlice: () => {
      cancelled += 1;
    },
  });

  return {
    acquired,
    uploaded,
    released,
    pendingSlices: () => slices.length,
    cancelled: () => cancelled,
    slice: async (deadline = ROOMY) => {
      const next = slices.shift();
      expect(next, "expected a queued idle slice").toBeDefined();
      next?.(deadline);
      await Promise.resolve();
      await Promise.resolve();
    },
    settle: async (id) => {
      const resolve = resolvers.get(id);
      expect(resolve, `expected an in-flight acquire for ${id}`).toBeDefined();
      resolvers.delete(id);
      resolve?.(
        opts.failing?.includes(id) === true
          ? null
          : {
              texture: id,
              release: () => {
                released.push(id);
              },
            },
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    dispose,
  };
}

describe("runNeighbourWarmQueue — one upload per idle slice", () => {
  it("uploads exactly one texture per slice and yields between uploads", async () => {
    const h = harness(["a", "b"]);
    await h.slice(); // slice 1: start acquiring a
    expect(h.acquired).toEqual(["a"]);
    expect(h.uploaded).toEqual([]);

    await h.settle("a");
    await h.slice(); // slice 2: upload a
    expect(h.uploaded).toEqual(["a"]);
    expect(h.acquired).toEqual(["a"]); // b has NOT been started in the same slice

    await h.slice(); // slice 3: start acquiring b
    expect(h.acquired).toEqual(["a", "b"]);
    expect(h.uploaded).toEqual(["a"]);

    await h.settle("b");
    await h.slice(); // slice 4: upload b
    expect(h.uploaded).toEqual(["a", "b"]);
  });

  it("never runs two uploads inside one slice, even at degree 8", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const h = harness(ids);
    for (const id of ids) {
      await h.slice();
      await h.settle(id);
      const before = h.uploaded.length;
      await h.slice();
      expect(h.uploaded.length - before).toBe(1);
    }
    expect(h.uploaded).toEqual(ids);
  });

  it("stops requesting slices once the queue is drained", async () => {
    const h = harness(["a"]);
    await h.slice();
    await h.settle("a");
    await h.slice(); // upload
    expect(h.uploaded).toEqual(["a"]);
    await h.slice(); // the drain slice
    expect(h.pendingSlices()).toBe(0);
  });

  it("does nothing at all for an empty queue", async () => {
    const h = harness([]);
    await h.slice();
    expect(h.acquired).toEqual([]);
    expect(h.uploaded).toEqual([]);
    expect(h.pendingSlices()).toBe(0);
  });
});

describe("runNeighbourWarmQueue — the deadline check", () => {
  it("defers the upload when the slice has no time left, and reschedules", async () => {
    const h = harness(["a"]);
    await h.slice();
    await h.settle("a");

    await h.slice({ didTimeout: false, timeRemaining: () => 1 });
    expect(h.uploaded).toEqual([]); // the 33 MB upload did NOT run
    expect(h.pendingSlices()).toBe(1); // it asked for another slice instead

    await h.slice({ didTimeout: false, timeRemaining: () => 40 });
    expect(h.uploaded).toEqual(["a"]);
  });

  it("keeps deferring across repeated starved slices without dropping work", async () => {
    const h = harness(["a"]);
    await h.slice();
    await h.settle("a");
    const starved: IdleDeadlineLike = { didTimeout: false, timeRemaining: () => 0 };
    for (let i = 0; i < 5; i += 1) {
      await h.slice(starved);
      expect(h.uploaded).toEqual([]);
    }
    await h.slice(ROOMY);
    expect(h.uploaded).toEqual(["a"]);
  });

  it("uploads on a timed-out slice so a busy page still gets pre-residency", async () => {
    const h = harness(["a"]);
    await h.slice();
    await h.settle("a");
    await h.slice({ didTimeout: true, timeRemaining: () => 0 });
    expect(h.uploaded).toEqual(["a"]);
  });
});

describe("runNeighbourWarmQueue — lifecycle", () => {
  it("releases every acquired texture on dispose", async () => {
    const h = harness(["a", "b"]);
    await h.slice();
    await h.settle("a");
    await h.slice(); // upload a
    h.dispose();
    expect(h.released).toEqual(["a"]);
    expect(h.cancelled()).toBe(1);
  });

  it("releases an acquire that lands AFTER dispose (disposed-during-flight)", async () => {
    const h = harness(["a"]);
    await h.slice(); // acquire a starts
    h.dispose();
    await h.settle("a"); // resolves into a disposed queue
    expect(h.released).toEqual(["a"]);
    expect(h.uploaded).toEqual([]);
  });

  it("does no further work after dispose", async () => {
    const h = harness(["a", "b"]);
    await h.slice();
    await h.settle("a");
    h.dispose();
    const pending = h.pendingSlices();
    if (pending > 0) {
      await h.slice();
    }
    expect(h.uploaded).toEqual([]);
    expect(h.acquired).toEqual(["a"]);
  });

  it("releases each texture exactly once even if dispose is called twice", async () => {
    const h = harness(["a"]);
    await h.slice();
    await h.settle("a");
    await h.slice();
    h.dispose();
    h.dispose();
    expect(h.released).toEqual(["a"]);
  });

  it("skips a failed acquire and carries on with the next neighbour", async () => {
    const h = harness(["a", "b"], { failing: ["a"] });
    await h.slice();
    await h.settle("a"); // resolves null
    await h.slice();
    expect(h.acquired).toEqual(["a", "b"]);
    expect(h.uploaded).toEqual([]);
    await h.settle("b");
    await h.slice();
    expect(h.uploaded).toEqual(["b"]);
  });
});

describe("plan + queue together", () => {
  it("acquires at most NEIGHBOUR_WARM_BUDGET bases for a degree-8 node", async () => {
    const plan = planNeighbourWarm(at(0), ladder(8));
    const h = harness(plan);
    for (let i = 0; i < 40; i += 1) {
      if (h.pendingSlices() === 0) break;
      await h.slice();
      const inFlight = h.acquired[h.acquired.length - 1];
      if (inFlight !== undefined && !h.uploaded.includes(inFlight)) {
        await h.settle(inFlight);
      }
    }
    expect(h.acquired.length).toBeLessThanOrEqual(NEIGHBOUR_WARM_BUDGET);
    expect(h.acquired).toEqual(plan);
  });
});

describe("the upload is the only synchronous GPU call", () => {
  it("calls upload with the texture the acquire resolved", async () => {
    const upload = vi.fn<(texture: string) => void>();
    const slices: ((deadline: IdleDeadlineLike) => void)[] = [];
    runNeighbourWarmQueue<string>({
      ids: ["a"],
      acquire: (id) =>
        Promise.resolve({ texture: `tex:${id}`, release: () => undefined }),
      upload,
      requestSlice: (run) => {
        slices.push(run);
        return slices.length;
      },
      cancelSlice: () => undefined,
    });
    slices.shift()?.(ROOMY);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(upload).not.toHaveBeenCalled(); // not in the acquire slice
    slices.shift()?.(ROOMY);
    expect(upload).toHaveBeenCalledExactlyOnceWith("tex:a");
  });
});
