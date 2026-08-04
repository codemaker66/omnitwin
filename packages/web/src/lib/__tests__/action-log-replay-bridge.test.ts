import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "../../api/action-log.js";
import { registerReplayBridge } from "../action-log-replay-bridge.js";
import { useEditorStore } from "../../stores/editor-store.js";

// G4 Slice 4: the session-replay dev bridge — window.__venReplay fetches a
// configuration's full audit trail, replays it through the tested engine,
// and diffs the reconstruction against the LIVE editor objects. Thin over
// replayActions; what this suite pins is the bridge contract: full paging,
// the id-level comparison, and clean registration/cleanup.

const { getActionLogMock } = vi.hoisted(() => ({
  getActionLogMock: vi.fn(
    (_configId: string, _after?: number, _limit?: number) =>
      Promise.resolve({ entries: [] as AuditLogEntry[], nextAfter: 0 }),
  ),
}));
vi.mock("../../api/action-log.js", () => ({
  getActionLog: getActionLogMock,
}));

const TABLE = { id: "obj-1", kind: "table-round", positionX: 5 };

function placeEntry(ordinal: number): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place", added: [{ object: TABLE, index: 0 }], removed: [], updated: [] },
    inverse: { label: "Place", added: [], removed: [{ object: TABLE, index: 0 }], updated: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:00:00.000Z",
    receivedAt: "2026-07-18T10:00:01.000Z",
  };
}

let unregister: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ configId: "cfg-replay-test" });
});

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe("registerReplayBridge", () => {
  it("registers window.__venReplay and cleans it up", () => {
    unregister = registerReplayBridge();
    expect(typeof window.__venReplay).toBe("function");
    unregister();
    unregister = undefined;
    expect(window.__venReplay).toBeUndefined();
  });

  it("fetches every page, replays, and diffs against the live objects", async () => {
    // Two pages: a full 100 then a short tail — the bridge must keep paging.
    const fullPage = Array.from({ length: 100 }, (_, i) => placeEntry(i + 1));
    getActionLogMock
      .mockResolvedValueOnce({ entries: fullPage, nextAfter: 100 })
      .mockResolvedValueOnce({ entries: [placeEntry(101)], nextAfter: 101 });
    // The live document happens to hold one matching id and one extra.
    // Fixture objects carry only what the bridge reads (ids); the single
    // Partial→full assertion is the honest test-fixture shape.
    type EditorObjects = ReturnType<typeof useEditorStore.getState>["objects"];
    const liveFixture = [
      { id: "obj-1", positionX: 5 },
      { id: "obj-extra", positionX: 0 },
    ] as Partial<EditorObjects[number]>[] as EditorObjects;
    useEditorStore.setState({ objects: liveFixture });

    unregister = registerReplayBridge();
    if (window.__venReplay === undefined) throw new Error("bridge missing");
    const report = await window.__venReplay();

    expect(getActionLogMock).toHaveBeenCalledTimes(2);
    expect(report?.replay.applied).toBeGreaterThan(0);
    expect(report?.comparison.matching).toBe(1);
    expect(report?.comparison.extraInLive).toEqual(["obj-extra"]);
    expect(report?.comparison.missingFromLive).toEqual([]);
  });

  it("flags a config switch during paging — the diff would compare the wrong documents (reviewer M3)", async () => {
    let releaseSecond: (() => void) | undefined;
    const fullPage = Array.from({ length: 100 }, (_, i) => placeEntry(i + 1));
    getActionLogMock
      .mockResolvedValueOnce({ entries: fullPage, nextAfter: 100 })
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          releaseSecond = () => { resolve({ entries: [placeEntry(101)], nextAfter: 101 }); };
        }),
      );

    unregister = registerReplayBridge();
    if (window.__venReplay === undefined) throw new Error("bridge missing");
    const running = window.__venReplay();
    await vi.waitFor(() => { expect(releaseSecond).toBeDefined(); });
    useEditorStore.setState({ configId: "cfg-other" }); // planner moved on
    releaseSecond?.();
    const report = await running;

    expect(report?.caveats.some((caveat) => caveat.includes("switched"))).toBe(true);
  });

  it("flags truncation when the trail exceeds the page budget (reviewer M3)", async () => {
    // Every page comes back full — the loop exhausts its budget without
    // ever seeing a short page.
    getActionLogMock.mockImplementation((_configId: string, after = 0) =>
      Promise.resolve({
        entries: Array.from({ length: 100 }, (_, i) => placeEntry(after + i + 1)),
        nextAfter: after + 100,
      }));

    unregister = registerReplayBridge();
    if (window.__venReplay === undefined) throw new Error("bridge missing");
    const report = await window.__venReplay();

    expect(getActionLogMock).toHaveBeenCalledTimes(50); // the page budget
    expect(report?.caveats.some((caveat) => caveat.includes("truncated"))).toBe(true);
  });

  it("returns null with no configuration open", async () => {
    useEditorStore.setState({ configId: null });
    unregister = registerReplayBridge();
    if (window.__venReplay === undefined) throw new Error("bridge missing");
    expect(await window.__venReplay()).toBeNull();
    expect(getActionLogMock).not.toHaveBeenCalled();
  });
});
