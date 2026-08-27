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

// Listeners take the real event object. `load-error` carries a payload the
// component now reads — { tile, error, url }, exactly the shape declared by
// the installed package's own event map (node_modules/3d-tiles-renderer/src/
// core/renderer/tiles/TilesRendererBase.d.ts:25) — so the fake must hand one
// over rather than call listeners bare.
type FakeListener = (event: { type: string }) => void;

interface FakeTilesController {
  addEventListener: (type: string, cb: FakeListener) => void;
  removeEventListener: (type: string, cb: FakeListener) => void;
  dispatch: (type: string, payload?: Record<string, unknown>) => void;
  listenerCount: (type: string) => number;
}

function createFakeTiles(): FakeTilesController {
  const listeners = new Map<string, Set<FakeListener>>();
  return {
    addEventListener(type, cb) {
      const forType = listeners.get(type) ?? new Set<FakeListener>();
      forType.add(cb);
      listeners.set(type, forType);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type, payload) {
      const forType = listeners.get(type);
      if (forType === undefined) {
        return;
      }
      for (const cb of forType) {
        cb({ ...payload, type });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/**
 * The EXACT event an invalid/revoked/restricted/over-quota key produces.
 * Verified end to end, not invented: Google answers the root-tileset request
 * with HTTP 400/403/429 and a JSON `{ error: {...} }` body; GoogleCloudAuth's
 * getSessionToken() then reads `json.root` (undefined) and hands it to
 * traverseSet, whose first callback dereferences `tile.content` — hence this
 * TypeError, which TilesRendererBase.update()'s own .catch turns into
 * `load-error` with `tile: null`. See task-12b-report.md for the measurements.
 *
 * It is a HAND-WRITTEN fixture, so on its own it proves only that our handler
 * branches correctly on a payload of this shape — never that the library still
 * produces it. google-tiles-auth-contract.test.ts is what keeps it honest: it
 * drives the REAL renderer and the REAL auth plugin against Google's real 400
 * body with only `fetch` stubbed, and asserts exactly this shape comes out. If
 * a library bump changes the behaviour, that file fails rather than this one
 * quietly testing a fiction.
 */
const ROOT_AUTH_FAILURE = {
  tile: null,
  error: new TypeError("Cannot read properties of undefined (reading 'content')"),
  url: "https://tile.googleapis.com/v1/3dtiles/root.json",
};

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

/**
 * A hand-rolled capture rather than vi.spyOn: spyOn's return type only
 * resolves through its overloads for a concrete function type, and
 * `console.error`'s `(...data: any[])` signature collapses it to `any`, which
 * this repo's strictTypeChecked lint rejects (no-unsafe-call /
 * no-unsafe-member-access). Six honest lines beat a file of suppressions.
 */
function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  /* eslint-disable no-console -- capturing the channel IS the assertion here */
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
  /* eslint-enable no-console */
}

/** Only OUR diagnostics, never anything else on the same channel. */
function arrivalLogs(calls: readonly unknown[][]): unknown[][] {
  return calls.filter((args) => typeof args[0] === "string" && args[0].startsWith("Arrival:"));
}

describe("GoogleTilesStage", () => {
  // The component now writes a diagnostic on load-error (see the "explains
  // itself" tests below). Captured rather than printed: the calls are the
  // assertion surface, and letting it print would make every failure-path
  // test noisy.
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    useArrivalStore.getState().reset();
    seen.plugins.length = 0;
    seen.tiles = null;
    invalidate.mockClear();
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    cleanup();
    consoleError.restore();
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
    seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("tiles");
  });

  it("explains a rejected API key instead of leaving a bare vendored TypeError", () => {
    // THE POINT OF TASK 12b. The fallback itself already worked: the library
    // catches its own async session-token rejection and dispatches
    // `load-error`, which the handler above turns into fail("tiles"). What a
    // developer with a bad key actually SAW, though, was one line —
    // "TypeError: Cannot read properties of undefined (reading 'content')" —
    // logged by 3d-tiles-renderer from inside a bundled dependency, naming
    // neither Google, nor the key, nor the hero. It is misleading enough that
    // it was read as an uncaught crash and filed as this very task.
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);

    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    const [message] = ours[0] as [string];
    // Names the one thing the reader can act on...
    expect(message).toContain("VITE_GOOGLE_MAPS_TILES_KEY");
    // ...every realistic way that key can be wrong, since the request shape
    // is identical for all of them (400 invalid / 403 restricted or disabled
    // / 429 over quota all return the same JSON error body)...
    expect(message).toContain("revoked");
    expect(message).toContain("quota");
    // ...and says what actually happened to the page, so nobody hunts a bug
    // that is really a fallback working as designed.
    expect(message).toContain("static hero photo");
    // The failing request and the underlying error travel with it, not
    // instead of it.
    expect(ours[0]).toContain(ROOT_AUTH_FAILURE.url);
    expect(ours[0]).toContain(ROOT_AUTH_FAILURE.error);
  });

  it("says it once, however many times load-error fires", () => {
    // A collapsing tileset can emit load-error per tile, per frame. One
    // diagnostic is a diagnostic; a hundred is a second bug.
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
    seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
    seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    expect(useArrivalStore.getState().failReason).toBe("tiles");
  });

  it("does not blame the key for a single failed tile", () => {
    // `tile: null` means the ROOT tileset request failed — the request that
    // carries the key, so the key is the honest first suspect. A non-null
    // tile is one tile among thousands and is usually just the network;
    // saying "your API key is wrong" there would be a false lead.
    render(<GoogleTilesStage apiToken="AIza-test" />);
    seen.tiles?.dispatch("load-error", {
      tile: { __tile: true },
      error: new Error("Failed to fetch"),
      url: "https://tile.googleapis.com/v1/3dtiles/datasets/CgA/files/abc.glb",
    });
    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    const [message] = ours[0] as [string];
    expect(message).not.toContain("VITE_GOOGLE_MAPS_TILES_KEY");
    expect(message).toContain("tile");
    // Same outcome for the visitor either way — the flight is over.
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
    tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
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
      seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ fail: originalFail });
    }
  });
});
