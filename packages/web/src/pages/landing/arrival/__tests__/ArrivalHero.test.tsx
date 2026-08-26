import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { Quaternion, Vector3 } from "three";
import { useArrivalStore } from "../arrival-store.js";
import { ARRIVAL_RAIL, sampleRail } from "../camera-rail.js";

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
// -----------------------------------------------------------------------------

const invalidate = vi.fn();
const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];
const fakeCamera = { position: new Vector3(), quaternion: new Quaternion() };

type AddEventListenerFn = (type: string, cb: () => void) => void;

interface FakeDomElement {
  readonly addEventListener: ReturnType<typeof vi.fn<AddEventListenerFn>>;
}

function makeFakeDomElement(): FakeDomElement {
  return { addEventListener: vi.fn<AddEventListenerFn>() };
}

let lastDomElement: FakeDomElement | null = null;

function webglContextLostListener(): (() => void) | undefined {
  const call = lastDomElement?.addEventListener.mock.calls.find(
    ([type]) => type === "webglcontextlost",
  );
  return call?.[1];
}

interface CanvasMockProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly frameloop?: string;
  readonly onCreated?: (state: { gl: { domElement: FakeDomElement } }) => void;
}

function Canvas({ children, className, frameloop, onCreated }: CanvasMockProps): ReactElement {
  // Always the latest callback (matches real R3F re-configuring on every
  // commit), but read from an effect with EMPTY deps so it is invoked
  // exactly once per mount — see the file header comment.
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  useEffect(() => {
    const domElement = makeFakeDomElement();
    lastDomElement = domElement;
    onCreatedRef.current?.({ gl: { domElement } });
  }, []);
  return (
    <div className={className} data-testid="arrival-canvas" data-frameloop={frameloop}>
      {children}
    </div>
  );
}

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void; camera: typeof fakeCamera }) => unknown) =>
    selector({ invalidate, camera: fakeCamera }),
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

const { ArrivalHero, ARRIVAL_SKIP_LABEL } = await import("../ArrivalHero.js");

beforeEach(() => {
  useArrivalStore.getState().reset();
  invalidate.mockClear();
  frameCallbacks.length = 0;
  lastDomElement = null;
  // fakeCamera is a module-level singleton shared across every test (it
  // stands in for the one THREE.Camera instance @react-three/fiber would
  // hand out); reset it so a pose written by one test can never leak into
  // the next test's assertions on camera.position/quaternion.
  fakeCamera.position.set(0, 0, 0);
  fakeCamera.quaternion.identity();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
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
    render(<ArrivalHero />);
    expect(lastDomElement?.addEventListener).toHaveBeenCalledTimes(1);
    // A store-driven re-render (still mounted, same Canvas) must not re-attach.
    useArrivalStore.getState().flightDone();
    expect(lastDomElement?.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('fails the store with reason "webgl" when the GL context is lost', () => {
    render(<ArrivalHero />);
    const onLost = webglContextLostListener();
    expect(onLost).toBeDefined();
    onLost?.();
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("webgl");
  });
});
