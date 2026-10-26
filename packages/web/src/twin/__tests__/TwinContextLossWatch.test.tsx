import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FiberState { readonly gl: { readonly domElement: HTMLCanvasElement }; readonly invalidate: () => void }

const fiber = vi.hoisted(() => ({
  state: null as FiberState | null,
  frames: new Set<() => void>(),
  invalidate: vi.fn(),
  canvases: [] as HTMLCanvasElement[],
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    useThree: <T,>(selector: (state: FiberState) => T): T => {
      if (fiber.state === null) throw new Error("useThree outside a canvas");
      return selector(fiber.state);
    },
    useFrame: (callback: () => void) => {
      const latest = React.useRef(callback);
      React.useLayoutEffect(() => { latest.current = callback; });
      React.useLayoutEffect(() => {
        const subscription = (): void => { latest.current(); };
        fiber.frames.add(subscription);
        return () => { fiber.frames.delete(subscription); };
      }, []);
    },
  };
});

const { useTwinGraphicsRecovery } = await import("../TwinContextLossWatch.js");

/** A stand-in for R3F's Canvas: a new drawing surface each time it mounts. */
function FakeCanvas({ children }: { readonly children: ReactNode }): ReactNode {
  const canvas = useMemo(() => {
    const created = document.createElement("canvas");
    fiber.canvases.push(created);
    return created;
  }, []);
  fiber.state = { gl: { domElement: canvas }, invalidate: fiber.invalidate };
  return <>{children}</>;
}

function Tour(): ReactNode {
  const graphics = useTwinGraphicsRecovery();
  return (
    <div>
      <FakeCanvas key={graphics.canvasKey}>{graphics.watch}</FakeCanvas>
      {graphics.notice}
    </div>
  );
}

function canvas(index: number): HTMLCanvasElement {
  const element = fiber.canvases[index];
  if (element === undefined) throw new Error(`Canvas ${String(index)} was never mounted`);
  return element;
}

function loseContext(target: HTMLCanvasElement): Event {
  const event = new Event("webglcontextlost", { cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}

async function flush(): Promise<void> {
  await act(async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); });
}

function frame(): void {
  act(() => { for (const subscription of [...fiber.frames]) subscription(); });
}

beforeEach(() => {
  fiber.state = null;
  fiber.frames.clear();
  fiber.invalidate.mockReset();
  fiber.canvases.length = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the tour's graphics recovery", () => {
  it("covers the tour while its context is gone and draws again once the browser restores it in place", async () => {
    render(<Tour />);
    const event = loseContext(canvas(0));
    // Without preventDefault the browser never restores the context at all.
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
    await flush();

    act(() => { canvas(0).dispatchEvent(new Event("webglcontextrestored")); });
    await flush();
    // A demand loop has nothing else asking for the frame that shows the room again.
    expect(fiber.invalidate).toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeDefined();
    frame();
    await flush();
    expect(screen.queryByRole("status")).toBeNull();
    expect(fiber.canvases).toHaveLength(1);
  });

  it("gives the tour a new canvas when the browser never hands the context back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<Tour />);
    loseContext(canvas(0));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    await flush();
    expect(fiber.canvases).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
    frame();
    await flush();
    expect(screen.queryByRole("status")).toBeNull();

    // The canvas it gave up on no longer speaks for the tour.
    loseContext(canvas(0));
    await flush();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("loses its context once on ?graphicsReset and hands it back, so a real phone can be checked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    window.history.replaceState({}, "", "/tour?graphicsReset=1");
    try {
      render(<Tour />);
      const target = canvas(0);
      const extension = {
        loseContext: vi.fn(() => { target.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); }),
        restoreContext: vi.fn(() => { target.dispatchEvent(new Event("webglcontextrestored")); }),
      };
      Object.defineProperty(target, "getContext", { value: () => ({ getExtension: () => extension }) });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(extension.loseContext).toHaveBeenCalledOnce();
      expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(extension.restoreContext).toHaveBeenCalledOnce();
      frame();
      await flush();
      expect(screen.queryByRole("status")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(extension.loseContext).toHaveBeenCalledOnce();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("says the tour stopped when the context keeps being lost, and starts again on request", async () => {
    render(<Tour />);
    for (let loss = 0; loss < 2; loss++) {
      loseContext(canvas(0));
      await flush();
      act(() => { canvas(0).dispatchEvent(new Event("webglcontextrestored")); });
      await flush();
      frame();
      await flush();
    }
    loseContext(canvas(0));
    await flush();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The 3D view stopped.");
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(fiber.canvases).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
