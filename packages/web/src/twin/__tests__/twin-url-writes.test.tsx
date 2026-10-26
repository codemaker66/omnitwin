import { act, cleanup, render } from "@testing-library/react";
import { type ReactElement } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
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
// Every case runs under the declarative MemoryRouter the unit tests use and
// under a data router, the kind the app runs on (createBrowserRouter).
// requestAnimationFrame is a hand-cranked queue, as in useTwinWalk.test.ts.
// -----------------------------------------------------------------------------

let walk: TwinWalk | null = null;
let mode: TwinModeState | null = null;
let search = "";

function Harness(): ReactElement | null {
  walk = useTwinWalk(TWIN_FIXTURE_MANIFEST);
  mode = useTwinMode(true);
  search = useLocation().search;
  return null;
}

const ROUTERS = {
  "a MemoryRouter": (entry: string): ReactElement => (
    <MemoryRouter initialEntries={[entry]}>
      <Harness />
    </MemoryRouter>
  ),
  "a data router": (entry: string): ReactElement => (
    <RouterProvider
      router={createMemoryRouter([{ path: "/twin", element: <Harness /> }], { initialEntries: [entry] })}
    />
  ),
} as const;

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

function current(): { walk: TwinWalk; mode: TwinModeState } {
  if (walk === null || mode === null) throw new Error("The harness has not rendered.");
  return { walk, mode };
}

beforeEach(() => {
  walk = null;
  mode = null;
  search = "";
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
  vi.unstubAllGlobals();
});

describe.each(Object.entries(ROUTERS))("the tour's address under %s", (_kind, mount) => {
  it("keeps the dollhouse when a hop begun in the walk lands after the switch", () => {
    render(mount("/twin?node=scan_000"));
    act(() => { current().walk.hopTo("scan_001"); });
    flushFrames(3);
    expect(current().walk.targetId).toBe("scan_001");

    act(() => { current().mode.setMode("dollhouse"); });
    expect(search).toBe("?node=scan_000&mode=dollhouse");

    for (let frame = 0; frame < 300 && current().walk.targetId !== null; frame += 1) flushFrames(1);

    expect(current().walk.currentId).toBe("scan_001");
    expect(current().mode.mode).toBe("dollhouse");
    expect(search).toBe("?node=scan_001&mode=dollhouse");
  });

  it("lands the dive on the viewpoint it dived to, in the walk", () => {
    render(mount("/twin?node=scan_000&mode=dollhouse"));
    // TwinViewer's useDive onArrive, in its own order: two writes in one tick.
    act(() => {
      current().walk.hopTo("scan_002", { teleport: true });
      current().mode.setMode("walk");
    });

    expect(current().walk.currentId).toBe("scan_002");
    expect(current().mode.mode).toBe("walk");
    expect(search).toBe("?node=scan_002");
  });

  it("composes the two writes in either order", () => {
    render(mount("/twin?node=scan_000&mode=dollhouse"));
    act(() => {
      current().mode.setMode("walk");
      current().walk.hopTo("scan_002", { teleport: true });
    });

    expect(current().walk.currentId).toBe("scan_002");
    expect(current().mode.mode).toBe("walk");
    expect(search).toBe("?node=scan_002");
  });

  it("keeps a mode chosen in the same tick as a teleport", () => {
    // Mounted without ?node=, so the walk has written it once already; the
    // switch and the teleport after it must each keep the other's key.
    render(mount("/twin"));
    expect(search).toBe("?node=scan_000");
    act(() => {
      current().mode.setMode("dollhouse");
      current().walk.hopTo("scan_001", { teleport: true });
    });

    expect(current().mode.mode).toBe("dollhouse");
    expect(search).toBe("?node=scan_001&mode=dollhouse");
  });
});
