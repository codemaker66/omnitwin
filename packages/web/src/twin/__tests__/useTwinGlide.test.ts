import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TwinManifest } from "@omnitwin/types";
import { useTwinGlide } from "../useTwinGlide.js";

// -----------------------------------------------------------------------------
// useTwinGlide — the continuous glide walker.
//
// Same rig as useTwinWalk.test.ts: requestAnimationFrame is a hand-cranked
// queue advancing 16 ms per flushed frame, and URL behaviour is observed
// through a harness hook inside a MemoryRouter. Because the walker's timing
// is spring-driven, assertions flush TO A CONDITION (with a hard frame cap)
// rather than to a magic frame count — the physics may be retuned without
// rewriting the suite, while a walker that stalls still fails loudly.
// -----------------------------------------------------------------------------

/** Fixture: 000—001—002 chained (2 m edges), 003 far away and unconnected. */
function fixtureManifest(): TwinManifest {
  const node = (
    id: string,
    index: number,
    x: number,
    y: number,
  ): TwinManifest["nodes"][number] => ({
    id,
    index,
    pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] },
    floor: 0,
    roomSlug: null,
  });
  return {
    schema: "twin/0",
    venueSlug: "trades-hall",
    name: "Trades Hall Glasgow",
    capture: { kind: "matterport-e57", scanCount: 4 },
    tier: "ops-grade-2cm",
    upAxis: "z",
    units: "m",
    imagery: "cube-faces",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [256, 1024],
    generatedAt: "2026-07-02T12:00:00.000Z",
    nodes: [
      node("scan_000", 0, 0, 0),
      node("scan_001", 1, 2, 0),
      node("scan_002", 2, 4, 0),
      node("scan_003", 3, 30, 0),
    ],
    edges: [
      { a: "scan_000", b: "scan_001", distanceM: 2 },
      { a: "scan_001", b: "scan_002", distanceM: 2 },
    ],
  };
}

/** Harness: the glide plus a live view of the ?node= search param. */
function useHarness(manifest: TwinManifest): {
  glide: ReturnType<typeof useTwinGlide>;
  node: string | null;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
} {
  const glide = useTwinGlide(manifest);
  const [searchParams, setSearchParams] = useSearchParams();
  return { glide, node: searchParams.get("node"), setSearchParams };
}

function routerWrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return createElement(MemoryRouter, { initialEntries: [initialEntry] }, children);
  };
}

function mountGlide(initialEntry: string, manifest = fixtureManifest()) {
  return renderHook(() => useHarness(manifest), {
    wrapper: routerWrapper(initialEntry),
  });
}

// — hand-cranked requestAnimationFrame —

const rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;
let rafClock = 0;

/** Run `count` frames, 16 ms apart, inside act so state updates flush. */
function flushFrames(count: number): void {
  for (let frame = 0; frame < count; frame += 1) {
    rafClock += 16;
    const pending = [...rafCallbacks.values()];
    rafCallbacks.clear();
    act(() => {
      for (const callback of pending) {
        callback(rafClock);
      }
    });
  }
}

/** Flush frames until `done` holds, failing the test at the cap — a walker
 *  that never satisfies the condition must not pass by exhaustion. */
function flushUntil(done: () => boolean, capFrames = 1200): void {
  for (let frame = 0; frame < capFrames; frame += 1) {
    if (done()) {
      return;
    }
    flushFrames(1);
  }
  expect(done(), `condition not reached within ${String(capFrames)} frames`).toBe(true);
}

function stubReducedMotion(matches: boolean): void {
  const factory = (query: string): MediaQueryList => {
    const narrow: Pick<MediaQueryList, "matches" | "media"> = { matches, media: query };
    const widened: unknown = narrow;
    return widened as MediaQueryList;
  };
  vi.stubGlobal("matchMedia", factory);
}

beforeEach(() => {
  rafCallbacks.clear();
  nextRafId = 1;
  rafClock = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTwinGlide — the walk contract is preserved", () => {
  it("reads the initial node from ?node= and canonicalises invalid params", () => {
    const { result } = mountGlide("/twin?node=scan_001");
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.glide.restId).toBe("scan_001");
    expect(result.current.glide.targetId).toBeNull();

    const invalid = mountGlide("/twin?node=scan_999");
    expect(invalid.result.current.glide.currentId).toBe("scan_000");
    expect(invalid.result.current.node).toBe("scan_000");
  });

  it("silently no-ops on a non-neighbor without teleport", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.hopTo("scan_002");
    });
    expect(result.current.glide.targetId).toBeNull();
    expect(result.current.node).toBe("scan_000");
  });

  it("teleports to any known node instantly and pushes the URL", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.hopTo("scan_003", { teleport: true });
    });
    expect(result.current.glide.currentId).toBe("scan_003");
    expect(result.current.glide.restId).toBe("scan_003");
    expect(result.current.node).toBe("scan_003");
  });

  it("resolves a tap instantly under prefers-reduced-motion", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    stubReducedMotion(true);
    act(() => {
      result.current.glide.hopTo("scan_001");
    });
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.glide.targetId).toBeNull();
    expect(result.current.node).toBe("scan_001");
  });

  it("swaps instantly and cancels a glide when the URL changes externally", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.hopTo("scan_001");
    });
    flushFrames(5);
    expect(result.current.glide.targetId).toBe("scan_001");

    act(() => {
      result.current.setSearchParams({ node: "scan_003" });
    });
    expect(result.current.glide.currentId).toBe("scan_003");
    expect(result.current.glide.targetId).toBeNull();

    flushFrames(50);
    expect(result.current.glide.currentId).toBe("scan_003");
  });
});

describe("useTwinGlide — a tap glides one segment", () => {
  it("advances progress smoothly and lands on the neighbour with one URL push", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.hopTo("scan_001");
    });
    expect(result.current.glide.targetId).toBe("scan_001");
    expect(result.current.glide.gliding).toBe(true);

    // The live fraction rides the ref — per-frame motion never touches React
    // state (that architecture IS the perf fix; see the hook's header).
    flushUntil(() => result.current.glide.progressRef.current > 0.3);
    expect(result.current.glide.progress).toBe(0);
    // Mid-glide: the URL still names the origin; restId still the origin.
    expect(result.current.node).toBe("scan_000");
    expect(result.current.glide.restId).toBe("scan_000");
    expect(result.current.glide.tangentRef.current).not.toBeNull();

    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.glide.restId).toBe("scan_001");
    expect(result.current.glide.progress).toBe(0);
    expect(result.current.node).toBe("scan_001");
    expect(result.current.glide.tangentRef.current).toBeNull();
  });

  it("ignores a second animated hop while one is in flight", () => {
    const { result } = mountGlide("/twin?node=scan_001");
    act(() => {
      result.current.glide.hopTo("scan_002");
    });
    flushFrames(3);
    act(() => {
      result.current.glide.hopTo("scan_000");
    });
    expect(result.current.glide.targetId).toBe("scan_002");
    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_002");
  });
});

describe("useTwinGlide — glideAlong cruises a route without settling", () => {
  it("passes through the middle node with no rest and no mid-ride URL write", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.glideAlong(["scan_000", "scan_001", "scan_002"]);
    });
    expect(result.current.glide.targetId).toBe("scan_001");

    // The segment rolls forward: current becomes the middle node while the
    // ride is still in flight — that is the "no settle" claim, observably.
    flushUntil(() => result.current.glide.currentId === "scan_001");
    expect(result.current.glide.targetId).toBe("scan_002");
    expect(result.current.glide.gliding).toBe(true);
    expect(result.current.node).toBe("scan_000");
    expect(result.current.glide.restId).toBe("scan_000");

    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_002");
    expect(result.current.glide.restId).toBe("scan_002");
    expect(result.current.node).toBe("scan_002");
  });

  it("teleports the whole route under prefers-reduced-motion", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    stubReducedMotion(true);
    act(() => {
      result.current.glide.glideAlong(["scan_000", "scan_001", "scan_002"]);
    });
    expect(result.current.glide.currentId).toBe("scan_002");
    expect(result.current.glide.targetId).toBeNull();
    expect(result.current.node).toBe("scan_002");
  });
});

describe("useTwinGlide — hold, extension and release", () => {
  it("extends the ride through the registered picker while held", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    const picker = vi.fn((fromId: string): string | null =>
      fromId === "scan_001" ? "scan_002" : null,
    );
    act(() => {
      result.current.glide.registerNextPicker(picker);
      result.current.glide.setHeld(true);
      result.current.glide.hopTo("scan_001");
    });

    // The held walker asks the cone and splices scan_002 in; the ride crosses
    // scan_001 while still in flight.
    flushUntil(() => result.current.glide.currentId === "scan_001");
    expect(result.current.glide.targetId).toBe("scan_002");
    expect(picker).toHaveBeenCalledWith("scan_001", "scan_000");

    // Ride clear of the snap window (0.35 m ≈ 0.3 s at cruise), THEN release:
    // the walk completes the step in motion and eases onto scan_002.
    flushFrames(30);
    act(() => {
      result.current.glide.setHeld(false);
    });
    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_002");
    expect(result.current.node).toBe("scan_002");
  });

  it("a release just past a crossed node snaps honestly back onto it", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.registerNextPicker(() => "scan_002");
      result.current.glide.setHeld(true);
      result.current.glide.hopTo("scan_001");
    });
    // Release within a frame or two of crossing — centimetres past scan_001.
    flushUntil(() => result.current.glide.currentId === "scan_001");
    act(() => {
      result.current.glide.setHeld(false);
    });
    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.node).toBe("scan_001");
  });

  it("a release moments after the tap still completes the first step", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.setHeld(true);
      result.current.glide.hopTo("scan_001");
    });
    flushFrames(6); // ~100 ms held — a tap
    act(() => {
      result.current.glide.setHeld(false);
    });
    flushUntil(() => result.current.glide.targetId === null);
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.node).toBe("scan_001");
  });

  it("settleInstantly lands on the release-rule node at once", () => {
    const { result } = mountGlide("/twin?node=scan_000");
    act(() => {
      result.current.glide.glideAlong(["scan_000", "scan_001", "scan_002"]);
    });
    flushFrames(10);
    act(() => {
      result.current.glide.settleInstantly();
    });
    expect(result.current.glide.targetId).toBeNull();
    expect(result.current.glide.currentId).toBe("scan_001");
    expect(result.current.node).toBe("scan_001");

    flushFrames(50); // the cancelled walker is dead — nothing moves
    expect(result.current.glide.currentId).toBe("scan_001");
  });
});
