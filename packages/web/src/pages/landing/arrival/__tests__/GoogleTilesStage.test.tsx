import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { forwardRef, useEffect, type ReactNode, type Ref } from "react";
import { useArrivalStore } from "../arrival-store.js";
import { GOOGLE_MAPS_ATTRIBUTION_LOGO_URL } from "../arrival-config.js";

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
// The fake tiles' addEventListener/removeEventListener surface plus its
// test-only `dispatch`/`listenerCount` helpers let every guard be driven and
// inspected directly. tilesReady() fires on the FIRST tiles-load-end,
// unconditionally: the real renderer's loadProgress is always exactly 1.0 at
// that dispatch point (it zeroes inCacheSinceLoad before dispatching, and
// loading is 0 by definition — node_modules/3d-tiles-renderer/src/core/
// renderer/tiles/TilesRendererBase.js:915-924, getter at :393-400), so a
// below-threshold tiles-load-end is a state the real renderer cannot produce
// and is not modelled here.
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate }),
}));

interface FakeTilesController {
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  dispatch: (type: string) => void;
  listenerCount: (type: string) => number;
}

function createFakeTiles(): FakeTilesController {
  const listeners = new Map<string, Set<() => void>>();
  return {
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
      const instance = createFakeTiles();
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

const { GoogleTilesStage } = await import("../GoogleTilesStage.js");

describe("GoogleTilesStage", () => {
  beforeEach(() => {
    useArrivalStore.getState().reset();
    seen.plugins.length = 0;
    seen.tiles = null;
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
    // component's header comment for why the tuple form is used and why its
    // reference must stay stable across renders).
    const [options] = auth?.args as [{ apiToken: string }];
    expect(options.apiToken).toBe("AIza-test");
  });

  it("passes a non-empty, same-origin logoUrl to the Google auth plugin (Google brand-attribution requirement)", () => {
    // Google's Map Tiles API Policies require a brand-attribution logo
    // credit, not just the text/copyright line (docs/operations/
    // arrival-google-tiles.md, Finding 2 / STOP-GATE). The installed
    // GoogleCloudAuthPlugin.getAttributions() only ever pushes the logo
    // credit `if (this.logoUrl)` (node_modules/3d-tiles-renderer/src/core/
    // plugins/GoogleCloudAuthPlugin.js:120-125) — an absent or empty
    // logoUrl silently drops the whole requirement in every phase, which
    // is exactly the regression this test guards against.
    render(<GoogleTilesStage apiToken="AIza-test" />);
    const auth = seen.plugins.find((p) => p.plugin.name === "GoogleCloudAuthPlugin");
    const [options] = auth?.args as [{ apiToken: string; logoUrl?: string }];
    expect(options.logoUrl).toBeTruthy();
    // Pins provenance: the exact self-hosted constant from arrival-config.ts,
    // not an ad hoc literal that could silently drift from what that file's
    // provenance comment documents.
    expect(options.logoUrl).toBe(GOOGLE_MAPS_ATTRIBUTION_LOGO_URL);
    // Same-origin, root-relative — self-hosted, never a runtime fetch from
    // Google's or any third party's servers (see arrival-config.ts for why).
    expect(options.logoUrl?.startsWith("/")).toBe(true);
  });

  it("always renders the attribution overlay (Google ToS)", () => {
    const { getByTestId } = render(<GoogleTilesStage apiToken="AIza-test" />);
    expect(getByTestId("attribution")).toBeTruthy();
  });

  it("converts the Trades Hall anchor to radians for ReorientationPlugin", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    const reorient = seen.plugins.find((p) => p.plugin.name === "ReorientationPlugin");
    const [options] = reorient?.args as [
      { lat: number; lon: number; height: number; azimuth: number },
    ];
    // ReorientationPlugin's lat/lon are radians (node_modules/3d-tiles-renderer/
    // src/three/plugins/ReorientationPlugin.js JSDoc); TRADES_HALL_ANCHOR stays
    // in degrees, so GoogleTilesStage must convert at the call site.
    expect(options.lat).toBeCloseTo((55.859 * Math.PI) / 180, 10);
    expect(options.lon).toBeCloseTo((-4.2474 * Math.PI) / 180, 10);
    expect(options.height).toBe(20);
    // Pins the deliberate azimuth wiring (TRADES_HALL_ANCHOR.azimuthDeg is
    // currently 0) so a future edit can't silently drop it again.
    expect(options.azimuth).toBe(0);
  });

  it("keeps plugin args referentially stable across re-renders (no plugin reconstruction)", () => {
    // TilesPlugin disposes and reconstructs its plugin whenever `args`'
    // first-level identity changes (useObjectDep — see the component's
    // header comment). A fresh array/object literal built inline in JSX on
    // every render would fail this test even though every value inside it is
    // unchanged, because reference identity — not deep equality — is what
    // the real library checks.
    const lastArgsFor = (name: string): unknown =>
      [...seen.plugins].reverse().find((p) => p.plugin.name === name)?.args;
    const { rerender } = render(<GoogleTilesStage apiToken="AIza-test" />);
    const authArgsBefore = lastArgsFor("GoogleCloudAuthPlugin");
    const reorientArgsBefore = lastArgsFor("ReorientationPlugin");
    rerender(<GoogleTilesStage apiToken="AIza-test" />);
    expect(lastArgsFor("GoogleCloudAuthPlugin")).toBe(authArgsBefore);
    expect(lastArgsFor("ReorientationPlugin")).toBe(reorientArgsBefore);
  });

  it("announces tilesReady on the first tiles-load-end", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("tiles-load-end");
    expect(useArrivalStore.getState().phase).toBe("flight");
  });

  it("announces tilesReady exactly once even if tiles-load-end fires repeatedly", () => {
    const originalTilesReady = useArrivalStore.getState().tilesReady;
    const spy = vi.fn(originalTilesReady);
    useArrivalStore.setState({ tilesReady: spy });
    try {
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
