import { act, cleanup, render } from "@testing-library/react";
import { lazy, Suspense, useContext, type ReactElement } from "react";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  UNSAFE_NavigationContext,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTwinMode, type TwinModeState } from "../useTwinMode.js";
import { useTwinWalk, type TwinWalk } from "../useTwinWalk.js";
import { TWIN_FIXTURE_MANIFEST } from "../__fixtures__/twin-fixture.js";

// -----------------------------------------------------------------------------
// The tour's address has two writers: the walk owns ?node=, the mode ?mode=.
// Each write must start from the address as it stands when it is made. React
// Router 7 hands a functional setSearchParams updater the params of the render
// that created the setter, so a write from an older closure rebuilt the query
// from an address the visitor had since changed: a hop landing a second after
// a switch to Dollhouse dropped ?mode= and put the visitor back in the walk,
// and the dive's two writes in one tick put the old viewpoint back (both
// measured on master, 26 Oct 2026, T-674).
//
// Every case runs under a declarative MemoryRouter, under a data router (the
// kind the app runs on: router.tsx's createBrowserRouter shares this core),
// and under a data router whose routes have loaders, where navigations finish
// a tick later. Writes are made through functions captured before the tick,
// as TwinViewer's useDive onArrive holds them. requestAnimationFrame is a
// hand-cranked queue, as in useTwinWalk.test.ts.
// -----------------------------------------------------------------------------

let walk: TwinWalk | null = null;
let mode: TwinModeState | null = null;
let navigateTo: ((to: string | number) => void) | null = null;

function Harness(): ReactElement {
  walk = useTwinWalk(TWIN_FIXTURE_MANIFEST);
  mode = useTwinMode(true);
  const navigate = useNavigate();
  navigateTo = (to) => {
    if (typeof to === "number") void navigate(to);
    else void navigate(to);
  };
  return <p>{`tour at ${useLocation().search}`}</p>;
}

// The next page never finishes loading, so the tour stays on screen while the
// visitor is leaving it: the window in which a landing hop could still write.
const NeverLoads = lazy(() => new Promise<{ default: () => ReactElement }>(() => undefined));

/** The address the router is at, or going to while a navigation is pending. */
type Address = () => string;

interface Mounted {
  readonly ui: ReactElement;
  readonly address: Address;
  /** Whether a navigation commits the moment it is made. With loaders it does
   *  not, and a second navigation in the same tick replaces the pending one
   *  instead of stacking on it: the router's rule, not the tour's. */
  readonly commitsAtOnce: boolean;
}

let navigator: unknown = null;
function NavigatorProbe(): null {
  navigator = useContext(UNSAFE_NavigationContext).navigator;
  return null;
}

function memoryHistoryAddress(): string {
  const { location } = navigator as { location: { pathname: string; search: string } };
  return `${location.pathname}${location.search}`;
}

let disposeRouter: (() => void) | null = null;

function dataRouter(entry: string, loaders: boolean): Mounted {
  const loader = loaders ? (): null => null : undefined;
  const routes: RouteObject[] = [
    { path: "/twin", element: <Harness />, ...(loader === undefined ? {} : { loader }) },
    { path: "/other", element: <NeverLoads /> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  disposeRouter = () => { router.dispose(); };
  return {
    ui: <Suspense fallback="loading"><RouterProvider router={router} /></Suspense>,
    address: () => {
      const { location, navigation } = router.state;
      const at = navigation.location ?? location;
      return `${at.pathname}${at.search}`;
    },
    commitsAtOnce: !loaders,
  };
}

const ROUTERS: Record<string, (entry: string) => Mounted> = {
  "a MemoryRouter": (entry) => ({
    ui: (
      <Suspense fallback="loading">
        <MemoryRouter initialEntries={[entry]}>
          <NavigatorProbe />
          <Routes>
            <Route path="/twin" element={<Harness />} />
            <Route path="/other" element={<NeverLoads />} />
          </Routes>
        </MemoryRouter>
      </Suspense>
    ),
    address: memoryHistoryAddress,
    commitsAtOnce: true,
  }),
  "a data router": (entry) => dataRouter(entry, false),
  "a data router with loaders": (entry) => dataRouter(entry, true),
};

let rafClock = 0;
let rafId = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>();

function flushFrames(count: number): void {
  for (let frame = 0; frame < count; frame += 1) {
    rafClock += 16;
    const pending = [...rafCallbacks.values()];
    rafCallbacks.clear();
    act(() => {
      for (const callback of pending) callback(rafClock);
    });
  }
}

/** Let pending navigations (a loader's tick) finish. */
async function settle(): Promise<void> {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
  }
}

function captured(): { walk: TwinWalk; mode: TwinModeState; go: (to: string | number) => void } {
  if (walk === null || mode === null || navigateTo === null) {
    throw new Error("The harness has not rendered.");
  }
  return { walk, mode, go: navigateTo };
}

async function landHop(): Promise<void> {
  for (let frame = 0; frame < 300 && captured().walk.targetId !== null; frame += 1) flushFrames(1);
  await settle();
}

beforeEach(() => {
  walk = null;
  mode = null;
  navigateTo = null;
  navigator = null;
  rafClock = 0;
  rafCallbacks.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    rafId += 1;
    rafCallbacks.set(rafId, callback);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  cleanup();
  disposeRouter?.();
  disposeRouter = null;
  vi.unstubAllGlobals();
});

describe.each(Object.entries(ROUTERS))("the tour's address under %s", (_kind, mount) => {
  it("keeps the dollhouse when a hop begun in the walk lands after the switch", async () => {
    const { ui, address } = mount("/twin?node=scan_000");
    render(ui);
    await settle();
    const before = captured();
    act(() => { before.walk.hopTo("scan_001"); });
    flushFrames(3);
    expect(captured().walk.targetId).toBe("scan_001");

    act(() => { captured().mode.setMode("dollhouse"); });
    await settle();
    expect(address()).toBe("/twin?node=scan_000&mode=dollhouse");

    await landHop();
    expect(captured().walk.currentId).toBe("scan_001");
    expect(captured().mode.mode).toBe("dollhouse");
    expect(address()).toBe("/twin?node=scan_001&mode=dollhouse");

    // The landing is one history entry on top of the switch.
    act(() => { captured().go(-1); });
    await settle();
    expect(address()).toBe("/twin?node=scan_000&mode=dollhouse");
  });

  it("lands the dive on the viewpoint it dived to, in the walk", async () => {
    const { ui, address } = mount("/twin?node=scan_000&mode=dollhouse");
    render(ui);
    await settle();
    // TwinViewer's useDive onArrive, in its own order, with its render's functions.
    const { walk: diveWalk, mode: diveMode } = captured();
    act(() => {
      diveWalk.hopTo("scan_002", { teleport: true });
      diveMode.setMode("walk");
    });
    await settle();

    expect(captured().walk.currentId).toBe("scan_002");
    expect(captured().mode.mode).toBe("walk");
    expect(address()).toBe("/twin?node=scan_002");
  });

  it("composes the dive's two writes in the other order too", async () => {
    const { ui, address } = mount("/twin?node=scan_000&mode=dollhouse");
    render(ui);
    await settle();
    const { walk: diveWalk, mode: diveMode } = captured();
    act(() => {
      diveMode.setMode("walk");
      diveWalk.hopTo("scan_002", { teleport: true });
    });
    await settle();

    expect(captured().walk.currentId).toBe("scan_002");
    expect(captured().mode.mode).toBe("walk");
    expect(address()).toBe("/twin?node=scan_002");
  });

  it("keeps a mode chosen in the same tick as a teleport", async () => {
    // Mounted without ?node=, so the walk has already written it once.
    const { ui, address } = mount("/twin");
    render(ui);
    await settle();
    expect(address()).toBe("/twin?node=scan_000");
    const { walk: tickWalk, mode: tickMode } = captured();
    act(() => {
      tickMode.setMode("dollhouse");
      tickWalk.hopTo("scan_001", { teleport: true });
    });
    await settle();

    expect(captured().mode.mode).toBe("dollhouse");
    expect(address()).toBe("/twin?node=scan_001&mode=dollhouse");
  });

  it("decides each press from the address, so two quick presses keep both entries", async () => {
    const { ui, address, commitsAtOnce } = mount("/twin?node=scan_000");
    render(ui);
    await settle();
    const { mode: pressMode } = captured();
    act(() => {
      pressMode.setMode("dollhouse");
      pressMode.setMode("plan");
      pressMode.setMode("plan");
    });
    await settle();
    expect(address()).toBe("/twin?node=scan_000&mode=plan");

    // Entering and leaving the dollhouse each push, so the plan press keeps the
    // dollhouse entry beneath it (read from the render, it saw "walk" and
    // replaced it), and the repeated press wrote nothing.
    if (commitsAtOnce) {
      act(() => { captured().go(-1); });
      await settle();
      expect(address()).toBe("/twin?node=scan_000&mode=dollhouse");
    }
    act(() => { captured().go(-1); });
    await settle();
    expect(address()).toBe("/twin?node=scan_000");
  });

  it("writes nothing into the next page when a hop lands as the visitor leaves", async () => {
    const { ui, address } = mount("/twin?node=scan_000&mode=dollhouse");
    render(ui);
    await settle();
    act(() => { captured().walk.hopTo("scan_001"); });
    flushFrames(3);
    act(() => { captured().go("/other?ref=x"); });
    await settle();
    expect(address()).toBe("/other?ref=x");

    await landHop();
    expect(address()).toBe("/other?ref=x");
  });
});
