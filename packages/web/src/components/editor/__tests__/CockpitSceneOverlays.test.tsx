import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  GuestFlowReplayArtifactSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
} from "@omnitwin/types";

// happy-dom has no WebGL: stub the R3F hooks the overlays use and render drei's
// Html children straight to the DOM so the SAFE labels are queryable. The three
// intrinsics (group/mesh/lineSegments/…) render as inert custom elements.
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) => selector({ invalidate: vi.fn() }),
  useFrame: vi.fn(),
}));
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

  it("pauses replay-heavy spatial overlays while the planner camera is moving", () => {
    useCockpitStore.getState().setMode("flow");
    useCockpitStore.getState().setCameraInteractionActive(true);
    render(<CockpitSceneOverlays />);
    expect(screen.getByText(/Heritage & wall buffer/)).toBeTruthy();
    expect(screen.queryByText(/Simulated ·/)).toBeNull();
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
});
