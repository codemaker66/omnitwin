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
    expect(useCockpitStore.getState().beam).not.toBeNull();
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

  it("measures the mobile shell's actual top bar outside the canvas parent", () => {
    const canvas = frameState.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div"); shell.className = "cockpit-shell is-mobile";
    const canvasParent = document.createElement("div"); canvasParent.append(canvas);
    const topbar = document.createElement("div"); topbar.setAttribute("data-testid", "mobile-planner-topbar");
    shell.append(canvasParent, topbar); document.body.append(shell);
    const canvasBox = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    vi.spyOn(topbar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1366, 1000));
    useCockpitStore.getState().setMode("flow");
    const { container, unmount } = render(<CockpitSceneOverlays />);
    const callback = frameState.callbacks.at(-1);
    if (callback === undefined) throw new Error("Missing annotation frame");
    act(callback);
    expect(container.querySelector(".scene-annotations")?.getAttribute("aria-hidden")).toBe("true");
    unmount(); shell.remove(); canvasBox.mockRestore();
  });

});
