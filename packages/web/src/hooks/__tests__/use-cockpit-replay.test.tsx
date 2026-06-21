import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  GuestFlowReplayArtifactSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
} from "@omnitwin/types";

vi.mock("../../lib/guest-flow-replay-worker.js", () => ({ runGuestFlowReplayInBrowser: vi.fn() }));

const worker = vi.mocked(await import("../../lib/guest-flow-replay-worker.js"));
const { TRADES_HALL_GUEST_FLOW_REPLAY_INPUT } = await import("../../lib/trades-hall-visual-demo-state.js");
const { useCockpitReplay, __resetCockpitReplayCache } = await import("../use-cockpit-replay.js");
const { usePlacementStore } = await import("../../stores/placement-store.js");
const { CATALOGUE_ITEMS } = await import("../../lib/catalogue.js");

// A *real* artifact produced by the real deterministic engine over the existing
// demo input — the mock only controls timing, never the numbers.
const REAL_ARTIFACT: GuestFlowReplayArtifact = GuestFlowReplayArtifactSchema.parse(
  runGuestFlowReplayV0(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT),
);

beforeEach(() => {
  worker.runGuestFlowReplayInBrowser.mockResolvedValue({
    artifact: REAL_ARTIFACT,
    mode: "main-thread-fallback",
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); usePlacementStore.setState({ placedItems: [] }); __resetCockpitReplayCache(); });

describe("useCockpitReplay", () => {
  it("stays idle and never runs the replay when disabled", () => {
    const { result } = renderHook(() => useCockpitReplay(false));
    expect(result.current.status).toBe("idle");
    expect(result.current.artifact).toBeNull();
    expect(result.current.bounds).toBeNull();
    expect(worker.runGuestFlowReplayInBrowser).not.toHaveBeenCalled();
  });

  it("loads the replay and exposes the artifact + room bounds when enabled", async () => {
    const { result } = renderHook(() => useCockpitReplay(true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.artifact).not.toBeNull();
    expect(result.current.bounds).not.toBeNull();
    expect(Number.isFinite(result.current.bounds?.maxX ?? NaN)).toBe(true);
  });

  it("caches the artifact and does not re-run when the lens re-enables", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCockpitReplay(enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(worker.runGuestFlowReplayInBrowser).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    expect(result.current.status).toBe("idle");

    rerender({ enabled: true });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(worker.runGuestFlowReplayInBrowser).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error status when the replay run fails", async () => {
    worker.runGuestFlowReplayInBrowser.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useCockpitReplay(true));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
  });

  it("builds the replay input from the live placed layout, not a demo constant", async () => {
    const table = CATALOGUE_ITEMS.find((item) => item.category === "table");
    if (table === undefined) throw new Error("expected a table in the catalogue");
    usePlacementStore.setState({
      placedItems: [{
        id: "t1", catalogueItemId: table.id, label: "", x: 6, y: 0, z: 2,
        rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null,
      }],
    });
    const { result } = renderHook(() => useCockpitReplay(true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    // The hook fed the worker an input derived from the placed table.
    const callArg = worker.runGuestFlowReplayInBrowser.mock.calls[0]?.[0];
    expect(callArg?.layout.placedObjectCount).toBe(1);
    expect(callArg?.obstacles).toHaveLength(1);
  });
});
