import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GuestFlowReplayArtifactSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
} from "@omnitwin/types";

// happy-dom has no WebGL: stub the R3F hooks the overlays use and render drei's
// Html children straight to the DOM so the SAFE labels are queryable. The three
// intrinsics (group/mesh/lineSegments/…) render as inert custom elements.
const frameState = vi.hoisted((): { callbacks: Array<() => void>; canvas: HTMLCanvasElement | null } => ({ callbacks: [], canvas: null }));
vi.mock("@react-three/fiber", async () => {
  const { PerspectiveCamera } = await import("three");
  const camera = new PerspectiveCamera(55, 1366 / 1000, 0.1, 1000);
  camera.position.set(0, 1.6, 8); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  const canvas = document.createElement("canvas"); frameState.canvas = canvas;
  const sceneState = { invalidate: vi.fn(), camera, gl: { domElement: canvas }, size: { width: 1366, height: 1000 } };
  return { useThree: (selector: (state: typeof sceneState) => unknown) => selector(sceneState), useFrame: (callback: () => void) => { frameState.callbacks.push(callback); } };
});
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../hooks/use-cockpit-replay.js", () => ({ useCockpitReplay: vi.fn() }));

const replayHook = vi.mocked(await import("../../../hooks/use-cockpit-replay.js"));
const { TRADES_HALL_GUEST_FLOW_REPLAY_INPUT } = await import("../../../lib/trades-hall-visual-demo-state.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { CockpitSceneOverlays } = await import("../CockpitSceneOverlays.js");

const REAL_ARTIFACT: GuestFlowReplayArtifact = GuestFlowReplayArtifactSchema.parse(
  runGuestFlowReplayV0(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT),
);

describe("CockpitSceneOverlays", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    frameState.callbacks.length = 0;
    useCockpitStore.getState().reset();
    replayHook.useCockpitReplay.mockReturnValue({
      artifact: REAL_ARTIFACT,
      bounds: REAL_ARTIFACT.navmesh.roomBounds,
      status: "ready",
    });
  });
  afterEach(() => {
    cleanup();
    useCockpitStore.getState().reset();
    warn.mockClear();
    error.mockClear();
  });

  it("renders nothing in the Design lens (clean editing scene)", () => {
    useCockpitStore.getState().setMode("design");
    const { container } = render(<CockpitSceneOverlays />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Heritage & wall buffer/)).toBeNull();
  });

  it("shows the review markers + heritage planning guide in the Evidence lens", () => {
    useCockpitStore.getState().setMode("evidence");
    render(<CockpitSceneOverlays />);
    expect(screen.getByText(/Heritage & wall buffer/)).toBeTruthy();
  });

  it("renders overlays in the Flow lens", () => {
    useCockpitStore.getState().setMode("flow");
    const { container } = render(<CockpitSceneOverlays />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/Heritage & wall buffer/)).toBeTruthy();
  });

  it("keeps review disclosures available while replay-heavy geometry pauses for camera movement", () => {
    useCockpitStore.getState().setMode("flow");
    useCockpitStore.getState().setCameraInteractionActive(true);
    render(<CockpitSceneOverlays />);
    expect(screen.getByText(/Heritage & wall buffer/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Simulated/ }).length).toBeGreaterThan(0);
  });

  it("preserves the selected warning while compact geometry policy changes", () => {
    useCockpitStore.getState().setMode("flow");
    const { container, rerender } = render(<CockpitSceneOverlays />);
    expect(container.querySelector('[name="cockpit-heritage"]')).not.toBeNull();
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const beam = useCockpitStore.getState().beam;
    rerender(<CockpitSceneOverlays renderGeometry={false} />);
    expect(container.querySelector("mesh, lineSegments")).toBeNull();
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    expect(useCockpitStore.getState().beam).toBe(beam);
    expect(screen.getByRole("button", { name: "Dismiss annotation details" })).toBeTruthy();
    rerender(<CockpitSceneOverlays renderGeometry />);
    expect(container.querySelector('[name="cockpit-heritage"]')).not.toBeNull();
    expect(marker.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows only the labelled lighting placeholder in the Lighting lens", () => {
    useCockpitStore.getState().setMode("lighting");
    render(<CockpitSceneOverlays />);
    expect(screen.getByText(/Lighting probe grid · planning placeholder/)).toBeTruthy();
    expect(screen.queryByText(/Heritage & wall buffer/)).toBeNull();
  });

  it("honours the Layers toggle — hiding heritage removes its band in the Evidence lens", () => {
    useCockpitStore.getState().setMode("evidence");
    useCockpitStore.getState().setOverlay("heritageBuffer", false);
    render(<CockpitSceneOverlays />);
    expect(screen.queryByText(/Heritage & wall buffer/)).toBeNull();
  });
  it("opens the full simulated conflict by click or tap, without changing Interior", () => {
    useCockpitStore.getState().setMode("flow");
    useCockpitStore.getState().setWalkMode(true);
    render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    expect(marker).toBeDefined();
    if (marker === undefined) throw new Error("Missing simulated marker");
    fireEvent.click(marker);
    const beam = useCockpitStore.getState().beam;
    expect(beam).not.toBeNull();
    expect(beam?.showLabel).toBe(false);
    expect(beam?.label).toBe(marker.getAttribute("aria-label"));
    const detailId = marker.getAttribute("aria-controls");
    if (detailId === null) throw new Error("Missing accessible annotation detail");
    const detail = document.getElementById(detailId);
    expect(detail?.textContent).toBeTruthy();
    expect(beam?.label).toContain(detail?.textContent);
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(screen.getByRole("button", { name: "Dismiss annotation details" })).toBeTruthy();
  });

  it("clears its focused annotation beam when the overlay owner unmounts", () => {
    useCockpitStore.getState().setMode("flow");
    const { unmount } = render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing simulated marker");
    fireEvent.focus(marker);
    expect(useCockpitStore.getState().beam).not.toBeNull();
    unmount();
    expect(useCockpitStore.getState().beam).toBeNull();
  });

  it("keeps a selected message through mouse leave and dismisses with Escape, restoring its trigger", () => {
    useCockpitStore.getState().setMode("flow");
    render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const beam = useCockpitStore.getState().beam;
    fireEvent.mouseLeave(marker);
    expect(useCockpitStore.getState().beam).toBe(beam);
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(marker, { key: "Escape" });
    expect(useCockpitStore.getState().beam).toBeNull();
    expect(document.activeElement).toBe(marker);
    expect(marker.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not erase a newer beam owned by another control during cleanup", () => {
    useCockpitStore.getState().setMode("flow");
    const { unmount } = render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.focus(marker);
    const other = { anchor: [1, 0, 2] as const, label: "Other evidence selection", tone: "info" as const };
    act(() => { useCockpitStore.getState().setBeam(other); });
    unmount(); expect(useCockpitStore.getState().beam).toBe(other);
  });

  it("retains every disclosure while a covering surface temporarily owns the whole canvas, then restores selection", () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div"); shell.className = "reference-viewer";
    const cover = document.createElement("div"); cover.className = "lens-panel";
    shell.append(canvas, cover); document.body.append(shell);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    const coverBox = vi.spyOn(cover, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    useCockpitStore.getState().setMode("flow");
    const { container, unmount } = render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const runFrame = (): void => { const callback = frameState.callbacks.at(-1); if (callback === undefined) throw new Error("No annotation frame"); callback(); };
    act(runFrame);
    const layer = container.querySelector<HTMLElement>(".scene-annotations");
    expect(layer?.style.visibility).toBe("hidden");
    expect(useCockpitStore.getState().beam).toBeNull();
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    coverBox.mockReturnValue(new DOMRect());
    fireEvent(window, new Event("resize"));
    act(runFrame);
    expect(layer?.style.visibility).toBe("visible");
    expect(useCockpitStore.getState().beam).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss annotation details" })).toBeTruthy();
    unmount(); shell.remove(); canvasBox.mockRestore(); coverBox.mockRestore();
  });

  it("retains selected details while the camera begins moving", () => {
    useCockpitStore.getState().setMode("flow");
    render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const beam = useCockpitStore.getState().beam;
    act(() => { useCockpitStore.getState().setCameraInteractionActive(true); });
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    expect(useCockpitStore.getState().beam).toBe(beam);
  });

  it("retains all review warnings beyond the geometry marker cap", () => {
    const template = REAL_ARTIFACT.routeConflicts[0];
    if (template === undefined) throw new Error("Missing fixture conflict");
    const conflicts = Array.from({ length: 12 }, (_, index) => ({
      ...template, id: `warning-${String(index)}`, severity: "review" as const,
      message: `Distinct warning ${String(index)}`,
    }));
    replayHook.useCockpitReplay.mockReturnValue({
      artifact: { ...REAL_ARTIFACT, routeConflicts: conflicts },
      bounds: REAL_ARTIFACT.navmesh.roomBounds, status: "ready",
    });
    useCockpitStore.getState().setMode("flow");
    render(<CockpitSceneOverlays />);
    expect(screen.getAllByRole("button", { name: /Distinct warning/ })).toHaveLength(12);
    expect(screen.getByText("13 planning annotations · scroll for all")).toBeTruthy();
  });

  it("defers to a portalled modal and restores the selected details after it closes", async () => {
    useCockpitStore.getState().setMode("flow");
    const { container } = render(<CockpitSceneOverlays />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    vi.spyOn(modal, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 400, 200));
    await act(async () => { document.body.append(modal); await Promise.resolve(); });
    const runFrame = (): void => {
      const callback = frameState.callbacks.at(-1);
      if (callback === undefined) throw new Error("Missing annotation frame");
      callback();
    };
    act(runFrame);
    const layer = container.querySelector<HTMLElement>(".scene-annotations");
    expect(layer?.hasAttribute("inert")).toBe(true);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { modal.remove(); await Promise.resolve(); });
    act(runFrame);
    expect(layer?.hasAttribute("inert")).toBe(false);
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("button", { name: "Dismiss annotation details" })).toBeTruthy();
  });

  it("measures and observes a sibling mobile header while excluding off-canvas widgets", () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const observers: TestResizeObserver[] = [];
    class TestResizeObserver implements ResizeObserver {
      readonly elements = new Set<Element>();
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
      observe(element: Element): void { this.elements.add(element); }
      unobserve(element: Element): void { this.elements.delete(element); }
      disconnect(): void { this.elements.clear(); }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const shell = document.createElement("div"); shell.className = "cockpit-shell is-mobile";
    shell.append(canvas);
    const topbar = document.createElement("div"); topbar.setAttribute("data-testid", "mobile-planner-topbar");
    const elsewhere = document.createElement("div"); elsewhere.setAttribute("data-floating-widget-id", "elsewhere");
    document.body.append(shell, topbar, elsewhere);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    const topbarBox = vi.spyOn(topbar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    vi.spyOn(elsewhere, "getBoundingClientRect").mockReturnValue(new DOMRect(2000, 0, 400, 1000));
    try {
      useCockpitStore.getState().setMode("flow");
      const { container, unmount } = render(<CockpitSceneOverlays renderGeometry={false} />);
      const runFrame = (): void => {
        const callback = frameState.callbacks.at(-1);
        if (callback === undefined) throw new Error("Missing annotation frame");
        callback();
      };
      act(runFrame);
      expect(shell.contains(topbar)).toBe(false);
      expect(container.querySelector(".scene-annotations")?.getAttribute("aria-hidden")).toBe("true");
      expect(observers.some((observer) => observer.elements.has(topbar))).toBe(true);
      expect(observers.some((observer) => observer.elements.has(elsewhere))).toBe(false);
      // A ResizeObserver delivery, without a window resize, must release the
      // canvas and still keep every packed warning below the resized header.
      topbarBox.mockReturnValue(new DOMRect(10, 8, 1346, 70));
      act(() => {
        observers.filter((observer) => observer.elements.has(topbar)).forEach((observer) => { observer.callback([], observer); });
        runFrame();
      });
      expect(container.querySelector(".scene-annotations")?.getAttribute("aria-hidden")).toBe("false");
      const cards = [...container.querySelectorAll<HTMLElement>(".scene-annotations__card")];
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        const match = /translate\([^,]+, ([^)]+)px\)/.exec(card.style.transform);
        if (match?.[1] === undefined) throw new Error("Missing annotation placement");
        expect(Number.parseFloat(match[1])).toBeGreaterThanOrEqual(86);
      }
      unmount();
    } finally {
      cleanup(); shell.remove(); topbar.remove(); elsewhere.remove(); canvasBox.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("reflows around a body-portalled View panel and restores selected details on close", async () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div"); shell.className = "cockpit-shell";
    shell.append(canvas); document.body.append(shell);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    const view = document.createElement("section"); view.setAttribute("data-floating-widget-id", "planner-camera-views");
    vi.spyOn(view, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    useCockpitStore.getState().setMode("flow");
    const { container, unmount } = render(<CockpitSceneOverlays renderGeometry={false} />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const runFrame = (): void => {
      const callback = frameState.callbacks.at(-1);
      if (callback === undefined) throw new Error("Missing annotation frame");
      callback();
    };
    act(runFrame);
    const layer = container.querySelector(".scene-annotations");
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    await act(async () => { document.body.append(view); await Promise.resolve(); });
    act(runFrame);
    expect(shell.contains(view)).toBe(false);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    expect(useCockpitStore.getState().beam).toBeNull();
    await act(async () => { view.remove(); await Promise.resolve(); });
    act(runFrame);
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    expect(useCockpitStore.getState().beam).not.toBeNull();
    unmount(); shell.remove(); canvasBox.mockRestore();
  });

  it("reflows around the actual client schedule dock when it expands and collapses", () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div"); shell.className = "cockpit-shell";
    const dock = document.createElement("footer"); dock.className = "cockpit-bottom client-event-dock";
    dock.setAttribute("aria-label", "Your event schedule");
    shell.append(canvas, dock); document.body.append(shell);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    const dockBox = vi.spyOn(dock, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 80, 1366, 920));
    useCockpitStore.getState().setMode("flow");
    const { container, unmount } = render(<CockpitSceneOverlays renderGeometry={false} />);
    const runFrame = (): void => {
      const callback = frameState.callbacks.at(-1);
      if (callback === undefined) throw new Error("Missing annotation frame");
      callback();
    };
    act(runFrame);
    const layer = container.querySelector<HTMLElement>(".scene-annotations");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    dockBox.mockReturnValue(new DOMRect(0, 940, 1366, 60));
    fireEvent(window, new Event("resize")); act(runFrame);
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    const cards = [...container.querySelectorAll<HTMLElement>(".scene-annotations__card")];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const match = /translate\([^,]+, ([^)]+)px\)/.exec(card.style.transform);
      if (match?.[1] === undefined) throw new Error("Missing annotation placement");
      expect(Number.parseFloat(match[1]) + 44).toBeLessThanOrEqual(932);
    }
    unmount(); shell.remove(); canvasBox.mockRestore();
  });

  it("follows capture caption visibility without reserving its retained hidden bounds", async () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div"); shell.className = "cockpit-shell is-mobile";
    const caption = document.createElement("p"); caption.className = "room-resolve-caption";
    caption.setAttribute("data-visible", "false"); caption.textContent = "Room capture could not load.";
    shell.append(canvas, caption); document.body.append(shell);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    vi.spyOn(caption, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    useCockpitStore.getState().setMode("flow");
    const { container, unmount } = render(<CockpitSceneOverlays renderGeometry={false} />);
    const marker = screen.getAllByRole("button", { name: /Simulated/ })[0];
    if (marker === undefined) throw new Error("Missing marker");
    fireEvent.click(marker);
    const runFrame = (): void => {
      const callback = frameState.callbacks.at(-1);
      if (callback === undefined) throw new Error("Missing annotation frame");
      callback();
    };
    act(runFrame);
    const layer = container.querySelector<HTMLElement>(".scene-annotations");
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    await act(async () => { caption.setAttribute("data-visible", "true"); await Promise.resolve(); });
    act(runFrame);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(useCockpitStore.getState().beam).toBeNull();
    await act(async () => { caption.setAttribute("data-visible", "false"); await Promise.resolve(); });
    act(runFrame);
    expect(layer?.getAttribute("aria-hidden")).toBe("false");
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    expect(useCockpitStore.getState().beam).not.toBeNull();
    unmount(); shell.remove(); canvasBox.mockRestore();
  });

});
