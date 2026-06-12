import { describe, expect, it, vi } from "vitest";
import { runGuestFlowReplayV0, type GuestFlowReplayInput } from "@omnitwin/types";
import { runGuestFlowReplayInBrowser } from "../guest-flow-replay-worker.js";
import type { GuestFlowReplayWorkerRequest, GuestFlowReplayWorkerResponse } from "../../workers/guest-flow-replay.worker.js";

const INPUT: GuestFlowReplayInput = {
  scenarioType: "guest_arrival",
  layout: {
    configurationId: null,
    snapshotHash: null,
    placedObjectCount: 2,
  },
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 8 },
    { x: 0, y: 8 },
  ],
  obstacles: [{
    id: "table",
    label: "Table",
    polygon: [
      { x: 5, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 5 },
      { x: 5, y: 5 },
    ],
  }],
  entrances: [{ id: "entry", label: "Entry", point: { x: 1, y: 4 }, widthM: 1.2 }],
  exits: [{ id: "exit", label: "Exit", point: { x: 11, y: 4 }, widthM: 1.2 }],
  destinations: [{ id: "bar", label: "Bar", point: { x: 10, y: 4 }, weight: 1 }],
  staffLanes: [],
  phase: { phaseId: null, label: "Arrival", durationMinutes: 20 },
  assumptions: [{ key: "arrival_window", label: "Arrival window", value: "20 minutes", source: "test fixture" }],
  agentCount: 12,
  seed: 99,
};

function isWorkerRequest(message: unknown): message is GuestFlowReplayWorkerRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    "input" in message
  );
}

describe("guest flow replay worker boundary", () => {
  it("falls back to deterministic main-thread generation when workers are unavailable", async () => {
    const result = await runGuestFlowReplayInBrowser(INPUT, { workerFactory: null });

    expect(result.mode).toBe("main-thread-fallback");
    expect(result.artifact.artifactHash).toBe(runGuestFlowReplayV0(INPUT).artifactHash);
    expect(result.artifact.disclosureLabel).toBe("Simulated guest flow - planning support");
  });

  it("uses worker responses when a worker is available", async () => {
    const terminate = vi.fn();
    const fakeWorker = new EventTarget() as Worker;
    fakeWorker.onmessage = null;
    fakeWorker.onerror = null;
    fakeWorker.terminate = terminate;
    fakeWorker.postMessage = (message: unknown): void => {
      if (!isWorkerRequest(message)) {
        throw new Error("Expected a guest flow replay worker request.");
      }
      const response: GuestFlowReplayWorkerResponse = {
        id: message.id,
        ok: true,
        artifact: runGuestFlowReplayV0(message.input),
      };
      fakeWorker.onmessage?.(new MessageEvent("message", { data: response }));
    };

    const result = await runGuestFlowReplayInBrowser(INPUT, {
      workerFactory: () => fakeWorker,
      timeoutMs: 1000,
    });

    expect(result.mode).toBe("worker");
    expect(result.artifact.navmesh.algorithm).toBe("grid_navmesh_fallback_v0");
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
