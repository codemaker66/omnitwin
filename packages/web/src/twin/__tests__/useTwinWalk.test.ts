import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TwinManifest } from "@omnitwin/types";
import { useTwinWalk } from "../useTwinWalk.js";

// -----------------------------------------------------------------------------
// useTwinWalk — the hop state machine (Twin Phase 1, Task 9).
//
// requestAnimationFrame is stubbed with a hand-cranked queue so the hop spring
// advances on a controlled clock: each flushed frame hands the callback a
// timestamp 16 ms later, exactly as a real 60 Hz frame loop would. URL
// behaviour is observed through a harness hook that reads useSearchParams
// alongside the walk, inside a MemoryRouter.
// -----------------------------------------------------------------------------

/**
 * Four-node fixture: 000—001—002 chained on the ground floor, 003 far away
 * and unconnected (reachable only by teleport, i.e. the minimap).
 */
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

/** Harness: the walk plus a live view of the ?node= search param. */
function useHarness(manifest: TwinManifest): {
  walk: ReturnType<typeof useTwinWalk>;
  node: string | null;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
} {
  const walk = useTwinWalk(manifest);
  const [searchParams, setSearchParams] = useSearchParams();
  return { walk, node: searchParams.get("node"), setSearchParams };
}

function routerWrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return createElement(MemoryRouter, { initialEntries: [initialEntry] }, children);
  };
}

function mountWalk(initialEntry: string, manifest = fixtureManifest()) {
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

describe("useTwinWalk — initial node", () => {
  it("reads the initial node from ?node=", () => {
    const { result } = mountWalk("/twin?node=scan_001");
    expect(result.current.walk.currentId).toBe("scan_001");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);
    expect([...result.current.walk.neighbors].sort()).toEqual(["scan_000", "scan_002"]);
  });

  it("falls back to scan_000 and canonicalises the URL when the param is invalid", () => {
    const { result } = mountWalk("/twin?node=scan_999");
    expect(result.current.walk.currentId).toBe("scan_000");
    expect(result.current.node).toBe("scan_000");
  });

  it("falls back to scan_000 and canonicalises the URL when the param is missing", () => {
    const { result } = mountWalk("/twin");
    expect(result.current.walk.currentId).toBe("scan_000");
    expect(result.current.node).toBe("scan_000");
  });

  it("opens on the manifest's entryNodeId (the hero viewpoint) when no node is named", () => {
    const { result } = mountWalk("/twin", { ...fixtureManifest(), entryNodeId: "scan_002" });
    expect(result.current.walk.currentId).toBe("scan_002");
    expect(result.current.node).toBe("scan_002");
  });

  it("ignores an unknown entryNodeId and falls back to scan_000", () => {
    const { result } = mountWalk("/twin", { ...fixtureManifest(), entryNodeId: "scan_999" });
    expect(result.current.walk.currentId).toBe("scan_000");
  });
});

describe("useTwinWalk — hopTo guards", () => {
  it("silently no-ops on a non-neighbor without teleport", () => {
    const { result } = mountWalk("/twin?node=scan_000");
    act(() => {
      result.current.walk.hopTo("scan_002");
    });
    expect(result.current.walk.currentId).toBe("scan_000");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.node).toBe("scan_000");
  });

  it("silently no-ops on an unknown node id, even with teleport", () => {
    const { result } = mountWalk("/twin?node=scan_000");
    act(() => {
      result.current.walk.hopTo("scan_042", { teleport: true });
    });
    expect(result.current.walk.currentId).toBe("scan_000");
    expect(result.current.node).toBe("scan_000");
  });

  it("teleports to any known node instantly and pushes the URL", () => {
    const { result } = mountWalk("/twin?node=scan_000");
    act(() => {
      result.current.walk.hopTo("scan_003", { teleport: true });
    });
    expect(result.current.walk.currentId).toBe("scan_003");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);
    expect(result.current.node).toBe("scan_003");
  });
});

describe("useTwinWalk — the animated hop", () => {
  it("springs progress to 1, swaps currentId, and updates the URL on settle", () => {
    const { result } = mountWalk("/twin?node=scan_000");

    act(() => {
      result.current.walk.hopTo("scan_001");
    });
    expect(result.current.walk.targetId).toBe("scan_001");
    expect(result.current.walk.currentId).toBe("scan_000");

    flushFrames(4);
    expect(result.current.walk.progress).toBeGreaterThan(0);
    expect(result.current.walk.progress).toBeLessThan(1);
    // Mid-hop the URL still names the origin — history gains the destination
    // only once the hop settles.
    expect(result.current.node).toBe("scan_000");

    flushFrames(400);
    expect(result.current.walk.currentId).toBe("scan_001");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);
    expect(result.current.node).toBe("scan_001");
  });

  it("ignores a second animated hop while one is in flight", () => {
    const { result } = mountWalk("/twin?node=scan_001");
    act(() => {
      result.current.walk.hopTo("scan_002");
    });
    flushFrames(2);
    act(() => {
      result.current.walk.hopTo("scan_000");
    });
    expect(result.current.walk.targetId).toBe("scan_002");

    flushFrames(400);
    expect(result.current.walk.currentId).toBe("scan_002");
  });

  it("resolves hops instantly under prefers-reduced-motion", () => {
    const { result } = mountWalk("/twin?node=scan_000");
    stubReducedMotion(true);

    act(() => {
      result.current.walk.hopTo("scan_001");
    });
    expect(result.current.walk.currentId).toBe("scan_001");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);
    expect(result.current.node).toBe("scan_001");
  });
});

describe("useTwinWalk — URL is the source of truth for back/forward", () => {
  it("swaps instantly (no spring) when the param changes externally", () => {
    const { result } = mountWalk("/twin?node=scan_000");

    act(() => {
      result.current.setSearchParams({ node: "scan_002" });
    });
    expect(result.current.walk.currentId).toBe("scan_002");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);
  });

  it("cancels an in-flight hop when the param changes externally", () => {
    const { result } = mountWalk("/twin?node=scan_000");
    act(() => {
      result.current.walk.hopTo("scan_001");
    });
    flushFrames(2);
    expect(result.current.walk.targetId).toBe("scan_001");

    act(() => {
      result.current.setSearchParams({ node: "scan_003" });
    });
    expect(result.current.walk.currentId).toBe("scan_003");
    expect(result.current.walk.targetId).toBeNull();
    expect(result.current.walk.progress).toBe(0);

    // The cancelled hop's frame loop is dead — no further state changes.
    flushFrames(50);
    expect(result.current.walk.currentId).toBe("scan_003");
  });
});
