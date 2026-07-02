import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useTwinMode, type TwinMode } from "../useTwinMode.js";

// -----------------------------------------------------------------------------
// useTwinMode — the walk ⇄ dollhouse ⇄ plan mode machine (Phase 2, Task 5).
//
// The URL (?mode=) is the machine's single source of truth — the hook derives
// mode from useSearchParams rather than mirroring it in state, so it can never
// fight useTwinWalk's ?node= writes (both use the functional setSearchParams
// form and preserve each other's params). History semantics under test:
// entering or leaving dollhouse pushes ONE entry (back exits the dollhouse);
// every other switch replaces. Absent param = walk; an invalid value or a
// mesh-less bundle clamps to walk and canonicalises the URL without history.
// -----------------------------------------------------------------------------

/** Harness: the mode plus a live view of the search params and history. */
function useHarness(hasMesh: boolean): {
  mode: TwinMode;
  setMode: (mode: TwinMode) => void;
  modeParam: string | null;
  nodeParam: string | null;
  navigate: ReturnType<typeof useNavigate>;
} {
  const { mode, setMode } = useTwinMode(hasMesh);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  return {
    mode,
    setMode,
    modeParam: searchParams.get("mode"),
    nodeParam: searchParams.get("node"),
    navigate,
  };
}

function routerWrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return createElement(MemoryRouter, { initialEntries: [initialEntry] }, children);
  };
}

function mountMode(initialEntry: string, hasMesh = true) {
  return renderHook(() => useHarness(hasMesh), { wrapper: routerWrapper(initialEntry) });
}

describe("useTwinMode — reading ?mode=", () => {
  it("defaults to walk when the param is absent, without writing the URL", () => {
    const { result } = mountMode("/twin?node=scan_000");
    expect(result.current.mode).toBe("walk");
    expect(result.current.modeParam).toBeNull();
    expect(result.current.nodeParam).toBe("scan_000");
  });

  it("reads dollhouse and plan from the URL when the bundle has a mesh", () => {
    expect(mountMode("/twin?mode=dollhouse").result.current.mode).toBe("dollhouse");
    expect(mountMode("/twin?mode=plan").result.current.mode).toBe("plan");
  });

  it("clamps an invalid value to walk and canonicalises the URL", () => {
    const { result } = mountMode("/twin?mode=blimp&node=scan_001");
    expect(result.current.mode).toBe("walk");
    expect(result.current.modeParam).toBeNull();
    expect(result.current.nodeParam).toBe("scan_001"); // other params survive
  });

  it("clamps to walk when the bundle has no mesh, whatever the URL says", () => {
    const { result } = mountMode("/twin?mode=dollhouse", false);
    expect(result.current.mode).toBe("walk");
    expect(result.current.modeParam).toBeNull();
  });
});

describe("useTwinMode — setMode", () => {
  it("enters dollhouse, writing ?mode= and preserving other params", () => {
    const { result } = mountMode("/twin?node=scan_000");
    act(() => {
      result.current.setMode("dollhouse");
    });
    expect(result.current.mode).toBe("dollhouse");
    expect(result.current.modeParam).toBe("dollhouse");
    expect(result.current.nodeParam).toBe("scan_000");
  });

  it("returns to walk by dropping the param (absent = walk is canonical)", () => {
    const { result } = mountMode("/twin?mode=dollhouse&node=scan_000");
    act(() => {
      result.current.setMode("walk");
    });
    expect(result.current.mode).toBe("walk");
    expect(result.current.modeParam).toBeNull();
    expect(result.current.nodeParam).toBe("scan_000");
  });

  it("ignores non-walk requests when the bundle has no mesh", () => {
    const { result } = mountMode("/twin", false);
    act(() => {
      result.current.setMode("dollhouse");
    });
    expect(result.current.mode).toBe("walk");
    expect(result.current.modeParam).toBeNull();
  });

  it("no-ops when asked for the mode already active", () => {
    const { result } = mountMode("/twin?mode=plan");
    act(() => {
      result.current.setMode("plan");
    });
    expect(result.current.mode).toBe("plan");
    expect(result.current.modeParam).toBe("plan");
  });
});

describe("useTwinMode — history semantics", () => {
  it("entering dollhouse pushes one entry, so back returns to walk", () => {
    const { result } = mountMode("/twin?node=scan_000");
    act(() => {
      result.current.setMode("dollhouse");
    });
    expect(result.current.mode).toBe("dollhouse");
    act(() => {
      void result.current.navigate(-1);
    });
    expect(result.current.mode).toBe("walk");
    expect(result.current.nodeParam).toBe("scan_000");
  });

  it("leaving dollhouse pushes too — back re-enters it", () => {
    const { result } = mountMode("/twin?mode=dollhouse");
    act(() => {
      result.current.setMode("walk");
    });
    expect(result.current.mode).toBe("walk");
    act(() => {
      void result.current.navigate(-1);
    });
    expect(result.current.mode).toBe("dollhouse");
  });

  it("walk ⇄ plan replaces — back from plan does not step through walk", () => {
    // A single-entry memory history: navigate(-1) after a REPLACE stays put,
    // proving no entry was pushed by the walk → plan switch.
    const { result } = mountMode("/twin");
    act(() => {
      result.current.setMode("plan");
    });
    expect(result.current.mode).toBe("plan");
    act(() => {
      void result.current.navigate(-1);
    });
    expect(result.current.mode).toBe("plan");
  });

  it("plan → dollhouse crosses the dollhouse boundary and pushes", () => {
    const { result } = mountMode("/twin?mode=plan");
    act(() => {
      result.current.setMode("dollhouse");
    });
    expect(result.current.mode).toBe("dollhouse");
    act(() => {
      void result.current.navigate(-1);
    });
    expect(result.current.mode).toBe("plan");
  });
});
