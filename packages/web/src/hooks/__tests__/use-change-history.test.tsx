import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AuditLogEntry } from "../../api/action-log.js";
import { useChangeHistory } from "../use-change-history.js";

// G4 Slice 4 (reviewer CRITICAL): the hook's stale-continuation guard must
// key on request GENERATION, not config identity — a config value can
// become active twice (A→B→A, or enabled flipping), and a doubly-stale
// response for the same value would otherwise replace the accumulated
// trail and regress the paging cursor. Unmount and StrictMode-style
// re-runs invalidate in-flight requests the same way.

const { getActionLogMock } = vi.hoisted(() => ({
  getActionLogMock: vi.fn(
    (_configId: string, _after?: number, _limit?: number) =>
      Promise.resolve({ entries: [] as AuditLogEntry[], nextAfter: 0 }),
  ),
}));
vi.mock("../../api/action-log.js", () => ({
  getActionLog: getActionLogMock,
}));

function entry(ordinal: number, label: string): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label },
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:15:00.000Z",
    receivedAt: "2026-07-18T10:15:01.000Z",
  };
}

type Page = { entries: AuditLogEntry[]; nextAfter: number };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("useChangeHistory generation guard", () => {
  it("a doubly-stale response for a revisited config never replaces the trail nor regresses the cursor", async () => {
    // Request 1 (config A, will resolve LAST) is deferred; the A→B→A round
    // trip then loads fresh data and pages forward before it lands.
    let releaseFirst: ((page: Page) => void) | undefined;
    getActionLogMock.mockImplementationOnce(
      () => new Promise<Page>((resolve) => { releaseFirst = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ configId }: { configId: string | null }) => useChangeHistory(configId, true),
      { initialProps: { configId: "cfg-a" as string | null } },
    );
    expect(releaseFirst).toBeDefined();

    // Away to B and back to A; the fresh A fetch resolves immediately.
    getActionLogMock.mockResolvedValueOnce({ entries: [], nextAfter: 0 }); // B
    rerender({ configId: "cfg-b" });
    getActionLogMock.mockResolvedValueOnce({
      entries: [entry(1, "Fresh A page one"), entry(2, "Fresh A page two")],
      nextAfter: 2,
    });
    rerender({ configId: "cfg-a" });
    await waitFor(() => { expect(result.current.entries).toHaveLength(2); });

    // The original request finally lands with config A's STALE first page.
    act(() => {
      releaseFirst?.({ entries: [entry(1, "Stale ancient page")], nextAfter: 1 });
    });

    expect(result.current.entries).toHaveLength(2); // not replaced
    expect(result.current.entries[0]?.payload).toEqual({ label: "Fresh A page one" });

    // And the cursor did not regress: Load more continues from ordinal 2.
    getActionLogMock.mockResolvedValueOnce({ entries: [entry(3, "Page three")], nextAfter: 3 });
    act(() => { result.current.loadMore(); });
    await waitFor(() => { expect(result.current.entries).toHaveLength(3); });
    const lastCall = getActionLogMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(2); // after=2, never the stale 1
  });

  it("an unmount invalidates the in-flight request — no state updates after teardown", async () => {
    let release: ((page: Page) => void) | undefined;
    getActionLogMock.mockImplementationOnce(
      () => new Promise<Page>((resolve) => { release = resolve; }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount } = renderHook(() => useChangeHistory("cfg-a", true));
    unmount();
    act(() => { release?.({ entries: [entry(1, "Late")], nextAfter: 1 }); });
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled(); // no setState-after-unmount noise
    errorSpy.mockRestore();
  });

  it("an enabled flip mid-fetch discards the disabled run's response", async () => {
    let release: ((page: Page) => void) | undefined;
    getActionLogMock.mockImplementationOnce(
      () => new Promise<Page>((resolve) => { release = resolve; }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useChangeHistory("cfg-a", enabled),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    act(() => { release?.({ entries: [entry(1, "From the enabled era")], nextAfter: 1 }); });
    await Promise.resolve();
    expect(result.current.entries).toHaveLength(0);
  });
});
