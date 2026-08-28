import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { forwardRef, useEffect, type ReactNode, type Ref } from "react";
import { useArrivalStore } from "../arrival-store.js";
import {
  ARRIVAL_ERROR_TARGET,
  ARRIVAL_TILES_FIRST_CONTACT_MS,
  ARRIVAL_TILES_STALL_MS,
  GOOGLE_MAPS_ATTRIBUTION_LOGO_URL,
} from "../arrival-config.js";

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
// The component now drives 3d-tiles-renderer's own per-frame update itself
// (under the arrival frame guard — see the component's header), so this mock
// has to hand out the same three things <TilesRenderer> reads for its own
// useFrame: invalidate, camera and gl. `frameCallbacks` collects whatever
// useArrivalFrame registers so a test can step the loop by hand, which is
// exactly what R3F's rAF loop does with it.
const fakeCamera = { updateMatrixWorld: vi.fn() };
const fakeGl = { name: "fake-webgl-renderer" };
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];
vi.mock("@react-three/fiber", () => ({
  useThree: (
    selector: (state: {
      invalidate: () => void;
      camera: typeof fakeCamera;
      gl: typeof fakeGl;
    }) => unknown,
  ) => selector({ invalidate, camera: fakeCamera, gl: fakeGl }),
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
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
  // The two the library's own useFrame calls on the instance every frame
  // (TilesRenderer.jsx:298-302) and that GoogleTilesStage now calls in its
  // place. Spies rather than no-ops so a test can assert the loop really is
  // driving the tileset and not just failing quietly.
  update: ReturnType<typeof vi.fn>;
  setResolutionFromRenderer: ReturnType<typeof vi.fn>;
}

function createFakeTiles(): FakeTilesController {
  const listeners = new Map<string, Set<FakeListener>>();
  return {
    update: vi.fn(),
    setResolutionFromRenderer: vi.fn(),
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
  // Every non-`children` prop <TilesRenderer> was handed, per render. The real
  // r3f component collects exactly these into `options` and assigns them onto
  // the tiles instance (useDeepOptions — see the component's header comment),
  // so recording them here is recording what the library would apply.
  rendererOptions: [] as Record<string, unknown>[],
}));

vi.mock("3d-tiles-renderer/r3f", () => {
  const MockTilesRenderer = forwardRef(function MockTilesRenderer(
    { children, ...options }: { children?: ReactNode } & Record<string, unknown>,
    ref: Ref<FakeTilesController>,
  ) {
    seen.rendererOptions.push(options);
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

/**
 * The Page Visibility API, driven the way a browser drives it when the visitor
 * switches tabs: the state changes, THEN `visibilitychange` fires on the
 * document. happy-dom implements `visibilityState` as a prototype getter that
 * always answers "visible", so the state is shadowed as an own property of the
 * document and removed again afterwards — no global stubbing, and the real
 * event path is what the component under test sees.
 */
function setPageVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Drops the own-property shadow so happy-dom's own getter is visible again. */
function restorePageVisibility(): void {
  Reflect.deleteProperty(document, "visibilityState");
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
    seen.rendererOptions.length = 0;
    seen.tiles = null;
    invalidate.mockClear();
    frameCallbacks.length = 0;
    fakeCamera.updateMatrixWorld.mockClear();
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

  it("hands the tile-density knob to TilesRenderer as errorTarget", () => {
    // Task 14's tuning lever. It has to arrive as a PROP, not as a post-hoc
    // assignment in the wiring effect: the r3f component owns the instance's
    // option lifecycle (useDeepOptions restores the previous value on cleanup),
    // so a hand-assignment would be silently reverted whenever any other prop
    // changed. google-tiles-auth-contract.test.ts pins the library default the
    // seeded value deviates from.
    render(<GoogleTilesStage apiToken="AIza-test" />);
    expect(seen.rendererOptions.at(-1)?.["errorTarget"]).toBe(ARRIVAL_ERROR_TARGET);
  });

  // ———————————————————————————————————————————————————————————————————————
  // THE VENDORED FRAME LOOP, CONTAINED (branch review round 2, "important").
  //
  // <TilesRenderer> registers its own useFrame that calls
  // camera.updateMatrixWorld(), tiles.setResolutionFromRenderer(camera, gl)
  // and tiles.update() (node_modules/3d-tiles-renderer/src/r3f/components/
  // TilesRenderer.jsx:290-303). A throw there runs in R3F's rAF loop, which
  // has no try/catch — the exact hazard arrival-frame-guard.ts exists for,
  // and this is the loop most likely to hit it: the only one walking a live
  // tileset built from network bytes, in code this repo does not own. All
  // three of OUR loops were guarded and this one was not.
  // ———————————————————————————————————————————————————————————————————————
  describe("the library's own per-frame update", () => {
    it("is turned OFF in the library and re-driven by us instead", () => {
      // Half the fix, and the half that is invisible in behaviour: without
      // `enabled={false}` the library keeps calling tiles.update() from its
      // own unguarded useFrame and our guarded copy is merely a second,
      // redundant caller — containment that contains nothing.
      render(<GoogleTilesStage apiToken="AIza-test" />);
      expect(seen.rendererOptions.at(-1)?.["enabled"]).toBe(false);
    });

    it("drives the tileset every frame, exactly as the library would", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      const tiles = seen.tiles;
      expect(tiles).not.toBeNull();
      // The instance arrives from an effect, so the first frames the guard
      // sees may precede it; step twice and assert on the post-instance one.
      act(() => {
        frameCallbacks.at(-1)?.(undefined, 0.016);
      });
      expect(fakeCamera.updateMatrixWorld).toHaveBeenCalled();
      expect(tiles?.setResolutionFromRenderer).toHaveBeenCalledWith(fakeCamera, fakeGl);
      expect(tiles?.update).toHaveBeenCalledTimes(1);
    });

    it("contains a throw from tiles.update() instead of letting it reach the rAF loop", () => {
      // The whole point. Unguarded this throws out of R3F's `advance`, which
      // aborts the frame mid-iteration — starving every later subscriber and
      // every other R3F root on the page — and does it again next frame,
      // forever, where no React error boundary can ever see it.
      render(<GoogleTilesStage apiToken="AIza-test" />);
      seen.tiles?.update.mockImplementation(() => {
        throw new Error("tileset traversal blew up");
      });

      expect(() => {
        act(() => {
          frameCallbacks.at(-1)?.(undefined, 0.016);
        });
      }).not.toThrow();

      // …and it unwinds to the photograph through the frame guard's own
      // reason, not the tiles one: this is a code fault, not a network fault.
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe("frame-crash");

      const ours = arrivalLogs(consoleError.calls);
      expect(ours).toHaveLength(1);
      expect(ours[0]?.[0]).toContain("GoogleTilesUpdate");
    });
  });

  it("keeps errorTarget referentially stable across re-renders", () => {
    // Same hazard as the plugin args above, one level up: useDeepOptions keys
    // its assign/restore effect on useObjectDep(options), a one-level-deep
    // comparison of the option VALUES. A module-scope number is equal to
    // itself, so the effect runs once; an inline expression producing a fresh
    // object here would churn it on every render.
    const { rerender } = render(<GoogleTilesStage apiToken="AIza-test" />);
    rerender(<GoogleTilesStage apiToken="AIza-test" />);
    const values = seen.rendererOptions.map((options) => options["errorTarget"]);
    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(1);
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

  // ———————————————————————————————————————————————————————————————————————
  // THE STALL WATCHDOG (branch review; Task 12b's own "most likely field
  // report"). Every other tiles failure announces itself through
  // `load-error`. A HUNG request announces nothing at all: no tiles-load-end
  // because nothing finished, no load-error because nothing failed. Before
  // this, the phase machine sat in "loading" forever — no flight, no
  // fallback, no diagnostic, indefinitely.
  //
  // The condition is not mocked away: the fake tiles instance simply never
  // dispatches anything, which is EXACTLY what a hung request looks like
  // from this component's side of the library. Only the clock is faked.
  //
  // ROUND 2 REWROTE THIS BLOCK, and the reason is worth stating because the
  // old version of it is the exact shape of a test that proves nothing. It
  // claimed the watchdog "never fires on a slow-but-working connection" and
  // demonstrated it by HAND-FEEDING a progress event every 29 s for ten
  // windows — i.e. by assuming the very premise under test, that a working
  // slow link produces progress events at that rate. It does not. The library
  // runs 25 downloads per origin, `tile-download-start` fires when a request
  // is ISSUED, so a real slow link produces a burst of 25 at once and then
  // nothing at all until the first download COMPLETES — 524 s later on Slow
  // 3G (arrival-config.ts carries the arithmetic). The replacement below
  // drives that real pattern instead of a convenient one, and fails against
  // the old implementation.
  // ———————————————————————————————————————————————————————————————————————
  describe("stall watchdog", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** The only two events that mean bytes ARRIVED — see the component. */
    const COMPLETION_EVENTS = ["load-tileset", "load-model"] as const;

    /** Events that mean a request was SCHEDULED. Not evidence of anything. */
    const SCHEDULING_EVENTS = ["tiles-load-start", "tile-download-start"] as const;

    /**
     * Slow 3G as Lighthouse/Puppeteer define it — 50,000 B/s aggregate — split
     * 25 ways by DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin gives 2,000 B/s per
     * request, so a 1 MB tile takes 1,048,576 / 2,000 ≈ 524 s to arrive. This
     * is the length of silence a WORKING connection produces, and the number
     * the windows are sized against.
     */
    const SLOW_3G_FIRST_TILE_MS = 524_000;

    /** DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin (TilesRendererBase.js:334). */
    const DOWNLOADS_PER_ORIGIN = 25;

    it("falls back when the tileset never answers at all", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      expect(useArrivalStore.getState().phase).toBe("loading");

      // One millisecond short of the deadline it is still waiting — a
      // watchdog that fires early is its own bug.
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS - 1);
      });
      expect(useArrivalStore.getState().phase).toBe("loading");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe("tiles");
    });

    it("explains the stall, and does not blame the key for it", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS);
      });

      const ours = arrivalLogs(consoleError.calls);
      expect(ours).toHaveLength(1);
      const [message] = ours[0] as [string];
      // Says what happened to the page…
      expect(message).toContain("static hero photo");
      // …names the request to go look at…
      expect(message).toContain("tile.googleapis.com");
      // …and how long it waited, so the number is discoverable without
      // reading the source.
      expect(message).toContain(String(Math.round(ARRIVAL_TILES_FIRST_CONTACT_MS / 1000)));
      // A silent request is NOT a rejected key: that path answers
      // immediately and reports itself through load-error, and sending the
      // reader to check the key here would be a false lead.
      expect(message).not.toContain("VITE_GOOGLE_MAPS_TILES_KEY");
    });

    it("tells a never-started tileset apart from one that stopped part-way", () => {
      // Two stalls, two different things to go and look at. Nothing arrived
      // ⇒ suspect the route to tile.googleapis.com. Tiles arrived and then
      // stopped ⇒ the route demonstrably works, so sending the reader after a
      // captive portal would waste the only clue they get.
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        seen.tiles?.dispatch("load-tileset");
      });
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS);
      });

      const ours = arrivalLogs(consoleError.calls);
      expect(ours).toHaveLength(1);
      const [message] = ours[0] as [string];
      expect(message).toContain("went silent");
      expect(message).toContain(String(Math.round(ARRIVAL_TILES_STALL_MS / 1000)));
      expect(message).not.toContain("captive-portal");
    });

    // ═══ THE test. It replaces one that assumed its own premise.
    //
    // This is the real event trace of a working Slow-3G visit, taken from the
    // library's own behaviour rather than from what would be convenient:
    //
    //   t≈11 s   root tileset parses            → load-tileset  (a completion)
    //   t≈11 s   the download queue dequeues 25 jobs at once
    //            → 25 × tile-download-start within milliseconds  (a BURST)
    //   t≈535 s  the first 1 MB tile finishes   → load-model     (a completion)
    //
    // Between the burst and that first completion there is NOTHING. Not one
    // event. That silence is 524 s long on a link that is working perfectly
    // and will deliver the hero, and the visitor on it is precisely the
    // visitor the watchdog was written to protect.
    //
    // Against the old implementation this test FAILS: the burst re-armed a
    // 30 s window, so the hero died at t≈41 s — 12 s of "waiting" and then a
    // fallback, on a connection that was fine.
    it("survives the 25-download burst then long silence a real slow link produces", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);

      // The root tileset lands — small, serial, early. The one and only
      // completion for the next eight and a half minutes.
      act(() => {
        vi.advanceTimersByTime(11_000);
        seen.tiles?.dispatch("load-tileset");
      });

      // …and the queue immediately issues 25 requests. Every one of these was
      // treated as "bytes moved" by the old watchdog. Not one byte has
      // arrived.
      act(() => {
        for (let i = 0; i < DOWNLOADS_PER_ORIGIN; i += 1) {
          seen.tiles?.dispatch("tile-download-start");
        }
      });

      // Then the silence. Stepped in ten slices so the failure message points
      // at WHEN it broke rather than just that it did.
      for (let slice = 1; slice <= 10; slice += 1) {
        act(() => {
          vi.advanceTimersByTime(SLOW_3G_FIRST_TILE_MS / 10);
        });
        expect(useArrivalStore.getState().phase).toBe("loading");
      }

      // The first tile arrives, right on the arithmetic. The flight is still
      // alive and nobody has been told anything went wrong, because nothing
      // has.
      act(() => {
        seen.tiles?.dispatch("load-model");
      });
      expect(useArrivalStore.getState().phase).toBe("loading");
      expect(arrivalLogs(consoleError.calls)).toHaveLength(0);

      // …and the connection dying for real is still caught: one full window
      // of silence measured from that last completion.
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS);
      });
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe("tiles");
    });

    for (const type of COMPLETION_EVENTS) {
      it(`re-arms on ${type}, because that event means bytes ARRIVED`, () => {
        render(<GoogleTilesStage apiToken="AIza-test" />);
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS - 1);
        });
        act(() => {
          seen.tiles?.dispatch(type);
        });
        // The first-contact deadline would have fired one millisecond later;
        // a completion both postpones it AND widens it to the long window.
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS - 1);
        });
        expect(useArrivalStore.getState().phase).toBe("loading");

        // POSTPONED, not cancelled: one full window measured from the
        // completion, and it fires. Without this half, the assertion above
        // would pass just as well with no watchdog at all.
        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(useArrivalStore.getState().phase).toBe("fallback");
        expect(useArrivalStore.getState().failReason).toBe("tiles");
      });
    }

    for (const type of SCHEDULING_EVENTS) {
      it(`is NOT re-armed by ${type} — a request being issued is not evidence`, () => {
        // The defect this whole rewrite exists for, isolated. Both of these
        // fire when a job is scheduled or a fetch is invoked, before a single
        // byte has come back; treating them as progress is what let a burst
        // of them at t≈0 masquerade as a healthy connection.
        render(<GoogleTilesStage apiToken="AIza-test" />);
        for (let i = 0; i < 20; i += 1) {
          act(() => {
            vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS / 20);
            seen.tiles?.dispatch(type);
          });
        }
        expect(useArrivalStore.getState().phase).toBe("fallback");
        expect(useArrivalStore.getState().failReason).toBe("tiles");
      });
    }

    it("is NOT re-armed by needs-update, which fires from the render loop", () => {
      // The failure mode that would make this whole mechanism theatre: treat
      // a frame-driven event as progress and the watchdog can never fire,
      // because the canvas keeps asking for frames while it waits.
      render(<GoogleTilesStage apiToken="AIza-test" />);
      for (let i = 0; i < 20; i += 1) {
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS / 20);
          seen.tiles?.dispatch("needs-update");
        });
      }
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe("tiles");
    });

    it("leaves NO live timer behind once it has fired", () => {
      // Branch review round 2, "important": the old onProgress re-armed
      // unconditionally, so a completion arriving after the watchdog had
      // already fired started a fresh window — a timer running past the
      // failure it was watching for, on a hero that no longer exists, firing
      // again into an already-failed store. Nothing may outlive the failure.
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS);
      });
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(vi.getTimerCount()).toBe(0);

      // A late completion — the hung request finally answering, long after
      // the hero gave up — must not restart anything.
      act(() => {
        seen.tiles?.dispatch("load-model");
      });
      expect(vi.getTimerCount()).toBe(0);

      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS * 3);
      });
      // Still exactly one diagnostic, from the one failure that happened.
      expect(arrivalLogs(consoleError.calls)).toHaveLength(1);
    });

    it("leaves no live timer behind after load-error either", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
      });
      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        seen.tiles?.dispatch("load-model");
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("is disarmed by readiness — a slow patch mid-flight is not a hang", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        seen.tiles?.dispatch("tiles-load-end");
      });
      expect(useArrivalStore.getState().phase).toBe("flight");

      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS * 3);
      });
      // The flight must not be taken away from a visitor already watching it.
      expect(useArrivalStore.getState().phase).toBe("flight");
      expect(arrivalLogs(consoleError.calls)).toHaveLength(0);
    });

    it("is disarmed by load-error — one diagnostic, not two", () => {
      render(<GoogleTilesStage apiToken="AIza-test" />);
      act(() => {
        seen.tiles?.dispatch("load-error", ROOT_AUTH_FAILURE);
      });
      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS * 3);
      });

      const ours = arrivalLogs(consoleError.calls);
      expect(ours).toHaveLength(1);
      // The one that survives is the SPECIFIC one, naming the key — not the
      // stall's "nothing answered", which would be actively misleading here.
      expect(ours[0]?.[0]).toContain("VITE_GOOGLE_MAPS_TILES_KEY");
      expect(useArrivalStore.getState().failReason).toBe("tiles");
    });

    it("is disarmed on unmount — no late fail after the hero is gone", () => {
      const { unmount } = render(<GoogleTilesStage apiToken="AIza-test" />);
      unmount();
      expect(vi.getTimerCount()).toBe(0);

      act(() => {
        vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS * 3);
      });
      expect(useArrivalStore.getState().phase).toBe("loading");
      expect(arrivalLogs(consoleError.calls)).toHaveLength(0);
    });

    // ═══ THE BACKGROUND TAB (edge review).
    //
    // The watchdog's evidence is rAF-gated and its clock was not. `load-tileset`
    // and `load-model` can only follow a `tiles.update()`, which runs from
    // useArrivalFrame, which runs from R3F's requestAnimationFrame loop — and
    // browsers do not service rAF in a hidden tab at all, while they DO keep
    // firing setTimeout there. So a visitor who middle-clicked the homepage into
    // a background tab (or ⌘/Ctrl-clicked, or chose "open in new tab") had a
    // dead-man's switch counting down against evidence that structurally could
    // not be produced, and came back to a permanently failed hero on a perfectly
    // good connection.
    //
    // These cases drive the real Page Visibility API — the same
    // `visibilitychange` event and `document.visibilityState` a browser uses —
    // rather than asserting anything about the timer's internals.
    describe("a tab opened in the background", () => {
      afterEach(() => {
        restorePageVisibility();
      });

      it("does not spend one millisecond of the budget while the page is hidden", () => {
        setPageVisibility("hidden");
        render(<GoogleTilesStage apiToken="AIza-test" />);

        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS * 5);
        });

        expect(useArrivalStore.getState().phase).toBe("loading");
        expect(arrivalLogs(consoleError.calls)).toHaveLength(0);
      });

      it("starts the budget when the visitor finally switches to the tab", () => {
        setPageVisibility("hidden");
        render(<GoogleTilesStage apiToken="AIza-test" />);
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS * 5);
        });

        act(() => {
          setPageVisibility("visible");
        });
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_FIRST_CONTACT_MS - 1);
        });
        // The full window, counted from the moment the tab was actually looked
        // at — not a residue of the time it spent hidden.
        expect(useArrivalStore.getState().phase).toBe("loading");

        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(useArrivalStore.getState().phase).toBe("fallback");
        expect(useArrivalStore.getState().failReason).toBe("tiles");
      });

      it("banks the visible time already spent and resumes from there", () => {
        // Watched for half the window, backgrounded for an hour, watched again:
        // the second half of the window is what remains, no more and no less.
        const half = ARRIVAL_TILES_FIRST_CONTACT_MS / 2;
        render(<GoogleTilesStage apiToken="AIza-test" />);
        act(() => {
          vi.advanceTimersByTime(half);
        });

        act(() => {
          setPageVisibility("hidden");
        });
        act(() => {
          vi.advanceTimersByTime(60 * 60 * 1000);
        });
        expect(useArrivalStore.getState().phase).toBe("loading");

        act(() => {
          setPageVisibility("visible");
        });
        act(() => {
          vi.advanceTimersByTime(half - 1);
        });
        expect(useArrivalStore.getState().phase).toBe("loading");

        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(useArrivalStore.getState().phase).toBe("fallback");
      });

      it("leaves no visibility listener behind on unmount", () => {
        // The stall clock subscribes to the document, which outlives the hero.
        // A leaked listener would re-arm a timer for a component that is gone —
        // the same class of defect as the R3F teardown re-failing the store.
        setPageVisibility("hidden");
        const { unmount } = render(<GoogleTilesStage apiToken="AIza-test" />);
        unmount();

        act(() => {
          setPageVisibility("visible");
        });
        expect(vi.getTimerCount()).toBe(0);
        act(() => {
          vi.advanceTimersByTime(ARRIVAL_TILES_STALL_MS * 3);
        });
        expect(useArrivalStore.getState().phase).toBe("loading");
        expect(arrivalLogs(consoleError.calls)).toHaveLength(0);
      });
    });
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
