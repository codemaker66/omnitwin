import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Quaternion, Vector3 } from "three";
import type { TwinManifest } from "@omnitwin/types";
import {
  ARRIVAL_FAIL_REASONS,
  useArrivalStore,
  type ArrivalFailReason,
} from "../arrival-store.js";
import { ARRIVAL_NO_TWIN_HOLD_MS } from "../arrival-config.js";
import { ARRIVAL_HARNESS_TILES_TOKEN } from "../arrival-dev-harness.js";
import { useDeviceStore } from "../../../../stores/device-store.js";
import { FRESH_TOUR_ENABLED } from "../../../fresh/fresh-copy.js";
import { ARRIVAL_RAIL, sampleRail } from "../camera-rail.js";
import {
  TWIN_FIXTURE_MANIFEST,
  TWIN_FIXTURE_MANIFEST_NO_MESH,
} from "../../../../twin/__fixtures__/twin-fixture.js";

// -----------------------------------------------------------------------------
// ArrivalHero — self-gating + wiring contract (Arrival Task 5).
//
// happy-dom has no WebGL, and the real GoogleTilesStage pulls in
// 3d-tiles-renderer's network-touching TilesRenderer, so both @react-three/
// fiber and ../GoogleTilesStage.js are mocked wholesale (the DollhouseStage/
// GoogleTilesStage.test.tsx pattern) — this is a structure/gating test, not a
// render test. FlightCamera's math (sampleRail) has its own coverage in
// camera-rail.test.ts; here it is exercised only enough to prove the
// flight -> arrived handoff and the invalidate() call are actually wired.
//
// The Canvas mock's onCreated timing deliberately mirrors the REAL
// @react-three/fiber@8.18.0 behaviour, verified against the installed
// package (dist/events-d0566a2e.cjs.dev.js:2082-2103): Canvas's own
// configure()/render() cycle re-runs on every commit (its layout effect has
// no dependency array), so a fresh inline onCreated closure is handed to the
// internal <Provider> on every render — but Provider's own layout effect that
// actually CALLS onCreated(state) has an EMPTY dependency array, so the call
// happens exactly once, on first mount, no matter how many times the parent
// re-renders with a new inline callback. A mock that re-invoked onCreated on
// every render would fail to catch a real double-attach regression (it would
// report a bug that doesn't exist in production) or hide one (vice versa) —
// this mock reproduces the "fires once at mount, deps-less" contract via a
// ref-latest pattern so the once-per-canvas invariant below is actually
// meaningful, not an artifact of the mock's own shape.
//
// explode-overlay-store.js (Task 10, extracted in review round 1) is used
// for REAL here, not mocked — it is a tiny, dependency-free zustand store
// (no drei/useGLTF import chain to keep out of scope), so there is nothing
// to gain from faking it, and using the real store means ArrivalHero's own
// `.setState()`-merge semantics get exercised honestly (StoreyLabels reads
// `labels`; ArrivalHero itself reads only `settled` — see ArrivalHero.tsx's
// header for why the two are split).
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];
const fakeCamera = { position: new Vector3(), quaternion: new Quaternion() };

/**
 * THE CANVAS ELEMENT IS REAL, and that is the whole point of this fixture.
 *
 * The old mock handed the component a `{ addEventListener: vi.fn() }` stub and
 * the webgl tests then reached into `mock.calls` for the callback and invoked
 * it by hand. That shape can prove a listener was ADDED and can never prove
 * one was REMOVED — which is exactly the defect the edge review found (see
 * WebglContextLossGuard in ArrivalHero.tsx). A real `<canvas>` from the
 * document has real add/removeEventListener, so "is anything still listening"
 * becomes a question the test can actually ask: dispatch the event and see.
 */
let lastDomElement: HTMLCanvasElement | null = null;

/** The event three's `WebGLRenderer.forceContextLoss()` ultimately causes —
 *  dispatched on the canvas element, which is what a real browser does even
 *  when the element has already been detached from the document (measured in
 *  Chromium; see WebglContextLossGuard's comment). */
function dispatchWebglContextLost(): void {
  lastDomElement?.dispatchEvent(new Event("webglcontextlost"));
}

/**
 * A hand-rolled capture rather than vi.spyOn: `console.error`'s
 * `(...data: any[])` signature collapses spyOn's return type to `any`, which
 * this repo's strictTypeChecked lint rejects — the same six lines
 * GoogleTilesStage.test.tsx and ArrivalErrorBoundary.test.tsx use.
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

/** The same six lines for the OTHER channel — the no-twin dissolve is a
 *  deployment gap, not a code failure, so it warns rather than errors. */
function captureConsoleWarn(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  /* eslint-disable no-console -- capturing the channel IS the assertion here */
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]): void => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.warn = original;
    },
  };
  /* eslint-enable no-console */
}

/** Only OUR diagnostics, never React's or anything else's on the same channel. */
function arrivalLogs(calls: readonly unknown[][]): unknown[][] {
  return calls.filter((args) => typeof args[0] === "string" && args[0].startsWith("Arrival:"));
}

interface CanvasMockProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly frameloop?: string;
  readonly onCreated?: (state: { gl: { domElement: HTMLCanvasElement } }) => void;
}

/**
 * R3F 8.18.0's REAL TEARDOWN DELAY, transcribed rather than invented.
 *
 * `unmountComponentAtNode` (node_modules/@react-three/fiber/dist/
 * events-d0566a2e.cjs.dev.js:2109-2133) unmounts the R3F children and then,
 * from the reconciler's completion callback, schedules a `setTimeout(…, 500)`
 * whose body calls `state.gl.forceContextLoss()` — three 0.180's
 * `WEBGL_lose_context.loseContext()` (three.cjs:74162-74167), which dispatches
 * `webglcontextlost` on the canvas element even after it has been detached.
 *
 * The mock reproduces that constant and that causal chain so the tests below
 * run against the timing R3F actually imposes; `vi.useFakeTimers()` then
 * advances exactly this far, so a test asserting "the store is still clean"
 * cannot pass merely by looking too early.
 */
const R3F_TEARDOWN_DELAY_MS = 500;

function Canvas({ children, className, frameloop, onCreated }: CanvasMockProps): ReactElement {
  // Always the latest callback (matches real R3F re-configuring on every
  // commit), but read from an effect with EMPTY deps so it is invoked
  // exactly once per mount — see the file header comment.
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  // Created during render, before any child renders, because in real R3F the
  // canvas element and the `gl` in the store both exist before a single Canvas
  // child mounts — a child asking useThree for `gl` must never see null.
  const [domElement] = useState<HTMLCanvasElement>(() => document.createElement("canvas"));
  lastDomElement = domElement;
  useEffect(() => {
    onCreatedRef.current?.({ gl: { domElement } });
    return () => {
      // The R3F teardown, in the same order and on the same clock the real one
      // uses: React has already unmounted this Canvas's children by the time
      // this cleanup runs, and only THEN does the delayed context loss land.
      setTimeout(() => {
        domElement.dispatchEvent(new Event("webglcontextlost"));
      }, R3F_TEARDOWN_DELAY_MS);
    };
  }, [domElement]);
  return (
    <div className={className} data-testid="arrival-canvas" data-frameloop={frameloop}>
      {children}
    </div>
  );
}

interface FakeThreeState {
  readonly invalidate: () => void;
  readonly camera: typeof fakeCamera;
  readonly gl: { readonly domElement: HTMLCanvasElement };
}

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: FakeThreeState) => unknown) =>
    selector({
      invalidate,
      camera: fakeCamera,
      // The same element the Canvas mock created, so a component reading `gl`
      // through useThree and the Canvas's own teardown are talking about one
      // canvas — exactly as they are in R3F, where both come off one store.
      gl: { domElement: lastDomElement ?? document.createElement("canvas") },
    }),
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
  Canvas,
}));

vi.mock("../GoogleTilesStage.js", () => ({
  GoogleTilesStage: ({ apiToken }: { apiToken: string }) => (
    <div data-testid="google-tiles-stage" data-api-token={apiToken} />
  ),
}));

// HallHandoff (Task 7) is mocked wholesale here too: it pulls in useGLTF /
// the meshopt decoder / the peel system, none of which this suite exercises
// (HallHandoff.test.tsx owns that coverage) — ArrivalHero's own job is just
// the wiring: mount it for arrived/exploded, and warm its mesh during
// flight. tradesHallMeshUrl's fake mirrors the real one's shape closely
// enough to prove the wiring without re-testing URL construction itself.
const tradesHallMeshUrlMock = vi.fn((manifest: TwinManifest): string | null =>
  manifest.mesh === undefined ? null : `/twin/trades-hall/${manifest.mesh.path}`,
);
/**
 * A switch for making the reveal throw DURING RENDER, on demand. It is here
 * rather than in a bespoke component because the crash has to happen to a hero
 * that is already mounted: the ordering defect it proves only exists when
 * React DELETES a live ArrivalHero, which only happens when something under an
 * already-mounted hero throws. HallHandoff mounts at "arrived", so flipping
 * this and then moving the phase produces exactly that.
 */
const hallHandoffCrash = { now: false };
vi.mock("../HallHandoff.js", () => ({
  HallHandoff: () => {
    if (hallHandoffCrash.now) {
      throw new Error("the reveal blew up during render");
    }
    return <div data-testid="hall-handoff" />;
  },
  tradesHallMeshUrl: tradesHallMeshUrlMock,
  TRADES_HALL_TWIN_SLUG: "trades-hall",
}));

const preloadDollhouseMock = vi.fn();
vi.mock("../../../../twin/DollhouseStage.js", () => ({
  preloadDollhouse: preloadDollhouseMock,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

type FakeManifestState =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly retry: () => void }
  | { readonly state: "ready"; readonly manifest: TwinManifest };

let manifestState: FakeManifestState = { state: "loading" };
vi.mock("../../../../twin/useTwinManifest.js", () => ({
  useTwinManifest: () => manifestState,
  twinAssetBase: () => "/twin",
}));

const { ArrivalHero, ARRIVAL_OPEN_HALL_LABEL, ARRIVAL_SKIP_LABEL } = await import(
  "../ArrivalHero.js"
);
const { useExplodeOverlayStore } = await import("../explode-overlay-store.js");
// The REAL boundary, not a stand-in. It is what owns the store reset now (see
// the lifecycle block at the bottom of this file), and the ordering defect it
// fixes is only observable when the real one does the real unmount.
const { ArrivalErrorBoundary } = await import("../ArrivalErrorBoundary.js");

beforeEach(() => {
  useArrivalStore.getState().reset();
  useExplodeOverlayStore.getState().reset();
  // Task 12's gate reads device tier too — pin a known, non-poster baseline
  // so a poster-tier test can never leak into an unrelated one (device-store
  // is a module-level singleton, so state otherwise survives across tests in
  // this file, per device-store.test.ts's own beforeEach doing the same).
  useDeviceStore.getState().override("low");
  invalidate.mockClear();
  frameCallbacks.length = 0;
  lastDomElement = null;
  // fakeCamera is a module-level singleton shared across every test (it
  // stands in for the one THREE.Camera instance @react-three/fiber would
  // hand out); reset it so a pose written by one test can never leak into
  // the next test's assertions on camera.position/quaternion.
  fakeCamera.position.set(0, 0, 0);
  fakeCamera.quaternion.identity();
  manifestState = { state: "loading" };
  preloadDollhouseMock.mockClear();
  tradesHallMeshUrlMock.mockClear();
  navigateMock.mockClear();
  hallHandoffCrash.now = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ArrivalHero — self-gating", () => {
  it('renders null and fails the store with reason "no-key" when no API key is configured', () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    const { container } = render(<ArrivalHero />);
    expect(container.firstChild).toBeNull();
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("no-key");
  });

  it('calls fail("no-key") exactly once, not on every re-render', () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    const originalFail = useArrivalStore.getState().fail;
    const spy = vi.fn(originalFail);
    useArrivalStore.setState({ fail: spy });
    try {
      const { rerender } = render(<ArrivalHero />);
      rerender(<ArrivalHero />);
      rerender(<ArrivalHero />);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ fail: originalFail });
    }
  });

  it("renders null once the store is in fallback phase, even with a valid key", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    useArrivalStore.setState({ phase: "fallback", failReason: "tiles" });
    const { container } = render(<ArrivalHero />);
    expect(container.firstChild).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The DEV tiles seam (arrival-dev-harness.ts's `?arrivalTiles=stub`). Its
// parsing is pinned in arrival-dev-harness.test.ts and its end-to-end effect —
// Google's two required attributions rendering with no key and no GPU — in
// e2e/arrival.spec.ts. What is pinned HERE is the one thing neither of those
// can see: which of the two tokens ArrivalHero hands to GoogleTilesStage when
// both exist. A seam that shadowed a real key would silently point a keyed
// developer's hero at a token Google rejects.
// -----------------------------------------------------------------------------

describe("ArrivalHero — the DEV tiles seam", () => {
  const setSearch = (search: string): void => {
    window.history.replaceState({}, "", `/${search}`);
  };

  afterEach(() => {
    setSearch("");
  });

  it("mounts the tiles stage with the synthetic token when there is no key", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    setSearch("?arrivalPhase=flight&arrivalTiles=stub");
    render(<ArrivalHero />);
    expect(screen.getByTestId("google-tiles-stage").getAttribute("data-api-token")).toBe(
      ARRIVAL_HARNESS_TILES_TOKEN,
    );
  });

  it("lets a REAL key win over the seam, so a keyed hero is unchanged", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    setSearch("?arrivalPhase=flight&arrivalTiles=stub");
    render(<ArrivalHero />);
    expect(screen.getByTestId("google-tiles-stage").getAttribute("data-api-token")).toBe(
      "AIza-test",
    );
  });

  // The phase seam on its own must stay exactly as cheap as it was: no token,
  // no tiles stage, no request anybody could be billed for. This is what
  // e2e/arrival-hero-controls.spec.ts and the storey case rely on.
  it("mounts NO tiles stage for the phase seam alone", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    setSearch("?arrivalPhase=flight");
    render(<ArrivalHero />);
    expect(screen.queryByTestId("google-tiles-stage")).toBeNull();
  });
});

describe("ArrivalHero — flight controls", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  it("shows the skip control during flight, and skip advances the store to arrived", () => {
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    const button = screen.getByRole("button", { name: ARRIVAL_SKIP_LABEL });
    fireEvent.click(button);
    expect(useArrivalStore.getState().phase).toBe("arrived");
  });

  it("does not render the skip control outside the flight phase", () => {
    for (const phase of ["loading", "arrived", "exploded"] as const) {
      useArrivalStore.setState({ phase });
      render(<ArrivalHero />);
      expect(screen.queryByRole("button", { name: ARRIVAL_SKIP_LABEL })).toBeNull();
      cleanup();
    }
  });

  it('runs frameloop "always" during flight and "demand" in every other phase', () => {
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    expect(screen.getByTestId("arrival-canvas").dataset["frameloop"]).toBe("always");
    cleanup();

    useArrivalStore.getState().reset();
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    expect(screen.getByTestId("arrival-canvas").dataset["frameloop"]).toBe("demand");
  });

  it("drives the camera along the rail and hands off to arrived at the end of flight", () => {
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    const onFrame = frameCallbacks[0];
    expect(onFrame).toBeDefined();
    // FLIGHT_DURATION_S is 11s; two 6s steps comfortably clear it.
    onFrame?.(undefined, 6);
    onFrame?.(undefined, 6);
    expect(useArrivalStore.getState().phase).toBe("arrived");
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("ArrivalHero — a throw in the flight camera's frame loop (branch review)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  // arrival-frame-guard.test.tsx owns the guard's own contract. THIS proves
  // FlightCamera is actually wired to it — the wiring is a single call-site
  // word ("useArrivalFrame" vs "useFrame"), invisible in the DOM, and a
  // refactor could quietly drop it.
  //
  // The fault is injected into a real collaborator the loop actually uses
  // (the camera object it writes the rail pose onto), so the throw travels
  // the real path. Unguarded it escapes into R3F's rAF loop, which has no
  // catch anywhere: the frame aborts, every later subscriber and every other
  // R3F root on the page is starved, and it repeats at frame rate forever
  // because nothing unsubscribes it. No error boundary can see any of that.
  it("contains it, falls back to the photo, and says so once", () => {
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    const onFrame = frameCallbacks[0];
    expect(onFrame).toBeDefined();

    const consoleError = captureConsoleError();
    const broken = vi.spyOn(fakeCamera.position, "copy").mockImplementation(() => {
      throw new Error("camera position is gone");
    });
    try {
      expect(() => {
        act(() => {
          onFrame?.(undefined, 0.016);
        });
      }).not.toThrow();
      // The next frame is not a second throw, and not a second diagnostic.
      expect(() => {
        act(() => {
          onFrame?.(undefined, 0.016);
        });
      }).not.toThrow();
    } finally {
      broken.mockRestore();
      consoleError.restore();
    }

    expect(useArrivalStore.getState().phase).toBe("fallback");
    // "frame-crash", not "crash": a throw out of the rAF loop and a throw out
    // of React's render are different machines with different remedies, and
    // failReason is the only thing that says which one died once the
    // photograph has taken over (arrival-store.ts).
    expect(useArrivalStore.getState().failReason).toBe("frame-crash");
    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.[0]).toContain("FlightCamera");
  });
});

describe("ArrivalHero — held camera poses", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  // Regression coverage for an Important review finding: GoogleTilesStage's
  // first-idle readiness signal certifies "everything requested for the
  // START-POSE camera has loaded" (that component's own header comment).
  // Before this fix, "loading" left the camera at R3F's default pose
  // (position.z=5, looking at the origin) — tiles streamed for the wrong,
  // close-up view, so first-idle certified readiness for a view the flight
  // never actually shows, and the real aerial start pose could still be
  // unloaded when flight begins.
  it("holds the rail's START pose (t=0) during loading, so first-idle certifies the right view", () => {
    useArrivalStore.setState({ phase: "loading" });
    render(<ArrivalHero />);
    const expected = sampleRail(ARRIVAL_RAIL, 0);
    expect(fakeCamera.position.equals(expected.position)).toBe(true);
    expect(fakeCamera.quaternion.equals(expected.quaternion)).toBe(true);
    expect(invalidate).toHaveBeenCalled();
  });

  it("holds the rail's FINAL pose (t=1) once arrived", () => {
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    const expected = sampleRail(ARRIVAL_RAIL, 1);
    expect(fakeCamera.position.equals(expected.position)).toBe(true);
    expect(fakeCamera.quaternion.equals(expected.quaternion)).toBe(true);
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("ArrivalHero — webgl context loss", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    useArrivalStore.setState({ phase: "flight" });
  });

  it("attaches the webglcontextlost handler exactly once per canvas creation", () => {
    // Counted by BEHAVIOUR rather than by inspecting a stubbed
    // addEventListener: one dispatch reaching fail() twice is what a
    // double-attach actually costs, and it is measurable on a real element,
    // where the old `{ addEventListener: vi.fn() }` stub could only ever count
    // registrations and never removals. (Same fail-spy technique as the
    // "no-key exactly once" case above.)
    const originalFail = useArrivalStore.getState().fail;
    const spy = vi.fn(originalFail);
    useArrivalStore.setState({ fail: spy });
    try {
      render(<ArrivalHero />);
      // A store-driven re-render (still mounted, same Canvas) must not
      // re-subscribe — the guard's effect is keyed on `gl`, which does not
      // change.
      act(() => {
        useArrivalStore.getState().flightDone();
      });
      act(() => {
        dispatchWebglContextLost();
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ fail: originalFail });
    }
  });

  it('fails the store with reason "webgl" when the GL context is lost', () => {
    render(<ArrivalHero />);
    act(() => {
      dispatchWebglContextLost();
    });
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("webgl");
  });
});

// -----------------------------------------------------------------------------
// R3F'S OWN TEARDOWN MUST NOT RE-FAIL THE STORE AFTER THE BOUNDARY RESET IT
// (edge review, CRITICAL).
//
// The reset that ends the story lives in ArrivalErrorBoundary's
// componentWillUnmount, which runs in the commit phase. @react-three/fiber
// 8.18.0 then keeps working for another half-second: unmountComponentAtNode
// schedules `setTimeout(… state.gl.forceContextLoss() …, 500)`
// (events-d0566a2e.cjs.dev.js:2109-2133), and three 0.180's forceContextLoss
// is `WEBGL_lose_context.loseContext()` (three.cjs:74162-74167), which really
// does dispatch `webglcontextlost` on a canvas that has already left the
// document — measured in Chromium, not assumed.
//
// So the whole point of these cases is the ORDER and the DELAY: reset first,
// context loss 500 ms later. Against the previous implementation — where the
// listener was attached in `<Canvas onCreated>` and therefore never removed —
// they fail exactly as production did: phase "fallback", failReason "webgl",
// and a visitor who navigates back to the homepage never sees the arrival
// again for the life of the tab.
// -----------------------------------------------------------------------------
describe("ArrivalHero — R3F's delayed teardown, against the real 500ms", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the store clean after a genuine navigation away", () => {
    useArrivalStore.setState({ phase: "flight" });
    const { unmount } = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();

    unmount();
    // The boundary's reset has already run at this point — that much was
    // always true, and is what made the defect invisible.
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();

    // …and now R3F's teardown timer fires and the context is lost.
    act(() => {
      vi.advanceTimersByTime(R3F_TEARDOWN_DELAY_MS);
    });

    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();
  });

  it("gives the next visit a live hero, not a corpse the teardown poisoned", () => {
    // The visitor-facing shape of the same defect: leave /fresh, wait, come
    // back — a client-side navigation with no reload, so the module-singleton
    // store is the same one. The second mount must be a beginning.
    useArrivalStore.setState({ phase: "arrived" });
    const first = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    first.unmount();
    act(() => {
      vi.advanceTimersByTime(R3F_TEARDOWN_DELAY_MS * 4);
    });

    render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();
  });

  it("still hears a REAL context loss while the hero is mounted", () => {
    // The other half: the fix must not buy its silence by deafening the guard.
    useArrivalStore.setState({ phase: "flight" });
    const { unmount } = render(<ArrivalHero />);
    act(() => {
      dispatchWebglContextLost();
    });
    expect(useArrivalStore.getState().failReason).toBe("webgl");
    unmount();
    act(() => {
      vi.advanceTimersByTime(R3F_TEARDOWN_DELAY_MS);
    });
  });
});

// -----------------------------------------------------------------------------
// NOBODY IS LEFT UNDER GOOGLE'S ROOF (edge review).
//
// A keyed build whose twin bundle is not hosted — production, today — used to
// end the fly-in and simply stop: an opaque canvas of Google photogrammetry
// over `img.fr-hero-photo`, no dollhouse, no "Open the Hall" (rightly gated on
// the same fact), no Skip (flight-only), no Close (exploded-only). Not one
// control, and the venue photograph the page is built around hidden behind a
// melty approximation of the same building.
//
// The arrival now RESOLVES: it holds the landing for a beat and then takes the
// ordinary spec §6 exit. See ARRIVAL_NO_TWIN_HOLD_MS (arrival-config.ts) for
// the alternatives that were weighed.
// -----------------------------------------------------------------------------
describe("ArrivalHero — no twin to reveal: the arrival resolves, it does not strand", () => {
  let consoleWarn: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubMatchMedia(false);
    vi.useFakeTimers();
    consoleWarn = captureConsoleWarn();
  });

  afterEach(() => {
    consoleWarn.restore();
    vi.useRealTimers();
  });

  /** Production's actual shape: the manifest request is answered by the SPA
   *  rewrite with index.html, so it fails validation and lands in "error". */
  function arriveWithNoTwin(): ReturnType<typeof render> {
    manifestState = { state: "error", retry: () => undefined };
    useArrivalStore.setState({ phase: "arrived" });
    return render(<ArrivalHero />);
  }

  it("holds the landed pose first — it does not cut out the instant it arrives", () => {
    arriveWithNoTwin();
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS - 1);
    });
    expect(useArrivalStore.getState().phase).toBe("arrived");
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();
  });

  it("then dissolves, and the photograph is carrying the page again", () => {
    const { container } = arriveWithNoTwin();
    // The dead end, stated as an assertion: there is nothing on screen to
    // click, so without the dissolve there is no way back to the page at all.
    expect(screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: ARRIVAL_SKIP_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS);
    });
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("no-twin");

    const hero = document.querySelector(".arrival-hero") as Element;
    fireEvent(hero, transitionEndEvent("opacity"));
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("arrival-canvas")).toBeNull();
  });

  it("says why, in English, exactly once", () => {
    arriveWithNoTwin();
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS * 4);
    });
    const logs = arrivalLogs(consoleWarn.calls);
    expect(logs).toHaveLength(1);
    expect(String(logs[0]?.[0])).toContain("public/twin");
  });

  it("waits for a manifest that is still in flight — a late reveal is not a dead end", () => {
    manifestState = { state: "loading" };
    useArrivalStore.setState({ phase: "arrived" });
    const { rerender } = render(<ArrivalHero />);
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS * 4);
    });
    // Still "loading" is NOT "there is no twin" — dissolving here would throw
    // away a reveal that was about to work.
    expect(useArrivalStore.getState().phase).toBe("arrived");

    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
    rerender(<ArrivalHero />);
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS * 4);
    });
    expect(useArrivalStore.getState().phase).toBe("arrived");
    expect(screen.getByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).not.toBeNull();
  });

  it("never fires when there IS a dollhouse — the arrival ends where it should", () => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS * 10);
    });
    expect(useArrivalStore.getState().phase).toBe("arrived");
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();
  });

  it("a manifest with no mesh in it is also nothing to reveal", () => {
    // The other half of dollhouseReady: the manifest parsed fine, it just
    // carries no mesh (an older bundle). HallHandoff renders null for it too.
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST_NO_MESH };
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS);
    });
    expect(useArrivalStore.getState().failReason).toBe("no-twin");
  });

  it("leaves the flight alone — the dissolve belongs to the landing, not the approach", () => {
    manifestState = { state: "error", retry: () => undefined };
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    act(() => {
      vi.advanceTimersByTime(ARRIVAL_NO_TWIN_HOLD_MS * 4);
    });
    expect(useArrivalStore.getState().phase).toBe("flight");
    expect(screen.getByRole("button", { name: ARRIVAL_SKIP_LABEL })).not.toBeNull();
  });
});

describe("ArrivalHero — HallHandoff mount gating (Task 7)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  it("does not mount HallHandoff during loading or flight", () => {
    for (const phase of ["loading", "flight"] as const) {
      useArrivalStore.setState({ phase });
      render(<ArrivalHero />);
      expect(screen.queryByTestId("hall-handoff")).toBeNull();
      cleanup();
    }
  });

  it("mounts HallHandoff once arrived, and keeps it mounted through exploded", () => {
    for (const phase of ["arrived", "exploded"] as const) {
      useArrivalStore.setState({ phase });
      render(<ArrivalHero />);
      expect(screen.getByTestId("hall-handoff")).not.toBeNull();
      cleanup();
    }
  });
});

describe("ArrivalHero — warms the dollhouse GLB as early as possible (Task 7, Step 3; widened post-review)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  // Widened from "flight only" after review: reduced-motion visits go
  // loading -> arrived directly, never passing through flight, and a
  // flight-only trigger left HallHandoff mounting against a cold cache in
  // that case (and on an early Skip). The rule is now "any phase but
  // fallback" — loading warms it before flight even starts.
  it("preloads the mesh in every phase but fallback, with a ready, mesh-bearing manifest", () => {
    for (const phase of ["loading", "flight", "arrived", "exploded"] as const) {
      manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
      useArrivalStore.setState({ phase });
      render(<ArrivalHero />);
      expect(tradesHallMeshUrlMock).toHaveBeenCalledWith(TWIN_FIXTURE_MANIFEST);
      expect(preloadDollhouseMock).toHaveBeenCalledExactlyOnceWith(
        "/twin/trades-hall/mesh/dollhouse.glb",
      );
      cleanup();
      preloadDollhouseMock.mockClear();
      tradesHallMeshUrlMock.mockClear();
    }
  });

  it("never preloads in the fallback phase, even with a ready manifest", () => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
    useArrivalStore.setState({ phase: "fallback" });
    render(<ArrivalHero />);
    expect(preloadDollhouseMock).not.toHaveBeenCalled();
  });

  it("does not preload before the manifest is ready", () => {
    manifestState = { state: "loading" };
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    expect(preloadDollhouseMock).not.toHaveBeenCalled();
  });

  it("does not preload when the manifest errors", () => {
    manifestState = { state: "error", retry: vi.fn() };
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    expect(preloadDollhouseMock).not.toHaveBeenCalled();
  });

  it("does not preload a mesh-less ready manifest", () => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST_NO_MESH };
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    expect(tradesHallMeshUrlMock).toHaveBeenCalledWith(TWIN_FIXTURE_MANIFEST_NO_MESH);
    expect(preloadDollhouseMock).not.toHaveBeenCalled();
  });
});

describe('ArrivalHero — "Open the Hall" (Task 10 review round 1, Minor 6)', () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    // The invitation is now gated on the dollhouse being genuinely loadable,
    // not on phase alone — so a ready, mesh-bearing manifest is part of the
    // baseline for every case that expects the button to exist.
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
  });

  it("shows the invitation only while arrived, and clicking it explodes the Hall", () => {
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    const button = screen.getByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL });
    fireEvent.click(button);
    expect(useArrivalStore.getState().phase).toBe("exploded");
  });

  it("is absent outside the arrived phase", () => {
    for (const phase of ["loading", "flight", "exploded"] as const) {
      useArrivalStore.setState({ phase });
      render(<ArrivalHero />);
      expect(screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).toBeNull();
      cleanup();
    }
  });

  // ——— the dead-control gate (CRITICAL B) ———
  //
  // In production the trades-hall manifest CANNOT load: public/twin/ is
  // gitignored, so the request hits the SPA rewrite and comes back as
  // index.html with a 200, which fails schema validation. HallHandoff already
  // degraded to null for exactly this; the button that opens it did not, so
  // the live homepage shipped a control that swapped in a Close button, stole
  // focus, and revealed nothing. Each case below is one way the dollhouse can
  // fail to exist, and in every one the invitation must not be offered.
  //
  // These share the arrived phase with the passing case above, so they fail
  // if the gate is ever loosened back to `phase === "arrived"` alone.
  it("is absent while arrived if the manifest has not loaded yet", () => {
    manifestState = { state: "loading" };
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    expect(screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).toBeNull();
  });

  it("is absent while arrived if the manifest failed — production's real case", () => {
    manifestState = { state: "error", retry: () => undefined };
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    expect(screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).toBeNull();
  });

  it("is absent while arrived if a ready manifest carries no mesh", () => {
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST_NO_MESH };
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    expect(screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL })).toBeNull();
  });

  it("offers the invitation exactly when HallHandoff will render something", () => {
    // The two gates must agree: the button exists iff the thing it opens does.
    for (const state of [
      { state: "loading" },
      { state: "error", retry: () => undefined },
      { state: "ready", manifest: TWIN_FIXTURE_MANIFEST_NO_MESH },
      { state: "ready", manifest: TWIN_FIXTURE_MANIFEST },
    ] satisfies readonly FakeManifestState[]) {
      manifestState = state;
      useArrivalStore.setState({ phase: "arrived" });
      render(<ArrivalHero />);
      const offered = screen.queryByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL }) !== null;
      const willRender =
        state.state === "ready" && tradesHallMeshUrlMock(state.manifest) !== null;
      expect(offered).toBe(willRender);
      cleanup();
    }
  });
});

describe("ArrivalHero — explode overlay bridge (Task 10)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
  });

  it('runs frameloop "always" while the explode overlay is unsettled, even outside flight', () => {
    useArrivalStore.setState({ phase: "arrived" });
    useExplodeOverlayStore.setState({ settled: false, labels: [] });
    render(<ArrivalHero />);
    expect(screen.getByTestId("arrival-canvas").dataset["frameloop"]).toBe("always");
  });

  it('returns to "demand" once the overlay settles again', () => {
    useArrivalStore.setState({ phase: "arrived" });
    useExplodeOverlayStore.setState({ settled: true, labels: [] });
    render(<ArrivalHero />);
    expect(screen.getByTestId("arrival-canvas").dataset["frameloop"]).toBe("demand");
  });

  it("renders no storey labels and no Close control when the overlay is empty", () => {
    useArrivalStore.setState({ phase: "arrived" });
    useExplodeOverlayStore.setState({ settled: true, labels: [] });
    render(<ArrivalHero />);
    expect(document.querySelector(".arrival-storeys")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders one label per overlay entry, positioned from its projected pixel offset", () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [
        { bucket: 0, label: "Reception Room & Robert Adam Room", xPx: 120, yPx: 340 },
        { bucket: 1, label: "Grand Hall & Saloon", xPx: 400, yPx: 160 },
      ],
    });
    render(<ArrivalHero />);

    const groundLabel = document.querySelector('[data-arrival-storey="0"]');
    const upperLabel = document.querySelector('[data-arrival-storey="1"]');
    expect(groundLabel).not.toBeNull();
    expect(upperLabel).not.toBeNull();
    expect(groundLabel?.textContent).toContain("Reception Room & Robert Adam Room");
    expect((groundLabel as HTMLElement).style.transform).toContain("translate(120px, 340px)");
    expect((upperLabel as HTMLElement).style.transform).toContain("translate(400px, 160px)");
  });

  // This used to assert unconditionally that the room name navigates to
  // "/tour" — pinning in place a route that cannot load in production, the
  // exact dead door FRESH_TOUR_ENABLED exists to prevent and that FreshPage
  // already gates its own two CTAs on. It now asserts the FLAG's contract in
  // both directions, mirroring fresh.test.tsx's own treatment of the same
  // flag, so it stays honest whether the twin bundle is published or not.
  it("offers the room name as a door to the walkthrough only when it is published", () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [{ bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 }],
    });
    render(<ArrivalHero />);
    const asButton = screen.queryByRole("button", { name: "Grand Hall & Saloon" });

    if (FRESH_TOUR_ENABLED) {
      expect(asButton).not.toBeNull();
      fireEvent.click(asButton as HTMLElement);
      expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/tour");
    } else {
      // No dead doors: the name still labels the storey, but as inert text —
      // nothing on this layer may advertise an unreachable tour.
      expect(asButton).toBeNull();
      const asText = document.querySelector("span.arrival-storey-name");
      expect(asText?.textContent).toBe("Grand Hall & Saloon");
      expect(navigateMock).not.toHaveBeenCalledWith("/tour");
    }
  });

  it('clicking "Plan this room" navigates to "/plan"', () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [{ bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 }],
    });
    render(<ArrivalHero />);
    // Minor 5: the button's VISIBLE text is still "Plan this room" (the
    // brief's literal CTA copy), but its accessible name is now the
    // disambiguating aria-label — see the next test for why that matters
    // with more than one storey on screen.
    const plan = screen.getByRole("button", { name: "Plan Grand Hall & Saloon" });
    expect(plan.textContent).toBe("Plan this room");
    fireEvent.click(plan);
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/plan");
  });

  it("gives each storey's Plan button a distinct accessible name (Minor 5)", () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [
        { bucket: 0, label: "Reception Room & Robert Adam Room", xPx: 0, yPx: 0 },
        { bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 },
      ],
    });
    render(<ArrivalHero />);
    // Both buttons visibly say "Plan this room" — getByRole with that name
    // would be ambiguous. Each has to be reachable by its OWN aria-label.
    expect(
      screen.getByRole("button", { name: "Plan Reception Room & Robert Adam Room" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Plan Grand Hall & Saloon" })).not.toBeNull();
  });

  it('shows "Close" only while exploded, and it calls reassemble()', () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [{ bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 }],
    });
    render(<ArrivalHero />);
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.click(close);
    expect(useArrivalStore.getState().phase).toBe("arrived");
  });

  it("does not show Close while merely arrived, even if a label is (unusually) present", () => {
    useArrivalStore.setState({ phase: "arrived" });
    useExplodeOverlayStore.setState({
      settled: false,
      labels: [{ bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 }],
    });
    render(<ArrivalHero />);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Fallback armor (Task 12). stubMatchMedia mirrors useDive.test.ts's pattern
// (the codebase's established way of faking prefers-reduced-motion without
// re-implementing reduced-motion.ts's own matchMedia read) rather than
// mocking that module away — ArrivalHero -> useArrivalGate's real
// prefersReducedMotion() call is exactly what these tests exercise.
// -----------------------------------------------------------------------------

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  }));
}

/** Builds a synthetic transitionend event with a real `propertyName`, since
 *  happy-dom has no TransitionEvent constructor (createEvent falls back to
 *  plain Event, whose init dict does not carry arbitrary extra fields) — see
 *  ArrivalHero.tsx's onTransitionEnd handler, which reads exactly this field. */
function transitionEndEvent(propertyName: string): Event {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}

describe("ArrivalHero — poster-tier gate (Task 12)", () => {
  it('renders nothing and fails the store with reason "poster-tier" on a poster-tier device, even with a valid key', () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    useDeviceStore.getState().override("poster");
    const { container } = render(<ArrivalHero />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("arrival-canvas")).toBeNull();
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("poster-tier");
  });

  it("does not gate on any tier below poster", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    for (const tier of ["low", "medium", "high"] as const) {
      useDeviceStore.getState().override(tier);
      useArrivalStore.getState().reset();
      render(<ArrivalHero />);
      expect(useArrivalStore.getState().phase).not.toBe("fallback");
      cleanup();
    }
  });
});

describe("ArrivalHero — fallback fade (Task 12, spec §6 'holds briefly, then fades')", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubMatchMedia(false);
  });

  it("keeps the canvas mounted, with the fallback attribute, right after a live failure — the fade holds first", () => {
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();

    act(() => {
      useArrivalStore.getState().fail("tiles");
    });

    const hero = document.querySelector(".arrival-hero");
    expect(hero).not.toBeNull();
    expect(hero?.getAttribute("data-arrival-phase")).toBe("fallback");
    // Holds — the last frame stays up, it does not vanish the instant the
    // store fails; only the CSS opacity is now animating toward 0.
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();
  });

  it("fully unmounts once the opacity transition ends", () => {
    useArrivalStore.setState({ phase: "arrived" });
    const { container } = render(<ArrivalHero />);
    act(() => {
      useArrivalStore.getState().fail("tiles");
    });
    const hero = document.querySelector(".arrival-hero");
    expect(hero).not.toBeNull();

    fireEvent(hero as Element, transitionEndEvent("opacity"));
    expect(container.firstChild).toBeNull();
  });

  it("ignores a transitionend for an unrelated CSS property — does not unmount early", () => {
    useArrivalStore.setState({ phase: "arrived" });
    const { container } = render(<ArrivalHero />);
    act(() => {
      useArrivalStore.getState().fail("tiles");
    });
    const hero = document.querySelector(".arrival-hero") as Element;

    fireEvent(hero, transitionEndEvent("transform"));
    expect(container.firstChild).not.toBeNull();

    fireEvent(hero, transitionEndEvent("opacity"));
    expect(container.firstChild).toBeNull();
  });

  it("does not wait for a transitionend under reduced motion — unmounts immediately", () => {
    stubMatchMedia(true);
    useArrivalStore.setState({ phase: "flight" });
    const { container } = render(<ArrivalHero />);

    act(() => {
      dispatchWebglContextLost();
    });

    expect(useArrivalStore.getState().failReason).toBe("webgl");
    expect(container.firstChild).toBeNull();
  });
});

describe("ArrivalHero — the invariant: any failure ends with nothing rendered (Task 12)", () => {
  // The property that actually matters: whatever knocks the flight over,
  // FreshPage's static hero photo ends up carrying the page exactly as it
  // did before ArrivalHero existed — this component contributes nothing to
  // the DOM once each reason has fully played out. no-key/poster-tier/crash
  // get there on the very first render (never having shown a canvas at all);
  // tiles/webgl get there via the fade, so a transitionend is simulated for
  // those two before the final assertion.
  const CASES: ReadonlyArray<{
    readonly reason: ArrivalFailReason;
    readonly trigger: () => void;
  }> = [
    {
      reason: "no-key",
      trigger: () => {
        vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
      },
    },
    {
      reason: "poster-tier",
      trigger: () => {
        vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
        useDeviceStore.getState().override("poster");
      },
    },
    {
      // Task 12b. Unlike the others, ArrivalHero can never PRODUCE "crash" —
      // it is ArrivalErrorBoundary's reason, raised when a throw escapes this
      // component's own render (see ArrivalErrorBoundary.test.tsx). What is
      // worth asserting here is the other half: a fresh mount that INHERITS
      // an already-crashed store — what a re-render of FreshPage produces —
      // must still contribute nothing, exactly like the others.
      reason: "crash",
      trigger: () => {
        vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
        useArrivalStore.getState().fail("crash");
      },
    },
    {
      // The frame guard's own reason (branch review round 2). Same shape as
      // "crash" above and deliberately a SEPARATE case rather than a second
      // label on the same one: they are produced by different machinery —
      // ArrivalErrorBoundary catching React, versus useArrivalFrame catching
      // R3F's rAF loop — and the exhaustiveness gate below is what forces a
      // new reason to be thought about here rather than quietly inherited.
      reason: "frame-crash",
      trigger: () => {
        vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
        useArrivalStore.getState().fail("frame-crash");
      },
    },
  ];

  // Reasons that can only ever arrive while the canvas is already on screen,
  // so they leave through the fade rather than never rendering at all.
  // "no-twin" belongs here for the same reason as the other two: it is raised
  // from "arrived", which by definition means the hero has been flying.
  const FADING: ReadonlyArray<ArrivalFailReason> = ["tiles", "webgl", "no-twin"];

  it("covers every ArrivalFailReason — no reason may be added without a case here", () => {
    // The whole point of this describe block is EXHAUSTIVENESS, and two
    // hand-written lists silently stop being exhaustive the moment someone
    // widens the union (as Task 12b did, with "crash"). ARRIVAL_FAIL_REASONS
    // is derived from a Record keyed by the union itself, so it cannot drift
    // from the type — which makes this a real gate rather than a third list
    // to forget.
    const covered = [...CASES.map((c) => c.reason), ...FADING].sort();
    expect(covered).toEqual([...ARRIVAL_FAIL_REASONS].sort());
  });

  for (const { reason, trigger } of CASES) {
    it(`"${reason}" lands on phase "fallback" with no canvas, no rendered content`, () => {
      trigger();
      const { container } = render(<ArrivalHero />);
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe(reason);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("arrival-canvas")).toBeNull();
    });
  }

  for (const reason of FADING) {
    it(`"${reason}" lands on phase "fallback" with no canvas, once the fade completes`, () => {
      vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
      stubMatchMedia(false);
      useArrivalStore.setState({ phase: "arrived" });
      const { container } = render(<ArrivalHero />);
      expect(screen.getByTestId("arrival-canvas")).not.toBeNull();

      act(() => {
        useArrivalStore.getState().fail(reason);
      });
      expect(useArrivalStore.getState().phase).toBe("fallback");
      expect(useArrivalStore.getState().failReason).toBe(reason);

      const hero = document.querySelector(".arrival-hero") as Element;
      fireEvent(hero, transitionEndEvent("opacity"));

      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("arrival-canvas")).toBeNull();
    });
  }
});

// -----------------------------------------------------------------------------
// THE STORY ENDS WHEN THE HERO REGION LEAVES THE PAGE — and "the hero region"
// is ArrivalErrorBoundary, not ArrivalHero (branch review round 2, CRITICAL).
//
// useArrivalStore is a module singleton: without a reset, leaving /fresh for
// /plan and coming back — a client-side navigation, no reload — re-mounted the
// hero into whatever phase the last visit abandoned ("exploded" with no scene
// behind it, "arrived" with the flight already spent).
//
// The first fix put that reset in ArrivalHero's own unmount cleanup, which is
// wrong for a reason a test that never unmounts under a crash cannot see: the
// boundary catching a throw ALSO unmounts ArrivalHero, and React 18 runs
// componentDidCatch in the layout phase but a deleted subtree's useEffect
// cleanups in the later passive phase — so the reset ran strictly after
// fail("crash") and erased it. Every test below therefore renders through the
// REAL ArrivalErrorBoundary, and the crash case drives a REAL throw through a
// REAL unmount rather than simulating one.
// -----------------------------------------------------------------------------
describe("ArrivalHero — the story ends when the hero region leaves the page", () => {
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubMatchMedia(false);
    hallHandoffCrash.now = false;
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    consoleError.restore();
  });

  it("resets the phase machine when the boundary unmounts", () => {
    useArrivalStore.setState({ phase: "exploded" });
    const { unmount } = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    expect(useArrivalStore.getState().phase).toBe("exploded");

    unmount();
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();
  });

  it("clears a FAILURE too — reset() is the store's only way out of fallback", () => {
    useArrivalStore.setState({ phase: "arrived" });
    const { unmount } = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    act(() => {
      useArrivalStore.getState().fail("tiles");
    });
    expect(useArrivalStore.getState().phase).toBe("fallback");

    unmount();
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();
  });

  it("gives the next visit the whole story back, from the top", () => {
    // The actual reported shape, played out: fly, land, navigate away,
    // navigate back. The second mount must be a beginning, not a resumption.
    useArrivalStore.setState({ phase: "flight" });
    const first = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    const onFrame = frameCallbacks[0];
    act(() => {
      onFrame?.(undefined, 6);
      onFrame?.(undefined, 6);
    });
    expect(useArrivalStore.getState().phase).toBe("arrived");

    first.unmount();
    render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );

    expect(useArrivalStore.getState().phase).toBe("loading");
    // …and it is a live hero again, not a corpse: the canvas is mounted and
    // the skip control is absent because the flight has not started yet.
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();
    expect(screen.queryByRole("button", { name: ARRIVAL_SKIP_LABEL })).toBeNull();
  });

  it("does NOT reset on mount: a fresh mount inheriting a failed store stays failed", () => {
    // The deliberate behaviour this fix must not undo — the shape a re-render
    // of FreshPage produces after ArrivalErrorBoundary has caught a throw.
    // Re-mounting straight back into a flight that just crashed is exactly
    // what must never happen.
    useArrivalStore.getState().fail("crash");
    const { container } = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );

    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("crash");
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("arrival-canvas")).toBeNull();
  });

  // ═══ THE regression test for the ordering defect.
  //
  // Everything about it is real: a real ArrivalErrorBoundary, a real throw out
  // of a real child's render, and a real React unmount of ArrivalHero as the
  // boundary swaps its subtree for null. No simulated unmount, because a
  // simulated one is precisely what let this ship — the previous test for the
  // reset called `unmount()` by hand on a hero that had never crashed, so the
  // two writes never raced.
  //
  // Against the previous implementation this FAILS: fail("crash") lands in the
  // commit layout phase and ArrivalHero's own unmount cleanup then ran in the
  // passive phase and called reset(), so the assertions below saw phase
  // "loading" and failReason null — the hero's terminal failure erased by its
  // own teardown, on every crash, in production.
  it("a crash stays a crash: the unmount it causes must not wipe the failure", () => {
    useArrivalStore.setState({ phase: "flight" });
    render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    // Mounted and alive first — the defect needs a hero that really is
    // mounted, so that deleting it really does run a cleanup.
    expect(screen.getByTestId("arrival-canvas")).not.toBeNull();

    // HallHandoff mounts at "arrived", and now throws while rendering. This
    // is the shape the boundary exists for: a throw out of React's own render
    // under the hero.
    hallHandoffCrash.now = true;
    act(() => {
      useArrivalStore.setState({ phase: "arrived" });
    });

    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("crash");
    // And the hero really is gone — this was a genuine unmount, not a
    // re-render that happened to hide things.
    expect(screen.queryByTestId("arrival-canvas")).toBeNull();
    // The boundary said so exactly once.
    expect(arrivalLogs(consoleError.calls)).toHaveLength(1);
  });

  it("still ends the story after a crash, once the page itself goes away", () => {
    // The other half: making the crash terminal must not cost the thing the
    // reset was for. Navigate away after a crash and the NEXT visit still
    // starts from the top.
    useArrivalStore.setState({ phase: "flight" });
    const { unmount } = render(
      <ArrivalErrorBoundary>
        <ArrivalHero />
      </ArrivalErrorBoundary>,
    );
    hallHandoffCrash.now = true;
    act(() => {
      useArrivalStore.setState({ phase: "arrived" });
    });
    expect(useArrivalStore.getState().failReason).toBe("crash");

    unmount();
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();
  });
});

describe("ArrivalHero — focus handoff on explode/reassemble (Task 12 bundled a11y fix)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    // "Open the Hall" is half of this handoff and is now gated on the
    // dollhouse being loadable, so the whole cycle needs a ready manifest.
    manifestState = { state: "ready", manifest: TWIN_FIXTURE_MANIFEST };
  });

  it('moves focus to "Close" the instant the Hall explodes', () => {
    useArrivalStore.setState({ phase: "arrived" });
    render(<ArrivalHero />);
    const openHall = screen.getByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL });
    fireEvent.click(openHall);
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
  });

  it('moves focus back to "Open the Hall" the instant it reassembles', () => {
    useArrivalStore.setState({ phase: "exploded" });
    render(<ArrivalHero />);
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.click(close);
    const openHall = screen.getByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL });
    expect(document.activeElement).toBe(openHall);
  });

  it("does not steal focus onto \"Open the Hall\" on a normal (non-reassemble) arrival", () => {
    useArrivalStore.setState({ phase: "flight" });
    render(<ArrivalHero />);
    const onFrame = frameCallbacks[0];
    act(() => {
      onFrame?.(undefined, 6);
      onFrame?.(undefined, 6);
    });
    expect(useArrivalStore.getState().phase).toBe("arrived");
    const openHall = screen.getByRole("button", { name: ARRIVAL_OPEN_HALL_LABEL });
    expect(document.activeElement).not.toBe(openHall);
  });
});
