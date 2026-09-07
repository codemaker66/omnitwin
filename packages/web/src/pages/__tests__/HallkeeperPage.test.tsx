import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { HallkeeperSheetV2Schema, type HallkeeperSheetV2 } from "@omnitwin/types";
import { HallkeeperPage } from "../HallkeeperPage.js";
import {
  ackProgress,
  listPendingProgress,
  type QueuedProgressOp,
} from "../../lib/progress-sync-queue.js";

vi.mock("../../api/client.js", () => ({ getAuthToken: vi.fn().mockResolvedValue(null) }));
vi.mock("../../components/hallkeeper/HallkeeperStatusBanner.js", () => ({
  HallkeeperStatusBanner: () => null,
}));
vi.mock("../../lib/progress-sync-queue.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/progress-sync-queue.js")>(),
  listPendingProgress: vi.fn().mockResolvedValue([]),
  ackProgress: vi.fn().mockResolvedValue(undefined),
}));

const CONFIG_A = "00000000-0000-4000-8000-000000000001";
const CONFIG_B = "00000000-0000-4000-8000-000000000002";
const ROW_KEY = "furniture|Centre|Round table|0";
const checkedAt = "2026-09-07T08:00:00.000Z";

beforeEach(() => {
  vi.mocked(listPendingProgress).mockReset().mockResolvedValue([]);
  vi.mocked(ackProgress).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: Error) => void } {
  let resolvePromise: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  let rejectPromise: (reason: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function sheet(configId: string, name: string): HallkeeperSheetV2 {
  return HallkeeperSheetV2Schema.parse({
    config: { id: configId, name, guestCount: 8, layoutStyle: "dinner-rounds" },
    venue: { name: "Test venue", address: "Test address", timezone: "Europe/London" },
    space: { name: "Test room", widthM: 21, lengthM: 10.5, heightM: 6 },
    timing: null,
    instructions: null,
    phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
      key: ROW_KEY, name: "Round table", category: "table", qty: 1,
      afterDepth: 0, isAccessory: false, notes: "",
    }] }] }],
    totals: { entries: [], totalRows: 1, totalItems: 1 },
    diagramUrl: null,
    floorPlan: null,
    webViewUrl: `https://example.test/hallkeeper/${configId}`,
    generatedAt: checkedAt,
    approval: null,
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function mount(): void {
  render(<MemoryRouter initialEntries={[`/hallkeeper/${CONFIG_A}`]}>
    <Link to={`/hallkeeper/${CONFIG_B}`}>Open second sheet</Link>
    <Routes><Route path="/hallkeeper/:configId" element={<HallkeeperPage />} /></Routes>
  </MemoryRouter>);
}

describe("HallkeeperPage request and offline queue isolation", () => {
  it("keeps activity through overlapping check writes until success and rejection settle", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/v2")) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith("/progress") && init?.method === "PATCH") {
        writes += 1;
        return writes === 1 ? first.promise : second.promise;
      }
      if (url.endsWith("/progress")) return Promise.resolve(jsonResponse({ checked: {} }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    const checkbox = await screen.findByRole("checkbox", { name: /Round table/u });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    await waitFor(() => { expect(writes).toBe(2); });
    expect(screen.getByText("Saving shared checks…").closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(async () => { first.resolve(jsonResponse({})); await first.promise; });
    expect(screen.getByText("Saving shared checks…")).toBeTruthy();
    await act(async () => { second.resolve(new Response(null, { status: 403 })); await second.promise; });
    await waitFor(() => { expect(screen.queryByText("Saving shared checks…")).toBeNull(); });
    expect(screen.getByText(/previous check has been restored/u)).toBeTruthy();
  });

  it("shows only the current sheet's writes and ignores the old sheet's completion", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith(`/${CONFIG_A}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith(`/${CONFIG_B}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_B, "Second dinner")));
      if (url.endsWith("/progress") && init?.method === "PATCH") return url.includes(CONFIG_A) ? first.promise : second.promise;
      if (url.endsWith("/progress")) return Promise.resolve(jsonResponse({ checked: {} }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Round table/u }));
    expect(screen.getByText("Saving shared checks…")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Open second sheet" }));
    await screen.findByRole("heading", { level: 1, name: "Second dinner" });
    const checkbox = await screen.findByRole("checkbox", { name: /Round table/u });
    expect(screen.queryByText("Saving shared checks…")).toBeNull();
    fireEvent.click(checkbox);
    await act(async () => { first.resolve(jsonResponse({})); await first.promise; });
    expect(screen.getByText("Saving shared checks…")).toBeTruthy();
    await act(async () => { second.resolve(jsonResponse({})); await second.promise; });
    await waitFor(() => { expect(screen.queryByText("Saving shared checks…")).toBeNull(); });
  });

  it("stops replay activity on network failure while retained offline edits stay still", async () => {
    const replay = deferred<Response>();
    const queued: readonly QueuedProgressOp[] = [
      { configId: CONFIG_A, rowKey: ROW_KEY, desiredChecked: true, queuedAt: checkedAt },
    ];
    vi.mocked(listPendingProgress).mockResolvedValue(queued);
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/v2")) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith("/progress") && init?.method === "PATCH") return replay.promise;
      if (url.endsWith("/progress")) return Promise.resolve(jsonResponse({ checked: {} }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    await screen.findByText("Syncing saved checks…");
    await act(async () => { replay.reject(new Error("Offline")); await replay.promise.catch(() => undefined); });
    await waitFor(() => { expect(screen.queryByText("Syncing saved checks…")).toBeNull(); });
    expect(screen.getByRole("status", { name: "1 offline edit pending sync" })).toBeTruthy();
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    expect(ackProgress).not.toHaveBeenCalled();
  });
  it("keeps the current sheet when a previous sheet's JSON finishes after navigation", async () => {
    const delayedJson = deferred<{ data: HallkeeperSheetV2 }>();
    const firstResponse = jsonResponse(null);
    const parseFirstSheet = vi.spyOn(firstResponse, "json").mockReturnValue(delayedJson.promise);
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith(`/${CONFIG_A}/v2`)) return Promise.resolve(firstResponse);
      if (url.endsWith(`/${CONFIG_B}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_B, "Second dinner")));
      if (url.endsWith("/progress")) return Promise.resolve(jsonResponse({ checked: {} }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    await waitFor(() => { expect(parseFirstSheet).toHaveBeenCalledOnce(); });

    fireEvent.click(screen.getByRole("link", { name: "Open second sheet" }));
    await screen.findByRole("heading", { level: 1, name: "Second dinner" });
    await act(async () => {
      delayedJson.resolve({ data: sheet(CONFIG_A, "First dinner") });
      await delayedJson.promise;
    });

    expect(screen.getByRole("heading", { level: 1, name: "Second dinner" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "First dinner" })).toBeNull();
  });

  it("does not replace the current sheet's checks with a previous sheet's delayed progress", async () => {
    const delayedProgress = deferred<Response>();
    const firstProgressRequested = vi.fn();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith(`/${CONFIG_A}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith(`/${CONFIG_B}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_B, "Second dinner")));
      if (url.endsWith(`/${CONFIG_A}/progress`)) {
        firstProgressRequested();
        return delayedProgress.promise;
      }
      if (url.endsWith(`/${CONFIG_B}/progress`)) return Promise.resolve(jsonResponse({ checked: {} }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    await waitFor(() => { expect(firstProgressRequested).toHaveBeenCalledOnce(); });

    fireEvent.click(screen.getByRole("link", { name: "Open second sheet" }));
    await screen.findByRole("heading", { level: 1, name: "Second dinner" });
    await screen.findByRole("checkbox", { name: /Round table/u, checked: false });
    await act(async () => {
      delayedProgress.resolve(jsonResponse({ checked: { [ROW_KEY]: checkedAt } }));
      await delayedProgress.promise;
    });

    expect(screen.getByRole("heading", { level: 1, name: "Second dinner" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Round table/u }).getAttribute("aria-checked")).toBe("false");
  });

  it("drains the current sheet's offline work without discarding another sheet's queued uncheck", async () => {
    const otherRowKey = "furniture|Centre|Other table|0";
    let queued: readonly QueuedProgressOp[] = [
      { configId: CONFIG_A, rowKey: ROW_KEY, desiredChecked: true, queuedAt: checkedAt },
      { configId: CONFIG_B, rowKey: otherRowKey, desiredChecked: false, queuedAt: checkedAt },
    ];
    vi.mocked(listPendingProgress).mockImplementation(() => Promise.resolve(queued));
    vi.mocked(ackProgress).mockImplementation((configId, rowKey) => {
      queued = queued.filter((op) => op.configId !== configId || op.rowKey !== rowKey);
      return Promise.resolve();
    });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith(`/${CONFIG_A}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith(`/${CONFIG_A}/progress`)) {
        return Promise.resolve(jsonResponse(init?.method === "PATCH"
          ? { configId: CONFIG_A, rowKey: ROW_KEY, checked: true }
          : { checked: {} }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await screen.findByRole("heading", { level: 1, name: "First dinner" });
    await waitFor(() => { expect(ackProgress).toHaveBeenCalledWith(CONFIG_A, ROW_KEY); });

    expect(ackProgress).not.toHaveBeenCalledWith(CONFIG_B, otherRowKey);
    expect(queued).toEqual([
      { configId: CONFIG_B, rowKey: otherRowKey, desiredChecked: false, queuedAt: checkedAt },
    ]);
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(writes).toHaveLength(1);
    const write = writes[0];
    if (write === undefined) throw new Error("Expected a progress write");
    expect(requestUrl(write[0])).toContain(`/hallkeeper/${CONFIG_A}/progress`);
    expect(write[1]?.body).toBe(JSON.stringify({ rowKey: ROW_KEY, checked: true }));
  });

  it("shows and drains the next sheet's queued work while the previous sheet's replay is still pending", async () => {
    const firstReplay = deferred<Response>();
    const secondReplay = deferred<Response>();
    let queued: readonly QueuedProgressOp[] = [
      { configId: CONFIG_A, rowKey: ROW_KEY, desiredChecked: true, queuedAt: checkedAt },
      { configId: CONFIG_B, rowKey: ROW_KEY, desiredChecked: true, queuedAt: checkedAt },
    ];
    vi.mocked(listPendingProgress).mockImplementation(() => Promise.resolve(queued));
    vi.mocked(ackProgress).mockImplementation((configId, rowKey) => {
      queued = queued.filter((op) => op.configId !== configId || op.rowKey !== rowKey);
      return Promise.resolve();
    });
    const replayStarted = vi.fn();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith(`/${CONFIG_A}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_A, "First dinner")));
      if (url.endsWith(`/${CONFIG_B}/v2`)) return Promise.resolve(jsonResponse(sheet(CONFIG_B, "Second dinner")));
      if (url.endsWith("/progress") && init?.method !== "PATCH") return Promise.resolve(jsonResponse({ checked: {} }));
      if (url.endsWith(`/${CONFIG_A}/progress`) && init?.method === "PATCH") {
        replayStarted(CONFIG_A);
        return firstReplay.promise;
      }
      if (url.endsWith(`/${CONFIG_B}/progress`) && init?.method === "PATCH") {
        replayStarted(CONFIG_B);
        return secondReplay.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    mount();
    await screen.findByRole("heading", { level: 1, name: "First dinner" });
    await waitFor(() => { expect(replayStarted).toHaveBeenCalledWith(CONFIG_A); });
    fireEvent.click(screen.getByRole("link", { name: "Open second sheet" }));

    await screen.findByRole("heading", { level: 1, name: "Second dinner" });
    await screen.findByRole("status", { name: "1 offline edit pending sync" });
    await waitFor(() => { expect(replayStarted).toHaveBeenCalledWith(CONFIG_B); });
    expect(screen.getByText("Syncing saved checks…")).toBeTruthy();
    expect(ackProgress).not.toHaveBeenCalledWith(CONFIG_A, ROW_KEY);

    await act(async () => {
      secondReplay.resolve(jsonResponse({ configId: CONFIG_B, rowKey: ROW_KEY, checked: true }));
      await secondReplay.promise;
    });
    await waitFor(() => { expect(ackProgress).toHaveBeenCalledWith(CONFIG_B, ROW_KEY); });
    await waitFor(() => { expect(screen.queryByRole("status", { name: "1 offline edit pending sync" })).toBeNull(); });
    expect(screen.queryByText("Syncing saved checks…")).toBeNull();
    expect(ackProgress).not.toHaveBeenCalledWith(CONFIG_A, ROW_KEY);
    expect(queued).toEqual([
      { configId: CONFIG_A, rowKey: ROW_KEY, desiredChecked: true, queuedAt: checkedAt },
    ]);

    await act(async () => {
      firstReplay.resolve(jsonResponse({ configId: CONFIG_A, rowKey: ROW_KEY, checked: true }));
      await firstReplay.promise;
    });
    await waitFor(() => { expect(ackProgress).toHaveBeenCalledWith(CONFIG_A, ROW_KEY); });
    expect(queued).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Second dinner" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "1 offline edit pending sync" })).toBeNull();
  });
});
