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
const { useCockpitReplay } = await import("../use-cockpit-replay.js");

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
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
});
