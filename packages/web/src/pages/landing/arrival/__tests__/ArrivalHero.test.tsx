import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { Quaternion, Vector3 } from "three";
import type { TwinManifest } from "@omnitwin/types";
import {
  ARRIVAL_FAIL_REASONS,
  useArrivalStore,
  type ArrivalFailReason,
} from "../arrival-store.js";
import { useDeviceStore } from "../../../../stores/device-store.js";
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

// HallHandoff (Task 7) is mocked wholesale here too: it pulls in useGLTF /
// the meshopt decoder / the peel system, none of which this suite exercises
// (HallHandoff.test.tsx owns that coverage) — ArrivalHero's own job is just
// the wiring: mount it for arrived/exploded, and warm its mesh during
// flight. tradesHallMeshUrl's fake mirrors the real one's shape closely
// enough to prove the wiring without re-testing URL construction itself.
const tradesHallMeshUrlMock = vi.fn((manifest: TwinManifest): string | null =>
  manifest.mesh === undefined ? null : `/twin/trades-hall/${manifest.mesh.path}`,
);
vi.mock("../HallHandoff.js", () => ({
  HallHandoff: () => <div data-testid="hall-handoff" />,
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

  it('clicking a storey label\'s room name navigates to "/tour"', () => {
    useArrivalStore.setState({ phase: "exploded" });
    useExplodeOverlayStore.setState({
      settled: true,
      labels: [{ bucket: 1, label: "Grand Hall & Saloon", xPx: 0, yPx: 0 }],
    });
    render(<ArrivalHero />);
    fireEvent.click(screen.getByRole("button", { name: "Grand Hall & Saloon" }));
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/tour");
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
    const onLost = webglContextLostListener();
    expect(onLost).toBeDefined();

    act(() => {
      onLost?.();
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
  ];

  const FADING: ReadonlyArray<ArrivalFailReason> = ["tiles", "webgl"];

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

describe("ArrivalHero — focus handoff on explode/reassemble (Task 12 bundled a11y fix)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
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
