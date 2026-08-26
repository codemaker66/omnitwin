import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { forwardRef, useEffect, type ReactNode, type Ref } from "react";
import { useArrivalStore } from "../arrival-store.js";

// -----------------------------------------------------------------------------
// GoogleTilesStage — render + event-wiring contract (Arrival Task 4).
//
// 3d-tiles-renderer's R3F layer is mocked wholesale — no WebGL, no network.
// The TilesRenderer mock below reproduces the ONE real-library behaviour this
// component's correctness depends on (verified against node_modules/
// 3d-tiles-renderer/src/r3f/components/TilesRenderer.jsx and
// utilities/useApplyRefs.js): the tiles instance is created in an EFFECT
// after mount and handed to `ref` there — never synchronously during render.
// GoogleTilesStage's own event-wiring effect must therefore key off the
// resolved instance (state), not fire once on mount with a still-null ref.
// The fake tiles' addEventListener/removeEventListener/loadProgress surface
// plus its test-only `dispatch`/`listenerCount` helpers let every guard be
// driven and inspected directly.
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate }),
}));

interface FakeTilesController {
  loadProgress: number;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  dispatch: (type: string) => void;
  listenerCount: (type: string) => number;
}

function createFakeTiles(loadProgress: number): FakeTilesController {
  const listeners = new Map<string, Set<() => void>>();
  return {
    loadProgress,
    addEventListener(type, cb) {
      const forType = listeners.get(type) ?? new Set<() => void>();
      forType.add(cb);
      listeners.set(type, forType);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type) {
      const forType = listeners.get(type);
      if (forType === undefined) {
        return;
      }
      for (const cb of forType) {
        cb();
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const seen = vi.hoisted(() => ({
  plugins: [] as { plugin: { name: string }; args: unknown }[],
  tiles: null as FakeTilesController | null,
  nextLoadProgress: 1,
}));

vi.mock("3d-tiles-renderer/r3f", () => {
  const MockTilesRenderer = forwardRef(function MockTilesRenderer(
    { children }: { children?: ReactNode },
    ref: Ref<FakeTilesController>,
  ) {
    useEffect(() => {
      // GoogleTilesStage always passes a callback ref (useState's setter, to
      // key its wiring effect off the resolved instance — see the component's
      // header comment) rather than a useRef object, so that is the only ref
      // shape this fake actually needs to drive; React's Ref<T> is a union
      // that also includes a read-only RefObject, which this branch leaves
      // alone rather than fabricate an unused, untested code path for.
      const instance = createFakeTiles(seen.nextLoadProgress);
      seen.tiles = instance;
      if (typeof ref === "function") {
        ref(instance);
      }
      return () => {
        seen.tiles = null;
        if (typeof ref === "function") {
          ref(null);
        }
      };
    }, [ref]);
    return <div data-testid="tiles-renderer">{children}</div>;
  });

  return {
    TilesRenderer: MockTilesRenderer,
    TilesPlugin: ({ plugin, args }: { plugin: { name: string }; args: unknown }) => {
      seen.plugins.push({ plugin, args });
      return null;
    },
    TilesAttributionOverlay: () => <div data-testid="attribution" />,
  };
});

// Plain named functions, not classes: they are never instantiated (TilesPlugin
// itself is mocked below to just record {plugin, args}), so the only contract
// that matters is `.name` — the Function.prototype.name a class declaration
// would also give, without tripping no-extraneous-class on an empty class.
vi.mock("3d-tiles-renderer/plugins", () => ({
  GoogleCloudAuthPlugin: function GoogleCloudAuthPlugin(): void {
    // stand-in identity token — see comment above
  },
  ReorientationPlugin: function ReorientationPlugin(): void {
    // stand-in identity token — see comment above
  },
}));

const { GoogleTilesStage, TILES_READY_PROGRESS } = await import("../GoogleTilesStage.js");

describe("GoogleTilesStage", () => {
  beforeEach(() => {
    useArrivalStore.getState().reset();
    seen.plugins.length = 0;
    seen.tiles = null;
    seen.nextLoadProgress = 1;
    invalidate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the Google auth plugin with the api token and the reorientation plugin", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    const names = seen.plugins.map((p) => p.plugin.name);
    expect(names).toContain("GoogleCloudAuthPlugin");
    expect(names).toContain("ReorientationPlugin");
    const auth = seen.plugins.find((p) => p.plugin.name === "GoogleCloudAuthPlugin");
    // args is a one-element tuple, not a bare object — TilesPlugin's `args`
    // types as Params extends any[] (ConstructorParameters<Plugin>), and
    // GoogleTilesStage passes it that way so tsc accepts it (see that
    // component's inline comment for why this is runtime-equivalent).
    const [options] = auth?.args as [{ apiToken: string }];
    expect(options.apiToken).toBe("AIza-test");
  });

  it("always renders the attribution overlay (Google ToS)", () => {
    const { getByTestId } = render(<GoogleTilesStage apiToken="AIza-test" />);
    expect(getByTestId("attribution")).toBeTruthy();
  });

  it("converts the Trades Hall anchor to radians for ReorientationPlugin", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    const reorient = seen.plugins.find((p) => p.plugin.name === "ReorientationPlugin");
    const [options] = reorient?.args as [{ lat: number; lon: number; height: number }];
    // ReorientationPlugin's lat/lon are radians (node_modules/3d-tiles-renderer/
    // src/three/plugins/ReorientationPlugin.js JSDoc); TRADES_HALL_ANCHOR stays
    // in degrees, so GoogleTilesStage must convert at the call site.
    expect(options.lat).toBeCloseTo((55.859 * Math.PI) / 180, 10);
    expect(options.lon).toBeCloseTo((-4.2474 * Math.PI) / 180, 10);
    expect(options.height).toBe(20);
  });

  it("does not announce tilesReady when tiles-load-end fires below TILES_READY_PROGRESS", () => {
    seen.nextLoadProgress = TILES_READY_PROGRESS - 0.1;
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("tiles-load-end");
    expect(useArrivalStore.getState().phase).toBe("loading");
  });

  it("announces tilesReady once loadProgress reaches TILES_READY_PROGRESS", () => {
    seen.nextLoadProgress = TILES_READY_PROGRESS;
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("tiles-load-end");
    expect(useArrivalStore.getState().phase).toBe("flight");
  });

  it("announces tilesReady exactly once even if tiles-load-end fires repeatedly", () => {
    const originalTilesReady = useArrivalStore.getState().tilesReady;
    const spy = vi.fn(originalTilesReady);
    useArrivalStore.setState({ tilesReady: spy });
    try {
      seen.nextLoadProgress = 1;
      render(<GoogleTilesStage apiToken="AIza-test" />);
      seen.tiles?.dispatch("tiles-load-end");
      seen.tiles?.dispatch("tiles-load-end");
      seen.tiles?.dispatch("tiles-load-end");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ tilesReady: originalTilesReady });
    }
  });

  it('calls fail("tiles") on load-error', () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("load-error");
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("tiles");
  });

  it("invalidates the frameloop on needs-update", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    invalidate.mockClear();
    seen.tiles?.dispatch("needs-update");
    expect(invalidate).toHaveBeenCalled();
  });

  it("removes its tiles event listeners on unmount", () => {
    const { unmount } = render(<GoogleTilesStage apiToken="AIza-test" />);
    const tiles = seen.tiles;
    expect(tiles).not.toBeNull();
    unmount();
    // Every listener this component attached must be gone — dispatching
    // load-error post-unmount must be a silent no-op, not a late fail("tiles").
    tiles?.dispatch("load-error");
    expect(useArrivalStore.getState().phase).toBe("loading");
  });

  it("does not double-subscribe its tiles event listeners across re-renders", () => {
    const originalFail = useArrivalStore.getState().fail;
    const spy = vi.fn(originalFail);
    useArrivalStore.setState({ fail: spy });
    try {
      const { rerender } = render(<GoogleTilesStage apiToken="AIza-test" />);
      rerender(<GoogleTilesStage apiToken="AIza-test-2" />);
      expect(seen.tiles?.listenerCount("load-error")).toBe(1);
      seen.tiles?.dispatch("load-error");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ fail: originalFail });
    }
  });
});
